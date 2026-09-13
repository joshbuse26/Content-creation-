import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import { containsRealCreatorName } from "@/lib/seed-lint";
import type { NicheVideo, WhyItWorked } from "@/lib/types/entities";
import { generateJson } from "@/pipelines/script/llm-json";
import { WHY_CACHE_TTL_SECONDS, whyCacheKey } from "./cache";
import type { IdeationDeps } from "./deps";
import { recencyBand } from "./enrich";
import { synthWhyItWorked } from "./fixture-content";
import { whyItWorkedPrompt } from "./prompts";

/**
 * "Why it worked" blurbs (Wave-D E3) — a short, cached, Coach-tier (LlmProvider)
 * one-liner per outlier explaining the likely structural driver of its
 * over-performance (title pattern, format, timing). Cheap (Haiku tier), cached
 * 7 days keyed by video id, and deterministic + keyless in fixture mode.
 *
 * GUARDRAIL: every blurb is run through seed-lint; a blurb that names a real
 * person falls back to the deterministic no-name synth, so the surface never
 * surfaces a real creator's name.
 */

const MAX_PER_CALL = 40;

const whyOutputSchema = z.object({
  videos: z.array(z.object({ youtubeVideoId: z.string(), blurb: z.string().min(1).max(400) })),
});

/** The deterministic, name-free blurb for a row (fixture + seed-lint fallback). */
function safeBlurb(video: NicheVideo, now: Date): string {
  return synthWhyItWorked({
    outlierRatio: video.outlierRatio,
    formatTags: video.formatTags,
    recency: recencyBand(video.publishedAt, now),
  });
}

/**
 * Compute (or re-serve from cache) a "why it worked" blurb per outlier row.
 * Never throws: a provider hiccup or a name-carrying blurb degrades that one
 * row to the deterministic no-name synth rather than failing the read.
 */
export async function computeWhyItWorked(
  deps: IdeationDeps,
  videos: readonly NicheVideo[],
): Promise<WhyItWorked[]> {
  const now = deps.now();
  const rows = videos.slice(0, MAX_PER_CALL);
  if (rows.length === 0) return [];

  // 1. Serve cached blurbs; collect the misses for one batched generation.
  const out = new Map<string, string>();
  const misses: NicheVideo[] = [];
  for (const video of rows) {
    const cached = await deps.cache.get(whyCacheKey(video.youtubeVideoId), (raw) =>
      z.string().parse(raw),
    );
    if (cached !== null) out.set(video.youtubeVideoId, cached);
    else misses.push(video);
  }

  // 2. Generate the misses (deterministic fixture twin; Haiku live).
  if (misses.length > 0) {
    let generated = new Map<string, string>();
    try {
      const result = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.haiku,
        template: whyItWorkedPrompt({
          videos: misses.map((v) => ({
            youtubeVideoId: v.youtubeVideoId,
            title: v.title,
            outlierRatio: v.outlierRatio,
            formatTags: v.formatTags,
            recency: recencyBand(v.publishedAt, now),
          })),
        }),
        maxTokens: 1200,
        temperature: 0,
        schema: whyOutputSchema,
        fixture: () => ({
          videos: misses.map((v) => ({
            youtubeVideoId: v.youtubeVideoId,
            blurb: safeBlurb(v, now),
          })),
        }),
      });
      generated = new Map(result.videos.map((v) => [v.youtubeVideoId, v.blurb]));
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "why-it-worked: generation failed, degrading to deterministic synth",
      );
    }

    for (const video of misses) {
      const raw = generated.get(video.youtubeVideoId);
      // Seed-lint: a blurb that names a real person falls back to the no-name synth.
      const blurb =
        raw !== undefined && !containsRealCreatorName(raw) ? raw : safeBlurb(video, now);
      out.set(video.youtubeVideoId, blurb);
      await deps.cache.set(whyCacheKey(video.youtubeVideoId), blurb, WHY_CACHE_TTL_SECONDS);
    }
  }

  // 3. Return in the input order.
  return rows.map((v) => ({
    youtubeVideoId: v.youtubeVideoId,
    blurb: out.get(v.youtubeVideoId) ?? safeBlurb(v, now),
  }));
}
