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

-- 夜间稀采样提醒配置（单行，id 恒为 1）
CREATE TABLE IF NOT EXISTS night_alert_config (
    id smallint PRIMARY KEY DEFAULT 1,
    night_start smallint NOT NULL,
    night_end smallint NOT NULL,
    low_sample_threshold integer NOT NULL,
    alert_active boolean NOT NULL DEFAULT false,
    alert_raised_at timestamptz,
    last_done_count integer NOT NULL DEFAULT 0,
    last_evaluated_at timestamptz,
    updated_by text,
    updated_at timestamptz,
    CONSTRAINT night_alert_config_singleton CHECK (id = 1)
);

-- 夜间稀采样提醒流水（亮灯 / 灭灯各一条，边沿触发）
CREATE TABLE IF NOT EXISTS night_alert_events (
    id serial PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('raised', 'resolved')),
    window_start smallint NOT NULL,
    window_end smallint NOT NULL,
    threshold integer NOT NULL,
    done_count integer NOT NULL,
    note text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
"""
