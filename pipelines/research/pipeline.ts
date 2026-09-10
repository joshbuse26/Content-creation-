import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  RESEARCH_STAGES,
  plannedQueriesSchema,
  researchBriefSchema,
  type FetchedSource,
  type ResearchJobInput,
} from "@/lib/types/pipeline";
import { compileBriefPrompt, planQueriesPrompt } from "@/prompts";
import { PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { EngineDeps } from "@/pipelines/script/deps";
import { synthArticleText, synthBrief, synthQueries } from "@/pipelines/script/fixture-content";
import { stageInputHash } from "@/pipelines/script/hash";
import { generateJson } from "@/pipelines/script/llm-json";
import { countWords } from "@/pipelines/script/readability";
import { guardedFetch, htmlToText, SsrfBlockedError } from "./ssrf";

/**
 * §5.5 Research agent: plan queries (Haiku) → search top-8 → guarded
 * server-side page fetch → compile brief with per-fact source URLs (Sonnet)
 * → persist as a research_doc. Recorded on pipeline_runs under kind
 * "script" (the frozen kind enum has no research member; stage names are
 * distinct so runs stay unambiguous).
 */

export const RESEARCH_DOC_CONTENT_CAP = 200_000;
const MAX_SOURCES = 8;

export interface ResearchPipelineParams {
  input: ResearchJobInput;
  actorUserId: string | null;
}

interface ResearchRunState {
  queries?: string[];
  sources?: FetchedSource[];
}

export async function runResearchPipeline(
  deps: EngineDeps,
  params: ResearchPipelineParams,
): Promise<PipelineResult> {
  const { input } = params;
  const state: ResearchRunState = {};

  const stageBodies: Record<(typeof RESEARCH_STAGES)[number], () => Promise<void>> = {
    plan_queries: async () => {
      const project = await deps.store.getProject(input.workspaceId, input.projectId);
      if (project === null) throw new Error("project not found for research run");
      const planned = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.haiku,
        template: planQueriesPrompt({ query: input.query, projectTitle: project.title }),
        maxTokens: 600,
        temperature: 0.4,
        schema: plannedQueriesSchema,
        fixture: () => synthQueries(input.query),
      });
      state.queries = planned.queries;
    },

    fetch_sources: async () => {
      const queries = state.queries ?? synthQueries(input.query).queries;
      const seen = new Set<string>();
      const candidates: { url: string; title: string }[] = [];
      for (const query of queries) {
        const results = await deps.search.search(query, MAX_SOURCES);
        for (const result of results) {
          if (seen.has(result.url)) continue;
          seen.add(result.url);
          candidates.push({ url: result.url, title: result.title });
        }
        if (candidates.length >= MAX_SOURCES * 2) break;
      }
      const sources: FetchedSource[] = [];
      for (const candidate of candidates) {
        if (sources.length >= MAX_SOURCES) break;
        if (deps.mode === "fixture") {
          sources.push({
            url: candidate.url,
            title: candidate.title,
            text: synthArticleText(candidate.url, candidate.title),
          });
          continue;
        }
        try {
          const page = await guardedFetch(candidate.url);
          if (page.status !== 200 || page.body === "") continue;
          const { title, text } = htmlToText(page.body);
          if (text.length < 200) continue;
          sources.push({
            url: page.finalUrl,
            title: title ?? candidate.title,
            text: text.slice(0, 60_000),
          });
        } catch (err) {
          // Blocked or failed fetches are skipped, never fatal to the run.
          if (err instanceof SsrfBlockedError) {
            logger.warn({ url: candidate.url }, "research fetch blocked by SSRF guard");
          } else {
            logger.warn(
              { url: candidate.url, err: err instanceof Error ? err.message : String(err) },
              "research fetch failed",
            );
          }
        }
      }
      if (sources.length === 0) throw new Error("no fetchable sources for research run");
      state.sources = sources;
    },

    compile_brief: async () => {
      const project = await deps.store.getProject(input.workspaceId, input.projectId);
      if (project === null) throw new Error("project not found for research run");
      const sources = state.sources ?? [];
      if (sources.length === 0) throw new Error("no sources available to compile");
      const brief = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: compileBriefPrompt({
          query: input.query,
          projectTitle: project.title,
          sources,
        }),
        maxTokens: 8000,
        temperature: 0.3,
        schema: researchBriefSchema,
        fixture: () => synthBrief(input.query, sources),
      });
      const content = brief.content.slice(0, RESEARCH_DOC_CONTENT_CAP);
      await deps.store.insertResearchDoc({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        kind: "web",
        sourceUrl: null,
        title: brief.title,
        content,
        wordCount: countWords(content),
      });
    },
  };

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "script",
      stages: RESEARCH_STAGES.map((name) => ({
        name,
        run: () => stageBodies[name](),
      })),
    },
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      input: params,
      inputHash: stageInputHash(input),
    },
  );

  if (result.status === "done") {
    // 1 credit per research run (spec §7), charged on completion.
    await deps.store.recordCredits({
      workspaceId: input.workspaceId,
      delta: -1,
      reason: "research_run",
      actorUserId: params.actorUserId,
      projectId: input.projectId,
    });
  }
  return result;
}
