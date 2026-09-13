import type { GeneratedIdea } from "@/lib/types/pipeline";

/**
 * Deterministic synthesizers for fixture mode — the shared fixture
 * LlmProvider returns prose, never stage-shaped JSON, so (like the script
 * engine) the ideation stages supply schema-valid values themselves in
 * fixture mode. Everything is seeded by FNV-1a of the input, so zero-env
 * runs are reproducible.
 */

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const FORMAT_RULES: readonly { pattern: RegExp; tag: string }[] = [
  { pattern: /\b\d+\b/, tag: "listicle" },
  { pattern: /\btested|test(ing)?\b/i, tag: "test" },
  { pattern: /\bvs\.?|versus\b/i, tag: "versus" },
  { pattern: /\bhow to|guide|tutorial\b/i, tag: "tutorial" },
  { pattern: /\bchallenge|24 hours|budget\b/i, tag: "challenge" },
  { pattern: /\breview\b/i, tag: "review" },
  { pattern: /\bmistake|wrong|stop\b/i, tag: "mistakes" },
];

/** Deterministic format tags derived from the title (1-4 tags). */
export function synthFormatTags(title: string): string[] {
  const tags = FORMAT_RULES.filter((r) => r.pattern.test(title)).map((r) => r.tag);
  if (tags.length === 0) tags.push("essay");
  return tags.slice(0, 4);
}

/** Driver phrase per format tag — the structural reason the format tends to win. */
const DRIVER_BY_TAG: Record<string, string> = {
  listicle: "a numbered promise sets a clear, skimmable payoff",
  test: "a hands-on test promises proof, not opinion",
  versus: "a head-to-head framing creates an instant curiosity gap",
  tutorial: "a concrete how-to maps straight onto a searched problem",
  challenge: "a constraint (budget or time) raises the stakes up front",
  review: "a verdict promise answers a buying decision",
  mistakes: "naming a costly mistake triggers loss-aversion",
  essay: "a strong point of view rewards a committed watch",
  "deep-dive": "depth signals authority the casual upload lacks",
  experiment: "an open experiment keeps the outcome in suspense",
  "tier-list": "ranking invites disagreement and re-watches",
  reaction: "a reaction borrows the source clip's built-in pull",
  budget: "a budget angle widens the addressable audience",
  doc: "a documentary frame promises a story, not a clip",
  story: "a narrative hook carries attention past the intro",
};

const RECENCY_TAIL: Record<string, string> = {
  this_week: "and it is riding a fresh wave of interest this week",
  this_month: "and the timing caught a rising topic this month",
  older: "and it has compounded views steadily over time",
};

/**
 * Deterministic "why it worked" blurb for an outlier (fixture mode) — built
 * from the primary format tag (the structural driver) and the recency band
 * (the timing). Names no real person by construction.
 */
export function synthWhyItWorked(input: {
  outlierRatio: number;
  formatTags: string[];
  recency: string;
}): string {
  const tag = input.formatTags[0] ?? "essay";
  const driver = DRIVER_BY_TAG[tag] ?? "its format matches what the niche rewards right now";
  const tail = RECENCY_TAIL[input.recency] ?? "and it out-paced the channel's usual reach";
  const multiple = `${input.outlierRatio.toFixed(1)}×`;
  return `At ${multiple} its channel median, ${driver}, ${tail}.`;
}

/** Short, original concept templates per format pattern — name no real person. */
const CONCEPT_BY_TAG: Record<string, { title: (topic: string) => string; angle: string }> = {
  listicle: {
    title: (t) => `The Only ${t} Ranking That Controls for Price`,
    angle: "An original ranking that fixes the variable every other list ignores.",
  },
  test: {
    title: (t) => `I Stress-Tested ${t} the Way the Reviews Don't`,
    angle: "A hands-on test designed around the failure mode nobody films.",
  },
  versus: {
    title: (t) => `${t}: The Comparison Everyone Gets Backwards`,
    angle: "A head-to-head that reframes which trade-off actually matters.",
  },
  tutorial: {
    title: (t) => `${t} in One Sitting — the No-Reset Method`,
    angle: "A how-to built so a beginner never has to start over.",
  },
  challenge: {
    title: (t) => `Rebuilding ${t} on a Hard Budget Cap`,
    angle: "A self-imposed constraint that exposes what really earns the spend.",
  },
  mistakes: {
    title: (t) => `The ${t} Mistake That Quietly Costs the Most`,
    angle: "A loss-aversion teardown mapped to the audience's real regret.",
  },
};

