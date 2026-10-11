-- Caretaker-controlled presentation settings; game state/points ledger stays authoritative.
alter table public.trees add column voice_id text check(voice_id is null or voice_id ~ '^[A-Za-z0-9_-]{1,100}$');
create or replace view public.tree_map with (security_invoker=true) as
select t.id,t.name,t.species_id,t.territory_id,t.photo_path,t.owner_id,t.status,t.moisture,t.temperature,t.reading_at,t.updated_at,
 extensions.st_y(t.location::extensions.geometry) lat,extensions.st_x(t.location::extensions.geometry) lng,
 s.name species_name,s.thirst_pct,s.recovery_pct,r.id request_id,t.voice_id
from public.trees t left join public.species s on s.id=t.species_id
left join public.watering_requests r on r.tree_id=t.id and r.status='active';
create function public.update_tree_settings(p_player uuid,p_tree uuid,p_name text,p_voice text) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare current_owner uuid; clean_name text := btrim(p_name);
begin
 if clean_name is null or length(clean_name) not between 1 and 80 then raise exception 'invalid_tree_name'; end if;
 if p_voice is not null and p_voice !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'invalid_voice'; end if;
 select owner_id into current_owner from trees where id=p_tree for update;
 if not found then raise exception 'tree_not_found'; end if;
 if p_player is null or current_owner is distinct from p_player then raise exception 'tree_owner_required'; end if;
 update trees set name=clean_name,voice_id=p_voice,updated_at=now() where id=p_tree;
 return jsonb_build_object('id',p_tree,'name',clean_name,'voice_id',p_voice);
end $$;
revoke execute on function public.update_tree_settings(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_tree_settings(uuid,uuid,text,text) to service_role;

-- Explicit administrator-authored presentation totals. Never fabricated hardware evidence.
create table public.presentation_scores (
 player_id uuid primary key references public.profiles(id) on delete cascade,
 care_points integer not null default 0 check(care_points between 0 and 1000000),
 territories_controlled integer not null default 0 check(territories_controlled between 0 and 10000),
 source text not null default 'manual_presentation' check(source='manual_presentation'),
 updated_at timestamptz not null default now()
);
alter table public.presentation_scores enable row level security;
create policy presentation_scores_read on public.presentation_scores for select to anon,authenticated using(true);
revoke all on public.presentation_scores from public,anon,authenticated;
grant select on public.presentation_scores to anon,authenticated;
grant all on public.presentation_scores to service_role;
create or replace view public.leaderboard with (security_invoker=true) as
select p.id,p.display_name,p.color,
 (coalesce((select sum(e.amount) from public.point_events e where e.player_id=p.id),0)+coalesce(s.care_points,0))::int points,
 (select count(*) from public.trees t where t.owner_id=p.id)::int owned_trees,
 ((select count(*) from public.territories t where t.owner_id=p.id)+coalesce(s.territories_controlled,0))::int territories_controlled,
 coalesce((select sum(e.amount) from public.point_events e where e.player_id=p.id),0)::int verified_points,
 coalesce(s.care_points,0)::int presentation_points
from public.profiles p left join public.presentation_scores s on s.player_id=p.id;
grant select on public.tree_map,public.leaderboard to anon,authenticated;
