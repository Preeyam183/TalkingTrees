import { DateTime } from "luxon";
import { z } from "zod";
export const intentSchema = z
  .object({
    intent: z.enum([
      "overview",
      "priority",
      "trends",
      "response",
      "comparison",
    ]),
    tree_ids: z.array(z.string().uuid()).max(100),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    metrics: z
      .array(z.enum(["moisture", "temperature"]))
      .min(1)
      .max(2),
  })
  .strict();
export type Intent = z.infer<typeof intentSchema>;
export type Reading = {
  tree_id: string;
  recorded_at: string;
  soil_moisture_pct: number;
  temperature_c: number;
};
export function weekPeriod(timezone: string, now = DateTime.utc()) {
  const local = now.setZone(timezone);
  if (!local.isValid) throw new Error("Invalid IANA timezone");
  return {
    from: local.startOf("week").toUTC().toISO()!,
    to: now.toUTC().toISO()!,
    timezone,
  };
}
export function validateIntent(
  input: unknown,
  authorized: string[],
  now = DateTime.utc(),
) {
  const i = intentSchema.parse(input);
  if (i.tree_ids.some((id) => !authorized.includes(id)))
    throw new Error("Question references a tree you do not currently own");
  const a = DateTime.fromISO(i.from),
    b = DateTime.fromISO(i.to);
  if (
    a >= b ||
    b.diff(a, "days").days > 90 ||
    b.toMillis() > now.toMillis() + 1000
  )
    throw new Error("Use a past date range of at most 90 days");
  return { ...i, from: a.toUTC().toISO()!, to: b.toUTC().toISO()! };
}
export function fallbackIntent(
  question: string,
  trees: { id: string; name: string }[],
  timezone: string,
  now = DateTime.utc(),
): Intent | null {
  const q = question.toLowerCase();
  const period = weekPeriod(timezone, now);
  let intent: Intent["intent"];
  if (/compare|last week/.test(q)) intent = "comparison";
  else if (/did .*water|watering.*(improve|response)|before.*after/.test(q))
    intent = "response";
  else if (/urgent|priority|needs? water/.test(q)) intent = "priority";
  else if (/drier|trend|drying/.test(q)) intent = "trends";
  else if (/how.*(doing|trees)|overview|summary/.test(q)) intent = "overview";
  else return null;
  const named = trees.filter((t) => q.includes(t.name.toLowerCase()));
  // Never reinterpret an unresolved named tree as all trees.
  if (
    !named.length &&
    !/my trees|our trees|all trees|overview|summary|this week compare/.test(q)
  )
    return null;
  let from = period.from,
    to = period.to;
  if (/yesterday/.test(q)) {
    const d = now.setZone(timezone).minus({ days: 1 });
    from = d.startOf("day").toUTC().toISO()!;
    to = d.endOf("day").toUTC().toISO()!;
  }
  return {
    intent,
    tree_ids: (named.length ? named : trees).map((t) => t.id),
    from,
    to,
    metrics: ["moisture", "temperature"],
  };
}
const mean = (n: number[]) =>
  n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
const round = (n: number | null) =>
  n === null ? null : Math.round(n * 100) / 100;
export function aggregate(
  readings: Reading[],
  ids: string[],
  from: string,
  to: string,
  timezone: string,
) {
  const start = DateTime.fromISO(from).setZone(timezone).startOf("day");
  const end = DateTime.fromISO(to).setZone(timezone);
  let expected = 0;
  for (let d = start; d < end; d = d.plus({ days: 1 })) expected++;
  return ids.map((tree_id) => {
    const rows = readings
      .filter(
        (r) =>
          r.tree_id === tree_id &&
          Date.parse(r.recorded_at) >= Date.parse(from) &&
          Date.parse(r.recorded_at) <= Date.parse(to),
      )
      .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    const groups = new Map<string, Reading[]>();
    for (const r of rows) {
      const day = DateTime.fromISO(r.recorded_at)
        .setZone(timezone)
        .toISODate()!;
      groups.set(day, [...(groups.get(day) ?? []), r]);
    }
    const daily = [...groups].map(([date, rs]) => ({
      date,
      moisture: round(mean(rs.map((r) => r.soil_moisture_pct))),
      temperature: round(mean(rs.map((r) => r.temperature_c))),
      readings: rs.length,
    }));
    return {
      tree_id,
      readings: rows.length,
      days: daily.length,
      missing_days: Math.max(0, expected - daily.length),
      moisture_average: round(mean(daily.map((d) => d.moisture!))),
      temperature_average: round(mean(daily.map((d) => d.temperature!))),
      moisture_min: rows.length
        ? Math.min(...rows.map((r) => r.soil_moisture_pct))
        : null,
      moisture_max: rows.length
        ? Math.max(...rows.map((r) => r.soil_moisture_pct))
        : null,
      temperature_min: rows.length
        ? Math.min(...rows.map((r) => r.temperature_c))
        : null,
      temperature_max: rows.length
        ? Math.max(...rows.map((r) => r.temperature_c))
        : null,
      change:
        daily.length >= 2
          ? round(daily.at(-1)!.moisture! - daily[0].moisture!)
          : null,
      latest_reading: rows.at(-1)?.recorded_at ?? null,
      daily,
    };
  });
}
export function portfolioAverage(stats: ReturnType<typeof aggregate>) {
  return {
    moisture: round(
      mean(
        stats.flatMap((s) =>
          s.moisture_average === null ? [] : [s.moisture_average],
        ),
      ),
    ),
    temperature: round(
      mean(
        stats.flatMap((s) =>
          s.temperature_average === null ? [] : [s.temperature_average],
        ),
      ),
    ),
  };
}
