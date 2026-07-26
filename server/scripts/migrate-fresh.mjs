import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  assertManagedSchema,
  formatRowCounts,
  readManagedRowCounts,
  readManagedSchema,
  readMigrationCount
} from "./schema-contract.mjs";

const serverDirectory = fileURLToPath(new URL("..", import.meta.url));
const migrateScript = fileURLToPath(new URL("./migrate.mjs", import.meta.url));
const integrationScript = fileURLToPath(new URL("./schema-integration.mjs", import.meta.url));
const journalPath = fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url));
const expectedMigrationCount = JSON.parse(readFileSync(journalPath, "utf8")).entries.length;
const containerName = `evo-dubbing-migration-${randomUUID()}`;
const docker = process.platform === "win32" ? "docker.exe" : "docker";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: serverDirectory,
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return (result.stdout ?? "").trim();
}

let sql;
let containerStarted = false;

function databaseUrlFromDocker() {
  run(docker, [
    "run",
    "--rm",
    "--detach",
    "--name",
    containerName,
    "--env",
    "POSTGRES_USER=evo",
    "--env",
    "POSTGRES_PASSWORD=evo_test",
    "--env",
    "POSTGRES_DB=evo_dubbing",
    "--publish",
    "127.0.0.1::5432",
    "postgres:16-alpine"
  ]);
  containerStarted = true;
  const portOutput = run(docker, ["port", containerName, "5432/tcp"]);
  const port = portOutput.match(/:(\d+)\s*$/)?.[1];
  if (!port) {
    throw new Error("Docker did not publish the PostgreSQL port");
  }
  return `postgres://evo:evo_test@127.0.0.1:${port}/evo_dubbing`;
}

try {
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor >= 23 || (nodeMajor === 22 && Number(process.versions.node.split(".")[1]) >= 6)) {
    run(process.execPath, [
      "--experimental-strip-types",
      "--no-warnings",
      "--test",
      "src/lib/subscription.test.ts"
    ]);
    console.log("subscription helper unit tests: ok");
  } else {
    console.log("subscription helper unit tests: skipped (needs node >= 22.6)");
  }

  const databaseUrl = process.env.DATABASE_URL || databaseUrlFromDocker();
  sql = postgres(databaseUrl, { max: 1, connect_timeout: 1, onnotice: () => {} });
  let connected = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await sql`SELECT 1`;
      connected = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!connected) {
    throw new Error("Fresh PostgreSQL container did not become ready");
  }

  run(process.execPath, [migrateScript], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  await assertManagedSchema(sql);
  const [dub] = await sql`
    INSERT INTO dubs (
      platform,
      video_id,
      source_lang,
      target_lang,
      voice,
      provider,
      owner_token_hash
    ) VALUES (
      'test',
      'migration',
      'en',
      'vi',
      'test',
      'test',
      'test'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO dub_segments (dub_id, idx, start_ms, end_ms, audio_key)
    VALUES (${dub.id}, 0, 0, 1000, 'test')
  `;
  const schemaBefore = await readManagedSchema(sql);
  const countsBefore = await readManagedRowCounts(sql);

  run(process.execPath, [migrateScript], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const schemaAfter = await assertManagedSchema(sql);
  const countsAfter = await readManagedRowCounts(sql);
  const migrationCount = await readMigrationCount(sql);

  if (JSON.stringify(schemaBefore) !== JSON.stringify(schemaAfter)) {
    throw new Error("Second migration changed the managed schema");
  }
  if (JSON.stringify(countsBefore) !== JSON.stringify(countsAfter)) {
    throw new Error("Second migration changed row counts");
  }
  if (migrationCount !== expectedMigrationCount) {
    throw new Error(`Expected ${expectedMigrationCount} migration history entries, received ${migrationCount}`);
  }

  run(process.execPath, [integrationScript], { env: { ...process.env, DATABASE_URL: databaseUrl } });

  console.log("fresh PostgreSQL connection: ok");
  console.log("first migration: ok");
  console.log("second migration: ok");
  console.log("schema contract: ok");
  console.log(`rows after first migration: ${formatRowCounts(countsBefore)}`);
  console.log(`rows after second migration: ${formatRowCounts(countsAfter)}`);
  console.log(`migration history entries: ${migrationCount}`);
  console.log("schema integration tests: ok");
  console.log("fresh database migration test: ok");
} finally {
  if (sql) {
    await sql.end().catch(() => {});
  }
  if (containerStarted) {
    spawnSync(docker, ["stop", containerName], { encoding: "utf8" });
  }
}
