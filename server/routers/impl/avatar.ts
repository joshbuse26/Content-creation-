import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { avatarContracts, JobAccepted } from "@/lib/types/api";
import type { AudienceAvatar } from "@/lib/types/entities";
import { getChannelDomainDeps, type ChannelDomainDeps } from "@/server/channel/deps";
import { getDefaultSyncEnqueuer, type SyncEnqueuer } from "@/server/channel/jobs";
import { CREDIT_COSTS, requireCredits } from "@/server/credits";
import type { AvatarFieldsPatch } from "@/server/channel/repo";
import type { WorkspaceHandlerCtx } from "./channel";

/**
 * REAL avatar router handlers (A1) — implement the frozen contracts in
 * lib/types/api.ts avatarContracts behind unchanged signatures.
 *
 * INTEGRATOR WIRING (A0): replace the avatarRouter stub bodies in
 * server/routers/_contracts.ts with these handlers (same pattern as
 * impl/channel.ts). Every access re-filters by workspace_id; a channel in
 * another workspace is indistinguishable from a missing one.
 *
 * Editable-fields semantics (spec §5.2): `update` writes exactly the fields
 * the user sent and stamps last_edited_by; regeneration (pipelines/avatar)
 * then only fills empty fields unless the user asked to regenerate all.
 */

type In<K extends keyof typeof avatarContracts> = z.output<(typeof avatarContracts)[K]["input"]>;

export interface AvatarHandlerDeps {
  getDeps(): Promise<ChannelDomainDeps>;
  getEnqueuer(): SyncEnqueuer;
}

const defaultHandlerDeps: AvatarHandlerDeps = {
  getDeps: getChannelDomainDeps,
  getEnqueuer: getDefaultSyncEnqueuer,
};

function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
}

export function createAvatarHandlers(handlerDeps: AvatarHandlerDeps = defaultHandlerDeps) {
  return {
    async get(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"get">;
    }): Promise<AudienceAvatar | null> {
      const { channelRepo, avatarRepo } = await handlerDeps.getDeps();
      const channel = await channelRepo.get(opts.ctx.workspaceId, opts.input.channelId);
      if (channel === null) throw notFound();
      return avatarRepo.get(opts.ctx.workspaceId, opts.input.channelId);
    },

    async update(opts: { ctx: WorkspaceHandlerCtx; input: In<"update"> }): Promise<AudienceAvatar> {
      const { channelRepo, avatarRepo } = await handlerDeps.getDeps();
      const channel = await channelRepo.get(opts.ctx.workspaceId, opts.input.channelId);
      if (channel === null) throw notFound();

      // Field-level update: only keys the user actually sent are written;
      // an explicit null clears a field. Absent keys stay untouched.
      const f = opts.input.fields;
      const fields: AvatarFieldsPatch = {
        ...(f.ageRange !== undefined ? { ageRange: f.ageRange } : {}),
        ...(f.genderSplit !== undefined ? { genderSplit: f.genderSplit } : {}),
        ...(f.geo !== undefined ? { geo: f.geo } : {}),
        ...(f.sophistication !== undefined ? { sophistication: f.sophistication } : {}),
        ...(f.pains !== undefined ? { pains: f.pains } : {}),
        ...(f.motivations !== undefined ? { motivations: f.motivations } : {}),
        ...(f.vocabularyNotes !== undefined ? { vocabularyNotes: f.vocabularyNotes } : {}),
      };

      // User edits win from now on (spec §5.2) — stamp last_edited_by.
      return avatarRepo.upsert(opts.ctx.workspaceId, opts.input.channelId, fields, {
        lastEditedBy: opts.ctx.userId,
      });
    },

    async regenerate(opts: {
      ctx: WorkspaceHandlerCtx;
      input: In<"regenerate">;
    }): Promise<JobAccepted> {
      // 1 credit per user-triggered regeneration, gated at dispatch and
      // charged (idempotently) on completion by the avatar pipeline.
      await requireCredits(opts.ctx.workspaceId, CREDIT_COSTS.avatarRegen);
      const { channelRepo } = await handlerDeps.getDeps();
      const channel = await channelRepo.get(opts.ctx.workspaceId, opts.input.channelId);
      if (channel === null) throw notFound();
      const jobId = await handlerDeps.getEnqueuer().enqueueAvatarGenerate({
        workspaceId: opts.ctx.workspaceId,
        channelId: opts.input.channelId,
        regenerateAll: opts.input.regenerateAll,
        chargeCredits: true,
        actorUserId: opts.ctx.userId,
      });
      return { pipelineRunIds: [jobId], status: "queued" };
    },
  };
}

/** Handlers keyed by the exact contract procedure names. */
export const avatarHandlers = createAvatarHandlers();
