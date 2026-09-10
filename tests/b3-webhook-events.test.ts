import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureWorkspace } from "@/lib/fixtures";
import type { Plan } from "@/lib/types/enums";
import { handleStripeEvent, type StripeWebhookEvent } from "@/server/billing/events";
import { InMemoryBillingStore } from "@/server/billing/store";
import { TIERS } from "@/server/billing/tiers";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";

/**
 * Webhook domain logic over the in-memory store — no Stripe SDK, no
 * Postgres. Covers: event idempotency, checkout activation, monthly reset
 * math (expire-and-grant, no rollover), pending up/downgrade at the period
 * boundary, failed-payment grace, and cancellation → free.
 */

const WORKSPACE_ID = fixtureWorkspace.id;
const CUSTOMER = "cus_b3_test";
const SUBSCRIPTION = "sub_b3_test";
const NOW = new Date("2026-09-10T12:00:00.000Z");

let store: InMemoryBillingStore;

function deps(overrides: Partial<Parameters<typeof handleStripeEvent>[1]> = {}) {
  return {
    store,
    now: () => NOW,
    priceToPlan: (price: { id?: string | null; lookupKey?: string | null }): Plan | null => {
      if (price.lookupKey === "starter_monthly" || price.id === "price_starter") return "starter";
      if (price.lookupKey === "team_monthly" || price.id === "price_team") return "team";
      if (price.lookupKey === "agency_monthly" || price.id === "price_agency") return "agency";
      return null;
    },
    ...overrides,
  };
}

function balance(): number {
  const workspace = getSharedWorkspaceStore().get(WORKSPACE_ID);
  if (workspace === null) throw new Error("fixture workspace missing");
  return workspace.creditBalance;
}

function setBalance(value: number): void {
  const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === WORKSPACE_ID);
  if (workspace === undefined) throw new Error("fixture workspace missing");
  workspace.creditBalance = value;
}

function checkoutEvent(id: string, plan: string): StripeWebhookEvent {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        customer: CUSTOMER,
        subscription: SUBSCRIPTION,
        client_reference_id: WORKSPACE_ID,
        metadata: { workspaceId: WORKSPACE_ID, plan },
      },
    },
  };
}

function invoicePaidEvent(id: string, billingReason = "subscription_cycle"): StripeWebhookEvent {
  const periodStart = Math.floor(NOW.getTime() / 1000);
  const periodEnd = periodStart + 30 * 24 * 3600;
  return {
    id,
    type: "invoice.paid",
    data: {
      object: {
        customer: CUSTOMER,
        billing_reason: billingReason,
        lines: {
          data: [{ subscription: SUBSCRIPTION, period: { start: periodStart, end: periodEnd } }],
        },
      },
    },
  };
}

async function linkCustomer(): Promise<void> {
  await store.updateBilling(WORKSPACE_ID, {
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: SUBSCRIPTION,
  });
}

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  store = new InMemoryBillingStore();
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
});

describe("event idempotency", () => {
  it("processes an event id exactly once — same event twice yields one ledger entry", async () => {
    await linkCustomer();
    const event = invoicePaidEvent("evt_dup");

    const first = await handleStripeEvent(event, deps());
    expect(first.duplicate).toBe(false);
    expect(first.handled).toBe(true);
    const grantEntries = store.ledger.filter((e) => e.idempotencyKey === "plan_grant:evt_dup");
    expect(grantEntries).toHaveLength(1);
    const balanceAfterFirst = balance();

    const second = await handleStripeEvent(event, deps());
    expect(second.duplicate).toBe(true);
    expect(second.handled).toBe(false);
    expect(store.ledger.filter((e) => e.idempotencyKey === "plan_grant:evt_dup")).toHaveLength(1);
    expect(balance()).toBe(balanceAfterFirst);
  });

  it("ledger keys guard independently even if the event record is lost", async () => {
    await linkCustomer();
    await handleStripeEvent(invoicePaidEvent("evt_ledger_guard"), deps());
    const before = balance();
    // Simulate a lost stripe_events row: clear it, replay the same event.
    store.processedEventIds.clear();
    const replay = await handleStripeEvent(invoicePaidEvent("evt_ledger_guard"), deps());
    expect(replay.duplicate).toBe(false); // event record was lost…
    expect(balance()).toBe(before); // …but the ledger keys still dedupe
  });
});

