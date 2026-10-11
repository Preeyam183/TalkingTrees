# Implementation validation

## Real Tiger development integration — October 10, 2026

- Created free shared DEV service `treequest-history` (`yz8dps8fs2`, us-east-1).
- Installed the TimescaleDB history hypertable and tree/time index. Runtime role verified to have SELECT/INSERT, without UPDATE/DELETE.
- Kept local demo controls (`APP_MODE=demo`) and enabled real historical storage (`HISTORY_MODE=tiger`). These settings are in ignored `supabase/.env.local`; root `.env` is not loaded by the backend command.
- The local Edge runtime rejected this service's certificate with `CaUsedAsEndEntity`. Installed the backend-only PostgreSQL FDW transport (`TIGER_TRANSPORT=fdw`); setup and TLS limitations are documented in [operations](OPERATIONS.md).
- Delivered all 340 existing fictional demo readings to real Tiger. Verified 340 remote rows, zero outstanding/failed deliveries, and unchanged count after duplicate inserts.
- Authenticated Ask My Trees returned HTTP 200 with `source: "tiger"` and actual history statistics. Current stale-sensor warnings remain accurate; this is not a real-hardware validation.
- Both Cron jobs succeeded and scheduled delivery HTTP responses were 200. Ordinary authenticated/anonymous roles cannot call the private Tiger RPCs.
- Edge Function Deno check and 9 unit tests passed. Database-reset integration suites were deliberately not run against the configured history.

The original full implementation checks below predate this integration; their provider limitations describe that earlier run. Gemini, ElevenLabs, physical hardware, and hosted Supabase deployment were not verified by this Tiger setup.

Verified locally on October 10, 2026, using Node 24, Docker Desktop, local Supabase/PostgreSQL 17, Chromium, and an iPhone 16 Pro simulator running iOS 18.6 / Expo SDK 54.

| Check | Result |
|---|---|
| Workspace TypeScript checks | Web, Expo, shared package passed |
| Edge Function Deno check | Passed |
| Unit tests | 9 passed |
| Database/Edge integration tests | 17 passed |
| pgTAP schema/security/scheduler assertions | 10 passed |
| Chromium end-to-end tests | 2 passed |
| Web production build | Passed |
| iOS and Android bundle exports | Passed |
| Native iOS simulator smoke test | Sign-in, seeded map, partial watering, completed recovery, 10 points, 8 trees / 1 territory, and Ask My Trees with pending-delivery notices verified |

The integration suite exercises authenticated endpoints, partial watering, recovery thresholds, replay conflicts, out-of-order readings, competing captures, own-tree care, unowned claims, death penalties, stale-state processing, session expiry, proximity, worker lease recovery, RLS, history delivery/exclusion, connected-mode Tiger outage behavior, unsupported questions, and empty ownership.

The desktop browser test observes capture updates in a second tab. The mobile viewport test uploads a photo, receives the labeled identification fixture, and registers an unidentified tree. The native simulator verifies the same capture rule against the real local database, rather than implementing a separate scoring simulation in the client.

## Still requiring team integration

- Real device provisioning, physical watering detection, clock synchronization, proximity calibration, and species moisture thresholds.
- Connected Tiger Data database credentials, TLS/network access, setup SQL, live insert/query round trip, and scheduled delivery monitoring.
- Connected Gemini image identification/structured responses and ElevenLabs voice IDs/audio generation using team credentials.
- Physical-phone camera, location, and audio checks; standalone Android Maps credentials and Android device smoke testing.
- Production hosting and app-store distribution are outside this delivery.

The demo uses simulated historical data, simulated hardware events, a labeled identification fixture, and device speech. It does not claim live provider validation. Connected-mode Tiger failure was tested to return an unavailable state without simulated substitution.

Known build/tooling notes: the web build reports a large main bundle warning; npm audit reports inherited Expo/React Native toolchain advisories after compatible dependency updates. These are documented limitations, not passing security-certification claims.

## Sensor personality pipeline — October 10, 2026

- Applied migration 009 locally without resetting demo/Tiger data.
- Eight focused unit tests passed: normal/reversed calibration, clamping, null/missing/equal
  calibration, sample uncertainty, stable traits, nonfinite input rejection, eligibility
  isolation, and response validation.
- Additional local PostgreSQL check passed inside a rolled-back transaction: identical raw
  retries preserve receipts, conflicting retries fail, current tree game state stays intact,
  and ordinary roles cannot invoke raw-ingestion RPCs.
- Workspace typechecks, Deno check and web production build passed (existing bundle-size warning).
- Authenticated live `tree-dialogue` HTTP 200 and cached repeat returned shared parameters
  with unknown measurements and a deterministic uncertainty message.
- No live Gemini generation or physical sensor calibration was claimed. Full reset-based
  integration suites and native device UI checks were not repeated for this change.

Focused verification (the DB test targets only local port 54322 and rolls back its changes):

```sh
npm test
PERSONALITY_DB=1 npx vitest run tests/personality.test.ts tests/personality.database.test.ts
```

## Connected client and conversation update — October 11, 2026

The hosted public client URL/key were checked against `tree_map`, `territory_map`, `leaderboard`, and `game_config`. The project contained one unowned Arduino test tree, 27 raw hardware packets, and no canonical readings at inspection. Raw packets therefore cannot establish calibrated moisture or historical delivery. Client environment files now target this hosted project rather than phone-local loopback.

The update adds separate sign-in/sign-up screens, authenticated per-tree conversations, backend ElevenLabs transcription/TTS, an animated voice screen on both clients, native image-byte uploads, and camera species identification with explicit nearby database candidates. The model selects server-authored factual statements; historical access remains limited to the current caretaker. Conversations and photos do not award points.

Provider credentials are intentionally deferred by the team. End-to-end Gemini, ElevenLabs, and Tiger calls require filling `supabase/.env.connected` and running `npm run connected:setup`. Exported native bundles do not prove physical-phone camera/microphone/GPS behavior or native audio playback.

Recorded checks for this update: 12 unit tests, 19 database/Edge integration tests, 10 pgTAP assertions, and 4 Chromium end-to-end tests passed. Workspace TypeScript and Deno checks, the web production build, and iOS/Android bundle exports passed. Browser tests include successful account creation, auth gating, database-backed tree chat, voice-screen display, registration, verified scoring, and realtime updates. Auth and voice screenshots were visually inspected.

The hosted API was deployed as version 2 and new chat/transcription routes rejected unauthenticated requests with HTTP 401. Hosted secret installation was attempted but the CLI account received an insufficient-privileges error. An account authorized to configure project secrets must run `connected:setup` after the team fills the provider credentials. Hosted worker Vault settings were not installed by that failed attempt. The Supabase connector had permission to deploy the API independently of the CLI account.
