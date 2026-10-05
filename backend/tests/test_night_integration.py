"""端到端集成测试：真 PostgreSQL + Quart ASGI 测试客户端。

覆盖验收链路：
- 夜间窗覆盖当前且清空近窗办结 → 灯亮、记一条流水；
- 灯亮时 POST /api/logs 仍 201，worker 照常处理（只亮灯不收口）；
- 把窗挪到白天 → 灯灭、报送照常；
- observer 能读状态/流水但改设置 403；writer 可改。
"""

import asyncio
import datetime as dt
import os
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

import pgserver
import psycopg
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def pg_dsn():
    data_dir = tempfile.mkdtemp(prefix="pgtest-")
    server = pgserver.get_server(data_dir, cleanup_mode=None)
    dsn = server.get_uri()
    os.environ["DATABASE_URL"] = dsn
    yield dsn
    server.cleanup()


@pytest.fixture(scope="session")
def app_ctx(pg_dsn):
    import sys

    sys.path.insert(0, str(BACKEND_DIR))
    import db

    with psycopg.connect(pg_dsn) as conn:
        conn.execute(db.SCHEMA)
        conn.commit()

    import api

    yield api


@pytest.fixture(autouse=True)
def clean_db(pg_dsn):
    with psycopg.connect(pg_dsn) as conn:
        conn.execute("TRUNCATE yaw_logs, night_settings, night_alerts RESTART IDENTITY")
        conn.commit()
    yield


def hhmm(d: dt.datetime) -> str:
    return d.strftime("%H:%M")


@pytest.fixture
def local_now():
    return dt.datetime.now(ZoneInfo("Asia/Shanghai"))


def window_covering_now(now_local):
    """构造一个覆盖当前时刻的 [start, end] 窗（允许跨午夜）。"""
    start = now_local - dt.timedelta(minutes=10)
    end = now_local + dt.timedelta(hours=2)
    return hhmm(start), hhmm(end)


def window_missing_now(now_local):
    """构造一个不覆盖当前时刻的窗（现在之后 3~4 小时）。"""
    start = now_local + dt.timedelta(hours=3)
    end = now_local + dt.timedelta(hours=4)
    return hhmm(start), hhmm(end)


async def login(app_ctx, username, password):
    client = app_ctx.app.test_client()
    res = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert res.status_code == 200
    data = await res.get_json()
    return client, data["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_night_window_low_count_lights_alert_and_logs_history(app_ctx, local_now):
    client, token = await login(app_ctx, "technician", "tech123456")
    start, end = window_covering_now(local_now)

    res = await client.put(
        "/api/night/settings",
        json={
            "timezone": "Asia/Shanghai",
            "window_start": start,
            "window_end": end,
            "low_sample_threshold": 5,
        },
        headers=auth(token),
    )
    assert res.status_code == 200

    res = await client.get("/api/night/status", headers=auth(token))
    status = await res.get_json()
    assert res.status_code == 200
    assert status["in_night_window"] is True
    assert status["recent_done_count"] == 0
    assert status["alert"] is True
    assert status["active_window_start"] is not None

    res = await client.get("/api/night/history", headers=auth(token))
    history = await res.get_json()
    assert len(history) == 1
    assert history[0]["recent_done_count"] == 0
    assert history[0]["threshold"] == 5

    # 再轮询一次：同一夜间窗流水幂等，不重复写
    res = await client.get("/api/night/status", headers=auth(token))
    assert (await res.get_json())["alert"] is True
    res = await client.get("/api/night/history", headers=auth(token))
    assert len(await res.get_json()) == 1


@pytest.mark.asyncio
async def test_old_done_rows_before_window_not_counted(app_ctx, pg_dsn, local_now):
    client, token = await login(app_ctx, "technician", "tech123456")
    start, end = window_covering_now(local_now)
    await client.put(
        "/api/night/settings",
        json={
            "window_start": start,
            "window_end": end,
            "low_sample_threshold": 5,
        },
        headers=auth(token),
    )

    # 窗起点之前办结的 10 条记录不应计入近窗办结数
    old_time = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=8)
    with psycopg.connect(pg_dsn) as conn:
        for i in range(10):
            conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, created_by,
                    created_at, processed_at)
                   VALUES (%s, %s, 'done', 'technician', %s, %s)""",
                (f"W{i:02d}", 0.1, old_time, old_time),
            )
        conn.commit()

    res = await client.get("/api/night/status", headers=auth(token))
    status = await res.get_json()
    assert status["in_night_window"] is True
    assert status["recent_done_count"] == 0
    assert status["alert"] is True


@pytest.mark.asyncio
async def test_alert_lit_but_submission_not_blocked_and_worker_processes(
    app_ctx, pg_dsn, local_now
):
    client, token = await login(app_ctx, "technician", "tech123456")
    start, end = window_covering_now(local_now)
    await client.put(
        "/api/night/settings",
        json={"window_start": start, "window_end": end, "low_sample_threshold": 5},
        headers=auth(token),
    )
    # 前置：灯处于点亮状态
    status = await (
        await client.get("/api/night/status", headers=auth(token))
    ).get_json()
    assert status["alert"] is True

    # 灯亮时报送仍被接受（写口与提醒无任何耦合）
    res = await client.post(
        "/api/logs",
        json={"turbine_code": "W-NIGHT", "yaw_err_deg": 0.4},
        headers=auth(token),
    )
    assert res.status_code == 201
    row = await res.get_json()
    log_id = row["id"]
    assert row["status"] == "pending"

    # worker 照常认领处理
    import worker

    with worker.connect() as conn:
        assert worker.claim_and_process(conn) is True
        conn.commit()

    import db

    with db.connect() as conn:
        done = conn.execute(
            "SELECT status, verdict FROM yaw_logs WHERE id = %s", (log_id,)
        ).fetchone()
    assert done["status"] == "done"
    assert done["verdict"] == "合格"

    # 新办结计入近窗（1 < 5），灯继续亮，但绝没有拒收任何报送
    status = await (
        await client.get("/api/night/status", headers=auth(token))
    ).get_json()
    assert status["recent_done_count"] == 1
    assert status["alert"] is True


@pytest.mark.asyncio
async def test_count_at_threshold_keeps_light_off_even_at_night(app_ctx, local_now):
    client, token = await login(app_ctx, "technician", "tech123456")
    start, end = window_covering_now(local_now)
    await client.put(
        "/api/night/settings",
        json={"window_start": start, "window_end": end, "low_sample_threshold": 5},
        headers=auth(token),
    )
    # 先点亮以建窗，再直接取窗起点造 5 条窗内办结
    status = await (
        await client.get("/api/night/status", headers=auth(token))
    ).get_json()
    assert status["alert"] is True
    window_start = status["active_window_start"]
    import db

    with db.connect() as conn:
        now = dt.datetime.now(dt.timezone.utc)
        for i in range(5):
            conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, created_by,
                    created_at, processed_at)
                   VALUES (%s, %s, 'done', 'technician', %s, %s)""",
                (f"D{i:02d}", 0.2, now, now),
            )
        conn.commit()
    assert window_start  # 近窗办结计数 >= 窗起点

    status = await (
        await client.get("/api/night/status", headers=auth(token))
    ).get_json()
    assert status["in_night_window"] is True
    assert status["recent_done_count"] == 5
    assert status["alert"] is False  # 达到阈值不亮


