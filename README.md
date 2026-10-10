# TreeQuest

A tree-care territory game: inspect a real tree, start a nearby care session, and capture it only after authenticated hardware evidence **and** sensor recovery. Partial watering earns nothing. Supabase owns game state; Tiger Data stores delivered historical readings for Ask My Trees.

## Local demo — no external credentials

Requirements: Node 22.12+ (verified with Node 24), npm, and Docker Desktop running. The first Supabase startup downloads Docker images. Existing root `.env` values are preserved and are not used by the Vite/Expo clients.

```sh
npm ci
npx supabase start
npm run demo:setup
```

Start these in separate terminals:

```sh
npm run backend
```

```sh
npm run dev
```

Open http://localhost:5173. Supabase Studio is http://localhost:54323. `demo:setup` creates ignored local environment files from the local stack and installs private Vault settings for the scheduled delivery worker. It preserves existing values; when switching an already-configured checkout between connected and local mode, edit the relevant local environment files explicitly.

Choose **Play as Alex**. All demo users use password `TreeQuest-demo-2026` with emails `player1@treequest.local` through `player3@treequest.local`.

### Demonstration walkthrough

1. Alex starts with two of four trees in Fernwood Grove. Select **Birch 3**, the thirsty tree cared for by another player.
2. Expand **Developer simulator**. If the demo has been idle, click **Make thirsty / refresh** for a fresh baseline.
3. Leave the visibly labeled simulated location enabled; click **Start a care session**.
4. Click **Partial watering**. Moisture changes but no points or ownership are awarded.
5. Click **Verified recovery**. Alex receives 10 points, takes ownership of the thirsty tree, and leads Fernwood Grove with three of four trees.
6. Open the page in another tab to observe realtime updates. **Ask my trees** shows historical statistics, analyzed dates, latest readings, and outstanding deliveries.
7. **Deliver history now** invokes the same local demo delivery worker that runs every minute. Analytics excludes pending deliveries until they have been delivered.
8. Try **Confirm death**, healthy-tree watering rejection, photo registration, or another player (sign out, then select a demo player).

Demo trees/players/history are fictional. Identification is a labeled fixture; voice uses labeled device speech. No live Gemini, ElevenLabs, Tiger Data, or physical hardware is implied. The simulator is excluded from production web builds and guarded by both server `APP_MODE=demo` and database `demo_mode=true`.

The simulator's **Reset game state** restores seeded ownership/status, clears demo game events and runtime readings, removes added tree records, and restores seeded history delivery. A full reseed, including relative history timestamps and uploaded local assets, uses:

```sh
npm run demo:reset
```

This resets **only the local project database**. Re-run `npm run backend` if the local stack restart disconnects its serving process. Do not use demo reset commands against a hosted environment.

## Expo mobile

```sh
npm run mobile
```

Use an Expo SDK 57-compatible development client or Expo Go build. Press `i` for an installed iOS simulator, `a` for an Android emulator, or scan the QR code on a physical device. For a phone, set `EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env.local` to `http://YOUR_COMPUTER_LAN_IP:54321`; keep phone and computer on the same network. Android emulators generally use `http://10.0.2.2:54321`. Restart Metro after environment changes.

Start mobile from the repository root with `npm run mobile -- --lan --clear`, then open the newly displayed QR code. This explicitly selects `apps/mobile` so Expo loads its app configuration and environment. The root package also declares the mobile entrypoint, and a root `App.tsx` forwards older Expo Go entry URLs to the same app. Recheck the mobile Supabase URL whenever your computer changes networks.

The native app includes maps, player authentication, tree details, camera/library registration, GPS proximity, verified watering, leaderboard, dialogue/audio, and Ask My Trees. Development demo builds explicitly simulate location and hardware in the tree panel. Permission denial produces an actionable error. Native maps in standalone Android builds require your own Google Maps SDK configuration; the browser demo uses OpenStreetMap tiles without an API key.

```sh
cd apps/mobile
npx expo install --check
npx expo export --platform ios --platform android --output-dir /tmp/treequest-expo
```

Bundle export verifies native module resolution but is not a physical-device camera/GPS/audio test.

## Connected setup

1. Create a Supabase project. Configure authentication as desired and set the client's public URL/key in the relevant `.env.local` files using the checked-in `.env.example` files. Use `connected` mode in both clients.
2. Link and apply migrations **without demo seeds**:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

