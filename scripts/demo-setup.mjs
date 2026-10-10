import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const status = JSON.parse(
  execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
function merge(path, values) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    if (new RegExp(`^${k}=`, "m").test(text)) continue;
    text += `\n${k}=${v}`;
  }
  writeFileSync(path, text.trim() + "\n");
}
merge("apps/web/.env.local", {
  VITE_SUPABASE_URL: status.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  VITE_APP_MODE: "demo",
});
merge("apps/mobile/.env.local", {
  EXPO_PUBLIC_SUPABASE_URL: status.API_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  EXPO_PUBLIC_APP_MODE: "demo",
});
merge("supabase/.env.local", {
  APP_MODE: "demo",
  WORKER_SECRET: randomBytes(32).toString("hex"),
});
const env = readFileSync("supabase/.env.local", "utf8");
const secret = env.match(/^WORKER_SECRET=(.+)$/m)?.[1];
if (!secret) throw new Error("WORKER_SECRET missing");
// Values are passed over stdin to psql, never interpolated into shell code.
const sql = `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='treequest_functions_url') THEN PERFORM vault.create_secret('http://kong:8000/functions/v1','treequest_functions_url'); END IF; IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='treequest_worker_secret') THEN PERFORM vault.create_secret('${secret.replaceAll("'", "''")}','treequest_worker_secret'); END IF; END $$;`;
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_treequest",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, stdio: ["pipe", "ignore", "inherit"] },
);
console.log(
  "Local client settings and worker Vault secrets configured. Existing .env values were preserved.",
);
console.log(
  "Run npm run backend and npm run dev in separate terminals. For a physical phone, change the Expo URL to this computer’s LAN IP.",
);
