-- Safe on local or connected databases: isolated records, always rolled back.
begin;
do $$
declare p uuid; region uuid; sp uuid := gen_random_uuid(); t uuid := gen_random_uuid();
 d uuid := gen_random_uuid(); req uuid := gen_random_uuid(); sess uuid := gen_random_uuid();
 reading uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); result jsonb; n integer;
begin
 if (calculate_care_score(16,45,30,45,10)->>'points')::int <> 15 then raise exception 'normal recovery score'; end if;
 if (calculate_care_score(5,45,30,45,10)->>'points')::int <> 18 then raise exception 'urgent recovery score'; end if;
 if (calculate_care_score(28,45,30,45,10)->>'points')::int <> 12 then raise exception 'mild recovery score'; end if;
 if (calculate_care_score(16,48,30,45,10)->>'points')::int <> 13 then raise exception 'overshoot score'; end if;
 if (calculate_care_score(16,100,30,45,10)->>'points')::int <> 0 then raise exception 'saturation score'; end if;
 if (calculate_care_score(16,44,30,45,10)->>'points')::int <> 0 then raise exception 'incomplete recovery'; end if;
 if (calculate_care_score(null,45,30,45,10)->>'points')::int <> 0 then raise exception 'missing input'; end if;
 if (calculate_care_score('NaN',45,30,45,10)->>'points')::int <> 0 then raise exception 'invalid input'; end if;
 if (calculate_care_score(0,100,30,100,10)->>'points')::int <> 20 then raise exception 'target 100 bound'; end if;
 if has_function_privilege('authenticated','public.calculate_care_score(numeric,numeric,numeric,numeric,integer)','EXECUTE') then raise exception 'client scoring privilege'; end if;
 select id into p from profiles limit 1;
 select id into region from territories limit 1;
 if p is null or region is null then raise exception 'requires one existing player and territory'; end if;
 insert into species(id,name,thirst_pct,recovery_pct) values(sp,'Scoring test '||sp,30,45);
 insert into trees(id,name,species_id,territory_id,location,status,moisture,reading_at)
 values(t,'Scoring test',sp,region,extensions.st_geogfromtext('POINT(-74.446 40.499)'),'thirsty',45,now());
 insert into devices(id,tree_id,key_hash) values(d,t,'isolated-test');
 insert into watering_requests(id,tree_id) values(req,t);
 insert into watering_sessions(id,player_id,tree_id,request_id,location,baseline_pct,expires_at,idempotency_key)
 values(sess,p,t,req,extensions.st_geogfromtext('POINT(-74.446 40.499)'),16,now()+interval '5 minutes',gen_random_uuid());
 insert into sensor_readings(id,device_id,tree_id,external_event_id,recorded_at,soil_moisture_pct,temperature_c,payload)
 values(reading,d,t,'score-test',now(),45,22,'{}');
 insert into watering_events(id,device_id,tree_id,session_id,request_id,external_event_id,sensor_reading_id,evidence_type,recorded_at,verified,payload)
 values(ev,d,t,sess,req,'score-test',reading,'moisture_increase',now(),true,'{}');
 result := evaluate_tree(t);
 if not (result->>'completed')::boolean or (result->>'points')::int <> 15 then raise exception 'transaction result %',result; end if;
 if not exists(select 1 from point_events where watering_event_id=ev and amount=15 and calculation->>'version'='care-v2') then raise exception 'missing ledger breakdown'; end if;
 if not exists(select 1 from trees where id=t and owner_id=p) then raise exception 'ownership not awarded'; end if;
 perform evaluate_tree(t);
 select count(*) into n from point_events where tree_id=t;
 if n <> 1 then raise exception 'duplicate award'; end if;
 -- A later request without verified evidence still earns nothing.
 update trees set moisture=20,status='thirsty' where id=t;
 perform evaluate_tree(t);
 update trees set moisture=45 where id=t;
 perform evaluate_tree(t);
 select count(*) into n from point_events where tree_id=t;
 if n <> 1 then raise exception 'unverified award'; end if;
end$$;
select 'care scoring formula, authorization, transaction, and replay checks passed' as result;
rollback;
