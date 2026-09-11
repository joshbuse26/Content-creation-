import type { LlmProvider } from "@/lib/providers/types";
import { containsRealCreatorName } from "@/lib/seed-lint";
import {
  analyzeSimilarity,
  exceedsSimilarity,
  REMIX_VERBATIM_RUN_BLOCK,
  segmentSourcesIntoSpans,
  type SimilarityOptions,
} from "@/lib/similarity-guard";
import { styleCardSchema, type StyleCard } from "@/lib/types/entities";
import type { HookStyle } from "@/lib/types/enums";
import type { EngineMode } from "@/pipelines/script/llm-json";
import { generateJson } from "@/pipelines/script/llm-json";
import { LLM_MODELS } from "@/lib/config";
import { trainVoicePrompt } from "@/prompts";

/**
 * StyleCard derivation for train_on_my_channel (WAVE-D-PLAN §2c).
 *
 * `deriveStyleCard` turns sampled transcripts into a structured StyleCard —
 * via the LLM in live mode (behind the LlmProvider seam, Grok tier) and via a
 * deterministic synthesizer in fixture mode (zero keys). Both return a card
 * that satisfies the frozen styleCardSchema.
 *
 * `sanitizeDerivedCard` is the ORIGINALITY guard for any card derived from a
 * source that is not a proven-owned channel (a competitor remix OR training on
 * an unverified/public channel — D2 P0-1). A guarded card must be ORIGINAL, so
 * EVERY free-text field — voice.{pov,diction,rhythm}, tone.{register,never},
 * ctaHabits.phrasingStyle, every hookPatterns[].guidance, and exampleSnippets[]
 * — is scanned against the competitor sources (similarity guard) and for
 * real-person names (seed-lint); any field that reproduces competitor wording
 * or names a real person is neutralized to a generic craft description (a
 * snippet is dropped and the pool backfills). The competitor sources are first
 * segmented into short spans so an embedded 4–7 word catchphrase is caught
 * (D2 P1-4). `sanitizeRemixCard` is the back-compatible alias. The card NAME is
 * name-checked by the caller (train.ts) with the same seed-lint plus the
 * named-creator-claim patterns. Proven-owned own-channel cards skip this guard
 * (their snippets and title are the user's own).
 */

// ---------------------------------------------------------------------------
// Deterministic fixture synthesizer (zero keys)
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const HOOK_POOL: readonly HookStyle[] = ["open_loop", "stakes", "bold_claim", "in_medias_res"];

const HOOK_GUIDANCE: Record<HookStyle, string> = {
  open_loop: "Pose the tension the video resolves and hold the answer.",
  stakes: "Name what it costs the viewer to get this wrong.",
  bold_claim: "Lead with the strongest defensible claim, then earn it.",
  in_medias_res: "Drop the viewer into the moment of highest action first.",
};

/** ORIGINAL craft lines for a remix card — generic cadence, never a copy. */
const REMIX_SNIPPET_POOL: readonly string[] = [
  "Stay with me for one more beat, because this is where it turns.",
  "Here is the part the thumbnail promised, and it holds up.",
  "Quick gut check before we go further: does this match what you expected?",
  "That is the whole idea in one line; the rest is just proof.",
];

/**
 * A deterministic, schema-valid StyleCard synthesized from the transcript
 * text. Used in fixture mode and as the live-mode fallback shape.
 */
