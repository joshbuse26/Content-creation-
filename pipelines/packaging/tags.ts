import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import { generatedTagsSchema } from "@/lib/types/pipeline";
import type { PackagingContext } from "./context";

/**
 * Tag generation — spec §5.11: Haiku, 15-25 tags. The LLM is asked for a JSON
 * array; the output is normalized (lowercased, deduped, length-capped) and
 * validated against the frozen generatedTagsSchema. If the model returns
 * something unusable (or in fixture mode, where the canned LLM returns prose),
 * a deterministic tag builder derived from the frame/niche keywords fills the
 * gap so the pipeline always yields a valid 15-25 tag set.
 */

export const TAG_MIN = 15;
export const TAG_MAX = 25;
const TAG_MAX_LENGTH = 60;

export function buildTagsPrompt(ctx: PackagingContext): string {
  const keywords = [...(ctx.frame?.keywords ?? []), ...ctx.nicheKeywords];
  const headings = ctx.sections.map((s) => s.heading).join(" · ");
  return [
    `Video title (working): ${ctx.projectTitle}`,
    `Angle: ${ctx.frame?.angle ?? "n/a"}`,
    `Known keywords: ${keywords.join(", ")}`,
    `Section headings: ${headings}`,
    "",
    `Task: produce ${TAG_MIN}-${TAG_MAX} YouTube tags for this video. Mix broad niche terms, specific long-tail phrases, and title variants. Lowercase, no hashtags, each tag at most ${TAG_MAX_LENGTH} characters.`,
    'Return ONLY a JSON array of strings, e.g. ["tag one", "tag two"]. No other text.',
  ].join("\n");
}

/** Normalize raw candidate tags: trim, lowercase, strip '#', dedupe, drop empties/overlong. */
export function normalizeTags(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const tag = raw.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, " ");
    if (tag.length < 2 || tag.length > TAG_MAX_LENGTH) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

const jsonStringArray = z.array(z.string());

/** Best-effort extraction of a JSON string array from LLM output. */
export function extractTagArray(text: string): string[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const result = jsonStringArray.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic tags from the packaging context — the fixture-mode source and
 * the top-up when the LLM under-delivers. Same context → same tags.
 */
export function deterministicTags(ctx: PackagingContext): string[] {
  const base = [...(ctx.frame?.keywords ?? []), ...ctx.nicheKeywords];
  const titleWords = ctx.projectTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s$]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const candidates: string[] = [
    ...base,
    ctx.projectTitle.toLowerCase(),
    ...base.map((k) => `${k} tips`),
    ...base.map((k) => `best ${k}`),
    ...base.map((k) => `${k} guide`),
    ...base.map((k) => `${k} for beginners`),
    ...titleWords
      .slice(0, 6)
      .map((w, i) => (titleWords[i + 1] !== undefined ? `${w} ${titleWords[i + 1]}` : w)),
    ...(ctx.frame === null
      ? []
      : [`${ctx.frame.format} video`, ctx.frame.audienceSegment.toLowerCase()]),
  ];
  return normalizeTags(candidates);
}

/**
 * Generate 15-25 tags. Haiku first; deterministic top-up/fallback second.
 * The result always satisfies the frozen generatedTagsSchema.
 */
export async function generateTagList(llm: LlmProvider, ctx: PackagingContext): Promise<string[]> {
  const response = await llm.complete({
    model: LLM_MODELS.haiku,
    system: "You produce YouTube tag lists as JSON arrays of lowercase strings. JSON only.",
    prompt: buildTagsPrompt(ctx),
    maxTokens: 600,
    temperature: 0.4,
  });

  const fromLlm = normalizeTags(extractTagArray(response.text) ?? []);
  const merged = normalizeTags([...fromLlm, ...deterministicTags(ctx)]).slice(0, TAG_MAX);

  if (merged.length < TAG_MIN) {
    // Pathological context (few keywords): pad with generic-but-honest terms.
    const genericPool = [
      ...ctx.projectTitle
        .toLowerCase()
        .split(/\s+/)
        .map((w) => `${w} explained`),
      "how to",
      "tutorial",
      "explained",
      "review",
      "comparison",
      "tips and tricks",
      "step by step",
      "beginner guide",
      "deep dive",
      "behind the scenes",
      "top picks",
      "worth it",
      "before you buy",
      "common mistakes",
      "youtube video",
    ];
    const padded = normalizeTags([...merged, ...genericPool]).slice(0, TAG_MAX);
    return generatedTagsSchema.parse({ tags: padded }).tags;
  }
  return generatedTagsSchema.parse({ tags: merged }).tags;
}
