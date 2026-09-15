"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * The app's QueryClient defaults, factored out of AppProviders so tests can
 * mount screens against the EXACT production retry/stale policy.
 *
 * F0 (Coach reliability): `retry` is a function that NEVER retries a
 * TOO_MANY_REQUESTS. Retrying a 429 only adds load to the bucket that is
 * already full — in production the old flat `retry: 1` doubled every
 * request of a render→invalidate loop. Other failures keep one retry.
 */

export const DEFAULT_STALE_TIME_MS = 30_000;
export const DEFAULT_RETRIES = 1;

/** True for a tRPC client error carrying TOO_MANY_REQUESTS / HTTP 429. */
export function isRateLimitError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const data = (err as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const { code, httpStatus } = data as { code?: unknown; httpStatus?: unknown };
  return code === "TOO_MANY_REQUESTS" || httpStatus === 429;
}

/** Retry policy for every query: bounded, and never on a rate limit. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isRateLimitError(error)) return false;
  return failureCount < DEFAULT_RETRIES;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: false,
      },
    },
  });
}
