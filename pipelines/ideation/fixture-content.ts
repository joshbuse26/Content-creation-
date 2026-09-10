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
