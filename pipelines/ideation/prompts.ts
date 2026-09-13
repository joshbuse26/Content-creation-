import type { PromptTemplate } from "@/prompts";
import { hashInput } from "@/queue/pipeline-runner";

/**
 * Ideation prompts (§5.3 format tagging, §5.4 daily ideas) — versioned,
 * typed template functions. They live next to the pipeline (like the avatar
 * prompt) rather than in A2-owned prompts/*; move when convenient (noted in
 * OPEN-ITEMS.md). Bump IDEATION_PROMPT_VERSION on any change — it is
 * folded into every ideation stage's input hash, so a prompt edit never
 * silently reuses stage output produced by older prompts.
 */
export const IDEATION_PROMPT_VERSION = "2026-09-10.1";

/** Stage input hashing with the ideation prompt generation folded in. */
export function ideationStageHash(input: unknown): string {
  return hashInput({ ideationPromptVersion: IDEATION_PROMPT_VERSION, input });
}

// ---------------------------------------------------------------------------
// §5.3 — format tagging (Haiku tier)
// ---------------------------------------------------------------------------

export interface FormatTagsPromptInput {
  videos: { youtubeVideoId: string; title: string }[];
}

export function formatTagsPrompt(input: FormatTagsPromptInput): PromptTemplate {
  return {
    system: [
      "You classify YouTube video formats from titles. For every video,",
      "return 1-4 short lowercase format tags drawn from vocabulary like:",
      "listicle, test, versus, tutorial, challenge, essay, doc, reaction,",
      "review, budget, tier-list, mistakes, experiment, story, deep-dive.",
      "Prefer the most specific tags the title supports; invent a new",
      "single-word tag only when nothing fits. Respond with JSON only:",
      '{"videos":[{"youtubeVideoId":"...","tags":["..."]}]} — one entry per',
      "input video, same ids, no commentary.",
    ].join(" "),
    prompt: ["Videos:", ...input.videos.map((v) => `- ${v.youtubeVideoId}: ${v.title}`)].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// E3 — "why it worked" blurbs (cheap tier)
// ---------------------------------------------------------------------------

export interface WhyItWorkedPromptInput {
  videos: {
    youtubeVideoId: string;
    title: string;
    outlierRatio: number;
    formatTags: string[];
    recency: string;
  }[];
}

export function whyItWorkedPrompt(input: WhyItWorkedPromptInput): PromptTemplate {
  return {
    system: [
      "You explain, in ONE short sentence, why a YouTube video over-performed",
      "its channel's median views. Focus on the likely structural driver:",
      "the title pattern, the format, or the timing — never the creator.",
      "NEVER name a real person or channel. No hype, no superlatives, under 160",
      "characters. Respond with JSON only:",
      '{"videos":[{"youtubeVideoId":"...","blurb":"..."}]} — one entry per',
      "input video, same ids, no commentary.",
    ].join(" "),
    prompt: [
      "Videos (id · ratio · formats · recency · title):",
      ...input.videos.map(
        (v) =>
          `- ${v.youtubeVideoId} · ${v.outlierRatio.toFixed(1)}x · [${v.formatTags.join(", ")}] · ${v.recency} · ${v.title}`,
      ),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// E3 — competitor compare → ORIGINAL concepts (main tier)
// ---------------------------------------------------------------------------

export interface CompetitorConceptsPromptInput {
  channelTitle: string;
  nicheKeywords: string[];
  themes: { theme: string; formatTag: string; sharedByChannels: number }[];
}

export function competitorConceptsPrompt(input: CompetitorConceptsPromptInput): PromptTemplate {
  return {
    system: [
      "You are a YouTube strategist. You are given FORMAT/TOPIC PATTERNS that",
      "several competitor channels in a niche are winning with (anonymized — no",
      "creator names). Produce ORIGINAL video concepts that capture each",
      "pattern's structural strength for THIS channel's own audience. CRITICAL:",
      "never name, imitate, or clone any real creator; never reproduce a",
      "specific video — only the abstract pattern. Output a JSON array, no",
      'commentary: [{"title":"...","angle":"...","rationale":"...","score":0-100}].',
      "Titles under 120 chars, specific and honest; angle = the distinct",
      "original take in one sentence; rationale = why this pattern travels to",
      "this audience; score = 0-100 fit x momentum. Cover distinct themes.",
    ].join(" "),
    prompt: [
      `Channel: ${input.channelTitle}`,
      `Niche keywords: ${input.nicheKeywords.join(", ")}`,
      "",
      "Shared competitor patterns (pattern · format · #channels):",
      ...input.themes.map((t) => `- ${t.theme} · ${t.formatTag} · ${t.sharedByChannels}`),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// §5.4 — daily ideas (main tier)
// ---------------------------------------------------------------------------

export interface DailyIdeasPromptInput {
  channelTitle: string;
  nicheKeywords: string[];
  outliers: {
    youtubeVideoId: string;
    title: string;
    outlierRatio: number;
    viewCount: number;
    formatTags: string[];
  }[];
  avatarSummary: string | null;
  recentTopics: string[];
}

export function dailyIdeasPrompt(input: DailyIdeasPromptInput): PromptTemplate {
  return {
    system: [
      "You are a YouTube strategist generating video ideas for a specific",
      "channel. You are given outlier videos from the channel's niche",
      "(videos massively over-performing their channel's median), the",
      "channel's audience avatar, and the channel's own recent topics.",
      "Produce EXACTLY 5 ideas as a JSON array, no commentary:",
      '[{"title":"...","angle":"...","rationale":"...",',
      '"evidenceVideoIds":["..."],"score":0-100}]. Rules: titles under 120',
      "characters, specific and honest; angle = the distinct take in one",
      "sentence; rationale = why NOW for THIS audience, citing the outlier",
      "evidence; evidenceVideoIds must only use the provided outlier video",
      "ids (1-4 each); score = your 0-100 estimate of fit x momentum. Do",
      "not repeat the channel's recent topics — extend or subvert them.",
      "The 5 ideas must cover distinct topics, not five variants of one.",
    ].join(" "),
    prompt: [
      `Channel: ${input.channelTitle}`,
      `Niche keywords: ${input.nicheKeywords.join(", ")}`,
      "",
      "Niche outliers (id · ratio x median · views · formats · title):",
      ...(input.outliers.length > 0
        ? input.outliers.map(
            (o) =>
              `- ${o.youtubeVideoId} · ${o.outlierRatio.toFixed(1)}x · ${o.viewCount} · [${o.formatTags.join(", ")}] · ${o.title}`,
          )
        : ["- (no fresh outliers — lean on the avatar and keywords)"]),
      "",
      input.avatarSummary !== null
        ? `Audience avatar:\n${input.avatarSummary}`
        : "Audience avatar: (none yet)",
      "",
      input.recentTopics.length > 0
        ? `Channel's recent topics (do not repeat):\n${input.recentTopics.map((t) => `- ${t}`).join("\n")}`
        : "Channel's recent topics: (none)",
    ].join("\n"),
  };
}
