"""夜间稀采样提醒判定。

判定只依赖服务端时钟与数据库中的办结数据，绝不参与写口（POST /api/logs）：
提醒灯只负责提示与写流水，任何情况下都不得拒收报送。

夜间窗按站点本地时区（默认 Asia/Shanghai）的墙钟时间解释，支持跨午夜
（例如 22:00–06:00）。纯函数 in_window 不接触时钟，便于单测；now 由
调用方用 datetime.now(tz) 从服务端取。
"""

import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = os.environ.get("NIGHT_TIMEZONE", "Asia/Shanghai")
DEFAULT_START_HHMM = os.environ.get("NIGHT_WINDOW_START", "22:00")
DEFAULT_END_HHMM = os.environ.get("NIGHT_WINDOW_END", "06:00")
DEFAULT_THRESHOLD = int(os.environ.get("NIGHT_LOW_SAMPLE_THRESHOLD", "5"))
EVAL_INTERVAL_SEC = float(os.environ.get("NIGHT_EVAL_INTERVAL_SEC", "10"))


def get_timezone(name: str = DEFAULT_TIMEZONE) -> ZoneInfo:
    try:
        return validate_timezone(name)
    except Exception:
        return ZoneInfo("UTC")


def validate_timezone(name: str) -> ZoneInfo:
    """严格校验时区名；非法时抛异常供设置接口返回 400。"""
    text = (name or "").strip()
    if not text:
        raise ValueError("时区不能为空")
    return ZoneInfo(text)


def parse_hhmm(value) -> time:
    """把 'HH:MM'（或整数小时）解析为本地 time。"""
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    if isinstance(value, int):
        return time(hour=value)
    text = str(value).strip()
    parts = text.split(":")
    if len(parts) < 2:
        raise ValueError("时间格式应为 HH:MM")
    hour, minute = int(parts[0]), int(parts[1])
    return time(hour=hour, minute=minute)


def hhmm(value: time) -> str:
    return value.strftime("%H:%M")


def in_window(local_dt: datetime, start_t: time, end_t: time) -> bool:
    """本地墙钟时刻是否落在夜间窗内。

    start == end 视为空窗口（永不命中）；start > end 表示跨午夜窗口。
    """
    t = local_dt.time().replace(second=0, microsecond=0)
    if start_t == end_t:
        return False
    if start_t < end_t:
        return start_t <= t < end_t
    # 跨午夜：[start, 24:00) 或 [00:00, end)
    return t >= start_t or t < end_t


def evaluate(local_dt: datetime, start_t: time, end_t: time,
             recent_done_count: int, threshold: int) -> dict:
    """纯判定：当前是否在夜间窗内、办结数是否低于阈值、是否该亮灯。"""
    in_night = in_window(local_dt, start_t, end_t)
    low = recent_done_count < threshold
    return {
        "in_night_window": in_night,
        "recent_done_count": recent_done_count,
        "threshold": threshold,
        "alert": in_night and low,
    }


def window_start_instant(now_local: datetime, start_t: time, end_t: time) -> datetime:
    """当前所处夜间窗的起点（本地时区）。"""
    today_start = now_local.replace(
        hour=start_t.hour, minute=start_t.minute, second=0, microsecond=0
    )
    if start_t < end_t:
        # 同日内窗口
        if now_local >= today_start:
            return today_start
        return today_start - timedelta(days=1)
    # 跨午夜窗口：窗起点永远是当天 start；若现在早于 start 则属于昨夜的窗
    if now_local.time().replace(second=0, microsecond=0) >= start_t:
        return today_start
    return today_start - timedelta(days=1)


def server_now(tzname: str = DEFAULT_TIMEZONE) -> tuple[datetime, datetime]:
    """返回 (UTC now, 站点本地 now)，时间取自服务端时钟。"""
    now_utc = datetime.now(timezone.utc)
    return now_utc, now_utc.astimezone(get_timezone(tzname))
