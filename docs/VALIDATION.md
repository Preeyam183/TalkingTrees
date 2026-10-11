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

| Check                                      | Result                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace TypeScript checks                | Web, Expo, shared package passed                                                                                                                     |
| Edge Function Deno check                   | Passed                                                                                                                                               |
| Unit tests                                 | 9 passed                                                                                                                                             |
| Database/Edge integration tests            | 17 passed                                                                                                                                            |
| pgTAP schema/security/scheduler assertions | 10 passed                                                                                                                                            |
| Chromium end-to-end tests                  | 2 passed                                                                                                                                             |
| Web production build                       | Passed                                                                                                                                               |
| iOS and Android bundle exports             | Passed                                                                                                                                               |
| Native iOS simulator smoke test            | Sign-in, seeded map, partial watering, completed recovery, 10 points, 8 trees / 1 territory, and Ask My Trees with pending-delivery notices verified |

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

## Provider configuration verification — October 11, 2026

Root Gemini/ElevenLabs keys were imported into ignored connected backend settings. A working ElevenLabs voice was selected and saved privately. Hosted `tree_map` access, Gemini structured JSON generation with `gemini-3.1-flash-lite`, ElevenLabs speech generation, and transcription of that generated speech each returned HTTP 200. The previous Gemini model returned HTTP 404; a newer full Flash model exceeded the request timeout during the structured-output check. The selected Lite model passed within the backend's 20-second limit.

Isolated configuration checks passed for key import, quoted values, example Tiger URL rejection, exclusion of private keys from client settings, and worker-secret stability across repeated preparation. Script syntax and Git whitespace checks passed.

Hosted secret installation still fails with insufficient privileges. These direct provider checks do not prove that hosted app routes have the new credentials. The team must run `npm run connected:setup` using an authorized Supabase account. The root Tiger URL remains an example; hosted inspection found no Timescale extension, Tiger foreign server, or history table, and the current local database had no foreign server. Tiger history and physical-device microphone/camera behavior remain unverified.

## Branch Out presentation and hosted verification — October 11, 2026

This run supersedes the earlier hosted-secret permission limitation: the user obtained Owner access, `npm run connected:setup` completed, and Gemini/ElevenLabs secrets and matching worker Vault configuration were installed. The API was deployed with explicit custom authentication preserved. Function import maps are now configured in `supabase/config.toml`, so CLI deployment resolves the pinned shared dependencies without Docker.

Three additional trees were added to Preeyam's existing hosted account: Birch (16% moisture, 29 °C), Maple (52%, 22 °C), and Willow (92%, 18 °C). They and the existing Arduino tree were relocated near Old Queens in Rutgers–New Brunswick. The Arduino tree/device IDs, device revocation state, and ownership were preserved. The new readings record `source=manual_scenario`, `hardware_observation=false`, and zero points. Queries confirmed zero point events, zero watering evidence, and zero historical delivery rows for these three trees. `npm run presentation:refresh` refreshes only these manually supplied readings; it never runs demo seeds or resets the database.

The displayed brand is Branch Out. Native navigation now uses persistent Home, Chat, Scores, Camera, and Insights tabs. Both clients use the same speech/silence detector and automatic listen → transcribe → reply → listen loop, with pause/resume and cleanup on close/background. Stable per-tree ElevenLabs assignments give Birch, Maple, and Willow distinct voices. Casual Gemini replies reflect trusted moisture/thermal signals and traits; inactive/dead states take precedence. Original database facts remain available separately, and generated chat cannot mutate scoring or care eligibility.

Recorded live checks used isolated, email-confirmed temporary accounts created through the administrator API (no email sent). Accounts, uploaded photos, and browser sessions were removed afterward:

