"""夜间稀采样提醒的数据读写与判定落地。

提醒链路（夜间窗判定 → 提醒灯 → 流水）全部集中在本模块；写口
api.create_log 不引用这里的任何东西，保证提醒永远不会拒收报送。
"""

from datetime import datetime, timezone

import psycopg

from db import connect
import nightwatch


def get_settings(conn) -> dict:
    """读取单条夜间设置；不存在则按环境变量默认值播种。"""
    now_utc = datetime.now(timezone.utc)
    conn.execute(
        """INSERT INTO night_settings
               (id, timezone, window_start, window_end,
                low_sample_threshold, updated_at)
           VALUES (1, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO NOTHING""",
        (
            nightwatch.DEFAULT_TIMEZONE,
            nightwatch.DEFAULT_START_HHMM,
            nightwatch.DEFAULT_END_HHMM,
            nightwatch.DEFAULT_THRESHOLD,
            now_utc,
        ),
    )
    row = conn.execute(
        """SELECT id, timezone, window_start, window_end,
                  low_sample_threshold, updated_by, updated_at
           FROM night_settings WHERE id = 1"""
    ).fetchone()
    return row


def update_settings(conn, *, timezone_name, window_start, window_end,
                    threshold, username) -> dict:
    start_t = nightwatch.parse_hhmm(window_start)
    end_t = nightwatch.parse_hhmm(window_end)
    if int(threshold) < 0:
        raise ValueError("低样本阈值不能为负数")
    now_utc = datetime.now(timezone.utc)
    conn.execute(
        """INSERT INTO night_settings
               (id, timezone, window_start, window_end,
                low_sample_threshold, updated_by, updated_at)
           VALUES (1, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET
               timezone = EXCLUDED.timezone,
               window_start = EXCLUDED.window_start,
               window_end = EXCLUDED.window_end,
               low_sample_threshold = EXCLUDED.low_sample_threshold,
               updated_by = EXCLUDED.updated_by,
               updated_at = EXCLUDED.updated_at""",
        (
            timezone_name,
            nightwatch.hhmm(start_t),
            nightwatch.hhmm(end_t),
            int(threshold),
            username,
            now_utc,
        ),
    )
    return get_settings(conn)


def count_done_since(conn, since_utc: datetime) -> int:
    """近窗办结数：当前夜间窗起点之后处理完成（status='done'）的条数。"""
    return conn.execute(
        """SELECT COUNT(*) AS n
             FROM yaw_logs
            WHERE status = 'done' AND processed_at >= %s""",
        (since_utc,),
    ).fetchone()["n"]


def record_alert_if_new(conn, *, window_start_utc: datetime, now_utc: datetime,
                        count: int, threshold: int) -> bool:
    """幂等写流水：同一夜间窗只保留一条，重复判定不报错、不重复插入。

    返回是否为本次新写入（调用方通常不关心）。
    """
    try:
        inserted = conn.execute(
            """INSERT INTO night_alerts
                   (window_start, triggered_at, recent_done_count, threshold)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (window_start) DO NOTHING
               RETURNING id""",
            (window_start_utc, now_utc, count, threshold),
        ).fetchone()
    except psycopg.Error:
        # 流水写入失败不影响提醒灯判定，更不能影响报送链路
        return False
    return inserted is not None


def list_alerts(conn, limit: int = 100) -> list:
    return conn.execute(
        """SELECT id, window_start, triggered_at, recent_done_count, threshold
             FROM night_alerts
            ORDER BY window_start DESC, id DESC
            LIMIT %s""",
        (int(limit),),
    ).fetchall()


def evaluate_status(conn, *, persist: bool = True) -> dict:
    """按服务端时钟做一次完整判定，返回提醒灯状态。

    persist=True 时，满足亮灯条件则幂等补一条提醒流水。
    """
    settings = get_settings(conn)
    tz = nightwatch.get_timezone(settings["timezone"])
    start_t = nightwatch.parse_hhmm(settings["window_start"])
    end_t = nightwatch.parse_hhmm(settings["window_end"])
    threshold = int(settings["low_sample_threshold"])

    now_utc, now_local = nightwatch.server_now(settings["timezone"])
    empty_window = start_t == end_t
    in_night = (not empty_window) and nightwatch.in_window(now_local, start_t, end_t)

    active_window_start_utc = None
    recent_count = None
    if in_night:
        win_start_local = nightwatch.window_start_instant(now_local, start_t, end_t)
        active_window_start_utc = win_start_local.astimezone(timezone.utc)
        recent_count = count_done_since(conn, active_window_start_utc)

    result = nightwatch.evaluate(
        now_local, start_t, end_t,
        recent_count if recent_count is not None else 0,
        threshold,
    )
    alert = bool(result["alert"])

    current_alert = None
    if alert and persist:
        assert active_window_start_utc is not None
        record_alert_if_new(
            conn,
            window_start_utc=active_window_start_utc,
            now_utc=now_utc,
            count=recent_count,
            threshold=threshold,
        )
        current_alert = conn.execute(
            """SELECT id, window_start, triggered_at, recent_done_count, threshold
                 FROM night_alerts WHERE window_start = %s""",
            (active_window_start_utc,),
        ).fetchone()

    return {
        "server_time": now_utc.isoformat(),
        "server_local_time": now_local.isoformat(),
        "timezone": settings["timezone"],
        "window_start": nightwatch.hhmm(start_t),
        "window_end": nightwatch.hhmm(end_t),
        "threshold": threshold,
        "in_night_window": in_night,
        "recent_done_count": recent_count,
        "alert": alert,
        "active_window_start": (
            active_window_start_utc.isoformat()
            if active_window_start_utc is not None
            else None
        ),
        "current_alert": current_alert,
        "updated_by": settings["updated_by"],
        "updated_at": settings["updated_at"],
    }


def run_evaluation_once() -> dict:
    """供 worker 周期调用：独立连接、独立事务，异常不外溢。"""
    with connect() as conn:
        status = evaluate_status(conn, persist=True)
        conn.commit()
    return status
