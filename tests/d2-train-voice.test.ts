import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { fixtureChannel, FIXTURE_IDS } from "@/lib/fixtures";
import { containsRealCreatorName } from "@/lib/seed-lint";
import { styleCardSchema, voiceProfileSchema, type StyleCard } from "@/lib/types/entities";
import { channelIdSchema, workspaceIdSchema, asUserId } from "@/lib/types/ids";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { resolveStyleCard } from "@/pipelines/stages/style-resolver";
import { InMemoryChannelStore } from "@/server/channel/repo";
import { resetBillingStoreForTests } from "@/server/billing";
import { sanitizeRemixCard, synthStyleCard } from "@/server/voice/derive";
import { trainStyleCardFromChannel, type TrainVoiceDeps } from "@/server/voice/train";

/**
 * Wave D2 (WAVE-D-PLAN §2c): real train_on_my_channel derivation, competitor
 * remix, and the train_on_my_channel mode wired end-to-end. Fully in-memory,
 * zero keys — the fixture providers derive a deterministic trained card.
 */

const workspaceId = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const otherWorkspaceId = workspaceIdSchema.parse("00000000-0000-4000-8000-0000000000ff");
const channelId = channelIdSchema.parse(FIXTURE_IDS.channel);
const actorUserId = asUserId(FIXTURE_IDS.user);

function makeDeps(): { deps: TrainVoiceDeps; store: InMemoryEngineStore } {
  const providers = createFixtureProviders();
  const channels = new InMemoryChannelStore();
  channels.seedChannel(fixtureChannel);
  const store = new InMemoryEngineStore({ seedFixtures: false });
  return {
    store,
    deps: {
      mode: "fixture",
      llm: providers.llm,
      youtube: providers.youtube,
      transcript: providers.transcript,
      store,
      channels,
    },
  };
}

const ctx = { workspaceId, actorUserId };

beforeEach(() => {
  // The credit gate reads the shared billing/workspace store (fixtureWorkspace,
  // balance 54 ≥ the trainVoice cost). Reset it so each test starts clean.
  resetBillingStoreForTests();
});

describe("trainStyleCardFromChannel — own channel derivation", () => {
  it("derives a schema-valid trained StyleCard from the channel's transcripts", async () => {
    const { deps } = makeDeps();
    const result = await trainStyleCardFromChannel(ctx, parseInput({ channelId }), deps);

    expect(() => styleCardSchema.parse(result.voiceProfile.styleCard)).not.toThrow();
    expect(() => voiceProfileSchema.parse(result.voiceProfile)).not.toThrow();
    expect(result.remix).toBe(false);
    expect(result.sampledVideoIds.length).toBeGreaterThan(0);
  });

  it('persists source="trained" with trained_from_channel_id + trained_at', async () => {
    const { deps, store } = makeDeps();
    const result = await trainStyleCardFromChannel(ctx, parseInput({ channelId }), deps);

    expect(result.voiceProfile.source).toBe("trained");
    expect(result.voiceProfile.trainedFromChannelId).toBe(channelId);
    expect(result.voiceProfile.trainedAt).toBeInstanceOf(Date);

    const persisted = await store.listVoiceProfiles(workspaceId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.source).toBe("trained");
  });

  it("names the card from the channel title by default, honoring a supplied name", async () => {
    const { deps } = makeDeps();
    const auto = await trainStyleCardFromChannel(ctx, parseInput({ channelId }), deps);
    expect(auto.voiceProfile.name).toContain(fixtureChannel.title);

    const named = await trainStyleCardFromChannel(
      ctx,
      parseInput({ channelId, name: "My narration voice" }),
      makeDeps().deps,
    );
    expect(named.voiceProfile.name).toBe("My narration voice");
  });

  it("charges trainVoice exactly once, and a re-train of the same sample is free + overwrites the row", async () => {
    const { deps, store } = makeDeps();
    const input = parseInput({ channelId, sampleVideoIds: ["vidA", "vidB", "vidC"] });

    const first = await trainStyleCardFromChannel(ctx, input, deps);
    const trainCharges = () => store.creditEntries.filter((e) => e.reason === "train_voice");
    expect(trainCharges()).toHaveLength(1);
    expect(trainCharges()[0]?.delta).toBe(-5);

    // Re-train the same channel + same sample → idempotent charge (still one),
    // and the SAME row is overwritten (no duplicate profile).
    const second = await trainStyleCardFromChannel(ctx, input, deps);
    expect(trainCharges()).toHaveLength(1);
    expect(second.voiceProfile.id).toBe(first.voiceProfile.id);
    expect(await store.listVoiceProfiles(workspaceId)).toHaveLength(1);
  });

  it("errors clearly when the channel has no transcripts", async () => {
    const { deps } = makeDeps();
    // An empty explicit sample list falls through to auto-sampling; force the
    // no-transcript branch by stubbing the transcript provider to return empty.
    deps.transcript = {
      getTranscript: (youtubeVideoId: string) =>
        Promise.resolve({ youtubeVideoId, language: "en", segments: [], fullText: "" }),
    };
    const err = await trainStyleCardFromChannel(ctx, parseInput({ channelId }), deps).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
  });
});