- Hosted chat for all three trees returned `source=gemini`, caretaker facts for Preeyam, no provider warnings, and actual ElevenLabs audio. Returned personalities were watchful, warm, and waterlogged respectively.
- One later text request used the guarded template fallback; the final follow-up checks returned Gemini replies for all three trees. Provider failure or rejected wording remains a supported path with database facts and deterministic casual text.
- The hosted transcription endpoint successfully transcribed generated MP3 speech.
- A real Japanese maple photo uploaded through authenticated Storage returned Gemini identification `Acer palmatum`, four nearby Rutgers records, and caretaker data. This verifies the backend photo/CV/candidate pipeline; species recognition does not prove a unique physical tree's identity or health.
- Chromium sign-in, hosted tree selection, chat, and voice UI passed. A prerecorded speech-and-silence input exercised actual MediaRecorder capture, metering, automatic submission, playback, microphone restart, and a second automatic turn with conversation history. Web chat and voice screenshots were visually inspected.
- Workspace typechecking, Deno checking, the web production build, and native iOS/Android bundle exports passed. Unit tests: 25 passed; the 20 opt-in stateful tests were skipped. The local database-reset integration suites were not rerun against the existing configured stack. The web build retains its existing large-chunk warning.

Hosted security advisors found no RLS-disabled tables. Six internal service-only tables intentionally have RLS with no client policies. The existing Auth setting has [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); this run did not change Auth settings.

Remaining limits: physical-phone camera, GPS, microphone metering/audio playback, and device sensor calibration still require a device smoke test. The root Tiger URL is an example placeholder and hosted Tiger history remains unavailable; current Supabase values still work. Readings intentionally become stale after 30 minutes unless refreshed. The manually supplied trees cannot demonstrate hardware-verified watering or point awards. Existing transactional scoring was preserved, not bypassed.

## Tree settings, iPhone audio, and presentation scores — October 11, 2026

Migration `20261011124352_tree_settings_and_presentation_scores` was applied and registered on the hosted project. Caretakers can edit names and choose/preview voices on both clients. Saved `trees.voice_id` overrides environment defaults. The settings RPC rejects null or mismatched caretakers and is executable only by the service role. Public views retain security-invoker behavior; client writes to supplied presentation totals are denied.

The iPhone audio path now restores speaker/silent-mode playback after recording, caches MP3 data as a native file, waits for native loading before playing, and reports loading failures. Each microphone turn prepares a fresh recording, the permission prompt does not close the voice screen, and quieter iOS metering can trigger automatic end-of-speech submission. Replay is available for the last audio reply. Square icon action tiles include auth and tree actions. Camera results include six curated care steps with an RHS or University of Minnesota source, rather than model-generated watering instructions.

Administrator-supplied leaderboard totals were installed separately from the verified ledger: Preeyam 250 points / 2 territories, Maya 180 / 3, Jordan 135 / 1, and Alex 90 / 1. The three extra Auth accounts have reserved addresses and disabled login; no email was sent. Queries confirmed that verified point events and watering evidence remain empty, existing tree ownership remains unchanged, and no actual territory was reassigned by these presentation totals.

Recorded checks:

- 31 unit tests passed; 20 opt-in stateful tests were skipped. New tests cover native loading/playback ordering, cancellation and errors, quieter iPhone metering, settings validation, and care-guide selection.
- Workspace typechecking, Deno checking, web production build, Expo dependency compatibility, and iOS/Android bundle exports passed. The existing web chunk-size warning remains. Reset-based integration suites were not rerun against the configured stack.
- Hosted owner-only settings rejected another account, saved an isolated tree's name/voice, and used that selected voice for actual ElevenLabs synthesis. Owner RPC behavior and client privilege restrictions were checked separately.
- An authenticated real Japanese maple photo returned Gemini identification and six appropriate care steps. Browser sign-in, settings edits, saved voice selection, and the populated leaderboard passed. Screenshots were inspected.
- Temporary test accounts, tree records, photos, and sessions were removed. The final migration list matched local and hosted history.

Native exports and mocked playback tests do not prove physical iPhone playback. The user reported a pause after speaking; verification on their iPhone after restarting Metro is still pending. Expo Go supports expo-audio; the changes address the application's native recording/playback lifecycle rather than requiring a standalone build.
