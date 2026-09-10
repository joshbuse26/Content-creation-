import { TRPCError } from "@trpc/server";
import type { Plan } from "@/lib/types/enums";
import { checkChannelLimit, checkSeatLimit, TIERS } from "@/server/billing/tiers";

/**
 * Throwing tier-limit enforcement (spec §7) — call sites:
 *
 *   - channel connect: `server/routers/impl/channel.ts` connectPublic (and
 *     the OAuth callback's connectOauthChannel path) — call
 *     `assertChannelLimit(plan, currentChannelCount)` before inserting.
 *   - member invite: `server/routers/impl/workspace.ts` invite — call
 *     `assertSeatLimit(plan, currentMemberCount)` before inserting.
 *
 * B3 owns the helpers only; the integrator wires them into those impls
 * (exact lines in REQUESTS-B3.md). Errors are PRECONDITION_FAILED with
 * user-facing upgrade copy, matching requireCredits' failure shape.
 */

export function assertChannelLimit(plan: Plan, currentCount: number): void {
  const check = checkChannelLimit(plan, currentCount);
  if (check.allowed) return;
  const limit = check.limit ?? Infinity;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `The ${TIERS[plan].label} plan includes ${String(limit)} channel${limit === 1 ? "" : "s"} ` +
      `and this workspace already has ${String(currentCount)} connected. ` +
      "Upgrade the plan to connect more channels.",
  });
}

export function assertSeatLimit(plan: Plan, currentSeats: number): void {
  const check = checkSeatLimit(plan, currentSeats);
  if (check.allowed) return;
  const limit = check.limit ?? Infinity;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `The ${TIERS[plan].label} plan includes ${String(limit)} seat${limit === 1 ? "" : "s"} ` +
      `and this workspace already has ${String(currentSeats)} member${currentSeats === 1 ? "" : "s"}. ` +
      "Upgrade the plan to invite more people.",
  });
}
