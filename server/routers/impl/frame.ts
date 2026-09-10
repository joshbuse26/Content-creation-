import type { z } from "zod";
import type { frameContracts } from "@/lib/types/api";
import type { Frame } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { handleProposeFramesJob } from "@/pipelines/script/jobs";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { jobAccepted, notFound, type HandlerOpts } from "./_shared";

type ListInput = z.output<typeof frameContracts.list.input>;
type ProposeInput = z.output<typeof frameContracts.propose.input>;
type ChooseInput = z.output<typeof frameContracts.choose.input>;
type UpdateInput = z.output<typeof frameContracts.update.input>;

/** frame router — build spec §5.6 / §6. */
export const frameImpl = {
  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<Frame[]> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    return deps.store.listFrames(ctx.workspaceId, input.projectId);
  },

  /** Proposes 4 divergent frames from idea + research + avatar. */
  async propose({ ctx, input }: HandlerOpts<ProposeInput>) {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const payload = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: ctx.userId as string,
    };
    await dispatchPipelineJob(QUEUE_NAMES.script, JOB_NAMES.proposeFrames, payload, () =>
      handleProposeFramesJob(payload),
    );
    return jobAccepted();
  },

  async choose({ ctx, input }: HandlerOpts<ChooseInput>): Promise<Frame> {
    const deps = await getEngineDeps();
    const frame = await deps.store.chooseFrame(ctx.workspaceId, input.frameId);
    if (frame === null) notFound("frame");
    await deps.store.updateProjectStatus(ctx.workspaceId, frame.projectId, "scripting");
    return frame;
  },

  async update({ ctx, input }: HandlerOpts<UpdateInput>): Promise<Frame> {
    const deps = await getEngineDeps();
    const frame = await deps.store.updateFrame(ctx.workspaceId, input.frameId, input.fields);
    if (frame === null) notFound("frame");
    return frame;
  },
} as const;
