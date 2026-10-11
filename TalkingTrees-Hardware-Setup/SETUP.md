# TalkingTrees final-project setup

Reviewed GitHub main snapshot: `974085cc44ded66e25245592b52cf216ef8bd519` on October 10, 2026. Your repo calls the app TreeQuest. These instructions target that repo, not the earlier Rooted Python/SQLite demo. No GitHub changes or cloud deployment were made.

## 1. Choose where programs run

Recommended first integration: Arduino plugs into Pi 5; Pi runs only `treequest_bridge.py`; Mac runs the TalkingTrees backend and web/mobile development servers. Mac, Pi and phone share a network. Your Mac stays on macOS; Pi stays on Raspberry Pi OS. The external Pi monitor is fine; SSH is optional.

| Machine | Install/run | Role |
|---|---|---|
| Arduino Uno R3 | RootedUno.ino, uploaded once with Arduino IDE | Reads A0, emits USB JSON at 115200 |
| Pi 5 | Raspberry Pi OS, Python 3, venv, pyserial, this bridge | USB acquisition + persistent HTTP outbox |
| Mac | Node 22.12+ (repo says verified with 24), npm, Git, Docker Desktop | Local Supabase database/Auth/Storage/Realtime |
| Mac terminal A | npm run backend | Repo's Supabase Edge API |
| Mac terminal B | npm run dev | React/Vite web UI |
| Mac terminal C | npm run mobile -- --lan --clear | Expo development server, only for native mobile |
| Phone | Compatible Expo Go/development client | Native mobile UI; same Supabase project |

A Mac can also run the Python bridge with Arduino plugged directly into it; change its serial port to the listed `/dev/cu.*` port and use localhost for the API. Do not run two serial readers on one Arduino.

The old `server.py`, old `bridge.py`, port 8000, DEVICE_TOKEN and DEMO_TOKEN belong to the separate Rooted starter. They are not the backend/configuration of this repository.

## 2. Important integration gaps found in your code

The current repo has two sensor payload routes within `sensor-readings`:

* Raw Arduino JSON is saved into `hardware_readings`. A `raw_accepted` response proves receipt only. This branch does not call `ingest_reading`, update `trees`, change the map, or feed the history queue.
* Canonical readings include device/tree UUIDs, an event ID, timestamp, calibrated `soil_moisture_pct` and numeric `temperature_c`. That branch calls `ingest_reading` and updates tree state and the delivery queue.

The included bridge supplies both modes. `--mode raw` proves the complete transport path; `--mode live` performs calibration and sends canonical readings.

**Current moisture-only limitation:** your supplied sketch has USE_BMP280=0 and emits null temperature. `readingSchema`, Supabase `sensor_readings.temperature_c`, and Tiger `sensor_history.temperature_c` all require a number. Live mode refuses to invent one. Either connect/verify the supported temperature module, or have your app team implement nullable temperature consistently through those schemas, UI and analytics and verify it. Changing only one validator is insufficient. This package does not modify the backend or implement that schema change.

The canonical field is named `soil_moisture_pct`, but two-point calibration of this probe gives a relative substrate index, not measured volumetric water content. Label the UI accordingly and use demonstration thresholds until validated.

## 3. Bring up the actual repo on your Mac

Install Node, Git and Docker Desktop; launch Docker Desktop and wait for it to finish starting. If you already have the repo, work in that checkout and preserve your team's local edits instead of cloning over it.

For a new checkout:

```bash
git clone https://github.com/Preeyam183/TalkingTrees.git
cd TalkingTrees
npm ci
npx supabase start
npm run demo:setup
```

Use the repository's lockfile; don't independently upgrade Expo or Supabase mid-demo. The repo already contains Supabase configuration, so do not run `supabase init`. The first startup downloads images and applies local migrations/seeds. Local mode needs no hosted Supabase account.

