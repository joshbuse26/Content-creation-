import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { scriptContracts } from "@/lib/types/api";
import type { Frame, GenerationTarget, StyleCard, VoiceProfile } from "@/lib/types/entities";
import type { HookCandidate, Outline, ScriptContext, TopicCandidate } from "@/lib/types/pipeline";
import { assembleContext } from "@/pipelines/script/context";
import { getEngineDeps, type EngineDeps } from "@/pipelines/script/deps";
import {
  fnv1a,
  synthHookCandidates,
  synthOutline,
  synthSectionBody,
} from "@/pipelines/script/fixture-content";
import { computeQualityReport } from "@/pipelines/script/quality-gate";
import { countWords, estimateSeconds, fleschReadingEase } from "@/pipelines/script/readability";
import { requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS } from "@/server/credits";
import { assertGenerationTargetAllowed } from "@/server/modes";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import { jobAccepted, notFound, type HandlerOpts, type WorkspaceHandlerCtx } from "./_shared";

type TopicsInput = z.output<typeof scriptContracts.topics.input>;
type OutlineInput = z.output<typeof scriptContracts.outline.input>;
type HooksInput = z.output<typeof scriptContracts.hooks.input>;
type DraftInput = z.output<typeof scriptContracts.draft.input>;

/**
 * Staged script procedures (PRODUCT-CONTRACTS §4) — WAVE-C CONTRACT STUBS.
 *
 * The contracts (lib/types/api.ts scriptContracts.topics/outline/hooks/
 * draft) are frozen; these bodies are deterministic fixture-quality
 * implementations so the staged flow works keyless END TO END today:
 *   - `requireCreditsWithOverage` gates every stage at dispatch (§4), and
 *     each stage writes its own itemized ledger entry (reason
 *     "script_generation" — the frozen credit_reason enum has no per-stage
 *     members; the itemization lives in one entry per stage).
 *   - Outputs are runtime-validated against the frozen contracts by
 *     `_contracts.ts` `.output()`.
 *
 * C1 REPLACES the bodies with the real Grok-backed staged pipeline
 * (resumable, SSE-streamed, idempotent completion charges keyed by input
 * hash) — the signatures, credit costs, and mode guards here are the
 * contract it implements against. C1 also implements: crossover style-card
 * merging (documented merge rules — the stub picks the heavier archetype),
 * partner resolution, and channel-niche-aware topics.
 */

// ---------------------------------------------------------------------------
// Style-card resolution (stub)
// ---------------------------------------------------------------------------

/**
 * Resolve the style card for a generation target. Stub rules:
 *  - null → the voice profile's card (legacy flow), or null.
 *  - archetype → the seeded archetype's card.
 *  - crossover → the heavier archetype's card (C1: deterministic merge).
 *  - partnered_named → passes the feature-flag guard upstream, but partner
 *    resolution itself is C1's — rejected here with a clear message.
 */
export function resolveStubStyleCard(
  generation: GenerationTarget | null,
  voiceProfile: VoiceProfile | null,
): StyleCard | null {
  if (generation === null) return voiceProfile?.styleCard ?? null;
  switch (generation.mode) {
    case "archetype": {
      const seed =
        generation.archetypeId === null ? null : getArchetypeSeed(generation.archetypeId);
      if (seed === null) notFound("archetype");
      return seed.styleCard;
    }
    case "crossover": {
      const blend = generation.crossover;
      if (blend === null) notFound("crossover blend");
      const heavier = blend.weightA >= 0.5 ? blend.a : blend.b;
      const seed = getArchetypeSeed(heavier);
      if (seed === null) notFound("archetype");
      return seed.styleCard;
    }
    case "partnered_named":
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Partner voice resolution is not implemented yet.",
      });
    case "train_on_my_channel":
      // Unreachable: assertGenerationTargetAllowed rejects this mode first.
      return voiceProfile?.styleCard ?? null;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function chargeStage(
  deps: EngineDeps,
  params: {
    workspaceId: WorkspaceId;
    cost: number;
    ctx: WorkspaceHandlerCtx;
    projectId: ProjectId | null;
  },
): Promise<void> {
  await deps.store.recordCredits({
    workspaceId: params.workspaceId,
    delta: -params.cost,
    // Frozen credit_reason enum has no per-stage members; each stage still
    // writes its OWN entry, so the ledger stays itemized (§4).
    reason: "script_generation",
    actorUserId: params.ctx.userId,
    projectId: params.projectId,
  });
}

