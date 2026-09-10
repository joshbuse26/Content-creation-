import { z } from "zod";
import { logger as defaultLogger } from "@/lib/logger";
import { PLANS, type Plan } from "@/lib/types/enums";
import { workspaceIdSchema } from "@/lib/types/ids";
import type { BillingStore, BillingWorkspace } from "@/server/billing/store";
import { isPaidPlan, TIERS } from "@/server/billing/tiers";

/**
 * Stripe webhook domain logic (spec §7) — pure handlers over the
 * BillingStore port, testable without the Stripe SDK or Postgres. The route
 * (`app/api/stripe/webhook`) does signature verification and hands verified
 * events here.
 *
 * Idempotency: every event id is recorded in `stripe_events` (unique) before
 * any side effect — a replayed delivery is acknowledged without reprocessing.
 * Ledger writes are ALSO keyed on the event id (`plan_grant:<evt>`,
 * `monthly_reset:<evt>`) so even a lost `stripe_events` row cannot double-
 * grant or double-expire.
 *
 * Events handled:
 *  - checkout.session.completed  → set plan + grant cycle credits
 *  - invoice.paid                → monthly reset: expire remainder (no
 *                                  rollover) + grant; apply pending plan
 *                                  change at the period boundary; clear
 *                                  failed-payment grace
 *  - customer.subscription.updated → stage up/downgrade as pendingPlan
 *                                  (applied at the boundary), track period end
 *  - invoice.payment_failed      → start the 7-day grace period
 *  - customer.subscription.deleted → downgrade to free, expire paid credits
 */

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

export interface WebhookDeps {
  store: BillingStore;
  now?: () => Date;
  logger?: typeof defaultLogger;
  /** Maps a Stripe price to a plan; defaults to the STRIPE_PRICE_* env vars. */
  priceToPlan?: (price: { id?: string | null; lookupKey?: string | null }) => Plan | null;
}

export interface WebhookResult {
  received: true;
  /** Event id already processed — no side effects re-applied. */
  duplicate: boolean;
  /** A billing state change was applied. */
  handled: boolean;
  action: string;
}

// ---------------------------------------------------------------------------
// Loose payload schemas — extract only what the handlers use.
// ---------------------------------------------------------------------------

const planFieldSchema = z.enum(PLANS);

const checkoutSessionSchema = z.looseObject({
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
  client_reference_id: z.string().nullish(),
  metadata: z.looseObject({ workspaceId: z.string().nullish(), plan: z.string().nullish() }),
});

const invoiceSchema = z.looseObject({
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
  billing_reason: z.string().nullish(),
  period_start: z.number().nullish(),
  period_end: z.number().nullish(),
  lines: z
    .looseObject({
      data: z.array(
        z.looseObject({
          subscription: z.string().nullish(),
          period: z.looseObject({ start: z.number().nullish(), end: z.number().nullish() }),
        }),
      ),
    })
    .nullish(),
});

const subscriptionSchema = z.looseObject({
  id: z.string(),
  customer: z.string().nullish(),
  status: z.string().nullish(),
  current_period_end: z.number().nullish(),
  items: z
    .looseObject({
      data: z.array(
        z.looseObject({
          current_period_end: z.number().nullish(),
          price: z
            .looseObject({ id: z.string().nullish(), lookup_key: z.string().nullish() })
            .nullish(),
        }),
      ),
    })
    .nullish(),
});

const epochToDate = (seconds: number | null | undefined): Date | null =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

