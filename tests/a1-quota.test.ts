import { describe, expect, it } from "vitest";
import {
  DAILY_QUOTA_BUDGET,
  InMemoryQuotaCounter,
  QUOTA_CIRCUIT_BREAKER,
  QUOTA_UNITS,
  QuotaExceededError,
  QuotaTracker,
} from "@/pipelines/sync/quota";

describe("QuotaTracker", () => {
  it("charges the documented unit costs (spec §2/§8)", async () => {
    const tracker = new QuotaTracker(new InMemoryQuotaCounter());
    expect(QUOTA_UNITS["search.list"]).toBe(100);
    expect(QUOTA_UNITS["channels.list"]).toBe(1);
    expect(QUOTA_UNITS["videos.list"]).toBe(1);
    expect(QUOTA_UNITS["playlistItems.list"]).toBe(1);
    await tracker.charge("channels.list");
    await tracker.charge("videos.list", 2);
    await tracker.charge("search.list");
    expect(await tracker.usedToday()).toBe(1 + 2 + 100);
  });

  it("trips the circuit breaker at 9,000 units and spends nothing past it", async () => {
    expect(QUOTA_CIRCUIT_BREAKER).toBe(9_000);
    expect(DAILY_QUOTA_BUDGET).toBe(10_000);
    const tracker = new QuotaTracker(new InMemoryQuotaCounter());
    for (let i = 0; i < 90; i++) {
      await tracker.charge("search.list"); // 90 × 100u = 9,000 — exactly at the line
    }
    expect(await tracker.usedToday()).toBe(9_000);
    expect(await tracker.isTripped()).toBe(true);
    await expect(tracker.charge("search.list")).rejects.toThrow(QuotaExceededError);
    await expect(tracker.charge("videos.list")).rejects.toThrow(QuotaExceededError);
    // Refused charges spend nothing.
    expect(await tracker.usedToday()).toBe(9_000);
  });

  it("refuses a charge that would cross the breaker even from below it", async () => {
    const tracker = new QuotaTracker(new InMemoryQuotaCounter());
    for (let i = 0; i < 89; i++) {
      await tracker.charge("search.list"); // 8,900
    }
    await tracker.charge("videos.list", 99); // 8,999 — fine
    await expect(tracker.charge("search.list")).rejects.toThrow(QuotaExceededError); // would be 9,099
    await tracker.charge("videos.list"); // 9,000 exactly — allowed
    expect(await tracker.usedToday()).toBe(9_000);
  });

  it("resets with the UTC day", async () => {
    let today = new Date("2026-09-10T23:59:00.000Z");
    const tracker = new QuotaTracker(new InMemoryQuotaCounter(), { now: () => today });
    for (let i = 0; i < 90; i++) {
      await tracker.charge("search.list");
    }
    await expect(tracker.charge("channels.list")).rejects.toThrow(QuotaExceededError);
    today = new Date("2026-09-11T00:01:00.000Z");
    expect(await tracker.usedToday()).toBe(0);
    await expect(tracker.charge("channels.list")).resolves.toBe(1);
  });
});
