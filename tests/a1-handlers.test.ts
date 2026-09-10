import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { channelContracts, avatarContracts } from "@/lib/types/api";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asUserId, asWorkspaceId } from "@/lib/types/ids";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { InMemoryChannelStore } from "@/server/channel/repo";
import { connectOauthChannel } from "@/server/channel/oauth";
import { decryptRefreshToken } from "@/server/channel/crypto";
import { createChannelHandlers } from "@/server/routers/impl/channel";
import { createAvatarHandlers } from "@/server/routers/impl/avatar";
import { InMemoryQuotaCounter, QuotaTracker } from "@/pipelines/sync/quota";
import type { ChannelDomainDeps } from "@/server/channel/deps";
import type { AvatarJobInput, SyncJobInput } from "@/lib/types/pipeline";
import type { SyncEnqueuer } from "@/server/channel/jobs";

const wsA = asWorkspaceId(FIXTURE_IDS.workspace);
const wsB = asWorkspaceId(FIXTURE_IDS.otherWorkspace);
const userA = asUserId(FIXTURE_IDS.user);

const ctxA = { userId: userA, workspaceId: wsA };
/** The attacker: a legit member of workspace B probing workspace A's IDs.
 *  (Membership itself is enforced by workspaceProcedure middleware — these
 *  tests cover the handler-level workspace_id filtering behind it.) */
const ctxB = { userId: userA, workspaceId: wsB };

interface Recorded {
  syncs: SyncJobInput[];
  avatars: AvatarJobInput[];
}

function makeWorld() {
  const store = new InMemoryChannelStore();
  const providers = createFixtureProviders();
  const deps: ChannelDomainDeps = {
    channelRepo: store,
    avatarRepo: store.asAvatarRepo(),
    trackingRepo: store,
    providers,
    quota: new QuotaTracker(new InMemoryQuotaCounter()),
  };
  const recorded: Recorded = { syncs: [], avatars: [] };
  const enqueuer: SyncEnqueuer = {
    enqueueChannelSync(input) {
      recorded.syncs.push(input);
      return Promise.resolve(`job-sync-${recorded.syncs.length}`);
    },
    enqueueAvatarGenerate(input) {
      recorded.avatars.push(input);
      return Promise.resolve(`job-avatar-${recorded.avatars.length}`);
    },
  };
  const handlerDeps = { getDeps: () => Promise.resolve(deps), getEnqueuer: () => enqueuer };
  return {
    store,
    deps,
    recorded,
    channel: createChannelHandlers(handlerDeps),
    avatar: createAvatarHandlers(handlerDeps),
    enqueuer,
  };
}

