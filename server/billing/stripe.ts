import type Stripe from "stripe";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { OverageMeter } from "@/server/billing/overage";
import type { CheckoutSessionParams, StripeGateway } from "@/server/billing/checkout";

/**
 * Live Stripe adapters — the ONLY module that touches the Stripe SDK. The
 * client is lazily imported (same pattern as the live providers) so fixture
 * mode and tests never evaluate it; everything above talks to the
 * StripeGateway / OverageMeter ports.
 */

let cachedClient: Stripe | null = null;

/** Lazily constructed Stripe client, or null when STRIPE_SECRET_KEY is unset. */
export async function getStripeClient(): Promise<Stripe | null> {
  const key = getConfig().STRIPE_SECRET_KEY;
  if (key === undefined) return null;
  if (cachedClient === null) {
    const { default: StripeSdk } = await import("stripe");
    cachedClient = new StripeSdk(key);
  }
  return cachedClient;
}

export function resetStripeClientForTests(): void {
  cachedClient = null;
}

/**
 * Resolve a STRIPE_PRICE_* env value to a concrete price id: `price_…`
 * values are used as-is; anything else is treated as a price lookup key.
 */
export async function resolvePriceId(stripe: Stripe, envValue: string): Promise<string> {
  if (envValue.startsWith("price_")) return envValue;
  const prices = await stripe.prices.list({ lookup_keys: [envValue], active: true, limit: 1 });
  const price = prices.data[0];
  if (price === undefined) {
    throw new Error(`No active Stripe price found for lookup key "${envValue}"`);
  }
  return price.id;
}

/** Production StripeGateway over the real SDK. */
export function liveStripeGateway(stripe: Stripe): StripeGateway {
  return {
    resolvePrice: (envValue) => resolvePriceId(stripe, envValue),
    async createCustomer(input) {
      const customer = await stripe.customers.create({
        name: input.name,
        metadata: { workspaceId: input.workspaceId },
      });
      return { id: customer.id };
    },
    async createCheckoutSession(params: CheckoutSessionParams) {
      const session = await stripe.checkout.sessions.create(params);
      return { url: session.url };
    },
    async createPortalSession(customerId, returnUrl) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
  };
}

// ---------------------------------------------------------------------------
// Overage metering (spec §7: $0.60/credit, metered)
// ---------------------------------------------------------------------------

/**
 * Billing Meter event name configured in Stripe for overage credits.
 * (stripe-node v22 removed the legacy subscription-item usage-records API;
 * metered usage is reported as Billing Meter events tied to the customer.)
 */
export const OVERAGE_METER_EVENT = "overage_credits";

/** Reports overage usage as a Stripe Billing Meter event (idempotent via `identifier`). */
export function liveOverageMeter(stripe: Stripe): OverageMeter {
  return {
    async record(customerId, credits, idempotencyKey) {
      await stripe.billing.meterEvents.create({
        event_name: OVERAGE_METER_EVENT,
        identifier: idempotencyKey,
        payload: { stripe_customer_id: customerId, value: String(credits) },
      });
    },
  };
}

/** No-op meter for fixture mode (no STRIPE_SECRET_KEY): logs instead of billing. */
export const noopOverageMeter: OverageMeter = {
  record(customerId, credits, idempotencyKey) {
    logger.info({ customerId, credits, idempotencyKey }, "overage metering skipped (no Stripe)");
    return Promise.resolve();
  },
};

/** Default meter: live when Stripe is configured, logging no-op otherwise. */
export async function getDefaultOverageMeter(): Promise<OverageMeter> {
  const stripe = await getStripeClient();
  return stripe === null ? noopOverageMeter : liveOverageMeter(stripe);
}
