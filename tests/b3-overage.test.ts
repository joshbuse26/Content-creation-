import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { fixtureWorkspace } from "@/lib/fixtures";
import type { Plan } from "@/lib/types/enums";
import { requireCreditsWithOverage, type OverageMeter } from "@/server/billing/overage";
import { InMemoryBillingStore } from "@/server/billing/store";
import { OVERAGE_CEILING_CREDITS } from "@/server/billing/tiers";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";

/**
 * Overage-aware credit gate (the requireCredits replacement): allow-and-
 * meter for paid plans, ceiling cap, free-plan refusal, read-only lockdown,
 * and idempotent grant+meter on retried dispatches. No Stripe SDK — the
 * meter is a recording fake.
 */

const WORKSPACE_ID = fixtureWorkspace.id;
const CUSTOMER = "cus_overage_test";

let store: InMemoryBillingStore;
let metered: { customerId: string; credits: number; idempotencyKey: string }[];

const meter: OverageMeter = {
  record(customerId, credits, idempotencyKey) {
    metered.push({ customerId, credits, idempotencyKey });
    return Promise.resolve();
  },
};

function setWorkspace(plan: Plan, balanceValue: number): void {
  const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === WORKSPACE_ID);
  if (workspace === undefined) throw new Error("fixture workspace missing");
  workspace.plan = plan;
  workspace.creditBalance = balanceValue;
}

function balance(): number {
  const workspace = getSharedWorkspaceStore().get(WORKSPACE_ID);
  if (workspace === null) throw new Error("fixture workspace missing");
  return workspace.creditBalance;
}

const gate = (cost: number, extra: Parameters<typeof requireCreditsWithOverage>[2] = {}) =>
  requireCreditsWithOverage(WORKSPACE_ID, cost, { store, meter, ...extra });

const isPrecondition = (err: unknown) =>
  err instanceof TRPCError && err.code === "PRECONDITION_FAILED";

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  store = new InMemoryBillingStore();
  metered = [];
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
});

describe("pass-through when the balance covers the cost", () => {
  it("allows without metering or ledger writes", async () => {
    setWorkspace("starter", 10);
    await expect(gate(6)).resolves.toBeUndefined();
    expect(metered).toHaveLength(0);
    expect(store.ledger).toHaveLength(0);
    expect(balance()).toBe(10);
  });
});

describe("allow-and-meter (spec §7 overage)", () => {
  beforeEach(async () => {
    await store.updateBilling(WORKSPACE_ID, { stripeCustomerId: CUSTOMER });
  });

  it("meters exactly the shortfall and grants it via the ledger", async () => {
    setWorkspace("starter", 2); // script costs 6 → shortfall 4
    await expect(gate(6)).resolves.toBeUndefined();

    expect(metered).toHaveLength(1);
    expect(metered[0]).toMatchObject({ customerId: CUSTOMER, credits: 4 });
    expect(metered[0]?.idempotencyKey).toMatch(/^overage:/);

    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0]).toMatchObject({ delta: 4, reason: "overage" });
    expect(balance()).toBe(6); // topped up so the completion charge lands at 0

    const workspace = await store.getWorkspace(WORKSPACE_ID);
    expect(workspace?.overageUsed).toBe(4);
  });

  it("a zero balance meters the full cost", async () => {
    setWorkspace("team", 0);
    await gate(6);
    expect(metered[0]?.credits).toBe(6);
    expect(balance()).toBe(6);
  });

  it("is idempotent per dispatch key: retry grants and meters once", async () => {
    setWorkspace("starter", 0);
    await gate(6, { idempotencyKey: "run_abc" });
    // Retry of the same dispatch (same key): balance already topped up, so
    // the gate passes on the balance check without a second grant.
    await gate(6, { idempotencyKey: "run_abc" });
    expect(store.ledger).toHaveLength(1);
    expect(metered).toHaveLength(1);
    expect(balance()).toBe(6);
  });

  it("caps the cycle at OVERAGE_CEILING_CREDITS", async () => {
    setWorkspace("starter", 0);
    await store.updateBilling(WORKSPACE_ID, { overageUsed: OVERAGE_CEILING_CREDITS - 2 });
    await expect(gate(6)).rejects.toSatisfy(isPrecondition);
    await expect(gate(6)).rejects.toThrow(/Overage cap reached/);
    expect(metered).toHaveLength(0);
    expect(store.ledger).toHaveLength(0);

    // Exactly at the ceiling is still allowed.
    await store.updateBilling(WORKSPACE_ID, { overageUsed: OVERAGE_CEILING_CREDITS - 6 });
    await expect(gate(6)).resolves.toBeUndefined();
    expect((await store.getWorkspace(WORKSPACE_ID))?.overageUsed).toBe(OVERAGE_CEILING_CREDITS);
  });

  it("keeps generating when the meter itself fails (logged, bounded by the cap)", async () => {
    setWorkspace("starter", 0);
    const failingMeter: OverageMeter = {
      record: () => Promise.reject(new Error("stripe down")),
    };
    await expect(gate(6, { meter: failingMeter })).resolves.toBeUndefined();
    expect(balance()).toBe(6);
  });
});

describe("refusals", () => {
  it("free plans never overage", async () => {
    setWorkspace("free", 1);
    await store.updateBilling(WORKSPACE_ID, { stripeCustomerId: CUSTOMER });
    await expect(gate(6)).rejects.toSatisfy(isPrecondition);
    await expect(gate(6)).rejects.toThrow(/Not enough credits/);
    expect(metered).toHaveLength(0);
  });

  it("paid plan without a Stripe customer falls back to the plain refusal", async () => {
    setWorkspace("starter", 1);
    await expect(gate(6)).rejects.toThrow(/Not enough credits/);
  });

  it("read-only workspaces (grace expired) cannot dispatch at all — even with credits", async () => {
    setWorkspace("starter", 50);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await store.updateBilling(WORKSPACE_ID, {
      stripeCustomerId: CUSTOMER,
      paymentFailedAt: eightDaysAgo,
    });
    await expect(gate(6)).rejects.toSatisfy(isPrecondition);
    await expect(gate(6)).rejects.toThrow(/read-only/);
  });

  it("within the grace window generation still works", async () => {
    setWorkspace("starter", 50);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await store.updateBilling(WORKSPACE_ID, {
      stripeCustomerId: CUSTOMER,
      paymentFailedAt: threeDaysAgo,
    });
    await expect(gate(6)).resolves.toBeUndefined();
  });

  it("unknown workspace → NOT_FOUND, matching requireCredits", async () => {
    resetSharedWorkspaceStoreForTests();
    getSharedWorkspaceStore().workspaces.length = 0;
    await expect(gate(6)).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
  });
});