describe("checkout.session.completed", () => {
  it("sets the plan, links Stripe ids, and grants the cycle credits once", async () => {
    setBalance(2); // leftover free credits
    const result = await handleStripeEvent(checkoutEvent("evt_checkout", "team"), deps());
    expect(result.handled).toBe(true);
    expect(result.action).toBe("activated_team");

    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace).toMatchObject({
      plan: "team",
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: SUBSCRIPTION,
      pendingPlan: null,
      paymentFailedAt: null,
      overageUsed: 0,
    });
    expect(workspace?.billingCycleAnchor).toEqual(NOW);
    expect(balance()).toBe(2 + TIERS.team.monthlyCredits);
  });

  it("ignores a session with missing metadata", async () => {
    const result = await handleStripeEvent(
      {
        id: "evt_bad_meta",
        type: "checkout.session.completed",
        data: { object: { customer: CUSTOMER, metadata: {} } },
      },
      deps(),
    );
    expect(result.handled).toBe(false);
    expect(store.ledger).toHaveLength(0);
  });
});

describe("invoice.paid — monthly reset (no rollover)", () => {
  it("expires the remainder and grants the plan's credits: 54 leftover → exactly 60", async () => {
    await linkCustomer();
    expect(fixtureWorkspace.plan).toBe("starter");
    setBalance(54);

    const result = await handleStripeEvent(invoicePaidEvent("evt_cycle"), deps());
    expect(result.action).toBe("cycle_reset_starter");
    expect(balance()).toBe(TIERS.starter.monthlyCredits); // 60, NOT 114

    const expire = store.ledger.find((e) => e.idempotencyKey === "monthly_reset:evt_cycle");
    expect(expire).toMatchObject({ delta: -54, reason: "monthly_reset" });
    const grant = store.ledger.find((e) => e.idempotencyKey === "plan_grant:evt_cycle");
    expect(grant).toMatchObject({ delta: 60, reason: "plan_grant" });
  });

  it("a zero balance resets to the full grant with no expiry entry", async () => {
    await linkCustomer();
    setBalance(0);
    await handleStripeEvent(invoicePaidEvent("evt_zero"), deps());
    expect(balance()).toBe(60);
    expect(store.ledger.find((e) => e.idempotencyKey === "monthly_reset:evt_zero")).toBeUndefined();
  });

  it("applies a pending downgrade at the boundary with the NEW plan's grant", async () => {
    await linkCustomer();
    // Fixture plan is starter; simulate an agency→starter style pending change.
    await store.updateBilling(WORKSPACE_ID, { plan: "team", pendingPlan: "starter" });
    setBalance(120);

    await handleStripeEvent(invoicePaidEvent("evt_downgrade"), deps());
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.plan).toBe("starter");
    expect(workspace?.pendingPlan).toBeNull();
    expect(balance()).toBe(TIERS.starter.monthlyCredits);
  });

  it("clears the failed-payment grace and resets overage on recovery", async () => {
    await linkCustomer();
    await store.updateBilling(WORKSPACE_ID, { paymentFailedAt: NOW, overageUsed: 37 });
    await handleStripeEvent(invoicePaidEvent("evt_recovered"), deps());
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.paymentFailedAt).toBeNull();
    expect(workspace?.overageUsed).toBe(0);
    expect(workspace?.billingPeriodEnd).not.toBeNull();
  });

  it("does not double-grant on the subscription's very first invoice", async () => {
    await linkCustomer();
    setBalance(60); // checkout.session.completed already granted
    await handleStripeEvent(invoicePaidEvent("evt_first", "subscription_create"), deps());
    expect(balance()).toBe(60);
    expect(store.ledger).toHaveLength(0);
  });
});

