import type { Redis } from "ioredis";

/**
 * Small JSON cache over Redis — used for YouTube search-result caching
 * (24h keyed by normalized query, spec §8) and the free-tools IP rate limit.
 * Takes any ioredis-compatible client, so tests inject ioredis-mock.
 */

export interface JsonCache {
  get<T>(key: string, parse: (raw: unknown) => T): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Returns the post-increment count; sets TTL on first increment. */
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

export function createJsonCache(redis: Redis): JsonCache {
  return {
    async get<T>(key: string, parse: (raw: unknown) => T): Promise<T | null> {
      const raw = await redis.get(key);
      if (raw === null) return null;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    },
    async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return count;
    },
  };
}

/** Cache key helper — normalized to keep YouTube quota cache hits high. */
export function searchCacheKey(query: string): string {
  return `yt:search:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
