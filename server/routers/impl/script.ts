import { z } from "zod";
import { getConfig, LLM_MODELS } from "@/lib/config";
import { generationTargetColumns } from "@/lib/generation-target";
import type { scriptContracts } from "@/lib/types/api";
import { generationTargetSchema, type GenerationTarget } from "@/lib/types/entities";
import type { Script, ScriptSection } from "@/lib/types/entities";
import type { QualityGateReport } from "@/lib/types/pipeline";
import { resolveStyleCard, resolveTrainedVoiceProfile } from "@/pipelines/stages/style-resolver";
import { assembleContext } from "@/pipelines/script/context";
import { getEngineDeps, type EngineDeps } from "@/pipelines/script/deps";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { synthSectionBody } from "@/pipelines/script/fixture-content";
import { handleGenerateScriptJob } from "@/pipelines/script/jobs";
import { runLicensedGuard, LicensedGuardBlockedError } from "@/pipelines/script/licensed-guard";
import { generateJson } from "@/pipelines/script/llm-json";
import { computeQualityReport } from "@/pipelines/script/quality-gate";
import {
  countWords,
  estimateSeconds,
  estimateSecondsForText,
  fleschReadingEase,
} from "@/pipelines/script/readability";
import { regenerateSectionPrompt } from "@/prompts";
import { assertWorkspaceNotReadOnly, requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS } from "@/server/credits";
import { assertGenerationTargetAllowed, assertLicensedVoiceUsable } from "@/server/modes";
import { exportScript } from "@/server/export";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { badRequest, jobAccepted, notFound, preconditionFailed, type HandlerOpts } from "./_shared";

type GenerateInput = z.output<typeof scriptContracts.generate.input>;
type GetInput = z.output<typeof scriptContracts.get.input>;
type ListVersionsInput = z.output<typeof scriptContracts.listVersions.input>;
type UpdateSectionInput = z.output<typeof scriptContracts.updateSection.input>;
type RegenerateSectionInput = z.output<typeof scriptContracts.regenerateSection.input>;
type SetSectionLockInput = z.output<typeof scriptContracts.setSectionLock.input>;
type SetSectionVoiceInput = z.output<typeof scriptContracts.setSectionVoice.input>;
type ReorderSectionsInput = z.output<typeof scriptContracts.reorderSections.input>;
type ExportInput = z.output<typeof scriptContracts.export.input>;
type ExportOutput = z.output<typeof scriptContracts.export.output>;

async function refreshScriptStats(
  deps: EngineDeps,
  workspaceId: Script["workspaceId"],
  scriptId: Script["id"],
): Promise<void> {
  const sections = await deps.store.listSections(workspaceId, scriptId);
  const text = sections.map((s) => s.body).join("\n\n");
  const words = countWords(text);
  await deps.store.updateScript(workspaceId, scriptId, {
    stats: { words, estRuntimeS: estimateSeconds(words), readability: fleschReadingEase(text) },
  });
}

/** Rebuild the generation target a script was created with (mode columns). */
function scriptGenerationTarget(script: Script): GenerationTarget | null {
  if (script.generationMode === null) return null;
  return generationTargetSchema.parse({
    mode: script.generationMode,
    archetypeId: script.archetypeId,
    crossover: script.crossover,
    partnerId: script.partnerId,
    voiceProfileId: script.voiceProfileId,
  });
}

