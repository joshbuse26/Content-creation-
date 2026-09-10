import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import { fixtureLedgerEntry, fixtureWorkspace } from "@/lib/fixtures";
import type { billingContracts } from "@/lib/types/api";
import { creditLedgerEntrySchema, workspaceSchema } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import {
  createCheckoutSession,
  createPortalSession,
  type StripeGateway,
} from "@/server/billing/checkout";
import { getBillingStore } from "@/server/billing/store";
import type { PaidPlan } from "@/server/billing/tiers";
import { notFound } from "./_shared";

/**
 * billing router handlers (B3):
 *  - summary — real workspace + credit ledger when a database is configured,
 *    fixture data otherwise (unchanged from the integration pass).
 *  - checkout — Stripe Checkout session for a paid tier (mode subscription,
 *    price from STRIPE_PRICE_<TIER>, metered overage price attached when
 *    STRIPE_PRICE_OVERAGE is set).
 *  - portal — Stripe customer-portal session.
 *
 * Without STRIPE_SECRET_KEY (fixture/dev) checkout & portal return the same
 * deterministic URLs the pre-B3 stubs did, so the zero-key boot keeps
 * working. The integrator swaps the _contracts.ts stub bodies for these
 * handlers (REQUESTS-B3.md).
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type SummaryOutput = z.output<typeof billingContracts.summary.output>;

const LEDGER_LIMIT = 50;

async function liveGateway(): Promise<StripeGateway | null> {
  const { getStripeClient, liveStripeGateway } = await import("@/server/billing/stripe");
  const stripe = await getStripeClient();
  return stripe === null ? null : liveStripeGateway(stripe);
}

async function workspaceName(workspaceId: WorkspaceId): Promise<string | undefined> {
  if (!hasDb()) return undefined;
  const rows = await getDb()
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return rows[0]?.name;
}

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

  async checkout(opts: {
    ctx: HandlerCtx;
    input: { workspaceId: WorkspaceId; plan: PaidPlan };
  }): Promise<{ checkoutUrl: string }> {
    const gateway = await liveGateway();
    if (gateway === null) {
      // Fixture/dev parity with the pre-B3 stub: keyless boot still works.
      return { checkoutUrl: `https://checkout.stripe.com/c/pay/fixture_${opts.input.plan}` };
    }
    return createCheckoutSession(
      { gateway, store: getBillingStore() },
      {
        workspaceId: opts.ctx.workspaceId,
        plan: opts.input.plan,
        workspaceName: await workspaceName(opts.ctx.workspaceId),
      },
    );
  },

  async portal(opts: { ctx: HandlerCtx }): Promise<{ portalUrl: string }> {
    const gateway = await liveGateway();
    if (gateway === null) {
      return { portalUrl: "https://billing.stripe.com/p/session/fixture" };
    }
    return createPortalSession(
      { gateway, store: getBillingStore() },
      { workspaceId: opts.ctx.workspaceId },
    );
  },
} as const;
