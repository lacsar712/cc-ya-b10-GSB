import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import judge
import night_alerts
from night_alerts import NightWindowError, NotInNightWindow

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    night_alerts.ensure_seed(conn)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    return jsonify(row), 201


# ---------------------------------------------------------------------------
# 夜间稀采样提醒
#
# 提醒链路（夜间窗判定 -> 提醒灯 -> 写口）与报送写口 POST /api/logs 完全解耦：
# 本区块任何逻辑都不会被 create_log 调用，亮灯或判定异常均不得拒收报送。
# ---------------------------------------------------------------------------


@app.get("/api/night-alert/status")
@require_login
async def night_alert_status(user):
    """顶栏提醒灯数据源：按服务器时钟实时判定，边沿翻转时写流水。"""

    def query():
        with connect() as conn:
            return night_alerts.evaluate(conn)

    status = await run_db(query)
    return jsonify(status)


@app.get("/api/night-alert/config")
@require_login
async def get_night_alert_config(user):
    def query():
        with connect() as conn:
            return night_alerts.serialize_config(night_alerts.get_config(conn))

    return jsonify(await run_db(query))


@app.put("/api/night-alert/config")
@require_writer
async def put_night_alert_config(user):
    body = await request.get_json(force=True, silent=True) or {}

    def update():
        with connect() as conn:
            return night_alerts.update_config(
                conn,
                body.get("night_start"),
                body.get("night_end"),
                body.get("low_sample_threshold"),
                user["username"],
            )

    try:
        status = await run_db(update)
    except NightWindowError as exc:
        return jsonify({"detail": str(exc)}), 400
    return jsonify(status)


@app.get("/api/night-alert/events")
@require_login
async def night_alert_events(user):
    def query():
        with connect() as conn:
            return night_alerts.list_events(conn)

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/night-alert/clear-recent-done")
@require_writer
async def clear_recent_done(user):
    """清空当前夜间窗内办结记录（验收操作，仅 writer）。"""
    try:
        cleared, status = await run_db(
            lambda: _clear_recent_done(user["username"])
        )
    except NotInNightWindow:
        return jsonify({"detail": "当前不在夜间窗内，无需清空近窗办结"}), 409
    return jsonify({"cleared": cleared, "status": status})


def _clear_recent_done(username):
    with connect() as conn:
        return night_alerts.clear_recent_done(conn, username)
