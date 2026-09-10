import type { Redis } from "ioredis";
import type { RateLimitPolicy } from "./policies";

/**
 * Sliding-window rate limiter.
 *
 * Redis store: a sorted set per (policy, subject) whose members are
 * timestamped hits; expired members are pruned on every check, so the window
 * genuinely slides (no fixed-window burst at the boundary). In-memory store:
 * same semantics over a Map — the zero-env fallback used by tests and
 * fixture mode.
 *
 * Denied requests are NOT recorded — hammering a limit does not extend the
 * lockout beyond the window.
 */

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Remaining hits in the current window (0 when denied). */
  remaining: number;
  /** ms until a retry can succeed (0 when allowed). */
  retryAfterMs: number;
}

export interface SlidingWindowStore {
  /**
   * Prune entries older than (now - windowMs), then record a hit iff the
   * subject is under `limit`. Returns the post-decision count and the oldest
   * surviving timestamp (for retry-after math).
   */
  hit(
    key: string,
    windowMs: number,
    limit: number,
    nowMs: number,
  ): Promise<{ allowed: boolean; count: number; oldestMs: number | null }>;
}

// ---------------------------------------------------------------------------
// In-memory store (tests, zero-env fallback)
// ---------------------------------------------------------------------------

export class MemorySlidingWindowStore implements SlidingWindowStore {
  private readonly hits = new Map<string, number[]>();

  hit(
    key: string,
    windowMs: number,
    limit: number,
    nowMs: number,
  ): Promise<{ allowed: boolean; count: number; oldestMs: number | null }> {
    const cutoff = nowMs - windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const allowed = kept.length < limit;
    if (allowed) kept.push(nowMs);
    if (kept.length === 0) {
      this.hits.delete(key);
    } else {
      this.hits.set(key, kept);
    }
    return Promise.resolve({ allowed, count: kept.length, oldestMs: kept[0] ?? null });
  }

  /** Test hook. */
  clear(): void {
    this.hits.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis store (production)
// ---------------------------------------------------------------------------

export class RedisSlidingWindowStore implements SlidingWindowStore {
  constructor(private readonly redis: Redis) {}

  async hit(
    key: string,
    windowMs: number,
    limit: number,
    nowMs: number,
  ): Promise<{ allowed: boolean; count: number; oldestMs: number | null }> {
    const cutoff = nowMs - windowMs;
    await this.redis.zremrangebyscore(key, "-inf", String(cutoff));
    const countBefore = await this.redis.zcard(key);
    const allowed = countBefore < limit;
    if (allowed) {
      const member = `${nowMs}-${Math.random().toString(36).slice(2, 10)}`;
      await this.redis.zadd(key, nowMs, member);
      await this.redis.pexpire(key, windowMs + 1_000);
      // The oldest timestamp only matters for retry-after math on denial.
      return { allowed: true, count: countBefore + 1, oldestMs: null };
    }
    return { allowed: false, count: countBefore, oldestMs: await this.oldestScore(key) };
  }

  /** Min score in the set via ZSCAN (sets are at most `limit` entries). */
  private async oldestScore(key: string): Promise<number | null> {
    let cursor = "0";
    let oldest: number | null = null;
    do {
      const [next, elements] = await this.redis.zscan(key, cursor);
      for (let i = 1; i < elements.length; i += 2) {
        const score = Number(elements[i]);
        if (!Number.isNaN(score) && (oldest === null || score < oldest)) {
          oldest = score;
        }
      }
      cursor = next;
    } while (cursor !== "0");
    return oldest;
  }
}

// ---------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  constructor(
    private readonly store: SlidingWindowStore,
    private readonly now: () => number = Date.now,
  ) {}

  async check(policy: RateLimitPolicy, subject: string): Promise<RateLimitDecision> {
    const nowMs = this.now();
    const key = `rl:${policy.id}:${subject}`;
    const { allowed, count, oldestMs } = await this.store.hit(
      key,
      policy.windowMs,
      policy.limit,
      nowMs,
    );
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      retryAfterMs: allowed ? 0 : Math.max(1, (oldestMs ?? nowMs) + policy.windowMs - nowMs),
    };
  }
}
