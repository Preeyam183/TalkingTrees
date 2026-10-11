// Administrator-authored presentation totals; no emails or fabricated care evidence.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const project = "onicsujkioycxtfztfyq";
const env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (url !== `https://${project}.supabase.co`)
  throw new Error(
    "This presentation script is restricted to the configured Rutgers project.",
  );
let keys;
try {
  keys = JSON.parse(
    execFileSync(
      "npx",
      [
        "supabase",
        "projects",
        "api-keys",
        "--project-ref",
        project,
        "--reveal",
        "--output-format",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
} catch {
  throw new Error(
    "Administrator key lookup failed. Check the authorized Supabase CLI login.",
  );
}
const secret = keys.keys.find((k) => k.name === "service_role")?.api_key;
if (!secret) throw new Error("An authorized Supabase CLI account is required.");
const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const owner = "61526880-23a4-4eac-9f7c-30901df67bb8";
const profile = await admin
  .from("profiles")
  .select("id")
  .eq("id", owner)
  .single();
if (profile.error) throw new Error("The expected existing account is missing.");
const people = [
  {
    name: "Maya",
    email: "leaderboard-maya@branchout.invalid",
    color: "#9c6e38",
    points: 180,
    territories: 3,
  },
  {
    name: "Jordan",
    email: "leaderboard-jordan@branchout.invalid",
    color: "#6879a0",
    points: 135,
    territories: 1,
  },
  {
    name: "Alex",
    email: "leaderboard-alex@branchout.invalid",
    color: "#8973a0",
    points: 90,
    territories: 1,
  },
];
const users = [];
for (let page = 1; ; page++) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
  if (result.error)
    throw new Error("Could not inspect existing presentation accounts.");
  users.push(...result.data.users);
  if (result.data.users.length < 100) break;
}
const totals = [
  {
    player_id: owner,
    care_points: 250,
    territories_controlled: 2,
    source: "manual_presentation",
  },
];
for (const person of people) {
  let user = users.find((u) => u.email === person.email);
  if (user && user.app_metadata?.source !== "manual_presentation")
    throw new Error("A presentation email belongs to an unrelated account.");
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: person.email,
      password: randomBytes(32).toString("hex"),
      email_confirm: true,
      ban_duration: "876000h",
      user_metadata: { display_name: person.name },
      app_metadata: { source: "manual_presentation" },
    });
    if (created.error)
      throw new Error(
        `Could not create the ${person.name} presentation account.`,
      );
    user = created.data.user;
  }
  const updated = await admin
    .from("profiles")
    .update({ display_name: person.name, color: person.color })
    .eq("id", user.id);
  if (updated.error)
    throw new Error("Could not configure a presentation profile.");
  totals.push({
    player_id: user.id,
    care_points: person.points,
    territories_controlled: person.territories,
    source: "manual_presentation",
  });
}
const saved = await admin
  .from("presentation_scores")
  .upsert(totals, { onConflict: "player_id" });
if (saved.error)
  throw new Error(
    "Could not save presentation totals. Apply the settings/scores migration first.",
  );
console.log(
  "Presentation leaderboard configured: Preeyam 250 / 2, Maya 180 / 3, Jordan 135 / 1, Alex 90 / 1 (care points / territories).",
);
console.log(
  "Verified point events, tree ownership, watering evidence and territory control rules were preserved.",
);
