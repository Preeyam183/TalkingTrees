alter table tree_dialogue add column tone text not null default 'gentle';
-- Administrator-managed sensor calibration and stable species traits.
alter table devices add column moisture_calibration jsonb;
alter table species add column personality_traits text[] not null default array['gentle','observant'];
alter table species add column dialogue_care_profile jsonb not null default '{}';
create index hardware_readings_device_received on hardware_readings(device_id, received_at desc);

-- Preserve first receipt time and payload across retries; never overwrite evidence.
create function accept_hardware_reading(p_device uuid, p_seq bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r hardware_readings;
begin
  perform 1 from devices where id=p_device and revoked_at is null for update;
  if not found then raise exception 'unauthorized_device'; end if;
  select * into r from hardware_readings where device_id=p_device and sequence_number=p_seq;
  if found then
    if r.payload<>p_payload then raise exception 'idempotency_conflict'; end if;
    return to_jsonb(r);
  end if;
  insert into hardware_readings(device_id,sequence_number,payload)
    values(p_device,p_seq,p_payload) returning * into r;
  -- Trigger existing realtime tree consumers without changing game state.
  update trees set updated_at=now() where id=(select tree_id from devices where id=p_device);
  return to_jsonb(r);
end $$;
revoke all on function accept_hardware_reading(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function accept_hardware_reading(uuid,bigint,jsonb) to service_role;
