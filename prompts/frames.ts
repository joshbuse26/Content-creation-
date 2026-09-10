import type { PromptTemplate } from "./version";
import { jsonOnly } from "./shared";

/**
 * §5.6 Frame proposals — four genuinely different ways to make this video.
 *
 * A frame is a bet: an angle, a format, an outcome to optimize, and who it's
 * for. The craft is in making the four proposals DIVERGE — four flavors of
 * the same listicle teaches the user nothing.
 */

export interface ProposeFramesInput {
  projectTitle: string;
  ideaAngle: string | null;
  researchSummary: string;
  avatarSummary: string;
  channelNiche: string[];
}

export function proposeFramesPrompt(input: ProposeFramesInput): PromptTemplate {
  return {
    system: [
      "You are a YouTube strategist proposing four distinct frames for one",
      "video idea. Rules for a strong set: (1) at least three different",
      "formats across the four; (2) at least two different primary outcomes",
      "(subs / watch_time / conversion); (3) each angle is a specific,",
      "arguable premise — a claim or a question with stakes — not a topic",
      "restatement; (4) each names who it serves within the audience and why",
      "they'd click; (5) target lengths fit the format: tutorials and essays",
      "run 8-15 minutes, challenges and docs 10-20, listicles 6-12; (6) tone",
      "is a compact directive a writer can execute (e.g. 'playful-rigorous',",
      "'quietly confrontational'), not a mood board. Formats allowed:",
      "listicle, essay, tutorial, challenge, doc, reaction, other.",
    ].join(" "),
    prompt: [
      `Video idea: ${input.projectTitle}`,
      input.ideaAngle !== null ? `Idea angle: ${input.ideaAngle}` : "",
      `Channel niche: ${input.channelNiche.join(", ")}`,
      "",
      "Audience:",
      input.avatarSummary,
      "",
      "Research highlights:",
      input.researchSummary,
      "",
      jsonOnly(
        `[{"angle": "...", "format": "listicle|essay|tutorial|challenge|doc|reaction|other", "outcome": "subs|watch_time|conversion", "audienceSegment": "...", "tone": "...", "targetMinutes": <int>, "keywords": ["..."]}] — exactly 4 frames`,
      ),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