`demo:setup` creates missing values in apps/web/.env.local, apps/mobile/.env.local and supabase/.env.local. It preserves existing values. If this checkout previously used a cloud project, explicitly check those files before proceeding. The root .env and NEXT_PUBLIC_* values do not configure these Vite/Expo apps.

Keep two Mac terminals open, both inside TalkingTrees:

```bash
# Terminal A
npm run backend
```

```bash
# Terminal B
npm run dev
```

Open http://localhost:5173. Choose Play as Alex for the local demo. Studio/SQL Editor is http://localhost:54323. Local demo login is player1@treequest.local / TreeQuest-demo-2026. This fictional account/seed is for local development only.

Do not run `demo:reset`, database reset, or stateful integration tests while collecting your demonstration data; they reset the local game.

## 4. Connect Pi and phone to the Mac's backend

On the Mac, find the active Wi-Fi IP in System Settings → Wi-Fi → Details → TCP/IP. `ipconfig getifaddr en0` also works when Wi-Fi is en0. Example address below is 192.168.1.42; replace it with your actual Mac address everywhere.

| Where request starts | Local API base |
|---|---|
| On Mac itself | http://127.0.0.1:54321 |
| On Pi or physical phone | http://192.168.1.42:54321 |

**localhost always means the device running the program.** From the Pi, localhost does not refer to your Mac.

All three devices must be able to communicate. Permit your development tools through the Mac firewall where needed. Campus/event Wi-Fi may isolate clients; use an allowed private hotspot/router with client-to-client access. Recheck addresses whenever the network changes. Keep the Mac awake and Docker running while it hosts the demo.

Use `/functions/v1/api` as the bridge API base because `npm run backend` serves the repo's `api` router. Do not send to the older `/api/readings` endpoint.

## 5. Hardware and Uno firmware

Power disconnected: seat the Grove Base Shield, confirm Uno R3 and Base Shield V2, put the V2 selector at 5 V, plug Grove analog moisture into A0. Keep upper electronics and plugs dry. Pi gets its own appropriate USB-C supply. Uno USB data cable goes to Pi USB-A after programming; Pi GPIO remains unused.

The package includes `firmware/RootedUno/RootedUno.ino`. Open it in Arduino IDE on the Mac, select Arduino Uno and its port, Verify, Upload, then inspect at 115200 baud. Close Serial Monitor before bridge use.

For actual ambient temperature, use the verified 5 V-compatible **Grove BMP280 module** on I2C, install Adafruit BMP280 Library and offered dependencies, and change USE_BMP280 to 1. Confirm air_temperature_c becomes a plausible measured number. A DHT, BME280 or bare BMP280 breakout needs its own verified wiring/driver. Do not bury the BMP280; it is not a soil-temperature sensor. Pressure is not emitted by the supplied sketch; the repo's optional pressure field is not required.

## 6. Install the new bridge on Pi

Download/extract this package on Pi using its browser, or copy the extracted directory from your Mac with scp. For example, from a Mac terminal in the directory containing this extracted folder:

```bash
scp -r TalkingTrees-Hardware-Setup PI_USERNAME@PI_HOSTNAME.local:~/
```

Replace PI_USERNAME and PI_HOSTNAME with your Imager settings. In a Pi terminal (external monitor or SSH):

```bash
cd ~/TalkingTrees-Hardware-Setup
sudo apt update
sudo apt install -y python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m serial.tools.list_ports
```

Choose the listed Uno port, often /dev/ttyACM0 or /dev/ttyUSB0. Then verify USB without any network or credentials:

```bash
python3 treequest_bridge.py --port /dev/ttyACM0 --monitor --samples 20
```

It prints packets and a native ADC median. It exits after 20 readings. Confirm adc_raw changes in actual substrate. A number from an unconnected input is not proof the probe works.

## 7. Prove Pi-to-repo transport with raw mode

The local seed provisions arduino-01 with the following mapping:

* hardware ID: arduino-01
* device UUID: 50000000-0000-4000-8000-000000000001
* tree UUID: 40000000-0000-4000-8000-000000000001
* local-only device secret: demo-device-key-1

