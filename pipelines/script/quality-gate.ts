import type { StyleCard } from "@/lib/types/entities";
import type { QualityGateReport } from "@/lib/types/pipeline";
import { computeStyleGates } from "@/lib/style-gates";
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
 *
 * Wave C (PRODUCT-CONTRACTS §6): when a style card is in play the report
 * also carries styleGates — bannedClaims scan (HARD FAIL) and CTA placement
 * are computed here via lib/style-gates.ts; hookPatternOk and the per-card
 * readingLevel (which will REPLACE the global Flesch gate when present) are
 * typed but computed by C1's staged pipeline. Until C1 lands, the global
 * Flesch gate still applies even with a card.
 */

export const WORD_TOLERANCE = 0.15;
export const MIN_FLESCH = 60;
export const MAX_HOOK_SECONDS = 30;

export interface GateInput {
  sections: { kind: string; heading: string; body: string; estSeconds: number }[];
  targetMinutes: number;
  tone: string;
  /** Style card driving the per-card gates; omit/null for legacy scripts. */
  styleCard?: StyleCard | null;
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

  // -- style-card gates (wave C) --------------------------------------------
  const card = input.styleCard ?? null;
  const styleGates = card === null ? null : computeStyleGates(input.sections, card);
  if (styleGates !== null) {
    for (const hit of styleGates.bannedClaimHits) {
      warnings.push(
        `Banned claim (${hit.claimType}) in "${hit.sectionHeading}": "${hit.excerpt}".`,
      );
    }
    warnings.push(...styleGates.notes);
  }
  const styleGatesPass =
    styleGates === null || (styleGates.bannedClaimsOk && styleGates.ctaPlacementOk);

  return {
    passed: wordCountWithinTolerance && readabilityOk && hookOk && styleGatesPass,
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
    styleGates,
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
    violations.push(
      `Hook runs ~${report.hookSeconds} spoken seconds; tighten to under 30 (~75 words).`,
    );
  }
  if (report.styleGates !== null) {
    for (const hit of report.styleGates.bannedClaimHits) {
      violations.push(
        `Remove the banned ${hit.claimType} claim ("${hit.excerpt}") — rephrase without the promissory/absolute framing.`,
      );
    }
    if (!report.styleGates.ctaPlacementOk) {
      violations.push(
        `Fix CTA placement: ${report.styleGates.notes.join(" ") || "match the style card's CTA habits."}`,
      );
    }
  }
  return violations;
}
