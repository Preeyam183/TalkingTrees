import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  aggregate,
  fallbackIntent,
  validateIntent,
  weekPeriod,
  portfolioAverage,
} from "../packages/shared/src/analytics";
import { readingSchema, evidenceSchema } from "../packages/shared/src";
const id = "40000000-0000-4000-8000-000000000001",
  other = "40000000-0000-4000-8000-000000000002";
describe("analytics contracts", () => {
  it("uses Monday midnight in the user timezone across DST", () => {
    const p = weekPeriod(
      "America/New_York",
      DateTime.fromISO("2026-03-09T05:00:00Z"),
    );
    expect(p.from).toBe("2026-03-09T04:00:00.000Z");
  });
  it("normalizes offset query timestamps to UTC", () => {
    const i = validateIntent(
      {
        intent: "overview",
        tree_ids: [id],
        from: "2026-01-01T00:00:00-05:00",
        to: "2026-01-02T00:00:00-05:00",
        metrics: ["moisture"],
      },
      [id],
    );
    expect(i.from).toBe("2026-01-01T05:00:00.000Z");
  });
  it("rejects invalid zones", () =>
    expect(() => weekPeriod("Invalid/Zone")).toThrow());
  it("rejects unauthorized IDs even if model supplies them", () =>
    expect(() =>
      validateIntent(
        {
          intent: "overview",
          tree_ids: [other],
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-02T00:00:00Z",
          metrics: ["moisture"],
        },
        [id],
      ),
    ).toThrow(/currently own/));
  it("rejects unknown metrics and oversized date ranges", () => {
    expect(() =>
      validateIntent(
        {
          intent: "sql",
          tree_ids: [id],
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-02T00:00:00Z",
          metrics: ["diagnosis"],
        },
        [id],
      ),
    ).toThrow();
    expect(() =>
      validateIntent(
        {
          intent: "overview",
          tree_ids: [id],
          from: "2025-01-01T00:00:00Z",
          to: "2026-01-02T00:00:00Z",
          metrics: ["moisture"],
        },
        [id],
      ),
    ).toThrow();
  });
  it("weights days equally, records missing days, and avoids empty invented values", () => {
    const rows = [1, 2, 3].map((h) => ({
      tree_id: id,
      recorded_at: `2026-01-01T0${h}:00:00.000Z`,
      soil_moisture_pct: 20,
      temperature_c: 10,
    }));
    rows.push({
      tree_id: id,
      recorded_at: "2026-01-02T01:00:00.000Z",
      soil_moisture_pct: 60,
      temperature_c: 30,
    });
    const a = aggregate(
      rows,
      [id, other],
      "2026-01-01T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "UTC",
    );
    expect(a[0].moisture_average).toBe(40);
    expect(a[0].missing_days).toBe(1);
    expect(a[1].moisture_average).toBeNull();
    expect(a[1].change).toBeNull();
    expect(portfolioAverage(a).moisture).toBe(40);
  });
  it("does not reinterpret an unresolved named tree as the whole portfolio", () => {
    expect(
      fallbackIntent(
        "Did watering their oak yesterday help?",
        [{ id, name: "Maple 1" }],
        "UTC",
      ),
    ).toBeNull();
  });
  it("supports predefined questions without Gemini", () => {
    expect(
      fallbackIntent(
        "How are my trees doing this week?",
        [{ id, name: "Maple 1" }],
        "UTC",
      )?.intent,
    ).toBe("overview");
    expect(
      fallbackIntent(
        "Which of my trees needs water most urgently?",
        [{ id, name: "Maple 1" }],
        "UTC",
      )?.intent,
    ).toBe("priority");
    expect(fallbackIntent("Tell me a joke", [], "UTC")).toBeNull();
  });
  it("validates hardware ranges and explicit evidence enums", () => {
    expect(
      readingSchema.safeParse({
        external_event_id: "x",
        device_id: id,
        tree_id: id,
        timestamp: "2026-01-01T00:00:00Z",
        soil_moisture_pct: 101,
        temperature_c: 20,
      }).success,
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({
        external_event_id: "x",
        device_id: id,
        tree_id: id,
        timestamp: "2026-01-01T00:00:00Z",
        session_id: id,
        sensor_event_id: "y",
        evidence_type: "clicked",
      }).success,
    ).toBe(false);
  });
});
