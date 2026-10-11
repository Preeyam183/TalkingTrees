# Hardware integration contract (v1)

The team provides hardware and credentials. TreeQuest implements device registration storage, authenticated ingestion, session discovery, watering verification, and confirmed death processing. No firmware is included.

## Base URL and authentication

Use `https://PROJECT.supabase.co/functions/v1` in connected mode, or `http://127.0.0.1:54321/functions/v1` locally. A physical device must use the development computer's LAN IP instead of localhost.

All device calls are `POST` JSON with:

```http
Content-Type: application/json
X-Device-Key: YOUR_INDIVIDUAL_DEVICE_SECRET
```

An `apikey` header containing the project's publishable/anon key can also be sent. A device key is not a Supabase user token. The endpoints verify the device key, revocation state, and device-to-tree association. TLS is required outside local development.

Provision a device through the administrator's SQL connection. Generate a cryptographically random secret, provision it privately to hardware, and store only its SHA-256 digest:

```sql
insert into public.devices(id, tree_id, hardware_id, key_hash, can_report_health)
values ('DEVICE_UUID', 'TREE_UUID', 'arduino-01', 'LOWERCASE_SHA256_HEX_DIGEST', false);
-- Revoke without deleting historical evidence:
update public.devices set revoked_at = now() where id = 'DEVICE_UUID';
```

There is one device association per tree in this MVP. Replacement hardware rotates the existing row's credential. Grant `can_report_health` only to devices or operator workflows allowed to confirm a death. Demo keys are `demo-device-key-1` through `demo-device-key-20`, and must never be provisioned in connected environments.

## Sensor readings

### Raw hardware payload

Hardware may first send the raw controller payload below to `POST /sensor-readings`.
The `device_id` value is the provisioned `devices.hardware_id`, not a database UUID:

```json
{
  "device_id": "arduino-01",
  "seq": 1,
  "adc_raw": 280,
  "moisture_raw": 17937,
  "air_temperature_c": null,
  "soil_temperature_c": null,
  "light_raw": null,
  "pressure_pa": 101325
}
```

`pressure_pa` is optional because older payloads may omit it; use it for the BMP280 barometric pressure when available. `soil_temperature_c` and `light_raw` may remain `null` because those sensors are not installed. The server authenticates the hardware key, stores this payload in `hardware_readings`, and treats `(device, seq)` as idempotent. The personality pipeline below calibrates these readings only when administrator-provided reference values exist. It uses the authenticated device association and labels timestamps as server receipts. Raw packets do not enter the canonical game-reading flow; continue sending the canonical contract below for game state and capture evidence.

`POST /sensor-readings`

```json
{
  "external_event_id": "reading-000123",
  "device_id": "50000000-0000-4000-8000-000000000008",
  "tree_id": "40000000-0000-4000-8000-000000000008",
  "timestamp": "2026-10-10T14:00:00Z",
  "soil_moisture_pct": 29.0,
  "temperature_c": 21.4
}
```

Use actual UTC/offset ISO timestamps, not the example date. Moisture must be 0–100 percent; temperature −60–85 °C. These are input-validation bounds, not care recommendations. Event IDs are 1–128 characters and unique within a device's reading stream.

The response includes `reading_id`, `external_event_id`, `status`, `completed`, and `points` when current state is evaluated. Historical-only readings return `status: "historical_only"`. Every accepted reading enters a durable delivery queue. Acceptance does not mean Tiger Data has received it.

Out-of-order readings are retained in history but never replace a newer current reading. Same-timestamp readings also do not replace current state. Future timestamps outside configured clock tolerance are rejected.

## Player session creation and device discovery

The app calls `POST /watering-sessions` with `Authorization: Bearer PLAYER_ACCESS_TOKEN`:

```json
{
  "tree_id": "40000000-0000-4000-8000-000000000008",
  "request_id": "ACTIVE_REQUEST_UUID",
  "lat": 40.771,
  "lng": -73.9696,
  "idempotency_key": "CLIENT_GENERATED_UUID"
}
```

The backend checks current eligibility, fresh baseline, and configured proximity. The response contains `id`, `request_id`, `tree_id`, `player_id`, `baseline_pct`, `started_at`, `expires_at`, and `status`. The app never supplies a trusted player ID or score.

