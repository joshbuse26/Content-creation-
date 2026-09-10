import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureFrame, fixtureProject } from "@/lib/fixtures";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { runFramePipeline } from "@/pipelines/script/frames";
import { runTitlesPipeline } from "@/pipelines/script/titles";
import { frameImpl } from "@/server/routers/impl/frame";
import { fixtureCtx, makeDeps } from "./a2-helpers";

describe("frame proposals (§5.6)", () => {
  it("inserts 4 divergent frames and moves the project to framing", async () => {
    const deps = makeDeps();
    const { result, frames } = await runFramePipeline(deps, {
      input: { workspaceId: fixtureCtx.workspaceId, projectId: fixtureProject.id },
      actorUserId: null,
    });
    expect(result.status).toBe("done");
    expect(frames).toHaveLength(4);
    expect(frames.every((f) => !f.chosen)).toBe(true);
    // Divergence: at least 3 formats and 2 outcomes across the set.
    expect(new Set(frames.map((f) => f.format)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(frames.map((f) => f.outcome)).size).toBeGreaterThanOrEqual(2);
    const project = await deps.store.getProject(fixtureCtx.workspaceId, fixtureProject.id);
    expect(project?.status).toBe("framing");
  });

  it("choose sets exactly one chosen frame per project", async () => {
    const deps = makeDeps();
    setEngineDepsForTests(deps);
    try {
      const { frames } = await runFramePipeline(deps, {
        input: { workspaceId: fixtureCtx.workspaceId, projectId: fixtureProject.id },
        actorUserId: null,
      });
      const target = frames[2];
      if (target === undefined) throw new Error("expected 4 frames");
      const chosen = await frameImpl.choose({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, frameId: target.id },
      });
      expect(chosen.chosen).toBe(true);
      const all = await deps.store.listFrames(fixtureCtx.workspaceId, fixtureProject.id);
      expect(all.filter((f) => f.chosen)).toHaveLength(1);
      expect(all.find((f) => f.chosen)?.id).toBe(target.id);
      // The previously chosen fixture frame lost its flag.
      expect(all.find((f) => f.id === fixtureFrame.id)?.chosen).toBe(false);
    } finally {
      setEngineDepsForTests(undefined);
    }
  });
});

describe("titles (§5.9)", () => {
  it("generates 25 scored options across at least 5 pattern families", async () => {
    const deps = makeDeps();
    const { result, titleSet } = await runTitlesPipeline(deps, {
      input: { workspaceId: fixtureCtx.workspaceId, projectId: fixtureProject.id },
      actorUserId: null,
    });
    expect(result.status).toBe("done");
    expect(titleSet).not.toBeNull();
    expect(titleSet?.options).toHaveLength(25);
    const families = new Set(titleSet?.options.map((o) => o.patternFamily));
    expect(families.size).toBeGreaterThanOrEqual(5);
    for (const option of titleSet?.options ?? []) {
      expect(option.score).toBeGreaterThanOrEqual(0);
      expect(option.score).toBeLessThanOrEqual(100);
      expect(option.text.length).toBeLessThanOrEqual(100);
    }
    // Persisted as the project's latest title set; 1 credit charged.
    const latest = await deps.store.latestTitleSet(fixtureCtx.workspaceId, fixtureProject.id);
    expect(latest?.id).toBe(titleSet?.id);
    expect(deps.store.creditEntries).toEqual([
      expect.objectContaining({ delta: -1, reason: "titles" }),
    ]);
  });
});

describe("engine deps test-injection hygiene", () => {
  beforeEach(() => {
    setEngineDepsForTests(undefined);
  });
  afterEach(() => {
    setEngineDepsForTests(undefined);
  });
  it("makeDeps stores are isolated between instances", async () => {
    const a = makeDeps();
    const b = makeDeps();
    await a.store.updateProjectStatus(fixtureCtx.workspaceId, fixtureProject.id, "packaging");
    const inB = await b.store.getProject(fixtureCtx.workspaceId, fixtureProject.id);
    expect(inB?.status).toBe(fixtureProject.status);
  });
});