This is the first seeded tree, not the README's Birch 3 walkthrough tree. Confirm the current mapping in Studio:

```sql
select d.id as device_id, d.hardware_id, d.tree_id, t.name
from public.devices d join public.trees t on t.id=d.tree_id;
```

In Pi terminal:

```bash
export TREEQUEST_API_URL='http://192.168.1.42:54321/functions/v1/api'
export TREEQUEST_DEVICE_KEY='demo-device-key-1'
export TREEQUEST_DEVICE_ID='50000000-0000-4000-8000-000000000001'
export TREEQUEST_TREE_ID='40000000-0000-4000-8000-000000000001'

python3 treequest_bridge.py --port /dev/ttyACM0 \
  --mode raw --outbox raw-outbox.sqlite3
```

Expected output contains `raw_accepted`. In Studio SQL Editor:

```sql
select device_id, sequence_number, received_at, payload
from public.hardware_readings
order by received_at desc limit 10;
```

You should see newly received physical readings. This does not update the map; proceed to live mode only after calibration and actual temperature are ready.

Raw server deduplication uses device+sequence, so this bridge replaces raw `seq` with a persistent gateway counter. Keep the same raw outbox database across reconnects; don't delete it or run another raw gateway with a fresh counter against the same registration. Canonical mode uses unique event IDs and preserved timestamps instead.

## 8. Calibrate, then send live app readings

Stop raw mode with Ctrl+C. Collect about 20 native adc_raw readings at a consistent depth in dry substrate using monitor mode. Repeat in watered, drained substrate of the same kind. Record the medians. Do not use guide examples as calibration and do not drown the probe electronics.

Use those **native 0–1023** medians as --dry and --wet. Unlike the old Rooted UI, this bridge accepts native counts directly. It supports either increasing or decreasing wet readings. The references must be separated by at least 32 native counts.

For example, ONLY if your measured medians were 150 and 800:

```bash
python3 treequest_bridge.py --port /dev/ttyACM0 \
  --mode live --dry 150 --wet 800 --outbox live-outbox.sqlite3
```

Reuse the environment variables from raw setup. Live mode needs actual air_temperature_c. A missing-temperature message means it is intentionally not sending fabricated data. Enable and test the supported sensor or complete nullable support before proceeding.

Expected response includes `reading_id`, `external_event_id` and a state such as healthy/thirsty. Verify in Studio:

```sql
select id, name, moisture, temperature, reading_at, status
from public.trees
where id='40000000-0000-4000-8000-000000000001';
```

The app reads tree_map and subscribes to database changes; no frontend serial connection is needed. Look at the tree matching the registered UUID. Do not click simulated watering/refresh buttons on that same tree while testing physical readings.

The reader and uploader run separately so a network outage does not stop USB receipt timestamping. The outbox preserves exact payloads for retry. Host receipt time still approximates acquisition time; the Uno does not provide an absolute clock. Keep Pi time synchronized. Old backfilled readings remain historical rather than becoming new measurements. Never report an outbox replay as a fresh physical event.

## 9. Open native mobile

