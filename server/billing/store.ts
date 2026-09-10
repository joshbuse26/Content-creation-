import { and, eq, sql } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import type { CreditReason, Plan } from "@/lib/types/enums";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { workspaceIdSchema } from "@/lib/types/ids";
import { getSharedWorkspaceStore } from "@/server/workspace/memory";

/**
 * Billing persistence port — the webhook handlers and the overage wrapper
 * talk to this interface, never to Drizzle directly, so every billing rule
 * is testable without Postgres (same pattern as the PipelineRunner store).
 *
 * Two implementations:
 *   - DrizzleBillingStore — production (Postgres).
 *   - InMemoryBillingStore — fixture mode + tests; shares plan/balance with
 *     the InMemoryWorkspaceStore so `billing.summary` and `requireCredits`
 *     see the same numbers the webhook handlers produce.
 */

export interface BillingWorkspace {
  id: WorkspaceId;
  plan: Plan;
  creditBalance: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingCycleAnchor: Date | null;
  billingPeriodEnd: Date | null;
  pendingPlan: Plan | null;
  paymentFailedAt: Date | null;
  overageUsed: number;
}

export interface BillingPatch {
  plan?: Plan;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  billingCycleAnchor?: Date | null;
  billingPeriodEnd?: Date | null;
  pendingPlan?: Plan | null;
  paymentFailedAt?: Date | null;
  overageUsed?: number;
}

export interface CreditWrite {
  workspaceId: WorkspaceId;
  delta: number;
  reason: CreditReason;
  /** Required — every billing-path ledger write must be idempotent. */
  idempotencyKey: string;
  actorUserId?: UserId | null;
}

export interface BillingStore {
  getWorkspace(id: WorkspaceId): Promise<BillingWorkspace | null>;
  findByCustomerId(customerId: string): Promise<BillingWorkspace | null>;
  findBySubscriptionId(subscriptionId: string): Promise<BillingWorkspace | null>;
  /** Record a Stripe event id; false ⇒ already processed (skip side effects). */
  recordEventOnce(eventId: string, type: string): Promise<boolean>;
  /** Idempotent ledger entry + balance adjustment; false ⇒ key already written. */
  recordCredits(write: CreditWrite): Promise<boolean>;
  /**
   * Atomic overage grant (adversarial F3): ONE unit of work covering the
   * idempotent ledger entry, the balance top-up and the conditional
   * `overage_used` increment (`overage_used + delta <= ceiling`, evaluated
   * on the CURRENT row, never a stale read). Outcomes:
   *  - "granted"   — everything committed; the caller may meter to Stripe.
   *  - "duplicate" — the idempotency key was already written (retry of the
   *                  same dispatch); nothing changed, nothing to meter.
   *  - "ceiling"   — the increment would exceed the ceiling; nothing
   *                  changed (the ledger write rolls back with it).
   */
  grantOverage(write: CreditWrite, ceiling: number): Promise<"granted" | "duplicate" | "ceiling">;
  /**
   * Monthly expiry (no rollover): write a ledger entry zeroing the current
   * balance. Idempotent on the key; returns the number of credits expired
   * (0 when the balance was already 0 or the key was seen before).
   */
  expireRemainder(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
    reason: CreditReason,
  ): Promise<number>;
  updateBilling(id: WorkspaceId, patch: BillingPatch): Promise<void>;
}

// ---------------------------------------------------------------------------
// Drizzle (production)
// ---------------------------------------------------------------------------

/** Internal sentinel: aborts the grantOverage transaction on a full cycle. */
class OverageCeilingReached extends Error {
  constructor() {
    super("overage ceiling reached");
  }
}

type WorkspaceRow = typeof schema.workspaces.$inferSelect;

function fromRow(row: WorkspaceRow): BillingWorkspace {
  return {
    id: workspaceIdSchema.parse(row.id),
    plan: row.plan,
    creditBalance: row.creditBalance,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    billingCycleAnchor: row.billingCycleAnchor,
    billingPeriodEnd: row.billingPeriodEnd,
    pendingPlan: row.pendingPlan,
    paymentFailedAt: row.paymentFailedAt,
    overageUsed: row.overageUsed ?? 0,
  };
}

