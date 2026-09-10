import type { ScriptContext } from "@/lib/types/pipeline";
import { jsonOnly, renderFrame } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.7 stage 4 — the retention pass.
 *
 * Runs over the full draft and edits for the graph, not the prose: re-hooks
 * every 60-90 seconds, open loops audited (every one planted gets closed,
 * every payoff lands before attention decays), dead air cut.
 */

export interface RetentionPromptInput {
  context: ScriptContext;
  sections: {
    kind: string;
    heading: string;
    body: string;
    estSeconds: number;
    retentionNote: string | null;
  }[];
}

export function retentionPrompt(input: RetentionPromptInput): PromptTemplate {
  let cumulative = 0;
  const timeline = input.sections
    .map((s) => {
      const start = cumulative;
      cumulative += s.estSeconds;
      const mm = Math.floor(start / 60);
      const ss = String(start % 60).padStart(2, "0");
      return `[${mm}:${ss}] ${s.heading} (${s.kind}, ${s.estSeconds}s)${s.retentionNote !== null ? ` — planned device: ${s.retentionNote}` : ""}\n${s.body}`;
    })
    .join("\n\n");
  return {
    system: [
      "You are a retention editor for YouTube scripts. You edit for the",
      "audience-retention graph, and only that. Your checklist:",
      "(1) RE-HOOKS: viewers decide to leave roughly every 60-90 seconds.",
      "At each such interval there must be a fresh reason to stay — a",
      "planted question, a teased result ('the third one is the one that",
      "shocked me'), a stake raised, a cut to something unexpected. Where",
      "the draft coasts past 90 seconds without one, insert one, woven into",
      "the existing prose — not bolted on.",
      "(2) OPEN LOOPS: list every loop the script plants. Every loop must",
      "close, and the biggest must close at 60-75% of runtime. If a payoff",
      "sits in the outro, move it earlier and let the outro breathe.",
      "(3) FRONT-LOAD: if the first chapter delivers nothing concrete in",
      "its first 30 seconds, restructure so it does.",
      "(4) CUT: dead transitions, repeated points, warm-up sentences.",
      "Preserve the creator's voice and all factual content exactly — you",
      "may reorder and reweave, never invent new facts. Update each",
      "section's retentionNote to describe the device actually present",
      "after your edit. Keep section count, kinds, and headings unchanged.",
    ].join(" "),
    prompt: [
      "Frame:",
      renderFrame(input.context.frame),
      "",
      "Draft with timeline:",
      timeline,
      "",
      jsonOnly(
        `{"sections": [{"kind": "...", "heading": "...", "body": "<edited spoken text>", "estSeconds": <int>, "retentionNote": "<device now present, or null>"}]} — same sections, same order, same kinds and headings`,
      ),
    ].join("\n"),
  };
}
