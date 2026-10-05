"""夜间稀采样提醒：服务端时钟判定夜间窗，窗内办结数低于阈值则亮灯并记流水。

设计要点：
- 判定只依赖数据库服务器时钟（CURRENT_TIMESTAMP），不信任浏览器时钟。
- 亮灯/灭灯为边沿触发：状态翻转时才写一条 night_alert_events 流水。
- 本模块不被提交接口（POST /api/logs）调用，提醒逻辑任何情况下都不会拒收报送。
"""

# 默认夜间窗 22:00–06:00（跨午夜），低样本阈值 2
DEFAULT_NIGHT_START = 22
DEFAULT_NIGHT_END = 6
DEFAULT_LOW_SAMPLE_THRESHOLD = 2


class NightWindowError(ValueError):
    """配置参数非法。"""


class NotInNightWindow(Exception):
    """当前不在夜间窗内，无法清空近窗办结。"""


def ensure_seed(conn):
    """配置表恒为单行；首次启动写入默认值。"""
    conn.execute(
        """INSERT INTO night_alert_config (id, night_start, night_end, low_sample_threshold)
           VALUES (1, %s, %s, %s)
           ON CONFLICT (id) DO NOTHING""",
        (DEFAULT_NIGHT_START, DEFAULT_NIGHT_END, DEFAULT_LOW_SAMPLE_THRESHOLD),
    )


def _clock_and_window(conn, cfg):
    """从数据库取服务器时钟并计算当前夜间窗起点。

    返回 (now_utc, tz_name, hour, in_window, window_start_naive_local)。
    """
    row = conn.execute(
        """SELECT CURRENT_TIMESTAMP AS now_utc,
                  current_setting('TimeZone') AS tz_name,
                  EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::int AS hour,
                  (CURRENT_TIMESTAMP AT TIME ZONE current_setting('TimeZone')) AS now_local"""
    ).fetchone()
    now_utc = row["now_utc"]
    hour = row["hour"]
    start = cfg["night_start"]
    end = cfg["night_end"]
    if start < end:
        in_window = start <= hour < end
        wrap_and_inside = False
    else:
        # 跨午夜窗，如 22 -> 6
        in_window = hour >= start or hour < end
        wrap_and_inside = hour < end
    window_start_local = row["now_local"].replace(
        hour=start, minute=0, second=0, microsecond=0
    )
    if wrap_and_inside:
        from datetime import timedelta

        window_start_local -= timedelta(days=1)
    return now_utc, row["tz_name"], hour, in_window, window_start_local


def _count_done_in_window(conn, window_start_local):
    row = conn.execute(
        """SELECT COUNT(*) AS n FROM yaw_logs
           WHERE status = 'done'
             AND processed_at IS NOT NULL
             AND processed_at >= (%s::timestamp AT TIME ZONE current_setting('TimeZone'))
             AND processed_at <= CURRENT_TIMESTAMP""",
        (window_start_local,),
    ).fetchone()
    return int(row["n"])


