import { db, config } from "./services.ts";
import {
  z,
  deriveTreePersonalityParams,
  sensorPacketSchema,
  moistureCalibrationSchema,
} from "../../../packages/shared/src/index.ts";

// No guessed horticultural ranges. Configure these per species and installed sensor.
const range = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([lo, hi]) => lo < hi);
const careSchema = z
  .object({
    temperatureField: z
      .enum(["air_temperature_c", "soil_temperature_c"])
      .optional(),
    comfortableTemperatureC: range.optional(),
    suitableLightRaw: range.optional(),
  })
  .strict();
export async function personalityParams(t: any) {
  const cfg = await config();
  const fresh = (at: string | null, seconds = cfg.stale_seconds) =>
    !!at &&
    Date.now() - Date.parse(at) >= -cfg.clock_skew_seconds * 1000 &&
    Date.now() - Date.parse(at) < seconds * 1000;
  const { data: species, error: se } = t.species_id
    ? await db
        .from("species")
        .select("name,personality_traits,dialogue_care_profile")
        .eq("id", t.species_id)
        .single()
    : { data: null, error: null };
  if (se) throw se;
  const { data: device, error: de } = await db
    .from("devices")
    .select("id,moisture_calibration")
    .eq("tree_id", t.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (de) throw de;
  const { data: raw, error: re } = device
    ? await db
        .from("hardware_readings")
        .select("payload,received_at")
        .eq("device_id", device.id)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (re) throw re;
  const useRaw =
    raw &&
    (!t.reading_at || Date.parse(raw.received_at) >= Date.parse(t.reading_at));
  const readingAt = useRaw ? raw.received_at : t.reading_at;
  const parsed = sensorPacketSchema.safeParse(
    useRaw
      ? raw.payload
      : {
          moisture_raw: t.moisture,
          air_temperature_c: t.temperature,
        },
  );
  const packet = fresh(readingAt) && parsed.success ? parsed.data : {};
  // Canonical values are already validated percentages; identity calibration is explicit.
  const c = moistureCalibrationSchema.safeParse(
    useRaw
      ? device?.moisture_calibration
      : { field: "moisture_raw", dryRaw: 0, wetRaw: 100 },
  );
  const care = careSchema.safeParse(species?.dialogue_care_profile ?? {});
  const profile = care.success ? care.data : {};
  const temperature = profile.temperatureField
    ? packet[profile.temperatureField]
    : null;
  const thermal =
    temperature == null || !profile.comfortableTemperatureC
      ? "unknown"
      : temperature < profile.comfortableTemperatureC[0]
        ? "cold"
        : temperature > profile.comfortableTemperatureC[1]
          ? "hot"
          : "comfortable";
  const light =
    packet.light_raw == null || !profile.suitableLightRaw
      ? "unknown"
      : packet.light_raw < profile.suitableLightRaw[0]
        ? "low"
        : packet.light_raw > profile.suitableLightRaw[1]
          ? "intense"
          : "suitable";
  const canonicalFresh = fresh(t.reading_at);
  let trend: "improving" | "stable" | "worsening" | "unknown" = "unknown";
  if (!useRaw && canonicalFresh && t.recovery_pct != null) {
    const { data: recent, error } = await db
      .from("sensor_readings")
      .select("soil_moisture_pct,recorded_at")
      .eq("tree_id", t.id)
      .lte("recorded_at", t.reading_at)
      .order("recorded_at", { ascending: false })
      .limit(2);
    if (error) throw error;
    if (
      recent?.length === 2 &&
      fresh(recent[1].recorded_at) &&
      recent[0].recorded_at !== recent[1].recorded_at
    ) {
      const distance = (v: number) => Math.max(0, Number(t.recovery_pct) - v);
      const delta =
        distance(recent[0].soil_moisture_pct) -
        distance(recent[1].soil_moisture_pct);
      trend = delta < 0 ? "improving" : delta > 0 ? "worsening" : "stable";
    }
  }
  const parameters = deriveTreePersonalityParams(
    packet,
    c.success ? c.data : null,
    {
      name: species?.name ?? "Unidentified tree",
      personalityTraits: species?.personality_traits ?? ["gentle", "observant"],
    },
    {
      // Only the existing hysteresis engine supplies moisture classification.
      moistureStatus: !canonicalFresh
        ? "unknown"
        : t.status === "thirsty"
          ? "thirsty"
          : t.status === "healthy"
            ? "okay"
            : "unknown",
      thermalStatus: thermal,
      lightStatus: light,
      // Raw packets have no device timestamp or normalization correlation; no defensible trend yet.
      trend,
      activeWateringRequest: !!t.request_id,
      wateringEligible:
        !!t.request_id &&
        t.status === "thirsty" &&
        t.recovery_pct != null &&
        fresh(t.reading_at, cfg.evidence_seconds),
      lifecycle:
        t.status === "dead"
          ? "dead"
          : t.status === "inactive"
            ? "inactive"
            : "active",
    },
  );
  return {
    ...parameters,
    reading_at: readingAt,
    reading_source: useRaw ? "raw_hardware_receipt" : "canonical_supabase",
  };
}