On Mac, set apps/mobile/.env.local:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.42:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=THE_LOCAL_PUBLIC_KEY_FROM_DEMO_SETUP
EXPO_PUBLIC_APP_MODE=demo
```

Keep the generated public key from demo:setup. Do not copy a service-role key. From repo root in a third Mac terminal:

```bash
npm run mobile -- --lan --clear
```

Open the QR code in an Expo client compatible with the repo's SDK. **Current package.json requests Expo ~57.0.0, while docs/VALIDATION.md describes an older SDK 54 test.** That old validation entry does not verify this exact dependency snapshot. Check your installed Expo Go/development client compatibility. If incompatible, use the corresponding development build; do not blindly downgrade the repo. An iOS simulator additionally needs Xcode and an installed simulator; a physical phone does not need Xcode just to open a compatible Expo Go project.

A Metro tunnel alone does not expose local Supabase to a phone. The phone still needs network access to the configured backend. Restart Metro after environment changes.

For the website on a phone instead, run from repo root:

```bash
npm exec --workspace @treequest/web -- vite --host 0.0.0.0
```

Also set the web client's VITE_SUPABASE_URL to the Mac LAN URL and restart Vite, then open http://MAC_IP:5173 on the phone. This is a responsive web demo, separate from Expo native. Browser GPS/camera may require HTTPS beyond localhost.

## 10. Watering rewards require another interaction

Live readings update tree status; this bridge does not automate session pairing or watering evidence. Your repo deliberately requires all of these:

1. Fresh low reading and an eligible request.
2. Signed-in player starts a care session near the tree.
3. Device discovers/selects that physical interaction's session through device-sessions.
4. A new post-session partial reading is accepted, showing sufficient rise but still below recovery.
5. Device submits moisture_increase evidence referring to that reading's external_event_id.
6. A later fresh reading reaches recovery while session/evidence are valid.

Moving a probe from dry to fully wet can jump past the evidence stage. In current game code, recovery received before valid evidence resolves the request without points. Do not fabricate a partial reading or an explicit watering event to work around this. Pair the session and send evidence during a real gradual rise, or add an independently verified physical watering detector. Sensor fluctuation alone is not robust real-world proof of an individual person's action.

From Pi, discover active sessions:

```bash
curl --fail-with-body "$TREEQUEST_API_URL/device-sessions" \
  -H 'Content-Type: application/json' \
  -H "X-Device-Key: $TREEQUEST_DEVICE_KEY" \
  -d "{\"device_id\":\"$TREEQUEST_DEVICE_ID\",\"tree_id\":\"$TREEQUEST_TREE_ID\"}"
```

Select only the session corresponding to the actual player interaction. After the bridge reports an accepted real partial reading, set SESSION_ID and SENSOR_EVENT_ID to that session and the returned reading external_event_id. Create the evidence file with real IDs and current time:

```bash
export SESSION_ID='the-selected-session-uuid'
export SENSOR_EVENT_ID='the-accepted-partial-reading-event-id'
python3 - <<'PY'
import os,json,uuid
from datetime import datetime,timezone
payload={
 'external_event_id':str(uuid.uuid4()),
 'device_id':os.environ['TREEQUEST_DEVICE_ID'],
 'tree_id':os.environ['TREEQUEST_TREE_ID'],
 'session_id':os.environ['SESSION_ID'],
 'timestamp':datetime.now(timezone.utc).isoformat(),
 'evidence_type':'moisture_increase',
 'sensor_event_id':os.environ['SENSOR_EVENT_ID']}
with open('watering-evidence.json','w') as f:json.dump(payload,f)
PY
curl --fail-with-body "$TREEQUEST_API_URL/watering-evidence" \
  -H 'Content-Type: application/json' \
  -H "X-Device-Key: $TREEQUEST_DEVICE_KEY" \
  --data-binary @watering-evidence.json
