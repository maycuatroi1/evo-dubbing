import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/evo_dubbing_unset";

const globalForDb = globalThis as unknown as { evoSql?: ReturnType<typeof postgres> };

const client = globalForDb.evoSql ?? postgres(connectionString, { max: 5 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.evoSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