@pytest.mark.asyncio
async def test_day_window_light_off_and_submission_works(app_ctx, local_now):
    import nightwatch

    client, token = await login(app_ctx, "technician", "tech123456")
    start, end = window_missing_now(local_now)

    # 确认这个窗确实不罩当前时刻
    st, en = nightwatch.parse_hhmm(start), nightwatch.parse_hhmm(end)
    assert nightwatch.in_window(local_now, st, en) is False

    res = await client.put(
        "/api/night/settings",
        json={"window_start": start, "window_end": end, "low_sample_threshold": 5},
        headers=auth(token),
    )
    assert res.status_code == 200

    res = await client.get("/api/night/status", headers=auth(token))
    status = await res.get_json()
    assert status["in_night_window"] is False
    assert status["alert"] is False
    assert status["recent_done_count"] is None

    # 白天（窗外）报送正常
    res = await client.post(
        "/api/logs",
        json={"turbine_code": "W-DAY", "yaw_err_deg": 0.4},
        headers=auth(token),
    )
    assert res.status_code == 201

    res = await client.get("/api/night/history", headers=auth(token))
    assert await res.get_json() == []


@pytest.mark.asyncio
async def test_observer_read_only(app_ctx, local_now):
    _, wtoken = await login(app_ctx, "technician", "tech123456")
    client, otoken = await login(app_ctx, "observer", "obs123456")

    # 观察员可读状态与流水
    res = await client.get("/api/night/status", headers=auth(otoken))
    assert res.status_code == 200
    res = await client.get("/api/night/history", headers=auth(otoken))
    assert res.status_code == 200

    # 观察员不能改设置
    start, end = window_covering_now(local_now)
    res = await client.put(
        "/api/night/settings",
        json={"window_start": start, "window_end": end, "low_sample_threshold": 3},
        headers=auth(otoken),
    )
    assert res.status_code == 403

    # 观察员不能报送
    res = await client.post(
        "/api/logs",
        json={"turbine_code": "W-OBS", "yaw_err_deg": 0.1},
        headers=auth(otoken),
    )
    assert res.status_code == 403

    # writer 改设置成功，且留痕
    res = await client.put(
        "/api/night/settings",
        json={"window_start": start, "window_end": end, "low_sample_threshold": 3},
        headers=auth(wtoken),
    )
    assert res.status_code == 200
    settings = await res.get_json()
    assert settings["low_sample_threshold"] == 3
    assert settings["updated_by"] == "technician"


@pytest.mark.asyncio
async def test_invalid_settings_rejected(app_ctx):
    client, token = await login(app_ctx, "technician", "tech123456")
    bad_bodies = [
        {"window_start": "22:00", "window_end": "06:00", "low_sample_threshold": -1},
        {"window_start": "abc", "window_end": "06:00", "low_sample_threshold": 3},
        {
            "window_start": "22:00",
            "window_end": "06:00",
            "low_sample_threshold": 3,
            "timezone": "Not/AZone",
        },
    ]
    for body in bad_bodies:
        res = await client.put("/api/night/settings", json=body, headers=auth(token))
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_anonymous_cannot_access(app_ctx):
    client = app_ctx.app.test_client()
    assert (await client.get("/api/night/status")).status_code == 401
    assert (await client.get("/api/night/history")).status_code == 401
    assert (await client.put("/api/night/settings", json={})).status_code == 401
