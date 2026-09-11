import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import { generationTargetColumns } from "@/lib/generation-target";
import type { Channel, Frame, GenerationTarget, StyleCard } from "@/lib/types/entities";
import {
  topicCandidateSchema,
  type HookCandidate,
  type Outline,
  type ScriptContext,
  type TopicCandidate,
} from "@/lib/types/pipeline";
import type { scriptContracts } from "@/lib/types/api";
import { assembleContext } from "@/pipelines/script/context";
import { synthOutline, synthTopicCandidates } from "@/pipelines/script/fixture-content";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { handleGenerateScriptJob } from "@/pipelines/script/jobs";
import { generateJson } from "@/pipelines/script/llm-json";
import { getStageDeps, type StageDeps } from "@/pipelines/stages/deps";
import { generateHookCandidates } from "@/pipelines/stages/hooks";
import { generateOutline } from "@/pipelines/stages/outline";
import { runMeteredSyncStage } from "@/pipelines/stages/run";
import { resolveStyleCard, resolveTrainedVoiceProfile } from "@/pipelines/stages/style-resolver";
import { topicsPrompt } from "@/prompts";
import { requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS, exemptionFromCtx, isCtxCreditExempt } from "@/server/credits";
import { assertGenerationTargetAllowed, assertLicensedVoiceUsable } from "@/server/modes";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import {
  badRequest,
  jobAccepted,
  notFound,
  type HandlerOpts,
  type WorkspaceHandlerCtx,
} from "./_shared";

type TopicsInput = z.output<typeof scriptContracts.topics.input>;
type OutlineInput = z.output<typeof scriptContracts.outline.input>;
type HooksInput = z.output<typeof scriptContracts.hooks.input>;
type DraftInput = z.output<typeof scriptContracts.draft.input>;

/**
 * Staged script procedures (PRODUCT-CONTRACTS §4) — wave-C C1, the real
 * staged pipeline replacing the C0 contract stubs. Every stage:
 *
 *  - mode guard (`assertGenerationTargetAllowed`) then mode → style-card
 *    resolution (pipelines/stages/style-resolver.ts: archetype seed card,
 *    deterministic crossover merge, enabled-partner card, or the LEGACY
 *    null-generation voice-profile path, unchanged);
 *  - `requireCreditsWithOverage` at dispatch, AFTER tenant-scoped row
 *    validation (a cross-workspace probe gets NOT_FOUND and never charges);
 *  - PipelineRunner execution — every invocation persists pipeline_runs
 *    rows (kind "script", §4 stage names), with per-stage retries, resume,
 *    concurrent-claim protection, and an idempotent completion charge
 *    keyed `<stage>:<input hash>` (reason script_generation, one itemized
 *    entry per stage);
 *  - Grok only ever via the LlmProvider seam; fixture mode is fully
 *    deterministic (pipelines/script/fixture-content.ts synthesizers).
 *
 * `topics`/`outline`/`hooks` return complete results in the response (no
 * SSE); `draft` streams sections over the existing script event bus /
 * /api/script-stream with the frozen ScriptStreamEvent union.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Deterministic seed key for a generation target (fixture synthesizers). */
function generationSeedKey(generation: GenerationTarget | null): string {
  if (generation === null) return "channel-voice";
  switch (generation.mode) {
    case "archetype":
      return generation.archetypeId ?? "archetype";
    case "crossover":
      return generation.crossover === null
        ? "crossover"
        : `${generation.crossover.a}+${generation.crossover.b}@${String(generation.crossover.weightA)}`;
    case "partnered_named":
      return generation.partnerId ?? "partner";
    case "train_on_my_channel":
      return generation.voiceProfileId ?? "own-channel";
  }
}

/** Project-scoped context for outline/hooks/draft, style card resolved. */
async function contextForProject(
  deps: StageDeps,
  ctx: WorkspaceHandlerCtx,
  projectId: OutlineInput["projectId"],
  frameId: OutlineInput["frameId"],
  generation: GenerationTarget | null,
  voiceProfileId: DraftInput["voiceProfileId"] = null,
): Promise<{ context: ScriptContext; frame: Frame }> {
  const store = deps.engine.store;
  const project = await store.getProject(ctx.workspaceId, projectId);
  if (project === null) notFound("project");
  const frames = await store.listFrames(ctx.workspaceId, projectId);
  const frame =
    frameId === null ? frames.find((f) => f.chosen) : frames.find((f) => f.id === frameId);
  if (frame === undefined) notFound("frame");
  const [researchDocs, avatar, voiceProfile] = await Promise.all([
    store.listResearchDocs(ctx.workspaceId, projectId),
    store.getAvatarForChannel(project.channelId),
    voiceProfileId === null
      ? Promise.resolve(null)
      : store.getVoiceProfile(ctx.workspaceId, voiceProfileId),
  ]);
  if (voiceProfileId !== null && voiceProfile === null) notFound("voice profile");
  const base = assembleContext({ frame, researchDocs, avatar, voiceProfile });
  // For train_on_my_channel, resolve against the trained profile the target
  // names (loaded workspace-scoped), not the section-level voice profile.
  const resolutionProfile = await resolveTrainedVoiceProfile(
    store,
    ctx.workspaceId,
    generation,
    voiceProfile,
  );
  const styleCard =
    generation === null
      ? base.styleCard
      : await resolveStyleCard(generation, resolutionProfile, deps.partners);
  return { context: { ...base, styleCard }, frame };
}

