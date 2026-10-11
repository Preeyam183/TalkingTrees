import { z, type TreeVoice } from "../../../packages/shared/src/index.ts";
import { db, elevenLabsVoiceId } from "./services.ts";
let cached: { at: number; voices: TreeVoice[] } | undefined;
export async function voiceCatalog(): Promise<TreeVoice[]> {
  if (cached && Date.now() - cached.at < 120000) return cached.voices;
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key)
    throw new Error(
      "Voice selection needs ElevenLabs configured on the server.",
    );
  const voices: TreeVoice[] = [];
  let next: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    if (next) url.searchParams.set("next_page_token", next);
    const response = await fetch(url, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(
        "Could not load voices. Check the server key’s Read Voices permission.",
      );
    const data = z
      .object({
        voices: z.array(
          z.object({
            voice_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
            name: z.string(),
            preview_url: z.string().nullable().optional(),
          }),
        ),
        has_more: z.boolean().optional(),
        next_page_token: z.string().nullable().optional(),
      })
      .parse(await response.json());
    voices.push(
      ...data.voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        preview_url: v.preview_url?.startsWith("https://")
          ? v.preview_url
          : null,
      })),
    );
    next = data.next_page_token ?? undefined;
    if (!data.has_more || !next) break;
  }
  cached = { at: Date.now(), voices };
  return voices;
}
export async function treeSettings(treeId: string, player: string) {
  const result = await db
    .from("trees")
    .select("name,owner_id,voice_id")
    .eq("id", treeId)
    .single();
  if (result.error) throw new Error("tree_not_found");
  if (result.data.owner_id !== player) throw new Error("tree_owner_required");
  let voices: TreeVoice[] = [],
    warning: string | undefined;
  try {
    voices = await voiceCatalog();
  } catch (e) {
    warning =
      e instanceof Error ? e.message : "Voice selection is unavailable.";
  }
  return {
    name: result.data.name,
    voice_id: result.data.voice_id,
    effective_voice_id:
      result.data.voice_id || elevenLabsVoiceId("warm", treeId) || null,
    voices,
    warning,
  };
}
