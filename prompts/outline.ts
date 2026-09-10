import type { ScriptContext } from "@/lib/types/pipeline";
import type { PromptTemplate } from "./version";
import { jsonOnly, renderFrame, renderResearch } from "./shared";

/**
 * §5.7 stage 2 — the outline.
 *
 * The outline is the retention architecture of the video: what each section
 * must accomplish, what question keeps the viewer through it, and how long
 * it earns. Sections carry a retention note — the specific device holding
 * attention there — because "be engaging" is not a plan.
 */

export interface OutlinePromptInput {
  context: ScriptContext;
}

export function outlinePrompt(input: OutlinePromptInput): PromptTemplate {
  const { frame } = input.context;
  const totalSeconds = frame.targetMinutes * 60;
  return {
    system: [
      "You outline YouTube videos for retention. Non-negotiables:",
      "(1) Section order is a payoff schedule — the video's biggest moment",
      "lands at 60-75% of runtime, never at the very end, and something",
      "genuinely valuable happens in the first 90 seconds after the hook.",
      "(2) Every section's retentionNote names a concrete device: an open",
      "loop it plants or closes, a stake it raises, a promised payoff and",
      "its timestamp, a pattern interrupt. Not vibes — mechanics.",
      "(3) The hook is its own section (kind 'hook', 15-30 seconds). One",
      "'intro' section may follow to set stakes and rules — keep it under",
      "10% of runtime. Chapters carry the substance. End with 'cta' then",
      "'outro', both short.",
      "(4) targetSeconds across ALL sections must sum to the target runtime",
      "within 10%. Chapter sections run 60-240 seconds each — longer than",
      "240 loses people, shorter than 60 feels like channel-surfing.",
      "(5) purpose says what the viewer GETS from the section, not what the",
      "section 'covers'.",
    ].join(" "),
    prompt: [
      "Frame:",
      renderFrame(frame),
      "",
      "Audience:",
      input.context.avatarSummary,
      "",
      "Research available (sections should map claims to this material):",
      renderResearch(input.context.research),
      "",
      `Target total runtime: ${totalSeconds} seconds.`,
      "",
      jsonOnly(
        `{"sections": [{"kind": "hook|intro|chapter|cta|outro", "heading": "...", "purpose": "...", "retentionNote": "...", "targetSeconds": <int>}]} — first section kind "hook", last two "cta" then "outro"`,
      ),
    ].join("\n"),
  };
}
