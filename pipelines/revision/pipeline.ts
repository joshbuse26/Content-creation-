import { z } from "zod";
import { getConfig, LLM_MODELS } from "@/lib/config";
import { licensedGuardProfile } from "@/lib/multi-voice";
import type { Revision, VoiceProfile } from "@/lib/types/entities";
import { scriptSectionIdSchema } from "@/lib/types/ids";
import { REVISION_STAGES, type RevisionJobInput } from "@/lib/types/pipeline";
import { revisionPrompt } from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { EngineDeps } from "@/pipelines/script/deps";
import { synthRevisionSuggestions } from "@/pipelines/script/fixture-content";
import { stageInputHash } from "@/pipelines/script/hash";
import { runLicensedGuard, LicensedGuardBlockedError } from "@/pipelines/script/licensed-guard";
import { generateJson } from "@/pipelines/script/llm-json";
import type { NewRevision } from "@/pipelines/script/store";

/**
 * §5.8 Revision pass — full script → line-level suggestion diffs, persisted
 * as pending revisions the writer accepts/rejects individually.
 * 2 credits on completion.
 */

const rawSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      sectionId: z.string().min(1),
      lineStart: z.number().int().min(1),
      lineEnd: z.number().int().min(1),
      replacement: z.string(),
      suggestion: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
});

export interface RevisionPipelineParams {
  input: RevisionJobInput;
  actorUserId: string | null;
}

export async function runRevisionPipeline(
  deps: EngineDeps,
  params: RevisionPipelineParams,
): Promise<{ result: PipelineResult; revisions: Revision[] }> {
  const { input } = params;
  let inserted: Revision[] = [];

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "revision",
      stages: REVISION_STAGES.map((name) => ({
        name,
        run: async () => {
          const script = await deps.store.getScript(input.workspaceId, input.scriptId);
          if (script === null) throw new Error("script not found for revision pass");
          const sections = await deps.store.listSections(input.workspaceId, input.scriptId);
          if (sections.length === 0) throw new Error("script has no sections to revise");
          const voiceProfile =
            script.voiceProfileId === null
              ? null
              : await deps.store.getVoiceProfile(input.workspaceId, script.voiceProfileId);

          const raw = await generateJson({
            mode: deps.mode,
            llm: deps.llm,
            model: LLM_MODELS.sonnet,
            template: revisionPrompt({
              sections: sections.map((s) => ({
                id: s.id,
                kind: s.kind,
                heading: s.heading,
                body: s.body,
              })),
              styleCard: voiceProfile?.styleCard ?? null,
              guidance: input.guidance ?? null,
            }),
            maxTokens: 6000,
            temperature: 0.6,
            schema: rawSuggestionsSchema,
            fixture: () => ({
              suggestions: synthRevisionSuggestions(
                sections.map((s) => ({ kind: s.kind, body: s.body })),
              ).map((s) => {
                const section = sections[s.sectionIndex];
                return {
                  sectionId: section?.id ?? "",
                  lineStart: s.lineStart,
                  lineEnd: s.lineEnd,
                  replacement: s.replacement,
                  suggestion: s.suggestion,
                  rationale: s.rationale,
                };
              }),
            }),
          });

          // Licensed-voice similarity guard (PRODUCT-CONTRACTS §7, P1-2): a
          // suggestion whose EFFECTIVE voice is licensed has its `replacement`
          // checked against the licensed source BEFORE it is persisted as a
          // pending suggestion — over-similar replacements are auto-rewritten
          // once, and dropped if still over the line, so no verbatim-reuse
          // suggestion is ever offered. The effective voice is the section's own
          // override (multi-voice) when set, else the script-level voice.
          const overrideCache = new Map<string, VoiceProfile | null>();
          const resolveLicensedProfile = async (
            section: (typeof sections)[number],
          ): Promise<VoiceProfile | null> => {
            let override: VoiceProfile | null = null;
            if (section.voiceProfileId !== null) {
              const key = section.voiceProfileId as string;
              if (!overrideCache.has(key)) {
                overrideCache.set(
                  key,
                  await deps.store.getVoiceProfile(input.workspaceId, section.voiceProfileId),
                );
              }
              override = overrideCache.get(key) ?? null;
            }
            return licensedGuardProfile(override, voiceProfile);
          };

          // Validate every suggestion against the real sections; drop the
          // invalid rather than failing the run over one bad line range.
          const byId = new Map(sections.map((s) => [s.id as string, s]));
          const rows: NewRevision[] = [];
          for (const suggestion of raw.suggestions) {
            const section = byId.get(suggestion.sectionId);
            if (section === undefined) continue;
            const lineCount = section.body.split("\n").length;
            if (
              suggestion.lineStart > lineCount ||
              suggestion.lineEnd < suggestion.lineStart ||
              section.locked
            ) {
              continue;
            }
            let replacement = suggestion.replacement;
            const licensedProfile = await resolveLicensedProfile(section);
            if (licensedProfile !== null) {
              try {
                const guard = await runLicensedGuard({
                  mode: deps.mode,
                  llm: deps.llm,
                  threshold: getConfig().LICENSED_SIMILARITY_MAX_OVERLAP,
                  sections: [{ position: 0, body: replacement, licensedProfile }],
                });
                replacement = guard?.rewrites.get(0) ?? replacement;
              } catch (err) {
                // Still over the line after the one rewrite (or no material to
                // check against): drop the suggestion rather than offer it.
                if (err instanceof LicensedGuardBlockedError) continue;
                throw err;
              }
            }
            rows.push({
              workspaceId: input.workspaceId,
              scriptId: input.scriptId,
              sectionId: scriptSectionIdSchema.parse(suggestion.sectionId),
              suggestion: suggestion.suggestion,
              diff: [
                {
                  lineStart: suggestion.lineStart,
                  lineEnd: Math.min(suggestion.lineEnd, lineCount),
                  replacement,
                },
              ],
              rationale: suggestion.rationale,
            });
          }
          if (rows.length === 0) throw new Error("revision pass produced no valid suggestions");
          inserted = await deps.store.insertRevisions(rows);
          await deps.store.updateScript(input.workspaceId, input.scriptId, {
            status: "revising",
          });
        },
      })),
    },
    {
      workspaceId: input.workspaceId,
      projectId: null,
      input: params,
      inputHash: stageInputHash(input),
    },
  );

  if (result.status === "done" && result.skippedStages.length !== REVISION_STAGES.length) {
    // 2 credits on completion — never on failure, never twice (idempotent
    // per input hash), and not for an all-skipped resume.
    const script = await deps.store.getScript(input.workspaceId, input.scriptId);
    await deps.store.recordCredits({
      workspaceId: input.workspaceId,
      delta: -2,
      reason: "revision_pass",
      actorUserId: params.actorUserId,
      projectId: script?.projectId ?? null,
      idempotencyKey: `revision_pass:${stageInputHash(input)}`,
    });
  }
  return { result, revisions: inserted };
}
