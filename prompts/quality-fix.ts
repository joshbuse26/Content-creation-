import type { ScriptContext } from "@/lib/types/pipeline";
import { bannedPhraseList } from "./banned-phrases";
import { jsonOnly, renderStyleCard } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.7 stage 7 auto-fix — one targeted repair pass when the (pure-code)
 * quality gate fails. The prompt receives the exact violations so the model
 * fixes precisely those, instead of re-rolling the whole script.
 */

export interface QualityFixPromptInput {
  context: ScriptContext;
  sections: {
    kind: string;
    heading: string;
    body: string;
    estSeconds: number;
    retentionNote: string | null;
  }[];
  violations: string[];
}

export function qualityFixPrompt(input: QualityFixPromptInput): PromptTemplate {
  const draft = input.sections
    .map((s) => `## ${s.heading} [${s.kind}, ${s.estSeconds}s]\n${s.body}`)
    .join("\n\n");
  return {
    system: [
      "You repair a YouTube script that failed automated quality checks.",
      "Fix ONLY the listed violations, with the smallest edits that clear",
      "them:",
      "- word count too high → cut filler, redundancy, and the weakest",
      "asides; never cut facts, re-hooks, or the payoff.",
      "- word count too low → deepen existing points with specifics already",
      "implied by the script's research; do not pad or invent facts.",
      "- readability too low → shorter sentences, plainer words, one idea",
      "per sentence; keep necessary technical terms.",
      "- hook too long → tighten the hook to under 30 spoken seconds",
      "(~75 words) while keeping its technique intact.",
      "Everything not implicated by a violation stays exactly as written.",
      `Keep the creator's voice. Banned phrases:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Creator voice:",
      renderStyleCard(input.context.styleCard),
      "",
      "Violations to fix:",
      input.violations.map((v) => `- ${v}`).join("\n"),
      "",
      "Script:",
      draft,
      "",
      jsonOnly(
        `{"sections": [{"kind": "...", "heading": "...", "body": "<repaired text>", "estSeconds": <int>, "retentionNote": "<unchanged, or null>"}]} — same sections, same order, same kinds and headings`,
      ),
    ].join("\n"),
  };
}
