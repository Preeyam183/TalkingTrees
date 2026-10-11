-- New awards only: the ledger and all previous amounts remain unchanged.
alter table public.point_events add column calculation jsonb;

create function public.calculate_care_score(
 p_baseline numeric, p_final numeric, p_thirst numeric, p_target numeric, p_base integer
) returns jsonb language plpgsql immutable security invoker set search_path=public as $$
declare need numeric; gain numeric; excess numeric; award integer;
begin
 if p_baseline is null or p_final is null or p_thirst is null or p_target is null or p_base is null
 or not (p_baseline between 0 and 100 and p_final between 0 and 100)
 or not (p_thirst > 0 and p_thirst < p_target and p_target <= 100)
 or p_base < 1 or p_base > 1000000 or p_baseline >= p_target or p_final < p_target then
  return jsonb_build_object('version','care-v2','points',0,'eligible',false);
 end if;
 need := greatest(0,least(1,(p_thirst-p_baseline)/p_thirst));
 gain := greatest(0,least(1,(least(p_final,p_target)-p_baseline)/100));
 excess := case when p_target=100 then 0 else greatest(0,least(1,(p_final-p_target)/(100-p_target))) end;
 award := greatest(0,least(2*p_base,round(p_base*(1+0.6*need+0.4*sqrt(gain))*power(1-excess,2))::int));
 return jsonb_build_object('version','care-v2','points',award,'eligible',true,
  'base',p_base,'baseline_pct',p_baseline,'final_pct',p_final,'thirst_pct',p_thirst,'recovery_pct',p_target,
  'need',need,'useful_gain',gain,'overshoot',excess);
end$$;
revoke all on function public.calculate_care_score(numeric,numeric,numeric,numeric,integer) from public,anon,authenticated;
grant execute on function public.calculate_care_score(numeric,numeric,numeric,numeric,integer) to service_role;

create or replace function evaluate_tree(p_tree uuid) returns jsonb language plpgsql set search_path=public,extensions as $$
declare t trees; sp species; cfg game_config; req watering_requests; ev watering_events; sess watering_sessions; score jsonb; award integer := 0; begin
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
 score := calculate_care_score(sess.baseline_pct,t.moisture,sp.thirst_pct,sp.recovery_pct,cfg.care_points);
 award := (score->>'points')::int;
 insert into point_events(player_id,tree_id,amount,watering_event_id,calculation) values(sess.player_id,p_tree,award,ev.id,score);
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
return jsonb_build_object('status',(select status from trees where id=p_tree),'completed',ev.id is not null,'points',award);
end$$;
