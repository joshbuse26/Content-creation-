import type { UserId } from "@/lib/types/ids";
import { requireCreditsWithOverage } from "@/server/billing/overage";
import type { CreditRecord, EngineStore } from "./store/types";

/**
 * Completion-charge settlement (wave-C adversarial F1/F5) — the ONE way a
 * pipeline writes its post-work debit.
 *
 * The charge itself is idempotent per ledger key (ON CONFLICT DO NOTHING),
 * so it is safe to attempt on every completed run. What this helper adds is
 * the balance-floor story: a post-work charge can bounce off the database
 * CHECK on workspaces.credit_balance (>= 0) when credits were spent between
 * dispatch and completion. Instead of surfacing as a raw 500 (and burning a
 * fresh LLM run on the retry), the floor violation re-runs the dispatch
 * gate at completion:
 *
 *  - paid plan under the overage ceiling → the shortfall is granted via the
 *    idempotent overage path (keyed on this charge's ledger key) and the
 *    charge is retried once — it now lands;
 *  - otherwise → the typed PRECONDITION_FAILED propagates, the caller fails
 *    the run cleanly, and (with persisted stage outputs) the retry re-serves
 *    the work and re-attempts only the charge.
 */

/** Postgres check_violation on the workspaces balance-floor CHECK. */
export function isBalanceFloorViolation(err: unknown): boolean {
  for (let cursor: unknown = err; cursor instanceof Error; cursor = cursor.cause) {
    const { code, constraint } = cursor as { code?: unknown; constraint?: unknown };
    if (
      code === "23514" ||
      constraint === "workspaces_credit_balance_floor" ||
      cursor.message.includes("workspaces_credit_balance_floor")
    ) {
      return true;
    }
  }
  return false;
}

export async function settleCharge(
  store: Pick<EngineStore, "recordCredits">,
  charge: CreditRecord & { idempotencyKey: string },
): Promise<void> {
  try {
    await store.recordCredits(charge);
  } catch (err) {
    if (!isBalanceFloorViolation(err)) throw err;
    await requireCreditsWithOverage(charge.workspaceId, -charge.delta, {
      idempotencyKey: charge.idempotencyKey,
      actorUserId: (charge.actorUserId as UserId | null) ?? null,
    });
    await store.recordCredits(charge);
  }
}