describe("customer.subscription.updated — plan changes at the period boundary", () => {
  function subscriptionEvent(id: string, lookupKey: string): StripeWebhookEvent {
    return {
      id,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: SUBSCRIPTION,
          customer: CUSTOMER,
          status: "active",
          items: {
            data: [
              {
                current_period_end: Math.floor(NOW.getTime() / 1000) + 20 * 24 * 3600,
                price: { id: "price_x", lookup_key: lookupKey },
              },
            ],
          },
        },
      },
    };
  }

  it("stages a different price as pendingPlan without touching credits", async () => {
    await linkCustomer();
    setBalance(54);
    const result = await handleStripeEvent(subscriptionEvent("evt_sub_up", "team_monthly"), deps());
    expect(result.action).toBe("pending_team");
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.plan).toBe("starter"); // unchanged until the boundary
    expect(workspace?.pendingPlan).toBe("team");
    expect(workspace?.billingPeriodEnd).not.toBeNull();
    expect(balance()).toBe(54);

    // …and the next cycle's invoice applies it with the team grant.
    await handleStripeEvent(invoicePaidEvent("evt_sub_up_cycle"), deps());
    const after = await store.getWorkspace(WORKSPACE_ID);
    expect(after?.plan).toBe("team");
    expect(balance()).toBe(TIERS.team.monthlyCredits);
  });

  it("a same-plan update clears any stale pendingPlan", async () => {
    await linkCustomer();
    await store.updateBilling(WORKSPACE_ID, { pendingPlan: "agency" });
    await handleStripeEvent(subscriptionEvent("evt_sub_same", "starter_monthly"), deps());
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.pendingPlan).toBeNull();
  });
});

describe("invoice.payment_failed → grace", () => {
  const failedEvent = (id: string): StripeWebhookEvent => ({
    id,
    type: "invoice.payment_failed",
    data: { object: { customer: CUSTOMER, subscription: SUBSCRIPTION } },
  });

  it("starts the grace clock on the first failure only", async () => {
    await linkCustomer();
    const result = await handleStripeEvent(failedEvent("evt_fail_1"), deps());
    expect(result.action).toBe("grace_started");
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.paymentFailedAt).toEqual(NOW);

    // A retry failing later must NOT restart the 7-day clock.
    const later = new Date(NOW.getTime() + 3 * 24 * 3600 * 1000);
    const second = await handleStripeEvent(failedEvent("evt_fail_2"), {
      ...deps(),
      now: () => later,
    });
    expect(second.action).toBe("grace_already_running");
    expect((await store.getWorkspace(WORKSPACE_ID))?.paymentFailedAt).toEqual(NOW);
  });
});

describe("customer.subscription.deleted → free", () => {
  it("downgrades to free and expires remaining paid credits", async () => {
    await linkCustomer();
    await store.updateBilling(WORKSPACE_ID, { paymentFailedAt: NOW, overageUsed: 12 });
    setBalance(41);
    const result = await handleStripeEvent(
      {
        id: "evt_deleted",
        type: "customer.subscription.deleted",
        data: { object: { id: SUBSCRIPTION, customer: CUSTOMER, status: "canceled" } },
      },
      deps(),
    );
    expect(result.action).toBe("downgraded_to_free");
    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace).toMatchObject({
      plan: "free",
      stripeSubscriptionId: null,
      pendingPlan: null,
      paymentFailedAt: null,
      overageUsed: 0,
      billingPeriodEnd: null,
    });
    expect(balance()).toBe(0);
    expect(
      store.ledger.find((e) => e.idempotencyKey === "monthly_reset:evt_deleted"),
    ).toMatchObject({ delta: -41 });
  });
});

describe("unknown events and workspaces", () => {
  it("acknowledges unhandled event types without side effects", async () => {
    const result = await handleStripeEvent(
      { id: "evt_other", type: "charge.refunded", data: { object: {} } },
      deps(),
    );
    expect(result).toMatchObject({ received: true, handled: false, action: "ignored_event_type" });
  });

  it("acknowledges events for unknown customers without throwing", async () => {
    const result = await handleStripeEvent(invoicePaidEvent("evt_nobody"), deps());
    expect(result.handled).toBe(false);
    expect(store.ledger).toHaveLength(0);
  });
});
