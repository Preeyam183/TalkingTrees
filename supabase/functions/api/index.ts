import {
  z,
  readingSchema,
  hardwareReadingSchema,
  evidenceSchema,
  healthSchema,
  sessionSchema,
  locationSchema,
  fallbackTreeMessage,
  validateTreeMessage,
  treeMessagePrompt,
  treeMessageJsonSchema,
} from "../../../packages/shared/src/index.ts";
import {
  db,
  rpc,
  config,
  gemini,
  isDemo,
  runDelivery,
  elevenLabsVoiceId,
  personalityForTree,
} from "../_shared/services.ts";
import { personalityParams } from "../_shared/personality.ts";
import { insights } from "../_shared/insights.ts";
import { chat, transcribe } from "../_shared/conversation.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-device-key, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function authenticateDevice(req: Request, p: any) {
  const key = req.headers.get("X-Device-Key");
  if (!key) throw new Error("unauthorized_device");
  const { data, error } = await db
    .from("devices")
    .select("id,tree_id,key_hash,can_report_health")
    .eq("id", p.device_id)
    .is("revoked_at", null)
    .single();
  if (
    error ||
    !data ||
    data.tree_id !== p.tree_id ||
    data.key_hash !== (await digest(key))
  )
    throw new Error("unauthorized_device");
  return data;
}
async function authenticateHardware(req: Request, hardwareId: string) {
  const key = req.headers.get("X-Device-Key");
  if (!key) throw new Error("unauthorized_device");
  const { data, error } = await db
    .from("devices")
    .select("id,tree_id,key_hash")
    .eq("hardware_id", hardwareId)
    .is("revoked_at", null)
    .single();
  if (error || !data || data.key_hash !== (await digest(key)))
    throw new Error("unauthorized_device");
  return data;
}
async function user(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("unauthorized");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}
async function dialogue(tree_id: string) {
  const { data: t, error } = await db
    .from("tree_map")
    .select("*")
    .eq("id", tree_id)
    .single();
  if (error) throw error;
  const parameters = await personalityParams(t);
  const personality = personalityForTree({
    status:
      parameters.lifecycle === "dead"
        ? "dead"
        : parameters.mood === "uncertain"
          ? "unknown"
          : parameters.mood === "concerned"
            ? "thirsty"
            : "healthy",
  });
  const fingerprint = await digest(
    JSON.stringify({
      version: 2,
      parameters,
      model: Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash",
      demo: await isDemo(),
    }),
  );
  const { data: cached } = await db
    .from("tree_dialogue")
    .select("*")
    .eq("tree_id", tree_id)
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (cached) return { ...cached, parameters, mood: parameters.mood };
  let message = fallbackTreeMessage(parameters);
  let source = "template";
  let tone = "gentle";
  if (!(await isDemo()))
    try {
      const g = validateTreeMessage(
        await gemini(
          treeMessagePrompt(parameters),
          undefined,
          treeMessageJsonSchema,
        ),
        parameters,
      );
      if (g) {
        message = g.message;
        tone = g.tone;
        source = "gemini";
      }
    } catch {
      /* deterministic fallback */
    }
  const value = {
    tree_id,
    fingerprint,
    personality,
    tone,
    message,
    source,
    updated_at: new Date().toISOString(),
    audio_path: null,
  };
  await db.from("tree_dialogue").upsert(value);
  return { ...value, parameters, mood: parameters.mood, tone };
}
async function simulate(p: any, player: string) {
  if (!(await isDemo())) throw new Error("simulator_disabled");
  const body = z
    .object({
      action: z.enum([
        "reading",
        "partial",
        "complete",
        "death",
        "deliver",
        "reset",
      ]),
      tree_id: z.string().uuid().optional(),
      session_id: z.string().uuid().optional(),
      moisture: z.number().min(0).max(100).optional(),
    })
    .strict()
    .parse(p);
  if (body.action === "deliver") return runDelivery();
  if (body.action === "reset") return rpc("reset_demo");
  if (!body.tree_id) throw new Error("tree_id required");
  const { data: d, error } = await db
    .from("devices")
    .select("*")
    .eq("tree_id", body.tree_id)
    .single();
  if (error) throw error;
  const base = () => ({
    external_event_id: crypto.randomUUID(),
    device_id: d.id,
    tree_id: d.tree_id,
    timestamp: new Date().toISOString(),
  });
  if (body.action === "death")
    return rpc("report_health", {
      p: {
        ...base(),
        status: "dead",
        confirmed: true,
        reason: "Developer simulator confirmed death",
      },
    });
  if (body.action === "reading")
    return rpc("ingest_reading", {
      p: {
        ...base(),
        soil_moisture_pct: body.moisture ?? 22,
        temperature_c: 21,
      },
    });
  if (!body.session_id) throw new Error("Start a watering session first");
  const { data: s } = await db
    .from("watering_sessions")
    .select("*")
    .eq("id", body.session_id)
    .eq("player_id", player)
    .single();
  if (!s) throw new Error("session_not_found");
  const { data: t } = await db
    .from("tree_map")
    .select("*")
    .eq("id", body.tree_id)
    .single();
  // First register a post-session partial reading; authenticated explicit evidence precedes recovery.
  const partial = {
    ...base(),
    soil_moisture_pct: Math.min(
      (t?.recovery_pct ?? 45) - 1,
      s.baseline_pct + 2,
    ),
    temperature_c: 21,
  };
  await rpc("ingest_reading", { p: partial });
  const evidence = {
    ...base(),
    session_id: s.id,
    evidence_type: "explicit_watering_event",
    sensor_event_id: partial.external_event_id,
  };
  const result = await rpc("submit_evidence", { p: evidence });
  if (body.action === "partial") return result;
  return rpc("ingest_reading", {
    p: {
      ...base(),
      soil_moisture_pct: t?.recovery_pct ?? 45,
      temperature_c: 21,
    },
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const route = new URL(req.url).pathname.split("/").filter(Boolean).at(-1)!;
    const p = await req.json();
    if (route === "delivery-worker") {
      const expected = Deno.env.get("WORKER_SECRET");
      if (!expected || req.headers.get("X-Worker-Secret") !== expected)
        return json({ error: "unauthorized" }, 401);
      return json(await runDelivery());
    }
    if (
      [
        "sensor-readings",
        "watering-evidence",
        "tree-health-events",
        "device-sessions",
      ].includes(route)
    ) {
      if (route === "sensor-readings") {
        const raw = hardwareReadingSchema.safeParse(p);
        if (raw.success) {
          const device = await authenticateHardware(req, raw.data.device_id);
          const data = await rpc("accept_hardware_reading", {
            p_device: device.id,
            p_seq: raw.data.seq,
            p_payload: raw.data,
          });
          return json({
            status: "raw_accepted",
            hardware_reading_id: data.id,
            device_id: data.device_id,
            tree_id: device.tree_id,
            seq: data.sequence_number,
            received_at: data.received_at,
          });
        }
      }
      const schema =
        route === "sensor-readings"
          ? readingSchema
          : route === "watering-evidence"
            ? evidenceSchema
            : route === "tree-health-events"
              ? healthSchema
              : z
                  .object({
                    device_id: z.string().uuid(),
                    tree_id: z.string().uuid(),
                  })
                  .strict();
      const body = schema.parse(p);
      const device = await authenticateDevice(req, body);
      if (route === "device-sessions") {
        const { data, error } = await db
          .from("watering_sessions")
          .select("id,tree_id,request_id,started_at,expires_at")
          .eq("tree_id", device.tree_id)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString());
        if (error) throw error;
        return json({ sessions: data });
      }
      if (route === "tree-health-events" && !device.can_report_health)
        return json({ error: "health_permission_denied" }, 403);
      return json(
        await rpc(
          route === "sensor-readings"
            ? "ingest_reading"
            : route === "watering-evidence"
              ? "submit_evidence"
              : "report_health",
          { p: body },
        ),
      );
    }
    const u = await user(req);
    if (route === "watering-sessions")
      return json(
        await rpc("start_watering", {
          p_player: u.id,
          p: sessionSchema.parse(p),
        }),
      );
    if (route === "rename-tree") {
      const body = z
        .object({
          tree_id: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
        })
        .strict()
        .parse(p);
      return json(
        await rpc("rename_tree", {
          p_player: u.id,
          p_tree: body.tree_id,
          p_name: body.name,
        }),
      );
    }
    if (route === "tree-insights") return json(await insights(u.id, p));
    if (route === "tree-chat") return json(await chat(u.id, p));
    if (route === "transcribe") return json(await transcribe(p));
    if (route === "simulator") return json(await simulate(p, u.id));
    if (route === "register-tree") {
      const body = locationSchema
        .extend({
          name: z.string().min(1).max(80),
          species_id: z.string().uuid().nullable(),
          photo_path: z.string().min(1),
          confirm_new: z.boolean().default(false),
        })
        .strict()
        .parse(p);
      return json(await rpc("register_tree", { p_player: u.id, p: body }));
    }
    if (route === "identify-tree") {
      const { photo_path, lat, lng } = z
        .object({
          photo_path: z.string().startsWith(`${u.id}/`),
          lat: locationSchema.shape.lat.optional(),
          lng: locationSchema.shape.lng.optional(),
        })
        .strict()
        .refine(
          (v) => (v.lat === undefined) === (v.lng === undefined),
          "Both location coordinates are required",
        )
        .parse(p);
      async function identified(value: Record<string, unknown>) {
        let candidates: Record<string, unknown>[] = [];
        if (lat !== undefined && lng !== undefined) {
          const cfg = await config();
          const radius = Math.min(cfg.proximity_m, 100);
          const latDelta = radius / 111000;
          const lngDelta =
            latDelta / Math.max(0.001, Math.cos((lat * Math.PI) / 180));
          const result = await db
            .from("tree_map")
            .select("*")
            .gte("lat", lat - latDelta)
            .lte("lat", lat + latDelta)
            .gte("lng", lng - lngDelta)
            .lte("lng", lng + lngDelta);
          if (result.error) throw result.error;
          const nearby = result.data
            .map((t) => {
              const radians = Math.PI / 180;
              const a =
                Math.sin(((t.lat - lat) * radians) / 2) ** 2 +
                Math.cos(lat * radians) *
                  Math.cos(t.lat * radians) *
                  Math.sin(((t.lng - lng) * radians) / 2) ** 2;
              return {
                ...t,
                distance_m: Math.round(
                  6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))),
                ),
              };
            })
            .filter((t) => t.distance_m <= radius)
            .sort((a, b) => a.distance_m - b.distance_m)
            .slice(0, 10);
          const owners = [
            ...new Set(nearby.map((t) => t.owner_id).filter(Boolean)),
          ];
          const profiles = owners.length
            ? await db
                .from("profiles")
                .select("id,display_name")
                .in("id", owners)
            : { data: [], error: null };
          if (profiles.error) throw profiles.error;
          candidates = nearby.map((t) => ({
            ...t,
            caretaker:
              profiles.data?.find((o) => o.id === t.owner_id)?.display_name ??
              null,
          }));
        }
        return json({
          ...value,
          candidates,
          match_note:
            lat === undefined
              ? "Enable location to find nearby database records. A photo identifies species, not a unique tree."
              : "Nearby database records are candidates. Confirm the physical tree; species recognition does not prove identity or health.",
        });
      }
      const { data: blob, error } = await db.storage
        .from("tree-photos")
        .download(photo_path);
      if (error || !blob) throw new Error("Photo unavailable");
      if (
        blob.size > 10485760 ||
        !["image/jpeg", "image/png", "image/webp"].includes(blob.type)
      )
        throw new Error("Unsupported image");
      if (await isDemo())
        return identified({
          species_name: "Red maple",
          description:
            "Simulated identification. Confirm or choose a different species.",
          uncertain: true,
          source: "simulated",
        });
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const identificationSchema = {
          type: "object",
          properties: {
            species_name: { type: "string", nullable: true },
            description: { type: "string", maxLength: 1000 },
            uncertain: { type: "boolean" },
          },
          required: ["species_name", "description", "uncertain"],
          additionalProperties: false,
        };
        const g = await gemini(
          "Identify the tree or plant species in this photo. Return only the requested JSON. Use species_name=null and uncertain=true when the image is ambiguous. Never provide a confidence percentage, care advice, or invented environmental facts.",
          { data: btoa(binary), mimeType: blob.type },
          identificationSchema,
        );
        return identified({
          ...z
            .object({
              species_name: z.string().nullable(),
              description: z.string().max(1000),
              uncertain: z.boolean(),
            })
            .parse(g),
          source: "gemini",
        });
      } catch {
        return identified({
          species_name: null,
          description:
            "Identification unavailable. Choose a species or leave unidentified.",
          uncertain: true,
          source: "unavailable",
        });
      }
    }
    if (route === "tree-dialogue" || route === "tree-voice") {
      const { tree_id } = z
        .object({ tree_id: z.string().uuid() })
        .strict()
        .parse(p);
      const d = await dialogue(tree_id);
      if (route === "tree-dialogue") return json(d);
      if (await isDemo())
        return json({
          message: d.message,
          url: null,
          source: "simulated",
          reason: "Use labeled device speech in demo mode.",
        });
      const key = Deno.env.get("ELEVENLABS_API_KEY"),
        voice = elevenLabsVoiceId(d.personality);
      if (!key || !voice)
        return json({ message: d.message, url: null, source: "unavailable" });
      const audioFingerprint = await digest(
        `${d.fingerprint}:${voice}:${Deno.env.get("ELEVENLABS_MODEL") || "eleven_multilingual_v2"}`,
      );
      if (d.audio_path && d.audio_fingerprint === audioFingerprint)
        return json({
          message: d.message,
          url: db.storage.from("tree-audio").getPublicUrl(d.audio_path).data
            .publicUrl,
          source: "elevenlabs",
        });
      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
          {
            method: "POST",
            headers: { "xi-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: d.message,
              model_id:
                Deno.env.get("ELEVENLABS_MODEL") || "eleven_multilingual_v2",
            }),
            signal: AbortSignal.timeout(20000),
          },
        );
        if (!response.ok) throw new Error("Voice unavailable");
        const path = `${tree_id}/${audioFingerprint}.mp3`;
        const { error } = await db.storage
          .from("tree-audio")
          .upload(path, await response.arrayBuffer(), {
            contentType: "audio/mpeg",
            upsert: true,
          });
        if (error) throw error;
        await db
          .from("tree_dialogue")
          .update({ audio_path: path, audio_fingerprint: audioFingerprint })
          .eq("tree_id", tree_id)
          .eq("fingerprint", d.fingerprint);
        return json({
          message: d.message,
          url: db.storage.from("tree-audio").getPublicUrl(path).data.publicUrl,
          source: "elevenlabs",
        });
      } catch {
        return json({ message: d.message, url: null, source: "unavailable" });
      }
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    console.error(message);
    return json(
      { error: message },
      message.includes("unauthorized")
        ? 401
        : message.includes("conflict")
          ? 409
          : message.includes("unavailable")
            ? 503
            : 400,
    );
  }
});
