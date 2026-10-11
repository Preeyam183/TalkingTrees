-- Optional backend-only transport for Tiger certificates unsupported by Deno.
-- The setup script creates the private server and user mapping first.
CREATE FOREIGN TABLE IF NOT EXISTS tiger_private.sensor_history (
 reading_id uuid, tree_id uuid, device_id uuid, recorded_at timestamptz,
 soil_moisture_pct double precision, temperature_c double precision,
 received_at timestamptz
) SERVER treequest_tiger OPTIONS (schema_name 'public', table_name 'sensor_history');

CREATE OR REPLACE FUNCTION public.tiger_insert_reading(p_reading jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO tiger_private.sensor_history
 (reading_id,tree_id,device_id,recorded_at,soil_moisture_pct,temperature_c,received_at)
 VALUES ((p_reading->>'id')::uuid,(p_reading->>'tree_id')::uuid,
 (p_reading->>'device_id')::uuid,(p_reading->>'recorded_at')::timestamptz,
 (p_reading->>'soil_moisture_pct')::double precision,
 (p_reading->>'temperature_c')::double precision,now())
 ON CONFLICT DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION public.tiger_read_history(p_ids uuid[],p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM (
  SELECT tree_id,recorded_at,soil_moisture_pct,temperature_c
  FROM tiger_private.sensor_history
  WHERE tree_id=ANY(p_ids) AND recorded_at>=p_from AND recorded_at<=p_to
  ORDER BY recorded_at LIMIT 100001
 ) r;
$$;
REVOKE ALL ON SCHEMA tiger_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tiger_insert_reading(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tiger_read_history(uuid[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tiger_insert_reading(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tiger_read_history(uuid[],timestamptz,timestamptz) TO service_role;