Hardware calls `POST /device-sessions` with its device key:

```json
{
  "device_id": "50000000-0000-4000-8000-000000000008",
  "tree_id": "40000000-0000-4000-8000-000000000008"
}
```

Response: `{"sessions":[{"id":"SESSION_UUID","tree_id":"TREE_UUID","request_id":"REQUEST_UUID","started_at":"ISO_TIMESTAMP","expires_at":"ISO_TIMESTAMP"}]}`. It deliberately excludes player identity and location. If multiple sessions exist, hardware must select the session associated with the physical watering interaction; do not send the same physical action for every nearby session. The app can display its session ID for a QR/NFC/pairing integration.

## Watering evidence: required sequence

1. Send a fresh low-moisture reading; the app starts a nearby session.
2. Discover/select that session on the hardware.
3. Send a **new post-session partial reading** below recovery.
4. Send authenticated watering evidence referencing that reading.
5. Continue sending readings. Completion occurs only once the latest fresh reading reaches the species recovery threshold while both session and evidence remain valid.

`POST /watering-evidence`

```json
{
  "external_event_id": "watering-000123",
  "device_id": "50000000-0000-4000-8000-000000000008",
  "tree_id": "40000000-0000-4000-8000-000000000008",
  "session_id": "SESSION_UUID",
  "timestamp": "2026-10-10T14:00:00Z",
  "evidence_type": "moisture_increase",
  "sensor_event_id": "reading-000123"
}
```

`evidence_type` is either:

- `moisture_increase`: server computes the increase relative to the session baseline and compares it with configuration.
- `explicit_watering_event`: a device has independently detected physical watering; this is never an app button acknowledgement.

Both types require recovery before points or ownership change. The referenced reading must belong to the same device/tree, follow session start, and be fresh. A valid partial response has `verified: true`, `completed: false`, and `points: 0`. An insufficient moisture increase has `verified: false` and also earns nothing; send a new event ID when stronger evidence exists.

**Ordering matters:** a recovery reading without already-valid evidence resolves the request without a reward. Later evidence cannot retroactively capture it. For a rapid rise, send an explicit physical watering event referencing a post-session reading before the recovery reading. Retransmitting already accepted evidence returns its original response; query the session or observe realtime updates for subsequent completion.

## Confirmed health event

`POST /tree-health-events`

```json
{
  "external_event_id": "health-000123",
  "device_id": "50000000-0000-4000-8000-000000000008",
  "tree_id": "40000000-0000-4000-8000-000000000008",
  "timestamp": "2026-10-10T14:05:00Z",
  "status": "dead",
  "confirmed": true,
  "reason": "Confirmed by the authorized hardware workflow"
}
```

Requires `can_report_health=true`, a fresh event, and explicit confirmation. Neither missing data nor low moisture proves death. A confirmed live-to-dead transition deducts points once, releases ownership, cancels active activity, and recalculates territory control. Different IDs reporting the already-dead state do not create another penalty.

## Retries and errors

Persist event IDs and exact payloads across retries. Retry transient network/5xx errors with backoff. Reusing an ID with the identical payload returns the stored result; changing its payload returns HTTP 409 `idempotency_conflict`. IDs are scoped by device and event stream. Partial acceptance uses HTTP 200, not an error.

| HTTP | Examples | Action |
|---|---|---|
| 400 | schema validation, `future_timestamp`, `reading_not_found`, `evidence_not_fresh`, `session_inactive`, `outside_proximity` | Correct input/order or start a new eligible session |
| 401 | `unauthorized_device`, `unauthorized` | Check credential/revocation |
| 403 | `health_permission_denied` | Use the authorized health reporting workflow |
| 409 | `idempotency_conflict` | Preserve original payload; a new physical event needs a new ID |
| 503 | integration unavailable | Retry after backoff |

All responses are JSON. Error bodies contain `error`. Never place device secrets in user clients, screenshots, logs, or repository files.

## Hardware calibration

