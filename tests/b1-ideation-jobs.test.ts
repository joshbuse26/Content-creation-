import { describe, expect, it } from "vitest";
import { fixtureChannel, FIXTURE_IDS } from "@/lib/fixtures";
import { channelSchema } from "@/lib/types/entities";
import {
  dailyIdeasJobDataSchema,
  fanOutDailyIdeas,
  fanOutOutlierRefresh,
  outlierJobDataSchema,
  processIdeationJob,
} from "@/pipelines/ideation/jobs";
import { JOB_NAMES } from "@/queue/queues";
import { makeIdeationDeps } from "./b1-helpers";

describe("job payload schemas", () => {
  it("accepts the sweep sentinel and the frozen per-run inputs", () => {
    expect(outlierJobDataSchema.parse({ sweep: true })).toEqual({ sweep: true });
    expect(outlierJobDataSchema.parse({ nicheKeywords: ["coffee gear"] })).toEqual({
      nicheKeywords: ["coffee gear"],
    });
    expect(
      dailyIdeasJobDataSchema.parse({
        workspaceId: FIXTURE_IDS.workspace,
        channelId: FIXTURE_IDS.channel,
        chargeCredits: true,
        actorUserId: FIXTURE_IDS.user,
        batchNonce: "n1",
      }),
    ).toMatchObject({ chargeCredits: true, batchNonce: "n1" });
  });

  it("rejects junk", () => {
    expect(() => outlierJobDataSchema.parse({ nicheKeywords: [] })).toThrow();
    expect(() => dailyIdeasJobDataSchema.parse({ workspaceId: "nope" })).toThrow();
  });
});

describe("sweep fan-out (no Redis → inline)", () => {
  it("outlier sweep dedupes identical normalized niches across channels", async () => {
    const deps = makeIdeationDeps();
    // A second channel in a different workspace sharing the SAME niche
    // (different casing) plus one channel without a niche.
    deps.channelRepo.seedChannel(
      channelSchema.parse({
        ...fixtureChannel,
        id: crypto.randomUUID(),
        workspaceId: FIXTURE_IDS.otherWorkspace,
        nicheKeywords: fixtureChannel.nicheKeywords.map((k) => k.toUpperCase()),
      }),
    );
    deps.channelRepo.seedChannel(
      channelSchema.parse({ ...fixtureChannel, id: crypto.randomUUID(), nicheKeywords: [] }),
    );

    const dispatched = await fanOutOutlierRefresh(deps);
    expect(dispatched).toBe(1);
  });

  it("daily ideas sweep runs once per niche-having channel, free", async () => {
    const deps = makeIdeationDeps();
    deps.channelRepo.seedChannel(
      channelSchema.parse({ ...fixtureChannel, id: crypto.randomUUID(), nicheKeywords: [] }),
    );
    const dispatched = await fanOutDailyIdeas(deps);
    expect(dispatched).toBe(1);
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });

  it("processIdeationJob routes both job names", async () => {
    const deps = makeIdeationDeps();
    await processIdeationJob({ name: JOB_NAMES.dailyIdeas, data: { sweep: true } }, deps);
    await processIdeationJob(
      { name: JOB_NAMES.outlierRefresh, data: { nicheKeywords: ["coffee gear"] } },
      deps,
    );
    await expect(processIdeationJob({ name: "bogus", data: {} }, deps)).rejects.toThrow(
      /unhandled job/,
    );
  });
});