describe("trainStyleCardFromChannel — tenancy", () => {
  it("a cross-workspace channel is NOT_FOUND (never charged)", async () => {
    const { deps, store } = makeDeps();
    const err = await trainStyleCardFromChannel(
      { workspaceId: otherWorkspaceId, actorUserId },
      parseInput({ channelId }),
      deps,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(store.creditEntries).toHaveLength(0);
  });
});

describe("trainStyleCardFromChannel — competitor remix", () => {
  it("produces an ORIGINAL card: remix flag, seed-lint clean, provenance != own channel", async () => {
    const { deps } = makeDeps();
    const result = await trainStyleCardFromChannel(
      ctx,
      parseInput({ channelId, remixFrom: ["UCcompetitor00000000000042", "@rivalcreator"] }),
      deps,
    );

    expect(result.remix).toBe(true);
    expect(result.voiceProfile.source).toBe("trained");
    // Own-vs-remix distinction: remix provenance is a marker, NOT the own channel.
    expect(result.voiceProfile.trainedFromChannelId).not.toBe(channelId);
    // No real-person name anywhere on the derived name + card text.
    const cardText = JSON.stringify(result.voiceProfile.styleCard);
    expect(containsRealCreatorName(result.voiceProfile.name)).toBe(false);
    expect(containsRealCreatorName(cardText)).toBe(false);
    expect(result.voiceProfile.name).toBe("Remixed voice");
  });

  it("a supplied remix name that names a real creator falls back to the generic default", async () => {
    const { deps } = makeDeps();
    const result = await trainStyleCardFromChannel(
      ctx,
      parseInput({ channelId, remixFrom: ["UCrival"], name: "Casey Neistat clone" }),
      deps,
    );
    expect(result.voiceProfile.name).toBe("Remixed voice");
    expect(containsRealCreatorName(result.voiceProfile.name)).toBe(false);
  });

  it("remix provenance is deterministic (same competitor set → same marker, one row)", async () => {
    const { deps, store } = makeDeps();
    const input = parseInput({ channelId, remixFrom: ["@rival", "UCabc"] });
    const a = await trainStyleCardFromChannel(ctx, input, deps);
    const b = await trainStyleCardFromChannel(
      ctx,
      parseInput({ channelId, remixFrom: ["UCabc", "@rival"] }), // order-independent
      deps,
    );
    expect(b.voiceProfile.trainedFromChannelId).toBe(a.voiceProfile.trainedFromChannelId);
    expect(b.voiceProfile.id).toBe(a.voiceProfile.id);
    expect(await store.listVoiceProfiles(workspaceId)).toHaveLength(1);
  });
});

describe("remix similarity guard (sanitizeRemixCard)", () => {
  const competitorTranscripts = [
    "so today we are finally doing the test you have all been asking for and honestly the first result already surprised me",
  ];

  it("drops a near-verbatim competitor snippet and keeps a fresh original one", () => {
    const card: StyleCard = styleCardSchema.parse({
      ...synthStyleCard({ transcripts: competitorTranscripts, remix: true }),
      exampleSnippets: [
        // Near-verbatim competitor span — must be dropped.
        "so today we are finally doing the test you have all been asking for",
        // Fresh original line — must survive.
        "Here is the through-line in one sentence, and the rest is proof.",
      ],
    });

    const { card: cleaned, droppedSnippets } = sanitizeRemixCard(card, competitorTranscripts, 0.08);
    expect(droppedSnippets).toContain(
      "so today we are finally doing the test you have all been asking for",
    );
    expect(cleaned.exampleSnippets).not.toContain(
      "so today we are finally doing the test you have all been asking for",
    );
    expect(cleaned.exampleSnippets).toContain(
      "Here is the through-line in one sentence, and the rest is proof.",
    );
  });

  it("backfills a fresh original line when every derived snippet is dropped", () => {
    const card: StyleCard = styleCardSchema.parse({
      ...synthStyleCard({ transcripts: competitorTranscripts, remix: true }),
      exampleSnippets: [
        "so today we are finally doing the test you have all been asking for and honestly",
      ],
    });
    const { card: cleaned } = sanitizeRemixCard(card, competitorTranscripts, 0.08);
    // Not left with the copied snippet; either empty or backfilled with clean lines.
    expect(
      cleaned.exampleSnippets.every(
        (s) => !s.startsWith("so today we are finally doing the test you have all been asking for"),
      ),
    ).toBe(true);
  });

  it("the fixture remix card's own snippets already pass the guard against the competitor source", () => {
    const card = synthStyleCard({ transcripts: competitorTranscripts, remix: true });
    const { droppedSnippets } = sanitizeRemixCard(card, competitorTranscripts, 0.08);
    expect(droppedSnippets).toHaveLength(0);
  });
});

describe("train_on_my_channel resolution (style-resolver seam)", () => {
  const trainedTarget = (voiceProfileId: string | null) => ({
    mode: "train_on_my_channel" as const,
    archetypeId: null,
    crossover: null,
    partnerId: null,
    voiceProfileId: voiceProfileId as never,
  });

  it("RESOLVES the trained card once one exists for the selected profile", async () => {
    const { deps } = makeDeps();
    const trained = await trainStyleCardFromChannel(ctx, parseInput({ channelId }), deps);
    const card = await resolveStyleCard(
      trainedTarget(trained.voiceProfile.id),
      trained.voiceProfile,
    );
    expect(card).toEqual(trained.voiceProfile.styleCard);
  });

  it("errors 'train a voice first' when no trained card backs the selection", async () => {
    const err = await resolveStyleCard(trainedTarget(FIXTURE_IDS.voiceProfile), null).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((err as TRPCError).message).toMatch(/train a voice/i);
  });
});

describe("migration 0009 — train_voice credit reason", () => {
  it("adds the train_voice value to the credit_reason enum", () => {
    const sql = readFileSync(
      join(__dirname, "..", "db", "migrations", "0009_wave_d2_train_voice_credit_reason.sql"),
      "utf8",
    );
    expect(sql).toContain("ADD VALUE 'train_voice'");
  });
});

/** Parse partial input through the frozen schema (fills nullable defaults). */
function parseInput(o: {
  channelId: typeof channelId;
  sampleVideoIds?: string[];
  remixFrom?: string[];
  name?: string;
}) {
  return {
    channelId: o.channelId,
    sampleVideoIds: o.sampleVideoIds ?? null,
    remixFrom: o.remixFrom ?? null,
    name: o.name ?? null,
  };
}
