import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { getDb, hasDb, schema } from "@/db";
import { logger as defaultLogger } from "@/lib/logger";

/**
 * Credit-ledger reconciliation — spec §3: workspaces.credit_balance is a
 * materialized sum of the append-only credit_ledger, reconciled nightly.
 *
 * The job recomputes SUM(delta) per workspace and compares it to the stored
 * balance. Drift is LOGGED (error level — it means a code path updated the
 * balance without a ledger entry, or vice versa) and reported; it is only
 * corrected when `fix: true` is passed explicitly, because silently patching
 * balances would hide the bug that caused the drift.
 *
 * Scheduling: run nightly from the worker as a BullMQ repeatable job
 * (schedules live in code, spec §2.8) — see REQUESTS-A4.md for the wiring.
 */

export interface WorkspaceBalance {
  id: string;
  creditBalance: number;
}

export interface ReconciliationDeps {
  listWorkspaces(): Promise<WorkspaceBalance[]>;
  /** SUM(delta) over the workspace's ledger rows (0 for no rows). */
  sumLedger(workspaceId: string): Promise<number>;
  /** Overwrite the stored balance (only invoked with fix: true). */
  setBalance?(workspaceId: string, balance: number): Promise<void>;
  logger?: Logger;
}

export interface DriftEntry {
  workspaceId: string;
  storedBalance: number;
  ledgerBalance: number;
  /** stored - ledger. */
  drift: number;
  fixed: boolean;
}

export interface ReconciliationReport {
  checkedWorkspaces: number;
  drifted: DriftEntry[];
  ok: boolean;
}

export async function reconcileCreditLedger(
  deps: ReconciliationDeps,
  options: { fix?: boolean } = {},
): Promise<ReconciliationReport> {
  const log = deps.logger ?? defaultLogger;
  const fix = options.fix ?? false;
  const workspaces = await deps.listWorkspaces();
  const drifted: DriftEntry[] = [];

  for (const workspace of workspaces) {
    const ledgerBalance = await deps.sumLedger(workspace.id);
    const drift = workspace.creditBalance - ledgerBalance;
    if (drift === 0) continue;

    let fixed = false;
    if (fix && deps.setBalance !== undefined) {
      await deps.setBalance(workspace.id, ledgerBalance);
      fixed = true;
    }
    const entry: DriftEntry = {
      workspaceId: workspace.id,
      storedBalance: workspace.creditBalance,
      ledgerBalance,
      drift,
      fixed,
    };
    drifted.push(entry);
    log.error(entry, "credit ledger drift detected");
  }

  log.info(
    { checkedWorkspaces: workspaces.length, driftedCount: drifted.length },
    "credit ledger reconciliation complete",
  );
  return { checkedWorkspaces: workspaces.length, drifted, ok: drifted.length === 0 };
}

/** Drizzle-backed deps for the production job. */
export function drizzleReconciliationDeps(): ReconciliationDeps {
  return {
    async listWorkspaces() {
      const db = getDb();
      return db
        .select({ id: schema.workspaces.id, creditBalance: schema.workspaces.creditBalance })
        .from(schema.workspaces);
    },
    async sumLedger(workspaceId) {
      const db = getDb();
      const rows = await db
        .select({
          total: sql<number>`coalesce(sum(${schema.creditLedger.delta}), 0)::int`,
        })
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.workspaceId, workspaceId));
      return rows[0]?.total ?? 0;
    },
    async setBalance(workspaceId, balance) {
      const db = getDb();
      await db
        .update(schema.workspaces)
        .set({ creditBalance: balance })
        .where(eq(schema.workspaces.id, workspaceId));
    },
  };
}

/** Entry point for the nightly job. No-ops (with a warning) without a DB. */
export async function runCreditReconciliation(
  options: { fix?: boolean } = {},
): Promise<ReconciliationReport> {
  if (!hasDb()) {
    defaultLogger.warn("credit reconciliation skipped — DATABASE_URL not set");
    return { checkedWorkspaces: 0, drifted: [], ok: true };
  }
  return reconcileCreditLedger(drizzleReconciliationDeps(), options);
}
