create function rename_tree(p_player uuid, p_tree uuid, p_name text) returns jsonb language plpgsql set search_path=public,extensions as $$
declare
  current_owner uuid;
  clean_name text := btrim(p_name);
begin
  if clean_name is null or length(clean_name) < 1 or length(clean_name) > 80 then
    raise exception 'invalid_tree_name';
  end if;
  select owner_id into current_owner from trees where id=p_tree for update;
  if not found then raise exception 'tree_not_found'; end if;
  if current_owner is distinct from p_player then raise exception 'tree_owner_required'; end if;
  update trees set name=clean_name, updated_at=now() where id=p_tree;
  return jsonb_build_object('id',p_tree,'name',clean_name);
end$$;
revoke execute on function rename_tree(uuid,uuid,text) from public,anon,authenticated;
grant execute on function rename_tree(uuid,uuid,text) to service_role;
