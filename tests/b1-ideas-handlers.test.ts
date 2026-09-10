import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_IDS, fixtureIdea } from "@/lib/fixtures";
import { ideaIdSchema } from "@/lib/types/ids";
import { setIdeationDepsForTests } from "@/pipelines/ideation/deps";
import { ideasHandlers } from "@/server/routers/impl/ideas";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx, makeIdeationDeps, otherWorkspaceCtx, type B1Deps } from "./b1-helpers";

const ideaId = ideaIdSchema.parse(FIXTURE_IDS.idea);
const channelId = fixtureIdea.channelId;

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

function feedInput(overrides: Partial<{ status: "new" | "saved" | "dismissed" }> = {}) {
  return {
    workspaceId: fixtureCtx.workspaceId,
    channelId,
    limit: 20,
    ...overrides,
  };
}

describe("ideas.feed", () => {
  it("returns the channel's ideas for the caller's workspace", async () => {
    const ideas = await ideasHandlers.feed({ ctx: fixtureCtx, input: feedInput() });
    expect(ideas.map((i) => i.id)).toContain(ideaId);
    for (const idea of ideas) {
      expect(idea.workspaceId).toBe(fixtureCtx.workspaceId);
    }
  });

  it("filters by status", async () => {
    const dismissed = await ideasHandlers.feed({
      ctx: fixtureCtx,
      input: feedInput({ status: "dismissed" }),
    });
    expect(dismissed).toHaveLength(0);
  });

  it("rejects a channel that belongs to another workspace", async () => {
    await expect(
      ideasHandlers.feed({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, channelId, limit: 20 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ideas.save / ideas.dismiss", () => {
  it("save marks the idea saved", async () => {
    const saved = await ideasHandlers.save({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, ideaId },
    });
    expect(saved.status).toBe("saved");
  });

  it("dismiss marks the idea dismissed", async () => {
    const dismissed = await ideasHandlers.dismiss({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, ideaId },
    });
    expect(dismissed.status).toBe("dismissed");
  });

  it("cross-workspace idea ids read as NOT_FOUND (tenancy not probeable)", async () => {
    await expect(
      ideasHandlers.save({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, ideaId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      ideasHandlers.dismiss({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, ideaId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ideas.promote", () => {
  it("creates a project wired to the idea and marks it promoted", async () => {
    const { idea, project } = await ideasHandlers.promote({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, ideaId },
    });
    expect(idea.status).toBe("promoted");
    expect(project.ideaId).toBe(ideaId);
    expect(project.title).toBe(fixtureIdea.title);
    expect(project.channelId).toBe(fixtureIdea.channelId);
    expect(project.workspaceId).toBe(fixtureCtx.workspaceId);

    // The project is really in the engine store (visible to the rest of the app).
    const stored = await deps.engineStore.getProject(fixtureCtx.workspaceId, project.id);
    expect(stored?.ideaId).toBe(ideaId);
  });

  it("refuses to promote the same idea twice", async () => {
    await ideasHandlers.promote({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, ideaId },
    });
    await expect(
      ideasHandlers.promote({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, ideaId },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects cross-workspace promotion", async () => {
    await expect(
      ideasHandlers.promote({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, ideaId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ideas.requestBatch", () => {
  it("runs the batch inline (no Redis) and lands 1 idempotent credit charge", async () => {
    const result = await ideasHandlers.requestBatch({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId },
    });
    expect(result.status).toBe("queued");

    expect(deps.engineStore.creditEntries).toHaveLength(1);
    expect(deps.engineStore.creditEntries[0]?.delta).toBe(-1);
    expect(deps.engineStore.creditEntries[0]?.reason).toBe("idea_batch");

    // The fresh batch is visible in the feed.
    const ideas = await ideasHandlers.feed({ ctx: fixtureCtx, input: feedInput() });
    expect(ideas.length).toBeGreaterThan(1);
  });

  it("each requested batch is its own charge", async () => {
    await ideasHandlers.requestBatch({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId },
    });
    await ideasHandlers.requestBatch({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId },
    });
    expect(deps.engineStore.creditEntries).toHaveLength(2);
  });

  it("fails PRECONDITION_FAILED without enough credits, and charges nothing", async () => {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === fixtureCtx.workspaceId,
    );
    expect(workspace).toBeDefined();
    if (workspace !== undefined) workspace.creditBalance = 0;

    await expect(
      ideasHandlers.requestBatch({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, channelId },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });

  it("rejects cross-workspace channels", async () => {
    await expect(
      ideasHandlers.requestBatch({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, channelId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires niche keywords before spending a credit", async () => {
    const { channelSchema } = await import("@/lib/types/entities");
    const { fixtureChannel } = await import("@/lib/fixtures");
    const nicheless = channelSchema.parse({
      ...fixtureChannel,
      id: crypto.randomUUID(),
      nicheKeywords: [],
    });
    deps.channelRepo.seedChannel(nicheless);

    await expect(
      ideasHandlers.requestBatch({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, channelId: nicheless.id },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });
});

describe("error shapes", () => {
  it("uses TRPCError instances", async () => {
    await expect(
      ideasHandlers.save({
        ctx: otherWorkspaceCtx,
        input: { workspaceId: otherWorkspaceCtx.workspaceId, ideaId },
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
