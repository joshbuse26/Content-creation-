import { TRPCError } from "@trpc/server";
import { getConfig } from "@/lib/config";
import type { WorkspaceId } from "@/lib/types/ids";
import type { BillingStore } from "@/server/billing/store";
import { TIERS, type PaidPlan } from "@/server/billing/tiers";

/**
 * Checkout + customer-portal sessions (billing.checkout / billing.portal —
 * frozen contract shapes). Pure param-building + a small StripeGateway port
 * so tests assert the exact session parameters per tier without the SDK.
 */

export interface CheckoutSessionParams {
  mode: "subscription";
  customer: string;
  client_reference_id: string;
  line_items: { price: string; quantity?: number }[];
  metadata: { workspaceId: string; plan: PaidPlan };
  subscription_data: { metadata: { workspaceId: string; plan: PaidPlan } };
  allow_promotion_codes: boolean;
  success_url: string;
  cancel_url: string;
}

export interface StripeGateway {
  /** Resolve a STRIPE_PRICE_* env value (price id or lookup key) to a price id. */
  resolvePrice(envValue: string): Promise<string>;
  createCustomer(input: { name: string; workspaceId: string }): Promise<{ id: string }>;
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string | null }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
}

/** Env var naming the metered overage price ($0.60/credit); optional. */
export const OVERAGE_PRICE_ENV = "STRIPE_PRICE_OVERAGE";

export function priceEnvValue(envVar: string): string | null {
  const value = process.env[envVar]?.trim();
  return value === undefined || value === "" ? null : value;
}

export function billingReturnUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/settings/billing`;
}

/**
 * Build the checkout session params for a tier (pure — unit-tested per
 * tier). The subscription carries the licensed plan price plus, when
 * configured, the metered overage price (no quantity — usage-billed).
 */
export function buildCheckoutParams(input: {
  workspaceId: WorkspaceId;
  plan: PaidPlan;
  customerId: string;
  appUrl: string;
  planPriceId: string;
  overagePriceId: string | null;
}): CheckoutSessionParams {
  const returnUrl = billingReturnUrl(input.appUrl);
  const metadata = { workspaceId: input.workspaceId, plan: input.plan };
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.workspaceId,
    line_items: [
      { price: input.planPriceId, quantity: 1 },
      ...(input.overagePriceId === null ? [] : [{ price: input.overagePriceId }]),
    ],
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
  };
}

function stripeNotConfigured(): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Billing is not configured on this deployment yet — contact support.",
  });
}

async function ensureCustomerId(
  gateway: StripeGateway,
  store: BillingStore,
  workspace: { id: WorkspaceId; stripeCustomerId: string | null },
  name: string,
): Promise<string> {
  if (workspace.stripeCustomerId !== null) return workspace.stripeCustomerId;
  const customer = await gateway.createCustomer({ name, workspaceId: workspace.id });
  await store.updateBilling(workspace.id, { stripeCustomerId: customer.id });
  return customer.id;
}

export async function createCheckoutSession(
  deps: { gateway: StripeGateway | null; store: BillingStore },
  input: { workspaceId: WorkspaceId; plan: PaidPlan; workspaceName?: string },
): Promise<{ checkoutUrl: string }> {
  if (deps.gateway === null) stripeNotConfigured();
  const workspace = await deps.store.getWorkspace(input.workspaceId);
  if (workspace === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "workspace not found" });
  }
  const tier = TIERS[input.plan];
  const priceEnv = tier.priceEnvVar === null ? null : priceEnvValue(tier.priceEnvVar);
  if (tier.priceEnvVar === null || priceEnv === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `The ${tier.label} plan is not purchasable yet (${tier.priceEnvVar ?? "no price"} unset).`,
    });
  }
  const planPriceId = await deps.gateway.resolvePrice(priceEnv);
  const overageEnv = priceEnvValue(OVERAGE_PRICE_ENV);
  const overagePriceId = overageEnv === null ? null : await deps.gateway.resolvePrice(overageEnv);
  const customerId = await ensureCustomerId(
    deps.gateway,
    deps.store,
    workspace,
    input.workspaceName ?? `Workspace ${input.workspaceId}`,
  );
  const params = buildCheckoutParams({
    workspaceId: input.workspaceId,
    plan: input.plan,
    customerId,
    appUrl: getConfig().APP_URL,
    planPriceId,
    overagePriceId,
  });
  const session = await deps.gateway.createCheckoutSession(params);
  if (session.url === null) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stripe did not return a checkout URL",
    });
  }
  return { checkoutUrl: session.url };
}

export async function createPortalSession(
  deps: { gateway: StripeGateway | null; store: BillingStore },
  input: { workspaceId: WorkspaceId },
): Promise<{ portalUrl: string }> {
  if (deps.gateway === null) stripeNotConfigured();
  const workspace = await deps.store.getWorkspace(input.workspaceId);
  if (workspace === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "workspace not found" });
  }
  if (workspace.stripeCustomerId === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No billing account yet — subscribe to a plan first.",
    });
  }
  const session = await deps.gateway.createPortalSession(
    workspace.stripeCustomerId,
    billingReturnUrl(getConfig().APP_URL),
  );
  return { portalUrl: session.url };
}
