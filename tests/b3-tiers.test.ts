import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertChannelLimit, assertSeatLimit } from "@/server/billing/limits";
import {
  checkChannelLimit,
  checkSeatLimit,
  graceEndsAt,
  GRACE_PERIOD_DAYS,
  isPaidPlan,
  isWorkspaceReadOnly,
  OVERAGE_CEILING_CREDITS,
  OVERAGE_UNIT_USD,
  PLAN_RANK,
  TIERS,
} from "@/server/billing/tiers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("tier config (spec §7)", () => {
  it("matches the spec numbers exactly", () => {
    expect(TIERS.free).toMatchObject({ monthlyCredits: 8, channelLimit: 1, seatLimit: 1 });
    expect(TIERS.starter).toMatchObject({
      priceUsdMonthly: 49,
      monthlyCredits: 60,
      channelLimit: 3,
      seatLimit: 2,
      priceEnvVar: "STRIPE_PRICE_STARTER",
    });
    expect(TIERS.team).toMatchObject({
      priceUsdMonthly: 99,
      monthlyCredits: 200,
      channelLimit: 10,
      seatLimit: 5,
      priceEnvVar: "STRIPE_PRICE_TEAM",
    });
    expect(TIERS.agency).toMatchObject({
      priceUsdMonthly: 249,
      monthlyCredits: 600,
      channelLimit: null,
      seatLimit: 15,
      priceEnvVar: "STRIPE_PRICE_AGENCY",
    });
    expect(OVERAGE_UNIT_USD).toBe(0.6);
    expect(OVERAGE_CEILING_CREDITS).toBe(200);
    expect(GRACE_PERIOD_DAYS).toBe(7);
  });

  it("ranks plans for upgrade/downgrade decisions", () => {
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.starter);
    expect(PLAN_RANK.starter).toBeLessThan(PLAN_RANK.team);
    expect(PLAN_RANK.team).toBeLessThan(PLAN_RANK.agency);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("agency")).toBe(true);
  });
});

describe("channel limit", () => {
  it("free allows the first channel, blocks the second", () => {
    expect(checkChannelLimit("free", 0).allowed).toBe(true);
    expect(checkChannelLimit("free", 1).allowed).toBe(false);
  });

  it("starter blocks the fourth channel", () => {
    expect(checkChannelLimit("starter", 2).allowed).toBe(true);
    expect(checkChannelLimit("starter", 3).allowed).toBe(false);
  });

  it("agency is unlimited", () => {
    expect(checkChannelLimit("agency", 5000)).toEqual({
      allowed: true,
      limit: null,
      current: 5000,
    });
  });

  it("assertChannelLimit throws PRECONDITION_FAILED with upgrade copy", () => {
    expect(() => {
      assertChannelLimit("starter", 3);
    }).toThrow(TRPCError);
    try {
      assertChannelLimit("starter", 3);
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
      expect((err as TRPCError).message).toMatch(/Upgrade the plan/);
    }
    expect(() => {
      assertChannelLimit("agency", 999);
    }).not.toThrow();
  });
});

describe("seat limit", () => {
  it("free is single-seat", () => {
    expect(checkSeatLimit("free", 1).allowed).toBe(false);
  });

  it("team allows 5 seats, not 6", () => {
    expect(checkSeatLimit("team", 4).allowed).toBe(true);
    expect(checkSeatLimit("team", 5).allowed).toBe(false);
  });

  it("assertSeatLimit throws PRECONDITION_FAILED at the cap", () => {
    try {
      assertSeatLimit("starter", 2);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    }
    expect(() => {
      assertSeatLimit("starter", 1);
    }).not.toThrow();
  });
});

describe("failed-payment grace → read-only (spec §7)", () => {
  const failedAt = new Date("2026-09-01T12:00:00.000Z");

  it("healthy workspaces are never read-only", () => {
    expect(graceEndsAt(null)).toBeNull();
    expect(isWorkspaceReadOnly(null, new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });

  it("stays writable through day 7 and locks after", () => {
    const ends = graceEndsAt(failedAt);
    expect(ends).toEqual(new Date(failedAt.getTime() + 7 * DAY_MS));
    expect(isWorkspaceReadOnly(failedAt, new Date(failedAt.getTime() + 6 * DAY_MS))).toBe(false);
    expect(isWorkspaceReadOnly(failedAt, new Date(failedAt.getTime() + 7 * DAY_MS - 1))).toBe(
      false,
    );
    expect(isWorkspaceReadOnly(failedAt, new Date(failedAt.getTime() + 7 * DAY_MS))).toBe(true);
    expect(isWorkspaceReadOnly(failedAt, new Date(failedAt.getTime() + 30 * DAY_MS))).toBe(true);
  });
});
