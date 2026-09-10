import { TRPCError } from "@trpc/server";
import { logger } from "@/lib/logger";
import { getRedisConnection, hasRedis } from "@/queue/connection";
import { middleware } from "@/server/trpc";
import {
  MemorySlidingWindowStore,
  RateLimiter,
  RedisSlidingWindowStore,
  type RateLimitDecision,
} from "./limiter";
import { RATE_LIMIT_POLICIES, type RateLimitPolicy, type RateLimitPolicyName } from "./policies";

/**
 * Attachment points for the integrator:
 *
 * - tRPC: chain `.use(rateLimitMiddleware("general"))` (or "generation") onto
 *   procedures — after protectedProcedure so the subject is the user id.
 *   e.g. `workspaceProcedure("script", "create").use(rateLimitMiddleware("generation"))`.
 * - Route handlers (auth endpoints, future /tools/*): call
 *   `enforceRateLimit("auth", ip)` / `enforceRateLimit("freeTools", ip)` and
 *   return 429 with `rateLimitHeaders(decision)` when `allowed` is false.
 *
 * Redis-backed when REDIS_URL is set; in-memory otherwise (tests, fixture
 * mode, single-process dev). Fail-open on store errors: an unavailable Redis
 * must not take down the API — the event is logged for ops.
 */

let cached: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (cached === undefined) {
    if (hasRedis()) {
      cached = new RateLimiter(new RedisSlidingWindowStore(getRedisConnection()));
    } else {
      logger.warn("REDIS_URL not set — rate limits are per-process (in-memory) only");
      cached = new RateLimiter(new MemorySlidingWindowStore());
    }
  }
  return cached;
}

/** Test hook: swap or clear the process-wide limiter. */
export function setRateLimiterForTests(limiter: RateLimiter | undefined): void {
  cached = limiter;
}

function resolvePolicy(policy: RateLimitPolicyName | RateLimitPolicy): RateLimitPolicy {
  return typeof policy === "string" ? RATE_LIMIT_POLICIES[policy] : policy;
}

/**
 * Check and record a hit for `subject` under `policy`. Never throws on store
 * failure: general traffic fails OPEN (an unavailable Redis must not take
 * down the API), but the "generation" policy fails CLOSED — generation
 * endpoints spend real money, so an unlimitable request is a denied one.
 */
export async function checkRateLimit(
  policy: RateLimitPolicyName | RateLimitPolicy,
  subject: string,
): Promise<RateLimitDecision> {
  const resolved = resolvePolicy(policy);
  try {
    return await getRateLimiter().check(resolved, subject);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (resolved.id === RATE_LIMIT_POLICIES.generation.id) {
      logger.error(
        { policy: resolved.id, err: message },
        "rate limit store unavailable — failing CLOSED for the generation policy (cost control)",
      );
      return {
        allowed: false,
        limit: resolved.limit,
        remaining: 0,
        retryAfterMs: resolved.windowMs,
      };
    }
    logger.error(
      { policy: resolved.id, err: message },
      "rate limit store unavailable — failing open",
    );
    return { allowed: true, limit: resolved.limit, remaining: resolved.limit, retryAfterMs: 0 };
  }
}

/** Throws TRPCError TOO_MANY_REQUESTS when over the limit; returns the decision otherwise. */
export async function enforceRateLimit(
  policy: RateLimitPolicyName | RateLimitPolicy,
  subject: string,
): Promise<RateLimitDecision> {
  const decision = await checkRateLimit(policy, subject);
  if (!decision.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Try again shortly.",
    });
  }
  return decision;
}

/** Standard headers for HTTP 429 responses (route handlers). */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)),
  };
}

/** Best-effort client IP for route-handler rate limiting (proxy-aware). */
export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real !== null && real.trim() !== "") return real.trim();
  return "unknown";
}

/**
 * Route-handler enforcement: returns a ready 429 Response when over the
 * limit, null when the request may proceed.
 */
export async function enforceRateLimitHttp(
  policy: RateLimitPolicyName | RateLimitPolicy,
  subject: string,
): Promise<Response | null> {
  const decision = await checkRateLimit(policy, subject);
  if (decision.allowed) return null;
  return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
    status: 429,
    headers: { "Content-Type": "application/json", ...rateLimitHeaders(decision) },
  });
}

/**
 * tRPC middleware — subject is the signed-in user id (falls back to
 * "anonymous" pre-auth, which shares one bucket by design: unauthenticated
 * traffic gets no per-caller budget).
 */
export function rateLimitMiddleware(policy: RateLimitPolicyName | RateLimitPolicy) {
  return middleware(async ({ ctx, next }) => {
    const subject = ctx.session?.user.id ?? "anonymous";
    await enforceRateLimit(policy, subject);
    return next();
  });
}
