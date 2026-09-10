import { jsonOnly } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.7 stage 6 — fact-check (Haiku, per section).
 *
 * Extracts every factual claim from a section and matches it to a research
 * document or flags it unsupported. Conservative by design: a claim is
 * "supported" only when a research doc actually states its substance.
 */

export interface FactCheckPromptInput {
  sectionHeading: string;
  sectionBody: string;
  researchDocs: { id: string; title: string; content: string }[];
}

export function factCheckPrompt(input: FactCheckPromptInput): PromptTemplate {
  const docs =
    input.researchDocs.length > 0
      ? input.researchDocs
          .map((d) => `### [doc:${d.id}] ${d.title}\n${d.content}`)
          .join("\n\n---\n\n")
      : "(no research documents attached)";
  return {
    system: [
      "You are a fact-checker for YouTube scripts. From the section below,",
      "extract every FACTUAL claim — statistics, prices, dates, study",
      "results, technical assertions, claims about named people, products,",
      "or events. Opinions, jokes, personal anecdotes, and rhetorical",
      "questions are not claims. For each claim, find the research document",
      "that states its substance. Rules: a document supports a claim only",
      "if the document itself asserts it — topical overlap is NOT support;",
      "paraphrase is fine, contradiction or silence is not. When no",
      "document supports a claim, set researchDocId to null — flagging an",
      "unsupported claim is success, not failure. Copy claims verbatim",
      "enough to locate them in the section text.",
    ].join(" "),
    prompt: [
      `Section: ${input.sectionHeading}`,
      "",
      input.sectionBody,
      "",
      "Research documents:",
      docs,
      "",
      jsonOnly(
        `{"claims": [{"claim": "<the factual claim>", "researchDocId": "<doc id or null>"}]} — empty array if the section makes no factual claims`,
      ),
    ].join("\n"),
  };
}
