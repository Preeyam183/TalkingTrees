create or replace function recalculate_territory(p_id uuid) returns void language plpgsql set search_path=public as $$
declare
  winner uuid;
begin
  perform 1 from territories where id=p_id for update;
  with counts as (
    select owner_id, count(*)::int as tree_count
    from trees
    where territory_id=p_id
      and status not in ('dead','inactive')
      and owner_id is not null
    group by owner_id
  ), ranked as (
    select owner_id, tree_count,
      rank() over (order by tree_count desc) as position,
      count(*) over (partition by tree_count) as tied
    from counts
  )
  select case when count(*)=1 then (array_agg(owner_id))[1] else null end
    into winner
    from ranked
    where position=1;
  update territories
    set owner_id=winner
    where id=p_id and owner_id is distinct from winner;
end$$;

create or replace view territory_map with (security_invoker=true) as
select
  territory.id,
  territory.name,
  territory.owner_id,
  extensions.st_asgeojson(territory.boundary)::jsonb geojson,
  count(tree.id) filter (where tree.status not in ('dead','inactive'))::int tree_count,
  coalesce(leader.leader_tree_count, 0)::int leader_tree_count,
  leader.leader_id,
  coalesce(leader.leader_tree_ids, '{}'::uuid[]) leader_tree_ids,
  case
    when count(tree.id) filter (where tree.status not in ('dead','inactive')) = 0 then 0
    else round(
      coalesce(leader.leader_tree_count, 0)::numeric /
      count(tree.id) filter (where tree.status not in ('dead','inactive')), 4
    )
  end leader_share
from territories territory
left join trees tree on tree.territory_id=territory.id
left join lateral (
  with counts as (
    select owner_id, count(*)::int as tree_count,
      array_agg(id order by id) as tree_ids
    from trees
    where territory_id=territory.id
      and status not in ('dead','inactive')
      and owner_id is not null
    group by owner_id
  ), ranked as (
    select owner_id as leader_id, tree_count as leader_tree_count,
      tree_ids as leader_tree_ids,
      rank() over (order by tree_count desc) as position,
      count(*) over (partition by tree_count) as tied
    from counts
  )
  select leader_id, leader_tree_count, leader_tree_ids
  from ranked
  where position=1 and tied=1
) leader on true
group by territory.id, territory.name, territory.owner_id, territory.boundary,
  leader.leader_id, leader.leader_tree_count, leader.leader_tree_ids;

select recalculate_territory(id) from territories;
