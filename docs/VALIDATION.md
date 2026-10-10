# Implementation validation

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
