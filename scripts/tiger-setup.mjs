import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

// Tiger's administrator password stays in the CLI keyring and this process.
// Only a restricted runtime connection is written to the ignored backend env.
const service = process.argv[2];
if (!service) throw new Error("Usage: npm run tiger:setup -- SERVICE_ID");
const path = "supabase/.env.local";
let envText = existsSync(path) ? readFileSync(path, "utf8") : "";
const env = parseEnv(envText);
const adminUrl = execFileSync(
  "tiger",
  ["db", "uri", service, "--with-password"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
).trim();
const admin = postgres(adminUrl, {
  ssl: "require",
  max: 1,
  connect_timeout: 15,
});
let runtime;
try {
  await admin.unsafe(readFileSync("tiger/setup.sql", "utf8"));
  const url = new URL(adminUrl);
  const role = "treequest_runtime";
  const existing = await admin`select 1 from pg_roles where rolname=${role}`;
  if (existing.length) {
    const saved = new URL(env.TIGER_DATABASE_URL || "postgresql://unset");
    if (
      saved.hostname !== url.hostname ||
      saved.username !== role ||
      !saved.password
    )
      throw new Error(
        "Runtime role already exists; restore its backend URL rather than resetting its password.",
      );
    runtime = saved.toString();
  } else {
    const password = randomBytes(32).toString("hex");
    // Both role and hex password are generated constants, never user SQL.
    await admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    url.username = role;
    url.password = password;
    runtime = url.toString();
    envText = envText.replace(/^TIGER_DATABASE_URL=.*\r?\n?/m, "");
    writeFileSync(
      path,
      envText.trimEnd() + `\nTIGER_DATABASE_URL=${runtime}\n`,
      { mode: 0o600 },
    );
  }
  await admin.unsafe(
    "GRANT USAGE ON SCHEMA public TO treequest_runtime; GRANT SELECT, INSERT ON sensor_history TO treequest_runtime",
  );
  const client = postgres(runtime, {
    ssl: "require",
    max: 1,
    connect_timeout: 15,
  });
  try {
    const [result] =
      await client`select count(*)::int as readings from sensor_history`;
    console.log(
      `Tiger schema installed; restricted runtime connection verified (${result.readings} historical readings).`,
    );
  } finally {
    await client.end();
  }
  console.log(
    "Backend URL saved to ignored supabase/.env.local. Restart npm run backend after choosing the history mode.",
  );
  if (process.argv.includes("--local-fdw")) {
    const local = postgres(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      { max: 1 },
    );
    const target = new URL(runtime);
    const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
    try {
      await local.begin(async (tx) => {
        await tx.unsafe(
          "CREATE EXTENSION IF NOT EXISTS postgres_fdw; CREATE SCHEMA IF NOT EXISTS tiger_private; REVOKE ALL ON SCHEMA tiger_private FROM PUBLIC,anon,authenticated",
        );
        const [server] =
          await tx`select 1 from pg_foreign_server where srvname='treequest_tiger'`;
        if (!server)
          await tx.unsafe(
            `CREATE SERVER treequest_tiger FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host ${literal(target.hostname)}, port ${literal(target.port || "5432")}, dbname ${literal(target.pathname.slice(1))}, sslmode 'require', connect_timeout '10')`,
          );
        else
          await tx.unsafe(
            `ALTER SERVER treequest_tiger OPTIONS (SET host ${literal(target.hostname)}, SET port ${literal(target.port || "5432")}, SET dbname ${literal(target.pathname.slice(1))})`,
          );
        await tx.unsafe(
          "DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER treequest_tiger",
        );
        await tx.unsafe(
          `CREATE USER MAPPING FOR CURRENT_USER SERVER treequest_tiger OPTIONS (user ${literal(decodeURIComponent(target.username))}, password ${literal(decodeURIComponent(target.password))})`,
        );
        await tx.unsafe(readFileSync("tiger/supabase-fdw.sql", "utf8"));
      });
      envText = readFileSync(path, "utf8").replace(
        /^TIGER_TRANSPORT=.*\r?\n?/m,
        "",
      );
      writeFileSync(path, envText.trimEnd() + "\nTIGER_TRANSPORT=fdw\n", {
        mode: 0o600,
      });
      console.log(
        "Local backend-only PostgreSQL foreign-data transport installed (TLS required).",
      );
    } finally {
      await local.end();
    }
  }
} finally {
  await admin.end();
}
