create function lock_tree(p_tree uuid) returns void language plpgsql set search_path=public,extensions as $$declare v_territory uuid; begin
select territory_id into v_territory from trees where id=p_tree;
if not found then raise exception 'tree_not_found'; end if;
perform 1 from territories where id=v_territory for update;
perform 1 from trees where id=p_tree for update;
perform 1 from watering_requests where tree_id=p_tree and status='active' for update;
end$$;
create function recalculate_territory(p_id uuid) returns void language plpgsql set search_path=public as $$declare winner uuid; total int; ratio numeric; begin
perform 1 from territories where id=p_id for update;
select territory_ratio into ratio from game_config;
select count(*) into total from trees where territory_id=p_id and status not in ('dead','inactive');
select owner_id into winner from trees where territory_id=p_id and status not in ('dead','inactive') and owner_id is not null group by owner_id having count(*) >= total*ratio order by count(*) desc limit 1;
update territories set owner_id=winner where id=p_id and owner_id is distinct from winner;
end$$;
create function evaluate_tree(p_tree uuid) returns jsonb language plpgsql set search_path=public,extensions as $$
declare t trees; sp species; cfg game_config; req watering_requests; ev watering_events; sess watering_sessions; begin
perform lock_tree(p_tree); select * into t from trees where id=p_tree; select * into cfg from game_config; select * into sp from species where id=t.species_id;
select * into req from watering_requests where tree_id=p_tree and status='active';
if t.status in ('dead','inactive') then return jsonb_build_object('status',t.status); end if;
if t.reading_at is null or t.reading_at < now()-make_interval(secs=>cfg.stale_seconds) or sp.recovery_pct is null then
 update trees set status='unknown',updated_at=now() where id=p_tree and status<>'unknown';
 update watering_requests set status='cancelled',closed_at=now() where id=req.id;
 update watering_sessions set status='cancelled' where tree_id=p_tree and status='active';
 delete from tree_dialogue where tree_id=p_tree;
 return jsonb_build_object('status','unknown');
end if;
if t.moisture >= sp.recovery_pct then
 if req.id is not null then
 select e.* into ev from watering_events e join watering_sessions s on s.id=e.session_id
 where e.request_id=req.id and e.verified and e.completed_at is null and e.recorded_at >= now()-make_interval(secs=>cfg.evidence_seconds)
 and s.status='active' and s.expires_at>now() and t.reading_at>=s.started_at and t.reading_at>=now()-make_interval(secs=>cfg.evidence_seconds)
 order by e.created_at,e.id limit 1;
 if ev.id is not null then
 select * into sess from watering_sessions where id=ev.session_id;
 update watering_events set completed_at=now() where id=ev.id;
 insert into point_events(player_id,tree_id,amount,watering_event_id) values(sess.player_id,p_tree,cfg.care_points,ev.id);
 update trees set owner_id=sess.player_id where id=p_tree;
 update watering_requests set status='completed',closed_at=now() where id=req.id;
 update watering_sessions set status=case when id=sess.id then 'completed' else 'cancelled' end where request_id=req.id and status='active';
 else
 update watering_requests set status='resolved',closed_at=now() where id=req.id;
 update watering_sessions set status='cancelled' where request_id=req.id and status='active';
 end if;
 end if;
 update trees set status='healthy',updated_at=now() where id=p_tree;
elsif t.moisture < sp.thirst_pct or req.id is not null then
 update trees set status='thirsty',updated_at=now() where id=p_tree;
 insert into watering_requests(tree_id) values(p_tree) on conflict(tree_id) where status='active' do nothing;