export class DrizzleBillingStore implements BillingStore {
  async getWorkspace(id: WorkspaceId): Promise<BillingWorkspace | null> {
    const rows = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async findByCustomerId(customerId: string): Promise<BillingWorkspace | null> {
    const rows = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.stripeCustomerId, customerId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async findBySubscriptionId(subscriptionId: string): Promise<BillingWorkspace | null> {
    const rows = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.stripeSubscriptionId, subscriptionId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async recordEventOnce(eventId: string, type: string): Promise<boolean> {
    const inserted = await getDb()
      .insert(schema.stripeEvents)
      .values({ eventId, type })
      .onConflictDoNothing({ target: schema.stripeEvents.eventId })
      .returning({ id: schema.stripeEvents.id });
    return inserted.length > 0;
  }

  async recordCredits(write: CreditWrite): Promise<boolean> {
    return await getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.creditLedger)
        .values({
          workspaceId: write.workspaceId,
          delta: write.delta,
          reason: write.reason,
          actorUserId: write.actorUserId ?? null,
          idempotencyKey: write.idempotencyKey,
        })
        .onConflictDoNothing({
          target: schema.creditLedger.idempotencyKey,
          where: sql`${schema.creditLedger.idempotencyKey} IS NOT NULL`,
        })
        .returning({ id: schema.creditLedger.id });
      if (inserted.length === 0) return false;
      await tx
        .update(schema.workspaces)
        .set({ creditBalance: sql`${schema.workspaces.creditBalance} + ${write.delta}` })
        .where(eq(schema.workspaces.id, write.workspaceId));
      return true;
    });
  }

  async grantOverage(
    write: CreditWrite,
    ceiling: number,
  ): Promise<"granted" | "duplicate" | "ceiling"> {
    try {
      return await getDb().transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.creditLedger)
          .values({
            workspaceId: write.workspaceId,
            delta: write.delta,
            reason: write.reason,
            actorUserId: write.actorUserId ?? null,
            idempotencyKey: write.idempotencyKey,
          })
          .onConflictDoNothing({
            target: schema.creditLedger.idempotencyKey,
            where: sql`${schema.creditLedger.idempotencyKey} IS NOT NULL`,
          })
          .returning({ id: schema.creditLedger.id });
        if (inserted.length === 0) return "duplicate";
        // Conditional increment on the live row (row lock serializes
        // concurrent grants); 0 rows ⇒ the ceiling would be exceeded.
        const updated = await tx
          .update(schema.workspaces)
          .set({
            creditBalance: sql`${schema.workspaces.creditBalance} + ${write.delta}`,
            overageUsed: sql`coalesce(${schema.workspaces.overageUsed}, 0) + ${write.delta}`,
          })
          .where(
            and(
              eq(schema.workspaces.id, write.workspaceId),
              sql`coalesce(${schema.workspaces.overageUsed}, 0) + ${write.delta} <= ${ceiling}`,
            ),
          )
          .returning({ id: schema.workspaces.id });
        if (updated.length === 0) throw new OverageCeilingReached();
        return "granted";
      });
    } catch (err) {
      // The throw rolled the ledger insert back with the transaction.
      if (err instanceof OverageCeilingReached) return "ceiling";
      throw err;
    }
  }

  async expireRemainder(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
    reason: CreditReason,
  ): Promise<number> {
    return await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ creditBalance: schema.workspaces.creditBalance })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .limit(1)
        .for("update");
      const balance = rows[0]?.creditBalance ?? 0;
      if (balance <= 0) return 0;
      const inserted = await tx
        .insert(schema.creditLedger)
        .values({ workspaceId, delta: -balance, reason, idempotencyKey })
        .onConflictDoNothing({
          target: schema.creditLedger.idempotencyKey,
          where: sql`${schema.creditLedger.idempotencyKey} IS NOT NULL`,
        })
        .returning({ id: schema.creditLedger.id });
      if (inserted.length === 0) return 0;
      await tx
        .update(schema.workspaces)
        .set({ creditBalance: 0 })
        .where(eq(schema.workspaces.id, workspaceId));
      return balance;
    });
  }

  async updateBilling(id: WorkspaceId, patch: BillingPatch): Promise<void> {
    await getDb().update(schema.workspaces).set(patch).where(eq(schema.workspaces.id, id));
  }
}

// ---------------------------------------------------------------------------
// In-memory (fixture mode + tests)
// ---------------------------------------------------------------------------

interface MemoryBillingExtras {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingPeriodEnd: Date | null;
  pendingPlan: Plan | null;
  paymentFailedAt: Date | null;
  overageUsed: number;
}

export interface MemoryLedgerEntry extends CreditWrite {
  createdAt: Date;
}

const emptyExtras = (): MemoryBillingExtras => ({
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  billingPeriodEnd: null,
  pendingPlan: null,
  paymentFailedAt: null,
  overageUsed: 0,
});

export class InMemoryBillingStore implements BillingStore {
  readonly processedEventIds = new Map<string, string>();
  readonly ledger: MemoryLedgerEntry[] = [];
  private readonly extras = new Map<string, MemoryBillingExtras>();

