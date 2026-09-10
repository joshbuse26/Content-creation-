import { z } from "zod";
import { styleCardSchema, type StyleCard } from "@/lib/types/entities";

/**
 * StyleCard v2 helpers — the in-memory twin of migration 0005's SQL
 * transform. Anything that may still hold a v1 card (fixture snapshots,
 * imported data, tests) upgrades through here; keep the mapping in sync
 * with the UPDATE statement in db/migrations/0005_*.sql.
 */

/** The pre-wave-C style card shape ({rhythm, register, catchphrases, …}). */
export const legacyStyleCardSchema = z.object({
  rhythm: z.string(),
  register: z.string(),
  catchphrases: z.array(z.string()),
  humor: z.string(),
  pov: z.string(),
  taboos: z.array(z.string()),
});
export type LegacyStyleCard = z.infer<typeof legacyStyleCardSchema>;

/** Neutral defaults for fields the legacy shape never carried. */
export const STYLE_CARD_UPGRADE_DEFAULTS = {
  pacing: { wpmTarget: 150, sectionSeconds: 90, rehookSeconds: 75 },
  hookPatterns: [
    {
      technique: "open_loop" as const,
      guidance: "Open with an unresolved question and defer the payoff.",
    },
  ],
  ctaHabits: {
    placement: "after_payoff" as const,
    placementPct: null,
    phrasingStyle: "Direct, low-pressure ask tied to the value just delivered.",
    maxPerVideo: 1,
  },
  readingLevel: { minGrade: 6, maxGrade: 9 },
  energy: 3,
} as const;

/**
 * Upgrade a legacy card to StyleCard v2. Field mapping:
 *  - voice: {pov, diction ← register, rhythm}
 *  - tone: {register ← humor, never ← taboos joined}
 *  - exampleSnippets ← catchphrases (the creator's own phrases; capped at 4)
 *  - everything else takes STYLE_CARD_UPGRADE_DEFAULTS
 */
export function upgradeLegacyStyleCard(legacy: LegacyStyleCard): StyleCard {
  return styleCardSchema.parse({
    voice: {
      pov: legacy.pov,
      diction: legacy.register,
      rhythm: legacy.rhythm,
    },
    tone: {
      register: legacy.humor,
      never: legacy.taboos.join("; "),
    },
    pacing: STYLE_CARD_UPGRADE_DEFAULTS.pacing,
    hookPatterns: STYLE_CARD_UPGRADE_DEFAULTS.hookPatterns,
    ctaHabits: STYLE_CARD_UPGRADE_DEFAULTS.ctaHabits,
    bannedClaims: [],
    readingLevel: STYLE_CARD_UPGRADE_DEFAULTS.readingLevel,
    energy: STYLE_CARD_UPGRADE_DEFAULTS.energy,
    exampleSnippets: legacy.catchphrases.slice(0, 4),
    thumbnailPresetId: null,
  });
}

/** Parse an unknown style-card value, upgrading legacy shapes on the fly. */
export function parseStyleCard(value: unknown): StyleCard {
  const v2 = styleCardSchema.safeParse(value);
  if (v2.success) return v2.data;
  const legacy = legacyStyleCardSchema.safeParse(value);
  if (legacy.success) return upgradeLegacyStyleCard(legacy.data);
  throw new Error("style card matches neither the v2 nor the legacy shape");
}
