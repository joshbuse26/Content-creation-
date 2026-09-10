import { describe, expect, it } from "vitest";
import pino from "pino";
import {
  reconcileCreditLedger,
  type ReconciliationDeps,
  type WorkspaceBalance,
} from "@/server/ops/reconcile-credits";

interface FakeLedger {
  workspaces: WorkspaceBalance[];
  ledgers: Record<string, number[]>;
  setCalls: { workspaceId: string; balance: number }[];
}

function makeDeps(fake: FakeLedger, capture?: string[]): ReconciliationDeps {
  const logger = pino(
    { level: "info", base: {} },
    { write: (line: string) => capture?.push(line) },
  );
  return {
    listWorkspaces: () => Promise.resolve(fake.workspaces),
    sumLedger: (workspaceId) =>
      Promise.resolve((fake.ledgers[workspaceId] ?? []).reduce((a, b) => a + b, 0)),
    setBalance: (workspaceId, balance) => {
      fake.setCalls.push({ workspaceId, balance });
      return Promise.resolve();
    },
    logger,
  };
}

describe("credit ledger reconciliation", () => {
  it("reports clean when every balance matches its ledger sum", async () => {
    const fake: FakeLedger = {
      workspaces: [
        { id: "ws-1", creditBalance: 54 },
        { id: "ws-2", creditBalance: 0 },
      ],
      ledgers: { "ws-1": [60, -6], "ws-2": [] },
      setCalls: [],
    };
    const report = await reconcileCreditLedger(makeDeps(fake));
    expect(report).toEqual({ checkedWorkspaces: 2, drifted: [], ok: true });
    expect(fake.setCalls).toEqual([]);
  });

  it("detects injected drift and logs it at error level", async () => {
    const lines: string[] = [];
    const fake: FakeLedger = {
      workspaces: [
        { id: "ws-ok", creditBalance: 10 },
        { id: "ws-drift", creditBalance: 99 }, // ledger says 54
      ],
      ledgers: { "ws-ok": [10], "ws-drift": [60, -6] },
      setCalls: [],
    };
    const report = await reconcileCreditLedger(makeDeps(fake, lines));
    expect(report.ok).toBe(false);
    expect(report.checkedWorkspaces).toBe(2);
    expect(report.drifted).toEqual([
      {
        workspaceId: "ws-drift",
        storedBalance: 99,
        ledgerBalance: 54,
        drift: 45,
        fixed: false,
      },
    ]);
    const errorLine = lines.find((l) => l.includes("credit ledger drift detected"));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('"level":50'); // pino error level
    expect(errorLine).toContain('"workspaceId":"ws-drift"');
  });

  it("detects negative drift (balance lower than ledger)", async () => {
    const fake: FakeLedger = {
      workspaces: [{ id: "ws-under", creditBalance: 40 }],
      ledgers: { "ws-under": [60, -6] },
      setCalls: [],
    };
    const report = await reconcileCreditLedger(makeDeps(fake));
    expect(report.drifted[0]?.drift).toBe(-14);
  });

  it("only writes balances when fix: true is passed explicitly", async () => {
    const fake: FakeLedger = {
      workspaces: [{ id: "ws-drift", creditBalance: 99 }],
      ledgers: { "ws-drift": [54] },
      setCalls: [],
    };
    await reconcileCreditLedger(makeDeps(fake));
    expect(fake.setCalls).toEqual([]);

    const report = await reconcileCreditLedger(makeDeps(fake), { fix: true });
    expect(fake.setCalls).toEqual([{ workspaceId: "ws-drift", balance: 54 }]);
    expect(report.drifted[0]?.fixed).toBe(true);
  });
});
