import { TRPCError } from "@trpc/server";
import { getConfig } from "@/lib/config";
import type { GenerationTarget } from "@/lib/types/entities";
import type { GenerationMode } from "@/lib/types/enums";

/**
 * Generation-mode guards (PRODUCT-CONTRACTS §3) — the SHARED server module
 * every dispatch site must call before doing mode-driven work. The Zod
 * schema (generationTargetSchema) enforces shape consistency; this module
 * enforces availability:
 *
 *  - partnered_named: rejected unless FEATURE_PARTNERED_NAMED is on. Even
 *    with the flag on, C1's resolver must additionally verify the partner
 *    row is `enabled` (which the DB CHECK ties to signed license fields).
 *  - train_on_my_channel: enum-only in this wave — always rejected with a
 *    clear message until the explicit-consent training flow ships.
 */

export function isPartneredNamedEnabled(): boolean {
  return getConfig().FEATURE_PARTNERED_NAMED;
}

/** Throws unless the requested mode is currently available. */
export function assertGenerationModeAllowed(mode: GenerationMode): void {
  if (mode === "partnered_named" && !isPartneredNamedEnabled()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Partnered creator voices are not available on this deployment.",
    });
  }
  if (mode === "train_on_my_channel") {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Training on your own channel is not available yet.",
    });
  }
}

/**
 * Guard for procedure inputs carrying an optional generation target: null
 * (legacy voice-profile flow) passes; otherwise the mode must be allowed.
 */
export function assertGenerationTargetAllowed(generation: GenerationTarget | null): void {
  if (generation === null) return;
  assertGenerationModeAllowed(generation.mode);
}
