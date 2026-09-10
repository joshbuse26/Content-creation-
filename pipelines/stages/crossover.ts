import { styleCardSchema, type StyleCard } from "@/lib/types/entities";
import type { BannedClaimType } from "@/lib/types/enums";

/**
 * Crossover style-card merge (PRODUCT-CONTRACTS §3) — DETERMINISTIC,
 * documented rules, not "mix it". Given archetype cards A and B and
 * weightA ∈ [0,1] (weightB = 1 − weightA), the blended card is:
 *
 *  1. DOMINANT CARD: the archetype with the larger weight; ties
 *     (weightA === 0.5) go to A, so the merge is a pure function of its
 *     inputs. The blend's SURFACE VOICE comes from the dominant card:
 *     `voice`, `tone`, `ctaHabits`, `readingLevel`, `exampleSnippets` and
 *     `thumbnailPresetId` are taken from it verbatim. Blending prose voice
 *     fields or CTA placement rules would produce an incoherent voice; a
 *     crossover reads as "mostly X, with Y's structure mixed in".
 *  2. PACING — linear blend: each numeric field
 *     (`wpmTarget`, `sectionSeconds`, `rehookSeconds`) is
 *     round(a·weightA + b·weightB). Both inputs are inside the schema's
 *     ranges, so the convex combination is too.
 *  3. HOOK PATTERNS — dominant-first union: the dominant card's patterns in
 *     their original preference order, then the lighter card's patterns
 *     whose technique is not already present, truncated to the schema cap
 *     of 4. Preference order matters (index 0 drives auto-pick), so the
 *     dominant voice keeps the wheel.
 *  4. BANNED CLAIMS — union (strictest of both): the dominant card's list
 *     in order, then the lighter card's additions. A crossover may never be
 *     a loophole around either parent's hard rules.
 *  5. ENERGY — weighted round: round(a·weightA + b·weightB), clamped to
 *     the schema's 1–5.
 *
 * The result is re-parsed through the frozen styleCardSchema so any drift
 * from the contract throws here, not downstream.
 */
export function mergeStyleCards(a: StyleCard, b: StyleCard, weightA: number): StyleCard {
  if (weightA < 0 || weightA > 1) {
    throw new Error(`crossover weightA must be within [0,1]; got ${String(weightA)}`);
  }
  const weightB = 1 - weightA;
  // Rule 1 — ties go to A: deterministic, documented.
  const [dominant, lighter] = weightA >= 0.5 ? [a, b] : [b, a];

  const blend = (x: number, y: number): number => Math.round(x * weightA + y * weightB);

  // Rule 3 — dominant-first union by technique, capped at 4 (schema max).
  const hookPatterns = [...dominant.hookPatterns];
  for (const pattern of lighter.hookPatterns) {
    if (!hookPatterns.some((p) => p.technique === pattern.technique)) {
      hookPatterns.push(pattern);
    }
  }

  // Rule 4 — union, dominant's order first, lighter's additions appended.
  const bannedClaims: BannedClaimType[] = [...dominant.bannedClaims];
  for (const claim of lighter.bannedClaims) {
    if (!bannedClaims.includes(claim)) bannedClaims.push(claim);
  }

  return styleCardSchema.parse({
    voice: dominant.voice,
    tone: dominant.tone,
    // Rule 2 — pacing numbers blend linearly by weight.
    pacing: {
      wpmTarget: blend(a.pacing.wpmTarget, b.pacing.wpmTarget),
      sectionSeconds: blend(a.pacing.sectionSeconds, b.pacing.sectionSeconds),
      rehookSeconds: blend(a.pacing.rehookSeconds, b.pacing.rehookSeconds),
    },
    hookPatterns: hookPatterns.slice(0, 4),
    ctaHabits: dominant.ctaHabits,
    bannedClaims,
    readingLevel: dominant.readingLevel,
    // Rule 5 — weighted round, clamped to 1–5.
    energy: Math.min(5, Math.max(1, blend(a.energy, b.energy))),
    exampleSnippets: dominant.exampleSnippets,
    thumbnailPresetId: dominant.thumbnailPresetId,
  });
}
