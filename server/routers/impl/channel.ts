import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { logger } from "@/lib/logger";
import type { channelContracts } from "@/lib/types/api";
import type { Channel, ChannelStatsSnapshot } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import type { JobAccepted } from "@/lib/types/api";
import { getChannelDomainDeps, type ChannelDomainDeps } from "@/server/channel/deps";
import { getDefaultSyncEnqueuer, type SyncEnqueuer } from "@/server/channel/jobs";
import { InvalidChannelRefError, parseChannelRef } from "@/server/channel/parse";
import { QuotaExceededError } from "@/pipelines/sync/quota";

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
}

type In<K extends keyof typeof channelContracts> = z.output<(typeof channelContracts)[K]["input"]>;

export interface ChannelHandlerDeps {
  getDeps(): Promise<ChannelDomainDeps>;
  getEnqueuer(): SyncEnqueuer;
}

const defaultHandlerDeps: ChannelHandlerDeps = {
  getDeps: getChannelDomainDeps,
  getEnqueuer: getDefaultSyncEnqueuer,
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
