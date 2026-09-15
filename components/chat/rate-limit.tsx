"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRateLimitError } from "@/components/providers/query-client";
import { Button } from "@/components/ui/button";

/**
 * 429 handling for the chat surface (F0 — Coach reliability).
 *
 * When a chat read is rate-limited the UI STOPS: no query retry (the app
 * QueryClient never retries TOO_MANY_REQUESTS), no invalidation, no loop.
 * Instead the panel shows one "Taking a breath" notice with a manual retry,
 * and schedules a single bounded re-attempt with exponential backoff
 * (1s, 2s, 4s … capped at 30s). After BACKOFF_MAX_ATTEMPTS consecutive 429s
 * the circuit breaks: automatic retries stop and only the manual button
 * remains, so the client can never become the storm that keeps a bucket full.
 */

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_MAX_ATTEMPTS = 5;

/** Delay before the (attempt+1)th automatic retry: 1s, 2s, 4s, … ≤ 30s. */
export function backoffDelayMs(attempt: number): number {
  const clamped = Math.max(0, Math.floor(attempt));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** clamped);
}

/** The slice of a react-query result the backoff needs (structural, for tests). */
export interface BackoffQuery {
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  /** react-query's per-observer failed-fetch counter (bumps once per failure). */
  errorUpdateCount: number;
  refetch: () => unknown;
}

export interface RateLimitBackoff {
  /** The most recent fetch was a 429. */
  limited: boolean;
  /** Circuit open: BACKOFF_MAX_ATTEMPTS consecutive 429s; manual retry only. */
  paused: boolean;
  /** Consecutive 429s (resets on the next success). */
  failures: number;
  /** Delay of the scheduled automatic retry, or null when none is scheduled. */
  nextRetryMs: number | null;
  /** Manual retry: cancels any scheduled retry and refetches now. */
  retryNow: () => void;
}

export function useRateLimitBackoff(query: BackoffQuery): RateLimitBackoff {
  const [failures, setFailures] = useState(0);
  const handledErrorCount = useRef(0);
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  const limited = query.isError && isRateLimitError(query.error);

  // Count each NEW failed fetch exactly once (keyed on errorUpdateCount, not
  // on renders); a success closes the circuit, a non-429 error clears it.
  useEffect(() => {
    if (query.isSuccess) {
      setFailures(0);
      return;
    }
    if (!query.isError) return;
    if (query.errorUpdateCount === handledErrorCount.current) return;
    handledErrorCount.current = query.errorUpdateCount;
    if (isRateLimitError(query.error)) setFailures((n) => n + 1);
    else setFailures(0);
  }, [query.isSuccess, query.isError, query.errorUpdateCount, query.error]);

  const paused = limited && failures >= BACKOFF_MAX_ATTEMPTS;
  const nextRetryMs = limited && !paused && failures > 0 ? backoffDelayMs(failures - 1) : null;

  // One timer per counted failure — the deps change only when the failure
  // count (or the limited flag) changes, never per render, so the timer
  // actually fires.
  useEffect(() => {
    if (nextRetryMs === null) return;
    const timer = window.setTimeout(() => {
      void refetchRef.current();
    }, nextRetryMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [nextRetryMs, failures]);

  const retryNow = useCallback(() => {
    void refetchRef.current();
  }, []);

  return useMemo(
    () => ({ limited, paused, failures, nextRetryMs, retryNow }),
    [limited, paused, failures, nextRetryMs, retryNow],
  );
}

/** Copy for the notice — exported so tests pin the exact affordance. */
export const RATE_LIMIT_TITLE = "Taking a breath";
export const RATE_LIMIT_PAUSED_HINT = "Paused after several tries. Retry when you're ready.";

export function RateLimitNotice({
  backoff,
  what,
}: {
  backoff: RateLimitBackoff;
  /** What was being loaded, e.g. "your conversations". */
  what: string;
}) {
  const hint = backoff.paused
    ? RATE_LIMIT_PAUSED_HINT
    : backoff.nextRetryMs !== null
      ? `Too many requests loading ${what}. Retrying in ${String(Math.ceil(backoff.nextRetryMs / 1000))}s.`
      : `Too many requests loading ${what}.`;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="rate-limit-notice"
      data-paused={backoff.paused ? "true" : "false"}
      className="flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-6 text-center dark:border-amber-900 dark:bg-amber-950/30"
    >
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{RATE_LIMIT_TITLE}</p>
      <p className="max-w-sm text-xs text-zinc-600 dark:text-zinc-400">{hint}</p>
      <Button variant="secondary" size="sm" onClick={backoff.retryNow}>
        Retry
      </Button>
    </div>
  );
}
