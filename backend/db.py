import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS night_settings (
    id smallint PRIMARY KEY DEFAULT 1,
    timezone text NOT NULL DEFAULT 'Asia/Shanghai',
    window_start text NOT NULL DEFAULT '22:00',
    window_end text NOT NULL DEFAULT '06:00',
    low_sample_threshold integer NOT NULL DEFAULT 5,
    updated_by text,
    updated_at timestamptz NOT NULL,
    CONSTRAINT night_settings_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS night_alerts (
    id bigserial PRIMARY KEY,
    window_start timestamptz NOT NULL,
    triggered_at timestamptz NOT NULL,
    recent_done_count integer NOT NULL,
    threshold integer NOT NULL
);

-- 同一夜间窗只记一条提醒流水（worker 与接口重复判定也幂等）
CREATE UNIQUE INDEX IF NOT EXISTS night_alerts_one_per_window
    ON night_alerts (window_start);
"""
