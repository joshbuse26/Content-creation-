import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import { scanDenylist } from "@/lib/seed-lint";
import type { CompetitorTheme, Idea, NicheVideo } from "@/lib/types/entities";
import type { ChannelId, WorkspaceId } from "@/lib/types/ids";
import { generateJson } from "@/pipelines/script/llm-json";
import type { IdeationDeps } from "./deps";
import { synthCompetitorConcepts, synthFormatTags } from "./fixture-content";
import { competitorConceptsPrompt } from "./prompts";

/**
 * Competitor compare (Wave-D E3) — take 1-3 competitor channels, pull their
 * top outliers through the YouTube Data API seam, and surface the SHARED
 * structural THEMES (format/topic patterns) across them as ORIGINAL idea
 * concepts for the caller's OWN channel.
 *
 * GUARDRAILS (enforced here):
 *  - Only the abstract PATTERN crosses over — never a creator's voice/script.
 *    Theme labels come from format tags (name-free by construction); derived
 *    concepts are generated fresh and every title/angle/rationale is scanned
 *    with seed-lint, falling back to a deterministic no-name concept if any
 *    real-person name slips in.
 *  - Evidence video ids are the REAL competitor ids (they resolve to real
 *    watch URLs) — but no competitor name or handle is persisted in the idea.
 *
 * Metering + tenancy live in the router handler (ideas.competitorCompare);
 * this module is the pure compute + persist, fully injectable for tests.
 */

/** Per-channel keep threshold — a video must beat its channel median by this. */
export const COMPARE_RATIO_THRESHOLD = 1.5;
/** Recent uploads sampled per competitor channel. */
const UPLOADS_PER_CHANNEL = 50;
/** Max videos kept per channel (highest ratio first). */
const KEEP_PER_CHANNEL = 12;
/** Max shared themes surfaced. */
const MAX_THEMES = 6;
/** Max evidence video ids carried per theme. */
const SAMPLE_CAP = 6;

interface ScoredVideo {
  youtubeVideoId: string;
  title: string;
  ratio: number;
  tags: string[];
}

/** Median of a non-empty numeric list; 0 for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 !== 0) return hi;
  return Math.round(((sorted[mid - 1] ?? 0) + hi) / 2);
}

/** Human label for a format-pattern theme (name-free by construction). */
const THEME_LABEL: Record<string, string> = {
  listicle: "ranked list formats",
  test: "hands-on test formats",
  versus: "head-to-head comparisons",
  tutorial: "step-by-step tutorials",
  challenge: "budget/time challenge formats",
  review: "verdict-driven reviews",
  mistakes: "mistake-driven explainers",
  essay: "opinionated essays",
  "deep-dive": "deep-dive explainers",
  experiment: "open-ended experiments",
  "tier-list": "tier-list rankings",
  reaction: "reaction formats",
  budget: "budget-focused angles",
  doc: "mini-documentary formats",
  story: "narrative storytelling",
};

function themeLabel(tag: string): string {
  return THEME_LABEL[tag] ?? `${tag} formats`;
}

/**
 * Fetch one competitor channel's scored top videos (median-relative outliers).
 * Returns [] when the channel has no usable median (no uploads / all zero).
 */
async function scoreChannel(deps: IdeationDeps, handle: string): Promise<ScoredVideo[]> {
  const channel = await deps.youtube.getChannel(handle);
  const ids = await deps.youtube.listRecentVideoIds(channel.uploadsPlaylistId, UPLOADS_PER_CHANNEL);
  if (ids.length === 0) return [];
  const stats = await deps.youtube.getVideoStats(ids);
  const med = median(stats.map((s) => s.viewCount));
  if (med <= 0) return [];
  return stats
    .map((s) => ({
      youtubeVideoId: s.youtubeVideoId,
      title: s.title,
      ratio: Math.round((s.viewCount / med) * 100) / 100,
      tags: synthFormatTags(s.title),
    }))
    .filter((v) => v.ratio >= COMPARE_RATIO_THRESHOLD)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, KEEP_PER_CHANNEL);
}

/**
 * Extract SHARED themes across the per-channel scored videos. A format tag is
 * a theme when it appears across >= 2 channels (multi-channel compares) or on
 * >= 2 videos (a single-channel compare). Deterministic ordering.
 */
export function extractSharedThemes(perChannel: readonly ScoredVideo[][]): CompetitorTheme[] {
  const channelsPerTag = new Map<string, Set<number>>();
  const videosPerTag = new Map<string, string[]>();
  const videoCountPerTag = new Map<string, number>();

  perChannel.forEach((videos, channelIdx) => {
    for (const video of videos) {
      for (const tag of video.tags) {
        let channels = channelsPerTag.get(tag);
        if (channels === undefined) {
          channels = new Set();
          channelsPerTag.set(tag, channels);
        }
        channels.add(channelIdx);
        let bucket = videosPerTag.get(tag);
        if (bucket === undefined) {
          bucket = [];
          videosPerTag.set(tag, bucket);
        }
        if (!bucket.includes(video.youtubeVideoId)) bucket.push(video.youtubeVideoId);
        videoCountPerTag.set(tag, (videoCountPerTag.get(tag) ?? 0) + 1);
      }
    }
  });

  const multiChannel = perChannel.length > 1;
  const themes: CompetitorTheme[] = [];
  for (const [tag, channels] of channelsPerTag) {
    const shared = multiChannel ? channels.size >= 2 : (videoCountPerTag.get(tag) ?? 0) >= 2;
    if (!shared) continue;
    themes.push({
      theme: themeLabel(tag),
      formatTag: tag,
      sharedByChannels: channels.size,
      sampleVideoIds: (videosPerTag.get(tag) ?? []).slice(0, SAMPLE_CAP),
    });
  }

  return themes
    .sort(
      (a, b) =>
        b.sharedByChannels - a.sharedByChannels ||
        b.sampleVideoIds.length - a.sampleVideoIds.length ||
        a.formatTag.localeCompare(b.formatTag),
    )
    .slice(0, MAX_THEMES);
}

