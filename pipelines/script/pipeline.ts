import { z } from "zod";
import { getConfig, LLM_MODELS } from "@/lib/config";
import { licensedGuardProfile } from "@/lib/multi-voice";
import type { FactRef, StyleCard, VoiceProfile } from "@/lib/types/entities";
import type { CreditReason, HookStyle } from "@/lib/types/enums";
import {
  SCRIPT_STAGES,
  type ScriptStage,
  scriptStreamEventSchema,
  sectionRewriteOutputSchema,
  type DraftOutput,
  type HookCandidate,
  type Outline,
  type QualityGateReport,
  type ScriptContext,
  type ScriptJobInput,
  type ScriptStreamEvent,
} from "@/lib/types/pipeline";
import { researchDocIdSchema, scriptIdSchema, type ScriptId } from "@/lib/types/ids";
import { generateHookCandidates } from "@/pipelines/stages/hooks";
import { generateOutline } from "@/pipelines/stages/outline";
import { resolveStyleCard, resolveTrainedVoiceProfile } from "@/pipelines/stages/style-resolver";
import {
  factCheckPrompt,
  qualityFixPrompt,
  retentionPrompt,
  sectionPrompt,
  voicePrompt,
} from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import { CREDIT_COSTS } from "@/server/credits";
import { applyCodeAutoFix } from "./auto-fix";
import { assembleContext } from "./context";
import type { EngineDeps } from "./deps";
import {
  synthOutline,
  synthRetentionNote,
  synthRetentionRewrite,
  synthSectionBody,
  synthVoiceRewrite,
} from "./fixture-content";
import { matchClaims } from "./fact-match";
import { stageInputHash } from "./hash";
import {
  runLicensedGuard,
  LicensedGuardBlockedError,
  type GuardInputSection,
  type LicensedGuardLog,
} from "./licensed-guard";
import { generateJson } from "./llm-json";
import { computeQualityReport, gateViolations } from "./quality-gate";
import {
  estimateSeconds,
  estimateSecondsForText,
  countWords,
  fleschReadingEase,
} from "./readability";
import { settleCharge } from "./settle-charge";
import type { NewSection } from "./store";

/**
 * §5.7 — the script agent. Seven stages, exactly as named in the frozen
 * SCRIPT_STAGES, executed by the shared PipelineRunner (which owns per-stage
 * retries and resume), streaming ScriptStreamEvents to the editor.
 *
 * Wave C (C1): the same pipeline body now serves three dispatch shapes —
 * the frozen SSE event union is identical for all of them:
 *  - LEGACY composite (default): one -6 completion charge, unchanged.
 *  - `script.draft` (staged §4): an approved outline and/or chosen hook are
 *    adopted instead of generated; one -4 completion charge keyed
 *    `draft:<hash>`.
 *  - `script.generate` ORCHESTRATOR: outline → hooks → draft in sequence
 *    with ITEMIZED per-stage ledger entries (1 + 1 + 4 = 6) — outline's
 *    credit lands when the outline stage completes, hooks' when the
 *    candidates are produced (draft_sections), draft's on completion. Every
 *    entry is idempotency-keyed `<stage>:<input hash>`, so retries and
 *    resumed runs never double-charge and the orchestrator cannot bypass
 *    stage metering.
 */

interface WorkingSection {
  kind: DraftOutput["sections"][number]["kind"];
  heading: string;
  body: string;
  estSeconds: number;
  retentionNote: string | null;
}

interface ScriptRunState {
  context?: ScriptContext;
  outline?: Outline;
  hookCandidates?: HookCandidate[];
  pickedHookStyle?: HookStyle;
  sections?: WorkingSection[];
  report?: QualityGateReport;
  /** Licensed-voice similarity guard result, logged onto the voice_pass run. */
  guardLog?: LicensedGuardLog;
}

/** How this run is metered (see module docs). */
export type ScriptRunMetering = "composite" | "draft" | "itemized";

/** One credit charge: cost, idempotency key, and its distinct ledger reason. */
interface StageCharge {
  cost: number;
  key: string;
  reason: CreditReason;
}

export interface ScriptPipelineParams {
  input: ScriptJobInput;
  scriptId: ScriptId;
  actorUserId: string | null;
  /** Staged `draft`: the approved outline to adopt instead of generating. */
  presetOutline?: Outline | null;
  /** Staged `draft`: the chosen hook (used verbatim for the hook section). */
  chosenHook?: HookCandidate | null;
  /** Defaults to "composite" (legacy single -6 charge). */
  metering?: ScriptRunMetering;
}