/** Chosen topic steers the outline/hook context through the frame angle. */
function steerByTopic(
  context: ScriptContext,
  topic: { title: string; angle: string } | null,
): ScriptContext {
  if (topic === null) return context;
  return {
    ...context,
    frame: { ...context.frame, angle: `${topic.title} — ${topic.angle}` },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const scriptStagesImpl = {
  /**
   * §4 `script.topics` — 1 credit. Channel niche + fresh niche outliers
   * (ideation store, when data exists) + resolved style card → candidates.
   */
  async topics({ ctx, input }: HandlerOpts<TopicsInput>) {
    assertGenerationTargetAllowed(input.generation);
    const deps = await getStageDeps();
    // Channel OWNERSHIP is validated before any charge or channel data use:
    // the repo read is workspace-scoped, so a foreign channel is NOT_FOUND.
    const channel: Channel | null = await deps.channels.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    // train_on_my_channel resolves against the trained profile the target names.
    const resolutionProfile = await resolveTrainedVoiceProfile(
      deps.engine.store,
      ctx.workspaceId,
      input.generation,
      null,
    );
    const styleCard: StyleCard | null = await resolveStyleCard(
      input.generation,
      resolutionProfile,
      deps.partners,
    );
    await requireCreditsWithOverage(
      ctx.workspaceId,
      CREDIT_COSTS.scriptTopics,
      exemptionFromCtx(ctx),
    );

    const outliers =
      channel.nicheKeywords.length === 0
        ? []
        : await deps.ideation.listOutliers({
            nicheKeywords: channel.nicheKeywords,
            limit: 5,
          });

    // The outlier snapshot feeds the prompt, so it is part of the run
    // identity (adversarial F2): fold it into the hashed input — refreshed
    // outliers produce a NEW metered run instead of re-serving a stale one,
    // and an unchanged snapshot re-serves the persisted output for free.
    const outlierSnapshot = outliers.map((o) => ({ title: o.title, outlierRatio: o.outlierRatio }));

    const topics = await runMeteredSyncStage<TopicCandidate[]>({
      deps: deps.engine,
      stage: "topics",
      workspaceId: ctx.workspaceId,
      projectId: null,
      input: { input, outliers: outlierSnapshot },
      cost: CREDIT_COSTS.scriptTopics,
      actorUserId: ctx.userId,
      creditExempt: isCtxCreditExempt(ctx),
      compute: async () => {
        const result = await generateJson({
          mode: deps.engine.mode,
          llm: deps.engine.llm,
          model: LLM_MODELS.sonnet,
          template: topicsPrompt({
            channelTitle: channel.title,
            nicheKeywords: channel.nicheKeywords,
            outliers: outlierSnapshot,
            styleCard,
            count: input.count,
          }),
          maxTokens: 3000,
          schema: z.object({
            topics: z.array(topicCandidateSchema).min(input.count).max(10),
          }),
          fixture: () => ({
            topics: synthTopicCandidates({
              seed: `${input.channelId}|${generationSeedKey(input.generation)}`,
              nicheKeywords: channel.nicheKeywords,
              outlierTitles: outliers.map((o) => o.title),
              energy: styleCard?.energy ?? 3,
              count: input.count,
            }),
          }),
        });
        return result.topics.slice(0, input.count);
      },
    });
    return { topics };
  },

  /** §4 `script.outline` — 1 credit. Chosen topic + research (when
   *  attached) + style card → outline honoring the card's pacing. */
  async outline({ ctx, input }: HandlerOpts<OutlineInput>) {
    assertGenerationTargetAllowed(input.generation);
    const deps = await getStageDeps();
    const { context } = await contextForProject(
      deps,
      ctx,
      input.projectId,
      input.frameId,
      input.generation,
    );
    await requireCreditsWithOverage(
      ctx.workspaceId,
      CREDIT_COSTS.scriptOutline,
      exemptionFromCtx(ctx),
    );
    const steered = steerByTopic(context, input.topic);

    const outline = await runMeteredSyncStage<Outline>({
      deps: deps.engine,
      stage: "outline",
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      input,
      cost: CREDIT_COSTS.scriptOutline,
      actorUserId: ctx.userId,
      creditExempt: isCtxCreditExempt(ctx),
      compute: () =>
        generateOutline({ mode: deps.engine.mode, llm: deps.engine.llm, context: steered }),
    });
    return { outline };
  },

  /** §4 `script.hooks` — 1 credit, 3 candidates constrained to the card's
   *  hookPatterns, tagged; one auto-picked by the card's preference. */
  async hooks({ ctx, input }: HandlerOpts<HooksInput>) {
    assertGenerationTargetAllowed(input.generation);
    const deps = await getStageDeps();
    const { context } = await contextForProject(deps, ctx, input.projectId, null, input.generation);
    await requireCreditsWithOverage(
      ctx.workspaceId,
      CREDIT_COSTS.scriptHooks,
      exemptionFromCtx(ctx),
    );
    // Contract: outline null ⇒ synthesize a scaffold from the chosen frame
    // (deterministic code, not a metered LLM call) — it only gives the hook
    // writer the video's shape.
    const outline = input.outline ?? synthOutline(context);

    const hooks = await runMeteredSyncStage<HookCandidate[]>({
      deps: deps.engine,
      stage: "hooks",
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      input,
      cost: CREDIT_COSTS.scriptHooks,
      actorUserId: ctx.userId,
      creditExempt: isCtxCreditExempt(ctx),
      compute: () =>
        generateHookCandidates({
          mode: deps.engine.mode,
          llm: deps.engine.llm,
          context,
          outline,
        }),
    });
    return { hooks };
  },

  /**
   * §4 `script.draft` — 4 credits. Approved outline + chosen hook →
   * section-streamed full draft over the existing SSE event bus, then the
   * internal retention/voice/fact-check/quality passes (not user-facing
   * stages). Resumable; completion charge keyed `draft:<input hash>`.
   */
  async draft({ ctx, input }: HandlerOpts<DraftInput>) {
    assertGenerationTargetAllowed(input.generation);
    const deps = await getStageDeps();
    const store = deps.engine.store;
    const project = await store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const frame = await store.getFrame(ctx.workspaceId, input.frameId);
    if (frame === null || frame.projectId !== input.projectId) notFound("frame");
    const voiceProfile =
      input.voiceProfileId === null
        ? null
        : await store.getVoiceProfile(ctx.workspaceId, input.voiceProfileId);
    if (input.voiceProfileId !== null && voiceProfile === null) notFound("voice profile");
    // A licensed script-level voice must have its signed license on file.
    assertLicensedVoiceUsable(voiceProfile);
    // Resolve the card NOW so mode errors (unknown archetype, unlicensed
    // partner, no trained voice) surface at dispatch, before any charge or job.
    const resolutionProfile = await resolveTrainedVoiceProfile(
      store,
      ctx.workspaceId,
      input.generation,
      voiceProfile,
    );
    const styleCard = await resolveStyleCard(input.generation, resolutionProfile, deps.partners);
    if (
      input.hook !== null &&
      styleCard !== null &&
      !styleCard.hookPatterns.some((p) => p.technique === input.hook?.style)
    ) {
      badRequest(
        `hook technique "${input.hook.style}" is not in the style card's allowed patterns (${styleCard.hookPatterns.map((p) => p.technique).join(", ")})`,
      );
    }
    await requireCreditsWithOverage(
      ctx.workspaceId,
      CREDIT_COSTS.scriptDraft,
      exemptionFromCtx(ctx),
    );

    const script = await store.createScript({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      voiceProfileId: input.voiceProfileId,
      // Normalized mode columns (F8): no cross-mode residue on script rows.
      ...generationTargetColumns(input.generation),
    });
    await store.updateProjectStatus(ctx.workspaceId, input.projectId, "scripting");

    const payload = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      frameId: input.frameId,
      voiceProfileId: input.voiceProfileId,
      generation: input.generation,
      scriptId: script.id,
      actorUserId: ctx.userId as string,
      creditExempt: isCtxCreditExempt(ctx),
      dispatch: "draft" as const,
      presetOutline: input.outline,
      chosenHook: input.hook,
    };
    await dispatchPipelineJob(QUEUE_NAMES.script, JOB_NAMES.generateScript, payload, () =>
      handleGenerateScriptJob(payload),
    );
    return { ...jobAccepted(), scriptId: script.id };
  },
};
