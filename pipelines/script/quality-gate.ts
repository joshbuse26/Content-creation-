import type { QualityGateReport } from "@/lib/types/pipeline";
import { findBannedPhrases } from "@/prompts";
import { countWords, estimateSeconds, fleschReadingEase, WORDS_PER_MINUTE } from "./readability";

/**
 * §5.7 stage 7 — the quality gate. Pure code, no LLM:
 * - word count within ±15% of frame target (targetMinutes × 150)
 * - Flesch reading ease ≥ 60 unless the tone declares itself academic
 * - runtime estimated at 150 wpm
 * - hook ≤ 30 spoken seconds
 * Failures trigger ONE auto-fix loop (LLM repair, then re-check); remaining
 * problems surface as warnings on the report, never silently.
 */

export const WORD_TOLERANCE = 0.15;
export const MIN_FLESCH = 60;
export const MAX_HOOK_SECONDS = 30;

export interface GateInput {
  sections: { kind: string; heading: string; body: string; estSeconds: number }[];
  targetMinutes: number;
  tone: string;
}

export function isAcademicTone(tone: string): boolean {
  return /academic|scholar|lecture/i.test(tone);
}

export function computeQualityReport(
  input: GateInput,
  options: { autoFixAttempted: boolean } = { autoFixAttempted: false },
): QualityGateReport {
  const fullText = input.sections.map((s) => s.body).join("\n\n");
  const wordCount = countWords(fullText);
  const targetWordCount = input.targetMinutes * WORDS_PER_MINUTE;
  const lower = Math.round(targetWordCount * (1 - WORD_TOLERANCE));
  const upper = Math.round(targetWordCount * (1 + WORD_TOLERANCE));
  const wordCountWithinTolerance = wordCount >= lower && wordCount <= upper;

  const fleschScore = fleschReadingEase(fullText);
  const readabilityOk = isAcademicTone(input.tone) || fleschScore >= MIN_FLESCH;

  const estRuntimeSeconds = estimateSeconds(wordCount);

  const hook = input.sections.find((s) => s.kind === "hook");
  const hookWords = hook === undefined ? 0 : countWords(hook.body);
  const hookSeconds = estimateSeconds(hookWords);
  const hookOk = hook !== undefined && hookSeconds <= MAX_HOOK_SECONDS;

  const warnings: string[] = [];
  if (!wordCountWithinTolerance) {
    warnings.push(
      `Word count ${wordCount} is outside ±15% of the ${targetWordCount}-word target (${lower}–${upper}).`,
    );
  }
  if (!readabilityOk) {
    warnings.push(`Flesch reading ease ${fleschScore} is below ${MIN_FLESCH}.`);
  }
  if (hook === undefined) {
    warnings.push("Script has no hook section.");
  } else if (!hookOk) {
    warnings.push(`Hook runs ~${hookSeconds}s spoken (${hookWords} words); the cap is 30s.`);
  }
  const banned = findBannedPhrases(fullText);
  if (banned.length > 0) {
    warnings.push(`Banned phrases still present: ${banned.join(", ")}.`);
  }
  for (const s of input.sections) {
    if (s.kind === "chapter" && s.estSeconds > 300) {
      warnings.push(`Chapter "${s.heading}" runs ${s.estSeconds}s — consider splitting past 300s.`);
    }
  }

  return {
    passed: wordCountWithinTolerance && readabilityOk && hookOk,
    wordCount,
    targetWordCount,
    wordCountWithinTolerance,
    fleschReadingEase: fleschScore,
    readabilityOk,
    estRuntimeSeconds,
    hookSeconds,
    hookOk,
    warnings,
    autoFixAttempted: options.autoFixAttempted,
  };
}

/** The violations list handed to the auto-fix prompt — gate failures only. */
export function gateViolations(report: QualityGateReport): string[] {
  const violations: string[] = [];
  if (!report.wordCountWithinTolerance) {
    violations.push(
      report.wordCount > report.targetWordCount
        ? `Script is ${report.wordCount} words; cut to within 15% of ${report.targetWordCount}.`
        : `Script is ${report.wordCount} words; expand to within 15% of ${report.targetWordCount} without padding.`,
    );
  }
  if (!report.readabilityOk) {
    violations.push(
      `Flesch reading ease is ${report.fleschReadingEase}; raise above ${MIN_FLESCH} with shorter sentences and plainer words.`,
    );
  }
  if (!report.hookOk) {
    violations.push(`Hook runs ~${report.hookSeconds} spoken seconds; tighten to under 30 (~75 words).`);
  }
  return violations;
}