`game_config` stores meters, seconds, point amounts, territory ratio, and moisture percentage-point increase. `species.thirst_pct` and `species.recovery_pct` store percent moisture. Defaults are illustrative: 50 m, 300 s sessions, 120 s baseline/evidence freshness, 1800 s stale cutoff, 30 s future-clock tolerance, and 5 percentage points increase. Species thresholds vary in the seed; calibrate them against sensor substrate, installation, and species needs before connected use.

## Sensor-to-personality pipeline

Migration `202610100009_sensor_personality.sql` adds administrator-managed calibration on
`devices`, stable traits/care ranges on `species`, and retry-safe raw ingestion. Apply
locally with `npx supabase migration up --local`; this does not reset the demo.

Configure calibration using **measured** dry/wet reference readings. Example only:

```sql
update devices set moisture_calibration =
  '{"field":"adc_raw","dryRaw":600,"wetRaw":250}'::jsonb
where hardware_id='arduino-01';

update species set personality_traits = array['lively','curious'],
  dialogue_care_profile = '{
    "temperatureField":"air_temperature_c",
    "comfortableTemperatureC":[10,30],
    "suitableLightRaw":[200,800]
  }'::jsonb
where name='Red maple';
```

These numbers are illustrative, **not hardware or horticultural recommendations**.
`field` accepts `adc_raw` or `moisture_raw`. The mapping uses
`clamp(100 * (raw - dryRaw) / (wetRaw - dryRaw), 0, 100)`; reversed direction is valid.
Missing/equal/nonfinite calibration endpoints or absent selected readings produce unknown
moisture. Optional sensor fields may be omitted or null; they never become zero. Raw
numbers must be finite; temperature validation is −60 to 85 °C. Non-numeric fields are
rejected, not coerced. A zero reading is preserved as a real zero.

Care ranges are optional; missing/invalid ranges yield unknown classifications.
`temperatureField` explicitly selects air or soil temperature. Light bounds use the
installed sensor's raw units and assume increasing values mean more light; omit them
until this is verified. Species traits stay stable as mood changes. The backend's
existing canonical moisture status supplies hysteresis; raw calibration alone does not
label a tree thirsty or change game state. Raw trend remains unknown because packets
have no event timestamp/normalization correlation. Canonical trend compares two fresh
readings' shortfall from the species recovery threshold; fewer than two readings stays
unknown. This describes recovery progress, not a diagnosis.

Both web and mobile call `tree-dialogue`, which now returns the existing `message`,
`source`, `personality` (legacy voice selector), plus `mood`, `tone`, and `parameters`:
calibrated measurements, stable `personality_traits`, mood/intensity, care signals,
unknown readings, lifecycle, active request, `watering_allowed`, reading timestamp and
source. `watering_allowed` is only the backend's request/baseline prerequisite check;
starting a session still verifies the player's proximity and all transactional rules.
Gemini never supplies this flag or changes ownership/points.

Dialogue uses the latest raw receipt when newer than the canonical reading; otherwise
it uses canonical percentages with explicit identity calibration. Legacy canonical
`temperature_c` is exposed as air temperature; hardware needing separate soil readings
must use the explicitly named raw fields. Stale input is unknown. Raw timestamps are
**server receipt times**, not proof of when a measurement occurred. Revoked devices'
raw readings are excluded. Cached dialogue fingerprints include the mapped state,
traits, model, mode, and reading timestamp. New raw receipts notify existing tree
realtime subscribers without changing moisture, health, ownership, or points.

The sample uncalibrated packet yields null moisture/temperatures/light, unknown care
signals, and an uncertain mood. Its fallback reads: “I'm unsure how I'm doing: moisture,
temperature and light readings are unknown. Please check my sensors and calibration.”

Raw `POST /sensor-readings` returns `status: "raw_accepted"`,
`hardware_reading_id`, internal `device_id`, `tree_id`, `seq`, and `received_at`.
Identical `(device, seq)` retries preserve the original receipt and payload; conflicting
reuse returns HTTP 409. Persist a monotonically unique sequence across controller
restarts. Raw packets remain separate from canonical ingestion/Tiger history: they do
not create watering requests, fulfill evidence, award points, or deliver uncalibrated
history. Continue sending the documented canonical timestamps/percentages and evidence
for game capture. No firmware or calibration endpoints are guessed automatically.
