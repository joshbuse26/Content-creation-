import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { handleStripeEvent, type StripeWebhookEvent } from "@/server/billing/events";
import { getBillingStore } from "@/server/billing/store";
import { getStripeClient } from "@/server/billing/stripe";

/**
 * POST /api/stripe/webhook — Stripe event intake (spec §7).
 *
 * Point the Stripe webhook endpoint here with events:
 *   checkout.session.completed, invoice.paid, invoice.payment_failed,
 *   customer.subscription.updated, customer.subscription.deleted
 *
 * Signature verification (STRIPE_WEBHOOK_SECRET) rejects everything
 * unsigned; idempotency is enforced in handleStripeEvent via the
 * stripe_events table, so Stripe's at-least-once delivery is safe. Errors
 * return 500 so Stripe retries with backoff.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const config = getConfig();
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  const stripe = await getStripeClient();
  if (webhookSecret === undefined || stripe === null) {
    logger.error("stripe webhook received but STRIPE_WEBHOOK_SECRET/STRIPE_SECRET_KEY unset");
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (signature === null) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await req.text();
  let event: StripeWebhookEvent;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (err) {
    // Generic error out, details to logs only (spec §6).
    logger.warn({ err }, "stripe webhook signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, { store: getBillingStore() });
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "stripe webhook handler failed");
    return NextResponse.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
