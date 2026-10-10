import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
export async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function config() {
  const { data, error } = await db.from("game_config").select("*").single();
  if (error) throw error;
  return data;
}
export async function isDemo() {
  return (
    Deno.env.get("APP_MODE") === "demo" && (await config()).demo_mode === true
  );
}
export async function gemini(
  prompt: string,
  image?: { data: string; mimeType: string },
  schema?: Record<string, unknown>,
) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("Gemini unavailable");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash"}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              ...(image ? [{ inlineData: image }] : []),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          ...(schema ? { responseJsonSchema: schema } : {}),
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error("Gemini unavailable");
  const r = await response.json();
  return JSON.parse(r.candidates[0].content.parts[0].text);
}
export function tiger() {
  const url = Deno.env.get("TIGER_DATABASE_URL");
  if (!url) throw new Error("Tiger Data unavailable");
  return postgres(url, {
    max: 1,
    ssl: "require",
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
}
export async function runDelivery() {
  const items = await rpc("claim_deliveries", { p_limit: 100 });
  const demo = await isDemo();
  let delivered = 0;
  for (const item of items) {
    let error: string | null = null;
    try {
      if (!demo) {
        const sql = tiger();
        try {
          const r = item.reading;
          await sql`insert into sensor_history(reading_id,tree_id,device_id,recorded_at,soil_moisture_pct,temperature_c) values(${r.id},${r.tree_id},${r.device_id},${r.recorded_at},${r.soil_moisture_pct},${r.temperature_c}) on conflict(reading_id,recorded_at) do nothing`;
        } finally {
          await sql.end();
        }
      }
      delivered++;
    } catch (e) {
      error = e instanceof Error ? e.message : "Delivery failed";
    }
    await rpc("finish_delivery", {
      p_id: item.id,
      p_token: item.lease_token,
      p_error: error,
    });
  }
  return {
    claimed: items.length,
    delivered,
    source: demo ? "simulated" : "tiger",
  };
}
export async function readHistory(ids: string[], from: string, to: string) {
  if (!ids.length) return [];
  if (await isDemo()) {
    const all: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("sensor_readings")
        .select(
          "tree_id,recorded_at,soil_moisture_pct,temperature_c,sensor_delivery_queue!inner(state)",
        )
        .in("tree_id", ids)
        .gte("recorded_at", from)
        .lte("recorded_at", to)
        .eq("sensor_delivery_queue.state", "delivered")
        .order("recorded_at")
        .range(offset, offset + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
      if (all.length > 100000)
        throw new Error("Too many readings; narrow the date range");
    }
    return all.map((r) => ({
      ...r,
      recorded_at: new Date(r.recorded_at).toISOString(),
    }));
  }
  const sql = tiger();
  try {
    const rows =
      await sql`select tree_id,recorded_at,soil_moisture_pct,temperature_c from sensor_history where tree_id=any(${ids}::uuid[]) and recorded_at>=${from}::timestamptz and recorded_at<=${to}::timestamptz order by recorded_at limit 100001`;
    if (rows.length > 100000)
      throw new Error("Too many readings; narrow the date range");
    return rows.map((r) => ({
      ...r,
      recorded_at: new Date(r.recorded_at).toISOString(),
    }));
  } finally {
    await sql.end();
  }
}