export function synthStyleCard(params: {
  transcripts: readonly string[];
  remix: boolean;
}): StyleCard {
  const corpus = params.transcripts.join(" \n ");
  const seed = fnv1a(`${params.remix ? "remix" : "own"}|${corpus}`);
  const words = corpus.split(/\s+/).filter((w) => w.length > 0);
  const avgWordLen =
    words.length === 0 ? 5 : words.reduce((s, w) => s + w.length, 0) / words.length;

  // Pacing/energy scale off the sampled corpus so different channels differ,
  // but stay inside the schema's bounds.
  const wpmTarget = 120 + (seed % 90); // 120–209
  const energy = (1 + (seed % 5)) as 1 | 2 | 3 | 4 | 5;
  const hookA = HOOK_POOL[seed % HOOK_POOL.length] ?? "open_loop";
  const hookB = HOOK_POOL[(seed >> 3) % HOOK_POOL.length] ?? "stakes";
  const hooks =
    hookA === hookB
      ? [{ technique: hookA, guidance: HOOK_GUIDANCE[hookA] }]
      : [
          { technique: hookA, guidance: HOOK_GUIDANCE[hookA] },
          { technique: hookB, guidance: HOOK_GUIDANCE[hookB] },
        ];

  // Own-channel snippets: short lines lifted from the creator's OWN transcript
  // (allowed — their own channel). Remix snippets: fresh original craft lines.
  const exampleSnippets = params.remix
    ? REMIX_SNIPPET_POOL.slice(0, 2 + (seed % 2))
    : dedupe(
        params.transcripts
          .map((t) => firstSentence(t))
          .filter((s) => s.length > 0)
          .slice(0, 3),
      );

  return styleCardSchema.parse({
    voice: {
      pov: "First person, speaking directly to one viewer.",
      diction:
        avgWordLen > 5.2
          ? "Precise and technical; defines a term once, then reuses it."
          : "Plain-spoken and concrete; everyday words over jargon.",
      rhythm: "Mostly short sentences with one longer build before each payoff.",
    },
    tone: {
      register: energy >= 4 ? "High-energy, propulsive, punchy." : "Warm, curious, measured.",
      never: "condescending; hype without evidence",
    },
    pacing: {
      wpmTarget,
      sectionSeconds: 60 + (seed % 90),
      rehookSeconds: 45 + (seed % 60),
    },
    hookPatterns: hooks,
    ctaHabits: {
      placement: "after_payoff",
      placementPct: null,
      phrasingStyle: "One low-pressure ask tied to the value just delivered.",
      maxPerVideo: 1,
    },
    bannedClaims: ["guaranteed_results", "medical_claims"],
    readingLevel: { minGrade: 5, maxGrade: 10 },
    energy,
    exampleSnippets,
    thumbnailPresetId: null,
  });
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[^.!?]{8,180}[.!?]?/.exec(trimmed);
  const s = (match?.[0] ?? trimmed.slice(0, 160)).trim();
  return s.length > 200 ? s.slice(0, 200) : s;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Derivation (live LLM / fixture)
// ---------------------------------------------------------------------------

export async function deriveStyleCard(params: {
  mode: EngineMode;
  llm: LlmProvider;
  channelTitle: string;
  transcripts: readonly string[];
  remix: boolean;
}): Promise<StyleCard> {
  return generateJson<StyleCard>({
    mode: params.mode,
    llm: params.llm,
    model: LLM_MODELS.sonnet,
    template: trainVoicePrompt({
      channelTitle: params.channelTitle,
      transcripts: params.transcripts,
      remix: params.remix,
    }),
    maxTokens: 2000,
    schema: styleCardSchema,
    fixture: () => synthStyleCard({ transcripts: params.transcripts, remix: params.remix }),
  });
}

// ---------------------------------------------------------------------------
// Remix guard — original snippets only, no competitor wording, no real names
// ---------------------------------------------------------------------------

export interface RemixSanitizeResult {
  card: StyleCard;
  /** Snippets removed because they overlapped the competitor source or named a person. */
  droppedSnippets: string[];
  /** Structured free-text fields neutralized to a generic default (voice.pov, tone.register, …). */
  neutralizedFields: string[];
}

/**
 * Generic ORIGINAL craft defaults — the neutral replacement for any structured
 * free-text field that reproduces competitor wording or names a real person.
 * These are the same lines the deterministic synthesizer emits, so a clean
 * fixture card is left byte-for-byte unchanged (nothing to neutralize).
 */
const GENERIC_FIELD_DEFAULTS = {
  pov: "First person, speaking directly to one viewer.",
  diction: "Plain-spoken and concrete; everyday words over jargon.",
  rhythm: "Mostly short sentences with one longer build before each payoff.",
  register: "Warm, curious, measured.",
  never: "condescending; hype without evidence",
  phrasingStyle: "One low-pressure ask tied to the value just delivered.",
} as const;

/**
 * Enforce the originality contract on a derived card: EVERY free-text field is
 * scanned against the competitor sources (similarity guard, at catchphrase
 * scale — sources are segmented into short spans) and for real-person names
 * (seed-lint). A structured field that fails is replaced with a generic craft
 * default; an exampleSnippet that fails is dropped and, when all are dropped,
 * the original craft pool backfills. The card NAME is guarded by the caller.
 */
export function sanitizeDerivedCard(
  card: StyleCard,
  competitorSources: readonly string[],
  threshold: number,
  options?: Partial<SimilarityOptions>,
): RemixSanitizeResult {
  // Segment the competitor corpus into short spans so an embedded 4–7 word
  // catchphrase is caught (D2 P1-4); block even a short verbatim run (remix
  // must be original), which the licensed guard would permit.
  const sources = segmentSourcesIntoSpans(competitorSources);
  const isClean = (text: string): boolean =>
    isCleanField(text, sources, threshold, options, REMIX_VERBATIM_RUN_BLOCK);

  const neutralizedFields: string[] = [];
  const neutralize = (path: string, value: string, fallback: string): string => {
    if (isClean(value)) return value;
    neutralizedFields.push(path);
    return fallback;
  };

  const voice = {
    pov: neutralize("voice.pov", card.voice.pov, GENERIC_FIELD_DEFAULTS.pov),
    diction: neutralize("voice.diction", card.voice.diction, GENERIC_FIELD_DEFAULTS.diction),
    rhythm: neutralize("voice.rhythm", card.voice.rhythm, GENERIC_FIELD_DEFAULTS.rhythm),
  };
  const tone = {
    register: neutralize("tone.register", card.tone.register, GENERIC_FIELD_DEFAULTS.register),
    never: neutralize("tone.never", card.tone.never, GENERIC_FIELD_DEFAULTS.never),
  };
  const ctaHabits = {
    ...card.ctaHabits,
    phrasingStyle: neutralize(
      "ctaHabits.phrasingStyle",
      card.ctaHabits.phrasingStyle,
      GENERIC_FIELD_DEFAULTS.phrasingStyle,
    ),
  };
  const hookPatterns = card.hookPatterns.map((h, i) => ({
    technique: h.technique,
    guidance: neutralize(
      `hookPatterns[${String(i)}].guidance`,
      h.guidance,
      HOOK_GUIDANCE[h.technique],
    ),
  }));

  const dropped: string[] = [];
  const clean: string[] = [];
  for (const snippet of card.exampleSnippets) {
    if (isClean(snippet)) clean.push(snippet);
    else dropped.push(snippet);
  }
  // Backfill from the original craft pool (regenerate) when every derived
  // snippet was dropped, keeping only pool lines that are themselves clean.
  const finalSnippets =
    clean.length > 0
      ? clean
      : REMIX_SNIPPET_POOL.filter((candidate) => isClean(candidate)).slice(0, 2);

  return {
    card: styleCardSchema.parse({
      ...card,
      voice,
      tone,
      ctaHabits,
      hookPatterns,
      exampleSnippets: finalSnippets.slice(0, 4),
    }),
    droppedSnippets: dropped,
    neutralizedFields,
  };
}

/**
 * Back-compatible alias for {@link sanitizeDerivedCard}. The competitor-remix
 * path is one guarded case of the same originality contract.
 */
export const sanitizeRemixCard = sanitizeDerivedCard;

/**
 * A single free-text field is clean iff it names no real person AND does not
 * reproduce a competitor span over the threshold. `verbatimRunBlock` is the
 * stricter remix run limit; `sources` are expected pre-segmented into spans.
 */
function isCleanField(
  text: string,
  sources: readonly string[],
  threshold: number,
  options: Partial<SimilarityOptions> | undefined,
  verbatimRunBlock: number,
): boolean {
  if (containsRealCreatorName(text)) return false;
  const report = analyzeSimilarity(text, sources, options);
  return !exceedsSimilarity(report, threshold, verbatimRunBlock);
}
