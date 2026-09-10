import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import type { FactRef } from "@/lib/types/entities";
import {
  SCRIPT_STAGES,
  outlineSchema,
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
import {
  factCheckPrompt,
  hookPrompt,
  outlinePrompt,
  qualityFixPrompt,
  retentionPrompt,
  sectionPrompt,
  voicePrompt,
} from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import { applyCodeAutoFix } from "./auto-fix";
import { assembleContext } from "./context";
import type { EngineDeps } from "./deps";
import {
  synthHookCandidates,
  synthOutline,
  synthRetentionNote,
  synthRetentionRewrite,
  synthSectionBody,
  synthVoiceRewrite,
} from "./fixture-content";
import { matchClaims } from "./fact-match";
import { stageInputHash } from "./hash";
import { generateJson } from "./llm-json";
import { computeQualityReport, gateViolations } from "./quality-gate";
import {
  estimateSeconds,
  estimateSecondsForText,
  countWords,
  fleschReadingEase,
} from "./readability";
import type { NewSection } from "./store";

/**
 * §5.7 — the script agent. Seven stages, exactly as named in the frozen
 * SCRIPT_STAGES, executed by the shared PipelineRunner (which owns per-stage
 * retries and resume), streaming ScriptStreamEvents to the editor.
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
  sections?: WorkingSection[];
  report?: QualityGateReport;
}

export interface ScriptPipelineParams {
  input: ScriptJobInput;
  scriptId: ScriptId;
  actorUserId: string | null;
}

const hookCandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        style: z.enum(["open_loop", "bold_claim", "stakes", "in_medias_res"]),
        body: z.string().min(1),
      }),
    )
    .length(3),
});

const sectionBodySchema = z.object({ body: z.string().min(1) });

const factClaimsSchema = z.object({
  claims: z.array(z.object({ claim: z.string().min(1), researchDocId: z.string().nullable() })),
});

function pickHookStyle(outcome: ScriptContext["frame"]["outcome"]): string {
  if (outcome === "watch_time") return "open_loop";
  if (outcome === "subs") return "bold_claim";
  return "stakes";
}

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
    state.context = assembleContext({ frame, researchDocs, avatar, voiceProfile });
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
      const outline = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: outlinePrompt({ context }),
        maxTokens: 4000,
        schema: outlineSchema,
        fixture: () => synthOutline(context),
      });
      // Code-normalize: scale targetSeconds to the frame target if the model
      // overshot the ±10% budget instead of burning a retry on arithmetic.
      const total = outline.sections.reduce((sum, s) => sum + s.targetSeconds, 0);
      const target = context.frame.targetMinutes * 60;
      if (Math.abs(total - target) / target > 0.1) {
        const scale = target / total;
        outline.sections = outline.sections.map((s) => ({
          ...s,
          targetSeconds: Math.max(10, Math.round(s.targetSeconds * scale)),
        }));
      }
      state.outline = outline;
      await publish({ type: "outline", outline });
    },

    // -- 3 ------------------------------------------------------------------
    draft_sections: async () => {
      const context = await ensureContext();
      const outline = state.outline ?? synthOutline(context);
      state.outline = outline;

      // Hook first: three tagged candidates, auto-pick by frame outcome.
      const hookResult = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: hookPrompt({ context, outline }),
        maxTokens: 1500,
        temperature: 0.9,
        schema: hookCandidatesSchema,
        fixture: () => ({ candidates: synthHookCandidates(context) }),
      });
      const preferred = pickHookStyle(context.frame.outcome);
      const pickedIndex = Math.max(
        0,
        hookResult.candidates.findIndex((c) => c.style === preferred),
      );
      const candidates: HookCandidate[] = hookResult.candidates.map((c, i) => ({
        style: c.style,
        body: c.body,
        autoPicked: i === pickedIndex,
      }));
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
          const picked = candidates[pickedIndex];
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
      await persistSections(state.sections);
      await deps.store.updateScript(input.workspaceId, scriptId, {
        stats: scriptStats(state.sections),
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
      const gateInput = () => ({
        sections,
        targetMinutes: context.frame.targetMinutes,
        tone: context.frame.tone,
      });
      let report = computeQualityReport(gateInput());
      if (!report.passed) {
        // One auto-fix loop: LLM repair in live mode, code repair in fixture.
        const violations = gateViolations(report);
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
      await deps.store.updateScript(input.workspaceId, scriptId, {
        status: "final",
        stats: scriptStats(sections),
      });
      await publish({ type: "quality_report", report });
    },
  };

  const runner = new PipelineRunner(deps.runs);
  const pipeline = {
    kind: "script" as const,
    stages: SCRIPT_STAGES.map((name) => ({
      name,
      run: async () => {
        await publish({ type: "stage_started", stage: name });
        await stageBodies[name]();
        await publish({ type: "stage_done", stage: name });
      },
    })),
  };

  const result = await runner.execute(pipeline, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    input: params,
    inputHash: stageInputHash({ input, scriptId }),
  });

  if (result.status === "done") {
    // Charge 6 credits on completion (spec §7) — never on failure.
    await deps.store.recordCredits({
      workspaceId: input.workspaceId,
      delta: -6,
      reason: "script_generation",
      actorUserId: params.actorUserId,
      projectId: input.projectId,
    });
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
