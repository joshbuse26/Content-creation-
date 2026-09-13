import { searchCacheKey, type JsonCache } from "@/lib/cache";

/**
 * Ideation caches (spec §8): YouTube search results 24h keyed by normalized
 * query, competitor channel medians 7d keyed by channel ytid. Redis-backed
 * in production (shared across web + worker); this in-memory fallback keeps
 * fixture mode and tests working with zero env — still TTL-correct, just
 * per-process.
 */

export const SEARCH_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const MEDIAN_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Search-demand signals refresh daily (D3), keyed by normalized topic. */
export const DEMAND_CACHE_TTL_SECONDS = 24 * 60 * 60;
/** "Why it worked" blurbs are stable per video — cached 7d (E3). */
export const WHY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export { searchCacheKey };

/** 7-day channel-median cache key (spec §5.3 "channel medians cached 7d"). */
export function medianCacheKey(channelYtid: string): string {
  return `yt:chmedian:${channelYtid}`;
}

/** 24h search-demand cache key, keyed by normalized topic (D3). */
export function demandCacheKey(normalizedTopic: string): string {
  return `demand:${normalizedTopic}`;
}

/** 7-day "why it worked" blurb cache key, keyed by the video id (E3). */
export function whyCacheKey(youtubeVideoId: string): string {
  return `why:${youtubeVideoId}`;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class InMemoryJsonCache implements JsonCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string, parse: (raw: unknown) => T): Promise<T | null> {
    const entry = this.entries.get(key);
    if (entry === undefined) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    try {
      // Round-trip through JSON so stored values behave like Redis strings.
      return Promise.resolve(parse(JSON.parse(JSON.stringify(entry.value))));
    } catch {
      return Promise.resolve(null);
    }
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.entries.get(key);
    const fresh = entry === undefined || entry.expiresAt <= this.now();
    const current = fresh || typeof entry.value !== "number" ? 0 : entry.value;
    const next = current + 1;
    this.entries.set(key, {
      value: next,
      expiresAt: fresh ? this.now() + ttlSeconds * 1000 : entry.expiresAt,
    });
    return Promise.resolve(next);
  }
}
