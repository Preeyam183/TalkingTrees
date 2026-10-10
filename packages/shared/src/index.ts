import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export { z };
export const DEMO_PASSWORD = "TreeQuest-demo-2026";
export const eventBase = z.object({
  external_event_id: z.string().min(1).max(128),
  device_id: z.string().uuid(),
  tree_id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
});
export const readingSchema = eventBase
  .extend({
    soil_moisture_pct: z.number().min(0).max(100),
    temperature_c: z.number().min(-60).max(85),
  })
  .strict();
export const evidenceSchema = eventBase
  .extend({
    session_id: z.string().uuid(),
    evidence_type: z.enum(["moisture_increase", "explicit_watering_event"]),
    sensor_event_id: z.string().min(1).max(128),
  })
  .strict();
export const healthSchema = eventBase
  .extend({
    status: z.literal("dead"),
    confirmed: z.literal(true),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const sessionSchema = locationSchema
  .extend({
    tree_id: z.string().uuid(),
    request_id: z.string().uuid(),
    idempotency_key: z.string().uuid(),
  })
  .strict();
export type Tree = {
  id: string;
  name: string;
  species_id: string | null;
  species_name: string | null;
  territory_id: string;
  photo_path: string | null;
  owner_id: string | null;
  status: "healthy" | "thirsty" | "unknown" | "dead" | "inactive";
  moisture: number | null;
  temperature: number | null;
  reading_at: string | null;
  updated_at: string;
  lat: number;
  lng: number;
  thirst_pct: number | null;
  recovery_pct: number | null;
  request_id: string | null;
};
export type Player = {
  id: string;
  display_name: string;
  color: string;
  points: number;
  owned_trees: number;
};
export type Territory = {
  id: string;
  name: string;
  owner_id: string | null;
  geojson: { type: "Polygon"; coordinates: number[][][] };
  tree_count: number;
  leader_tree_count: number;
  leader_id: string | null;
  leader_tree_ids: string[];
  leader_share: number;
};
export type WateringSession = {
  id: string;
  tree_id: string;
  request_id: string;
  player_id: string;
  baseline_pct: number;
  expires_at: string;
  status: string;
};
export type InsightResponse = {
  answer: string;
  source: string;
  period: { from: string; to: string; timezone: string };
  comparison_period?: { from: string; to: string };
  queried_at: string;
  tree_ids: string[];
  statistics: Record<string, unknown>[];
  freshness: Record<string, unknown>[];
  delivery: {
    pending: number;
    failed: number;
    oldest_outstanding: string | null;
  };
  complete: boolean;
  warnings: string[];
};
export function makeClient(
  url: string,
  key: string,
  options?: Parameters<typeof createClient>[2],
) {
  return createClient(url, key, options);
}
export function createApi(
  client: SupabaseClient,
  url: string,
  key: string,
  uuid: () => string = () => crypto.randomUUID(),
) {
  async function call<T = any>(path: string, body: unknown = {}): Promise<T> {
    const { data } = await client.auth.getSession();
    const res = await fetch(`${url}/functions/v1/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${data.session?.access_token ?? key}`,
      },
      body: JSON.stringify(body),
    });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error ?? "Request failed");
    return value;
  }
  return {
    call,
    async snapshot() {
      const results = await Promise.all([
        client.from("tree_map").select("*"),
        client.from("territory_map").select("*"),
        client
          .from("leaderboard")
          .select("*")
          .order("points", { ascending: false }),
        client.from("species").select("*"),
        client.from("game_config").select("*").single(),
      ]);
      for (const r of results) if (r.error) throw r.error;
      return {
        trees: results[0].data as unknown as Tree[],
        territories: results[1].data as unknown as Territory[],
        players: results[2].data as unknown as Player[],
        species: results[3].data as any[],
        config: results[4].data as any,
      };
    },
    async uploadPhoto(
      blob: Blob | ArrayBuffer,
      extension = "jpg",
      contentType = "image/jpeg",
    ) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) throw new Error("Sign in first");
      const path = `${user.id}/${uuid()}.${extension}`;
      const { error } = await client.storage
        .from("tree-photos")
        .upload(path, blob, { contentType });
      if (error) throw error;
      return path;
    },
  };
}
