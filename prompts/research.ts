import type { PromptTemplate } from "./version";
import { jsonOnly } from "./shared";

/**
 * §5.5 Research agent prompts.
 *
 * plan: Haiku turns the user's research request into diverse search queries.
 * compile: Sonnet turns fetched pages into a brief where every factual claim
 * carries its source URL — the fact-check stage later matches script claims
 * against this brief, so precision here is what keeps scripts honest.
 */

export interface PlanQueriesInput {
  /** The user's research request, e.g. "budget espresso machines under $300". */
  query: string;
  projectTitle: string;
}

export function planQueriesPrompt(input: PlanQueriesInput): PromptTemplate {
  return {
    system: [
      "You plan web research for a YouTube scriptwriter. Given a research",
      "request, produce 3-6 search queries that together cover the topic from",
      "distinct angles. Good query sets mix: (1) the direct question, (2) data",
      "and numbers (statistics, benchmarks, prices, studies), (3) expert or",
      "practitioner takes and counterarguments, (4) recency — what changed",
      "this year. Queries are plain search strings, no operators, each under",
      "12 words, no two queries near-duplicates of each other.",
    ].join(" "),
    prompt: [
      `Video project: ${input.projectTitle}`,
      `Research request: ${input.query}`,
      "",
      jsonOnly(`{"queries": ["...", "..."]} — 3 to 6 strings`),
    ].join("\n"),
  };
}

export interface CompileBriefInput {
  query: string;
  projectTitle: string;
  sources: { url: string; title: string; text: string }[];
}

export function compileBriefPrompt(input: CompileBriefInput): PromptTemplate {
  const sourceBlocks = input.sources
    .map((s, i) => `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\n\n${s.text}`)
    .join("\n\n---\n\n");
  return {
    system: [
      "You compile research briefs for YouTube scripts. Extract only what a",
      "scriptwriter can actually use: concrete facts, numbers, named studies,",
      "prices, dates, expert claims, and surprising tensions between sources.",
      "Every factual claim in the brief MUST carry the URL of the source it",
      "came from, inline, in the form (source: URL). Never state a fact you",
      "cannot attribute to one of the provided sources. If sources disagree,",
      "say so explicitly — disagreements make great video moments. Omit",
      "filler, SEO padding, and anything the sources merely imply.",
    ].join(" "),
    prompt: [
      `Video project: ${input.projectTitle}`,
      `Research request: ${input.query}`,
      "",
      "Sources (already fetched and stripped to text):",
      "",
      sourceBlocks,
      "",
      jsonOnly(
        `{"title": "Research brief: <topic>", "content": "<markdown brief; every claim ends with (source: URL)>", "facts": [{"claim": "<one-sentence factual claim>", "sourceUrl": "<url it came from>"}]} — 5 to 25 facts, each claim self-contained and checkable`,
      ),
    ].join("\n"),
  };
}
