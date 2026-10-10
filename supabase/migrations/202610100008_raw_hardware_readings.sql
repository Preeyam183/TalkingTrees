alter table devices add column if not exists hardware_id text unique;

create table if not exists hardware_readings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices,
  sequence_number bigint not null check(sequence_number >= 0),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(device_id, sequence_number)
);

alter table hardware_readings enable row level security;
revoke all on hardware_readings from public,anon,authenticated;
grant all on hardware_readings to service_role;