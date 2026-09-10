import { z } from "zod";
import { getProviders } from "@/lib/providers";
import { descriptionModeSchema } from "@/lib/types/enums";
import { projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { JOB_NAMES } from "@/queue/queues";
import { deriveChapters } from "./chapters";
import { loadPackagingContext } from "./context";
import { generateDescriptionBody } from "./descriptions";
import {
  findDescriptionTemplate,
  insertChapterSet,
  insertDescription,
  insertTagSet,
} from "./persist";
import { generateTagList } from "./tags";

/**
 * Packaging queue job handlers — spec §5.11, PACKAGING_STAGES
 * ("description" | "tags" | "chapters"). The tRPC impl handlers run the same
 * core functions synchronously (the contracts return entities, not job
 * acks); these handlers exist for worker-side / batch execution on the
 * frozen `packaging` queue.
 *
 * Integrator wiring (worker/index.ts, packaging queue switch):
 *
 *   case JOB_NAMES.description:
 *   case JOB_NAMES.tags:
 *   case JOB_NAMES.chapters:
 *     await handlePackagingJob(job.name, job.data);
 *     return;
 */

export const packagingJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  /** description jobs only. */
  mode: descriptionModeSchema.default("informative"),
  /** description jobs only. */
  templateId: z.uuid().nullable().default(null),
});
export type PackagingJobInput = z.infer<typeof packagingJobInputSchema>;

export type PackagingJobName =
  typeof JOB_NAMES.description | typeof JOB_NAMES.tags | typeof JOB_NAMES.chapters;

export async function handlePackagingJob(name: string, data: unknown): Promise<void> {
  const input = packagingJobInputSchema.parse(data);
  const ctx = await loadPackagingContext(input.workspaceId, input.projectId);

  switch (name) {
    case JOB_NAMES.description: {
      const { llm } = await getProviders();
      const template =
        input.templateId === null
          ? null
          : await findDescriptionTemplate(input.workspaceId, input.templateId);
      const body = await generateDescriptionBody(llm, ctx, input.mode, template);
      await insertDescription({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        mode: input.mode,
        body,
        templateId: input.templateId,
      });
      return;
    }
    case JOB_NAMES.tags: {
      const { llm } = await getProviders();
      const tags = await generateTagList(llm, ctx);
      await insertTagSet({ workspaceId: input.workspaceId, projectId: input.projectId, tags });
      return;
    }
    case JOB_NAMES.chapters: {
      const entries = deriveChapters(ctx.sections);
      await insertChapterSet({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        entries,
      });
      return;
    }
    default:
      throw new Error(`handlePackagingJob: unknown packaging job "${name}"`);
  }
}