async function contextForProject(
  deps: EngineDeps,
  ctx: WorkspaceHandlerCtx,
  projectId: OutlineInput["projectId"],
  frameId: OutlineInput["frameId"],
  generation: GenerationTarget | null,
  voiceProfileId: DraftInput["voiceProfileId"] = null,
): Promise<{ context: ScriptContext; frame: Frame; voiceProfile: VoiceProfile | null }> {
  const project = await deps.store.getProject(ctx.workspaceId, projectId);
  if (project === null) notFound("project");
  const frames = await deps.store.listFrames(ctx.workspaceId, projectId);
  const frame =
    frameId === null ? frames.find((f) => f.chosen) : frames.find((f) => f.id === frameId);
  if (frame === undefined) notFound("frame");
  const [researchDocs, avatar, voiceProfile] = await Promise.all([
    deps.store.listResearchDocs(ctx.workspaceId, projectId),
    deps.store.getAvatarForChannel(project.channelId),
    voiceProfileId === null
      ? Promise.resolve(null)
      : deps.store.getVoiceProfile(ctx.workspaceId, voiceProfileId),
  ]);
  if (voiceProfileId !== null && voiceProfile === null) notFound("voice profile");
  const base = assembleContext({ frame, researchDocs, avatar, voiceProfile });
  const styleCard = resolveStubStyleCard(generation, voiceProfile);
  return { context: { ...base, styleCard }, frame, voiceProfile };
}

