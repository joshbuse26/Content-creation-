import { LLM_MODELS } from "@/lib/config";
import type { Frame } from "@/lib/types/entities";
import { FRAME_STAGES, proposedFramesSchema, type FrameJobInput } from "@/lib/types/pipeline";
import { proposeFramesPrompt } from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { EngineDeps } from "./deps";
import { synthFrames } from "./fixture-content";
import { stageInputHash } from "./hash";
import { generateJson } from "./llm-json";
import { summarizeAvatar } from "./context";

/**
 * §5.6 Frame proposals — idea + research + avatar → 4 divergent frames.
 * Runs under pipeline kind "script" (frozen kind enum has no frame member).
 */

export interface FramePipelineParams {
  input: FrameJobInput;
  actorUserId: string | null;
}

export async function runFramePipeline(
  deps: EngineDeps,
  params: FramePipelineParams,
): Promise<{ result: PipelineResult; frames: Frame[] }> {
  const { input } = params;
  let inserted: Frame[] = [];

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "script",
      stages: FRAME_STAGES.map((name) => ({
        name,
        run: async () => {
          const project = await deps.store.getProject(input.workspaceId, input.projectId);
          if (project === null) throw new Error("project not found for frame proposals");
          const [researchDocs, avatar] = await Promise.all([
            deps.store.listResearchDocs(input.workspaceId, input.projectId),
            deps.store.getAvatarForChannel(project.channelId),
          ]);
          const researchSummary =
            researchDocs.length > 0
              ? researchDocs
                  .map((d) => `- ${d.title}: ${d.content.slice(0, 800)}`)
                  .join("\n")
                  .slice(0, 8_000)
              : "(no research attached yet)";
          const keywordPool = [
            ...new Set(researchDocs.flatMap((d) => d.title.toLowerCase().split(/\s+/))),
          ]
            .filter((w) => w.length > 3)
            .slice(0, 6);
          const proposals = await generateJson({
            mode: deps.mode,
            llm: deps.llm,
            model: LLM_MODELS.sonnet,
            template: proposeFramesPrompt({
              projectTitle: project.title,
              ideaAngle: null,
              researchSummary,
              avatarSummary: summarizeAvatar(avatar),
              channelNiche: keywordPool,
            }),
            maxTokens: 3000,
            temperature: 0.8,
            schema: proposedFramesSchema,
            fixture: () => synthFrames({ projectTitle: project.title, keywords: keywordPool }),
          });
          inserted = await deps.store.insertFrames(
            proposals.map((p) => ({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              chosen: false,
              angle: p.angle,
              format: p.format,
              outcome: p.outcome,
              audienceSegment: p.audienceSegment,
              tone: p.tone,
              targetMinutes: p.targetMinutes,
              keywords: p.keywords,
            })),
          );
          await deps.store.updateProjectStatus(input.workspaceId, input.projectId, "framing");
        },
      })),
    },
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      input: params,
      inputHash: stageInputHash(input),
    },
  );

  return { result, frames: inserted };
}
