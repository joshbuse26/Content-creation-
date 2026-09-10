import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { resetConfigForTests } from "@/lib/config";
import { fixtureWorkspace } from "@/lib/fixtures";
import { getBillingStore, resetBillingStoreForTests } from "@/server/billing/store";
import { resetStripeClientForTests } from "@/server/billing/stripe";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";

/**
 * Webhook route: REAL signature verification (Stripe's constructEvent is
 * pure HMAC — no network), using generateTestHeaderString to sign payloads
 * with the test secret. Unsigned/miss-signed requests are rejected before
 * any handler runs; a valid signature flows through to the billing store.
 */

const WEBHOOK_SECRET = "whsec_b3_test_secret";
const signer = new Stripe("sk_test_b3_signing_only");

function signedRequest(payload: string, secret = WEBHOOK_SECRET): Request {
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

function eventPayload(id: string, type: string, object: Record<string, unknown>): string {
  return JSON.stringify({
    id,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
  });
}

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_b3_route";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  resetConfigForTests();
  resetStripeClientForTests();
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
});

afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  resetConfigForTests();
  resetStripeClientForTests();
});

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
});

describe("signature verification", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: eventPayload("evt_unsigned", "invoice.paid", {}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const payload = eventPayload("evt_wrong_secret", "invoice.paid", {});
    const res = await POST(signedRequest(payload, "whsec_attacker"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid signature" });
  });

  it("rejects a payload tampered with after signing", async () => {
    const payload = eventPayload("evt_tampered", "invoice.paid", {});
    const signature = signer.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    const tampered = payload.replace("invoice.paid", "invoice.void");
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: tampered,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a correctly signed event", async () => {
    const res = await POST(signedRequest(eventPayload("evt_signed_ok", "charge.refunded", {})));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
  });
});

describe("end-to-end through the route", () => {
  it("a signed payment failure starts the grace period on the right workspace", async () => {
    const store = getBillingStore();
    await store.updateBilling(fixtureWorkspace.id, { stripeCustomerId: "cus_route_e2e" });

    const res = await POST(
      signedRequest(
        eventPayload("evt_route_fail", "invoice.payment_failed", { customer: "cus_route_e2e" }),
      ),
    );
    expect(res.status).toBe(200);
    const workspace = await store.getWorkspace(fixtureWorkspace.id);
    expect(workspace?.paymentFailedAt).not.toBeNull();
  });

  it("replaying the same signed event is acknowledged as a duplicate", async () => {
    const payload = eventPayload("evt_route_dup", "charge.refunded", {});
    const first = await POST(signedRequest(payload));
    expect(await first.json()).toEqual({ received: true, duplicate: false });
    const second = await POST(signedRequest(payload));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
  });
});
