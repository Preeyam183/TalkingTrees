import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const enabled = process.env.INTEGRATION === "1";
const sql = postgres(
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  { max: 6 },
);
const tree = "40000000-0000-4000-8000-000000000002",
  device = "50000000-0000-4000-8000-000000000002",
  player = "10000000-0000-4000-8000-000000000001",
  rival = "10000000-0000-4000-8000-000000000002";
const base = () => ({
  external_event_id: randomUUID(),
  device_id: device,
  tree_id: tree,
  timestamp: new Date().toISOString(),
});
async function read(moisture: number) {
  const p = { ...base(), soil_moisture_pct: moisture, temperature_c: 21 };
  const [r] = await sql`select ingest_reading(${sql.json(p)}) result`;
  return { p, result: r.result };
}
async function start(who = player) {
  const [t] = await sql`select * from tree_map where id=${tree}`;
  const p = {
    tree_id: tree,
    request_id: t.request_id,
    lat: t.lat,
    lng: t.lng,
    idempotency_key: randomUUID(),
  };
  const [r] =
    await sql`select start_watering(${who}::uuid,${sql.json(p)}) result`;
  return r.result;
}
async function evidence(
  session: string,
  sensor: string,
  type = "explicit_watering_event",
) {
  const p = {
    ...base(),
    session_id: session,
    sensor_event_id: sensor,
    evidence_type: type,
  };
  const [r] = await sql`select submit_evidence(${sql.json(p)}) result`;
  return { p, result: r.result };
}
describe.skipIf(!enabled)("local database + edge integration", () => {
  let client: any, token: string, anon: string, url: string;
  beforeAll(async () => {
    const s = JSON.parse(
      execFileSync("npx", ["supabase", "status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    anon = s.ANON_KEY;
    url = s.API_URL;
    client = createClient(url, anon);
    const { data, error } = await client.auth.signInWithPassword({
      email: "player1@treequest.local",
      password: "TreeQuest-demo-2026",
    });
    if (error) throw error;
    token = data.session.access_token;
  });
  beforeEach(async () => {
    await sql`select reset_demo()`;
    await sql`update game_config set evidence_seconds=120,stale_seconds=1800,session_seconds=300`;
  });
  afterAll(async () => {
    await sql`select reset_demo()`;
    await sql.end();
  });
  it("does not allow healthy-tree sessions", async () => {
    await read(60);
    await expect(start()).rejects.toThrow(/ineligible/);
  });
  it("awards nothing for partial evidence; recovery transfers tree and territory exactly once", async () => {
    const s = await start();
    const partial = await read(24);
    const e = await evidence(s.id, partial.p.external_event_id);
    expect(e.result.verified).toBe(true);
    expect(e.result.points).toBe(0);
    let [points] = await sql`select count(*)::int n from point_events`;
    expect(points.n).toBe(0);
    const recovery = await read(43);
    expect(recovery.result.completed).toBe(true);
    const [t] = await sql`select owner_id from trees where id=${tree}`;
    expect(t.owner_id).toBe(player);
    const [territory] =
      await sql`select owner_id from territories where id='30000000-0000-4000-8000-000000000001'`;
    expect(territory.owner_id).toBe(player);
    await sql`select ingest_reading(${sql.json(recovery.p)})`;
    await sql`select submit_evidence(${sql.json(e.p)})`;
    [points] = await sql`select count(*)::int n from point_events`;
    expect(points.n).toBe(1);
  });
  it("moisture-increase evidence still requires the recovery threshold", async () => {
    const s = await start();
    const partial = await read(29);
    const e = await evidence(
      s.id,
      partial.p.external_event_id,
      "moisture_increase",
    );
    expect(e.result.verified).toBe(true);
    expect(e.result.completed).toBe(false);
    expect((await read(43)).result.completed).toBe(true);
  });
  it("recovery without evidence closes without reward; late evidence cannot capture", async () => {
    const s = await start();
    const r = await read(43);
    expect(r.result.completed).toBe(false);
    await expect(evidence(s.id, r.p.external_event_id)).rejects.toThrow(
      /inactive/,
    );
    const [p] = await sql`select count(*)::int n from point_events`;
    expect(p.n).toBe(0);
  });
  it("rejects conflicting replay and out-of-order state regression", async () => {
    const reading = await read(23);
    await expect(
      sql`select ingest_reading(${sql.json({ ...reading.p, soil_moisture_pct: 24 })})`,
    ).rejects.toThrow(/conflict/);
    await sql`select ingest_reading(${sql.json({ ...base(), timestamp: new Date(Date.now() - 3600000).toISOString(), soil_moisture_pct: 60, temperature_c: 20 })})`;
    const [t] = await sql`select moisture from trees where id=${tree}`;
    expect(Number(t.moisture)).toBe(23);
  });
  it("competing sessions cannot both capture one request", async () => {
    const a = await start(player),
      b = await start(rival);
    const r = await read(25);
    await Promise.all([
      evidence(a.id, r.p.external_event_id),
      evidence(b.id, r.p.external_event_id),
    ]);
    await Promise.all([read(43), read(44)]);
    const [p] =
      await sql`select count(*)::int n,sum(amount)::int total from point_events`;
    expect(p.n).toBe(1);
    expect(p.total).toBe(10);
  });
  it("death transition penalizes once even with a second event ID", async () => {
    const p = { ...base(), status: "dead", confirmed: true, reason: "test" };
    await sql`select report_health(${sql.json(p)})`;
    await sql`select report_health(${sql.json(p)})`;
    await sql`select report_health(${sql.json({ ...p, external_event_id: randomUUID() })})`;
    const [n] =
      await sql`select count(*)::int n,sum(amount)::int total from point_events`;
    expect(n.n).toBe(1);
    expect(n.total).toBe(-20);
    const [t] = await sql`select status,owner_id from trees where id=${tree}`;
    expect(t.status).toBe("dead");
    expect(t.owner_id).toBeNull();
  });
  it("stale worker marks unknown and cancels active activity without death penalty", async () => {
    await start();
    await sql`update trees set reading_at=now()-interval '2 hours' where id=${tree}`;
    await sql`select expire_sensor_state()`;
    const [t] = await sql`select status from trees where id=${tree}`;
    expect(t.status).toBe("unknown");
    const [s] =
      await sql`select status from watering_sessions where tree_id=${tree}`;
    expect(s.status).toBe("cancelled");
    expect((await sql`select count(*)::int n from point_events`)[0].n).toBe(0);
  });
  it("expired sessions cannot complete", async () => {
    const s = await start();
    await sql`update watering_sessions set expires_at=now()-interval '1 second' where id=${s.id}`;
    const r = await read(25);
    await expect(evidence(s.id, r.p.external_event_id)).rejects.toThrow(
      /inactive/,
    );
  });
  it("rejects distant locations and a device associated with another tree", async () => {
    const [t] = await sql`select request_id from tree_map where id=${tree}`;
    await expect(
      sql`select start_watering(${player}::uuid,${sql.json({ tree_id: tree, request_id: t.request_id, lat: 0, lng: 0, idempotency_key: randomUUID() })})`,
    ).rejects.toThrow(/proximity/);
    await expect(
      sql`select ingest_reading(${sql.json({ ...base(), device_id: "50000000-0000-4000-8000-000000000001", soil_moisture_pct: 25, temperature_c: 20 })})`,
    ).rejects.toThrow(/association/);
  });
  it("leases are recoverable and stale worker acknowledgements do not overwrite new leases", async () => {
    await sql`update sensor_delivery_queue set state='delivered'`;
    const r = await read(23);
    const [claimed] = await sql`select claim_deliveries(1) item`;
    expect(claimed.item.reading_id).toBe(r.result.reading_id);
    await sql`update sensor_delivery_queue set lease_until=now()-interval '1 minute' where id=${claimed.item.id}`;
    const [retry] = await sql`select claim_deliveries(1) item`;
    expect(retry.item.lease_token).not.toBe(claimed.item.lease_token);
    await sql`select finish_delivery(${claimed.item.id},${claimed.item.lease_token},null)`;
    expect(
      (
        await sql`select state from sensor_delivery_queue where id=${claimed.item.id}`
      )[0].state,
    ).toBe("leased");
    await sql`select finish_delivery(${retry.item.id},${retry.item.lease_token},'temporary failure')`;
    expect(
      (
        await sql`select state from sensor_delivery_queue where id=${claimed.item.id}`
      )[0].state,
    ).toBe("pending");
  });
  it("RLS blocks ownership writes and RPC access for players", async () => {
    expect(
      (await client.from("trees").update({ owner_id: player }).eq("id", tree))
        .error,
    ).not.toBeNull();
    expect((await client.rpc("reset_demo")).error).not.toBeNull();
    expect((await client.from("devices").select("*")).error).not.toBeNull();
  });
  it("device endpoints authenticate separately, and user analytics exposes pending deliveries", async () => {
    const unauthorized = await fetch(`${url}/functions/v1/sensor-readings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        "X-Device-Key": "bad",
      },
      body: JSON.stringify({
        ...base(),
        soil_moisture_pct: 25,
        temperature_c: 20,
      }),
    });
    expect(unauthorized.status).toBe(401);
    const response = await fetch(`${url}/functions/v1/tree-insights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question: "How are my trees doing this week?",
        timezone: "America/New_York",
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.source).toBe("simulated");
    expect(body.tree_ids.length).toBe(7);
    expect(body.tree_ids).not.toContain(tree);
    expect(body.freshness).toHaveLength(7);
  });
  it("own-tree care and unowned claims use the same award transaction", async () => {
    for (const owner of [player, null]) {
      await sql`select reset_demo()`;
      await sql`update trees set owner_id=${owner} where id=${tree}`;
      const session = await start();
      const reading = await read(29);
      await evidence(session.id, reading.p.external_event_id);
      await read(43);
      const [t] = await sql`select owner_id from trees where id=${tree}`;
      expect(t.owner_id).toBe(player);
      expect(
        (await sql`select sum(amount)::int total from point_events`)[0].total,
      ).toBe(10);
    }
  });
  it("an empty territory cannot have an owner", async () => {
    await sql`update trees set status='inactive' where territory_id='30000000-0000-4000-8000-000000000001'`;
    await sql`select recalculate_territory('30000000-0000-4000-8000-000000000001')`;
    expect(
      (
        await sql`select owner_id from territories where id='30000000-0000-4000-8000-000000000001'`
      )[0].owner_id,
    ).toBeNull();
  });
  it("pending histories are excluded, the worker delivers them, and connected outages stay unavailable", async () => {
    await sql`update trees set owner_id=${player} where id=${tree}`;
    const r = await read(23);
    const ask = async () => {
      const response = await fetch(`${url}/functions/v1/tree-insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: "How are my trees doing this week?",
          timezone: "America/New_York",
        }),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const pending = await ask();
    expect(pending.delivery.pending).toBeGreaterThanOrEqual(1);
    expect(
      Date.parse(
        pending.freshness.find((f: any) => f.tree_id === tree)
          .latest_tiger_in_period,
      ),
    ).toBeLessThan(Date.parse(r.p.timestamp));
    const secret = readFileSync("supabase/.env.local", "utf8").match(
      /^WORKER_SECRET=(.+)$/m,
    )![1];
    const result = await fetch(`${url}/functions/v1/delivery-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": secret,
      },
      body: "{}",
    });
    expect(result.status).toBe(200);
    const delivered = await ask();
    expect(delivered.delivery.pending).toBe(0);
    expect(
      Date.parse(
        delivered.freshness.find((f: any) => f.tree_id === tree)
          .latest_tiger_in_period,
      ),
    ).toBe(Date.parse(r.p.timestamp));
    await sql`update game_config set demo_mode=false`;
    try {
      const unavailable = await ask();
      expect(unavailable.source).toBe("tiger");
      expect(unavailable.complete).toBe(false);
      expect(unavailable.answer).toContain("unavailable");
      expect(unavailable.statistics).toEqual([]);
    } finally {
      await sql`update game_config set demo_mode=true`;
    }
  });
  it("unsupported questions and an empty portfolio return explicit non-fabricated responses", async () => {
    const ask = async (question: string) => {
      const response = await fetch(`${url}/functions/v1/tree-insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question, timezone: "America/New_York" }),
      });
      return response.json();
    };
    const unsupported = await ask("Write a poem about someone else’s tree");
    expect(unsupported.statistics).toEqual([]);
    expect(unsupported.complete).toBe(false);
    await sql`update trees set owner_id=null where owner_id=${player}`;
    const empty = await ask("How are my trees doing this week?");
    expect(empty.tree_ids).toEqual([]);
    expect(empty.answer).toContain("do not currently own");
  });
});
