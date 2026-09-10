import { jsonOnly } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.9 Titles — 25 options across at least 5 pattern families, then scored.
 *
 * Families are named so the writer can see the strategy behind each option,
 * and so the set is forced to diverge instead of producing 25 variants of
 * one idea.
 */

export const TITLE_PATTERN_FAMILIES = [
  "curiosity_gap",
  "versus",
  "negative_command",
  "outcome_promise",
  "confession",
  "listicle",
  "challenge",
  "contrarian",
] as const;
export type TitlePatternFamily = (typeof TITLE_PATTERN_FAMILIES)[number];

export interface TitlesPromptInput {
  projectTitle: string;
  frameAngle: string;
  format: string;
  keywords: string[];
  hookBody: string | null;
  /** Outlier titles from the niche, when the index has them (v1.1). */
  nicheTitleExamples: string[];
}

export function titlesPrompt(input: TitlesPromptInput): PromptTemplate {
  return {
    system: [
      "You write YouTube titles. Produce exactly 25 options spanning at",
      "least 5 of these pattern families (patternFamily value in",
      "parentheses):",
      "(curiosity_gap) a specific withheld answer — never generic mystery;",
      "(versus) X vs Y with a stake attached;",
      "(negative_command) stop/never/don't + the mistake being made;",
      "(outcome_promise) the concrete result and what it costs to get;",
      "(confession) first-person admission — 'I was wrong about', 'I",
      "tested', 'it got awkward';",
      "(listicle) N things, where N and the noun are both specific;",
      "(challenge) constraint + attempt — budget caps, time limits, rules;",
      "(contrarian) the popular belief, inverted, defensibly.",
      "Rules: under 60 characters preferred, hard cap 100; no clickbait",
      "the video can't cash; no ALL-CAPS words except one for emphasis at",
      "most; front-load the meaningful words — the first 40 characters",
      "survive truncation; work a keyword in only where it reads",
      "naturally. Every title must be honest about the video described.",
    ].join(" "),
    prompt: [
      `Video: ${input.projectTitle}`,
      `Angle: ${input.frameAngle}`,
      `Format: ${input.format}`,
      input.keywords.length > 0 ? `Keywords: ${input.keywords.join(", ")}` : "",
      input.hookBody !== null
        ? `The video's hook (the title must set this up): ${input.hookBody}`
        : "",
      input.nicheTitleExamples.length > 0
        ? `Titles currently outperforming in this niche:\n${input.nicheTitleExamples.map((t) => `- ${t}`).join("\n")}`
        : "",
      "",
      jsonOnly(
        `{"options": [{"text": "<title>", "patternFamily": "<one of: curiosity_gap, versus, negative_command, outcome_promise, confession, listicle, challenge, contrarian>"}]} — exactly 25 options, at least 5 distinct families`,
      ),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export interface ScoreTitlesPromptInput {
  titles: { text: string; patternFamily: string }[];
  nicheTitleExamples: string[];
  frameAngle: string;
}

export function scoreTitlesPrompt(input: ScoreTitlesPromptInput): PromptTemplate {
  return {
    system: [
      "You score YouTube titles 0-100 for click-through potential against a",
      "specific niche. Score each independently on: specificity (vague",
      "loses to concrete), curiosity pressure (does the viewer NEED the",
      "answer), emotional charge (stakes, surprise, identity), scannability",
      "(meaning lands in the first 40 characters), and honesty (a title the",
      "video can't cash gets a hard penalty, not a bonus). Calibrate: 80+",
      "is rare — a title you'd bet the video on; 60-79 strong; 40-59",
      "serviceable; below 40 weak. Use the full range; do not cluster",
      "everything at 70.",
    ].join(" "),
    prompt: [
      `Video angle: ${input.frameAngle}`,
      input.nicheTitleExamples.length > 0
        ? `Titles currently outperforming in this niche:\n${input.nicheTitleExamples.map((t) => `- ${t}`).join("\n")}`
        : "",
      "",
      "Titles to score, in order:",
      input.titles.map((t, i) => `${i + 1}. [${t.patternFamily}] ${t.text}`).join("\n"),
      "",
      jsonOnly(`{"scores": [<int 0-100>, ...]} — one score per title, in the same order as listed`),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
