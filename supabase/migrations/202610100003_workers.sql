create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function expire_sensor_state() returns int language plpgsql security definer set search_path=public,extensions as $$declare t record; n int:=0; cfg game_config; begin
select * into cfg from game_config;
for t in select id from trees where status not in ('dead','inactive','unknown') and (reading_at is null or reading_at<now()-make_interval(secs=>cfg.stale_seconds)) order by territory_id,id loop perform evaluate_tree(t.id); n:=n+1; end loop;
update watering_sessions set status='expired' where status='active' and expires_at<=now();
return n; end$$;
create function claim_deliveries(p_limit int default 100) returns setof jsonb language sql set search_path=public as $$
with claim as (select id from sensor_delivery_queue where (state='pending' and next_attempt_at<=now()) or (state='leased' and lease_until<now()) order by created_at for update skip locked limit least(greatest(p_limit,1),500)), updated as (update sensor_delivery_queue q set state='leased',lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=q.attempts+1 from claim where q.id=claim.id returning q.*)
select to_jsonb(u)||jsonb_build_object('reading',to_jsonb(r)-'payload'-'result') from updated u join sensor_readings r on r.id=u.reading_id;
$$;
create function finish_delivery(p_id uuid,p_token uuid,p_error text default null) returns void language sql set search_path=public as $$
update sensor_delivery_queue set state=case when p_error is null then 'delivered' when attempts>=12 then 'failed' else 'pending' end,delivered_at=case when p_error is null then now() else null end,last_error=left(p_error,500),lease_until=null,lease_token=null,next_attempt_at=now()+make_interval(secs=>least(3600,power(2,least(attempts,12))::int*5)) where id=p_id and lease_token=p_token and state='leased';
$$;
create function replay_deliveries() returns int language plpgsql set search_path=public as $$declare n int; begin update sensor_delivery_queue set state='pending',attempts=0,next_attempt_at=now(),last_error=null where state='failed'; get diagnostics n=row_count; return n; end$$;
create function invoke_delivery_worker() returns void language plpgsql security definer set search_path=public,extensions as $$declare base text; secret text; begin
select decrypted_secret into base from vault.decrypted_secrets where name='treequest_functions_url' limit 1;
select decrypted_secret into secret from vault.decrypted_secrets where name='treequest_worker_secret' limit 1;
if base is null or secret is null then raise warning 'TreeQuest worker secrets not configured'; return; end if;
perform net.http_post(url:=base||'/api/delivery-worker',headers:=jsonb_build_object('Content-Type','application/json','X-Worker-Secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
end$$;
select cron.schedule('treequest-stale-sensors','* * * * *','select public.expire_sensor_state()');
select cron.schedule('treequest-sensor-delivery','* * * * *','select public.invoke_delivery_worker()');
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
