import { afterEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { fixtureProject } from "@/lib/fixtures";
import type { DiffOp } from "@/lib/types/entities";
import { DiffApplyError, rebaseDiffOps } from "@/pipelines/revision/apply";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { revisionImpl } from "@/server/routers/impl/revision";
import { makeDeps, fixtureCtx } from "./a2-helpers";

/**
 * Regression tests for server-side rebasing in revision.accept: prior
 * accepted suggestions shift subsequent ops by their line delta; ops that
 * overlap an accepted range are rejected; and accepting on a locked
 * section returns PRECONDITION_FAILED.
 */

describe("rebaseDiffOps", () => {
  const op = (lineStart: number, lineEnd: number, replacement: string): DiffOp => ({
    lineStart,
    lineEnd,
    replacement,
  });

  it("shifts ops after an accepted range by its net line delta", () => {
    // Accepted: lines 2-2 replaced by 3 lines (+2).
    const accepted = [[op(2, 2, "a\nb\nc")]];
    const rebased = rebaseDiffOps([op(5, 6, "x")], accepted);
    expect(rebased).toEqual([op(7, 8, "x")]);
  });

  it("accumulates deltas across multiple accepted revisions", () => {
    // +2 at lines 1-1, -1 at lines 4-5 (2 lines -> 1 line).
    const accepted = [[op(1, 1, "a\nb\nc")], [op(4, 5, "only")]];
    const rebased = rebaseDiffOps([op(8, 8, "x")], accepted);
    expect(rebased).toEqual([op(9, 9, "x")]);
  });

  it("leaves ops before any accepted range untouched", () => {
    const accepted = [[op(10, 12, "one\ntwo")]];
    expect(rebaseDiffOps([op(2, 3, "x")], accepted)).toEqual([op(2, 3, "x")]);
  });

  it("rejects ops overlapping an accepted range (no longer match)", () => {
    const accepted = [[op(4, 6, "rewritten")]];
    expect(() => rebaseDiffOps([op(5, 5, "x")], accepted)).toThrow(DiffApplyError);
    expect(() => rebaseDiffOps([op(2, 4, "x")], accepted)).toThrow(DiffApplyError);
  });
});

describe("revision.accept with prior accepted suggestions", () => {
  afterEach(() => {
    setEngineDepsForTests(undefined);
  });

  async function setup() {
    const deps = makeDeps();
    setEngineDepsForTests(deps);
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    const [section] = await deps.store.replaceSections(fixtureCtx.workspaceId, script.id, [
      {
        position: 0,
        kind: "hook",
        heading: "Hook",
        body: "line1\nline2\nline3\nline4\nline5",
        estSeconds: 30,
        retentionNote: null,
        factRefs: [],
      },
    ]);
    if (section === undefined) throw new Error("no section");
    const [first, second] = await deps.store.insertRevisions([
      {
        workspaceId: fixtureCtx.workspaceId,
        scriptId: script.id,
        sectionId: section.id,
        suggestion: "expand line2",
        diff: [{ lineStart: 2, lineEnd: 2, replacement: "line2a\nline2b\nline2c" }],
        rationale: "detail",
      },
      {
        workspaceId: fixtureCtx.workspaceId,
        scriptId: script.id,
        sectionId: section.id,
        suggestion: "tighten line4",
        diff: [{ lineStart: 4, lineEnd: 4, replacement: "LINE4" }],
        rationale: "punch",
      },
    ]);
    if (first === undefined || second === undefined) throw new Error("no revisions");
    return { deps, script, section, first, second };
  }

  it("rebases the second accept over the first (accepts applied in order shift ops)", async () => {
    const { deps, section, first, second } = await setup();

    await revisionImpl.accept({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: first.id },
    });
    const afterFirst = await deps.store.getSection(fixtureCtx.workspaceId, section.id);
    expect(afterFirst?.body).toBe("line1\nline2a\nline2b\nline2c\nline3\nline4\nline5");

    // Without rebasing, the second accept would replace what is now line4
    // ("line2c"). With rebasing it replaces the original line4.
    const { section: afterSecond } = await revisionImpl.accept({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: second.id },
    });
    expect(afterSecond.body).toBe("line1\nline2a\nline2b\nline2c\nline3\nLINE4\nline5");
  });

  it("rejects a suggestion whose range was consumed by an accepted one", async () => {
    const { deps, script, section, first } = await setup();
    const [overlapping] = await deps.store.insertRevisions([
      {
        workspaceId: fixtureCtx.workspaceId,
        scriptId: script.id,
        sectionId: section.id,
        suggestion: "also touch line2",
        diff: [{ lineStart: 2, lineEnd: 2, replacement: "conflict" }],
        rationale: "conflicts",
      },
    ]);
    if (overlapping === undefined) throw new Error("no revision");

    await revisionImpl.accept({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: first.id },
    });
    await expect(
      revisionImpl.accept({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, revisionId: overlapping.id },
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === "BAD_REQUEST" &&
        /no longer applies/.test(err.message),
    );
  });

  it("returns PRECONDITION_FAILED for a locked section", async () => {
    const { deps, section, first } = await setup();
    await deps.store.updateSection(fixtureCtx.workspaceId, section.id, { locked: true });
    await expect(
      revisionImpl.accept({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, revisionId: first.id },
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === "PRECONDITION_FAILED" &&
        /locked/.test(err.message),
    );
  });
});