async function qualityReportFor(
  deps: EngineDeps,
  script: Script,
  sections: ScriptSection[],
): Promise<QualityGateReport | null> {
  const cached = deps.store.getCachedQualityReport(script.id);
  if (cached !== null) return cached;
  if (script.status !== "final" || sections.length === 0) return null;
  // The gate is pure code — recompute from persisted sections + chosen frame.
  const frames = await deps.store.listFrames(script.workspaceId, script.projectId);
  const frame = frames.find((f) => f.chosen);
  if (frame === undefined) return null;
  const profile =
    script.voiceProfileId === null
      ? null
      : await deps.store.getVoiceProfile(script.workspaceId, script.voiceProfileId);
  // Wave C: recomputed reports resolve the SAME style card the script was
  // generated with (mode columns → archetype/crossover/partner card; legacy
  // scripts keep the voice-profile card). A card that can no longer resolve
  // (e.g. partner disabled since) degrades to the profile card, never to a
  // hard error on a read path.
  let styleCard = profile?.styleCard ?? null;
  try {
    styleCard = await resolveStyleCard(scriptGenerationTarget(script), profile);
  } catch {
    /* keep the fallback */
  }
  // Hook technique: recoverable from the candidate cache; null after a
  // restart (hookPatternOk then reads "not evaluated", never a pass).
  const chosenHookStyle =
    deps.store.getHookCandidates(script.id)?.find((c) => c.autoPicked)?.style ?? null;
  return computeQualityReport({
    sections,
    targetMinutes: frame.targetMinutes,
    tone: frame.tone,
    styleCard,
    chosenHookStyle,
  });
}