else update trees set status='healthy',updated_at=now() where id=p_tree;
end if;
delete from tree_dialogue where tree_id=p_tree;
perform recalculate_territory(t.territory_id);
return jsonb_build_object('status',(select status from trees where id=p_tree),'completed',ev.id is not null,'points',case when ev.id is not null then cfg.care_points else 0 end);
end$$;
create function ingest_reading(p jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$
declare existing sensor_readings; rid uuid; v_result jsonb; cfg game_config; begin
perform lock_tree((p->>'tree_id')::uuid); select * into cfg from game_config;
if not exists(select 1 from devices where id=(p->>'device_id')::uuid and tree_id=(p->>'tree_id')::uuid and revoked_at is null) then raise exception 'device_association_invalid'; end if;
select * into existing from sensor_readings where device_id=(p->>'device_id')::uuid and external_event_id=p->>'external_event_id';
if found then if existing.payload<>p then raise exception 'idempotency_conflict'; end if; return existing.result; end if;
if (p->>'timestamp')::timestamptz>now()+make_interval(secs=>cfg.clock_skew_seconds) then raise exception 'future_timestamp'; end if;
insert into sensor_readings(device_id,tree_id,external_event_id,recorded_at,soil_moisture_pct,temperature_c,payload) values((p->>'device_id')::uuid,(p->>'tree_id')::uuid,p->>'external_event_id',(p->>'timestamp')::timestamptz,(p->>'soil_moisture_pct')::numeric,(p->>'temperature_c')::numeric,p) returning id into rid;
insert into sensor_delivery_queue(reading_id) values(rid);
update trees set moisture=(p->>'soil_moisture_pct')::numeric,temperature=(p->>'temperature_c')::numeric,reading_at=(p->>'timestamp')::timestamptz,updated_at=now() where id=(p->>'tree_id')::uuid and (reading_at is null or reading_at<(p->>'timestamp')::timestamptz);
if found then v_result:=evaluate_tree((p->>'tree_id')::uuid); else v_result:=jsonb_build_object('status','historical_only'); end if;
v_result:=v_result||jsonb_build_object('reading_id',rid,'external_event_id',p->>'external_event_id');
update sensor_readings set result=v_result where id=rid;
return v_result;
end$$;
create function start_watering(p_player uuid,p jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$
declare t trees; cfg game_config; req watering_requests; sess watering_sessions; loc geography; begin
perform lock_tree((p->>'tree_id')::uuid); select * into t from trees where id=(p->>'tree_id')::uuid; select * into cfg from game_config;
select * into sess from watering_sessions where player_id=p_player and idempotency_key=(p->>'idempotency_key')::uuid;
if found then
 if sess.tree_id<>t.id or sess.request_id<>(p->>'request_id')::uuid then raise exception 'idempotency_conflict'; end if;
 return to_jsonb(sess)-'location';
end if;
perform evaluate_tree(t.id);
select * into req from watering_requests where tree_id=t.id and id=(p->>'request_id')::uuid and status='active';
if not found or t.reading_at<now()-make_interval(secs=>cfg.evidence_seconds) then raise exception 'watering_ineligible_or_stale'; end if;
loc:=st_setsrid(st_makepoint((p->>'lng')::float,(p->>'lat')::float),4326)::geography;
if not st_dwithin(t.location,loc,cfg.proximity_m) then raise exception 'outside_proximity'; end if;
insert into watering_sessions(player_id,tree_id,request_id,location,baseline_pct,expires_at,idempotency_key) values(p_player,t.id,req.id,loc,t.moisture,now()+make_interval(secs=>cfg.session_seconds),(p->>'idempotency_key')::uuid) returning * into sess;
return to_jsonb(sess)-'location';
end$$;
create function submit_evidence(p jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$
declare sess watering_sessions; reading sensor_readings; old watering_events; cfg game_config; eid uuid; v_result jsonb; valid boolean; begin
perform lock_tree((p->>'tree_id')::uuid); select * into cfg from game_config;
if not exists(select 1 from devices where id=(p->>'device_id')::uuid and tree_id=(p->>'tree_id')::uuid and revoked_at is null) then raise exception 'device_association_invalid'; end if;
select * into old from watering_events where device_id=(p->>'device_id')::uuid and external_event_id=p->>'external_event_id';
if found then if old.payload<>p then raise exception 'idempotency_conflict'; end if; return old.result; end if;
select * into sess from watering_sessions where id=(p->>'session_id')::uuid and tree_id=(p->>'tree_id')::uuid;
if not found or sess.status<>'active' or sess.expires_at<=now() or not exists(select 1 from watering_requests where id=sess.request_id and status='active') then raise exception 'session_inactive'; end if;
select * into reading from sensor_readings where device_id=(p->>'device_id')::uuid and tree_id=sess.tree_id and external_event_id=p->>'sensor_event_id';
if not found then raise exception 'reading_not_found'; end if;
if reading.recorded_at<sess.started_at or reading.recorded_at<now()-make_interval(secs=>cfg.evidence_seconds) or (p->>'timestamp')::timestamptz<sess.started_at or (p->>'timestamp')::timestamptz<now()-make_interval(secs=>cfg.evidence_seconds) or (p->>'timestamp')::timestamptz>now()+make_interval(secs=>cfg.clock_skew_seconds) then raise exception 'evidence_not_fresh'; end if;
valid:=p->>'evidence_type'='explicit_watering_event' or reading.soil_moisture_pct-sess.baseline_pct>=cfg.moisture_increase_pct;
insert into watering_events(device_id,tree_id,session_id,request_id,external_event_id,sensor_reading_id,evidence_type,recorded_at,verified,payload) values(reading.device_id,sess.tree_id,sess.id,sess.request_id,p->>'external_event_id',reading.id,p->>'evidence_type',(p->>'timestamp')::timestamptz,valid,p) returning id into eid;
v_result:=evaluate_tree(sess.tree_id)||jsonb_build_object('event_id',eid,'verified',valid,'progress_pct',reading.soil_moisture_pct);
update watering_events set result=v_result where id=eid;
return v_result;
end$$;
create function report_health(p jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$declare old tree_health_events; t trees; cfg game_config; hid uuid; v_result jsonb; begin
perform lock_tree((p->>'tree_id')::uuid); select * into cfg from game_config; select * into t from trees where id=(p->>'tree_id')::uuid;
if not exists(select 1 from devices where id=(p->>'device_id')::uuid and tree_id=t.id and revoked_at is null and can_report_health) then raise exception 'health_permission_denied'; end if;
select * into old from tree_health_events where device_id=(p->>'device_id')::uuid and external_event_id=p->>'external_event_id';
if found then if old.payload<>p then raise exception 'idempotency_conflict'; end if; return old.result; end if;
if p->>'confirmed'<>'true' or p->>'status'<>'dead' then raise exception 'confirmation_required'; end if;
if (p->>'timestamp')::timestamptz>now()+make_interval(secs=>cfg.clock_skew_seconds) or (p->>'timestamp')::timestamptz<now()-make_interval(secs=>cfg.evidence_seconds) then raise exception 'health_event_not_fresh'; end if;
insert into tree_health_events(device_id,tree_id,external_event_id,status,recorded_at,reason,payload) values((p->>'device_id')::uuid,t.id,p->>'external_event_id','dead',(p->>'timestamp')::timestamptz,p->>'reason',p) returning id into hid;
if t.status<>'dead' then
 if t.owner_id is not null then insert into point_events(player_id,tree_id,amount,health_event_id) values(t.owner_id,t.id,cfg.death_points,hid); end if;
 update trees set status='dead',owner_id=null,updated_at=now() where id=t.id;
 update watering_requests set status='cancelled',closed_at=now() where tree_id=t.id and status='active';
 update watering_sessions set status='cancelled' where tree_id=t.id and status='active';
 delete from tree_dialogue where tree_id=t.id;
 perform recalculate_territory(t.territory_id);
end if;
v_result:=jsonb_build_object('event_id',hid,'status','dead','penalty_applied',t.status<>'dead' and t.owner_id is not null);
update tree_health_events set result=v_result where id=hid; return v_result;
end$$;
create function register_tree(p_player uuid,p jsonb) returns jsonb language plpgsql set search_path=public,extensions as $$declare loc geography; territory uuid; tid uuid; begin
loc:=st_setsrid(st_makepoint((p->>'lng')::float,(p->>'lat')::float),4326)::geography;
select id into territory from territories where st_covers(boundary,loc::geometry) order by id limit 1 for update;
if territory is null then raise exception 'outside_territories'; end if;
if not coalesce((p->>'confirm_new')::boolean,false) and exists(select 1 from trees where st_dwithin(location,loc,15)) then return jsonb_build_object('nearby',(select jsonb_agg(jsonb_build_object('id',id,'name',name)) from trees where st_dwithin(location,loc,15))); end if;
if p->>'photo_path' not like p_player::text||'/%' or not exists(select 1 from storage.objects where bucket_id='tree-photos' and name=p->>'photo_path') then raise exception 'invalid_photo'; end if;
insert into trees(name,species_id,territory_id,location,photo_path) values(p->>'name',nullif(p->>'species_id','')::uuid,territory,loc,p->>'photo_path') returning id into tid;
perform recalculate_territory(territory); return jsonb_build_object('id',tid);
end$$;
-- These functions are never callable by an anonymous or player client.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
