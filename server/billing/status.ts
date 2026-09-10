import type { Plan } from "@/lib/types/enums";
import type { WorkspaceId } from "@/lib/types/ids";
import { getBillingStore, type BillingStore } from "@/server/billing/store";
import {
  graceEndsAt,
  isPaidPlan,
  isWorkspaceReadOnly,
  OVERAGE_CEILING_CREDITS,
  OVERAGE_UNIT_USD,
  TIERS,
} from "@/server/billing/tiers";

/**
 * Billing status for the settings UI — served by
 * GET /api/stripe/billing-status (the frozen billing.summary contract
 * cannot carry these fields; extending it is an open frozen-layer request,
 * see OPEN-ITEMS.md). Dates are ISO strings: this crosses a plain JSON route,
 * not superjson-encoded tRPC.
 */

export interface BillingStatus {
  plan: Plan;
  pendingPlan: Plan | null;
  creditBalance: number;
  /** The plan's monthly grant (free: the one-time signup grant). */
  monthlyCredits: number;
  billingCycleAnchor: string | null;
  billingPeriodEnd: string | null;
  paymentFailedAt: string | null;
  graceEndsAt: string | null;
  /** Failed-payment grace expired — workspace is locked to reads. */
  readOnly: boolean;
  overageEnabled: boolean;
  overageUsed: number;
  overageCeiling: number;
  overageUnitUsd: number;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export async function getBillingStatus(
  workspaceId: WorkspaceId,
  deps: { store?: BillingStore; now?: Date } = {},
): Promise<BillingStatus | null> {
  const store = deps.store ?? getBillingStore();
  const workspace = await store.getWorkspace(workspaceId);
  if (workspace === null) return null;
  const now = deps.now ?? new Date();
  return {
    plan: workspace.plan,
    pendingPlan: workspace.pendingPlan,
    creditBalance: workspace.creditBalance,
    monthlyCredits: TIERS[workspace.plan].monthlyCredits,
    billingCycleAnchor: iso(workspace.billingCycleAnchor),
    billingPeriodEnd: iso(workspace.billingPeriodEnd),
    paymentFailedAt: iso(workspace.paymentFailedAt),
    graceEndsAt: iso(graceEndsAt(workspace.paymentFailedAt)),
    readOnly: isWorkspaceReadOnly(workspace.paymentFailedAt, now),
    overageEnabled: isPaidPlan(workspace.plan) && workspace.stripeCustomerId !== null,
    overageUsed: workspace.overageUsed,
    overageCeiling: OVERAGE_CEILING_CREDITS,
    overageUnitUsd: OVERAGE_UNIT_USD,
  };
}
