-- Explicit relocation requested by the team. Preserve tree/device IDs and evidence.
begin;
update public.territories set name='Rutgers · New Brunswick',
boundary=extensions.st_geomfromtext('POLYGON((-74.457 40.490,-74.437 40.490,-74.437 40.510,-74.457 40.510,-74.457 40.490))',4326)
where id='3b744fff-b84f-4295-b2f2-46600beedea6';
update public.trees t set location=extensions.st_setsrid(extensions.st_makepoint(v.lng,v.lat),4326)::extensions.geography,updated_at=now()
from (values
('82db094d-ab97-4290-a648-0d7a5228f996'::uuid,40.49875,-74.44625),
('b7000000-0000-4000-8000-000000000001'::uuid,40.49883,-74.44613),
('b7000000-0000-4000-8000-000000000002'::uuid,40.49887,-74.44637),
('b7000000-0000-4000-8000-000000000003'::uuid,40.49864,-74.44621)) v(id,lat,lng)
where t.id=v.id;
commit;
select id,name,lat,lng from public.tree_map;
