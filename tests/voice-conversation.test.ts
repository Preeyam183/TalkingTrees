import { describe, expect, it } from "vitest";
import {
  VoiceTurnDetector,
  stableTreeIndex,
  treeVoiceSettings,
  validateConversation,
  deriveTreePersonalityParams,
  conversationPersonality,
} from "../packages/shared/src/index";

describe("automatic voice turns", () => {
  it("calibrates native room noise so it does not keep a spoken turn open", () => {
    const detector = new VoiceTurnDetector(-60, 500, 20000);
    detector.reset(0);
    for (let t = 100; t <= 2000; t += 100)
      expect(detector.sample(-48, t)).toBe("continue");
    for (let t = 2100; t <= 3000; t += 100)
      expect(detector.sample(-24, t)).toBe("continue");
    expect(detector.sample(-48, 4300)).toBe("continue");
    expect(detector.sample(-48, 4400)).toBe("send");
  });
  it("bounds native turns at 20 seconds when continuous sound masks a pause", () => {
    const detector = new VoiceTurnDetector(-60, 500, 20000);
    detector.reset(0);
    for (let t = 100; t <= 500; t += 100) detector.sample(-70, t);
    for (let t = 600; t < 20000; t += 100)
      expect(detector.sample(-20, t)).toBe("continue");
    expect(detector.sample(-20, 20000)).toBe("send");
  });
  it("detects quieter native microphone levels without sending empty turns", () => {
    const detector = new VoiceTurnDetector(-60);
    detector.reset(0);
    for (let t = 100; t <= 500; t += 100)
      expect(detector.sample(-80, t)).toBe("continue");
    for (let t = 600; t <= 1400; t += 100)
      expect(detector.sample(-55, t)).toBe("continue");
    expect(detector.sample(-80, 2800)).toBe("send");
    detector.reset(3000);
    expect(detector.sample(-80, 48000)).toBe("idle");
  });
  it("does not submit silence or brief microphone clicks", () => {
    const detector = new VoiceTurnDetector();
    detector.reset(0);
    for (let t = 100; t < 45000; t += 100)
      expect(detector.sample(t === 500 ? -15 : -70, t)).toBe("continue");
    expect(detector.sample(-70, 45000)).toBe("idle");
  });
  it("waits through pauses and sends after speech ends", () => {
    const detector = new VoiceTurnDetector();
    detector.reset(0);
    for (let t = 100; t <= 1000; t += 100)
      expect(detector.sample(-20, t)).toBe("continue");
    expect(detector.sample(-70, 1800)).toBe("continue");
    expect(detector.sample(-20, 1900)).toBe("continue");
    expect(detector.sample(-70, 3200)).toBe("continue");
    expect(detector.sample(-70, 3300)).toBe("send");
    detector.reset(3400);
    expect(detector.sample(-70, 5000)).toBe("continue");
  });
  it("bounds a continuously spoken turn and ignores invalid metering", () => {
    const detector = new VoiceTurnDetector();
    detector.reset(0);
    expect(detector.sample(NaN, 100)).toBe("continue");
    for (let t = 200; t < 45000; t += 100)
      expect(detector.sample(-15, t)).toBe("continue");
    expect(detector.sample(-15, 45000)).toBe("send");
  });
});
describe("tree conversation grounding", () => {
  it("rejects invented measurements, invalid fact references and mutation fields", () => {
    const facts = [
      "My moisture is 16% and temperature is 29 °C.",
      "My caretaker is Preeyam.",
    ];
    expect(
      validateConversation(
        {
          message: "I'm a little parched: 16% moisture today.",
          fact_ids: [0, 0],
        },
        facts,
      )?.fact_ids,
    ).toEqual([0]);
    expect(
      validateConversation(
        { message: "My moisture is 80%.", fact_ids: [0] },
        facts,
      ),
    ).toBeNull();
    expect(
      validateConversation({ message: "Hello!", fact_ids: [2] }, facts),
    ).toBeNull();
    expect(
      validateConversation(
        { message: "Hello!", fact_ids: [0], points: 10 },
        facts,
      ),
    ).toBeNull();
  });
  it("uses wet readings to express concern without enabling watering", () => {
    const params = deriveTreePersonalityParams(
      { moisture_raw: 92, air_temperature_c: 18 },
      { field: "moisture_raw", dryRaw: 0, wetRaw: 100 },
      { name: "Willow", personalityTraits: ["reflective"] },
      {
        moistureStatus: "wet",
        thermalStatus: "comfortable",
        lightStatus: "unknown",
        trend: "stable",
        activeWateringRequest: false,
        wateringEligible: false,
      },
    );
    expect(params.mood).toBe("concerned");
    expect(params.care_signals.moisture).toBe("wet");
    expect(params.watering_allowed).toBe(false);
    expect(conversationPersonality(params)).toBe("waterlogged");
    expect(conversationPersonality({ ...params, lifecycle: "dead" })).toBe(
      "solemn",
    );
    expect(conversationPersonality({ ...params, lifecycle: "inactive" })).toBe(
      "quiet",
    );
    expect(
      conversationPersonality({
        ...params,
        care_signals: {
          ...params.care_signals,
          moisture: "okay",
          thermal: "hot",
        },
      }),
    ).toBe("watchful");
    expect(stableTreeIndex("willow", 3)).toBe(stableTreeIndex("willow", 3));
    expect(treeVoiceSettings("waterlogged").speed).toBeLessThan(
      treeVoiceSettings("warm").speed,
    );
  });
});
