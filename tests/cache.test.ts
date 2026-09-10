import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { z } from "zod";
import { createJsonCache, searchCacheKey } from "@/lib/cache";

/** Redis-backed helpers verified against ioredis-mock — no real Redis needed. */

const makeRedis = (): Redis => new RedisMock();

describe("JsonCache (ioredis-mock)", () => {
  it("round-trips JSON values with TTL", async () => {
    const cache = createJsonCache(makeRedis());
    const schema = z.object({ hits: z.number() });
    await cache.set("k1", { hits: 3 }, 60);
    const value = await cache.get("k1", (raw) => schema.parse(raw));
    expect(value).toEqual({ hits: 3 });
  });

  it("returns null for missing keys and unparseable payloads", async () => {
    const redis = makeRedis();
    const cache = createJsonCache(redis);
    expect(await cache.get("missing", (raw) => raw as string)).toBeNull();
    await redis.set("bad", "{not json");
    expect(await cache.get("bad", (raw) => raw as string)).toBeNull();
  });

  it("incrementWithTtl counts per key (free-tools IP rate limit)", async () => {
    const cache = createJsonCache(makeRedis());
    expect(await cache.incrementWithTtl("ip:1.2.3.4", 86_400)).toBe(1);
    expect(await cache.incrementWithTtl("ip:1.2.3.4", 86_400)).toBe(2);
    expect(await cache.incrementWithTtl("ip:5.6.7.8", 86_400)).toBe(1);
  });

  it("searchCacheKey normalizes queries for quota-friendly cache hits", () => {
    expect(searchCacheKey("  Home   Espresso ")).toBe(searchCacheKey("home espresso"));
  });
});
