import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import { fixtureLedgerEntry, fixtureWorkspace } from "@/lib/fixtures";
import type { billingContracts } from "@/lib/types/api";
import { creditLedgerEntrySchema, workspaceSchema } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { notFound } from "./_shared";

/**
 * billing.summary — reads the real workspace + credit ledger when a database
 * is configured; fixture data otherwise. checkout/portal stay fixture stubs
 * (live Stripe is v1.1 — see OPEN-ITEMS.md).
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type SummaryOutput = z.output<typeof billingContracts.summary.output>;

const LEDGER_LIMIT = 50;

export const billingHandlers = {
  async summary(opts: { ctx: HandlerCtx }): Promise<SummaryOutput> {
    if (!hasDb()) {
      return {
        plan: fixtureWorkspace.plan,
        creditBalance: fixtureWorkspace.creditBalance,
        billingCycleAnchor: fixtureWorkspace.billingCycleAnchor,
        ledger: [fixtureLedgerEntry],
      };
    }
    const workspaceRows = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, opts.ctx.workspaceId))
      .limit(1);
    const workspaceRow = workspaceRows[0];
    if (workspaceRow === undefined) notFound("workspace");
    const workspace = workspaceSchema.parse(workspaceRow);
    const ledgerRows = await getDb()
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.workspaceId, opts.ctx.workspaceId))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(LEDGER_LIMIT);
    return {
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
      billingCycleAnchor: workspace.billingCycleAnchor,
      ledger: ledgerRows.map((r) => creditLedgerEntrySchema.parse(r)),
    };
  },
} as const;
