import { SOPHISTICATION_LEVELS } from "@/lib/types/enums";

/**
 * §5.2 avatar-generation prompt — a versioned, typed template function
 * (build spec §5: prompts are never inline).
 *
 * NOTE: prompts/ is A2-owned; this A1 prompt lives with its pipeline. See
 * REQUESTS-A1.md if A2 wants it consolidated under prompts/.
 */

export const AVATAR_PROMPT_VERSION = "avatar.v1";

export interface AvatarPromptInput {
  channelTitle: string;
  channelHandle: string | null;
  subs: number;
  totalViews: number;
  medianViews90d: number;
  nicheKeywords: string[];
  /** Recent uploads: title + view count, newest first. */
  recentVideos: { title: string; viewCount: number }[];
  /** Top-10 transcripts by views, truncated upstream. */
  transcriptExcerpts: string[];
}

export interface AvatarPrompt {
  system: string;
  prompt: string;
}

const AVATAR_JSON_SHAPE = `{
  "ageRange": "e.g. 25-34",
  "genderSplit": "e.g. 70% male / 30% female",
  "geo": ["top viewer countries/regions"],
  "sophistication": one of ${JSON.stringify([...SOPHISTICATION_LEVELS])},
  "pains": [{ "pain": "...", "evidence": "what in the channel data shows this" }],
  "motivations": [{ "motivation": "...", "evidence": "..." }],
  "vocabularyNotes": "register, jargon the audience uses, terms to avoid"
}`;

export function buildAvatarPrompt(input: AvatarPromptInput): AvatarPrompt {
  const videoLines = input.recentVideos
    .slice(0, 50)
    .map((v) => `- ${v.title} (${v.viewCount} views)`)
    .join("\n");
  const transcripts = input.transcriptExcerpts
    .map((t, i) => `--- transcript ${i + 1} ---\n${t}`)
    .join("\n\n");

  return {
    system:
      "You are an audience researcher for YouTube creators. From channel data " +
      "you infer a single, concrete audience avatar. Ground every claim in the " +
      "supplied evidence; never invent demographics the data cannot support. " +
      "Respond with ONLY a JSON object — no prose, no code fences.",
    prompt: [
      `Channel: ${input.channelTitle}${input.channelHandle === null ? "" : ` (${input.channelHandle})`}`,
      `Subscribers: ${input.subs} · Total views: ${input.totalViews} · Median views (90d): ${input.medianViews90d}`,
      input.nicheKeywords.length > 0 ? `Niche keywords: ${input.nicheKeywords.join(", ")}` : "",
      "",
      "Recent uploads:",
      videoLines,
      "",
      transcripts.length > 0 ? "Transcript excerpts from the top-viewed videos:" : "",
      transcripts,
      "",
      "Produce the audience avatar as JSON with exactly this shape:",
      AVATAR_JSON_SHAPE,
      "",
      "Rules: 1-6 pains, 1-6 motivations, each with concrete evidence from the",
      "data above. geo as short region names. Output only the JSON object.",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}