const conceptsSchema = z.array(
  z.object({
    title: z.string().min(1).max(120),
    angle: z.string().min(1),
    rationale: z.string().min(1),
    score: z.number().min(0).max(100),
  }),
);

export interface CompetitorCompareArgs {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  channelTitle: string;
  nicheKeywords: string[];
  channelHandles: string[];
  /** Titles of recent ideas (dedup window) — skip concepts that already exist. */
  recentTitles: readonly string[];
  generatedOn: string;
}

export interface CompetitorCompareComputed {
  themes: CompetitorTheme[];
  ideas: Idea[];
}

/**
 * Compute shared competitor themes and persist ORIGINAL derived concepts as
 * ideas rows (workspace-scoped). Returns [] themes when no shared pattern is
 * found — the caller surfaces a clear "no shared pattern" state rather than
 * fabricating concepts.
 */
export async function runCompetitorCompare(
  deps: IdeationDeps,
  args: CompetitorCompareArgs,
): Promise<CompetitorCompareComputed> {
  const perChannel: ScoredVideo[][] = [];
  for (const handle of args.channelHandles) {
    perChannel.push(await scoreChannel(deps, handle));
  }

  const themes = extractSharedThemes(perChannel);
  if (themes.length === 0) return { themes: [], ideas: [] };

  // Derive ORIGINAL concepts from the patterns (LLM live; deterministic fixture).
  let concepts: z.infer<typeof conceptsSchema>;
  try {
    concepts = await generateJson({
      mode: deps.mode,
      llm: deps.llm,
      model: LLM_MODELS.sonnet,
      template: competitorConceptsPrompt({
        channelTitle: args.channelTitle,
        nicheKeywords: args.nicheKeywords,
        themes: themes.map((t) => ({
          theme: t.theme,
          formatTag: t.formatTag,
          sharedByChannels: t.sharedByChannels,
        })),
      }),
      maxTokens: 2000,
      temperature: 0.4,
      schema: conceptsSchema,
      fixture: () =>
        synthCompetitorConcepts({
          channelTitle: args.channelTitle,
          nicheKeywords: args.nicheKeywords,
          themes: themes.map((t) => ({
            theme: t.theme,
            formatTag: t.formatTag,
            sharedByChannels: t.sharedByChannels,
          })),
        }),
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "competitor-compare: concept generation failed, degrading to deterministic synth",
    );
    concepts = synthCompetitorConcepts({
      channelTitle: args.channelTitle,
      nicheKeywords: args.nicheKeywords,
      themes: themes.map((t) => ({
        theme: t.theme,
        formatTag: t.formatTag,
        sharedByChannels: t.sharedByChannels,
      })),
    });
  }

  // Seed-lint every free-text field — a concept naming a real person is dropped
  // back to the deterministic no-name synth for its theme.
  const fallback = synthCompetitorConcepts({
    channelTitle: args.channelTitle,
    nicheKeywords: args.nicheKeywords,
    themes: themes.map((t) => ({
      theme: t.theme,
      formatTag: t.formatTag,
      sharedByChannels: t.sharedByChannels,
    })),
  });
  const recent = new Set(args.recentTitles);

  const toInsert = concepts.flatMap((c, i) => {
    const theme = themes[i % themes.length];
    if (theme === undefined) return [];
    // Seed-lint: a concept that reproduces a REAL creator's name (the curated
    // denylist — e.g. a name that slipped from a competitor title into an LLM
    // completion) is dropped back to the deterministic, name-free synth for its
    // theme. (The name-SHAPE heuristic is intentionally not used here: it
    // false-positives on ordinary title-cased niche phrases like "Coffee Gear".)
    const named =
      scanDenylist(c.title).length > 0 ||
      scanDenylist(c.angle).length > 0 ||
      scanDenylist(c.rationale).length > 0;
    const safe = named ? (fallback[i] ?? fallback[0]) : c;
    if (safe === undefined) return [];
    const idea = {
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      title: safe.title,
      angle: safe.angle,
      rationale: safe.rationale,
      evidenceVideoIds: theme.sampleVideoIds,
      score: safe.score,
      generatedOn: args.generatedOn,
    };
    // Idempotent persistence: skip a concept whose title already exists in the
    // dedup window, so re-comparing the same channels does not pile up rows.
    return recent.has(idea.title) ? [] : [idea];
  });

  const ideas = toInsert.length > 0 ? await deps.store.insertIdeas(toInsert) : [];
  return { themes, ideas };
}

/** Exported for the handler's idempotency-key hash input. */
export function compareKeyInput(channelId: string, handles: readonly string[]): string {
  return `${channelId}|${[...handles]
    .map((h) => h.trim().toLowerCase())
    .sort()
    .join(",")}`;
}

/** Re-export so tests can assert the raw scoring shape without the provider. */
export type { ScoredVideo, NicheVideo };
