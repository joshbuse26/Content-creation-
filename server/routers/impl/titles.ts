import type { z } from "zod";
import type { titlesContracts } from "@/lib/types/api";
import type { TitleSet } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { handleTitlesJob } from "@/pipelines/script/jobs";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS, exemptionFromCtx, isCtxCreditExempt } from "@/server/credits";
import { jobAccepted, notFound, type HandlerOpts } from "./_shared";

type GenerateInput = z.output<typeof titlesContracts.generate.input>;
type LatestInput = z.output<typeof titlesContracts.latest.input>;

/** titles router — build spec §5.9 / §6. */
export const titlesImpl = {
  /** 25 titles across ≥5 pattern families, Haiku-scored. 1 credit. */
  async generate({ ctx, input }: HandlerOpts<GenerateInput>) {
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.titles, exemptionFromCtx(ctx));
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const payload = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: ctx.userId as string,
      creditExempt: isCtxCreditExempt(ctx),
    };
    await dispatchPipelineJob(QUEUE_NAMES.packaging, JOB_NAMES.titles, payload, () =>
      handleTitlesJob(payload),
    );
    return jobAccepted();
  },

  async latest({ ctx, input }: HandlerOpts<LatestInput>): Promise<TitleSet | null> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    return deps.store.latestTitleSet(ctx.workspaceId, input.projectId);
  },
} as const;
