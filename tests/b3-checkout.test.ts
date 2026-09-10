import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { fixtureWorkspace } from "@/lib/fixtures";
import {
  buildCheckoutParams,
  createCheckoutSession,
  createPortalSession,
  type CheckoutSessionParams,
  type StripeGateway,
} from "@/server/billing/checkout";
import { InMemoryBillingStore } from "@/server/billing/store";
import { PAID_PLANS, TIERS } from "@/server/billing/tiers";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";

/**
 * Checkout/portal session behavior against a fake StripeGateway — asserts
 * the exact Checkout params per tier (mode, price, metadata, URLs) without
 * the Stripe SDK or network.
 */

const WORKSPACE_ID = fixtureWorkspace.id;

function fakeGateway(): StripeGateway & {
  sessions: CheckoutSessionParams[];
  portals: { customerId: string; returnUrl: string }[];
} {
  const sessions: CheckoutSessionParams[] = [];
  const portals: { customerId: string; returnUrl: string }[] = [];
  return {
    sessions,
    portals,
    resolvePrice: (envValue) =>
      Promise.resolve(envValue.startsWith("price_") ? envValue : `price_resolved_${envValue}`),
    createCustomer: (input) => Promise.resolve({ id: `cus_for_${input.workspaceId}` }),
    createCheckoutSession(params) {
      sessions.push(params);
      return Promise.resolve({ url: "https://checkout.stripe.com/c/pay/test_session" });
    },
    createPortalSession(customerId, returnUrl) {
      portals.push({ customerId, returnUrl });
      return Promise.resolve({ url: "https://billing.stripe.com/p/session/test" });
    },
  };
}

let store: InMemoryBillingStore;

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  store = new InMemoryBillingStore();
  vi.stubEnv("STRIPE_PRICE_STARTER", "starter_monthly");
  vi.stubEnv("STRIPE_PRICE_TEAM", "price_team_direct");
  vi.stubEnv("STRIPE_PRICE_AGENCY", "agency_monthly");
  vi.stubEnv("STRIPE_PRICE_OVERAGE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSharedWorkspaceStoreForTests();
});

describe("buildCheckoutParams", () => {
  it.each(PAID_PLANS)("builds a subscription-mode session for %s", (plan) => {
    const params = buildCheckoutParams({
      workspaceId: WORKSPACE_ID,
      plan,
      customerId: "cus_123",
      appUrl: "https://app.example.com",
      planPriceId: `price_${plan}`,
      overagePriceId: null,
    });
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_123");
    expect(params.client_reference_id).toBe(WORKSPACE_ID);
    expect(params.line_items).toEqual([{ price: `price_${plan}`, quantity: 1 }]);
    expect(params.metadata).toEqual({ workspaceId: WORKSPACE_ID, plan });
    expect(params.subscription_data.metadata).toEqual({ workspaceId: WORKSPACE_ID, plan });
    expect(params.success_url).toBe("https://app.example.com/settings/billing?checkout=success");
    expect(params.cancel_url).toBe("https://app.example.com/settings/billing?checkout=cancelled");
  });

  it("attaches the metered overage price without a quantity", () => {
    const params = buildCheckoutParams({
      workspaceId: WORKSPACE_ID,
      plan: "team",
      customerId: "cus_123",
      appUrl: "https://app.example.com",
      planPriceId: "price_team",
      overagePriceId: "price_overage",
    });
    expect(params.line_items).toEqual([
      { price: "price_team", quantity: 1 },
      { price: "price_overage" },
    ]);
  });
});

describe("createCheckoutSession", () => {
  it("resolves lookup keys, creates + persists the customer, returns the URL", async () => {
    const gateway = fakeGateway();
    const result = await createCheckoutSession(
      { gateway, store },
      { workspaceId: WORKSPACE_ID, plan: "starter", workspaceName: "Deep Dive Media" },
    );
    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/test_session");
    const session = gateway.sessions[0];
    expect(session?.line_items).toEqual([{ price: "price_resolved_starter_monthly", quantity: 1 }]);
    // The created customer is persisted so the webhook can find the workspace.
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.stripeCustomerId).toBe(`cus_for_${WORKSPACE_ID}`);
    expect(session?.customer).toBe(`cus_for_${WORKSPACE_ID}`);
  });

  it("uses a price_ env value directly and reuses an existing customer", async () => {
    await store.updateBilling(WORKSPACE_ID, { stripeCustomerId: "cus_existing" });
    const gateway = fakeGateway();
    const resolveSpy = vi.spyOn(gateway, "resolvePrice");
    await createCheckoutSession({ gateway, store }, { workspaceId: WORKSPACE_ID, plan: "team" });
    expect(resolveSpy).toHaveBeenCalledWith("price_team_direct");
    expect(gateway.sessions[0]?.customer).toBe("cus_existing");
  });

  it("includes the overage metered price when STRIPE_PRICE_OVERAGE is set", async () => {
    vi.stubEnv("STRIPE_PRICE_OVERAGE", "overage_credits_price");
    const gateway = fakeGateway();
    await createCheckoutSession({ gateway, store }, { workspaceId: WORKSPACE_ID, plan: "agency" });
    expect(gateway.sessions[0]?.line_items).toEqual([
      { price: "price_resolved_agency_monthly", quantity: 1 },
      { price: "price_resolved_overage_credits_price" },
    ]);
  });

  it("fails with PRECONDITION_FAILED when the tier's price env is unset", async () => {
    vi.stubEnv("STRIPE_PRICE_AGENCY", "");
    const gateway = fakeGateway();
    await expect(
      createCheckoutSession({ gateway, store }, { workspaceId: WORKSPACE_ID, plan: "agency" }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("fails with PRECONDITION_FAILED when Stripe is not configured at all", async () => {
    await expect(
      createCheckoutSession(
        { gateway: null, store },
        { workspaceId: WORKSPACE_ID, plan: "starter" },
      ),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("tier env vars cover every paid plan", () => {
    for (const plan of PAID_PLANS) {
      expect(TIERS[plan].priceEnvVar).toBe(`STRIPE_PRICE_${plan.toUpperCase()}`);
    }
  });
});

describe("createPortalSession", () => {
  it("opens the portal for the workspace's customer with the billing return URL", async () => {
    await store.updateBilling(WORKSPACE_ID, { stripeCustomerId: "cus_portal" });
    const gateway = fakeGateway();
    const result = await createPortalSession({ gateway, store }, { workspaceId: WORKSPACE_ID });
    expect(result.portalUrl).toBe("https://billing.stripe.com/p/session/test");
    expect(gateway.portals[0]?.customerId).toBe("cus_portal");
    expect(gateway.portals[0]?.returnUrl).toMatch(/\/settings\/billing$/);
  });

  it("refuses when the workspace has no Stripe customer yet", async () => {
    const gateway = fakeGateway();
    await expect(
      createPortalSession({ gateway, store }, { workspaceId: WORKSPACE_ID }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });
});
