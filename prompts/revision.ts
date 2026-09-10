import type { StyleCard } from "@/lib/types/entities";
import { bannedPhraseList } from "./banned-phrases";
import { jsonOnly, renderStyleCard } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.8 Revision pass — full-script read, line-level suggestion diffs.
 *
 * Suggestions are surgical: each targets a specific line range in a specific
 * section, with a replacement and a rationale the writer can judge in two
 * seconds. The writer accepts or rejects each independently, so suggestions
 * must never depend on each other.
 */

export interface RevisionPromptInput {
  sections: { id: string; kind: string; heading: string; body: string }[];
  styleCard: StyleCard | null;
  guidance: string | null;
}

export function revisionPrompt(input: RevisionPromptInput): PromptTemplate {
  const numbered = input.sections
    .map((s) => {
      const lines = s.body
        .split("\n")
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n");
      return `### [section:${s.id}] ${s.heading} [${s.kind}]\n${lines}`;
    })
    .join("\n\n");
  return {
    system: [
      "You are a script doctor doing a line-level pass on a finished",
      "YouTube script. Propose 3-12 surgical improvements. What earns a",
      "suggestion: a weak or generic line where a specific one exists; a",
      "buried punchline or payoff; a sentence that reads written rather",
      "than spoken; a vague quantity where the script's own material has a",
      "number; a limp transition; a repeated idea. What does NOT: matters",
      "of taste with no clear winner, restructuring across sections, and",
      "anything requiring new facts. Each suggestion: (1) targets one line",
      "range in one section (lineStart/lineEnd are 1-based, inclusive,",
      "into that section's numbered lines); (2) provides the full",
      "replacement text for those lines; (3) has a rationale under 25",
      "words naming the concrete gain; (4) stands alone — accepting any",
      "subset of suggestions must leave a coherent script, so never two",
      "suggestions on overlapping lines. Keep the creator's voice.",
      `Banned phrases:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Creator voice:",
      renderStyleCard(input.styleCard),
      "",
      input.guidance !== null ? `The creator asked for focus on: ${input.guidance}` : "",
      "Script (lines numbered per section):",
      numbered,
      "",
      jsonOnly(
        `{"suggestions": [{"sectionId": "<section id>", "lineStart": <int>, "lineEnd": <int>, "replacement": "<new text for those lines>", "suggestion": "<one-line label>", "rationale": "<why, under 25 words>"}]}`,
      ),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
