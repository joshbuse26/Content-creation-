import { LLM_MODELS } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import type { FreeToolRequest, FreeToolResult } from "./definitions";

/**
 * Free-tool generation logic. Every LLM call is pinned to the fast tier
 * (LLM_MODELS.haiku — spec §6: "Haiku only") with a tight maxTokens budget,
 * and every tool has a deterministic fallback so fixture mode (whose LLM
 * returns prose, not structured output) still produces useful results.
 */

/** Hard ceiling for any free-tool LLM call — enforced by tests. */
export const FREE_TOOL_MAX_TOKENS = 500;

const complete = (llm: LlmProvider, system: string, prompt: string, maxTokens: number) =>
  llm.complete({
    model: LLM_MODELS.haiku,
    system,
    prompt,
    maxTokens: Math.min(maxTokens, FREE_TOOL_MAX_TOKENS),
    temperature: 0.8,
  });

const titleCase = (s: string) => (s.length === 0 ? s : (s[0] ?? "").toUpperCase() + s.slice(1));

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Original pattern families — generic formulas, no one's actual titles. */
export function deterministicTitles(topic: string): string[] {
  const t = titleCase(topic.trim());
  return [
    `The Truth About ${t}`,
    `${t}: What Nobody Tells You`,
    `I Tried ${t} for 30 Days — Honest Results`,
    `7 ${t} Mistakes You're Probably Making`,
    `${t}, Explained in 10 Minutes`,
    `Why Everyone Gets ${t} Wrong`,
    `${t} for Beginners: Start Here`,
    `How ${t} Actually Works`,
    `Stop Overcomplicating ${t}`,
    `${t} on a Budget: What's Worth It`,
  ];
}

