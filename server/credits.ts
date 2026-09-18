import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { getConfig } from "@/lib/config";
import { isCreditExempt as isCreditExemptCore } from "@/lib/credits-exempt";
import type { Role } from "@/lib/types/enums";
import type { WorkspaceId } from "@/lib/types/ids";
import { getSharedWorkspaceStore } from "@/server/workspace/memory";

/**
 * Credit gating (spec §7) — checked at DISPATCH time, before any generation
 * job is enqueued or run inline, so a workspace can never start work it
 * cannot pay for. The completion-time charge in each pipeline stays the
 * moment the ledger entry is written (never on failure); the database CHECK
 * on workspaces.credit_balance (>= OVERDRAFT_FLOOR) is the backstop against
 * concurrent races pushing the balance negative.
 */

/** Balance may never drop below this (0 for now — no overdraft). */
export const OVERDRAFT_FLOOR = 0;

/** Costs per generation action (spec §7 + PRODUCT-CONTRACTS §4). */
export const CREDIT_COSTS = {
  /**
   * Composite script generation — equals scriptOutline + scriptHooks +
   * scriptDraft (1+1+4). The `script.generate` orchestrator charges the
   * stages itemized; this constant remains the summed cost and MUST stay
   *  in sync with the three stage entries below.
   */
  scriptGeneration: 6,
  // -- staged script procedures (PRODUCT-CONTRACTS §4, wave C) -------------
  scriptTopics: 1,
  scriptOutline: 1,
  scriptHooks: 1,
  scriptDraft: 4,
  revisionPass: 2,
  researchRun: 1,
  titles: 1,
  avatarRegen: 1,
  /** Extra user-requested idea batch — free during playtest (was 1). */
  ideaBatch: 0,
  /**
   * Train a voice from a channel (WAVE-D-PLAN §2c) — pulls transcripts and
   * derives a structured StyleCard via the LLM. Charged once per training run
   * (idempotent on the channel + sampled-video hash); a re-train of the same
   * sample is free (re-serves the derived card). Covers both the own-channel
   * derivation and the competitor remix.
   */
  trainVoice: 5,
} as const;

/** Current balance, or null when the workspace does not exist. */
export async function getCreditBalance(workspaceId: WorkspaceId): Promise<number | null> {
  if (!hasDb()) {
    return getSharedWorkspaceStore().get(workspaceId)?.creditBalance ?? null;
  }
  const rows = await getDb()
    .select({ creditBalance: schema.workspaces.creditBalance })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return rows[0]?.creditBalance ?? null;
}

export type CreditExemption = {
  userEmail?: string | null;
  workspaceRole?: Role | null;
};

/**
 * True when the actor is on ADMIN_EMAILS (case-insensitive) or is a workspace
 * owner/admin — or, TEMPORARILY, whenever PLAYTEST_AUTH_BYPASS is on: the
 * playtest deployment is free for everyone (no gating, no debits) so nobody
 * hits a paywall. Every ledger path below still runs and is still tested
 * with the flag off; flipping the env restores metering. Remove together with
 * PLAYTEST_AUTH_BYPASS before public launch.
 */
export function isCreditExempt(
  userEmail: string | null | undefined,
  workspaceRole: Role | null | undefined,
): boolean {
  const { ADMIN_EMAILS, PLAYTEST_AUTH_BYPASS } = getConfig();
  if (PLAYTEST_AUTH_BYPASS) return true;
  return isCreditExemptCore(userEmail, workspaceRole, ADMIN_EMAILS);
}

export function exemptionFromCtx(ctx: {
  role?: Role | null;
  userEmail?: string | null;
  session?: { user?: { email?: string | null } } | null;
}): CreditExemption {
  return {
    userEmail: ctx.userEmail ?? ctx.session?.user?.email ?? null,
    workspaceRole: ctx.role ?? null,
  };
}

export function isCtxCreditExempt(ctx: Parameters<typeof exemptionFromCtx>[0]): boolean {
  const exemption = exemptionFromCtx(ctx);
  return isCreditExempt(exemption.userEmail, exemption.workspaceRole);
}

/**
 * Throws PRECONDITION_FAILED unless the workspace can afford `cost` without
 * dropping below the overdraft floor. Exempt actors (ADMIN_EMAILS or
 * owner/admin role) skip the check and are never blocked.
 */
export async function requireCredits(
  workspaceId: WorkspaceId,
  cost: number,
  exemption: CreditExemption = {},
): Promise<void> {
  if (isCreditExempt(exemption.userEmail, exemption.workspaceRole)) return;
  const balance = await getCreditBalance(workspaceId);
  if (balance === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "workspace not found" });
  }
  if (balance - cost < OVERDRAFT_FLOOR) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Not enough credits: this action costs ${cost} credit${cost === 1 ? "" : "s"} and the workspace has ${balance}. Buy more credits or upgrade the plan.`,
    });
  }
}