const sectionBodySchema = z.object({ body: z.string().min(1) });

const factClaimsSchema = z.object({
  claims: z.array(z.object({ claim: z.string().min(1), researchDocId: z.string().nullable() })),
});

function scriptStats(sections: WorkingSection[]): {
  words: number;
  estRuntimeS: number;
  readability: number;
} {
  const text = sections.map((s) => s.body).join("\n\n");
  const words = countWords(text);
  return { words, estRuntimeS: estimateSeconds(words), readability: fleschReadingEase(text) };
}

export async function runScriptPipeline(
  deps: EngineDeps,
  params: ScriptPipelineParams,
): Promise<PipelineResult> {
  const { input, scriptId } = params;
  const state: ScriptRunState = {};
  const publish = async (event: ScriptStreamEvent) => {
    await deps.events.publish(scriptId, scriptStreamEventSchema.parse(event));
  };

  const ensureContext = async (): Promise<ScriptContext> => {
    if (state.context !== undefined) return state.context;
    const frame = await deps.store.getFrame(input.workspaceId, input.frameId);
    if (frame === null) throw new Error("frame not found for script generation");
    const project = await deps.store.getProject(input.workspaceId, input.projectId);
    if (project === null) throw new Error("project not found for script generation");
    const [researchDocs, avatar, voiceProfile] = await Promise.all([
      deps.store.listResearchDocs(input.workspaceId, input.projectId),
      deps.store.getAvatarForChannel(project.channelId),
      input.voiceProfileId === null
        ? Promise.resolve(null)
        : deps.store.getVoiceProfile(input.workspaceId, input.voiceProfileId),
    ]);
    const base = assembleContext({ frame, researchDocs, avatar, voiceProfile });
    // Wave C: the generation target (archetype / crossover / partner)
    // resolves the style card; generation === null keeps the legacy
    // voice-profile card assembleContext already set. Archetype and partner
    // cards flow through the SAME styleCard seam as channel-learned cards.
    const resolutionProfile = await resolveTrainedVoiceProfile(
      deps.store,
      input.workspaceId,
      input.generation,
      voiceProfile,
    );
    const styleCard: StyleCard | null =
      input.generation === null
        ? base.styleCard
        : await resolveStyleCard(input.generation, resolutionProfile);
    state.context = { ...base, styleCard };
    return state.context;
  };

  const ensureSections = async (): Promise<WorkingSection[]> => {
    if (state.sections !== undefined) return state.sections;
    const persisted = await deps.store.listSections(input.workspaceId, scriptId);
    if (persisted.length === 0) throw new Error("no drafted sections found to resume from");
    state.sections = persisted.map((s) => ({
      kind: s.kind,
      heading: s.heading,
      body: s.body,
      estSeconds: s.estSeconds,
      retentionNote: s.retentionNote,
    }));
    return state.sections;
  };

  const persistSections = async (sections: WorkingSection[], factRefs?: Map<number, FactRef[]>) => {
    const rows: NewSection[] = sections.map((s, position) => ({
      position,
      kind: s.kind,
      heading: s.heading,
      body: s.body,
      estSeconds: s.estSeconds,
      retentionNote: s.retentionNote,
      factRefs: factRefs?.get(position) ?? [],
    }));
    await deps.store.replaceSections(input.workspaceId, scriptId, rows);
  };

  /**
   * Resolve the licensed voice profile each in-memory section is checked
   * against: the section's own voice override when set (read by position from
   * the persisted rows), else the script-level voice. A non-licensed effective
   * voice yields null (that section is not guarded).
   */
  const resolveGuardProfiles = async (
    sections: WorkingSection[],
  ): Promise<(VoiceProfile | null)[]> => {
    const scriptProfile: VoiceProfile | null =
      input.voiceProfileId === null
        ? null
        : await deps.store.getVoiceProfile(input.workspaceId, input.voiceProfileId);
    const persisted = await deps.store.listSections(input.workspaceId, scriptId);
    const overrideByPosition = new Map<number, VoiceProfile | null>();
    const overrideCache = new Map<string, VoiceProfile | null>();
    for (const row of persisted) {
      if (row.voiceProfileId === null) {
        overrideByPosition.set(row.position, null);
        continue;
      }
      const key = row.voiceProfileId as string;
      if (!overrideCache.has(key)) {
        overrideCache.set(
          key,
          await deps.store.getVoiceProfile(input.workspaceId, row.voiceProfileId),
        );
      }
      overrideByPosition.set(row.position, overrideCache.get(key) ?? null);
    }
    return sections.map((_s, position) =>
      licensedGuardProfile(overrideByPosition.get(position) ?? null, scriptProfile),
    );
  };

  /**
   * Licensed-voice similarity guard over the just-voiced IN-MEMORY candidate
   * (P1-3: guard BEFORE persisting, so over-similar text never touches the DB).
   * Resolves the licensed profile each section is checked against, runs the
   * guard, applies its single auto-rewrites onto the in-memory working sections,
   * and records the check result in state.guardLog for the pipeline_run.
   * Hard-fails (throws) — before any persist — when a section is still over the
   * line after its rewrite, so a guard-blocked run writes nothing for it.
   */
  const runVoicePassGuard = async (): Promise<void> => {
    const working = state.sections;
    if (working === undefined || working.length === 0) return;
    const profiles = await resolveGuardProfiles(working);
    const guardSections: GuardInputSection[] = working.map((s, position) => ({
      position,
      body: s.body,
      licensedProfile: profiles[position] ?? null,
    }));

    let result;
    try {
      result = await runLicensedGuard({
        mode: deps.mode,
        llm: deps.llm,
        threshold: getConfig().LICENSED_SIMILARITY_MAX_OVERLAP,
        sections: guardSections,
      });
    } catch (err) {
      if (err instanceof LicensedGuardBlockedError) {
        // Record the check (incl. the blocked section) before failing the run.
        state.guardLog = err.log;
        throw new Error(err.message);
      }
      throw err;
    }
    if (result === null) return; // no licensed voice in play — nothing to log
    state.guardLog = result.log;
    if (result.rewrites.size === 0) return;

    // Apply de-dup rewrites onto the in-memory candidate; persistSections then
    // writes only this guard-approved text.
    for (const [position, body] of result.rewrites) {
      const target = state.sections?.[position];
      if (target !== undefined) {
        target.body = body;
        target.estSeconds = estimateSecondsForText(body);
      }
    }
  };

  /** Rewrite stages must not change section count/kinds — validate + carry. */
  const acceptRewrite = (
    current: WorkingSection[],
    rewritten: {
      kind: string;
      heading: string;
      body: string;
      estSeconds: number;
      retentionNote: string | null;
    }[],
    stage: string,
  ): WorkingSection[] => {
    if (rewritten.length !== current.length) {
      throw new Error(`${stage}: section count changed (${rewritten.length} vs ${current.length})`);
    }
    return rewritten.map((r, i) => {
      const original = current[i];
      if (original === undefined || r.kind !== original.kind) {
        throw new Error(`${stage}: section kind changed at position ${i}`);
      }
      return {
        kind: original.kind,
        heading: original.heading,
        body: r.body,
        estSeconds: estimateSecondsForText(r.body),
        retentionNote: r.retentionNote,
      };
    });
  };

  const stageBodies: Record<(typeof SCRIPT_STAGES)[number], () => Promise<void>> = {
    // -- 1 ------------------------------------------------------------------
    assemble_context: async () => {
      await ensureContext();
      await deps.store.updateScript(input.workspaceId, scriptId, { status: "outlining" });
    },

    // -- 2 ------------------------------------------------------------------
    outline: async () => {
      const context = await ensureContext();
      if (params.presetOutline !== undefined && params.presetOutline !== null) {
        // Staged `draft`: the outline was approved upstream — adopt it
        // verbatim (it already went through the outline stage's metering).
        state.outline = params.presetOutline;
        await publish({ type: "outline", outline: params.presetOutline });
        return;
      }
      const outline = await generateOutline({ mode: deps.mode, llm: deps.llm, context });
      state.outline = outline;
      await publish({ type: "outline", outline });
    },

    // -- 3 ------------------------------------------------------------------
    draft_sections: async () => {
      const context = await ensureContext();
      const outline = state.outline ?? params.presetOutline ?? synthOutline(context);
      state.outline = outline;

      // Licensed-voice guard on the STREAM (P1-3): for a licensed script-level
      // voice, each section is checked BEFORE its `section` event is published
      // and before the batch persist below, so pre-guard verbatim text is never
      // streamed to the editor nor written. Non-licensed voices resolve to null
      // here and stream exactly as before (no guard, no perf cost). Section
      // overrides do not exist yet at draft time (sections are created here), so
      // the script-level voice is the effective voice for every section.
      const scriptProfile: VoiceProfile | null =
        input.voiceProfileId === null
          ? null
          : await deps.store.getVoiceProfile(input.workspaceId, input.voiceProfileId);
      const streamLicensedProfile = licensedGuardProfile(null, scriptProfile);
      const guardStreamedBody = async (body: string): Promise<string> => {
        if (streamLicensedProfile === null) return body;
        try {
          const guard = await runLicensedGuard({
            mode: deps.mode,
            llm: deps.llm,
            threshold: getConfig().LICENSED_SIMILARITY_MAX_OVERLAP,
            sections: [{ position: 0, body, licensedProfile: streamLicensedProfile }],
          });
          return guard?.rewrites.get(0) ?? body;
        } catch (err) {
          if (err instanceof LicensedGuardBlockedError) throw new Error(err.message);
          throw err;
        }
      };

      // Hook first. Staged `draft` with a chosen hook uses it verbatim;
      // otherwise three tagged candidates, CONSTRAINED to the style card's
      // hookPatterns when a card is in play, auto-picked by the card's
      // preference order (frame outcome when card-less — legacy behavior).
      let candidates: HookCandidate[];
      if (params.chosenHook !== undefined && params.chosenHook !== null) {
        candidates = [{ ...params.chosenHook, autoPicked: true }];
      } else {
        candidates = await generateHookCandidates({
          mode: deps.mode,
          llm: deps.llm,
          context,
          outline,
        });
      }
      const picked = candidates.find((c) => c.autoPicked) ?? candidates[0];
      state.pickedHookStyle = picked?.style;
      state.hookCandidates = candidates;
      deps.store.saveHookCandidates(scriptId, candidates);
      await publish({ type: "hooks", candidates });

      // Then every section in order, each prompt carrying all prior text.
      const sections: WorkingSection[] = [];
      for (let i = 0; i < outline.sections.length; i++) {
        const planned = outline.sections[i];
        if (planned === undefined) continue;
        let body: string;
        if (planned.kind === "hook") {
          body = picked?.body ?? candidates.map((c) => c.body)[0] ?? "";
        } else {
          const result = await generateJson({
            mode: deps.mode,
            llm: deps.llm,
            model: LLM_MODELS.sonnet,
            template: sectionPrompt({
              context,
              outline,
              sectionIndex: i,
              priorSections: sections.map((s) => ({
                kind: s.kind,
                heading: s.heading,
                body: s.body,
              })),
            }),
            maxTokens: 3000,
            schema: sectionBodySchema,
            fixture: () => ({ body: synthSectionBody(context, planned, i) }),
          });
          body = result.body;
        }
        // Guard before the section is streamed or persisted (P1-3).
        body = await guardStreamedBody(body);
        const section: WorkingSection = {
          kind: planned.kind,
          heading: planned.heading,
          body,
          estSeconds: estimateSecondsForText(body),
          retentionNote:
            planned.retentionNote !== ""
              ? planned.retentionNote
              : synthRetentionNote(planned.kind, i),
        };
        sections.push(section);
        await publish({ type: "section", section, position: i });
      }
      state.sections = sections;
      await persistSections(sections);
      await deps.store.updateScript(input.workspaceId, scriptId, {
        status: "drafting",
        stats: scriptStats(sections),
      });
    },

    // -- 4 ------------------------------------------------------------------
    retention_pass: async () => {
      const context = await ensureContext();
      const sections = await ensureSections();
      const rewritten = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: retentionPrompt({ context, sections }),
        maxTokens: 8000,
        schema: sectionRewriteOutputSchema,
        fixture: () => ({
          sections: sections.map((s, i) => ({
            ...s,
            body: synthRetentionRewrite(s.body, s.kind, s.estSeconds),
            retentionNote: s.retentionNote ?? synthRetentionNote(s.kind, i),
          })),
        }),
      });
      state.sections = acceptRewrite(sections, rewritten.sections, "retention_pass");
      await persistSections(state.sections);
    },

    // -- 5 ------------------------------------------------------------------
    voice_pass: async () => {
      const context = await ensureContext();
      const sections = await ensureSections();
      const used = { catchphrase: false };
      const rewritten = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: voicePrompt({ context, sections }),
        maxTokens: 8000,
        schema: sectionRewriteOutputSchema,
        fixture: () => ({
          sections: sections.map((s) => ({
            ...s,
            body: synthVoiceRewrite(s.body, s.kind, context.styleCard, used),
          })),
        }),
      });
      state.sections = acceptRewrite(sections, rewritten.sections, "voice_pass");

      // Licensed-voice similarity guard (PRODUCT-CONTRACTS §7): after voicing,
      // any section whose EFFECTIVE voice is licensed is checked against the
      // licensed source snippets. Over-similar sections are auto-rewritten
      // once and re-checked; a section still over the line HARD-FAILS the run
      // (never emitted). A script-level licensed voice guards every section; a
      // per-section voice override guards (or lifts) that one section. Scripts
      // with no licensed voice are untouched and unlogged.
      //
      // P1-3: the guard runs on the IN-MEMORY candidate BEFORE persistSections,
      // so a hard-fail is atomic — over-similar voiced text is never written to
      // the DB (and so is never returned by script.get) and rewrites are
      // applied in place, so persistSections stores only guard-approved text.
      await runVoicePassGuard();
      await persistSections(state.sections);

      await deps.store.updateScript(input.workspaceId, scriptId, {
        stats: scriptStats(state.sections ?? []),
      });
    },

    // -- 6 ------------------------------------------------------------------
    fact_check: async () => {
      const sections = await ensureSections();
      const docs = await deps.store.listResearchDocs(input.workspaceId, input.projectId);
      const docIds = new Set<string>(docs.map((d) => d.id as string));
      const persisted = await deps.store.listSections(input.workspaceId, scriptId);
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const row = persisted[i];
        if (section === undefined || row === undefined) continue;
        const result = await generateJson({
          mode: deps.mode,
          llm: deps.llm,
          model: LLM_MODELS.haiku,
          template: factCheckPrompt({
            sectionHeading: section.heading,
            sectionBody: section.body,
            researchDocs: docs.map((d) => ({
              id: d.id,
              title: d.title,
              content: d.content,
            })),
          }),
          maxTokens: 2000,
          temperature: 0,
          schema: factClaimsSchema,
          fixture: () => ({ claims: matchClaims(section.body, docs) }),
        });
        // A claimed doc id must reference an attached doc — else unsupported.
        const factRefs: FactRef[] = result.claims.map((c) => ({
          claim: c.claim,
          researchDocId:
            c.researchDocId !== null && docIds.has(c.researchDocId)
              ? researchDocIdSchema.parse(c.researchDocId)
              : null,
        }));
        await deps.store.updateSection(input.workspaceId, row.id, { factRefs });
      }
    },

    // -- 7 ------------------------------------------------------------------
    quality_gate: async () => {
      const context = await ensureContext();
      let sections = await ensureSections();
      // The technique of the hook actually used: known in-run, recovered
      // from the chosen hook / candidate cache on a resumed run.
      const chosenHookStyle =
        state.pickedHookStyle ??
        params.chosenHook?.style ??
        deps.store.getHookCandidates(scriptId)?.find((c) => c.autoPicked)?.style ??
        null;
      const gateInput = () => ({
        sections,
        targetMinutes: context.frame.targetMinutes,
        tone: context.frame.tone,
        // Wave C: style-card gates — bannedClaims hard-fail, CTA placement,
        // hookPatternOk, and the per-card readingLevel band (which replaces
        // the global Flesch gate whenever a card is present).
        styleCard: context.styleCard,
        chosenHookStyle,
      });
      let report = computeQualityReport(gateInput());
      const violations = gateViolations(report);
      if (!report.passed && violations.length > 0) {
        // One auto-fix loop: LLM repair in live mode, code repair in fixture.
        const fixed = await generateJson({
          mode: deps.mode,
          llm: deps.llm,
          model: LLM_MODELS.sonnet,
          template: qualityFixPrompt({ context, sections, violations }),
          maxTokens: 8000,
          schema: sectionRewriteOutputSchema,
          fixture: () => ({ sections: applyCodeAutoFix(sections, report) }),
        });
        sections = acceptRewrite(sections, fixed.sections, "quality_gate");
        state.sections = sections;
        // Re-persist while preserving the fact refs computed in stage 6.
        const persisted = await deps.store.listSections(input.workspaceId, scriptId);
        const factRefs = new Map<number, FactRef[]>(persisted.map((row, i) => [i, row.factRefs]));
        await persistSections(sections, factRefs);
        report = computeQualityReport(gateInput(), { autoFixAttempted: true });
      }
      state.report = report;
      deps.store.saveQualityReport(scriptId, report);
      // Stats land here; `final` is set AFTER the completion charge below —
      // a script must never surface as final while unpaid (adversarial F1).
      await deps.store.updateScript(input.workspaceId, scriptId, {
        stats: scriptStats(sections),
      });
      await publish({ type: "quality_report", report });
    },
  };

  // The run hash folds in any preset outline/hook (a draft of a different
  // approved outline is a different run); legacy calls leave the fields
  // undefined, so their hashes — and stage-resume behavior — are unchanged.
  const inputHash = stageInputHash({
    input,
    scriptId,
    ...(params.presetOutline != null ? { presetOutline: params.presetOutline } : {}),
    ...(params.chosenHook != null ? { chosenHook: params.chosenHook } : {}),
  });

  // Metering (PRODUCT-CONTRACTS §4): the composite keeps its single -6;
  // draft charges its -4; the orchestrator writes ITEMIZED entries per
  // stage — outline (1) after the outline stage, hooks (1) when candidates
  // are produced (draft_sections), draft (4) on completion — summing to 6.
  // Every entry is keyed `<stage>:<input hash>`, so retries/resumes charge
  // exactly once per stage.
  const metering: ScriptRunMetering = params.metering ?? "composite";
  const stageCharges: Partial<Record<ScriptStage, StageCharge>> =
    metering === "itemized"
      ? {
          outline: {
            cost: CREDIT_COSTS.scriptOutline,
            key: `outline:${inputHash}`,
            reason: "script_outline",
          },
          draft_sections: {
            cost: CREDIT_COSTS.scriptHooks,
            key: `hooks:${inputHash}`,
            reason: "script_hooks",
          },
        }
      : {};
  const completionCharge: StageCharge =
    metering === "composite"
      ? {
          cost: CREDIT_COSTS.scriptGeneration,
          key: `script_generation:${inputHash}`,
          reason: "script_generation",
        }
      : { cost: CREDIT_COSTS.scriptDraft, key: `draft:${inputHash}`, reason: "script_draft" };
  const chargeStage = async (charge: StageCharge) => {
    await settleCharge(deps.store, {
      workspaceId: input.workspaceId,
      delta: -charge.cost,
      reason: charge.reason,
      actorUserId: params.actorUserId,
      projectId: input.projectId,
      idempotencyKey: charge.key,
    });
  };

  const runner = new PipelineRunner(deps.runs);
  const pipeline = {
    kind: "script" as const,
    stages: SCRIPT_STAGES.map((name) => ({
      name,
      run: async () => {
        await publish({ type: "stage_started", stage: name });
        await stageBodies[name]();
        const charge = stageCharges[name];
        if (charge !== undefined) await chargeStage(charge);
        await publish({ type: "stage_done", stage: name });
      },
    })),
  };

  const result = await runner.execute(pipeline, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    input: params,
    inputHash,
  });

  // Log the licensed-voice guard result on the voice_pass run (spec §5.7:
  // "log check result on pipeline_run"). Set whenever the guard ran this
  // invocation — on success and on hard-fail alike; skipped when voice_pass
  // resumed from a prior done run (the log persisted there already).
  if (state.guardLog !== undefined) {
    const runRow = await deps.runs.find({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "script",
      stage: "voice_pass",
      inputHash,
    });
    if (runRow !== null) {
      await deps.runs.update(runRow.id, { output: { licensedGuard: state.guardLog } });
    }
  }

  if (result.status === "done") {
    // Completion charge (spec §7) — never on failure, never twice: the
    // ledger key makes the charge idempotent, so it is attempted on EVERY
    // completed run (adversarial F1). A fully-resumed identical re-run
    // dedupes on the key; a retry whose first attempt crashed (or bounced
    // off the balance floor) between the last stage and the charge pays
    // here instead of finishing free. The script surfaces as `final` — and
    // `complete` is published — only after the charge lands; a charge
    // failure fails the run so the BullMQ retry re-attempts the charge.
    try {
      await chargeStage(completionCharge);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await publish({ type: "failed", stage: "quality_gate", message });
      return {
        status: "failed",
        stage: "quality_gate",
        error: message,
        skippedStages: result.skippedStages,
      };
    }
    await deps.store.updateScript(input.workspaceId, scriptId, { status: "final" });
    await publish({ type: "complete", scriptId: scriptIdSchema.parse(scriptId) });
  } else {
    await publish({
      type: "failed",
      stage: result.stage as (typeof SCRIPT_STAGES)[number],
      message: result.error,
    });
  }
  return result;
}
