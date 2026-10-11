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

### CLI setup for a development service

With Tiger CLI installed and signed in, use an existing service ID, or create a free shared development service:

```sh
tiger auth status
tiger service create --name treequest-history --cpu shared --environment DEV
tiger service list
npm run tiger:setup -- YOUR_SERVICE_ID
```

The setup script applies `tiger/setup.sql`, creates `treequest_runtime` with schema USAGE and history SELECT/INSERT permissions, and saves its URL only in ignored `supabase/.env.local`. The administrator password stays in the CLI keyring; credentials are never printed. Rerunning setup reuses the saved runtime credential without resetting its password.

Free Tiger services can present certificates rejected by Supabase's Deno runtime (`CaUsedAsEndEntity`). For the local stack, install the optional PostgreSQL foreign-data transport:

```sh
npm run tiger:setup -- YOUR_SERVICE_ID --local-fdw
npm run backend
```

This uses the fixed local database at `127.0.0.1:54322`, installs `tiger/supabase-fdw.sql`, and writes `TIGER_TRANSPORT=fdw` to the backend environment. PostgreSQL connects to Tiger with `sslmode=require` (encrypted transport, without full certificate identity verification, matching the existing direct client's require mode). Runtime credentials reside in a PostgreSQL user mapping accessible to database administrators. The foreign table is in a private schema; only `service_role` can execute the insertion/history RPCs. The Edge API still authorizes tree IDs, manages queue leases, and reports freshness. `TIGER_TRANSPORT=direct` uses the original Edge PostgreSQL client. For production, configure a CA-signed certificate and full certificate verification; do not disable TLS to work around this error. Hosted FDW installation requires an explicit administrator setup and is not performed by the local installer.

To keep simulated hardware/game controls while storing history in real Tiger, retain `APP_MODE=demo` and set `HISTORY_MODE=tiger` in `supabase/.env.local`, then restart `npm run backend`. Both delivery and analytics use Tiger, and responses report `source: "tiger"`; outages never fall back to simulated history. The underlying demo readings remain fictional. `HISTORY_MODE=auto` preserves the original behavior: simulated history in demo, real Tiger in connected mode. The root `.env` is not loaded by `npm run backend`.

When switching an existing local demo from simulated delivery to a new empty Tiger database, requeue its previous simulated acknowledgements once, after restarting the backend in Tiger history mode. Run against the **local demo database only**:

```sql
update sensor_delivery_queue
set state='pending', delivered_at=null, attempts=0, next_attempt_at=now(),
    lease_until=null, lease_token=null, last_error=null;
select public.invoke_delivery_worker();
```

The worker drains batches of 100; Cron continues every minute. Pending counts remain visible until actual Tiger insertion succeeds. Repeated insertion is safe because the history primary key rejects duplicates. Demo resets restore simulated seed acknowledgements, so repeat this requeue after a reset when using real Tiger history. Do not run destructive integration/reset suites against this configured demo unless you intend to reseed it.

Run `tiger/setup.sql` against the team-provided Tiger Data database. Provide the backend a TLS-enabled connection string with SELECT and INSERT access to `sensor_history`. Supabase remains the scoring/ownership source of truth and retains accepted readings plus the delivery outbox.

```sh
psql "$TIGER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tiger/setup.sql
```

`/tree-insights` accepts `{ "question": "How are my trees doing this week?", "timezone": "America/New_York" }` with a player JWT. It authorizes currently owned trees before resolving names/IDs. Supported intents are overview, priority, trends, response, comparison. Gemini may select a concise subset of exact backend-generated factual sentences; the server rejects invented or rewritten claims. All per-tree statistics remain visible. Relative weeks begin Monday; comparisons use the same elapsed local interval in the preceding week, rather than a partial current week versus a full prior week. Maximum requested window is 90 days and historical results are capped at 100,000 rows; a larger result asks for a narrower range instead of silently truncating statistics.

Averages weight daily readings equally and then trees equally. Missing days remain missing. Watering response uses the most recent verified event in the requested period and 30-minute before/after windows; at least two readings on each side are required for a comparison. The interface labels current Supabase state separately from historical data.

Responses include `queried_at`, `period`, optional `comparison_period`, `source`, `tree_ids`, `statistics`, `portfolio`, `freshness`, `delivery`, `complete`, and `warnings`. `latest_tiger_in_period` is the latest returned timestamp **within the analyzed period**, not a guarantee that the device has nothing newer. `latest_supabase` is the latest accepted current reading. Outstanding delivery counts only cover authorized trees and the analyzed/comparison windows. A pending/failed record is excluded from Tiger statistics until it is actually delivered.

## Provider keys and behavior

- `GEMINI_API_KEY`, optional `GEMINI_MODEL`: identification, structured analytics planning, dialogue, and summary wording. Missing/error responses use deterministic text; photo identification remains unidentified in connected mode.
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_MODEL`: speech replies return authenticated, ephemeral MP3 data to the requesting client, avoiding public storage dependencies. Native clients cache one current reply and remove it on unmount. Text works when voice is unavailable.
- `ELEVENLABS_STT_MODEL` defaults to `scribe_v2`. The key needs Text to Speech and Speech to Text permissions; selecting voices through the setup check also needs Read Voices.
- `ELEVENLABS_TREE_VOICE_<TREE_UUID_WITH_UNDERSCORES>` gives a specific tree a stable voice. Example variable name: `ELEVENLABS_TREE_VOICE_b7000000_0000_4000_8000_000000000001`. A comma-separated `ELEVENLABS_VOICE_IDS` pool is selected deterministically by tree ID. Priority is tree override, voice pool, personality override, then `ELEVENLABS_VOICE_ID`.
- Personality overrides are `ELEVENLABS_VOICE_ID_WARM`, `_WATCHFUL`, `_WATERLOGGED`, `_QUIET`, and `_SOLEMN`. Moisture-dependent speech speed/expression does not change the selected per-tree voice. `connected:setup` imports these backend-only variables from root `.env`.
- `TIGER_DATABASE_URL`: connected historical persistence/querying.
- `APP_MODE=connected`: required for live integrations. Demo additionally requires database `demo_mode=true` and a development client build to expose simulator controls.

Supabase service-role credentials are injected into hosted Edge Functions and must never be copied into Vite or Expo settings. Client keys are publishable keys only. Client locations verify proximity but are not anti-spoofing proof; this MVP relies on authenticated hardware evidence for completion.

## Personality generation

Shared deterministic mapping/validation lives in `packages/shared/src/personality.ts`;
`supabase/functions/_shared/personality.ts` obtains trusted backend state and device/species
configuration. Both apps consume the same backend dialogue; no client decides care rules.
See [hardware calibration](HARDWARE.md#sensor-to-personality-pipeline) for provisioning.

The default selected model remains `gemini-2.5-flash`. Its documented structured-output
support is used with a JSON schema for mood, tone and a 1–240 character first-person
message. The existing fixed sampling temperature `0.1` is independent of measurements;
no sensor value controls generation settings. See Google's
[model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash) and
[GenerationConfig reference](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig).
Review model support before overriding `GEMINI_MODEL`.

The October 11 hosted configuration uses `gemini-3.1-flash-lite`, verified within the provider timeout. Tree chat uses a separate structured schema `{message, fact_ids}`: casual replies of up to 1000 characters with references to server-authored database facts. New numeric claims and invalid references are rejected; the clients expose original facts in a separate panel. Traits and a stable character style differentiate trees. A species `dialogue_care_profile.highMoisturePct` can mark a fresh reading as wet for conversation; this does not create a watering request or change game eligibility. Missing/stale measurements remain uncertain.

The server rejects malformed/extra fields, wrong moods, empty/oversized messages,
missing first-person wording and missing uncertainty wording when measurements are
unknown. It uses deterministic templates on rejection, missing credentials, provider
errors, or demo mode. These checks validate structure and key constraints, not every
possible natural-language claim; generated text never feeds game-state mutations.
`APP_MODE=demo` keeps Gemini simulated/template-based even with real Tiger history.
