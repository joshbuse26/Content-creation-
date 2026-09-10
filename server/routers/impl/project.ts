import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { hasDb } from "@/db";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { projectContracts } from "@/lib/types/api";
import type { Project } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import { DrizzleChannelRepo, getSharedMemoryStore } from "@/server/channel/repo";
import type { ProjectPatch } from "@/pipelines/script/store";
import { assertGenerationTargetAllowed } from "@/server/modes";
import { notFound, type HandlerOpts } from "./_shared";

/**
 * project router implementation — backed by the shared EngineStore (the same
 * store A2's pipelines read), so projects created here are immediately
 * visible to research/frame/script generation in both DB and fixture mode.
 * Channel ownership is verified through A1's channel repo before create.
 */

type ListInput = z.output<typeof projectContracts.list.input>;
type GetInput = z.output<typeof projectContracts.get.input>;
type CreateInput = z.output<typeof projectContracts.create.input>;
type UpdateInput = z.output<typeof projectContracts.update.input>;
type ArchiveInput = z.output<typeof projectContracts.archive.input>;
type SetGenerationTargetInput = z.output<typeof projectContracts.setGenerationTarget.input>;

function channelRepo() {
  return hasDb() ? new DrizzleChannelRepo() : getSharedMemoryStore();
}

export const projectHandlers = {
  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<Project[]> {
    const deps = await getEngineDeps();
    return deps.store.listProjects(ctx.workspaceId, {
      ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      limit: input.limit,
    });
  },

  async get({ ctx, input }: HandlerOpts<GetInput>): Promise<Project> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    return project;
  },

  async create({ ctx, input }: HandlerOpts<CreateInput>): Promise<Project> {
    const channel = await channelRepo().get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    const deps = await getEngineDeps();
    return deps.store.createProject({
      workspaceId: ctx.workspaceId,
      channelId: input.channelId,
      title: input.title,
      ideaId: input.ideaId,
    });
  },

  async update({ ctx, input }: HandlerOpts<UpdateInput>): Promise<Project> {
    const deps = await getEngineDeps();
    const patch: ProjectPatch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.targetPublishDate !== undefined
        ? { targetPublishDate: input.targetPublishDate }
        : {}),
      ...(input.publishedVideoId !== undefined ? { publishedVideoId: input.publishedVideoId } : {}),
    };
    const project = await deps.store.updateProject(ctx.workspaceId, input.projectId, patch);
    if (project === null) notFound("project");
    return project;
  },

  /**
   * Persist the project's generation target pre-draft (wave-C additive,
   * REQUESTS-C2 #1). Mode availability enforced like the staged script
   * procedures; archetype ids are validated against the seed catalog so a
   * bad id never lands in a row. `generation: null` clears the target.
   */
  async setGenerationTarget({
    ctx,
    input,
  }: HandlerOpts<SetGenerationTargetInput>): Promise<Project> {
    const generation = input.generation;
    assertGenerationTargetAllowed(generation);
    const archetypeIds =
      generation === null
        ? []
        : generation.mode === "archetype" && generation.archetypeId !== null
          ? [generation.archetypeId]
          : generation.mode === "crossover" && generation.crossover !== null
            ? [generation.crossover.a, generation.crossover.b]
            : [];
    for (const id of archetypeIds) {
      if (getArchetypeSeed(id) === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "archetype not found" });
      }
    }
    const patch: ProjectPatch =
      generation === null
        ? { generationMode: null, archetypeId: null, crossover: null, partnerId: null }
        : {
            generationMode: generation.mode,
            archetypeId: generation.archetypeId,
            crossover: generation.crossover,
            partnerId: generation.partnerId,
          };
    const deps = await getEngineDeps();
    const project = await deps.store.updateProject(ctx.workspaceId, input.projectId, patch);
    if (project === null) notFound("project");
    return project;
  },

  /** Hard delete — the schema has no soft-delete for projects; child rows cascade. */
  async archive({ ctx, input }: HandlerOpts<ArchiveInput>): Promise<{ archived: boolean }> {
    const deps = await getEngineDeps();
    const archived = await deps.store.deleteProject(ctx.workspaceId, input.projectId);
    return { archived };
  },
} as const;
