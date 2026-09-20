import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { hasDb } from "@/db";
import { logger } from "@/lib/logger";
import type { channelContracts } from "@/lib/types/api";
import type { AudienceAvatar, Channel, ChannelStatsSnapshot } from "@/lib/types/entities";
import type { Role } from "@/lib/types/enums";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import type { JobAccepted } from "@/lib/types/api";
import {
  DEMO_AVATAR_FIELDS,
  DEMO_CHANNEL,
  DEMO_NICHE_VIDEOS,
  DEMO_SNAPSHOT,
  DEMO_OWN_VIDEO_STATS,
} from "@/lib/fixtures/demo";
import { assertChannelLimit, getBillingStore } from "@/server/billing";
import { getChannelDomainDeps, type ChannelDomainDeps } from "@/server/channel/deps";
import { getDefaultSyncEnqueuer, type SyncEnqueuer } from "@/server/channel/jobs";
import { InvalidChannelRefError, parseChannelRef } from "@/server/channel/parse";
import { getIdeationStore, type IdeationStore } from "@/pipelines/ideation/store";
import { getEngineStore, InMemoryEngineStore } from "@/pipelines/script/store";
import { QuotaExceededError } from "@/pipelines/sync/quota";
import { buildIntelOverview, type IntelOverview } from "@/lib/intel/stats";

/**
 * REAL channel router handlers (A1) — implement the frozen contracts in
 * lib/types/api.ts channelContracts behind unchanged signatures.
 *
 * INTEGRATOR WIRING (A0): in server/routers/_contracts.ts, replace each
 * channelRouter stub BODY with the matching handler here, e.g.
 *   .query(({ ctx, input }) => channelHandlers.list({ ctx, input }))
 * The workspaceProcedure middleware has already enforced assertAccess; these
 * handlers additionally re-filter EVERY data access by workspace_id, so an
 * ID belonging to another workspace behaves exactly like a missing row
 * (NOT_FOUND — tenancy is not probeable).
 */

export interface WorkspaceHandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
  role?: Role;
  userEmail?: string | null;
  session?: { user?: { email?: string | null } } | null;
}

type In<K extends keyof typeof channelContracts> = z.output<(typeof channelContracts)[K]["input"]>;

/** Enough snapshots for a 30-day delta at one sync per night, with slack. */
const INTEL_SNAPSHOT_LIMIT = 60;

export interface ChannelHandlerDeps {
  getDeps(): Promise<ChannelDomainDeps>;
  getEnqueuer(): SyncEnqueuer;
  /**
   * niche_videos store for seeding the demo channel's outlier index. Optional
   * — defaults to the shared ideation store (tests may omit it).
   */
  getIdeationStore?(): IdeationStore;
  /**
   * Mirror a freshly-seeded demo avatar into the script engine's avatar view
   * so avatar-in-context (generation) sees it. In DB mode the engine store
   * reads the same audience_avatars row the avatar repo wrote, so this is a
   * no-op; in keyless fixture mode the engine store is a SEPARATE in-memory
   * store, so we push the avatar into it. Demo-only, additive. Optional —
   * defaults to the shared engine store.
   */
  seedEngineAvatar?(avatar: AudienceAvatar): void;
  /** Clock for Intel derivations (deterministic in tests). Defaults to Date. */
  now?(): Date;
}

function defaultSeedEngineAvatar(avatar: AudienceAvatar): void {
  if (hasDb()) return;
  const store = getEngineStore();
  if (store instanceof InMemoryEngineStore) store.seedAvatar(avatar);
}

const defaultHandlerDeps: ChannelHandlerDeps = {
  getDeps: getChannelDomainDeps,
  getEnqueuer: getDefaultSyncEnqueuer,
  getIdeationStore,
  seedEngineAvatar: defaultSeedEngineAvatar,
};

function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
}

