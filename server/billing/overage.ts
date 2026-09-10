import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { logger } from "@/lib/logger";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { OVERDRAFT_FLOOR } from "@/server/credits";
import { getBillingStore, type BillingStore } from "@/server/billing/store";
import {
  GRACE_PERIOD_DAYS,
  isPaidPlan,
  isWorkspaceReadOnly,
  OVERAGE_CEILING_CREDITS,
} from "@/server/billing/tiers";

/**
 * Overage-aware credit gate (spec §7: $0.60/credit metered) — the drop-in
 * replacement for `requireCredits` from server/credits.ts, which stays
 * untouched (frozen). The five generation dispatch sites (script, revision,
 * research, titles, avatar) call this instead; the signature is a superset
 * of requireCredits, so the swap was import-only.
 *
 * Behavior:
 *  1. Read-only lockdown: a workspace whose failed-payment grace expired
 *     (7 days) cannot dispatch generation at all.
 *  2. Balance covers the cost → allow, nothing metered (identical to
 *     requireCredits).
 *  3. Balance short + paid plan + under the overage ceiling → allow-and-
 *     meter: the shortfall is granted via an idempotent ledger entry
 *     (reason `overage`, key `overage:…`) and reported to the Stripe
 *     billing meter, so the pipeline's normal completion charge still
 *     balances to zero and the customer pays $0.60/credit.
 *  4. Free plan, no Stripe customer, or ceiling reached → the familiar
 *     PRECONDITION_FAILED.
 *
 * The ceiling (OVERAGE_CEILING_CREDITS, default 200/cycle) bounds the blast
 * radius of runaway generation; `overage_used` resets each cycle in the
 * invoice.paid webhook handler.
 */

export interface OverageMeter {
  /** Report `credits` of metered overage for the Stripe customer (idempotent). */
  record(customerId: string, credits: number, idempotencyKey: string): Promise<void>;
}

export interface OverageOptions {
  /**
   * Dedupe key for this dispatch (e.g. the pipeline input hash). Defaults
   * to a random UUID — pass one wherever a retry could re-dispatch.
   */
  idempotencyKey?: string;
  actorUserId?: UserId | null;
  store?: BillingStore;
  meter?: OverageMeter;
  now?: Date;
}

function insufficient(cost: number, balance: number): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Not enough credits: this action costs ${String(cost)} credit${cost === 1 ? "" : "s"} and the workspace has ${String(balance)}. Buy more credits or upgrade the plan.`,
  });
}

export async function requireCreditsWithOverage(
  workspaceId: WorkspaceId,
  cost: number,
  options: OverageOptions = {},
): Promise<void> {
  const store = options.store ?? getBillingStore();
  const workspace = await store.getWorkspace(workspaceId);
  if (workspace === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "workspace not found" });
  }

  if (isWorkspaceReadOnly(workspace.paymentFailedAt, options.now ?? new Date())) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `This workspace is read-only: a payment failed more than ${String(GRACE_PERIOD_DAYS)} days ago. ` +
        "Update the payment method in the billing portal to resume generating.",
    });
  }

  if (workspace.creditBalance - cost >= OVERDRAFT_FLOOR) return;

  // Shortfall path — only paid plans with a Stripe customer can meter.
  if (!isPaidPlan(workspace.plan) || workspace.stripeCustomerId === null) {
    insufficient(cost, workspace.creditBalance);
  }

  const shortfall = cost - Math.max(workspace.creditBalance, 0);
  if (workspace.overageUsed + shortfall > OVERAGE_CEILING_CREDITS) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `Overage cap reached: this cycle has used ${String(workspace.overageUsed)} of ` +
        `${String(OVERAGE_CEILING_CREDITS)} overage credits and this action needs ${String(shortfall)} more. ` +
        "Upgrade the plan or wait for the monthly reset.",
    });
  }

  const idempotencyKey = `overage:${workspaceId}:${options.idempotencyKey ?? randomUUID()}`;
  const granted = await store.recordCredits({
    workspaceId,
    delta: shortfall,
    reason: "overage", // first-class reason (integration pass approved the enum member)
    idempotencyKey,
    actorUserId: options.actorUserId ?? null,
  });
  if (!granted) return; // key already granted (retry of the same dispatch) — already metered too

  await store.updateBilling(workspaceId, { overageUsed: workspace.overageUsed + shortfall });

  const meter = options.meter ?? (await defaultMeter());
  try {
    await meter.record(workspace.stripeCustomerId, shortfall, idempotencyKey);
  } catch (err) {
    // The credits are granted and generation proceeds; the miss is bounded
    // by the overage ceiling and auditable via the `overage:` ledger keys.
    logger.error(
      { err, workspaceId, shortfall, idempotencyKey },
      "overage metering failed after ledger grant — reconcile against Stripe",
    );
  }
}

async function defaultMeter(): Promise<OverageMeter> {
  const { getDefaultOverageMeter } = await import("@/server/billing/stripe");
  return getDefaultOverageMeter();
}
