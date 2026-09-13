import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_IDS, fixtureChannel } from "@/lib/fixtures";
import { ideaIdSchema } from "@/lib/types/ids";
import { buildCoachContext } from "@/lib/chat/context";
import type { StageDeps } from "@/pipelines/stages/deps";
import { InMemoryPartnerSource } from "@/pipelines/stages/partners";
import { setIdeationDepsForTests } from "@/pipelines/ideation/deps";
import { ideasHandlers } from "@/server/routers/impl/ideas";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { makeDeps } from "./a2-helpers";
import { fixtureCtx, makeIdeationDeps, otherWorkspaceCtx, type B1Deps } from "./b1-helpers";

const channelId = fixtureChannel.id;

let deps: B1Deps;

beforeEach(() => {
  deps = makeIdeationDeps();
  setIdeationDepsForTests(deps);
  resetSharedWorkspaceStoreForTests();
});

afterEach(() => {
  setIdeationDepsForTests(undefined);
  resetSharedWorkspaceStoreForTests();
});

/** A StageDeps that shares the ideation deps' engine store + channel repo, so
 *  buildCoachContext reads exactly what the handlers wrote. */
function stageDepsFrom(d: B1Deps): StageDeps {
  return {
    engine: { ...makeDeps(), store: d.engineStore },
    channels: d.channelRepo,
    ideation: d.store,
    partners: new InMemoryPartnerSource(),
  };
}

describe("ideas.outliers", () => {
  it("fronts the outlier index for the channel's niche", async () => {
    const rows = await ideasHandlers.outliers({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        channelId,
        nicheKeyword: null,
        limit: 40,
        minOutlierRatio: null,
        recency: "all",
      },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.outlierRatio).toBeGreaterThan(0);
  });

  it("narrows to a single niche keyword", async () => {
    const none = await ideasHandlers.outliers({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        channelId,
        nicheKeyword: "latte art",
        limit: 40,
        minOutlierRatio: null,
        recency: "all",
      },
    });
    expect(none).toHaveLength(0);
    const some = await ideasHandlers.outliers({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        channelId,
        nicheKeyword: "coffee gear",
        limit: 40,
        minOutlierRatio: null,
        recency: "all",
      },
    });
    expect(some.length).toBeGreaterThan(0);
  });

  it("rejects a channel from another workspace (tenancy)", async () => {
    await expect(
      ideasHandlers.outliers({
        ctx: otherWorkspaceCtx,
        input: {
          workspaceId: otherWorkspaceCtx.workspaceId,
          channelId,
          nicheKeyword: null,
          limit: 40,
          minOutlierRatio: null,
          recency: "all",
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ideas.searchDemand", () => {
  it("returns deterministic keyless signals per topic", async () => {
    const signals = await ideasHandlers.searchDemand({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId, topics: ["home espresso"] },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.provider).toBe("web_search");
    expect(signals[0]?.topic).toBe("home espresso");
  });

  it("defaults to the channel's niche keywords when topics are empty", async () => {
    const signals = await ideasHandlers.searchDemand({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId, topics: [] },
    });
    expect(signals).toHaveLength(fixtureChannel.nicheKeywords.length);
  });

  it("rejects a channel from another workspace (tenancy)", async () => {
    await expect(
      ideasHandlers.searchDemand({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, channelId, topics: ["x"] },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ideas.useIdea", () => {
  async function freshIdea(angle = "Cost-optimized gear stack, blind-tasted") {
    const [inserted] = await deps.store.insertIdeas([
      {
        workspaceId: fixtureCtx.workspaceId,
        channelId,
        title: "Espresso on a shoestring",
        angle,
        rationale: "Budget stacks are overperforming this niche.",
        evidenceVideoIds: [],
        score: 72,
        generatedOn: "2026-09-10",
      },
    ]);
    if (inserted === undefined) throw new Error("failed to seed idea");
    return inserted;
  }

  it("creates a project and seeds a CHOSEN frame carrying the unique angle", async () => {
    const seedIdea = await freshIdea();
    const { idea, project, frame } = await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: seedIdea.id,
        angle: null,
        targetMinutes: null,
      },
    });
    expect(idea.status).toBe("promoted");
    expect(project.ideaId).toBe(seedIdea.id);
    expect(frame.chosen).toBe(true);
    expect(frame.angle).toBe(seedIdea.angle);
    expect(frame.targetMinutes).toBe(8);

    // The chosen frame really lands in the engine store.
    const frames = await deps.engineStore.listFrames(fixtureCtx.workspaceId, project.id);
    expect(frames.filter((f) => f.chosen)).toHaveLength(1);
  });

  it("threads the (steerable) angle all the way into buildCoachContext", async () => {
    const seedIdea = await freshIdea();
    const sharpened = "Blind taste test: $200 stack vs. the $2,000 rig, judged by a barista";
    const { project } = await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: seedIdea.id,
        angle: sharpened,
        targetMinutes: 14,
      },
    });

    const ctx = await buildCoachContext(project.id, fixtureCtx.workspaceId, stageDepsFrom(deps));
    expect(ctx.uniqueAngle).toBe(sharpened);
    expect(ctx.durationMinutes).toBe(14);
  });

  it("is idempotent: re-using an idea maps to one project, one chosen frame", async () => {
    const seedIdea = await freshIdea();
    const first = await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: seedIdea.id,
        angle: null,
        targetMinutes: null,
      },
    });
    const second = await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: seedIdea.id,
        angle: "re-steered angle",
        targetMinutes: null,
      },
    });
    expect(second.project.id).toBe(first.project.id);

    const projects = await deps.engineStore.listProjects(fixtureCtx.workspaceId, {
      channelId,
      limit: 100,
    });
    expect(projects.filter((p) => p.ideaId === seedIdea.id)).toHaveLength(1);

    const frames = await deps.engineStore.listFrames(fixtureCtx.workspaceId, first.project.id);
    expect(frames.filter((f) => f.chosen)).toHaveLength(1);
    expect(frames.find((f) => f.chosen)?.angle).toBe("re-steered angle");
  });

  it("never charges credits (reading + seeding is free)", async () => {
    const seedIdea = await freshIdea();
    await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: seedIdea.id,
        angle: null,
        targetMinutes: null,
      },
    });
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });

  it("rejects a cross-workspace idea (tenancy)", async () => {
    await expect(
      ideasHandlers.useIdea({
        ctx: otherWorkspaceCtx,
        input: {
          workspaceId: otherWorkspaceCtx.workspaceId,
          ideaId: ideaIdSchema.parse(FIXTURE_IDS.idea),
          angle: null,
          targetMinutes: null,
        },
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