async function seedChannelIn(store: InMemoryChannelStore, workspaceId = wsA) {
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

describe("channel handlers — happy paths", () => {
  it("connectPublic parses the ref, creates the channel, and queues sync + avatar", async () => {
    const world = makeWorld();
    const input = channelContracts.connectPublic.input.parse({
      workspaceId: wsA,
      urlOrHandle: "https://www.youtube.com/@deepdivecasey",
      nicheKeywords: ["home espresso"],
    });
    const channel = await world.channel.connectPublic({ ctx: ctxA, input });

    expect(channel.workspaceId).toBe(wsA);
    expect(channel.mode).toBe("public");
    expect(channel.title).toBe("Deep Dive with Casey");
    expect(channel.syncStatus).toBe("queued");
    expect(world.recorded.syncs).toHaveLength(1);
    expect(world.recorded.avatars).toEqual([
      { workspaceId: wsA, channelId: channel.id, regenerateAll: false },
    ]);
    // Contract output schema accepts the result.
    expect(() => channelContracts.connectPublic.output.parse(channel)).not.toThrow();
  });

  it("connectPublic is idempotent for an already-connected channel", async () => {
    const world = makeWorld();
    const input = channelContracts.connectPublic.input.parse({
      workspaceId: wsA,
      urlOrHandle: "@deepdivecasey",
    });
    const first = await world.channel.connectPublic({ ctx: ctxA, input });
    const second = await world.channel.connectPublic({ ctx: ctxA, input });
    expect(second.id).toBe(first.id);
    expect(await world.channel.list({ ctx: ctxA, input: { workspaceId: wsA } })).toHaveLength(1);
    expect(world.recorded.syncs).toHaveLength(1); // no duplicate sync queued
  });

  it("connectPublic rejects garbage input with BAD_REQUEST", async () => {
    const world = makeWorld();
    const input = channelContracts.connectPublic.input.parse({
      workspaceId: wsA,
      urlOrHandle: "https://example.com/notyoutube",
    });
    await expect(world.channel.connectPublic({ ctx: ctxA, input })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("get returns the channel with its latest snapshot; sync re-queues", async () => {
    const world = makeWorld();
    const channel = await seedChannelIn(world.store);
    await world.store.insertSnapshot({
      workspaceId: wsA,
      channelId: channel.id,
      capturedAt: new Date(),
      subs: 10,
      totalViews: 100,
      medianViews90d: 5,
    });

    const got = await world.channel.get({
      ctx: ctxA,
      input: channelContracts.get.input.parse({ workspaceId: wsA, channelId: channel.id }),
    });
    expect(got.latestSnapshot?.subs).toBe(10);

    const accepted = await world.channel.sync({
      ctx: ctxA,
      input: channelContracts.sync.input.parse({ workspaceId: wsA, channelId: channel.id }),
    });
    expect(accepted.status).toBe("queued");
    expect(accepted.pipelineRunIds).toHaveLength(1);
    expect((await world.store.get(wsA, channel.id))?.syncStatus).toBe("queued");
  });

  it("updateNiche and disconnect work inside the workspace", async () => {
    const world = makeWorld();
    const channel = await seedChannelIn(world.store);
    const updated = await world.channel.updateNiche({
      ctx: ctxA,
      input: channelContracts.updateNiche.input.parse({
        workspaceId: wsA,
        channelId: channel.id,
        nicheKeywords: ["latte art"],
      }),
    });
    expect(updated.nicheKeywords).toEqual(["latte art"]);

    const removed = await world.channel.disconnect({
      ctx: ctxA,
      input: channelContracts.disconnect.input.parse({ workspaceId: wsA, channelId: channel.id }),
    });
    expect(removed).toEqual({ removed: true });
    expect(await world.store.get(wsA, channel.id)).toBeNull();
  });
});

describe("cross-workspace access is rejected in A1 handlers", () => {
  it("channel get/sync/updateNiche/disconnect behave as NOT_FOUND for foreign channels", async () => {
    const world = makeWorld();
    const victim = await seedChannelIn(world.store, wsA);

    const cases = [
      () =>
        world.channel.get({
          ctx: ctxB,
          input: channelContracts.get.input.parse({ workspaceId: wsB, channelId: victim.id }),
        }),
      () =>
        world.channel.sync({
          ctx: ctxB,
          input: channelContracts.sync.input.parse({ workspaceId: wsB, channelId: victim.id }),
        }),
      () =>
        world.channel.updateNiche({
          ctx: ctxB,
          input: channelContracts.updateNiche.input.parse({
            workspaceId: wsB,
            channelId: victim.id,
            nicheKeywords: ["hijacked"],
          }),
        }),
      () =>
        world.channel.disconnect({
          ctx: ctxB,
          input: channelContracts.disconnect.input.parse({
            workspaceId: wsB,
            channelId: victim.id,
          }),
        }),
    ];
    for (const attack of cases) {
      await expect(attack()).rejects.toSatisfy(
        (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND",
      );
    }

    // Nothing changed and nothing was queued for the victim.
    const intact = await world.store.get(wsA, victim.id);
    expect(intact).not.toBeNull();
    expect(intact?.nicheKeywords).toEqual(["home espresso"]);
    expect(world.recorded.syncs).toHaveLength(0);

    // list from workspace B never leaks workspace A's channels.
    expect(await world.channel.list({ ctx: ctxB, input: { workspaceId: wsB } })).toEqual([]);
  });

  it("avatar get/update/regenerate behave as NOT_FOUND for foreign channels", async () => {
    const world = makeWorld();
    const victim = await seedChannelIn(world.store, wsA);
    await world.store.upsert(wsA, victim.id, { ageRange: "25-34" }, { lastEditedBy: userA });

    await expect(
      world.avatar.get({
        ctx: ctxB,
        input: avatarContracts.get.input.parse({ workspaceId: wsB, channelId: victim.id }),
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND");

    await expect(
      world.avatar.update({
        ctx: ctxB,
        input: avatarContracts.update.input.parse({
          workspaceId: wsB,
          channelId: victim.id,
          fields: { ageRange: "hijacked" },
        }),
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND");

    await expect(
      world.avatar.regenerate({
        ctx: ctxB,
        input: avatarContracts.regenerate.input.parse({
          workspaceId: wsB,
          channelId: victim.id,
          regenerateAll: true,
        }),
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND");

    const intact = await world.store.getAvatar(wsA, victim.id);
    expect(intact?.ageRange).toBe("25-34");
    expect(world.recorded.avatars).toHaveLength(0);
  });
});

describe("avatar handlers — field-level update semantics", () => {
  it("writes only the provided fields and stamps last_edited_by", async () => {
    const world = makeWorld();
    const channel = await seedChannelIn(world.store);
    await world.store.upsert(
      wsA,
      channel.id,
      { ageRange: "25-34", vocabularyNotes: "AI words" },
      { aiGeneratedAt: new Date() },
    );

    const avatar = await world.avatar.update({
      ctx: ctxA,
      input: avatarContracts.update.input.parse({
        workspaceId: wsA,
        channelId: channel.id,
        fields: { vocabularyNotes: "My words", genderSplit: null },
      }),
    });

    expect(avatar.vocabularyNotes).toBe("My words"); // provided → replaced
    expect(avatar.ageRange).toBe("25-34"); // absent → untouched
    expect(avatar.genderSplit).toBeNull(); // explicit null → cleared
    expect(avatar.lastEditedBy).toBe(userA);
    expect(() => avatarContracts.update.output.parse(avatar)).not.toThrow();
  });

  it("creates the avatar row on first update and regenerate queues the job", async () => {
    const world = makeWorld();
    const channel = await seedChannelIn(world.store);

    const created = await world.avatar.update({
      ctx: ctxA,
      input: avatarContracts.update.input.parse({
        workspaceId: wsA,
        channelId: channel.id,
        fields: { ageRange: "35-44" },
      }),
    });
    expect(created.ageRange).toBe("35-44");
    expect(created.lastEditedBy).toBe(userA);

    const accepted = await world.avatar.regenerate({
      ctx: ctxA,
      input: avatarContracts.regenerate.input.parse({
        workspaceId: wsA,
        channelId: channel.id,
        regenerateAll: true,
      }),
    });
    expect(accepted.status).toBe("queued");
    expect(world.recorded.avatars).toEqual([
      { workspaceId: wsA, channelId: channel.id, regenerateAll: true },
    ]);
  });
});

describe("oauth connect (server/channel/oauth.ts)", () => {
  it("stores only an encrypted token and queues sync + avatar", async () => {
    const world = makeWorld();
    const secretToken = "1//refresh-token-plaintext";
    const channel = await connectOauthChannel(world.deps, world.enqueuer, {
      workspaceId: wsA,
      channelIdOrHandle: "@deepdivecasey",
      refreshToken: secretToken,
      nicheKeywords: ["home espresso"],
    });

    expect(channel.mode).toBe("oauth");
    expect(channel.syncStatus).toBe("queued");
    const stored = world.store.getStoredToken(channel.id);
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error("unreachable");
    expect(stored).not.toContain(secretToken);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptRefreshToken(stored)).toBe(secretToken);
    expect(world.recorded.syncs).toHaveLength(1);
    expect(world.recorded.avatars).toHaveLength(1);
  });
});