const CONCEPT_FALLBACK = {
  title: (t: string) => `A Fresh Take on ${t} the Niche Hasn't Tried`,
  angle: "An original angle on the pattern, tuned to this channel's audience.",
};

export interface SynthCompetitorConceptsInput {
  channelTitle: string;
  nicheKeywords: string[];
  themes: { theme: string; formatTag: string; sharedByChannels: number }[];
}

/** Deterministic ORIGINAL concepts from shared competitor patterns (fixture). */
export function synthCompetitorConcepts(
  input: SynthCompetitorConceptsInput,
): { title: string; angle: string; rationale: string; score: number }[] {
  const topics =
    input.nicheKeywords.length > 0 ? input.nicheKeywords : [input.channelTitle || "the niche"];
  return input.themes.map((theme, i) => {
    const topicRaw = topics[i % topics.length] ?? "the niche";
    const topic = topicRaw.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    const shape = CONCEPT_BY_TAG[theme.formatTag] ?? CONCEPT_FALLBACK;
    const seed = fnv1a(`${input.channelTitle}|${theme.formatTag}|${topic}|${i}`);
    return {
      title: shape.title(topic).slice(0, 120),
      angle: shape.angle,
      rationale: `${theme.sharedByChannels > 1 ? `${theme.sharedByChannels} competitor channels` : "A competitor"} are winning with ${theme.theme}; this adapts the pattern — not the videos — to ${input.channelTitle}'s audience.`,
      score: 58 + (seed % 40),
    };
  });
}

export interface SynthIdeasInput {
  channelTitle: string;
  nicheKeywords: string[];
  outliers: { youtubeVideoId: string; title: string }[];
}

const IDEA_SHAPES: readonly {
  title: (topic: string) => string;
  angle: string;
}[] = [
  {
    title: (topic) => `I Tried the ${topic} Everyone Is Copying`,
    angle: "First-person test of the niche's breakout format, with receipts.",
  },
  {
    title: (topic) => `The Truth About ${topic} Nobody Says Out Loud`,
    angle: "Contrarian teardown of the assumption behind the trend.",
  },
  {
    title: (topic) => `${topic}: Beginner Mistakes That Cost You Most`,
    angle: "Mistake-driven tutorial mapped to the avatar's top pains.",
  },
  {
    title: (topic) => `We Ranked Every ${topic} So You Don't Have To`,
    angle: "Definitive ranking video piggybacking on proven listicle demand.",
  },
  {
    title: (topic) => `What ${topic} Looks Like on a Real Budget`,
    angle: "Budget-constrained challenge remixing the outlier's premise.",
  },
];

/** Exactly 5 deterministic, schema-valid ideas. */
export function synthIdeas(input: SynthIdeasInput): GeneratedIdea[] {
  const topics =
    input.nicheKeywords.length > 0 ? input.nicheKeywords : [input.channelTitle || "the niche"];
  const evidencePool = input.outliers.map((o) => o.youtubeVideoId);
  return IDEA_SHAPES.map((shape, i) => {
    const topicRaw = topics[i % topics.length] ?? "the niche";
    const topic = topicRaw.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    const seed = fnv1a(`${input.channelTitle}|${topic}|${i}`);
    const evidence = evidencePool.slice(i % 2, (i % 2) + 2);
    const outlierTitle = input.outliers[i % Math.max(input.outliers.length, 1)]?.title;
    return {
      title: shape.title(topic).slice(0, 120),
      angle: shape.angle,
      rationale:
        outlierTitle !== undefined
          ? `"${outlierTitle}" is outperforming its channel median in this niche right now; this idea adapts that demand to ${input.channelTitle}'s audience.`
          : `No fresh outliers today — this leans on the channel's niche keywords and audience avatar.`,
      evidenceVideoIds: evidence,
      score: 60 + (seed % 40),
    };
  });
}
