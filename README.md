# Branch Out

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
5. Click **Verified recovery**. Alex receives 13 points, takes ownership of the thirsty tree, and leads Fernwood Grove with three of four trees.
6. Open the page in another tab to observe realtime updates. **Ask my trees** shows historical statistics, analyzed dates, latest readings, and outstanding deliveries.
7. **Deliver history now** invokes the same local demo delivery worker that runs every minute. Analytics excludes pending deliveries until they have been delivered.
8. Try **Confirm death**, healthy-tree watering rejection, photo registration, or another player (sign out, then select a demo player).

Demo trees/players/history are fictional. Identification is a labeled fixture; voice uses labeled device speech. No live Gemini, ElevenLabs, Tiger Data, or physical hardware is implied. The simulator is excluded from production web builds and guarded by both server `APP_MODE=demo` and database `demo_mode=true`.

The simulator's **Reset game state** restores seeded ownership/status, clears demo game events and runtime readings, removes added tree records, and restores seeded history delivery. A full reseed, including relative history timestamps and uploaded local assets, uses:

```sh
npm run demo:reset
```

This resets **only the local project database**. Re-run `npm run backend` if the local stack restart disconnects its serving process. Do not use demo reset commands against a hosted environment.

Connected provider credentials for local Edge Functions belong in `supabase/.env.local`, because `npm run backend` loads that file. The root `.env` is not loaded by the Edge Function server. See [provider configuration](docs/OPERATIONS.md#provider-keys-and-behavior) for per-tree voices and personality overrides; `ELEVENLABS_VOICE_ID` remains the fallback.

## Expo mobile

```sh
npm run mobile
```

Use an Expo SDK 57-compatible development client or Expo Go build. Press `i` for an installed iOS simulator, `a` for an Android emulator, or scan the QR code on a physical device. For a phone, set `EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env.local` to `http://YOUR_COMPUTER_LAN_IP:54321`; keep phone and computer on the same network. Android emulators generally use `http://10.0.2.2:54321`. Restart Metro after environment changes.

Start mobile from the repository root with `npm run mobile -- --lan --clear`, then open the newly displayed QR code. This explicitly selects `apps/mobile` so Expo loads its app configuration and environment. The root package also declares the mobile entrypoint, and a root `App.tsx` forwards older Expo Go entry URLs to the same app. Recheck the mobile Supabase URL whenever your computer changes networks.

The native app has persistent bottom tabs for **Home**, **Chat**, **Scores**, **Camera**, and **Insights**. It includes maps, player authentication, tree details, camera/library registration, GPS proximity, verified watering, leaderboard, dialogue/audio, and Ask My Trees. Development demo builds explicitly simulate location and hardware in the tree panel. Permission denial produces an actionable error. Native maps in standalone Android builds require your own Google Maps SDK configuration; the browser demo uses OpenStreetMap tiles without an API key.

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

If your provider keys are in the root `.env`, run `npm run connected:setup` to import nonempty backend settings into ignored `supabase/.env.connected`, configure both clients, and install hosted secrets and worker Vault settings. Root provider values override the corresponding connected values; empty values and example Tiger URLs are skipped. To prepare the files without contacting Supabase, run `npm run connected:setup -- --prepare-only`. Hosted secret installation requires an Owner or Administrator account. Root `.env` alone does not configure deployed functions or the local `npm run backend` process.

The verified provider configuration uses `GEMINI_MODEL=gemini-3.1-flash-lite`, an available `ELEVENLABS_VOICE_ID`, and an ElevenLabs key with Text to Speech, Speech to Text, and Read Voices permissions. Tiger is a separate Timescale PostgreSQL service; Supabase does not automatically provide its connection. Replace `TIGER_DATABASE_URL` with that service's runtime URI and install `tiger/setup.sql` before enabling historical delivery.

## Layout and contracts

- `apps/web`: responsive React/Vite map, tree care, registration, leaderboard, insights, and development-only simulator.
- `apps/mobile`: Expo native application using shared backend contracts.
- `packages/shared`: TypeScript contracts, Zod validation, client operations, timezone handling, and analytics calculations.
- `supabase/migrations`: 12 domain tables plus configuration/outbox, transactional operations, RLS, storage policies, realtime publication, and scheduled jobs.
- `supabase/functions`: named API endpoints and the shared router/provider implementations.
- `tiger/setup.sql`: idempotent historical storage and indexes.

[Hardware contract](docs/HARDWARE.md) documents exact payloads, authentication, session correlation, watering order, idempotency, and calibration. [Operations guide](docs/OPERATIONS.md) covers retry leases, stale-sensor scheduling, queue replay, analytics completeness, and provider configuration.

All game mutations occur in PostgreSQL transactions. Points are an append-only ledger. The current winner must own at least the configured ratio of active registered trees; unknown trees remain eligible in the denominator, confirmed dead/inactive trees do not. Species descriptions and model output never decide watering eligibility.

Defaults are illustrative and configurable, not horticultural guidance. In `game_config`: a 10-point care base (see [care scoring](docs/CARE_POINTS.md)), −20 death points, 80% territory control, 50 m proximity, 300 s sessions, 120 s baseline/evidence freshness, 1800 s stale cutoff, 30 s clock tolerance, and 5 percentage points rise. Species profiles define their own thirst/recovery percentages. Authenticated explicit watering evidence still requires the configured recovery threshold.

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

Hosted Gemini chat/image identification and ElevenLabs transcription/replies were verified on October 11, 2026, including two automatic browser voice turns. Native bundles were exported, but physical-device microphone, playback, camera, GPS, and sensor calibration still require device validation. This checkout's hosted Tiger URL is not configured; connected analytics returns unavailable history. See [recorded validation](docs/VALIDATION.md).

Map tiles and optional web fonts use external public services; the local demo requires no API credentials but is not a fully offline basemap. Device speech varies by installed voices. The prototype does not implement firmware, anti-spoofing attestation, app-store distribution, or production deployment.

Dependency audit currently reports inherited Expo/React Native toolchain advisories; compatible patches were applied. Avoid using development servers on untrusted networks and review the native SDK dependency chain before production rollout. Do not force unrelated native major upgrades without repeating native verification.

## Connected app, conversations, and camera scans

The web and native apps open on a sign-in screen, with a separate account-creation screen. Confirm your email when required by hosted Auth; a signed-in session opens the grove. Signing out clears the selected tree and conversation. Tree selection, caretakers, measurements, and points come from the hosted Supabase views.

For this checkout, both ignored client environment files must target the same hosted project as the Pi. A phone cannot connect to the Mac through `127.0.0.1`. Native photo uploads read image bytes directly rather than fetching a local `file://` URL. Restart Metro after changing client environment settings:

```sh
npm run mobile -- --lan --clear
```

Create `supabase/.env.connected` from `supabase/.env.example`, then fill the backend-only provider variables. `CLIENT_SUPABASE_URL` and `CLIENT_SUPABASE_PUBLISHABLE_KEY` can override the root `.env` public project settings. Leave provider values empty until available. Never use a secret/service-role key as the client key.

```sh
npm run connected:setup
npx supabase functions deploy api --project-ref YOUR_PROJECT_REF
npm run dev
```

`connected:setup` requires a Supabase CLI login with project access. It updates both ignored client files, installs nonempty provider settings, and configures matching worker credentials in Vault. It does not apply migrations or seeds. It leaves existing hosted provider secrets unchanged when a corresponding local field is empty. For a new project, apply migrations first, without demo seeds. This setup requires a CLI version supporting `supabase db query` (v2.79+).

Select a database tree to open **Talk to [tree name]**. The conversation reads its current record, caretaker, sensor freshness, care eligibility, and latest raw Arduino packet. Gemini writes short, casual replies with stable tree character traits and sensor-dependent moods. A **Readings and care** panel shows the original relevant database facts. Generated numbers and fact references are validated; generated language never alters measurements, ownership, or scoring. Historical questions read delivered Tiger Data for trees the signed-in player currently owns. Unavailable history and undelivered readings remain explicit.

**Voice conversation** opens an animated circular voice screen and starts listening. After at least 400 ms of detected speech, 1.4 seconds of silence sends the turn automatically. The tree speaks back and then starts listening again. **Pause** and **Resume** control the microphone; closing or backgrounding the screen stops it. Browser turns are bounded to 45 seconds. Mobile calibrates room noise for half a second, then submits after detected silence or at 20 seconds if noise or missing metering prevents detection. An optional **Send voice turn** button can submit sooner; an empty transcription produces a visible retry message. The backend uses ElevenLabs `ELEVENLABS_STT_MODEL` (default `scribe_v2`) for transcription and `ELEVENLABS_MODEL` for spoken replies. Per-tree voice IDs keep each tree's voice distinct; mood changes speech speed and expression. Web recording requires HTTPS or localhost and a supported MediaRecorder browser. Native recording requires microphone permission and a compatible Expo client/build. Text and actionable errors remain available when voice fails. Demo playback is labeled device speech; microphone transcription still requires ElevenLabs.

On mobile, **Scan a tree → Open camera** identifies species with Gemini and uses permitted GPS coordinates to list nearby database candidates, including caretaker and latest calibrated readings. Confirm the physical tree before selecting a record. Species recognition is not proof of unique tree identity, living condition, or watering. Without GPS, species identification is still available but no location candidates are returned. If the tree is new, use registration.

After identification, the camera shows six practical care steps and a horticultural source link. Confident Japanese maple identification uses the RHS growing guide; uncertain or other species use general tree guidance. Check actual soil and the caretaker's plan before watering. These instructions do not authorize a watering session or diagnose health from a photo.

The caretaker can open **Tree settings** to change a tree's name and select or preview an ElevenLabs voice on either client. The saved database voice takes priority over server voice defaults. Native action buttons use square icon tiles with labels. On iPhone, recording is prepared anew each turn and playback waits for the MP3 to load and native playback to start with speaker output enabled, including silent mode. Expo owns native player/recorder disposal; closing a screen cancels pending work before those objects are released. **Replay reply** retries the last spoken answer; the voice screen distinguishes transcription, thinking, audio loading, and speaking. Restart Metro after updating:

```sh
npm run mobile -- --lan --clear
```

Raw Pi uploads appear in `hardware_readings` and in conversation facts. They do not populate calibrated moisture, generate watering requests, earn points, or enter Tiger history. Use the hardware guide and Pi bridge's calibrated live mode with measured temperature to send canonical readings. A species recovery profile and valid authenticated watering evidence are necessary for scoring. Existing PostgreSQL game rules remain authoritative.

## Rutgers presentation grove

The hosted project now contains **Birch**, **Maple**, and **Willow**, assigned to Preeyam's existing account near Old Queens, Rutgers–New Brunswick. Their moisture values are 16%, 52%, and 92% respectively. The Arduino tree has moved to the same grove; its tree/device IDs and authentication remain unchanged. These additional readings are manually authored, recorded as `manual_scenario` with `hardware_observation=false`, and do not award points, create watering evidence, or claim delivered Tiger history. Their species profiles are illustrative.

Before presenting, refresh the three manually supplied readings, then start the clients:

```sh
npm run presentation:refresh
npm run dev
```

In another terminal:

```sh
npm run mobile -- --lan --clear
```

Sign in with Preeyam's existing account. Both clients use the deployed hosted API, so `supabase start` and `npm run backend` are unnecessary for this flow. Refresh readings again after 30 minutes if the presentation continues; stale readings deliberately produce an uncertain personality. The refresh command targets this project's three scenario records only. It is an explicit administrator operation, not a migration or production seed. [Presentation SQL](scripts/presentation-trees.sql) contains the IDs and JSON payload construction; [relocation SQL](scripts/rutgers-grove.sql) records the campus location change.

The presentation leaderboard has Preeyam (250 care points, 2 territories), Maya (180, 3), Jordan (135, 1), and Alex (90, 1). These supplied totals live in `presentation_scores` with `source=manual_presentation`; verified point events, actual ownership, and map territory control remain governed by the existing game rules. The three additional Auth accounts use reserved addresses, discarded random passwords, and disabled login; no emails were sent. An authorized administrator can restore these supplied totals idempotently with `npm run presentation:leaderboard`. This command is restricted to the configured hosted project. Removing a `presentation_scores` row removes its supplied totals from the display while preserving verified scores.
