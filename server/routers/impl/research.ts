import type { z } from "zod";
import type { researchContracts } from "@/lib/types/api";
import type { ResearchDoc } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { handleResearchJob } from "@/pipelines/script/jobs";
import { importTranscript, TranscriptImportError } from "@/pipelines/research/transcript";
import { saveUpload, UploadCapError } from "@/pipelines/research/upload";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { CREDIT_COSTS, requireCredits } from "@/server/credits";
import { badRequest, jobAccepted, notFound, type HandlerOpts } from "./_shared";

type ListInput = z.output<typeof researchContracts.list.input>;
type GetInput = z.output<typeof researchContracts.get.input>;
type SearchInput = z.output<typeof researchContracts.search.input>;
type ImportTranscriptInput = z.output<typeof researchContracts.importTranscript.input>;
type UploadInput = z.output<typeof researchContracts.upload.input>;
type RemoveInput = z.output<typeof researchContracts.remove.input>;

function withoutContent(doc: ResearchDoc): Omit<ResearchDoc, "content"> {
  const { content: _content, ...meta } = doc;
  return meta;
}

/** research router — build spec §5.5 / §6. */
export const researchImpl = {
  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<Omit<ResearchDoc, "content">[]> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const docs = await deps.store.listResearchDocs(ctx.workspaceId, input.projectId);
    return docs.map(withoutContent);
  },

  async get({ ctx, input }: HandlerOpts<GetInput>): Promise<ResearchDoc> {
    const deps = await getEngineDeps();
    const doc = await deps.store.getResearchDoc(ctx.workspaceId, input.researchDocId);
    if (doc === null) notFound("research document");
    return doc;
  },

  /** Kicks off the research agent. 1 credit, charged on completion. */
  async search({ ctx, input }: HandlerOpts<SearchInput>) {
    await requireCredits(ctx.workspaceId, CREDIT_COSTS.researchRun);
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    await deps.store.updateProjectStatus(ctx.workspaceId, input.projectId, "researching");
    const payload = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      query: input.query,
      actorUserId: ctx.userId as string,
    };
    await dispatchPipelineJob(QUEUE_NAMES.script, JOB_NAMES.research, payload, () =>
      handleResearchJob(payload),
    );
    return jobAccepted();
  },

  async importTranscript({ ctx, input }: HandlerOpts<ImportTranscriptInput>): Promise<ResearchDoc> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    try {
      return await importTranscript(deps, {
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        youtubeVideoUrl: input.youtubeVideoUrl,
      });
    } catch (err) {
      if (err instanceof TranscriptImportError) badRequest(err.message);
      throw err;
    }
  },

  async upload({ ctx, input }: HandlerOpts<UploadInput>): Promise<ResearchDoc> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    try {
      return await saveUpload(deps, {
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        filename: input.filename,
        kind: input.kind,
        content: input.content,
      });
    } catch (err) {
      if (err instanceof UploadCapError) badRequest(err.message);
      throw err;
    }
  },

  async remove({ ctx, input }: HandlerOpts<RemoveInput>): Promise<{ removed: boolean }> {
    const deps = await getEngineDeps();
    const removed = await deps.store.removeResearchDoc(ctx.workspaceId, input.researchDocId);
    if (!removed) notFound("research document");
    return { removed };
  },
} as const;
