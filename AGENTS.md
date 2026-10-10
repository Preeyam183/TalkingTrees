# TalkingTrees Agent Guide

## Start Here

- Read [README.md](README.md) for setup, demo flow, connected setup, architecture, and verification.
- Read [docs/HARDWARE.md](docs/HARDWARE.md) for device authentication, sensor payloads, watering evidence, idempotency, and calibration.
- Read [docs/OPERATIONS.md](docs/OPERATIONS.md) for Edge Functions, pg_cron, Vault, delivery retries, Tiger Data, and provider configuration.
- Read [docs/VALIDATION.md](docs/VALIDATION.md) for recorded verification results and known integration gaps.

## Commands

Prerequisites: Node 22.12+, npm, and Docker Desktop for local Supabase.

```sh
npm ci
npx supabase start
npm run demo:setup
npm run backend
npm run dev
```

Useful checks:

```sh
npm run typecheck
npm test
npm run test:integration
npm run db:test
npm run test:e2e
npm run build
npx deno check --config supabase/functions/deno.json supabase/functions/api/index.ts
cd apps/mobile && npx expo install --check
```

Run integration, database, and E2E suites sequentially because they share and reset the local database. There is no lint script. Do not commit generated files, `.env.local` files, `.expo`, or test output.

## Architecture

- `apps/web`: React/Vite browser client and development simulator.
- `apps/mobile`: Expo SDK 57 native client; owns native location, camera, audio, speech, maps, and auth storage.
- `packages/shared`: shared Supabase client/API helper, Zod schemas, domain types, and analytics calculations.
- `supabase/migrations`: database source of truth for schema, RLS, transactional game rules, realtime, storage, idempotency, and workers.
- `supabase/functions`: Deno Edge Function entrypoints and the API router. `_shared/services.ts` owns provider/service integrations; `_shared/insights.ts` owns analytics authorization and response assembly.
- `supabase/seed.sql`: local demo data only; never apply it to a connected production project.
- `tiger/setup.sql`: external historical storage schema. Supabase remains authoritative for current state, scoring, ownership, and delivery queues.

Clients read approved Supabase views such as `tree_map`, `territory_map`, and `leaderboard`. Send mutations through authenticated API routes and PostgreSQL RPCs; do not duplicate scoring, ownership, authorization, or idempotency rules in clients.

## Conventions and Guardrails

- Keep TypeScript strict and preserve the existing workspace/module conventions.
- Validate external request payloads with shared Zod schemas and validate again on the server.
- Keep game mutations transactional. Preserve event IDs and exact payloads for retry safety.
- Points are an append-only ledger; do not update or delete point events.
- Treat current Supabase readings and historical Tiger Data readings as separate states. Pending or failed deliveries must not appear in historical analytics.
- Demo behavior requires a development build, `APP_MODE=demo`, and `game_config.demo_mode=true`.
- Keep service-role, worker, device, Gemini, ElevenLabs, and Tiger credentials out of `VITE_*` and `EXPO_PUBLIC_*` variables.
- Preserve unrelated user changes and avoid broad native dependency upgrades without repeating mobile verification.

## Local Networking

- Local web: `http://localhost:5173`; Supabase API: `http://127.0.0.1:54321`; Studio: `http://127.0.0.1:54323`.
- A physical phone cannot reach the Mac through `127.0.0.1`. Set `apps/mobile/.env.local` `EXPO_PUBLIC_SUPABASE_URL` to the Mac LAN IP and keep both devices on the same network. Android emulators generally use `http://10.0.2.2:54321`.
- Restart Metro after changing Expo environment variables.
- `npm run demo:reset` is local-only and may disconnect the backend process; rerun `npm run backend` afterward.
- When switching local and connected modes, edit ignored `.env.local` files explicitly; `demo:setup` preserves existing values.