def _insert_event(conn, kind, cfg, done_count, note, now_utc, actor):
    conn.execute(
        """INSERT INTO night_alert_events
           (kind, window_start, window_end, threshold, done_count, note,
            created_by, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            kind,
            cfg["night_start"],
            cfg["night_end"],
            cfg["low_sample_threshold"],
            done_count,
            note,
            actor,
            now_utc,
        ),
    )


def evaluate(conn, actor="system"):
    """按当前服务器时钟判定一次，边沿翻转亮灯/灭灯并写流水。

    返回 status dict（供 GET /status 与配置/清空接口复用）。
    """
    with conn.transaction():
        cfg = conn.execute(
            "SELECT * FROM night_alert_config WHERE id = 1 FOR UPDATE"
        ).fetchone()
        now_utc, tz_name, hour, in_window, window_start_local = _clock_and_window(
            conn, cfg
        )
        done_count = _count_done_in_window(conn, window_start_local)
        threshold = cfg["low_sample_threshold"]
        was_active = cfg["alert_active"]
        should_active = in_window and done_count < threshold

        if not was_active and should_active:
            note = (
                f"夜间窗（{cfg['night_start']:02d}:00–{cfg['night_end']:02d}:00）"
                f"内办结 {done_count} 条，低于低样本阈值 {threshold}，点亮稀采样提醒"
            )
            _insert_event(conn, "raised", cfg, done_count, note, now_utc, actor)
            conn.execute(
                """UPDATE night_alert_config
                   SET alert_active = true,
                       alert_raised_at = %s,
                       last_done_count = %s,
                       last_evaluated_at = %s
                   WHERE id = 1""",
                (now_utc, done_count, now_utc),
            )
        elif was_active and not should_active:
            if not in_window:
                note = "已离开夜间窗，夜间稀采样提醒解除"
            else:
                note = (
                    f"夜间窗内办结恢复至 {done_count} 条"
                    f"（阈值 {threshold}），提醒解除"
                )
            _insert_event(conn, "resolved", cfg, done_count, note, now_utc, actor)
            conn.execute(
                """UPDATE night_alert_config
                   SET alert_active = false,
                       alert_raised_at = NULL,
                       last_done_count = %s,
                       last_evaluated_at = %s
                   WHERE id = 1""",
                (done_count, now_utc),
            )
        else:
            conn.execute(
                """UPDATE night_alert_config
                   SET last_done_count = %s, last_evaluated_at = %s
                   WHERE id = 1""",
                (done_count, now_utc),
            )

        cfg = conn.execute(
            "SELECT * FROM night_alert_config WHERE id = 1"
        ).fetchone()

    return _status_payload(
        cfg,
        now_utc,
        tz_name,
        hour,
        in_window,
        window_start_local,
        done_count,
        alert_active=should_active,
    )


def _status_payload(
    cfg, now_utc, tz_name, hour, in_window, window_start_local, done_count, alert_active
):
    return {
        "server_time": now_utc.isoformat(),
        "server_timezone": tz_name,
        "server_hour": hour,
        "in_night_window": in_window,
        "window_start_hour": cfg["night_start"],
        "window_end_hour": cfg["night_end"],
        "window_start_at": window_start_local.isoformat(),
        "low_sample_threshold": cfg["low_sample_threshold"],
        "done_count_in_window": done_count,
        "alert_active": alert_active,
        "alert_raised_at": cfg["alert_raised_at"].isoformat()
        if cfg.get("alert_raised_at")
        else None,
        "last_evaluated_at": now_utc.isoformat(),
    }


def get_config(conn):
    return conn.execute(
        "SELECT * FROM night_alert_config WHERE id = 1"
    ).fetchone()


def serialize_config(cfg):
    return {
        "night_start": cfg["night_start"],
        "night_end": cfg["night_end"],
        "low_sample_threshold": cfg["low_sample_threshold"],
        "alert_active": cfg["alert_active"],
        "alert_raised_at": cfg["alert_raised_at"].isoformat()
        if cfg["alert_raised_at"]
        else None,
        "last_done_count": cfg["last_done_count"],
        "last_evaluated_at": cfg["last_evaluated_at"].isoformat()
        if cfg["last_evaluated_at"]
        else None,
        "updated_by": cfg["updated_by"],
        "updated_at": cfg["updated_at"].isoformat() if cfg["updated_at"] else None,
    }


def list_events(conn, limit=100):
    rows = conn.execute(
        """SELECT id, kind, window_start, window_end, threshold, done_count, note,
                  created_by, created_at
           FROM night_alert_events
           ORDER BY id DESC
           LIMIT %s""",
        (limit,),
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["created_at"] = row["created_at"].isoformat()
        out.append(item)
    return out


def validate_window(night_start, night_end, threshold):
    """校验来自请求体的配置。"""
    def as_int(value, name, low, high):
        if isinstance(value, bool) or not isinstance(value, int):
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise NightWindowError(f"{name}必须是整数")
        if not (low <= value <= high):
            raise NightWindowError(f"{name}必须在 {low}–{high} 之间")
        return value

    start = as_int(night_start, "夜间窗起始小时", 0, 23)
    end = as_int(night_end, "夜间窗结束小时", 0, 23)
    thr = as_int(threshold, "低样本阈值", 0, 100000)
    if start == end:
        raise NightWindowError("夜间窗起始与结束不能相同（需要至少 1 小时的窗）")
    return start, end, thr


def update_config(conn, night_start, night_end, threshold, username):
    """writer 更新配置；若灯正亮，先按“配置变更”记一条解除流水，再按新配置重新判定。"""
    start, end, thr = validate_window(night_start, night_end, threshold)
    with conn.transaction():
        cfg = conn.execute(
            "SELECT * FROM night_alert_config WHERE id = 1 FOR UPDATE"
        ).fetchone()
        now_utc = conn.execute("SELECT CURRENT_TIMESTAMP AS ts").fetchone()["ts"]
        if cfg["alert_active"]:
            _insert_event(
                conn,
                "resolved",
                cfg,
                cfg["last_done_count"],
                "夜间提醒配置被修改，重新判定，提醒先行解除",
                now_utc,
                username,
            )
        conn.execute(
            """UPDATE night_alert_config
               SET night_start = %s,
                   night_end = %s,
                   low_sample_threshold = %s,
                   alert_active = false,
                   alert_raised_at = NULL,
                   updated_by = %s,
                   updated_at = %s
               WHERE id = 1""",
            (start, end, thr, username, now_utc),
        )
    return evaluate(conn, actor=username)


def clear_recent_done(conn, username):
    """清空“当前夜间窗内”的办结记录（与计数口径完全一致），随后立即重新判定。"""
    with conn.transaction():
        cfg = conn.execute(
            "SELECT * FROM night_alert_config WHERE id = 1 FOR UPDATE"
        ).fetchone()
        now_utc, _tz, _hour, in_window, window_start_local = _clock_and_window(
            conn, cfg
        )
        if not in_window:
            raise NotInNightWindow
        result = conn.execute(
            """DELETE FROM yaw_logs
               WHERE status = 'done'
                 AND processed_at IS NOT NULL
                 AND processed_at >= (%s::timestamp AT TIME ZONE current_setting('TimeZone'))
                 AND processed_at <= CURRENT_TIMESTAMP""",
            (window_start_local,),
        )
        cleared = result.rowcount
    status = evaluate(conn, actor=username)
    return cleared, status
