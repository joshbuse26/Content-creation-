import { LLM_MODELS } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import type { VoiceProfile } from "@/lib/types/entities";
import { licensedSourceCorpus } from "@/lib/multi-voice";
import {
  analyzeSimilarity,
  guardSection,
  LicensedSimilarityError,
  type GuardStatus,
  type SimilarityOptions,
} from "@/lib/similarity-guard";
import { z } from "zod";
import { dedupeRewritePrompt } from "@/prompts";
import { synthDedupeRewrite } from "./fixture-content";
import { generateJson, type EngineMode } from "./llm-json";

/**
 * Pipeline-facing licensed-voice guard (PRODUCT-CONTRACTS §7). Runs the pure
 * `guardSection` gate over each section whose EFFECTIVE voice is licensed,
 * wiring in the real de-duplication rewrite (LLM in live mode, deterministic
 * synthesizer in fixtures). Returns the (possibly rewritten) section bodies
 * and a structured log for the pipeline_run; throws LicensedSimilarityError
 * (from guardSection) when a section is still over the line after its one
 * auto-rewrite — the caller must fail the run and never emit that text.
 *
 * Sections without a licensed effective voice (the overwhelmingly common
 * case) are passed through untouched and not logged — a non-licensed script
 * behaves exactly as before this guard existed.
 */

export interface GuardInputSection {
  position: number;
  body: string;
  /** The licensed voice profile this section is checked against, or null. */
  licensedProfile: VoiceProfile | null;
}

export interface GuardCheckLog {
  position: number;
  status: GuardStatus;
  maxOverlapBefore: number;
  maxOverlapAfter: number | null;
}

export interface LicensedGuardLog {
  guard: "licensed_similarity";
  threshold: number;
  checked: GuardCheckLog[];
}

export interface LicensedGuardResult {
  /** Sections whose body the rewrite changed (position → new body). */
  rewrites: Map<number, string>;
  log: LicensedGuardLog;
}

/**
 * A hard-fail carrying the guard log up to and including the blocked section,
 * so the caller can persist the log on the pipeline_run BEFORE failing the
 * run. `message` is the user-facing LicensedSimilarityError text.
 */
export class LicensedGuardBlockedError extends Error {
  readonly log: LicensedGuardLog;
  constructor(message: string, log: LicensedGuardLog) {
    super(message);
    this.name = "LicensedGuardBlockedError";
    this.log = log;
  }
}

const dedupeSchema = z.object({ body: z.string().min(1) });

/** Build the single-shot de-dup rewrite used by the guard. */
function makeRewrite(
  mode: EngineMode,
  llm: LlmProvider,
): (body: string, matchedNgrams: string[]) => Promise<string> {
  return async (body, matchedNgrams) => {
    const result = await generateJson({
      mode,
      llm,
      model: LLM_MODELS.sonnet,
      template: dedupeRewritePrompt({ body, matchedNgrams }),
      maxTokens: 3000,
      temperature: 0.4,
      schema: dedupeSchema,
      fixture: () => ({ body: synthDedupeRewrite(body) }),
    });
    return result.body;
  };
}

export interface RunLicensedGuardParams {
  mode: EngineMode;
  llm: LlmProvider;
  threshold: number;
  sections: GuardInputSection[];
  options?: Partial<SimilarityOptions>;
}

/**
 * Returns null when NO section has a licensed effective voice (so the caller
 * skips all guard bookkeeping), otherwise the rewrites + log. Throws on hard
 * fail after logging the blocked section into the thrown error's reports.
 */
export async function runLicensedGuard(
  params: RunLicensedGuardParams,
): Promise<LicensedGuardResult | null> {
  const licensedSections = params.sections.filter((s) => s.licensedProfile !== null);
  if (licensedSections.length === 0) return null;

  // Fail CLOSED (P1-1): a licensed voice whose normalized corpus is empty
  // cannot be guarded — there is nothing to compare the output against — so it
  // must not silently pass as "clean" (ratio 0). Refuse to generate instead.
  // The dispatch-time gate (assertLicensedVoiceUsable) already rejects such a
  // voice; this is defense in depth on the pipeline seam.
  for (const section of licensedSections) {
    const profile = section.licensedProfile;
    if (profile !== null && licensedSourceCorpus(profile).length === 0) {
      const blocked: GuardCheckLog = {
        position: section.position,
        status: "blocked",
        maxOverlapBefore: 1,
        maxOverlapAfter: 1,
      };
      throw new LicensedGuardBlockedError(
        "Licensed-voice similarity guard: this licensed voice has no source material to " +
          "check its output against, so the output cannot be verified as original. Nothing " +
          "was published — add example source passages to the licensed voice, or choose a " +
          "different voice.",
        { guard: "licensed_similarity", threshold: params.threshold, checked: [blocked] },
      );
    }
  }
  const guarded = licensedSections;

  const rewrite = makeRewrite(params.mode, params.llm);
  const rewrites = new Map<number, string>();
  const checked: GuardCheckLog[] = [];

  for (const section of guarded) {
    const profile = section.licensedProfile;
    if (profile === null) continue; // narrowed by the filter above
    const sources = licensedSourceCorpus(profile);
    try {
      const outcome = await guardSection({
        body: section.body,
        sources,
        threshold: params.threshold,
        options: params.options,
        rewrite: (body) => {
          const matched = analyzeSimilarity(body, sources, params.options).matchedNgrams;
          return rewrite(body, matched);
        },
      });
      if (outcome.status === "rewritten") rewrites.set(section.position, outcome.body);
      checked.push({
        position: section.position,
        status: outcome.status,
        maxOverlapBefore: outcome.before.maxOverlap,
        maxOverlapAfter: outcome.after?.maxOverlap ?? null,
      });
    } catch (err) {
      if (err instanceof LicensedSimilarityError) {
        // Log the blocked section, then hard-fail carrying the full log so
        // the run records the check result before it fails.
        checked.push({
          position: section.position,
          status: "blocked",
          maxOverlapBefore: err.before.maxOverlap,
          maxOverlapAfter: err.after.maxOverlap,
        });
        throw new LicensedGuardBlockedError(err.message, {
          guard: "licensed_similarity",
          threshold: params.threshold,
          checked,
        });
      }
      throw err;
    }
  }

  return {
    rewrites,
    log: { guard: "licensed_similarity", threshold: params.threshold, checked },
  };
}
