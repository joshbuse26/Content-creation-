import { z } from "zod";
import type { DemandLevel, DemandSignal } from "@/lib/types/entities";
import { logger } from "@/lib/logger";
import { DEMAND_CACHE_TTL_SECONDS, demandCacheKey } from "./cache";
import type { IdeationDeps } from "./deps";
import { normalizeTitle } from "./similarity";

/**
 * Search-demand signal (Wave-D D3) — a lightweight, pre-write demand
 * indicator per concept/topic, computed behind the EXISTING provider seam
 * (the web SearchProvider) so it needs ZERO keys and no new paid API, and
 * never scrapes YouTube. In fixture mode the provider is deterministic, so
 * the derived demand is deterministic too.
 *
 * The score is derived from the provider's returned result set: the result
 * volume (a real signal live — more indexed results ⇒ more demand) plus a
 * stable spread taken from the result URLs, so distinct topics get distinct,
 * reproducible scores. Signals are cached 24h keyed by the NORMALIZED topic,
 * so a discovery-surface read costs at most one provider call per fresh
 * topic per day (and none for topics the daily feed already warmed).
 */

/** How many results to sample per topic for the demand read. */
export const DEMAND_SAMPLE_SIZE = 8;
/** Score >= this reads as "high" demand; the midpoint reads as "moderate". */
export const DEMAND_HIGH_THRESHOLD = 66;
export const DEMAND_MODERATE_THRESHOLD = 33;

const cachedDemandSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(["low", "moderate", "high"]),
  sampleCount: z.number().int().nonnegative(),
  computedAt: z.string(),
});

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function demandLevel(score: number): DemandLevel {
  if (score >= DEMAND_HIGH_THRESHOLD) return "high";
  if (score >= DEMAND_MODERATE_THRESHOLD) return "moderate";
  return "low";
}

/**
 * Pure scorer: 0-100 from a provider result set. Result VOLUME drives the
 * base (each result adds ~7, so a full page reads as strong demand); the
 * result URLs add a deterministic 0-39 spread so distinct topics separate
 * cleanly. Empty result set ⇒ 0 (no demand signal). Exported for tests.
 */
export function scoreFromResults(results: readonly { url: string }[]): number {
  if (results.length === 0) return 0;
  const volume = results.length;
  const spread = fnv1a(results.map((r) => r.url).join("|")) % 40;
  return clamp(Math.round(volume * 7 + spread), 1, 100);
}

/** Topics that normalize to nothing (e.g. only punctuation) carry no demand. */
function emptySignal(topic: string): DemandSignal {
  return { topic, score: 0, level: "low", sampleCount: 0, provider: "web_search" };
}

/**
 * Compute demand signals for a set of topics, deduped by normalized form and
 * cached 24h. Never throws: a provider hiccup on one topic degrades that
 * topic to a zero signal (the discovery surface stays up) rather than
 * failing the whole read.
 */
export async function computeTopicDemand(
  deps: IdeationDeps,
  topics: readonly string[],
): Promise<DemandSignal[]> {
  const seen = new Set<string>();
  const signals: DemandSignal[] = [];

  for (const topic of topics) {
    const normalized = normalizeTitle(topic);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);

    const key = demandCacheKey(normalized);
    const cached = await deps.cache.get(key, (raw) => cachedDemandSchema.parse(raw));
    if (cached !== null) {
      signals.push({
        topic,
        score: cached.score,
        level: cached.level,
        sampleCount: cached.sampleCount,
        provider: "web_search",
      });
      continue;
    }

    try {
      const results = await deps.search.search(topic, DEMAND_SAMPLE_SIZE);
      const score = scoreFromResults(results);
      const level = demandLevel(score);
      const signal: DemandSignal = {
        topic,
        score,
        level,
        sampleCount: results.length,
        provider: "web_search",
      };
      await deps.cache.set(
        key,
        { score, level, sampleCount: results.length, computedAt: deps.now().toISOString() },
        DEMAND_CACHE_TTL_SECONDS,
      );
      signals.push(signal);
    } catch (err) {
      logger.warn(
        { topic, err: (err as Error).message },
        "search-demand: provider read failed, degrading to zero signal",
      );
      signals.push(emptySignal(topic));
    }
  }

  return signals;
}
