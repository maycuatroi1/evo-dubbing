import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  assertManagedSchema,
  formatRowCounts,
  readManagedRowCounts,
  readManagedTableNames,
  readMigrationCount
} from "./schema-contract.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

try {
  await sql`SELECT 1`;
  const tablesBefore = await readManagedTableNames(sql);
  const migrationCountBefore = await readMigrationCount(sql);
  let baselineMode = "already-managed";

  if (migrationCountBefore === 0 && tablesBefore.length > 0) {
    await assertManagedSchema(sql);
    baselineMode = "verified-existing";
  } else if (migrationCountBefore === 0) {
    baselineMode = "fresh";
  }

  const countsBefore = tablesBefore.length === 2 ? await readManagedRowCounts(sql) : null;
  const db = drizzle(sql);
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
  await assertManagedSchema(sql);
  const countsAfter = await readManagedRowCounts(sql);

  if (countsBefore && !isDeepStrictEqual(countsBefore, countsAfter)) {
    throw new Error(`Row counts changed during migration: before=${formatRowCounts(countsBefore)} after=${formatRowCounts(countsAfter)}`);
  }

  console.log("database connection: ok");
  console.log(`baseline mode: ${baselineMode}`);
  console.log(`rows before: ${countsBefore ? formatRowCounts(countsBefore) : "tables absent"}`);
  console.log(`rows after: ${formatRowCounts(countsAfter)}`);
  console.log(`migration history entries: ${await readMigrationCount(sql)}`);
  console.log("database migration: ok");
} finally {
  await sql.end();
}
