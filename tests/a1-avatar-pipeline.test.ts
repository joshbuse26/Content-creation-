import { describe, expect, it } from "vitest";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asUserId, asWorkspaceId } from "@/lib/types/ids";
import { audienceAvatarSchema } from "@/lib/types/entities";
import { generatedAvatarSchema } from "@/lib/types/pipeline";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { InMemoryChannelStore } from "@/server/channel/repo";
import { mergeGeneratedAvatar } from "@/pipelines/avatar/merge";
import {
  deterministicAvatar,
  extractJsonObject,
  runAvatarGeneration,
  type AvatarDeps,
} from "@/pipelines/avatar/pipeline";
import { InMemoryQuotaCounter, QuotaTracker } from "@/pipelines/sync/quota";
import type { LlmProvider } from "@/lib/providers/types";

const workspaceId = asWorkspaceId(FIXTURE_IDS.workspace);
const userId = asUserId(FIXTURE_IDS.user);

async function seedChannel(store: InMemoryChannelStore) {
  return store.create({
    workspaceId,
    mode: "public",
    youtubeChannelId: "UCfixture0000000000000001",
    title: "Deep Dive with Casey",
    handle: "@deepdivecasey",
    nicheKeywords: ["home espresso"],
    oauthRefreshTokenEnc: null,
  });
}

function makeDeps(store: InMemoryChannelStore, llm?: LlmProvider): AvatarDeps {
  const providers = createFixtureProviders();
  return {
    channelRepo: store,
    avatarRepo: store.asAvatarRepo(),
    youtube: providers.youtube,
    transcript: providers.transcript,
    llm: llm ?? providers.llm,
    quota: new QuotaTracker(new InMemoryQuotaCounter()),
    runStore: new InMemoryPipelineRunStore(),
  };
}

const llmReturning = (text: string): LlmProvider => ({
  complete: () =>
    Promise.resolve({ text, inputTokens: 10, outputTokens: 10, stopReason: "end_turn" as const }),
  stream: async function* (): AsyncIterable<string> {
    yield await Promise.resolve(text);
  },
});

const validAvatarJson = JSON.stringify({
  ageRange: "30-44",
  genderSplit: "60% male / 40% female",
  geo: ["United States", "Germany"],
  sophistication: "advanced",
  pains: [{ pain: "Plateaued espresso quality", evidence: "Dial-in videos dominate" }],
  motivations: [{ motivation: "Cafe-level shots at home", evidence: "Budget-vs-pro comparisons" }],
  vocabularyNotes: "Uses extraction jargon freely.",
});

describe("avatar regeneration credits", () => {
  it("charges 1 credit (idempotently) for a user-triggered regeneration", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const charges: { delta: number; reason: string; idempotencyKey?: string | null }[] = [];
    const deps: AvatarDeps = {
      ...makeDeps(store, llmReturning(validAvatarJson)),
      recordCredits: (record) => {
        charges.push(record);
        return Promise.resolve();
      },
    };
    const input = {
      workspaceId,
      channelId: channel.id,
      regenerateAll: true,
      chargeCredits: true,
      actorUserId: userId,
    };
    await runAvatarGeneration(deps, input);
    expect(charges).toEqual([
      expect.objectContaining({
        delta: -1,
        reason: "avatar_regen",
        actorUserId: userId,
        idempotencyKey: expect.stringMatching(/^avatar_regen:/) as unknown,
      }),
    ]);

    // Identical re-run against the same run store: all stages resumed as
    // done, no new work — no second charge.
    await runAvatarGeneration(deps, input);
    expect(charges).toHaveLength(1);
  });

  it("does not charge for automatic generation (channel connect)", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const charges: unknown[] = [];
    const deps: AvatarDeps = {
      ...makeDeps(store, llmReturning(validAvatarJson)),
      recordCredits: (record) => {
        charges.push(record);
        return Promise.resolve();
      },
    };
    await runAvatarGeneration(deps, {
      workspaceId,
      channelId: channel.id,
      regenerateAll: false,
    });
    expect(charges).toHaveLength(0);
  });
});

