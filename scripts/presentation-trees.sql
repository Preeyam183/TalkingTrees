-- Manually supplied presentation readings, not hardware observations.
-- Run explicitly against the selected hosted project; never a deployment migration.
-- Rerun shortly before presenting to refresh these same records (no point awards).
begin;
do $$ begin
  if not exists(select 1 from public.profiles where id='61526880-23a4-4eac-9f7c-30901df67bb8')
    then raise exception 'Expected presentation account is missing'; end if;
  if not exists(select 1 from public.territories where id='3b744fff-b84f-4295-b2f2-46600beedea6')
    then raise exception 'Expected territory is missing'; end if;
end $$;
insert into public.species(id,name,description,thirst_pct,recovery_pct,personality_traits,dialogue_care_profile) values
('b6000000-0000-4000-8000-000000000001','Silver birch','Illustrative care profile; calibrate before real care.',30,45,array['wry','sensitive','earnest'],'{"temperatureField":"air_temperature_c","comfortableTemperatureC":[12,30],"highMoisturePct":80}'),
('b6000000-0000-4000-8000-000000000002','Japanese maple','Illustrative care profile; calibrate before real care.',30,45,array['playful','chatty','optimistic'],'{"temperatureField":"air_temperature_c","comfortableTemperatureC":[12,30],"highMoisturePct":80}'),
('b6000000-0000-4000-8000-000000000003','Weeping willow','Illustrative care profile; calibrate before real care.',30,45,array['reflective','soft-spoken','dry humor'],'{"temperatureField":"air_temperature_c","comfortableTemperatureC":[12,30],"highMoisturePct":80}')
on conflict(id) do nothing;
insert into public.trees(id,name,species_id,territory_id,location,owner_id,status,moisture,temperature,reading_at) values
('b7000000-0000-4000-8000-000000000001','Birch', 'b6000000-0000-4000-8000-000000000001','3b744fff-b84f-4295-b2f2-46600beedea6',extensions.st_setsrid(extensions.st_makepoint(-74.44613,40.49883),4326)::extensions.geography,'61526880-23a4-4eac-9f7c-30901df67bb8','thirsty',16,29,now()),
('b7000000-0000-4000-8000-000000000002','Maple', 'b6000000-0000-4000-8000-000000000002','3b744fff-b84f-4295-b2f2-46600beedea6',extensions.st_setsrid(extensions.st_makepoint(-74.44637,40.49887),4326)::extensions.geography,'61526880-23a4-4eac-9f7c-30901df67bb8','healthy',52,22,now()),
('b7000000-0000-4000-8000-000000000003','Willow','b6000000-0000-4000-8000-000000000003','3b744fff-b84f-4295-b2f2-46600beedea6',extensions.st_setsrid(extensions.st_makepoint(-74.44621,40.49864),4326)::extensions.geography,'61526880-23a4-4eac-9f7c-30901df67bb8','healthy',92,18,now())
on conflict(id) do update set moisture=excluded.moisture,temperature=excluded.temperature,status=excluded.status,reading_at=excluded.reading_at,updated_at=now();
-- Revoked device rows retain FK/provenance while disallowing hardware impersonation.
insert into public.devices(id,tree_id,hardware_id,key_hash,can_report_health,revoked_at) select
('b8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
('b7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
'manual-scenario-'||n,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),false,now()
from generate_series(1,3) n on conflict(id) do nothing;
insert into public.sensor_readings(device_id,tree_id,external_event_id,recorded_at,soil_moisture_pct,temperature_c,payload,result)
select d.id,t.id,'manual-'||gen_random_uuid(),t.reading_at,t.moisture,t.temperature,
jsonb_build_object('source','manual_scenario','hardware_observation',false,'soil_moisture_pct',t.moisture,'temperature_c',t.temperature,'tree_id',t.id,'timestamp',t.reading_at),
'{"status":"manual_scenario","points":0}'::jsonb
from public.trees t join public.devices d on d.tree_id=t.id
  and d.id=('b8000000-0000-4000-8000-'||right(t.id::text,12))::uuid
where t.id in ('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000003');
commit;
select id,name,owner_id,moisture,temperature,reading_at from public.tree_map where id in ('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000003');
