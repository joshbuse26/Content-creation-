import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { asScriptId } from "@/lib/types/ids";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { getBillingStore, resetBillingStoreForTests } from "@/server/billing/store";
import { scriptImpl } from "@/server/routers/impl/script";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx, makeDeps } from "./a2-helpers";

/**
 * Wave-C adversarial F4 (engineering half): script.regenerateSection is a
 * generation-class dispatch (live LLM) and must respect the read-only
 * payment lockdown like every other dispatch site. Its metering stays a
 * product decision (OPEN-ITEMS) — no charge is added here.
 */

let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
  deps = makeDeps();
  setEngineDepsForTests(deps);
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
  setEngineDepsForTests(undefined);
});

async function firstSection() {
  const sections = await deps.store.listSections(
    fixtureCtx.workspaceId,
    asScriptId(FIXTURE_IDS.script),
  );
  const section = sections[0];
  if (section === undefined) throw new Error("fixture script has no sections");
  return section;
}

const regenerate = (sectionId: string) =>
  scriptImpl.regenerateSection({
    ctx: fixtureCtx,
    input: scriptContracts.regenerateSection.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      sectionId,
    }),
  });

describe("regenerateSection read-only lockdown (F4)", () => {
  it("a locked workspace (grace expired) gets PRECONDITION_FAILED and the section is untouched", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await getBillingStore().updateBilling(fixtureCtx.workspaceId, {
      paymentFailedAt: eightDaysAgo,
    });
    const before = await firstSection();

    const err = await regenerate(before.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((err as TRPCError).message).toMatch(/read-only/);

    const after = await firstSection();
    expect(after.body).toBe(before.body);
  });

  it("within the grace window (and when healthy) it still dispatches", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await getBillingStore().updateBilling(fixtureCtx.workspaceId, {
      paymentFailedAt: threeDaysAgo,
    });
    const before = await firstSection();
    const result = await regenerate(before.id);
    expect(result.status).toBe("queued");
    // Fixture mode ran inline and rewrote the section deterministically.
    const after = await firstSection();
    expect(after.body).not.toBe(before.body);
  });
});