/** Deterministic topic candidates seeded by channel + archetype. */
function synthTopics(input: TopicsInput): TopicCandidate[] {
  const seedName =
    input.generation?.archetypeId ??
    (input.generation?.crossover !== null && input.generation?.crossover !== undefined
      ? `${input.generation.crossover.a}+${input.generation.crossover.b}`
      : "channel-voice");
  const templates: readonly { title: string; angle: string; rationale: string }[] = [
    {
      title: "The upgrade everyone buys first (and why it should be last)",
      angle: "Reorder the standard buying advice using measured results, not habit.",
      rationale: "Purchase-order videos outperform in most gear niches; strong comment bait.",
    },
    {
      title: "I tracked 30 days of results — here is what actually moved the needle",
      angle: "A month of honest measurement, ranked by effect size.",
      rationale: "Time-boxed self-experiments retain well and are cheap to produce.",
    },
    {
      title: "Five beginner mistakes that quietly cost the most",
      angle: "Rank the common mistakes by real cost, with the fix for each.",
      rationale: "Mistake-ranking maps directly onto the audience's stated pains.",
    },
    {
      title: "The cheap option vs the expensive one — blind comparison",
      angle: "Same task, both price points, judged blind.",
      rationale: "Versus formats are proven outliers in comparable niches.",
    },
    {
      title: "What nobody tells you before your first year",
      angle: "The unglamorous fundamentals, told through one concrete story.",
      rationale: "Experience-retrospectives earn saves and shares from newer viewers.",
    },
    {
      title: "One week using only the basics — was the fancy gear ever needed?",
      angle: "A constraint experiment that questions the upgrade treadmill.",
      rationale: "Constraint formats generate strong open loops and low production cost.",
    },
    {
      title: "The setting almost everyone gets wrong",
      angle: "One high-leverage adjustment, demonstrated before/after.",
      rationale: "Single-fix videos convert search traffic and are highly clippable.",
    },
    {
      title: "Reacting to my own first attempt — a brutal audit",
      angle: "Revisit early work with today's standards and extract the lessons.",
      rationale: "Self-audit formats humanize the channel and bridge old/new audiences.",
    },
    {
      title: "The 80/20 of getting good — what to practice first",
      angle: "The minimum set of skills that produces most of the results.",
      rationale: "Prioritization content matches beginner motivation and ranks well.",
    },
    {
      title: "Everything I would buy again (and the three things I regret)",
      angle: "A no-affiliate honesty pass over a year of purchases.",
      rationale: "Regret framing differentiates from standard recommendation lists.",
    },
  ];
  const offset = fnv1a(`${input.channelId}|${seedName}`) % templates.length;
  const out: TopicCandidate[] = [];
  for (let i = 0; i < input.count; i++) {
    const t = templates[(offset + i) % templates.length];
    if (t !== undefined) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const scriptStagesImpl = {
  /** §4 `script.topics` — 1 credit. */
  async topics({ ctx, input }: HandlerOpts<TopicsInput>) {
    assertGenerationTargetAllowed(input.generation);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.scriptTopics);
    const deps = await getEngineDeps();
    // Stub note (C1): topics are deterministic templates, not yet bound to
    // the channel's niche/outlier data — so no channel-owned data is read
    // (and none can leak). C1 must validate channel ownership when it
    // starts reading channel context.
    const topics = synthTopics(input);
    await chargeStage(deps, {
      workspaceId: ctx.workspaceId,
      cost: CREDIT_COSTS.scriptTopics,
      ctx,
      projectId: null,
    });
    return { topics };
  },

  /** §4 `script.outline` — 1 credit. */
  async outline({ ctx, input }: HandlerOpts<OutlineInput>) {
    assertGenerationTargetAllowed(input.generation);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.scriptOutline);
    const deps = await getEngineDeps();
    const { context } = await contextForProject(
      deps,
      ctx,
      input.projectId,
      input.frameId,
      input.generation,
    );
    // Chosen topic (when given) steers the outline via the frame angle.
    const steered: ScriptContext =
      input.topic === null
        ? context
        : {
            ...context,
            frame: { ...context.frame, angle: `${input.topic.title} — ${input.topic.angle}` },
          };
    const outline = synthOutline(steered);
    await chargeStage(deps, {
      workspaceId: ctx.workspaceId,
      cost: CREDIT_COSTS.scriptOutline,
      ctx,
      projectId: input.projectId,
    });
    return { outline };
  },

  /** §4 `script.hooks` — 1 credit, 3 tagged candidates. */
  async hooks({ ctx, input }: HandlerOpts<HooksInput>) {
    assertGenerationTargetAllowed(input.generation);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.scriptHooks);
    const deps = await getEngineDeps();
    const { context } = await contextForProject(deps, ctx, input.projectId, null, input.generation);
    const hooks: HookCandidate[] = synthHookCandidates(context).map((h, i) => ({
      style: h.style,
      body: h.body,
      autoPicked: i === 0,
    }));
    await chargeStage(deps, {
      workspaceId: ctx.workspaceId,
      cost: CREDIT_COSTS.scriptHooks,
      ctx,
      projectId: input.projectId,
    });
    return { hooks };
  },

  /**
   * §4 `script.draft` — 4 credits. Stub runs synchronously (fixture-grade
   * sections from the approved outline + chosen hook) and returns the
   * jobAccepted shape the real (C1) section-streamed pipeline will keep.
   */
  async draft({ ctx, input }: HandlerOpts<DraftInput>) {
    assertGenerationTargetAllowed(input.generation);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.scriptDraft);
    const deps = await getEngineDeps();
    const { context } = await contextForProject(
      deps,
      ctx,
      input.projectId,
      input.frameId,
      input.generation,
      input.voiceProfileId,
    );
    const outline: Outline = input.outline ?? synthOutline(context);
    const candidates: HookCandidate[] = synthHookCandidates(context).map((h, i) => ({
      style: h.style,
      body: h.body,
      autoPicked: input.hook === null ? i === 0 : h.style === input.hook.style,
    }));
    const hookBody = input.hook?.body ?? candidates[0]?.body ?? "";

    const script = await deps.store.createScript({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      voiceProfileId: input.voiceProfileId,
      generationMode: input.generation?.mode ?? null,
      archetypeId: input.generation?.archetypeId ?? null,
      crossover: input.generation?.crossover ?? null,
      partnerId: input.generation?.partnerId ?? null,
    });
    await deps.store.updateProjectStatus(ctx.workspaceId, input.projectId, "scripting");

    const sections = outline.sections.map((section, i) => ({
      position: i,
      kind: section.kind,
      heading: section.heading,
      body:
        section.kind === "hook" && hookBody !== ""
          ? hookBody
          : synthSectionBody(context, section, i),
      estSeconds: section.targetSeconds,
      retentionNote: section.retentionNote === "" ? null : section.retentionNote,
      factRefs: [],
    }));
    const persisted = await deps.store.replaceSections(ctx.workspaceId, script.id, sections);
    const text = persisted.map((s) => s.body).join("\n\n");
    const words = countWords(text);
    await deps.store.updateScript(ctx.workspaceId, script.id, {
      status: "final",
      stats: { words, estRuntimeS: estimateSeconds(words), readability: fleschReadingEase(text) },
    });
    deps.store.saveHookCandidates(script.id, candidates);
    const report = computeQualityReport({
      sections: persisted,
      targetMinutes: context.frame.targetMinutes,
      tone: context.frame.tone,
      styleCard: context.styleCard,
    });
    deps.store.saveQualityReport(script.id, report);
    await chargeStage(deps, {
      workspaceId: ctx.workspaceId,
      cost: CREDIT_COSTS.scriptDraft,
      ctx,
      projectId: input.projectId,
    });
    return { ...jobAccepted(), scriptId: script.id };
  },
};
