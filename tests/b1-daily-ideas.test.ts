import { describe, expect, it } from "vitest";
import { fixtureChannel, fixtureIdea, FIXTURE_IDS } from "@/lib/fixtures";
import { channelSchema } from "@/lib/types/entities";
import { runDailyIdeas, DAILY_IDEAS_COUNT } from "@/pipelines/ideation/ideas";
import { CREDIT_COSTS } from "@/server/credits";
import { makeIdeationDeps } from "./b1-helpers";

const input = { workspaceId: FIXTURE_IDS.workspace, channelId: FIXTURE_IDS.channel };

describe("daily ideas pipeline (§5.4)", () => {
  it("generates 5 ideas, inserts them as status=new for today", async () => {
    const deps = makeIdeationDeps();
    const result = await runDailyIdeas(deps, { input });

    expect(result.status).toBe("done");
    expect(result.generated).toBe(DAILY_IDEAS_COUNT);
    expect(result.ideas.length).toBeGreaterThan(0);
    for (const idea of result.ideas) {
      expect(idea.status).toBe("new");
      expect(idea.workspaceId).toBe(FIXTURE_IDS.workspace);
      expect(idea.channelId).toBe(FIXTURE_IDS.channel);
      expect(idea.generatedOn).toBe("2026-09-10");
      expect(idea.score).toBeGreaterThanOrEqual(0);
      expect(idea.score).toBeLessThanOrEqual(100);
    }
  });

  it("evidence ids only reference real outlier-index entries", async () => {
    const deps = makeIdeationDeps();
    const result = await runDailyIdeas(deps, { input });
    const knownIds = new Set(
      (
        await deps.store.listOutliers({ nicheKeywords: fixtureChannel.nicheKeywords, limit: 50 })
      ).map((o) => o.youtubeVideoId),
    );
    for (const idea of result.ideas) {
      for (const id of idea.evidenceVideoIds) {
        expect(knownIds.has(id)).toBe(true);
      }
    }
  });

  it("dedups against the last 30 days by title similarity", async () => {
    const deps = makeIdeationDeps();
    const first = await runDailyIdeas(deps, { input, batchNonce: "batch-1" });
    expect(first.duplicates).toBe(0);

    // Same channel, same deterministic generator → all 5 are dups now.
    const second = await runDailyIdeas(deps, { input, batchNonce: "batch-2" });
    expect(second.generated).toBe(DAILY_IDEAS_COUNT);
    expect(second.duplicates).toBe(DAILY_IDEAS_COUNT);
    expect(second.ideas).toHaveLength(0);
  });

  it("skips cleanly for a channel with no niche keywords", async () => {
    const deps = makeIdeationDeps();
    const bare = channelSchema.parse({
      ...fixtureChannel,
      id: crypto.randomUUID(),
      nicheKeywords: [],
    });
    deps.channelRepo.seedChannel(bare);
    const result = await runDailyIdeas(deps, {
      input: { workspaceId: FIXTURE_IDS.workspace, channelId: bare.id },
    });
    expect(result.status).toBe("skipped_no_niche");
    expect(result.ideas).toHaveLength(0);
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });

  it("rejects a channel from the wrong workspace", async () => {
    const deps = makeIdeationDeps();
    await expect(
      runDailyIdeas(deps, {
        input: { workspaceId: FIXTURE_IDS.otherWorkspace, channelId: FIXTURE_IDS.channel },
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("idea batch credits (spec §7: extra batch = CREDIT_COSTS.ideaBatch)", () => {
  it("does NOT charge for the free daily run", async () => {
    const deps = makeIdeationDeps();
    await runDailyIdeas(deps, { input });
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });

  it("charges the configured batch cost once for a requested batch, idempotently", async () => {
    // The pipeline records exactly one ledger entry per charged run, with the
    // delta derived from CREDIT_COSTS.ideaBatch (a 0-delta entry while
    // batches are free). Whether to charge at all is the router's decision.
    const batchCost: number = CREDIT_COSTS.ideaBatch;
    const deps = makeIdeationDeps();
    await runDailyIdeas(deps, {
      input,
      chargeCredits: true,
      actorUserId: FIXTURE_IDS.user,
      batchNonce: "nonce-1",
    });
    expect(deps.engineStore.creditEntries).toHaveLength(1);
    const entry = deps.engineStore.creditEntries[0];
    expect(entry?.delta).toBe(-batchCost);
    expect(entry?.reason).toBe("idea_batch");
    expect(entry?.actorUserId).toBe(FIXTURE_IDS.user);

    // A BullMQ-style retry of the SAME run (same nonce, same day) resumes
    // done stages and never double-charges.
    await runDailyIdeas(deps, {
      input,
      chargeCredits: true,
      actorUserId: FIXTURE_IDS.user,
      batchNonce: "nonce-1",
    });
    expect(deps.engineStore.creditEntries).toHaveLength(1);

    // A genuinely new batch is a new charge.
    await runDailyIdeas(deps, {
      input,
      chargeCredits: true,
      actorUserId: FIXTURE_IDS.user,
      batchNonce: "nonce-2",
    });
    expect(deps.engineStore.creditEntries).toHaveLength(2);
  });

  it("seeded fixture idea participates in the dedup window", async () => {
    const deps = makeIdeationDeps();
    const titles = await deps.store.recentIdeaTitles(
      fixtureIdea.workspaceId,
      fixtureIdea.channelId,
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(titles).toContain(fixtureIdea.title);
  });
});
