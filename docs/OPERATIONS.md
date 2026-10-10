# Background processing and integration operations

## Scheduled jobs

Migration `202610100003_workers.sql` installs two `pg_cron` jobs, each running once per minute:

- `treequest-stale-sensors` calls `expire_sensor_state()`. It marks stale trees unknown, cancels active requests and sessions, invalidates dialogue, and expires timed-out sessions. Mutations independently check freshness; scheduler latency never grants a watering reward.
- `treequest-sensor-delivery` calls `invoke_delivery_worker()`, which invokes `/functions/v1/api/delivery-worker` via `pg_net` with a private worker secret fetched from Vault.

`npm run demo:setup` installs local Vault values. Hosted setup must explicitly configure them:

```sql
select vault.create_secret('https://PROJECT.supabase.co/functions/v1', 'treequest_functions_url');
select vault.create_secret('THE_SAME_SECRET_AS_THE_EDGE_ENV', 'treequest_worker_secret');
```

For rotation use `vault.update_secret(id, new_secret)` for the corresponding secret ID, then update the Edge Function's `WORKER_SECRET`. Do not print `vault.decrypted_secrets` into logs.

The delivery worker claims up to 100 items through `claim_deliveries()`, using `FOR UPDATE SKIP LOCKED`, a two-minute lease, and a random lease token. Each row is inserted into Tiger Data idempotently by `(reading_id, recorded_at)`. A successful acknowledgement only applies if its lease token is still current. A process crash after Tiger insertion is safe to retry.

Failures back off exponentially from ten seconds to one hour. After twelve unsuccessful claims a row is marked `failed`, retained, and shown in analytics freshness. Expired leases can be reclaimed. Because a batch can outlive its lease under a slow network, duplicate attempts remain safe; they cannot cause duplicate historical rows or stale acknowledgements.

Demo delivery marks queued Supabase history delivered through the simulated provider. It makes no Tiger Data connection. Connected mode requires `TIGER_DATABASE_URL`; missing credentials produce retries and visible unavailable analytics, never simulated success.

## Inspect, run, and replay

Run these through an administrator SQL connection:

```sql
select jobname, schedule, active from cron.job where jobname like 'treequest-%';
select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
select state, count(*), min(created_at) as oldest from sensor_delivery_queue group by state;
select id, attempts, next_attempt_at, last_error from sensor_delivery_queue where state='failed';
select public.expire_sensor_state();
select public.invoke_delivery_worker();
select public.replay_deliveries(); -- explicitly retry preserved failed rows after fixing the service
```

Cron success for the delivery invoker only confirms HTTP dispatch. Inspect `net._http_response` and Edge Function logs for HTTP failures, and delivery queue states for actual ingestion success. Never expose the worker endpoint secret to clients.

Manual HTTP invocation:

```sh
curl --fail-with-body "$FUNCTIONS_URL/delivery-worker" \
  -H 'Content-Type: application/json' \
  -H "X-Worker-Secret: $WORKER_SECRET" -d '{}'
```

## Tiger Data setup

Run `tiger/setup.sql` against the team-provided Tiger Data database. Provide the backend a TLS-enabled connection string with SELECT and INSERT access to `sensor_history`. Supabase remains the scoring/ownership source of truth and retains accepted readings plus the delivery outbox.

```sh
psql "$TIGER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tiger/setup.sql
```

`/tree-insights` accepts `{ "question": "How are my trees doing this week?", "timezone": "America/New_York" }` with a player JWT. It authorizes currently owned trees before resolving names/IDs. Supported intents are overview, priority, trends, response, comparison. Gemini may select a concise subset of exact backend-generated factual sentences; the server rejects invented or rewritten claims. All per-tree statistics remain visible. Relative weeks begin Monday; comparisons use the same elapsed local interval in the preceding week, rather than a partial current week versus a full prior week. Maximum requested window is 90 days and historical results are capped at 100,000 rows; a larger result asks for a narrower range instead of silently truncating statistics.

Averages weight daily readings equally and then trees equally. Missing days remain missing. Watering response uses the most recent verified event in the requested period and 30-minute before/after windows; at least two readings on each side are required for a comparison. The interface labels current Supabase state separately from historical data.

Responses include `queried_at`, `period`, optional `comparison_period`, `source`, `tree_ids`, `statistics`, `portfolio`, `freshness`, `delivery`, `complete`, and `warnings`. `latest_tiger_in_period` is the latest returned timestamp **within the analyzed period**, not a guarantee that the device has nothing newer. `latest_supabase` is the latest accepted current reading. Outstanding delivery counts only cover authorized trees and the analyzed/comparison windows. A pending/failed record is excluded from Tiger statistics until it is actually delivered.

## Provider keys and behavior

- `GEMINI_API_KEY`, optional `GEMINI_MODEL`: identification, structured analytics planning, dialogue, and summary wording. Missing/error responses use deterministic text; photo identification remains unidentified in connected mode.
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_MODEL`: generated voice stored in `tree-audio`. Text works when voice is unavailable.
- `TIGER_DATABASE_URL`: connected historical persistence/querying.
- `APP_MODE=connected`: required for live integrations. Demo additionally requires database `demo_mode=true` and a development client build to expose simulator controls.

Supabase service-role credentials are injected into hosted Edge Functions and must never be copied into Vite or Expo settings. Client keys are publishable keys only. Client locations verify proximity but are not anti-spoofing proof; this MVP relies on authenticated hardware evidence for completion.
