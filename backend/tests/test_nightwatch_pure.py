"""夜间窗判定纯函数测试（不依赖数据库与时钟）。"""

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import nightwatch  # noqa: E402

CST = ZoneInfo("Asia/Shanghai")


def loc(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=CST)


def test_cross_midnight_window():
    s, e = nightwatch.parse_hhmm("22:00"), nightwatch.parse_hhmm("06:00")
    f = lambda dt: nightwatch.in_window(dt, s, e)  # noqa: E731
    assert f(loc(2026, 10, 4, 22, 0))   # 窗起点，含
    assert f(loc(2026, 10, 4, 23, 30))  # 前半夜
    assert f(loc(2026, 10, 5, 0, 0))    # 跨午夜
    assert f(loc(2026, 10, 5, 5, 59))   # 凌晨临近结束
    assert not f(loc(2026, 10, 5, 6, 0))  # 窗终点，不含
    assert not f(loc(2026, 10, 4, 21, 59))
    assert not f(loc(2026, 10, 5, 12, 0))  # 白天


def test_same_day_window():
    s, e = nightwatch.parse_hhmm("09:00"), nightwatch.parse_hhmm("17:00")
    f = lambda dt: nightwatch.in_window(dt, s, e)  # noqa: E731
    assert f(loc(2026, 10, 5, 9, 0))
    assert f(loc(2026, 10, 5, 12, 0))
    assert not f(loc(2026, 10, 5, 8, 59))
    assert not f(loc(2026, 10, 5, 17, 0))


def test_empty_window_never_matches():
    s = e = nightwatch.parse_hhmm("00:00")
    assert not nightwatch.in_window(loc(2026, 10, 5, 0, 0), s, e)
    assert not nightwatch.in_window(loc(2026, 10, 5, 12, 0), s, e)


def test_evaluate_alert_requires_night_and_low_count():
    s, e = nightwatch.parse_hhmm("22:00"), nightwatch.parse_hhmm("06:00")
    # 窗内且低于阈值 → 亮灯
    r = nightwatch.evaluate(loc(2026, 10, 5, 2, 0), s, e, 4, 5)
    assert r == {
        "in_night_window": True,
        "recent_done_count": 4,
        "threshold": 5,
        "alert": True,
    }
    # 窗内但办结数达到阈值 → 不亮
    assert nightwatch.evaluate(loc(2026, 10, 5, 2, 0), s, e, 5, 5)["alert"] is False
    assert nightwatch.evaluate(loc(2026, 10, 5, 2, 0), s, e, 99, 5)["alert"] is False
    # 白天即使办结数为 0 也不亮（不能误挡白天）
    day = nightwatch.evaluate(loc(2026, 10, 5, 12, 0), s, e, 0, 5)
    assert day["in_night_window"] is False and day["alert"] is False


def test_window_start_instant_cross_midnight():
    s, e = nightwatch.parse_hhmm("22:00"), nightwatch.parse_hhmm("06:00")
    # 凌晨属于昨夜 22:00 开始的窗
    ws = nightwatch.window_start_instant(loc(2026, 10, 5, 2, 0), s, e)
    assert ws.replace(tzinfo=None).isoformat() == "2026-10-04T22:00:00"
    # 夜里 23 点属于当天 22:00 开始的窗
    ws = nightwatch.window_start_instant(loc(2026, 10, 4, 23, 0), s, e)
    assert ws.replace(tzinfo=None).isoformat() == "2026-10-04T22:00:00"


def test_window_start_instant_same_day():
    s, e = nightwatch.parse_hhmm("09:00"), nightwatch.parse_hhmm("17:00")
    assert nightwatch.window_start_instant(loc(2026, 10, 5, 10, 0), s, e) == loc(
        2026, 10, 5, 9, 0
    )
    # 开窗前属于前一天的窗
    ws = nightwatch.window_start_instant(loc(2026, 10, 5, 8, 0), s, e)
    assert ws.replace(tzinfo=None).isoformat() == "2026-10-04T09:00:00"
