import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { isCreditExempt as isCreditExemptPure, parseAdminEmails } from "@/lib/credits-exempt";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { resetConfigForTests } from "@/lib/config";
import { isCreditExempt, requireCredits } from "@/server/credits";
import { requireCreditsWithOverage } from "@/server/billing/overage";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { settleCharge } from "@/pipelines/script/settle-charge";
import { fixtureCtx, makeDeps } from "./a2-helpers";

describe("parseAdminEmails", () => {
  it("splits, trims, lowercases, and de-duplicates", () => {
    expect(parseAdminEmails("A@X.com, b@y.com, a@x.com")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails("  , , ")).toEqual([]);
  });
});

describe("isCreditExempt (pure)", () => {
  const admins = ["joshbuse@hexbandit.io"];

  it("matches ADMIN_EMAILS case-insensitively", () => {
    expect(isCreditExemptPure("JoshBuse@HexBandit.io", "writer", admins)).toBe(true);
    expect(isCreditExemptPure("other@example.com", "writer", admins)).toBe(false);
  });

  it("treats workspace owner and admin as exempt even when the email is not listed", () => {
    expect(isCreditExemptPure("other@example.com", "owner", admins)).toBe(true);
    expect(isCreditExemptPure("other@example.com", "admin", admins)).toBe(true);
  });

  it("does not exempt writers or viewers who are not listed", () => {
    expect(isCreditExemptPure("other@example.com", "writer", admins)).toBe(false);
    expect(isCreditExemptPure("other@example.com", "viewer", admins)).toBe(false);
    expect(isCreditExemptPure(null, "writer", admins)).toBe(false);
    expect(isCreditExemptPure(undefined, undefined, admins)).toBe(false);
  });
});

describe("requireCredits / requireCreditsWithOverage exemption", () => {
  beforeEach(() => {
    resetSharedWorkspaceStoreForTests();
    resetConfigForTests();
    process.env.ADMIN_EMAILS = "joshbuse@hexbandit.io";
    resetConfigForTests();
  });
  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
    resetConfigForTests();
    resetSharedWorkspaceStoreForTests();
  });

  function setBalance(balance: number): void {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === FIXTURE_IDS.workspace,
    );
    if (workspace === undefined) throw new Error("fixture workspace missing");
    workspace.creditBalance = balance;
  }

  it("ADMIN_EMAILS match skips the balance check at 0 credits", async () => {
    setBalance(0);
    expect(isCreditExempt("joshbuse@hexbandit.io", "writer")).toBe(true);
    await expect(
      requireCredits(fixtureCtx.workspaceId, 6, {
        userEmail: "joshbuse@hexbandit.io",
        workspaceRole: "writer",
      }),
    ).resolves.toBeUndefined();
    await expect(
      requireCreditsWithOverage(fixtureCtx.workspaceId, 6, {
        userEmail: "JOSHBUSE@hexbandit.io",
        workspaceRole: "writer",
      }),
    ).resolves.toBeUndefined();
  });

  it("owner/admin role skips the balance check at 0 credits", async () => {
    setBalance(0);
    await expect(
      requireCredits(fixtureCtx.workspaceId, 1, {
        userEmail: "writer@example.com",
        workspaceRole: "owner",
      }),
    ).resolves.toBeUndefined();
    await expect(
      requireCreditsWithOverage(fixtureCtx.workspaceId, 1, {
        userEmail: "writer@example.com",
        workspaceRole: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  it("non-exempt writers are still gated at 0 credits", async () => {
    setBalance(0);
    await expect(
      requireCredits(fixtureCtx.workspaceId, 1, {
        userEmail: "writer@example.com",
        workspaceRole: "writer",
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
    await expect(
      requireCreditsWithOverage(fixtureCtx.workspaceId, 1, {
        userEmail: "writer@example.com",
        workspaceRole: "viewer",
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("omitting exemption info keeps the historical gate (P0 metering intact)", async () => {
    setBalance(0);
    await expect(requireCredits(fixtureCtx.workspaceId, 1)).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
    await expect(requireCreditsWithOverage(fixtureCtx.workspaceId, 1)).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });
});

describe("skipDebit on the ledger", () => {
  it("settleCharge with skipDebit does not write a ledger entry", async () => {
    const deps = makeDeps();
    await settleCharge(deps.store, {
      workspaceId: fixtureCtx.workspaceId,
      delta: -6,
      reason: "script_generation",
      actorUserId: null,
      projectId: null,
      idempotencyKey: "exempt-test",
      skipDebit: true,
    });
    expect(deps.store.creditEntries).toHaveLength(0);
  });

  it("settleCharge without skipDebit still writes (non-exempt path)", async () => {
    const deps = makeDeps();
    await settleCharge(deps.store, {
      workspaceId: fixtureCtx.workspaceId,
      delta: -6,
      reason: "script_generation",
      actorUserId: null,
      projectId: null,
      idempotencyKey: "normal-test",
    });
    expect(deps.store.creditEntries).toHaveLength(1);
    expect(deps.store.creditEntries[0]?.delta).toBe(-6);
  });
});
