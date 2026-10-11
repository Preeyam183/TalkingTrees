import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Explicit hosted setup: no migrations, seeds, scoring changes, or database resets.
const file = "supabase/.env.connected";
if (!existsSync(file))
  writeFileSync(file, readFileSync("supabase/.env.example", "utf8"), {
    mode: 0o600,
  });
const root = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
let backend = parseEnv(readFileSync(file, "utf8"));
// Import only backend settings; private credentials never enter client env files.
const providerNames = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ELEVENLABS_VOICE_ID_WARM",
  "ELEVENLABS_VOICE_ID_WATCHFUL",
  "ELEVENLABS_VOICE_ID_QUIET",
  "ELEVENLABS_VOICE_ID_SOLEMN",
  "ELEVENLABS_VOICE_ID_WATERLOGGED",
  "ELEVENLABS_VOICE_IDS",
  "ELEVENLABS_MODEL",
  "ELEVENLABS_STT_MODEL",
  "TIGER_DATABASE_URL",
  "TIGER_TRANSPORT",
  ...new Set(
    [...Object.keys(root), ...Object.keys(backend)].filter((name) =>
      /^ELEVENLABS_TREE_VOICE_[0-9a-f_]+$/.test(name),
    ),
  ),
];
for (const name of providerNames) {
  const value = root[name]?.trim();
  if (!value) continue;
  if (/YOUR_|placeholder|change-me|replace-me/i.test(value)) {
    console.log(`${name} is a placeholder; it was not imported.`);
    continue;
  }
  if (name === "TIGER_DATABASE_URL") {
    let tiger;
    try {
      tiger = new URL(value);
    } catch {
      throw new Error(
        "TIGER_DATABASE_URL must be a PostgreSQL connection URI.",
      );
    }
    if (!["postgres:", "postgresql:"].includes(tiger.protocol))
      throw new Error(
        "TIGER_DATABASE_URL must be a PostgreSQL connection URI.",
      );
    if (tiger.hostname === "host" || tiger.password === "password") {
      console.log("TIGER_DATABASE_URL is an example; it was not imported.");
      continue;
    }
  }
  backend[name] = value;
}
configure(
  file,
  Object.fromEntries(
    providerNames
      .filter((name) => backend[name])
      .map((name) => [name, backend[name]]),
  ),
);
const url = backend.CLIENT_SUPABASE_URL || root.NEXT_PUBLIC_SUPABASE_URL;
const key =
  backend.CLIENT_SUPABASE_PUBLISHABLE_KEY ||
  root.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    "Set CLIENT_SUPABASE_URL and CLIENT_SUPABASE_PUBLISHABLE_KEY in supabase/.env.connected, or the corresponding NEXT_PUBLIC values in .env.",
  );
const target = new URL(url);
if (target.protocol !== "https:" || !target.hostname.endsWith(".supabase.co"))
  throw new Error("Connected setup requires a hosted Supabase HTTPS URL.");
if (key.startsWith("sb_secret_") || key.includes("service_role"))
  throw new Error("Client settings require a public key.");
if (key.startsWith("ey")) {
  const payload = JSON.parse(
    Buffer.from(key.split(".")[1], "base64url").toString(),
  );
  if (payload.role !== "anon")
    throw new Error("Never use a service-role JWT in client settings.");
}
const project = target.hostname.split(".")[0];
if (
  !backend.WORKER_SECRET ||
  /YOUR_|placeholder|change-me|replace-me/i.test(backend.WORKER_SECRET)
) {
  backend.WORKER_SECRET = randomBytes(32).toString("hex");
  configure(file, { WORKER_SECRET: backend.WORKER_SECRET });
}
function configure(path, values) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    text = pattern.test(text)
      ? text.replace(pattern, () => `${name}=${JSON.stringify(value)}`)
      : `${text.trimEnd()}\n${name}=${JSON.stringify(value)}\n`;
  }
  writeFileSync(path, text.trim() + "\n", { mode: 0o600 });
}
configure("apps/web/.env.local", {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_PUBLISHABLE_KEY: key,
  VITE_APP_MODE: "connected",
});
configure("apps/mobile/.env.local", {
  EXPO_PUBLIC_SUPABASE_URL: url,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
  EXPO_PUBLIC_APP_MODE: "connected",
});
const allowed = providerNames;
const settings = {
  APP_MODE: "connected",
  HISTORY_MODE: "tiger",
  WORKER_SECRET: backend.WORKER_SECRET,
};
configure(file, {
  APP_MODE: settings.APP_MODE,
  HISTORY_MODE: settings.HISTORY_MODE,
});
for (const name of allowed) if (backend[name]) settings[name] = backend[name];
if (settings.TIGER_DATABASE_URL) {
  const tiger = new URL(settings.TIGER_DATABASE_URL);
  if (tiger.hostname === "host" || tiger.password === "password")
    throw new Error(
      "Replace the example TIGER_DATABASE_URL or leave it empty until configured.",
    );
}
if (process.argv.includes("--prepare-only")) {
  console.log(
    `Connected environment files prepared for ${project}; hosted secrets were not changed.`,
  );
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), "treequest-connected-"));
try {
  const secrets = join(dir, ".env");
  writeFileSync(
    secrets,
    Object.entries(settings)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n"),
    { mode: 0o600 },
  );
  execFileSync(
    "npx",
    [
      "supabase",
      "secrets",
      "set",
      "--project-ref",
      project,
      "--env-file",
      secrets,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  const sql = join(dir, "worker.sql");
  writeFileSync(
    sql,
    `DO $$ DECLARE sid uuid; BEGIN
    SELECT id INTO sid FROM vault.secrets WHERE name='treequest_functions_url';
    IF sid IS NULL THEN PERFORM vault.create_secret(${literal(url + "/functions/v1")},'treequest_functions_url');
    ELSE PERFORM vault.update_secret(sid,${literal(url + "/functions/v1")}); END IF;
    SELECT id INTO sid FROM vault.secrets WHERE name='treequest_worker_secret';
    IF sid IS NULL THEN PERFORM vault.create_secret(${literal(backend.WORKER_SECRET)},'treequest_worker_secret');
    ELSE PERFORM vault.update_secret(sid,${literal(backend.WORKER_SECRET)}); END IF;
  END $$;`,
    { mode: 0o600 },
  );
  execFileSync(
    "npx",
    ["supabase", "db", "query", "--linked", "--project-ref", project, "--file", sql],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  console.log(
    `Connected clients and scheduled worker configured for ${project}. Restart Vite and Metro.`,
  );
  for (const name of [
    "GEMINI_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "TIGER_DATABASE_URL",
  ])
    if (!settings[name])
      console.log(`${name} is empty; its provider remains unavailable.`);
} catch (error) {
  let detail = [
    error.stderr?.toString(),
    error.stdout?.toString(),
    error.message,
  ]
    .filter(Boolean)
    .join("\n");
  for (const [name, value] of Object.entries(settings)) {
    if (/SECRET|KEY|URL/.test(name) && value)
      detail = detail.replaceAll(value, "<redacted>");
  }
  detail = detail.replaceAll(key, "<redacted>");
  console.error(detail.slice(0, 1200));
  console.error(
    "Hosted setup failed. Check Supabase CLI login, project access, and applied migrations. Credentials were not printed.",
  );
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
