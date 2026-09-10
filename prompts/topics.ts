import type { StyleCard } from "@/lib/types/entities";
import { jsonOnly, renderStyleCard } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * Staged `script.topics` (PRODUCT-CONTRACTS §4) — topic candidates for a
 * channel: niche keywords + fresh niche outliers (evidence of current
 * demand, from the ideation index) + the resolved style card (so the
 * suggested formats fit the voice they will be written in).
 */

export interface TopicsPromptInput {
  channelTitle: string;
  nicheKeywords: readonly string[];
  /** Fresh outlier videos in the niche, best ratio first. */
  outliers: readonly { title: string; outlierRatio: number }[];
  styleCard: StyleCard | null;
  count: number;
}

export function topicsPrompt(input: TopicsPromptInput): PromptTemplate {
  const outlierBlock =
    input.outliers.length === 0
      ? "No fresh outlier data available — lean on the niche keywords and the voice."
      : input.outliers
          .map((o) => `- "${o.title}" (${o.outlierRatio.toFixed(1)}x its channel's median views)`)
          .join("\n");
  return {
    system: [
      "You suggest the next video topics for a YouTube channel. Rules:",
      "(1) Every topic must be concrete enough to shoot: a specific test,",
      "comparison, claim, or story — never a vague theme.",
      "(2) Ground each suggestion in the niche's demonstrated demand: when",
      "outlier videos are listed, adapt what is working (the demand, not the",
      "title) to this channel's voice; never copy a title.",
      "(3) The angle says how THIS channel attacks the topic; the rationale",
      "says why it should outperform, citing an outlier or a niche keyword.",
      "(4) Topics must fit the creator's voice and energy — no hype formats",
      "for a calm voice, no lectures for a high-energy one.",
      "(5) titles ≤ 100 characters, plain language, no clickbait phrasing",
      "the voice would never use.",
    ].join(" "),
    prompt: [
      `Channel: ${input.channelTitle}`,
      `Niche keywords: ${input.nicheKeywords.length > 0 ? input.nicheKeywords.join(", ") : "(none set)"}`,
      "",
      "Creator voice:",
      renderStyleCard(input.styleCard),
      "",
      "Fresh niche outliers (videos outperforming their channel median):",
      outlierBlock,
      "",
      `Suggest exactly ${input.count} topic candidates.`,
      "",
      jsonOnly(
        `{"topics": [{"title": "...", "angle": "...", "rationale": "..."}]} — exactly ${input.count} entries`,
      ),
    ].join("\n"),
  };
}