```

Retry the same file after transient failure. Do not regenerate its ID/timestamp for the same retry. Response must show verified=true before later recovery; a new stronger physical observation needs a new event and payload. For a reliable final product, move this pairing/evidence flow into a tested gateway state machine; manual commands are integration debugging, not a polished user flow.

Seed tree coordinates are fictional New York locations. Local demo can explicitly simulate location. A connected Rutgers demonstration needs an authorized tree/territory at the actual location and real phone location permission; otherwise the 50 m proximity check rejects it. Do not describe the seeded map/GPS as real deployment.

## 11. Live provider / hosted setup

Once local readings work, choose a single Supabase project for both clients and the Pi. For hosted Supabase, run from Mac repo root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Apply migrations only, without seed.sql or demo reset commands. Create real species profiles, territory polygons and trees; register a device with a real secret through your admin workflow. The repo docs/HARDWARE.md gives the INSERT shape; its UUID placeholders must be replaced with existing tree IDs and a generated device UUID. Hash a generated secret with SHA-256; store only its digest in devices.key_hash and provision the original privately to Pi. can_report_health should remain false for this probe.

Set both clients' URL/key to that same hosted project and mode to connected. The public project key comes from Supabase project API settings; it is not the device secret. Set Pi TREEQUEST_API_URL=https://PROJECT.supabase.co/functions/v1/api, its registered UUIDs and TREEQUEST_DEVICE_KEY. Optionally TREEQUEST_PUBLIC_KEY supplies the project public/anon apikey header.

Copy supabase/.env.example to an ignored supabase/.env.connected file. Fill it privately:

| Setting | Source / purpose |
|---|---|
| APP_MODE=connected | Enables real provider paths |
| GEMINI_API_KEY / GEMINI_MODEL | Your Google AI Studio key and enabled image-capable model |
| ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID | Your ElevenLabs key and accessible voice |
| Optional personality voice IDs | WARM, WATCHFUL, QUIET, SOLEMN variants |
| TIGER_DATABASE_URL | Tiger Data TLS PostgreSQL connection string |
| WORKER_SECRET | Generate a private random value; same value in backend and Vault |

```bash
npx supabase secrets set --env-file supabase/.env.connected
npx supabase functions deploy
```

For local Edge Functions with real providers, use supabase/.env.local (the file npm run backend actually loads), APP_MODE=connected, client modes connected and database game_config.demo_mode=false. Ensure the data/location is appropriate; adding API keys while still in demo mode does not activate the real providers.

With PostgreSQL client psql available and TIGER_DATABASE_URL exported privately:

```bash
psql "$TIGER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tiger/setup.sql
```

Follow docs/OPERATIONS.md to configure Vault secrets treequest_functions_url=https://PROJECT.supabase.co/functions/v1 and treequest_worker_secret matching WORKER_SECRET. Inspect existing Vault entries before creating; rotate through vault.update_secret when present. Confirm cron and delivery queue completion. Supabase is current state; Tiger is delivered history. Missing provider credentials may leave templates/no voice/unavailable history even when sensors work.

After hosting, Mac no longer needs local Docker or npm run backend for the hosted stack. Mac still runs Vite/Metro during development, or deploy apps/web/dist after npm run build. Native app publication is separate. If opening a hosted web app, use HTTPS backend URLs rather than a private HTTP Pi address.

## 12. Final startup checklist

Local: power Pi/Uno → launch Docker on Mac → npx supabase start → backend terminal → web terminal → Pi live bridge → optional Expo terminal → verify actual tree timestamp/readings → test voice/provider source → test one physical watering session if evidence integration is ready.

Hosted: power Pi/Uno → Pi live bridge to hosted API → open deployed web/native app → check recent tree timestamp and delivery queue. Scheduled workers run in the database; there is no separate worker terminal after correct setup.

Common failures: raw_accepted but unchanged map = raw branch only; numeric-temperature error = missing sensor or incomplete null support; 401 = key/mapping mismatch; 404 = wrong API base (missing /api for locally served router); timeout = wrong Mac IP/firewall/client isolation; future_timestamp = Pi clock; outside_proximity = wrong location; healthy but zero points = missing/late evidence or no valid session.

## Sources and validation boundaries

Repo: README.md, docs/HARDWARE.md, docs/OPERATIONS.md, package.json, packages/shared/src/index.ts, supabase/functions/api/index.ts, supabase/seed.sql, schema/game migrations and tiger/setup.sql. https://github.com/Preeyam183/TalkingTrees

Supabase CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
Expo development: https://docs.expo.dev/get-started/start-developing/

The new bridge is a separate adapter supplied with this guide, not code already committed to your repo. Conversion, payload validation and HTTP request/retry behavior were checked locally. Actual USB, your Supabase deployment, temperature sensor, native device and live provider credentials were not exercised here. Use the staged checks above to validate those integrations.
