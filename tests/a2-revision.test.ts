import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { fixtureScript, fixtureSections } from "@/lib/fixtures";
import { applyDiffOps, DiffApplyError } from "@/pipelines/revision/apply";
import { runRevisionPipeline } from "@/pipelines/revision/pipeline";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { revisionImpl } from "@/server/routers/impl/revision";
import { fixtureCtx, makeDeps } from "./a2-helpers";

describe("applyDiffOps (line-level, 1-based inclusive)", () => {
  const body = "line one\nline two\nline three\nline four";

  it("replaces a middle range", () => {
    expect(applyDiffOps(body, [{ lineStart: 2, lineEnd: 3, replacement: "REPLACED" }])).toBe(
      "line one\nREPLACED\nline four",
    );
  });

  it("applies multiple non-overlapping ops bottom-up", () => {
    const out = applyDiffOps(body, [
      { lineStart: 1, lineEnd: 1, replacement: "first\nsecond" },
      { lineStart: 4, lineEnd: 4, replacement: "last" },
    ]);
    expect(out).toBe("first\nsecond\nline two\nline three\nlast");
  });

  it("rejects overlapping ops and out-of-range ops", () => {
    expect(() =>
      applyDiffOps(body, [
        { lineStart: 1, lineEnd: 2, replacement: "a" },
        { lineStart: 2, lineEnd: 3, replacement: "b" },
      ]),
    ).toThrow(DiffApplyError);
    expect(() => applyDiffOps(body, [{ lineStart: 9, lineEnd: 9, replacement: "x" }])).toThrow(
      DiffApplyError,
    );
  });
});

describe("revision pass + accept/reject", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    setEngineDepsForTests(deps);
  });
  afterEach(() => {
    setEngineDepsForTests(undefined);
  });

  it("produces pending line-level suggestions on real sections; charges 2 credits", async () => {
    const { result, revisions } = await runRevisionPipeline(deps, {
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: fixtureScript.id },
      actorUserId: fixtureCtx.userId,
    });
    expect(result.status).toBe("done");
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    const sectionIds = new Set(fixtureSections.map((s) => s.id as string));
    for (const revision of revisions) {
      expect(revision.status).toBe("pending");
      expect(sectionIds.has(revision.sectionId as string)).toBe(true);
      expect(revision.diff.length).toBeGreaterThanOrEqual(1);
      expect(revision.rationale.length).toBeGreaterThan(0);
    }
    expect(deps.store.creditEntries).toEqual([
      expect.objectContaining({ delta: -2, reason: "revision_pass" }),
    ]);
  });

  it("accept applies the diff, bumps script version, and is idempotent-guarded", async () => {
    const { revisions } = await runRevisionPipeline(deps, {
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: fixtureScript.id },
      actorUserId: null,
    });
    const revision = revisions[0];
    expect(revision).toBeDefined();
    if (revision === undefined) return;

    const before = await deps.store.getScript(fixtureCtx.workspaceId, fixtureScript.id);
    const sectionBefore = await deps.store.getSection(fixtureCtx.workspaceId, revision.sectionId);

    const accepted = await revisionImpl.accept({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: revision.id },
    });
    expect(accepted.revision.status).toBe("accepted");
    expect(accepted.section.body).not.toBe(sectionBefore?.body);
    const firstOp = revision.diff[0];
    if (firstOp !== undefined) {
      expect(accepted.section.body).toContain(firstOp.replacement.split("\n")[0]);
    }

    const after = await deps.store.getScript(fixtureCtx.workspaceId, fixtureScript.id);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(after?.status).toBe("revising");

    // Accepting the same revision twice is refused.
    await expect(
      revisionImpl.accept({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, revisionId: revision.id },
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("reject marks the revision rejected and leaves the section untouched", async () => {
    const { revisions } = await runRevisionPipeline(deps, {
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: fixtureScript.id },
      actorUserId: null,
    });
    const revision = revisions[0];
    if (revision === undefined) throw new Error("no revisions produced");
    const sectionBefore = await deps.store.getSection(fixtureCtx.workspaceId, revision.sectionId);

    const rejected = await revisionImpl.reject({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: revision.id },
    });
    expect(rejected.status).toBe("rejected");
    const sectionAfter = await deps.store.getSection(fixtureCtx.workspaceId, revision.sectionId);
    expect(sectionAfter?.body).toBe(sectionBefore?.body);

    await expect(
      revisionImpl.reject({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, revisionId: revision.id },
      }),
    ).rejects.toThrow(TRPCError);
  });
});