describe("avatar pipeline (§5.2)", () => {
  it("writes a structured avatar to columns from an LLM JSON response", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(
      store,
      llmReturning(`Here you go:\n\`\`\`json\n${validAvatarJson}\n\`\`\``),
    );

    const avatar = await runAvatarGeneration(deps, {
      workspaceId,
      channelId: channel.id,
      regenerateAll: false,
    });

    expect(avatar.workspaceId).toBe(workspaceId);
    expect(avatar.channelId).toBe(channel.id);
    expect(avatar.ageRange).toBe("30-44");
    expect(avatar.sophistication).toBe("advanced");
    expect(avatar.pains).toHaveLength(1);
    expect(avatar.aiGeneratedAt).not.toBeNull();
    expect(avatar.lastEditedBy).toBeNull();

    const runStore = deps.runStore as InMemoryPipelineRunStore;
    expect(runStore.rows.map((r) => [r.kind, r.stage, r.status])).toEqual([
      ["avatar", "assemble_avatar_context", "done"],
      ["avatar", "generate_avatar", "done"],
    ]);
  });

  it("falls back to a schema-valid derived avatar in fixture mode (prose LLM)", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(store); // fixture LLM returns canned prose, not JSON

    const avatar = await runAvatarGeneration(deps, {
      workspaceId,
      channelId: channel.id,
      regenerateAll: false,
    });
    expect(avatar.pains.length).toBeGreaterThan(0);
    expect(avatar.motivations.length).toBeGreaterThan(0);
    expect(avatar.aiGeneratedAt).not.toBeNull();
  });

  it("edit-wins: regeneration only fills empty fields when the user has edited", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);

    // User hand-edits two fields (via the avatar.update path semantics).
    await store.upsert(
      workspaceId,
      channel.id,
      { ageRange: "18-24 (hand-tuned)", vocabularyNotes: "Keep it casual — my words" },
      { lastEditedBy: userId },
    );

    const deps = makeDeps(store, llmReturning(validAvatarJson));
    const avatar = await runAvatarGeneration(deps, {
      workspaceId,
      channelId: channel.id,
      regenerateAll: false,
    });

    // User's fields survive; empty fields were filled by the AI.
    expect(avatar.ageRange).toBe("18-24 (hand-tuned)");
    expect(avatar.vocabularyNotes).toBe("Keep it casual — my words");
    expect(avatar.genderSplit).toBe("60% male / 40% female");
    expect(avatar.geo).toEqual(["United States", "Germany"]);
    expect(avatar.sophistication).toBe("advanced");
    expect(avatar.lastEditedBy).toBe(userId);
    expect(avatar.aiGeneratedAt).not.toBeNull();
  });

  it("regenerateAll overwrites user edits and clears last_edited_by", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    await store.upsert(
      workspaceId,
      channel.id,
      { ageRange: "18-24 (hand-tuned)" },
      { lastEditedBy: userId },
    );

    const deps = makeDeps(store, llmReturning(validAvatarJson));
    const avatar = await runAvatarGeneration(deps, {
      workspaceId,
      channelId: channel.id,
      regenerateAll: true,
    });
    expect(avatar.ageRange).toBe("30-44");
    expect(avatar.lastEditedBy).toBeNull();
  });

  it("fails for a channel outside the workspace", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(store);
    await expect(
      runAvatarGeneration(deps, {
        workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace),
        channelId: channel.id,
        regenerateAll: false,
      }),
    ).rejects.toThrow(/avatar generation failed/);
  }, 15_000); // stage retries back off ~3s before giving up
});

describe("mergeGeneratedAvatar", () => {
  const generated = generatedAvatarSchema.parse(JSON.parse(validAvatarJson) as unknown);
  const now = new Date("2026-09-10T03:00:00.000Z");

  it("takes everything for a never-edited avatar", () => {
    const write = mergeGeneratedAvatar(null, generated, false, now);
    expect(write.fields.ageRange).toBe("30-44");
    expect(write.meta).toEqual({ aiGeneratedAt: now, lastEditedBy: null });
  });

  it("treats whitespace-only text fields as empty", () => {
    const existing = audienceAvatarSchema.parse({
      ...generated,
      vocabularyNotes: "   ", // whitespace-only → considered empty, gets filled
      id: FIXTURE_IDS.avatar,
      workspaceId: FIXTURE_IDS.workspace,
      channelId: FIXTURE_IDS.channel,
      editableByUser: true,
      aiGeneratedAt: null,
      lastEditedBy: FIXTURE_IDS.user,
      createdAt: now,
      updatedAt: now,
    });
    const write = mergeGeneratedAvatar(existing, generated, false, now);
    expect(write.fields.vocabularyNotes).toBe(generated.vocabularyNotes);
    expect(write.fields.ageRange).toBeUndefined(); // non-empty field untouched
  });
});

describe("extractJsonObject / deterministicAvatar", () => {
  it("extracts JSON from fenced and prose-wrapped replies", () => {
    expect(extractJsonObject('prefix ```json\n{"a": 1}\n``` suffix')).toEqual({ a: 1 });
    expect(() => extractJsonObject("no json here")).toThrow(/no JSON object/);
  });

  it("derives a schema-valid avatar from context", () => {
    const avatar = deterministicAvatar({
      channelTitle: "T",
      channelHandle: null,
      subs: 1000,
      totalViews: 100_000,
      medianViews90d: 60_000,
      nicheKeywords: ["chess"],
      recentVideos: [{ title: "How I hit 2000 elo", viewCount: 12_000 }],
      transcriptExcerpts: [],
    });
    expect(generatedAvatarSchema.parse(avatar)).toBeTruthy();
    expect(avatar.sophistication).toBe("intermediate");
  });
});
