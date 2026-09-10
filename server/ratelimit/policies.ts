/**
 * Rate-limit policies — spec §6.
 *
 * 100 req/min per user (general) · 10/min on generation endpoints ·
 * 5/min on auth endpoints · 5/day per IP for the future free standalone
 * tools (/tools/*, v1.1).
 */

export interface RateLimitPolicy {
  /** Stable key segment — changing it resets the window for everyone. */
  id: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES = {
  general: { id: "general", limit: 100, windowMs: 60_000 },
  generation: { id: "generation", limit: 10, windowMs: 60_000 },
  auth: { id: "auth", limit: 5, windowMs: 60_000 },
  /** IP-based; keyed by client IP, not user. */
  freeTools: { id: "free-tools", limit: 5, windowMs: 86_400_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
