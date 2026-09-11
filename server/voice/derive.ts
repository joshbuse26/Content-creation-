import type { LlmProvider } from "@/lib/providers/types";
import { containsRealCreatorName } from "@/lib/seed-lint";
import {
  analyzeSimilarity,
  exceedsSimilarity,
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
 * `sanitizeRemixCard` is the REMIX guard: a competitor remix must be an
 * ORIGINAL card, so any derived exampleSnippet that reproduces a competitor
 * transcript span (over the same similarity threshold the licensed guard
 * uses) is dropped, and a snippet or name carrying a real-person reference is
 * removed. Own-channel cards skip this (the snippets are the user's own).
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
}

/**
 * Enforce the remix contract on a derived card: every exampleSnippet that
 * reproduces a competitor transcript span (over `threshold`) OR carries a
 * real-person reference is dropped. A fresh ORIGINAL line from the craft pool
 * backfills once so the card is not left empty when possible. The derived
 * name/voice text is already name-checked by the caller (seed-lint); this
 * guards the SNIPPETS specifically against verbatim competitor reuse.
 */
export function sanitizeRemixCard(
  card: StyleCard,
  competitorSources: readonly string[],
  threshold: number,
  options?: Partial<SimilarityOptions>,
): RemixSanitizeResult {
  const dropped: string[] = [];
  const clean: string[] = [];
  for (const snippet of card.exampleSnippets) {
    if (isCleanRemixSnippet(snippet, competitorSources, threshold, options)) {
      clean.push(snippet);
    } else {
      dropped.push(snippet);
    }
  }
  // Backfill from the original craft pool (regenerate) when every derived
  // snippet was dropped, keeping only pool lines that are themselves clean.
  const finalSnippets =
    clean.length > 0
      ? clean
      : REMIX_SNIPPET_POOL.filter((candidate) =>
          isCleanRemixSnippet(candidate, competitorSources, threshold, options),
        ).slice(0, 2);
  return {
    card: styleCardSchema.parse({ ...card, exampleSnippets: finalSnippets.slice(0, 4) }),
    droppedSnippets: dropped,
  };
}

function isCleanRemixSnippet(
  snippet: string,
  competitorSources: readonly string[],
  threshold: number,
  options?: Partial<SimilarityOptions>,
): boolean {
  if (containsRealCreatorName(snippet)) return false;
  const report = analyzeSimilarity(snippet, competitorSources, options);
  return !exceedsSimilarity(report, threshold);
}
