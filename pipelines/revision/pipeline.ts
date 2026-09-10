import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import type { Revision } from "@/lib/types/entities";
import { scriptSectionIdSchema } from "@/lib/types/ids";
import { REVISION_STAGES, type RevisionJobInput } from "@/lib/types/pipeline";
import { revisionPrompt } from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { EngineDeps } from "@/pipelines/script/deps";
import { synthRevisionSuggestions } from "@/pipelines/script/fixture-content";
import { stageInputHash } from "@/pipelines/script/hash";
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
                  sectionId: (section?.id ?? ""),
                  lineStart: s.lineStart,
                  lineEnd: s.lineEnd,
                  replacement: s.replacement,
                  suggestion: s.suggestion,
                  rationale: s.rationale,
                };
              }),
            }),
          });

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
            rows.push({
              workspaceId: input.workspaceId,
              scriptId: input.scriptId,
              sectionId: scriptSectionIdSchema.parse(suggestion.sectionId),
              suggestion: suggestion.suggestion,
              diff: [
                {
                  lineStart: suggestion.lineStart,
                  lineEnd: Math.min(suggestion.lineEnd, lineCount),
                  replacement: suggestion.replacement,
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

  if (result.status === "done") {
    const script = await deps.store.getScript(input.workspaceId, input.scriptId);
    await deps.store.recordCredits({
      workspaceId: input.workspaceId,
      delta: -2,
      reason: "revision_pass",
      actorUserId: params.actorUserId,
      projectId: script?.projectId ?? null,
    });
  }
  return { result, revisions: inserted };
}
