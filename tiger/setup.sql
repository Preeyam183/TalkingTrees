CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS sensor_history (
 reading_id uuid NOT NULL, tree_id uuid NOT NULL, device_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL, soil_moisture_pct double precision NOT NULL,
 temperature_c double precision NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (reading_id, recorded_at)
);
SELECT create_hypertable('sensor_history','recorded_at',if_not_exists=>true);
CREATE INDEX IF NOT EXISTS sensor_history_tree_time ON sensor_history(tree_id,recorded_at DESC);
-- Give the runtime database role only SELECT and INSERT on sensor_history.
