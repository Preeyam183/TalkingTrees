-- Local demo only. Never seed this file into a production project.
update game_config set demo_mode=true;
do $$declare i int; pid uuid; tid uuid; did uuid; territory uuid; sp uuid; m numeric; begin
for i in 1..3 loop
pid:=('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change) values(pid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','player'||i||'@treequest.local',extensions.crypt('TreeQuest-demo-2026',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('display_name',(array['Alex Fern','Maya Moss','Sam Cedar'])[i]),now(),now(),'','','','');
insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values(pid,pid,pid::text,jsonb_build_object('sub',pid::text,'email','player'||i||'@treequest.local'),'email',now(),now(),now());
update profiles set color=(array['#33886c','#b67ae0','#df9b3d'])[i] where id=pid;
end loop;
insert into species(id,name,description,thirst_pct,recovery_pct) values
('20000000-0000-4000-8000-000000000001','Red maple','A broad-canopied deciduous neighbor. Care thresholds are illustrative.',30,45),
('20000000-0000-4000-8000-000000000002','White oak','A long-lived oak. Care thresholds are illustrative.',28,43),
('20000000-0000-4000-8000-000000000003','River birch','A birch with distinctive peeling bark. Care thresholds are illustrative.',32,48);
insert into territories(id,name,boundary) values
('30000000-0000-4000-8000-000000000001','Fernwood Grove',extensions.st_geomfromtext('POLYGON((-73.973 40.770,-73.966 40.770,-73.966 40.775,-73.973 40.775,-73.973 40.770))',4326)),
('30000000-0000-4000-8000-000000000002','Cedar Commons',extensions.st_geomfromtext('POLYGON((-73.965 40.770,-73.958 40.770,-73.958 40.775,-73.965 40.775,-73.965 40.770))',4326));
for i in 1..20 loop
 tid:=('40000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
 did:=('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
 territory:=case when i<=10 then '30000000-0000-4000-8000-000000000001'::uuid else '30000000-0000-4000-8000-000000000002'::uuid end;
 sp:=('20000000-0000-4000-8000-'||lpad(((i-1)%3+1)::text,12,'0'))::uuid;
 m:=case when i in (3,8,9,12,15) then 22 else 55 end;
 insert into trees(id,name,species_id,territory_id,location,owner_id,status,moisture,temperature,reading_at) values(tid,(array['Maple','Oak','Birch'])[(i-1)%3+1]||' '||i,sp,territory,extensions.st_setsrid(extensions.st_makepoint(-73.972+((i-1)%5)*.0012+case when i>10 then .008 else 0 end,40.771+(((i-1)%10)/5)*.002),4326)::extensions.geography,case when i<=7 then '10000000-0000-4000-8000-000000000001'::uuid when i in (9,10,19,20) then null else ('10000000-0000-4000-8000-'||lpad((2+i%2)::text,12,'0'))::uuid end,case when i in (10,20) then 'unknown' when m=22 then 'thirsty' else 'healthy' end,case when i in (10,20) then null else m end,case when i in (10,20) then null else 21 end,case when i in (10,20) then null else now() end);
 insert into devices(id,tree_id,key_hash,can_report_health) values(did,tid,encode(extensions.digest('demo-device-key-'||i,'sha256'),'hex'),true);
 if m=22 then insert into watering_requests(tree_id) values(tid); end if;
end loop;
end$$;
-- Three weeks of reproducible relative history. Unknown trees have deliberate gaps.
insert into sensor_readings(device_id,tree_id,external_event_id,recorded_at,soil_moisture_pct,temperature_c,payload,result)
select d.id,d.tree_id,'seed-'||g::text,date_trunc('hour',now())-make_interval(hours=>g),greatest(10,least(85,coalesce(t.moisture,40)+g*.015+((g%7)-3))),18+(g%9),jsonb_build_object('simulated',true),'{"status":"seeded"}'::jsonb from devices d join trees t on t.id=d.tree_id cross join generate_series(1,504,6) g where not(t.status='unknown' and g<72);
insert into sensor_readings(device_id,tree_id,external_event_id,recorded_at,soil_moisture_pct,temperature_c,payload,result)
select d.id,t.id,'seed-current',t.reading_at,t.moisture,t.temperature,'{"simulated":true}'::jsonb,'{"status":"seeded"}'::jsonb from trees t join devices d on d.tree_id=t.id where t.reading_at is not null;
insert into sensor_delivery_queue(reading_id,state,delivered_at) select id,'delivered',now() from sensor_readings;
