import type { Plan } from "@/lib/types/enums";

/**
 * Tier definitions (spec §7) — the single source of truth for plan limits,
 * monthly credit grants, and Stripe price wiring. Config, not magic numbers:
 * enforcement helpers, the webhook grant math, checkout, and the billing UI
 * all read from here.
 *
 * This module is deliberately dependency-free (no trpc, no db, no Stripe)
 * so the client billing panel can import it for display without dragging
 * server code into the bundle. Throwing enforcement helpers live in
 * `server/billing/limits.ts`.
 */

export interface TierConfig {
  plan: Plan;
  label: string;
  /** USD per month; 0 for free. Display only — Stripe prices are authoritative. */
  priceUsdMonthly: number;
  /** Credits granted each cycle (free: once at signup, no monthly grant). */
  monthlyCredits: number;
  /** Max connected channels; null = unlimited. */
  channelLimit: number | null;
  /** Max workspace members (seats). */
  seatLimit: number;
  /** Env var holding the Stripe price (lookup key or price id); null = not purchasable. */
  priceEnvVar: string | null;
}

export const TIERS: Record<Plan, TierConfig> = {
  free: {
    plan: "free",
    label: "Free",
    priceUsdMonthly: 0,
    monthlyCredits: 8, // granted once at signup, never refilled (spec §7)
    channelLimit: 1,
    seatLimit: 1,
    priceEnvVar: null,
  },
  starter: {
    plan: "starter",
    label: "Starter",
    priceUsdMonthly: 49,
    monthlyCredits: 60,
    channelLimit: 3,
    seatLimit: 2,
    priceEnvVar: "STRIPE_PRICE_STARTER",
  },
  team: {
    plan: "team",
    label: "Team",
    priceUsdMonthly: 99,
    monthlyCredits: 200,
    channelLimit: 10,
    seatLimit: 5,
    priceEnvVar: "STRIPE_PRICE_TEAM",
  },
  agency: {
    plan: "agency",
    label: "Agency",
    priceUsdMonthly: 249,
    monthlyCredits: 600,
    channelLimit: null,
    seatLimit: 15,
    priceEnvVar: "STRIPE_PRICE_AGENCY",
  },
} as const;

export const PAID_PLANS = ["starter", "team", "agency"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(plan: Plan): plan is PaidPlan {
  return plan !== "free";
}

/** Upgrade/downgrade ordering (free < starter < team < agency). */
export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  team: 2,
  agency: 3,
};

// ---------------------------------------------------------------------------
// Overage (spec §7: $0.60/credit, metered)
// ---------------------------------------------------------------------------

/** Price per overage credit, USD. Display only — the Stripe metered price bills. */
export const OVERAGE_UNIT_USD = 0.6;

/**
 * Max overage credits per cycle — bounds the blast radius of runaway
 * generation to OVERAGE_CEILING_CREDITS × $0.60 = $120/cycle by default.
 */
export const OVERAGE_CEILING_CREDITS = 200;

// ---------------------------------------------------------------------------
// Failed payment grace (spec §7: 7 days → read-only)
// ---------------------------------------------------------------------------

export const GRACE_PERIOD_DAYS = 7;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/** When the grace period ends (null while payments are healthy). */
export function graceEndsAt(paymentFailedAt: Date | null): Date | null {
  return paymentFailedAt === null ? null : new Date(paymentFailedAt.getTime() + GRACE_PERIOD_MS);
}

/**
 * Read-only lockdown: a payment failed more than GRACE_PERIOD_DAYS ago and
 * has not recovered (recovery — invoice.paid — clears paymentFailedAt).
 * Computed, not stored: no cron needed to flip a flag at hour 168.
 */
export function isWorkspaceReadOnly(paymentFailedAt: Date | null, now: Date = new Date()): boolean {
  const ends = graceEndsAt(paymentFailedAt);
  return ends !== null && now.getTime() >= ends.getTime();
}

// ---------------------------------------------------------------------------
// Limit checks (pure — throwing variants in limits.ts)
// ---------------------------------------------------------------------------

export interface LimitCheck {
  allowed: boolean;
  /** null = unlimited. */
  limit: number | null;
  current: number;
}

/** May this plan connect one more channel given `currentCount` connected? */
export function checkChannelLimit(plan: Plan, currentCount: number): LimitCheck {
  const limit = TIERS[plan].channelLimit;
  return { allowed: limit === null || currentCount < limit, limit, current: currentCount };
}

/** May this plan add one more member given `currentSeats` occupied? */
export function checkSeatLimit(plan: Plan, currentSeats: number): LimitCheck {
  const limit = TIERS[plan].seatLimit;
  return { allowed: currentSeats < limit, limit, current: currentSeats };
}
