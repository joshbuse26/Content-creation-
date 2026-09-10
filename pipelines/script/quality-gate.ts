import type { StyleCard } from "@/lib/types/entities";
import type { HookStyle } from "@/lib/types/enums";
import type { QualityGateReport } from "@/lib/types/pipeline";
import { computeStyleGates } from "@/lib/style-gates";
import { findBannedPhrases } from "@/prompts";
import {
  countWords,
  estimateSeconds,
  fleschKincaidGrade,
  fleschReadingEase,
  WORDS_PER_MINUTE,
} from "./readability";

/**
 * §5.7 stage 7 — the quality gate. Pure code, no LLM:
 * - word count within ±15% of frame target (targetMinutes × 150)
 * - readability: Flesch reading ease ≥ 60 (unless the tone declares itself
 *   academic) — REPLACED by the card's readingLevel band when a card is
 *   present (see below)
 * - runtime estimated at 150 wpm
 * - hook ≤ 30 spoken seconds
 * Failures trigger ONE auto-fix loop (LLM repair, then re-check); remaining
 * problems surface as warnings on the report, never silently.
 *
 * Wave C (PRODUCT-CONTRACTS §6), completed by C1: when a style card is in
 * play the report carries a fully-evaluated styleGates block —
 * - bannedClaims scan (HARD FAIL) + CTA placement via lib/style-gates.ts;
 * - readingGrade/readingLevelOk: Flesch–Kincaid grade vs the CARD's band,
 *   which REPLACES the global Flesch ≥ 60 gate (`readabilityOk` reflects
 *   it). The check is one-sided: a grade ABOVE maxGrade fails (too complex
 *   for the audience); a grade below minGrade only warns — simpler-than-
 *   target spoken prose never hurts retention;
 * - hookPatternOk: chosen hook's technique ∈ card.hookPatterns, evaluated
 *   whenever the caller knows the chosen technique (`chosenHookStyle`);
 *   null only on recomputes where the technique is unrecoverable (e.g.
 *   script.get after a process restart with an empty hook cache).
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
  /** Technique tag of the hook actually used; omit/null when unknown
   *  (hookPatternOk then stays null = "not evaluated", never a pass). */
  chosenHookStyle?: HookStyle | null;
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

  const card = input.styleCard ?? null;
  const fleschScore = fleschReadingEase(fullText);
  // Per-card readingLevel REPLACES the global Flesch ≥ 60 gate when a card
  // is present (PRODUCT-CONTRACTS §6); the global rule is the legacy path.
  const readingGrade = card === null ? null : fleschKincaidGrade(fullText);
  const readingLevelOk =
    card === null || readingGrade === null ? null : readingGrade <= card.readingLevel.maxGrade;
  const readabilityOk =
    readingLevelOk !== null
      ? readingLevelOk
      : isAcademicTone(input.tone) || fleschScore >= MIN_FLESCH;

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
    if (card !== null && readingGrade !== null) {
      warnings.push(
        `Reading grade ${readingGrade} is above the card's grade-${card.readingLevel.maxGrade} ceiling.`,
      );
    } else {
      warnings.push(`Flesch reading ease ${fleschScore} is below ${MIN_FLESCH}.`);
    }
  }
  if (
    card !== null &&
    readingGrade !== null &&
    readingLevelOk === true &&
    readingGrade < card.readingLevel.minGrade
  ) {
    warnings.push(
      `Reading grade ${readingGrade} sits below the card's grade ${card.readingLevel.minGrade}-${card.readingLevel.maxGrade} band — simpler than target (not a failure).`,
    );
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

  // -- style-card gates (wave C, completed by C1) ---------------------------
  const baseStyleGates = card === null ? null : computeStyleGates(input.sections, card);
  const chosenHookStyle = input.chosenHookStyle ?? null;
  const hookPatternOk =
    card === null || chosenHookStyle === null
      ? null
      : card.hookPatterns.some((p) => p.technique === chosenHookStyle);
  const styleGates =
    baseStyleGates === null
      ? null
      : { ...baseStyleGates, hookPatternOk, readingGrade, readingLevelOk };
  if (styleGates !== null) {
    for (const hit of styleGates.bannedClaimHits) {
      warnings.push(
        `Banned claim (${hit.claimType}) in "${hit.sectionHeading}": "${hit.excerpt}".`,
      );
    }
    warnings.push(...styleGates.notes);
    if (hookPatternOk === false && chosenHookStyle !== null) {
      warnings.push(
        `Hook technique "${chosenHookStyle}" is not in the card's allowed hookPatterns (${(
          card?.hookPatterns ?? []
        )
          .map((p) => p.technique)
          .join(", ")}).`,
      );
    }
  }
  // null sub-fields mean "not evaluated" and never count as a pass — but
  // they cannot fail a gate either; only an explicit false fails.
  const styleGatesPass =
    styleGates === null ||
    (styleGates.bannedClaimsOk &&
      styleGates.ctaPlacementOk &&
      styleGates.hookPatternOk !== false &&
      styleGates.readingLevelOk !== false);

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
    if (report.styleGates !== null && report.styleGates.readingGrade !== null) {
      violations.push(
        `Reading grade is ${report.styleGates.readingGrade}; simplify with shorter sentences and plainer words to land inside the card's grade band.`,
      );
    } else {
      violations.push(
        `Flesch reading ease is ${report.fleschReadingEase}; raise above ${MIN_FLESCH} with shorter sentences and plainer words.`,
      );
    }
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
    // hookPatternOk === false is deliberately NOT a violation: the hook body
    // was explicitly chosen (by the user or an earlier stage) and a section
    // rewrite cannot change its technique tag — it fails the gate and is
    // surfaced as a warning instead of burning an auto-fix loop.
  }
  return violations;
}
