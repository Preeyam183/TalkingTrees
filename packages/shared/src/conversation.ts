import { z } from "zod";
export function validateConversation(value: unknown, facts: string[]) {
  const result = z
    .object({
      message: z.string().trim().min(1).max(1000),
      fact_ids: z
        .array(
          z
            .number()
            .int()
            .min(0)
            .max(facts.length - 1),
        )
        .min(1)
        .max(facts.length),
    })
    .strict()
    .safeParse(value);
  if (!result.success) return null;
  // Reject new quantitative claims; the factual panel always uses original DB facts.
  const known = new Set(facts.join(" ").match(/-?\d+(?:\.\d+)?/g) ?? []);
  if (
    (result.data.message.match(/-?\d+(?:\.\d+)?/g) ?? []).some(
      (n) => !known.has(n),
    )
  )
    return null;
  return { ...result.data, fact_ids: [...new Set(result.data.fact_ids)] };
}
