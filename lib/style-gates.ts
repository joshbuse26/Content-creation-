import type { StyleCard, StyleCtaHabits } from "@/lib/types/entities";
import type { BannedClaimType } from "@/lib/types/enums";
import type { BannedClaimHit, StyleGateReport } from "@/lib/types/pipeline";

/**
 * Style-aware golden gates (PRODUCT-CONTRACTS §6) — the PURE-CODE checks.
 * Wave-C split of responsibilities:
 *   - bannedClaims scan + CTA placement: implemented HERE (this file), wired
 *     into pipelines/script/quality-gate.ts.
 *   - hookPatternOk + per-card readingLevel: TYPED in lib/types/pipeline.ts
 *     (nullable fields on styleGateReportSchema); C1 computes them when the
 *     staged pipeline knows the chosen hook's technique tag.
 * Everything here is deterministic string/section analysis — no LLM, no
 * vibes. C3's golden run consumes the same report shape.
 */

// ---------------------------------------------------------------------------
// Banned-claim scan
// ---------------------------------------------------------------------------

/**
 * Conservative, machine-checkable patterns per claim type. Deliberately
 * high-precision (hard-fail gate): each pattern targets promissory or
 * absolute phrasing, not topical vocabulary — a script may DISCUSS medicine
 * without tripping medical_claims; it may not promise cures.
 */
export const BANNED_CLAIM_PATTERNS: Record<BannedClaimType, readonly RegExp[]> = {
  guaranteed_results: [
    /\bguaranteed?\s+(?:to\s+\w+|results?|success|wins?)\b/i,
    /\b(?:100|one\s*hundred)\s*(?:%|percent)\s+(?:guaranteed|certain|sure)\b/i,
    /\bnever\s+fails?\b/i,
    /\bworks?\s+every\s+(?:single\s+)?time\b/i,
  ],
  medical_claims: [
    /\bcures?\s+(?:your|any|all|every)?\s*\b(?:cancer|disease|illness|anxiety|depression|diabetes|insomnia|pain)\b/i,
    /\bclinically\s+proven\b/i,
    /\b(?:treats?|heals?|reverses?)\s+(?:any|all|every)\s+(?:disease|condition|illness)\b/i,
    /\bdoctors\s+(?:hate|don't\s+want\s+you\s+to\s+know)\b/i,
  ],
  financial_promises: [
    /\b(?:double|triple|10x|ten-?x)\s+your\s+(?:money|income|savings|investment)\b/i,
    /\bguaranteed\s+(?:returns?|profits?|income)\b/i,
    /\bget\s+rich\s+(?:quick|fast|overnight)\b/i,
    /\bpassive\s+income\s+(?:guaranteed|with\s+zero\s+(?:work|effort|risk))\b/i,
    /\brisk-?free\s+(?:investment|returns?|profits?)\b/i,
  ],
  absolute_superlatives: [
    /\bthe\s+(?:only|single)\s+(?:way|method|solution)\s+(?:to|that)\b/i,
    /\b(?:best|greatest|worst)\s+\w+\s+(?:ever\s+made|of\s+all\s+time|in\s+(?:the\s+world|history))\b/i,
    /\bno\s+one\s+else\s+(?:knows|can|will\s+tell\s+you)\b/i,
    /\beveryone\s+(?:else\s+)?is\s+(?:wrong|lying)\s+about\b/i,
  ],
  fear_mongering: [
    /\bwill\s+(?:ruin|destroy)\s+your\s+(?:life|health|family|future)\b/i,
    /\bbefore\s+it'?s\s+too\s+late\b/i,
    /\bif\s+you\s+don'?t\s+\w+(?:\s+\w+){0,3},?\s+you(?:'ll|\s+will)\s+(?:regret|lose|die)\b/i,
    /\bsilent(?:ly)?\s+killing\s+you\b/i,
  ],
};

const EXCERPT_MAX = 160;

export interface ScannableSection {
  kind: string;
  heading: string;
  body: string;
  estSeconds: number;
}