export function createChannelHandlers(handlerDeps: ChannelHandlerDeps = defaultHandlerDeps) {
  return {
    async list(opts: { ctx: WorkspaceHandlerCtx; input: In<"list"> }): Promise<Channel[]> {
      const { channelRepo } = await handlerDeps.getDeps();
      return channelRepo.list(opts.ctx.workspaceId);
    },

    async get(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"get">;
    }): Promise<Channel & { latestSnapshot: ChannelStatsSnapshot | null }> {
      const { channelRepo } = await handlerDeps.getDeps();
      const channel = await channelRepo.get(opts.ctx.workspaceId, opts.input.channelId);
      if (channel === null) throw notFound();
      const latestSnapshot = await channelRepo.latestSnapshot(
        opts.ctx.workspaceId,
        opts.input.channelId,
      );
      return { ...channel, latestSnapshot };
    },

    async stats(opts: { ctx: WorkspaceHandlerCtx; input: In<"stats"> }): Promise<IntelOverview> {
      const { channelRepo } = await handlerDeps.getDeps();
      const ws = opts.ctx.workspaceId;
      const channel = await channelRepo.get(ws, opts.input.channelId);
      if (channel === null) throw notFound();
      const [videos, snapshots] = await Promise.all([
        channelRepo.listChannelVideos(ws, channel.id),
        channelRepo.listSnapshots(ws, channel.id, INTEL_SNAPSHOT_LIMIT),
      ]);
      return buildIntelOverview({
        channel,
        videos,
        snapshots,
        now: handlerDeps.now?.() ?? new Date(),
      });
    },

    async connectPublic(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"connectPublic">;
    }): Promise<Channel> {
      const { channelRepo, providers, quota } = await handlerDeps.getDeps();

      let ref;
      try {
        ref = parseChannelRef(opts.input.urlOrHandle);
      } catch (err) {
        if (err instanceof InvalidChannelRefError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That doesn't look like a YouTube channel URL, handle, or channel ID",
          });
        }
        throw err;
      }

      let yt;
      try {
        await quota.charge("channels.list");
        yt = await providers.youtube.getChannel(ref.value);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Daily YouTube quota is exhausted — try again tomorrow",
          });
        }
        logger.warn(
          { ref: ref.value, err: err instanceof Error ? err.message : String(err) },
          "channel lookup failed",
        );
        throw new TRPCError({ code: "NOT_FOUND", message: "YouTube channel not found" });
      }

      const existing = await channelRepo.findByYoutubeId(opts.ctx.workspaceId, yt.youtubeChannelId);
      if (existing !== null) {
        // Idempotent connect: refresh metadata, apply any provided niche.
        const updated = await channelRepo.update(opts.ctx.workspaceId, existing.id, {
          title: yt.title,
          handle: yt.handle,
          ...(opts.input.nicheKeywords.length > 0
            ? { nicheKeywords: opts.input.nicheKeywords }
            : {}),
        });
        return updated ?? existing;
      }

      // Tier limit (spec §7) — checked only for genuinely NEW channels, so
      // an idempotent reconnect above is never blocked by the cap.
      const plan = (await getBillingStore().getWorkspace(opts.ctx.workspaceId))?.plan ?? "free";
      const currentChannels = await channelRepo.list(opts.ctx.workspaceId);
      assertChannelLimit(plan, currentChannels.length);

      const created = await channelRepo.create({
        workspaceId: opts.ctx.workspaceId,
        mode: "public",
        youtubeChannelId: yt.youtubeChannelId,
        title: yt.title,
        handle: yt.handle,
        nicheKeywords: opts.input.nicheKeywords,
        oauthRefreshTokenEnc: null,
      });
      await channelRepo.update(opts.ctx.workspaceId, created.id, { syncStatus: "queued" });

      // On-connect triggers: first sync + first avatar generation (spec §5.1/§5.2).
      const enqueuer = handlerDeps.getEnqueuer();
      await enqueuer.enqueueChannelSync({
        workspaceId: opts.ctx.workspaceId,
        channelId: created.id,
      });
      await enqueuer.enqueueAvatarGenerate({
        workspaceId: opts.ctx.workspaceId,
        channelId: created.id,
        regenerateAll: false,
      });

      const fresh = await channelRepo.get(opts.ctx.workspaceId, created.id);
      return fresh ?? created;
    },

    /**
     * connectDemo (playtest affordance): idempotently seed a rich, synthetic
     * demo channel into the CURRENT workspace — channel row (mode "demo"),
     * populated audience avatar, a set of niche outliers, and (via the train
     * fallback) own-video transcripts. Pure seeding: no provider/API call, no
     * credits, no quota, no keys — so it behaves identically in fixture and
     * live mode. Everything downstream (Discovery, avatar, voice training,
     * generation, packaging, thumbnails) lights up on the seeded data.
     */
    async connectDemo(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"connectDemo">;
    }): Promise<Channel> {
      const { channelRepo, avatarRepo } = await handlerDeps.getDeps();
      const ws = opts.ctx.workspaceId;

      // Idempotent: reuse the existing demo channel (find-or-create keyed on
      // the stable synthetic youtube id) — connecting twice never duplicates.
      const existing = await channelRepo.findByYoutubeId(ws, DEMO_CHANNEL.youtubeChannelId);
      let channel = existing;
      const isNew = existing === null;
      if (channel === null) {
        const created = await channelRepo.create({
          workspaceId: ws,
          mode: "demo",
          youtubeChannelId: DEMO_CHANNEL.youtubeChannelId,
          title: DEMO_CHANNEL.title,
          handle: DEMO_CHANNEL.handle,
          nicheKeywords: [...DEMO_CHANNEL.nicheKeywords],
          oauthRefreshTokenEnc: null,
        });
        // Present as fully connected: the demo is pre-"synced" seeded data.
        channel =
          (await channelRepo.update(ws, created.id, {
            syncStatus: "synced",
            lastSyncedAt: new Date(),
          })) ?? created;
        await channelRepo.insertSnapshot({
          workspaceId: ws,
          channelId: channel.id,
          capturedAt: new Date(),
          subs: DEMO_SNAPSHOT.subs,
          totalViews: DEMO_SNAPSHOT.totalViews,
          medianViews90d: DEMO_SNAPSHOT.medianViews90d,
        });
      }

      // The demo's own uploads with stats — Intel's own-channel dashboard.
      // Upsert is idempotent on (channel, video).
      await channelRepo.upsertChannelVideos(ws, channel.id, DEMO_OWN_VIDEO_STATS, new Date());

      // Audience avatar — upsert is idempotent on (workspace, channel).
      const avatar = await avatarRepo.upsert(ws, channel.id, DEMO_AVATAR_FIELDS, {
        aiGeneratedAt: new Date(),
        lastEditedBy: null,
      });
      // On first connect, mirror into the engine store so avatar-in-context
      // (generation) sees it in keyless fixture mode (no-op in DB mode).
      if (isNew) (handlerDeps.seedEngineAvatar ?? defaultSeedEngineAvatar)(avatar);

      // Niche outlier index for Discovery/enrichment. upsertNicheVideos is
      // idempotent on youtube_video_id; niche_videos is a GLOBAL index by
      // design (spec §8), so this is a plain upsert, not workspace-scoped.
      const ideationStore = handlerDeps.getIdeationStore?.() ?? getIdeationStore();
      await ideationStore.upsertNicheVideos(DEMO_NICHE_VIDEOS);

      const fresh = await channelRepo.get(ws, channel.id);
      return fresh ?? channel;
    },

    async sync(opts: { ctx: WorkspaceHandlerCtx; input: In<"sync"> }): Promise<JobAccepted> {
      const { channelRepo } = await handlerDeps.getDeps();
      const channel = await channelRepo.get(opts.ctx.workspaceId, opts.input.channelId);
      if (channel === null) throw notFound();
      await channelRepo.update(opts.ctx.workspaceId, opts.input.channelId, {
        syncStatus: "queued",
      });
      const jobId = await handlerDeps.getEnqueuer().enqueueChannelSync({
        workspaceId: opts.ctx.workspaceId,
        channelId: opts.input.channelId,
      });
      return { pipelineRunIds: [jobId], status: "queued" };
    },

    async updateNiche(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"updateNiche">;
    }): Promise<Channel> {
      const { channelRepo } = await handlerDeps.getDeps();
      const updated = await channelRepo.update(opts.ctx.workspaceId, opts.input.channelId, {
        nicheKeywords: opts.input.nicheKeywords,
      });
      if (updated === null) throw notFound();
      return updated;
    },

    async disconnect(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"disconnect">;
    }): Promise<{ removed: boolean }> {
      const { channelRepo } = await handlerDeps.getDeps();
      const removed = await channelRepo.remove(opts.ctx.workspaceId, opts.input.channelId);
      if (!removed) throw notFound();
      return { removed };
    },
  };
}

/** Handlers keyed by the exact contract procedure names. */
export const channelHandlers = createChannelHandlers();