/** script router — build spec §5.7 / §6. */
export const scriptImpl = {
  /**
   * Composite generation — wave-C C1: the ORCHESTRATOR over the staged
   * procedures (PRODUCT-CONTRACTS §4). One dispatch, one script row, ONE
   * SSE stream (the frozen ScriptStreamEvent union on /api/script-stream),
   * running outline → hooks → draft in sequence with ITEMIZED ledger
   * entries per stage (outline 1 + hooks 1 + draft 4 = 6 =
   * CREDIT_COSTS.scriptGeneration, each keyed `<stage>:<input hash>`) —
   * stage metering is never bypassed. `topics` is pre-selection and not
   * part of the composite. The full 6 credits are required at dispatch.
   */
  async generate({ ctx, input }: HandlerOpts<GenerateInput>) {
    assertGenerationTargetAllowed(input.generation);
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const frame = await deps.store.getFrame(ctx.workspaceId, input.frameId);
    if (frame === null || frame.projectId !== input.projectId) notFound("frame");
    const profile =
      input.voiceProfileId === null
        ? null
        : await deps.store.getVoiceProfile(ctx.workspaceId, input.voiceProfileId);
    if (input.voiceProfileId !== null && profile === null) notFound("voice profile");
    // A licensed script-level voice must have its signed license on file.
    assertLicensedVoiceUsable(profile);
    // Resolve the card now so mode errors (unknown archetype, unlicensed
    // partner, no trained voice) surface at dispatch, before any charge or row.
    const resolutionProfile = await resolveTrainedVoiceProfile(
      deps.store,
      ctx.workspaceId,
      input.generation,
      profile,
    );
    await resolveStyleCard(input.generation, resolutionProfile);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.scriptGeneration);
    const script = await deps.store.createScript({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      voiceProfileId: input.voiceProfileId,
      // Normalized mode columns (F8): no cross-mode residue on script rows.
      ...generationTargetColumns(input.generation),
    });
    await deps.store.updateProjectStatus(ctx.workspaceId, input.projectId, "scripting");
    const payload = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      frameId: input.frameId,
      voiceProfileId: input.voiceProfileId,
      generation: input.generation,
      scriptId: script.id,
      actorUserId: ctx.userId as string,
      dispatch: "generate" as const,
    };
    await dispatchPipelineJob(QUEUE_NAMES.script, JOB_NAMES.generateScript, payload, () =>
      handleGenerateScriptJob(payload),
    );
    return { ...jobAccepted(), scriptId: script.id };
  },

  async get({ ctx, input }: HandlerOpts<GetInput>) {
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    const sections = await deps.store.listSections(ctx.workspaceId, input.scriptId);
    const qualityReport = await qualityReportFor(deps, script, sections);
    const hookCandidates = deps.store.getHookCandidates(input.scriptId);
    return { script, sections, qualityReport, hookCandidates };
  },

  async listVersions({ ctx, input }: HandlerOpts<ListVersionsInput>): Promise<Script[]> {
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    return deps.store.listScriptVersions(ctx.workspaceId, input.projectId);
  },

  async updateSection({ ctx, input }: HandlerOpts<UpdateSectionInput>): Promise<ScriptSection> {
    const deps = await getEngineDeps();
    const existing = await deps.store.getSection(ctx.workspaceId, input.sectionId);
    if (existing === null) notFound("section");
    if (existing.locked && input.body !== undefined) {
      badRequest("section is locked — unlock it before editing");
    }
    const patch: Parameters<typeof deps.store.updateSection>[2] = {};
    if (input.heading !== undefined) patch.heading = input.heading;
    if (input.body !== undefined) {
      patch.body = input.body;
      patch.estSeconds = estimateSecondsForText(input.body);
    }
    const section = await deps.store.updateSection(ctx.workspaceId, input.sectionId, patch);
    if (section === null) notFound("section");
    if (input.body !== undefined) {
      await refreshScriptStats(deps, ctx.workspaceId, section.scriptId);
    }
    return section;
  },

  /** One-off LLM rewrite of a single section, continuity-aware. */
  async regenerateSection({ ctx, input }: HandlerOpts<RegenerateSectionInput>) {
    // Read-only lockdown (adversarial F4): this is a generation-class
    // dispatch (live LLM), so a workspace whose payment-failure grace
    // expired cannot dispatch it. Metering it is a pending product
    // decision (see OPEN-ITEMS) — the lockdown is enforced either way.
    await assertWorkspaceNotReadOnly(ctx.workspaceId);
    const deps = await getEngineDeps();
    const section = await deps.store.getSection(ctx.workspaceId, input.sectionId);
    if (section === null) notFound("section");
    if (section.locked) badRequest("section is locked — unlock it before regenerating");
    const script = await deps.store.getScript(ctx.workspaceId, section.scriptId);
    if (script === null) notFound("script");
    const project = await deps.store.getProject(ctx.workspaceId, script.projectId);
    if (project === null) notFound("project");
    const frames = await deps.store.listFrames(ctx.workspaceId, script.projectId);
    const frame = frames.find((f) => f.chosen) ?? frames[0];
    if (frame === undefined) badRequest("project has no frame — propose and choose one first");
    // Multi-voice (PRODUCT-CONTRACTS §7): the section's EFFECTIVE voice is its
    // own override when set, else the script-level voice. Regeneration writes
    // the section in that voice — the concrete multi-voice write path.
    const [researchDocs, avatar, scriptProfile, overrideProfile] = await Promise.all([
      deps.store.listResearchDocs(ctx.workspaceId, script.projectId),
      deps.store.getAvatarForChannel(project.channelId),
      script.voiceProfileId === null
        ? Promise.resolve(null)
        : deps.store.getVoiceProfile(ctx.workspaceId, script.voiceProfileId),
      section.voiceProfileId === null
        ? Promise.resolve(null)
        : deps.store.getVoiceProfile(ctx.workspaceId, section.voiceProfileId),
    ]);
    const effectiveProfile = overrideProfile ?? scriptProfile;
    assertLicensedVoiceUsable(effectiveProfile);
    const context = assembleContext({
      frame,
      researchDocs,
      avatar,
      voiceProfile: effectiveProfile,
    });
    const sections = await deps.store.listSections(ctx.workspaceId, section.scriptId);
    const index = sections.findIndex((s) => s.id === section.id);
    const guidance = input.guidance ?? null;
    const result = await generateJson({
      mode: deps.mode,
      llm: deps.llm,
      model: LLM_MODELS.sonnet,
      template: regenerateSectionPrompt({
        context,
        section: {
          kind: section.kind,
          heading: section.heading,
          body: section.body,
          estSeconds: section.estSeconds,
        },
        priorSections: sections.slice(0, index).map((s) => ({
          kind: s.kind,
          heading: s.heading,
          body: s.body,
        })),
        followingSections: sections.slice(index + 1).map((s) => ({
          kind: s.kind,
          heading: s.heading,
          body: s.body,
        })),
        guidance,
      }),
      maxTokens: 3000,
      temperature: 0.8,
      schema: z.object({ body: z.string().min(1) }),
      fixture: () => ({
        body: synthSectionBody(
          context,
          {
            kind: section.kind,
            heading: `${section.heading} ${guidance ?? "regenerated"}`,
            purpose: "",
            retentionNote: section.retentionNote ?? "",
            targetSeconds: Math.max(20, section.estSeconds),
          },
          index + 100,
        ),
      }),
    });

    // Licensed-voice similarity guard (PRODUCT-CONTRACTS §7): a section
    // regenerated in a licensed voice is checked against the licensed source,
    // auto-rewritten once if over the line, and hard-failed (never emitted) if
    // still over — same gate the draft pipeline runs, on the single-section
    // path.
    let finalBody = result.body;
    if (effectiveProfile !== null && effectiveProfile.source === "licensed") {
      try {
        const guard = await runLicensedGuard({
          mode: deps.mode,
          llm: deps.llm,
          threshold: getConfig().LICENSED_SIMILARITY_MAX_OVERLAP,
          sections: [{ position: 0, body: result.body, licensedProfile: effectiveProfile }],
        });
        if (guard !== null) finalBody = guard.rewrites.get(0) ?? result.body;
      } catch (err) {
        if (err instanceof LicensedGuardBlockedError) preconditionFailed(err.message);
        throw err;
      }
    }

    await deps.store.updateSection(ctx.workspaceId, section.id, {
      body: finalBody,
      estSeconds: estimateSecondsForText(finalBody),
    });
    await refreshScriptStats(deps, ctx.workspaceId, section.scriptId);
    return jobAccepted();
  },

  async setSectionLock({ ctx, input }: HandlerOpts<SetSectionLockInput>): Promise<ScriptSection> {
    const deps = await getEngineDeps();
    const section = await deps.store.updateSection(ctx.workspaceId, input.sectionId, {
      locked: input.locked,
    });
    if (section === null) notFound("section");
    return section;
  },

  /**
   * Multi-voice (PRODUCT-CONTRACTS §7): set or clear a section's voice
   * override. Config, not generation — no credit charge. Tenancy: both the
   * section and the assigned voice profile are read workspace-scoped, so a
   * cross-tenant section or voice id is NOT_FOUND. A licensed voice must have
   * a signed license on file to be assignable (assertLicensedVoiceUsable).
   */
  async setSectionVoice({ ctx, input }: HandlerOpts<SetSectionVoiceInput>): Promise<ScriptSection> {
    const deps = await getEngineDeps();
    const existing = await deps.store.getSection(ctx.workspaceId, input.sectionId);
    if (existing === null) notFound("section");
    if (input.voiceProfileId !== null) {
      const profile = await deps.store.getVoiceProfile(ctx.workspaceId, input.voiceProfileId);
      if (profile === null) notFound("voice profile");
      assertLicensedVoiceUsable(profile);
    }
    const section = await deps.store.updateSection(ctx.workspaceId, input.sectionId, {
      voiceProfileId: input.voiceProfileId,
    });
    if (section === null) notFound("section");
    return section;
  },

  /** Persist a full section ordering (approved contract addition, REQUESTS-A3 #3). */
  async reorderSections({
    ctx,
    input,
  }: HandlerOpts<ReorderSectionsInput>): Promise<ScriptSection[]> {
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    const sections = await deps.store.reorderSections(
      ctx.workspaceId,
      input.scriptId,
      input.sectionIds,
    );
    if (sections === null) {
      badRequest("sectionIds must be a permutation of the script's sections");
    }
    return sections;
  },

  /** Delegates to the canonical export implementation in server/export (A4). */
  async export({ ctx, input }: HandlerOpts<ExportInput>): Promise<ExportOutput> {
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    const sections = await deps.store.listSections(ctx.workspaceId, input.scriptId);
    const project = await deps.store.getProject(ctx.workspaceId, script.projectId);
    return exportScript(
      {
        title: project?.title ?? "Script",
        version: script.version,
        sections: sections.map((s) => ({
          kind: s.kind,
          heading: s.heading,
          body: s.body,
          estSeconds: s.estSeconds,
          retentionNote: s.retentionNote,
        })),
      },
      input.format,
    );
  },
} as const;