export function parseTitleLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((line) => line.replace(/^["'](.*)["']$/, "$1"))
    .filter((line) => line.length >= 8 && line.length <= 100 && !line.endsWith(":"));
}

async function runTitles(
  llm: LlmProvider,
  input: Extract<FreeToolRequest, { tool: "title-generator" }>,
): Promise<FreeToolResult> {
  const audience = input.audience === undefined ? "" : ` Audience: ${input.audience}.`;
  const res = await complete(
    llm,
    "You write YouTube titles. Reply with exactly 10 title options, one per line, no numbering, no commentary.",
    `Video topic: ${input.topic}.${audience} Mix curiosity, how-to, list, and contrarian angles. Max 70 characters each.`,
    400,
  );
  const parsed = parseTitleLines(res.text).slice(0, 10);
  return { items: parsed.length >= 5 ? parsed : deterministicTitles(input.topic), text: null };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function deterministicToolTags(topic: string): string[] {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ").filter((w) => w.length > 2);
  const candidates = [
    base,
    ...words,
    `${base} tutorial`,
    `${base} tips`,
    `${base} for beginners`,
    `how to ${base}`,
    `${base} explained`,
    `${base} guide`,
    `best ${base}`,
    `${base} mistakes`,
    `${base} review`,
    `${base} basics`,
    ...words.map((w) => `${w} tips`),
    ...words.map((w) => `${w} guide`),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const tag = c.trim();
    if (tag.length >= 3 && tag.length <= 60 && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= 20) break;
  }
  return out;
}

export function parseTagList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (tag.length >= 3 && tag.length <= 60 && !/[.!?]$/.test(tag) && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

async function runTags(
  llm: LlmProvider,
  input: Extract<FreeToolRequest, { tool: "tag-generator" }>,
): Promise<FreeToolResult> {
  const res = await complete(
    llm,
    "You generate YouTube video tags. Reply with 15-20 tags as a single comma-separated list, lowercase, no hashtags, no commentary.",
    `Video topic: ${input.topic}. Mix broad and specific tags viewers actually search for.`,
    300,
  );
  const parsed = parseTagList(res.text).slice(0, 20);
  return { items: parsed.length >= 10 ? parsed : deterministicToolTags(input.topic), text: null };
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

export function deterministicToolDescription(summary: string): string {
  const clean = summary.trim().replace(/\s+/g, " ");
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const opener = titleCase(sentences[0] ?? clean);
  const bullets = sentences
    .slice(1, 5)
    .map((s) => `• ${titleCase(s.replace(/[.!?]$/, ""))}`)
    .join("\n");
  return [
    opener,
    "",
    ...(bullets === "" ? [] : ["In this video:", bullets, ""]),
    "If this was useful, subscribing is the easiest way to see the next one.",
  ].join("\n");
}

async function runDescription(
  llm: LlmProvider,
  input: Extract<FreeToolRequest, { tool: "description-generator" }>,
): Promise<FreeToolResult> {
  const res = await complete(
    llm,
    "You write YouTube descriptions. Plain text for the description box: a strong 1-2 sentence opener, a short bulleted overview, one subscribe line. No hashtags, no links, no emojis in the first line.",
    `Video summary: ${input.summary}. Max 900 characters.`,
    450,
  );
  const text = res.text.trim();
  return {
    items: null,
    text: text.length >= 80 ? text.slice(0, 1500) : deterministicToolDescription(input.summary),
  };
}

// ---------------------------------------------------------------------------
// Hook analyzer
// ---------------------------------------------------------------------------

export interface HookMetrics {
  words: number;
  estSeconds: number;
  style: "open_loop" | "bold_claim" | "stakes" | "in_medias_res" | "direct";
  signals: string[];
  score: number;
}

/** Pure, deterministic hook scoring — the LLM only adds prose suggestions. */
export function analyzeHook(hook: string): HookMetrics {
  const clean = hook.trim().replace(/\s+/g, " ");
  const words = clean === "" ? 0 : clean.split(" ").length;
  const estSeconds = Math.round((words / 150) * 60);
  const lower = clean.toLowerCase();

  const hasQuestion = clean.includes("?");
  const hasNumber = /\d/.test(clean);
  const addressesViewer = /\byou\b|\byour\b/.test(lower);
  const curiosity = /secret|nobody|truth|mistake|wrong|surpris|revealed|what happened|hidden/.test(
    lower,
  );
  const stakes = /risk|lose|losing|cost|fail|warning|danger|before it's too late|ruin/.test(lower);
  const inMediasRes = /^(so |okay |alright |"|')/i.test(clean) || /^\w+ing\b/.test(clean);

  const signals: string[] = [];
  if (estSeconds <= 30) signals.push("fits the 30-second hook window");
  if (addressesViewer) signals.push("speaks directly to the viewer");
  if (hasNumber) signals.push("contains a concrete number");
  if (hasQuestion) signals.push("opens a question loop");
  if (curiosity) signals.push("uses a curiosity gap");
  if (stakes) signals.push("raises stakes");
  if (inMediasRes) signals.push("starts mid-action");

  let score = 40;
  if (estSeconds > 0 && estSeconds <= 30) score += 15;
  if (estSeconds > 30) score -= 15;
  if (addressesViewer) score += 10;
  if (hasNumber) score += 10;
  if (curiosity) score += 10;
  if (hasQuestion) score += 10;
  if (stakes) score += 5;
  score = Math.max(0, Math.min(100, score));

  const style: HookMetrics["style"] = stakes
    ? "stakes"
    : hasQuestion || curiosity
      ? "open_loop"
      : hasNumber
        ? "bold_claim"
        : inMediasRes
          ? "in_medias_res"
          : "direct";

  return { words, estSeconds, style, signals, score };
}

export function deterministicHookSuggestions(m: HookMetrics): string[] {
  const out: string[] = [];
  if (m.estSeconds > 30) {
    out.push("Cut it under 30 seconds — trim setup and start closer to the payoff.");
  }
  if (!m.signals.includes("speaks directly to the viewer")) {
    out.push('Address the viewer directly ("you") so the promise lands personally.');
  }
  if (!m.signals.includes("contains a concrete number")) {
    out.push("Anchor the claim with a concrete number — specificity reads as credibility.");
  }
  if (!m.signals.includes("opens a question loop") && !m.signals.includes("uses a curiosity gap")) {
    out.push("Open a loop the video will close — name the outcome, withhold the how.");
  }
  if (out.length === 0) {
    out.push("Strong foundation — test a bolder first sentence against this one.");
  }
  return out.slice(0, 3);
}

export function parseSuggestionLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 20 && line.length <= 200);
}

const styleLabels: Record<HookMetrics["style"], string> = {
  open_loop: "open loop",
  bold_claim: "bold claim",
  stakes: "stakes",
  in_medias_res: "in medias res",
  direct: "direct address",
};

async function runHookAnalyzer(
  llm: LlmProvider,
  input: Extract<FreeToolRequest, { tool: "hook-analyzer" }>,
): Promise<FreeToolResult> {
  const metrics = analyzeHook(input.hook);
  const res = await complete(
    llm,
    "You are a YouTube retention editor. Reply with exactly 3 concrete rewrite suggestions for the hook, one per line, no numbering, no preamble.",
    `Hook:\n${input.hook}\n\nDetected style: ${styleLabels[metrics.style]}. Weaknesses to address: ${deterministicHookSuggestions(metrics).join(" ")}`,
    300,
  );
  const llmSuggestions = parseSuggestionLines(res.text).slice(0, 3);
  const suggestions =
    llmSuggestions.length >= 2 ? llmSuggestions : deterministicHookSuggestions(metrics);

  const text = [
    `Score: ${metrics.score}/100`,
    `Style: ${styleLabels[metrics.style]}`,
    `Length: ${metrics.words} words (~${metrics.estSeconds}s spoken — target is under 30s)`,
    "",
    "Working for you:",
    ...(metrics.signals.length === 0
      ? ["• (no strong hook signals detected yet)"]
      : metrics.signals.map((s) => `• ${titleCase(s)}`)),
    "",
    "Try next:",
    ...suggestions.map((s) => `• ${s}`),
  ].join("\n");

  return { items: null, text };
}

// ---------------------------------------------------------------------------

export async function runFreeTool(
  llm: LlmProvider,
  input: FreeToolRequest,
): Promise<FreeToolResult> {
  switch (input.tool) {
    case "title-generator":
      return runTitles(llm, input);
    case "tag-generator":
      return runTags(llm, input);
    case "description-generator":
      return runDescription(llm, input);
    case "hook-analyzer":
      return runHookAnalyzer(llm, input);
  }
}
