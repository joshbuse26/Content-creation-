import type { Redis } from "ioredis";

/**
 * YouTube Data API quota accounting (build spec §8).
 *
 * Every provider call is charged its documented unit cost against a rolling
 * per-UTC-day counter BEFORE the call is made. A hard circuit breaker at
 * 9,000 units (of the 10,000/day budget) refuses further spend so callers
 * can degrade to cached data instead of blowing the daily budget.
 *
 * The counter is injectable: Redis-backed in production (shared across web +
 * worker), in-memory for tests and keyless fixture mode.
 */

export const QUOTA_UNITS = {
  "channels.list": 1,
  "videos.list": 1,
  "playlistItems.list": 1,
  "search.list": 100,
} as const;
export type QuotaOp = keyof typeof QUOTA_UNITS;

export const DAILY_QUOTA_BUDGET = 10_000;
/** Hard stop — degrade to cached data + banner beyond this (spec §8). */
export const QUOTA_CIRCUIT_BREAKER = 9_000;

/** Two days retention so a counter never expires mid-day across DST/clock skew. */
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

export class QuotaExceededError extends Error {
  constructor(
    public readonly requestedUnits: number,
    public readonly usedUnits: number,
    public readonly breakerUnits: number,
  ) {
    super(
      `YouTube quota circuit breaker: ${usedUnits}/${breakerUnits} units used today; ` +
        `refusing to spend ${requestedUnits} more`,
    );
    this.name = "QuotaExceededError";
  }
}

export interface QuotaCounter {
  /** Atomically add `units` to `key` (creating it with a TTL) and return the new total. */
  add(key: string, units: number, ttlSeconds: number): Promise<number>;
  /** Current value of `key`, 0 when absent. */
  get(key: string): Promise<number>;
}

export class InMemoryQuotaCounter implements QuotaCounter {
  private readonly values = new Map<string, number>();

  add(key: string, units: number, _ttlSeconds: number): Promise<number> {
    const next = (this.values.get(key) ?? 0) + units;
    this.values.set(key, next);
    return Promise.resolve(next);
  }

  get(key: string): Promise<number> {
    return Promise.resolve(this.values.get(key) ?? 0);
  }
}

export function createRedisQuotaCounter(redis: Redis): QuotaCounter {
  return {
    async add(key, units, ttlSeconds) {
      const next = await redis.incrby(key, units);
      if (next === units) {
        await redis.expire(key, ttlSeconds);
      }
      return next;
    },
    async get(key) {
      const raw = await redis.get(key);
      if (raw === null) return 0;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    },
  };
}

export interface QuotaTrackerOptions {
  breakerUnits?: number;
  now?: () => Date;
  keyPrefix?: string;
}

export class QuotaTracker {
  private readonly breakerUnits: number;
  private readonly now: () => Date;
  private readonly keyPrefix: string;

  constructor(
    private readonly counter: QuotaCounter,
    options: QuotaTrackerOptions = {},
  ) {
    this.breakerUnits = options.breakerUnits ?? QUOTA_CIRCUIT_BREAKER;
    this.now = options.now ?? (() => new Date());
    this.keyPrefix = options.keyPrefix ?? "yt:quota";
  }

  private dayKey(): string {
    const day = this.now().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    return `${this.keyPrefix}:${day}`;
  }

  /**
   * Charge `calls` invocations of `op` BEFORE making them. Throws
   * QuotaExceededError (and spends nothing) if the charge would push today's
   * total past the circuit breaker. Returns the new daily total.
   */
  async charge(op: QuotaOp, calls = 1): Promise<number> {
    const units = QUOTA_UNITS[op] * calls;
    const key = this.dayKey();
    const used = await this.counter.get(key);
    if (used + units > this.breakerUnits) {
      throw new QuotaExceededError(units, used, this.breakerUnits);
    }
    return this.counter.add(key, units, COUNTER_TTL_SECONDS);
  }

  /** Units spent today so far. */
  async usedToday(): Promise<number> {
    return this.counter.get(this.dayKey());
  }

  /** True when the breaker would refuse even a 1-unit call. */
  async isTripped(): Promise<boolean> {
    const used = await this.usedToday();
    return used + 1 > this.breakerUnits;
  }
}

let sharedTracker: QuotaTracker | undefined;

/**
 * Process-shared tracker: Redis-backed when REDIS_URL is set, in-memory
 * otherwise (keyless fixture mode — still enforces the breaker per process).
 */
export async function getSharedQuotaTracker(): Promise<QuotaTracker> {
  if (sharedTracker !== undefined) return sharedTracker;
  const { hasRedis, getRedisConnection } = await import("@/queue/connection");
  sharedTracker = hasRedis()
    ? new QuotaTracker(createRedisQuotaCounter(getRedisConnection()))
    : new QuotaTracker(new InMemoryQuotaCounter());
  return sharedTracker;
}

/** Test hook. */
export function resetSharedQuotaTrackerForTests(): void {
  sharedTracker = undefined;
}
