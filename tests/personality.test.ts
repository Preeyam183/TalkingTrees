import { describe, expect, it } from "vitest";
import {
  calibrateMoisture,
  deriveTreePersonalityParams,
  fallbackTreeMessage,
  hardwareReadingSchema,
  treeMessagePrompt,
  validateTreeMessage,
  type TrustedTreeState,
} from "../packages/shared/src/index";
const species = { name: "Birch", personalityTraits: ["lively", "curious"] };
const state: TrustedTreeState = {
  moistureStatus: "thirsty",
  thermalStatus: "hot",
  lightStatus: "intense",
  trend: "worsening",
  activeWateringRequest: true,
  wateringEligible: false,
};
const calibration = { field: "adc_raw" as const, dryRaw: 100, wetRaw: 500 };
const params = (
  packet = {},
  c: typeof calibration | null = calibration,
  s = state,
) => deriveTreePersonalityParams(packet, c, species, s);
describe("sensor-to-personality", () => {
  it("calibrates configured field in both directions and clamps endpoints", () => {
    expect(
      calibrateMoisture({ adc_raw: 200, moisture_raw: 17937 }, calibration),
    ).toBe(25);
    expect(
      calibrateMoisture(
        { adc_raw: 200 },
        { ...calibration, dryRaw: 500, wetRaw: 100 },
      ),
    ).toBe(75);
    expect(calibrateMoisture({ adc_raw: 900 }, calibration)).toBe(100);
    expect(calibrateMoisture({ adc_raw: 0 }, calibration)).toBe(0);
  });
  it("missing/equal calibration or missing input stays unknown", () => {
    for (const c of [null, { ...calibration, wetRaw: 100 }])
      expect(params({ adc_raw: 280 }, c).care_signals.moisture).toBe("unknown");
    expect(
      params({ moisture_raw: 17937 }).measurements.moisture_pct,
    ).toBeNull();
    expect(params({ adc_raw: null }).measurements.moisture_pct).toBeNull();
  });
  it("sample packet cannot imply thirst, heat or brightness", () => {
    const packet = hardwareReadingSchema.parse({
      device_id: "arduino-01",
      seq: 1,
      adc_raw: 280,
      moisture_raw: 17937,
      air_temperature_c: null,
      soil_temperature_c: null,
      light_raw: null,
    });
    const p = params(packet, null);
    expect(Object.values(p.measurements)).toEqual([null, null, null, null]);
    expect(Object.values(p.care_signals)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(p.mood).toBe("uncertain");
    expect(fallbackTreeMessage(p)).toMatch(/unsure|unknown/);
    expect(treeMessagePrompt(p)).toContain('"moisture_pct":null');
  });
  it("nulls remain null while actual zero temperatures and light remain zero", () => {
    expect(
      params({
        air_temperature_c: null,
        soil_temperature_c: null,
        light_raw: null,
      }).measurements.air_temperature_c,
    ).toBeNull();
    const p = params({
      air_temperature_c: 0,
      soil_temperature_c: 0,
      light_raw: 0,
    });
    expect(p.measurements.air_temperature_c).toBe(0);
    expect(p.measurements.soil_temperature_c).toBe(0);
    expect(p.measurements.light_raw).toBe(0);
  });
  it("stable traits do not change with mood", () => {
    const uncertain = params();
    const concerned = params({ adc_raw: 200 });
    expect(concerned.mood).toBe("concerned");
    expect(concerned.mood_intensity).toBe("high");
    expect(uncertain.personality_traits).toEqual(concerned.personality_traits);
    expect(concerned.personality_traits).not.toBe(species.personalityTraits);
  });
  it("rejects nonfinite or malformed measurements without coercion", () => {
    expect(() => params({ adc_raw: NaN })).toThrow();
    expect(() => params({ light_raw: Infinity })).toThrow();
    expect(
      hardwareReadingSchema.safeParse({
        device_id: "a",
        seq: 1,
        adc_raw: "280",
      }).success,
    ).toBe(false);
  });
  it("model output cannot alter eligibility; active request alone is insufficient", () => {
    const p = params();
    const output = {
      mood: "uncertain",
      tone: "gentle",
      message: "I'm unsure because my readings are unknown.",
    };
    expect(p.watering_allowed).toBe(false);
    expect(validateTreeMessage(output, p)).not.toBeNull();
    expect(
      validateTreeMessage({ ...output, watering_allowed: true }, p),
    ).toBeNull();
    expect(
      params({}, null, { ...state, wateringEligible: true }).watering_allowed,
    ).toBe(true);
    expect(
      params({}, null, {
        ...state,
        wateringEligible: true,
        activeWateringRequest: false,
      }).watering_allowed,
    ).toBe(false);
    expect(
      params({}, null, { ...state, wateringEligible: true, lifecycle: "dead" })
        .watering_allowed,
    ).toBe(false);
    expect(p.watering_allowed).toBe(false);
  });
  it("validates mood, length, first person and uncertainty", () => {
    const p = params();
    for (const output of [
      null,
      {},
      { mood: "content", tone: "gentle", message: "I'm unsure." },
      { mood: "uncertain", tone: "gentle", message: "I'm happy." },
      {
        mood: "uncertain",
        tone: "gentle",
        message: "I am unsure. " + "x".repeat(240),
      },
    ])
      expect(validateTreeMessage(output, p)).toBeNull();
  });
});