/** Scan text for a card's banned claim types. Empty claimTypes ⇒ no hits. */
export function scanBannedClaims(
  sections: readonly ScannableSection[],
  claimTypes: readonly BannedClaimType[],
): BannedClaimHit[] {
  const hits: BannedClaimHit[] = [];
  for (const section of sections) {
    for (const claimType of claimTypes) {
      for (const pattern of BANNED_CLAIM_PATTERNS[claimType]) {
        const match = pattern.exec(section.body);
        if (match !== null) {
          hits.push({
            claimType,
            excerpt: match[0].slice(0, EXCERPT_MAX),
            sectionHeading: section.heading.slice(0, 200),
          });
        }
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// CTA placement check
// ---------------------------------------------------------------------------

export interface CtaPlacementResult {
  ok: boolean;
  ctaCount: number;
  violations: string[];
}

/**
 * Checks CTA sections against the card's ctaHabits:
 *  - count ≤ maxPerVideo
 *  - end_only: no chapter after any CTA
 *  - after_payoff: every CTA directly follows a chapter (its payoff)
 *  - timestamp_pct: first CTA starts within ±15 percentage points of
 *    placementPct of estimated runtime
 */
export function checkCtaPlacement(
  sections: readonly ScannableSection[],
  habits: StyleCtaHabits,
): CtaPlacementResult {
  const violations: string[] = [];
  const ctaIndexes = sections.flatMap((s, i) => (s.kind === "cta" ? [i] : []));
  const ctaCount = ctaIndexes.length;

  if (ctaCount > habits.maxPerVideo) {
    violations.push(`Script has ${ctaCount} CTA sections; the card allows ${habits.maxPerVideo}.`);
  }

  if (ctaCount > 0) {
    switch (habits.placement) {
      case "end_only": {
        const lastChapter = sections.reduce((acc, s, i) => (s.kind === "chapter" ? i : acc), -1);
        if (ctaIndexes.some((i) => i < lastChapter)) {
          violations.push(
            "Card requires end-only CTAs, but a CTA appears before the last chapter.",
          );
        }
        break;
      }
      case "after_payoff": {
        for (const i of ctaIndexes) {
          if (i === 0 || sections[i - 1]?.kind !== "chapter") {
            violations.push(
              `CTA "${sections[i]?.heading ?? ""}" does not directly follow a chapter's payoff.`,
            );
          }
        }
        break;
      }
      case "timestamp_pct": {
        const total = sections.reduce((sum, s) => sum + s.estSeconds, 0);
        const firstCta = ctaIndexes[0];
        if (total > 0 && firstCta !== undefined && habits.placementPct !== null) {
          const before = sections.slice(0, firstCta).reduce((sum, s) => sum + s.estSeconds, 0);
          const actualPct = (before / total) * 100;
          const tolerance = 15;
          if (Math.abs(actualPct - habits.placementPct) > tolerance) {
            violations.push(
              `First CTA lands at ~${Math.round(actualPct)}% of runtime; card targets ${habits.placementPct}% (±${tolerance}).`,
            );
          }
        }
        break;
      }
    }
  }

  return { ok: violations.length === 0, ctaCount, violations };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/**
 * Build the style-gate portion of the quality report from what pure code
 * can determine today. hookPatternOk / readingLevel* stay null until C1
 * threads the chosen hook technique + per-card readability through.
 */
export function computeStyleGates(
  sections: readonly ScannableSection[],
  card: StyleCard,
): StyleGateReport {
  const bannedClaimHits = scanBannedClaims(sections, card.bannedClaims);
  const cta = checkCtaPlacement(sections, card.ctaHabits);
  return {
    hookPatternOk: null,
    ctaPlacementOk: cta.ok,
    ctaCount: cta.ctaCount,
    readingGrade: null,
    readingLevelOk: null,
    bannedClaimHits,
    bannedClaimsOk: bannedClaimHits.length === 0,
    notes: cta.violations,
  };
}
