create function reset_demo() returns jsonb language plpgsql set search_path=public,extensions as $$declare t record; n int; begin
if not (select demo_mode from game_config) then raise exception 'simulator_disabled'; end if;
-- Row-level deletes avoid TRUNCATE/reader lock inversions during realtime reads.
perform 1 from territories order by id for update;
perform 1 from trees order by territory_id,id for update;
perform set_config('treequest.demo_reset','on',true);
delete from point_events;
delete from watering_events;
delete from tree_health_events;
delete from watering_sessions;
delete from watering_requests;
delete from tree_dialogue;
delete from sensor_delivery_queue where reading_id in (select id from sensor_readings where external_event_id not like 'seed-%');
delete from sensor_readings where external_event_id not like 'seed-%';
delete from devices where tree_id in (select id from trees where id::text not like '40000000-0000-4000-8000-%');
delete from trees where id::text not like '40000000-0000-4000-8000-%';
update sensor_delivery_queue set state='delivered',attempts=0,lease_until=null,lease_token=null,last_error=null,delivered_at=now();
for t in select id,territory_id from trees where id::text like '40000000-0000-4000-8000-%' order by territory_id,id loop
n:=right(t.id::text,12)::int;
update trees set owner_id=case when n<=2 then '10000000-0000-4000-8000-000000000001'::uuid else '10000000-0000-4000-8000-000000000002'::uuid end,status=case when n in (2,3) then 'thirsty' else 'healthy' end,moisture=case when n in (2,3) then 22 else 55 end,temperature=21,reading_at=now(),updated_at=now() where id=t.id;
if n in (2,3) then insert into watering_requests(tree_id) values(t.id); end if;
perform recalculate_territory(t.territory_id);
end loop;
update sensor_readings r set recorded_at=snapshot.reading_at,soil_moisture_pct=snapshot.moisture,temperature_c=snapshot.temperature from trees snapshot where r.tree_id=snapshot.id and r.external_event_id='seed-current' and snapshot.reading_at is not null;
return '{"reset":true}'::jsonb; end$$;
revoke execute on function reset_demo() from public,anon,authenticated;
grant execute on function reset_demo() to service_role;
