import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import type { TitleSet } from "@/lib/types/entities";
import { TITLES_STAGES, type TitlesJobInput } from "@/lib/types/pipeline";
import { scoreTitlesPrompt, titlesPrompt } from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { EngineDeps } from "./deps";
import { synthTitles, synthTitleScores } from "./fixture-content";
import { stageInputHash } from "./hash";
import { generateJson } from "./llm-json";

/**
 * §5.9 Titles — 25 options across ≥5 pattern families (Sonnet), each scored
 * 0-100 (Haiku). Persisted as a title_set; 1 credit on completion.
 * Runs under pipeline kind "script" (frozen kind enum has no titles member).
 */

const rawTitlesSchema = z.object({
  options: z
    .array(z.object({ text: z.string().min(1).max(100), patternFamily: z.string().min(1) }))
    .min(20)
    .max(30),
});

const scoresSchema = z.object({ scores: z.array(z.number().min(0).max(100)) });

export interface TitlesPipelineParams {
  input: TitlesJobInput;
  actorUserId: string | null;
}

interface TitlesRunState {
  options?: { text: string; patternFamily: string }[];
}

export async function runTitlesPipeline(
  deps: EngineDeps,
  params: TitlesPipelineParams,
): Promise<{ result: PipelineResult; titleSet: TitleSet | null }> {
  const { input } = params;
  const state: TitlesRunState = {};
  let saved: TitleSet | null = null;

  const stageBodies: Record<(typeof TITLES_STAGES)[number], () => Promise<void>> = {
    generate_titles: async () => {
      const project = await deps.store.getProject(input.workspaceId, input.projectId);
      if (project === null) throw new Error("project not found for title generation");
      const frames = await deps.store.listFrames(input.workspaceId, input.projectId);
      const chosen = frames.find((f) => f.chosen) ?? frames[0] ?? null;
      const sectionsOfLatest = await (async () => {
        const scripts = await deps.store.listScriptVersions(input.workspaceId, input.projectId);
        const latest = scripts[0];
        if (latest === undefined) return [];
        return deps.store.listSections(input.workspaceId, latest.id);
      })();
      const hook = sectionsOfLatest.find((s) => s.kind === "hook");
      const generated = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: titlesPrompt({
          projectTitle: project.title,
          frameAngle: chosen?.angle ?? project.title,
          format: chosen?.format ?? "other",
          keywords: chosen?.keywords ?? [],
          hookBody: hook?.body ?? null,
          nicheTitleExamples: [],
        }),
        maxTokens: 3000,
        temperature: 0.9,
        schema: rawTitlesSchema,
        fixture: () => ({
          options: synthTitles({
            projectTitle: project.title,
            frameAngle: chosen?.angle ?? project.title,
          }),
        }),
      });
      const families = new Set(generated.options.map((o) => o.patternFamily));
      if (families.size < 5) {
        throw new Error(`title set spans only ${families.size} pattern families; need at least 5`);
      }
      state.options = generated.options;
    },

    score_titles: async () => {
      const options = state.options;
      if (options === undefined) throw new Error("no generated titles to score");
      const project = await deps.store.getProject(input.workspaceId, input.projectId);
      if (project === null) throw new Error("project not found for title scoring");
      const frames = await deps.store.listFrames(input.workspaceId, input.projectId);
      const chosen = frames.find((f) => f.chosen) ?? frames[0] ?? null;
      const scored = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.haiku,
        template: scoreTitlesPrompt({
          titles: options,
          nicheTitleExamples: [],
          frameAngle: chosen?.angle ?? project.title,
        }),
        maxTokens: 1200,
        temperature: 0,
        schema: scoresSchema,
        fixture: () => ({ scores: synthTitleScores(options) }),
      });
      if (scored.scores.length !== options.length) {
        throw new Error(
          `scored ${scored.scores.length} titles but generated ${options.length}`,
        );
      }
      saved = await deps.store.insertTitleSet({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        options: options.map((o, i) => ({
          text: o.text,
          patternFamily: o.patternFamily,
          score: Math.round(scored.scores[i] ?? 0),
        })),
      });
    },
  };

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "script",
      stages: TITLES_STAGES.map((name) => ({ name, run: () => stageBodies[name]() })),
    },
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      input: params,
      inputHash: stageInputHash(input),
    },
  );

  if (result.status === "done") {
    await deps.store.recordCredits({
      workspaceId: input.workspaceId,
      delta: -1,
      reason: "titles",
      actorUserId: params.actorUserId,
      projectId: input.projectId,
    });
  }
  return { result, titleSet: saved };
}
