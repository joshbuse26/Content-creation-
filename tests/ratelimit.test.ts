import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import {
  MemorySlidingWindowStore,
  RateLimiter,
  RedisSlidingWindowStore,
  type SlidingWindowStore,
} from "@/server/ratelimit/limiter";
import { RATE_LIMIT_POLICIES } from "@/server/ratelimit/policies";

function makeLimiter(store: SlidingWindowStore): {
  limiter: RateLimiter;
  advance: (ms: number) => void;
} {
  let now = 1_000_000;
  const limiter = new RateLimiter(store, () => now);
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const stores: [string, () => SlidingWindowStore][] = [
  ["memory", () => new MemorySlidingWindowStore()],
  ["redis (ioredis-mock)", () => new RedisSlidingWindowStore(new RedisMock())],
];

describe.each(stores)("sliding window limiter — %s store", (_name, makeStore) => {
  it("allows exactly `limit` hits then denies (auth: 5/min boundary)", async () => {
    const { limiter } = makeLimiter(makeStore());
    for (let i = 0; i < 5; i++) {
      const d = await limiter.check(RATE_LIMIT_POLICIES.auth, "user-1");
      expect(d.allowed).toBe(true);
      expect(d.remaining).toBe(5 - (i + 1));
    }
    const denied = await limiter.check(RATE_LIMIT_POLICIES.auth, "user-1");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("slides: hits expire individually, not at a fixed boundary", async () => {
    const { limiter, advance } = makeLimiter(makeStore());
    // 3 hits at t=0, 2 hits at t=30s → full.
    for (let i = 0; i < 3; i++) await limiter.check(RATE_LIMIT_POLICIES.auth, "u");
    advance(30_000);
    for (let i = 0; i < 2; i++) await limiter.check(RATE_LIMIT_POLICIES.auth, "u");
    expect((await limiter.check(RATE_LIMIT_POLICIES.auth, "u")).allowed).toBe(false);

    // 31s later the first 3 hits (now 61s old) fall out; the 2 newer remain.
    advance(31_000);
    const d = await limiter.check(RATE_LIMIT_POLICIES.auth, "u");
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2); // 5 - (2 surviving + this hit)
  });

  it("denied requests do not extend the lockout", async () => {
    const { limiter, advance } = makeLimiter(makeStore());
    for (let i = 0; i < 5; i++) await limiter.check(RATE_LIMIT_POLICIES.auth, "u");
    for (let i = 0; i < 20; i++) {
      expect((await limiter.check(RATE_LIMIT_POLICIES.auth, "u")).allowed).toBe(false);
    }
    advance(60_001);
    expect((await limiter.check(RATE_LIMIT_POLICIES.auth, "u")).allowed).toBe(true);
  });

  it("isolates subjects and policies", async () => {
    const { limiter } = makeLimiter(makeStore());
    for (let i = 0; i < 5; i++) await limiter.check(RATE_LIMIT_POLICIES.auth, "a");
    expect((await limiter.check(RATE_LIMIT_POLICIES.auth, "a")).allowed).toBe(false);
    // Different subject, same policy: fresh budget.
    expect((await limiter.check(RATE_LIMIT_POLICIES.auth, "b")).allowed).toBe(true);
    // Same subject, different policy: fresh budget.
    expect((await limiter.check(RATE_LIMIT_POLICIES.generation, "a")).allowed).toBe(true);
  });

  it("enforces the generation policy boundary (10/min)", async () => {
    const { limiter } = makeLimiter(makeStore());
    for (let i = 0; i < 10; i++) {
      expect((await limiter.check(RATE_LIMIT_POLICIES.generation, "u")).allowed).toBe(true);
    }
    expect((await limiter.check(RATE_LIMIT_POLICIES.generation, "u")).allowed).toBe(false);
  });

  it("enforces the free-tools policy over a day window (5/day per IP)", async () => {
    const { limiter, advance } = makeLimiter(makeStore());
    for (let i = 0; i < 5; i++) {
      expect((await limiter.check(RATE_LIMIT_POLICIES.freeTools, "1.2.3.4")).allowed).toBe(true);
      advance(3_600_000); // one hit per hour
    }
    // 5 hits within the last 24h → denied even hours later.
    expect((await limiter.check(RATE_LIMIT_POLICIES.freeTools, "1.2.3.4")).allowed).toBe(false);
    // 20h after the last hit, the first hit is >24h old → one slot frees up.
    advance(20 * 3_600_000);
    expect((await limiter.check(RATE_LIMIT_POLICIES.freeTools, "1.2.3.4")).allowed).toBe(true);
  });
});

describe("general policy boundary (100/min)", () => {
  it("allows 100 then denies the 101st", async () => {
    const { limiter } = makeLimiter(new MemorySlidingWindowStore());
    for (let i = 0; i < 100; i++) {
      expect((await limiter.check(RATE_LIMIT_POLICIES.general, "u")).allowed).toBe(true);
    }
    const denied = await limiter.check(RATE_LIMIT_POLICIES.general, "u");
    expect(denied.allowed).toBe(false);
    expect(denied.limit).toBe(100);
  });
});

describe("policy table", () => {
  it("matches spec §6", () => {
    expect(RATE_LIMIT_POLICIES.general).toMatchObject({ limit: 100, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES.generation).toMatchObject({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES.auth).toMatchObject({ limit: 5, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES.freeTools).toMatchObject({ limit: 5, windowMs: 86_400_000 });
  });
});