/** Default price→plan mapping: STRIPE_PRICE_* env values match a price id or lookup key. */
export function envPriceToPlan(price: {
  id?: string | null;
  lookupKey?: string | null;
}): Plan | null {
  for (const tier of Object.values(TIERS)) {
    if (tier.priceEnvVar === null) continue;
    const configured = process.env[tier.priceEnvVar]?.trim();
    if (configured === undefined || configured === "") continue;
    if (price.id === configured || price.lookupKey === configured) return tier.plan;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

interface HandlerCtx {
  event: StripeWebhookEvent;
  store: BillingStore;
  now: Date;
  log: typeof defaultLogger;
  priceToPlan: NonNullable<WebhookDeps["priceToPlan"]>;
}

async function findWorkspace(
  ctx: HandlerCtx,
  refs: { customer?: string | null; subscription?: string | null },
): Promise<BillingWorkspace | null> {
  if (typeof refs.subscription === "string" && refs.subscription !== "") {
    const bySub = await ctx.store.findBySubscriptionId(refs.subscription);
    if (bySub !== null) return bySub;
  }
  if (typeof refs.customer === "string" && refs.customer !== "") {
    return ctx.store.findByCustomerId(refs.customer);
  }
  return null;
}

async function onCheckoutCompleted(ctx: HandlerCtx): Promise<string> {
  const session = checkoutSessionSchema.parse(ctx.event.data.object);
  const rawWorkspaceId = session.metadata.workspaceId ?? session.client_reference_id;
  const workspaceIdParse = workspaceIdSchema.safeParse(rawWorkspaceId);
  const planParse = planFieldSchema.safeParse(session.metadata.plan);
  if (!workspaceIdParse.success || !planParse.success || !isPaidPlan(planParse.data)) {
    ctx.log.error({ eventId: ctx.event.id }, "checkout.session.completed missing metadata");
    return "ignored_bad_metadata";
  }
  const workspaceId = workspaceIdParse.data;
  const plan = planParse.data;
  const workspace = await ctx.store.getWorkspace(workspaceId);
  if (workspace === null) {
    ctx.log.error({ eventId: ctx.event.id, workspaceId }, "checkout for unknown workspace");
    return "ignored_unknown_workspace";
  }
  await ctx.store.updateBilling(workspaceId, {
    plan,
    stripeCustomerId: session.customer ?? workspace.stripeCustomerId,
    stripeSubscriptionId: session.subscription ?? workspace.stripeSubscriptionId,
    billingCycleAnchor: ctx.now,
    pendingPlan: null,
    paymentFailedAt: null,
    overageUsed: 0,
  });
  await ctx.store.recordCredits({
    workspaceId,
    delta: TIERS[plan].monthlyCredits,
    reason: "plan_grant",
    idempotencyKey: `plan_grant:${ctx.event.id}`,
  });
  return `activated_${plan}`;
}

async function onInvoicePaid(ctx: HandlerCtx): Promise<string> {
  const invoice = invoiceSchema.parse(ctx.event.data.object);
  const lineSubscription = invoice.lines?.data.find(
    (l) => typeof l.subscription === "string",
  )?.subscription;
  const workspace = await findWorkspace(ctx, {
    customer: invoice.customer,
    subscription: invoice.subscription ?? lineSubscription,
  });
  if (workspace === null) return "ignored_unknown_customer";

  const linePeriods = invoice.lines?.data ?? [];
  const periodStart =
    epochToDate(linePeriods[0]?.period.start) ?? epochToDate(invoice.period_start) ?? ctx.now;
  const periodEndCandidates = linePeriods
    .map((l) => l.period.end)
    .filter((e): e is number => typeof e === "number");
  const periodEnd =
    epochToDate(periodEndCandidates.length > 0 ? Math.max(...periodEndCandidates) : null) ??
    epochToDate(invoice.period_end);

  if (invoice.billing_reason === "subscription_create") {
    // The initial invoice: checkout.session.completed already set the plan
    // and granted the first cycle — only track the period + clear grace.
    await ctx.store.updateBilling(workspace.id, {
      billingPeriodEnd: periodEnd,
      paymentFailedAt: null,
    });
    return "subscription_create_acknowledged";
  }

  // Monthly reset (spec §7, no rollover): expire whatever is left, then
  // grant the cycle's credits — as two ledger entries keyed on the event id.
  const plan = workspace.pendingPlan ?? workspace.plan;
  await ctx.store.expireRemainder(workspace.id, `monthly_reset:${ctx.event.id}`, "monthly_reset");
  await ctx.store.recordCredits({
    workspaceId: workspace.id,
    delta: TIERS[plan].monthlyCredits,
    reason: "plan_grant",
    idempotencyKey: `plan_grant:${ctx.event.id}`,
  });
  await ctx.store.updateBilling(workspace.id, {
    plan,
    pendingPlan: null,
    paymentFailedAt: null,
    overageUsed: 0,
    billingCycleAnchor: periodStart,
    billingPeriodEnd: periodEnd,
  });
  return `cycle_reset_${plan}`;
}

async function onSubscriptionUpdated(ctx: HandlerCtx): Promise<string> {
  const subscription = subscriptionSchema.parse(ctx.event.data.object);
  const workspace = await findWorkspace(ctx, {
    customer: subscription.customer,
    subscription: subscription.id,
  });
  if (workspace === null) return "ignored_unknown_subscription";

  const itemPeriodEnds = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((e): e is number => typeof e === "number");
  const periodEnd =
    epochToDate(itemPeriodEnds.length > 0 ? Math.max(...itemPeriodEnds) : null) ??
    epochToDate(subscription.current_period_end) ??
    workspace.billingPeriodEnd;

  let newPlan: Plan | null = null;
  for (const item of subscription.items?.data ?? []) {
    const mapped = ctx.priceToPlan({
      id: item.price?.id ?? null,
      lookupKey: item.price?.lookup_key ?? null,
    });
    if (mapped !== null) {
      newPlan = mapped;
      break;
    }
  }

  if (newPlan === null || newPlan === workspace.plan) {
    // No plan change (or an unrecognized price, e.g. only the metered
    // overage item present) — track the period, clear any stale pending.
    await ctx.store.updateBilling(workspace.id, {
      stripeSubscriptionId: subscription.id,
      billingPeriodEnd: periodEnd,
      ...(newPlan === workspace.plan ? { pendingPlan: null } : {}),
    });
    return "period_tracked";
  }

  // Up/downgrade takes effect at the period boundary (spec §7): stage it as
  // pendingPlan; the next invoice.paid applies it with that plan's grant.
  await ctx.store.updateBilling(workspace.id, {
    stripeSubscriptionId: subscription.id,
    pendingPlan: newPlan,
    billingPeriodEnd: periodEnd,
  });
  return `pending_${newPlan}`;
}

async function onPaymentFailed(ctx: HandlerCtx): Promise<string> {
  const invoice = invoiceSchema.parse(ctx.event.data.object);
  const workspace = await findWorkspace(ctx, {
    customer: invoice.customer,
    subscription: invoice.subscription,
  });
  if (workspace === null) return "ignored_unknown_customer";
  if (workspace.paymentFailedAt !== null) return "grace_already_running";
  // First failure of this incident starts the 7-day grace clock; after it
  // expires isWorkspaceReadOnly() flips the workspace read-only. Recovery
  // (invoice.paid) clears the clock.
  await ctx.store.updateBilling(workspace.id, { paymentFailedAt: ctx.now });
  return "grace_started";
}

async function onSubscriptionDeleted(ctx: HandlerCtx): Promise<string> {
  const subscription = subscriptionSchema.parse(ctx.event.data.object);
  const workspace = await findWorkspace(ctx, {
    customer: subscription.customer,
    subscription: subscription.id,
  });
  if (workspace === null) return "ignored_unknown_subscription";
  // Paid credits do not survive cancellation (no rollover anywhere).
  await ctx.store.expireRemainder(workspace.id, `monthly_reset:${ctx.event.id}`, "monthly_reset");
  await ctx.store.updateBilling(workspace.id, {
    plan: "free",
    stripeSubscriptionId: null,
    pendingPlan: null,
    paymentFailedAt: null,
    overageUsed: 0,
    billingPeriodEnd: null,
  });
  return "downgraded_to_free";
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function handleStripeEvent(
  event: StripeWebhookEvent,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const ctx: HandlerCtx = {
    event,
    store: deps.store,
    now: deps.now?.() ?? new Date(),
    log: deps.logger ?? defaultLogger,
    priceToPlan: deps.priceToPlan ?? envPriceToPlan,
  };

  const firstDelivery = await deps.store.recordEventOnce(event.id, event.type);
  if (!firstDelivery) {
    return { received: true, duplicate: true, handled: false, action: "duplicate" };
  }

  let action: string;
  switch (event.type) {
    case "checkout.session.completed":
      action = await onCheckoutCompleted(ctx);
      break;
    case "invoice.paid":
      action = await onInvoicePaid(ctx);
      break;
    case "customer.subscription.updated":
      action = await onSubscriptionUpdated(ctx);
      break;
    case "invoice.payment_failed":
      action = await onPaymentFailed(ctx);
      break;
    case "customer.subscription.deleted":
      action = await onSubscriptionDeleted(ctx);
      break;
    default:
      action = "ignored_event_type";
  }

  ctx.log.info({ eventId: event.id, type: event.type, action }, "stripe webhook processed");
  return {
    received: true,
    duplicate: false,
    handled: !action.startsWith("ignored"),
    action,
  };
}