3. Create real species care profiles and territory polygons using an administrator connection; the demo seed must not be loaded into the connected project. Registered trees begin unknown and unowned. Assign their hardware device securely as described in [the hardware contract](docs/HARDWARE.md).
4. Copy `supabase/.env.example` to an ignored file, fill in backend credentials, and keep `APP_MODE=connected`. Install Tiger Data's schema:

   ```sh
   psql "$TIGER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tiger/setup.sql
   npx supabase secrets set --env-file supabase/.env.connected
   npx supabase functions deploy
   ```

5. Configure the two worker Vault secrets using [operations instructions](docs/OPERATIONS.md). Keep database `game_config.demo_mode=false`. Check scheduled jobs, queue state, and Edge Function logs.
6. Start the web/Expo clients. `npm run build` creates the web production artifact in `apps/web/dist`. Production hosting and app-store publication are not performed by this repository.

Supabase injects service-role credentials into Edge Functions. Never place service-role, Gemini, ElevenLabs, Tiger Data, device, or worker secrets in `VITE_*` or `EXPO_PUBLIC_*` variables. The initial root environment's `NEXT_PUBLIC_*` names are not consumed by these Vite/Expo apps.

## Layout and contracts

- `apps/web`: responsive React/Vite map, tree care, registration, leaderboard, insights, and development-only simulator.
- `apps/mobile`: Expo native application using shared backend contracts.
- `packages/shared`: TypeScript contracts, Zod validation, client operations, timezone handling, and analytics calculations.
- `supabase/migrations`: 12 domain tables plus configuration/outbox, transactional operations, RLS, storage policies, realtime publication, and scheduled jobs.
- `supabase/functions`: named API endpoints and the shared router/provider implementations.
- `tiger/setup.sql`: idempotent historical storage and indexes.

[Hardware contract](docs/HARDWARE.md) documents exact payloads, authentication, session correlation, watering order, idempotency, and calibration. [Operations guide](docs/OPERATIONS.md) covers retry leases, stale-sensor scheduling, queue replay, analytics completeness, and provider configuration.

All game mutations occur in PostgreSQL transactions. Points are an append-only ledger. The current winner must own at least the configured ratio of active registered trees; unknown trees remain eligible in the denominator, confirmed dead/inactive trees do not. Species descriptions and model output never decide watering eligibility.

Defaults are illustrative and configurable, not horticultural guidance. In `game_config`: 10 care points, −20 death points, 80% territory control, 50 m proximity, 300 s sessions, 120 s baseline/evidence freshness, 1800 s stale cutoff, 30 s clock tolerance, and 5 percentage points rise. Species profiles define their own thirst/recovery percentages. Authenticated explicit watering evidence still requires the configured recovery threshold.

## Verification

Run stateful suites sequentially against the disposable local demo, with `npm run backend` running:

```sh
npm run typecheck
npm test
npm run test:integration
npm run db:test
npx playwright install chromium
npm run test:e2e
npm run build
npx deno check --config supabase/functions/deno.json supabase/functions/api/index.ts
```

- Unit tests: schema validation, authorization, unsupported questions, timezone/DST boundaries, daily weighting, and missing data.
- Integration tests: PostgreSQL game rules, partial/recovery semantics, replay/concurrency, death, stale sensors, proximity, leases, RLS, and Edge Function authentication/analytics.
- pgTAP: expected schema/seed, access restrictions, RLS, and installed schedules.
- Playwright: full capture/territory flow, cross-tab realtime, analytics, mobile viewport, and photo-registration fallback.

`npm test` intentionally skips the explicitly opt-in local integration suite; `npm run test:integration` runs it. Tests reset the local demo and should not run concurrently against the same database.

## Integration limits

External-provider credentials and real hardware are supplied by the team. Connected Gemini/ElevenLabs responses, Tiger Data TLS/ingestion, and physical-device proximity/sensor calibration require validation with those credentials/devices. Demo analytics uses only simulated readings marked delivered; connected analytics returns unavailable history when Tiger Data fails.

Map tiles and optional web fonts use external public services; the local demo requires no API credentials but is not a fully offline basemap. Device speech varies by installed voices. The prototype does not implement firmware, anti-spoofing attestation, app-store distribution, or production deployment.

Dependency audit currently reports inherited Expo/React Native toolchain advisories; compatible patches were applied. Avoid using development servers on untrusted networks and review the native SDK dependency chain before production rollout. Do not force unrelated native major upgrades without repeating native verification.
