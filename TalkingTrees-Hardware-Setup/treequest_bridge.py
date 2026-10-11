"""Uno USB -> TalkingTrees Supabase API. Not the older Rooted /api/readings bridge.

Monitor: python treequest_bridge.py --port PORT --monitor --samples 20
Raw:     python treequest_bridge.py --port PORT --mode raw
Live:    python treequest_bridge.py --port PORT --mode live --dry 150 --wet 800
Live requires actual temperature data because the current repo requires it.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import threading
import time
import urllib.error
import urllib.request
import uuid


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def decode_packet(line, hardware_id):
    packet = json.loads(line)
    if not isinstance(packet, dict) or packet.get('device_id') != hardware_id:
        raise ValueError('Unexpected hardware ID; expected ' + hardware_id)
    raw, seq = packet.get('adc_raw'), packet.get('seq')
    if type(raw) is not int or not 0 <= raw <= 1023:
        raise ValueError('adc_raw must be an Uno native count from 0 to 1023')
    if type(seq) is not int or seq < 0:
        raise ValueError('Invalid sequence')
    normalized = (raw * 65535 + 511) // 1023
    if packet.get('moisture_raw') != normalized:
        raise ValueError('Unexpected ADC scaling; use the supplied RootedUno sketch')
    return packet


def live_payload(packet, device_id, tree_id, dry, wet, timestamp=None, event_id=None):
    if not all(finite(x) and 0 <= x <= 1023 for x in (dry, wet)) or abs(wet-dry) < 32:
        raise ValueError('Use measured native dry/wet references separated by at least 32 counts')
    temperature = packet.get('air_temperature_c')
    if not finite(temperature) or not -60 <= temperature <= 85:
        raise ValueError('Live mode requires measured air_temperature_c. Current backend rejects null. Use --monitor or --mode raw until a verified temperature sensor works, or update backend null handling.')
    return {
        'external_event_id': event_id or str(uuid.uuid4()),
        'device_id': device_id,
        'tree_id': tree_id,
        'timestamp': timestamp or datetime.now(timezone.utc).isoformat(),
        'soil_moisture_pct': round(max(0, min(100, 100*(packet['adc_raw']-dry)/(wet-dry))), 3),
        'temperature_c': temperature,
    }


def db_open(path):
    db = sqlite3.connect(path, timeout=10)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, error TEXT)')
    db.commit()
    return db


def acquire(args, stop):
    import serial
    db = None if args.monitor else db_open(args.outbox)
    values = []
    try:
        while not stop.is_set():
            try:
                with serial.Serial(args.port, 115200, timeout=1) as link:
                    print('USB connected:', args.port, flush=True)
                    # Uno commonly resets on opening. Discard startup buffer before live timing.
                    if stop.wait(2): break
                    link.reset_input_buffer()
                    last_seq = None
                    while not stop.is_set():
                        line = link.readline().decode('utf-8', errors='replace').strip()
                        if not line: continue
                        try:
                            packet = decode_packet(line, args.hardware_id)
                            if packet['seq'] == last_seq: continue
                            last_seq = packet['seq']
                            if args.monitor:
                                print(json.dumps(packet), flush=True)
                                values.append(packet['adc_raw'])
                                if args.samples and len(values) >= args.samples:
                                    print('Native ADC median:', statistics.median(values), flush=True)
                                    stop.set(); break
                                continue
                            if args.mode == 'live':
                                payload = live_payload(packet, args.device_id, args.tree_id, args.dry, args.wet)
                            else:
                                # Strict server schema: forward only supported fields.
                                keys = ('device_id','seq','adc_raw','moisture_raw','air_temperature_c','soil_temperature_c','light_raw','pressure_pa')
                                payload = {k: packet[k] for k in keys if k in packet}
                            with db:
                                row = db.execute('INSERT INTO outbox(payload) VALUES (?)', ('{}',))
                                if args.mode == 'raw':
                                    # Server raw dedup is device+seq with no boot ID.
                                    # Persist a gateway sequence across Uno resets/reconnects.
                                    payload['seq'] = row.lastrowid
                                db.execute('UPDATE outbox SET payload=? WHERE id=?', (json.dumps(payload, allow_nan=False), row.lastrowid))
                        except (ValueError, TypeError) as error:
                            print('Sample not sent:', error, flush=True)
            except (serial.SerialException, OSError) as error:
                print('USB unavailable:', error, '— retrying', flush=True)
                stop.wait(2)
    except Exception as error:
        print('Reader stopped:', error, flush=True)
        stop.set()
    finally:
        if db is not None: db.close()


def post(url, key, public_key, payload):
    headers = {'Content-Type': 'application/json', 'X-Device-Key': key}
    if public_key: headers['apikey'] = public_key
    request = urllib.request.Request(url + '/sensor-readings', payload.encode(), headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    parser.add_argument('--monitor', action='store_true')
    parser.add_argument('--samples', type=int, default=0, help='In monitor mode, stop after N readings and print native ADC median')
    parser.add_argument('--mode', choices=['raw','live'], default='raw')
    parser.add_argument('--dry', type=float)
    parser.add_argument('--wet', type=float)
    parser.add_argument('--hardware-id', default='arduino-01')
    parser.add_argument('--device-id', default=os.getenv('TREEQUEST_DEVICE_ID'))
    parser.add_argument('--tree-id', default=os.getenv('TREEQUEST_TREE_ID'))
    parser.add_argument('--url', default=os.getenv('TREEQUEST_API_URL'))
    parser.add_argument('--outbox', default='treequest-outbox.sqlite3')
    args = parser.parse_args()
    stop = threading.Event()
    key = os.getenv('TREEQUEST_DEVICE_KEY', '')
    public_key = os.getenv('TREEQUEST_PUBLIC_KEY', '')
    db = None
    if not args.monitor:
        if not args.url or not key: parser.error('Set TREEQUEST_API_URL and TREEQUEST_DEVICE_KEY')
        args.url = args.url.rstrip('/')
        if args.mode == 'live':
            try:
                uuid.UUID(args.device_id); uuid.UUID(args.tree_id)
                if args.dry is None or args.wet is None: raise ValueError('Missing calibration')
                live_payload({'adc_raw':0,'air_temperature_c':20}, args.device_id,args.tree_id,args.dry,args.wet)
            except (ValueError,TypeError,AttributeError):
                parser.error('Live mode needs valid TREEQUEST_DEVICE_ID/TREEQUEST_TREE_ID UUIDs and measured --dry/--wet native ADC references (gap >=32)')
        db = db_open(args.outbox)
        scope = json.dumps([args.url,args.hardware_id,args.device_id,args.tree_id,args.mode])
        prior = db.execute('SELECT value FROM config WHERE id=1').fetchone()
        if prior and prior[0] != scope:
            parser.error('Outbox belongs to a different device/backend/mode. Use a different --outbox file; preserve the old one for pending samples.')
        db.execute('INSERT OR IGNORE INTO config(id,value) VALUES (1,?)', (scope,)); db.commit()
    thread = threading.Thread(target=acquire, args=(args,stop), daemon=True)
    thread.start()
    try:
        while not stop.is_set():
            if args.monitor:
                stop.wait(.2); continue
            row = db.execute('SELECT id,payload FROM outbox WHERE error IS NULL ORDER BY id LIMIT 1').fetchone()
            if not row:
                stop.wait(.2); continue
            row_id, payload = row
            try:
                result = post(args.url,key,public_key,payload)
                with db: db.execute('DELETE FROM outbox WHERE id=?',(row_id,))
                print('Accepted:', json.dumps(result), flush=True)
            except urllib.error.HTTPError as error:
                body = error.read().decode(errors='replace')[:1000]
                print('HTTP',error.code,body,flush=True)
                if error.code in (400,409,422):
                    with db: db.execute('UPDATE outbox SET error=? WHERE id=?',(body,row_id))
                    print('Rejected payload retained in outbox with error; inspect/fix before continuing.',flush=True)
                elif error.code in (401,403):
                    print('Check device key, ID mapping, public key and revocation. Pending payloads preserved.',flush=True)
                    stop.set()
                else: stop.wait(5)
            except (OSError,ValueError) as error:
                print('Backend unavailable; queued readings retained:',error,flush=True)
                stop.wait(5)
    except KeyboardInterrupt:
        print('\nStopping. Pending readings remain in the outbox.')
    finally:
        stop.set();thread.join(timeout=3)
        if db:db.close()


if __name__ == '__main__':
    main()
