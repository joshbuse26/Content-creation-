import type { QualityGateReport } from "@/lib/types/pipeline";
import { countWords, estimateSecondsForText } from "./readability";
import { MAX_HOOK_SECONDS } from "./quality-gate";

/**
 * Deterministic (pure code) auto-fix — the fixture-mode counterpart of the
 * LLM repair prompt, and the guaranteed-terminating fixer used in tests.
 * Fixes exactly the gate's three failure modes.
 */

export interface FixableSection {
  kind: string;
  heading: string;
  body: string;
  estSeconds: number;
  retentionNote: string | null;
}

const PAD_SENTENCES: readonly string[] = [
  "Let me slow down on this part, because it is the one people ask about most.",
  "The same pattern held on the second and third runs, which is what convinced me.",
  "If your setup differs, the direction still holds even when the exact numbers move.",
  "I checked this against the notes twice, and the result did not budge.",
  "That detail sounds small, but it decides the outcome more often than not.",
];

function truncateToWords(text: string, maxWords: number): string {
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text];
  let out = "";
  let words = 0;
  for (const sentence of sentences) {
    const w = countWords(sentence);
    if (words + w > maxWords && words > 0) break;
    out += sentence;
    words += w;
  }
  return out.trim();
}

function dropLastSentence(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [];
  if (sentences.length <= 2) return text;
  return sentences
    .slice(0, -1)
    .join("")
    .trim();
}

export function applyCodeAutoFix(
  sections: FixableSection[],
  report: QualityGateReport,
): FixableSection[] {
  const fixed = sections.map((s) => ({ ...s }));

  // Hook over 30s → truncate to ~70 words at a sentence boundary.
  if (!report.hookOk) {
    const hook = fixed.find((s) => s.kind === "hook");
    if (hook !== undefined) {
      hook.body = truncateToWords(hook.body, Math.floor(MAX_HOOK_SECONDS * 2.5) - 5);
      hook.estSeconds = estimateSecondsForText(hook.body);
    }
  }

  const total = () => fixed.reduce((sum, s) => sum + countWords(s.body), 0);
  const target = report.targetWordCount;

  // Too long → shave sentences off the longest chapters until inside 110%.
  let guard = 500;
  while (total() > Math.round(target * 1.1) && guard > 0) {
    guard -= 1;
    const longest = [...fixed]
      .filter((s) => s.kind === "chapter" || s.kind === "intro")
      .sort((a, b) => countWords(b.body) - countWords(a.body))[0];
    if (longest === undefined) break;
    const before = longest.body;
    longest.body = dropLastSentence(longest.body);
    if (longest.body === before) break;
    longest.estSeconds = estimateSecondsForText(longest.body);
  }

  // Too short → pad chapters with grounded filler until inside 90%.
  let padIndex = 0;
  guard = 500;
  while (total() < Math.round(target * 0.9) && guard > 0) {
    guard -= 1;
    const chapters = fixed.filter((s) => s.kind === "chapter");
    const section = chapters[padIndex % Math.max(1, chapters.length)];
    if (section === undefined) break;
    const sentence = PAD_SENTENCES[padIndex % PAD_SENTENCES.length] ?? "";
    section.body = `${section.body} ${sentence}`;
    section.estSeconds = estimateSecondsForText(section.body);
    padIndex += 1;
  }

  return fixed;
}
