import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let cached: Db | undefined;

/**
 * Lazy database handle. `pg.Pool` does not connect until the first query, so
 * importing this module never touches the network — required for `next build`
 * and for fixture-mode runs without a DATABASE_URL.
 */
export function getDb(): Db {
  if (cached === undefined) {
    const { DATABASE_URL } = getConfig();
    if (DATABASE_URL === undefined) {
      throw new Error(
        "DATABASE_URL is not set. The database is required for this operation " +
          "(fixture mode covers providers, not persistence).",
      );
    }
    const pool = new Pool({ connectionString: DATABASE_URL });
    cached = drizzle(pool, { schema });
  }
  return cached;
}

/** True when a database is configured — callers can degrade gracefully. */
export function hasDb(): boolean {
  return getConfig().DATABASE_URL !== undefined;
}

export { schema };
