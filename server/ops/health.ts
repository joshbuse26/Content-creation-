import { sql } from "drizzle-orm";
import { getDb, hasDb } from "@/db";
import { getConfig, PRODUCT_NAME } from "@/lib/config";
import { getRedisConnection, hasRedis } from "@/queue/connection";

/**
 * Health & readiness — spec §10 healthcheck plus dependency pings.
 *
 * - health: process is up (no dependencies touched) — Railway healthcheck.
 * - readiness: pings every CONFIGURED dependency (DB `select 1`, Redis PING).
 *   Unconfigured dependencies are reported but don't fail readiness, so
 *   fixture mode (zero env) is always ready.
 */

export interface HealthReport {
  ok: true;
  service: string;
  uptimeSeconds: number;
  providers: "fixture" | "live";
}

export interface DependencyCheck {
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface ReadinessReport {
  ok: boolean;
  checks: {
    db: DependencyCheck;
    redis: DependencyCheck;
  };
}

export function healthCheck(): HealthReport {
  return {
    ok: true,
    service: PRODUCT_NAME,
    uptimeSeconds: Math.floor(process.uptime()),
    providers: getConfig().PROVIDERS,
  };
}

const skipped: DependencyCheck = { configured: false, ok: true, latencyMs: null, error: null };

async function timed(ping: () => Promise<void>): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await ping();
    return { configured: true, ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ReadinessPings {
  /** Injectable for tests. Defaults: DB `select 1`, Redis PING. */
  db?: () => Promise<void>;
  redis?: () => Promise<void>;
}

export async function checkReadiness(pings: ReadinessPings = {}): Promise<ReadinessReport> {
  const dbPing =
    pings.db ??
    (hasDb()
      ? async () => {
          await getDb().execute(sql`select 1`);
        }
      : undefined);
  const redisPing =
    pings.redis ??
    (hasRedis()
      ? async () => {
          await getRedisConnection().ping();
        }
      : undefined);

  const [db, redis] = await Promise.all([
    dbPing === undefined ? Promise.resolve(skipped) : timed(dbPing),
    redisPing === undefined ? Promise.resolve(skipped) : timed(redisPing),
  ]);

  return { ok: db.ok && redis.ok, checks: { db, redis } };
}