  private extrasFor(id: WorkspaceId): MemoryBillingExtras {
    let extras = this.extras.get(id);
    if (extras === undefined) {
      extras = emptyExtras();
      this.extras.set(id, extras);
    }
    return extras;
  }

  private toBilling(id: WorkspaceId): BillingWorkspace | null {
    const workspace = getSharedWorkspaceStore().get(id);
    if (workspace === null) return null;
    const extras = this.extrasFor(id);
    return {
      id: workspace.id,
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
      billingCycleAnchor: workspace.billingCycleAnchor,
      ...extras,
    };
  }

  getWorkspace(id: WorkspaceId): Promise<BillingWorkspace | null> {
    return Promise.resolve(this.toBilling(id));
  }

  findByCustomerId(customerId: string): Promise<BillingWorkspace | null> {
    for (const [id, extras] of this.extras) {
      if (extras.stripeCustomerId === customerId) {
        return Promise.resolve(this.toBilling(workspaceIdSchema.parse(id)));
      }
    }
    return Promise.resolve(null);
  }

  findBySubscriptionId(subscriptionId: string): Promise<BillingWorkspace | null> {
    for (const [id, extras] of this.extras) {
      if (extras.stripeSubscriptionId === subscriptionId) {
        return Promise.resolve(this.toBilling(workspaceIdSchema.parse(id)));
      }
    }
    return Promise.resolve(null);
  }

  recordEventOnce(eventId: string, type: string): Promise<boolean> {
    if (this.processedEventIds.has(eventId)) return Promise.resolve(false);
    this.processedEventIds.set(eventId, type);
    return Promise.resolve(true);
  }

  recordCredits(write: CreditWrite): Promise<boolean> {
    if (this.ledger.some((e) => e.idempotencyKey === write.idempotencyKey)) {
      return Promise.resolve(false);
    }
    const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === write.workspaceId);
    if (workspace === undefined) return Promise.resolve(false);
    this.ledger.push({ ...write, createdAt: new Date() });
    workspace.creditBalance += write.delta;
    return Promise.resolve(true);
  }

  grantOverage(write: CreditWrite, ceiling: number): Promise<"granted" | "duplicate" | "ceiling"> {
    // Fully synchronous (no await between check and write) — atomic under
    // concurrent async callers, mirroring the single-UPDATE Drizzle path.
    if (this.ledger.some((e) => e.idempotencyKey === write.idempotencyKey)) {
      return Promise.resolve("duplicate");
    }
    const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === write.workspaceId);
    if (workspace === undefined) throw new Error("workspace not found for overage grant");
    const extras = this.extrasFor(write.workspaceId);
    if (extras.overageUsed + write.delta > ceiling) return Promise.resolve("ceiling");
    this.ledger.push({ ...write, createdAt: new Date() });
    workspace.creditBalance += write.delta;
    extras.overageUsed += write.delta;
    return Promise.resolve("granted");
  }

  async expireRemainder(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
    reason: CreditReason,
  ): Promise<number> {
    const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === workspaceId);
    if (workspace === undefined || workspace.creditBalance <= 0) return 0;
    const expired = workspace.creditBalance;
    const written = await this.recordCredits({
      workspaceId,
      delta: -expired,
      reason,
      idempotencyKey,
    });
    return written ? expired : 0;
  }

  updateBilling(id: WorkspaceId, patch: BillingPatch): Promise<void> {
    const workspace = getSharedWorkspaceStore().workspaces.find((w) => w.id === id);
    const extras = this.extrasFor(id);
    if (workspace !== undefined && patch.plan !== undefined) workspace.plan = patch.plan;
    if (workspace !== undefined && patch.billingCycleAnchor !== undefined) {
      workspace.billingCycleAnchor = patch.billingCycleAnchor;
    }
    if (patch.stripeCustomerId !== undefined) extras.stripeCustomerId = patch.stripeCustomerId;
    if (patch.stripeSubscriptionId !== undefined) {
      extras.stripeSubscriptionId = patch.stripeSubscriptionId;
    }
    if (patch.billingPeriodEnd !== undefined) extras.billingPeriodEnd = patch.billingPeriodEnd;
    if (patch.pendingPlan !== undefined) extras.pendingPlan = patch.pendingPlan;
    if (patch.paymentFailedAt !== undefined) extras.paymentFailedAt = patch.paymentFailedAt;
    if (patch.overageUsed !== undefined) extras.overageUsed = patch.overageUsed;
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let sharedMemoryStore: InMemoryBillingStore | undefined;

export function getBillingStore(): BillingStore {
  if (hasDb()) return new DrizzleBillingStore();
  sharedMemoryStore ??= new InMemoryBillingStore();
  return sharedMemoryStore;
}

export function resetBillingStoreForTests(): void {
  sharedMemoryStore = undefined;
}
