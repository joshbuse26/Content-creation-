import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { asScriptId, voiceProfileIdSchema, type ScriptSectionId } from "@/lib/types/ids";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { getBillingStore, resetBillingStoreForTests } from "@/server/billing/store";
import { scriptImpl } from "@/server/routers/impl/script";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx, makeDeps } from "./a2-helpers";

/**
 * E4 — surgical section edit. The editor's highlight→steer→patch flow drives
 * the EXISTING regenerateSection with an optional selectionText scoping the
 * rewrite. This locks in: the steer + selection change the output; metering is
 * unchanged (no charge — matching the existing path exactly); the section lock
 * is still respected; and a per-section voice override survives the surgical
 * regenerate (multi-voice through the surgical surface).
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

async function hookSection() {
  const sections = await deps.store.listSections(
    fixtureCtx.workspaceId,
    asScriptId(FIXTURE_IDS.script),
  );
  const section = sections.find((s) => s.kind === "hook") ?? sections[0];
  if (section === undefined) throw new Error("fixture script has no sections");
  return section;
}

function regen(sectionId: ScriptSectionId, extra: Record<string, unknown>) {
  return scriptImpl.regenerateSection({
    ctx: fixtureCtx,
    input: scriptContracts.regenerateSection.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      sectionId,
      ...extra,
    }),
  });
}

describe("surgical regenerate — selection + steer drive the rewrite", () => {
  it("a selection-scoped steer produces a different body than a bare regenerate", async () => {
    const before = await hookSection();

    await regen(before.id, {});
    const bareBody = (await hookSection()).body;

    // Re-seed to the original body, then regenerate the SAME section with a
    // surgical selection + steer note.
    await deps.store.updateSection(fixtureCtx.workspaceId, before.id, { body: before.body });
    await regen(before.id, {
      guidance: "lead with the price reveal",
      selectionText: before.body.slice(0, 24),
    });
    const steeredBody = (await hookSection()).body;

    expect(steeredBody).not.toBe(before.body);
    // The selection + steer change the deterministic fixture output, so the
    // surgical rewrite differs from the bare whole-section regenerate.
    expect(steeredBody).not.toBe(bareBody);
  });

  it("does not charge credits (metering unchanged from the existing path)", async () => {
    const section = await hookSection();
    const ws = fixtureCtx.workspaceId;
    const before = (await getBillingStore().getWorkspace(ws))?.creditBalance ?? null;
    await regen(section.id, { guidance: "punch it up", selectionText: section.body.slice(0, 20) });
    const after = (await getBillingStore().getWorkspace(ws))?.creditBalance ?? null;
    expect(after).toBe(before);
  });
});

describe("surgical regenerate — lock + multi-voice", () => {
  it("a locked section cannot be surgically regenerated", async () => {
    const section = await hookSection();
    await scriptImpl.setSectionLock({
      ctx: fixtureCtx,
      input: scriptContracts.setSectionLock.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        sectionId: section.id,
        locked: true,
      }),
    });
    const before = section.body;
    const err = await regen(section.id, {
      guidance: "rewrite",
      selectionText: section.body.slice(0, 15),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect((await hookSection()).body).toBe(before);
  });

  it("a per-section voice override survives a surgical regenerate", async () => {
    const section = await hookSection();
    await scriptImpl.setSectionVoice({
      ctx: fixtureCtx,
      input: scriptContracts.setSectionVoice.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        sectionId: section.id,
        voiceProfileId: FIXTURE_IDS.voiceProfile,
      }),
    });
    await regen(section.id, {
      guidance: "in-voice rewrite",
      selectionText: section.body.slice(0, 18),
    });
    const after = await hookSection();
    expect(after.voiceProfileId).toBe(voiceProfileIdSchema.parse(FIXTURE_IDS.voiceProfile));
    expect(after.body).not.toBe(section.body);
  });
});
