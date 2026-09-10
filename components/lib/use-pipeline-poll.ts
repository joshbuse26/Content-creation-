"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bounded polling for queued pipeline work. Panels dispatch a job (tRPC
 * mutation returning 202-style "accepted") and the result lands later via a
 * background worker — nothing pushes it to the client, so without polling
 * the panel never shows it.
 *
 * Call `begin()` when a job is queued: `refetch` runs every `intervalMs`
 * until the watched `data` reference changes (react-query's structural
 * sharing keeps the reference stable when a refetch returns identical data)
 * or `timeoutMs` elapses. While polling, `pending` is true (drives a
 * "working…" indicator); on timeout, polling stops and `timedOut` becomes
 * true (drives a "still working — check back" note).
 */
export interface PipelinePoll {
  /** A job is queued and we are polling for its result. */
  pending: boolean;
  /** Polling gave up after the timeout without seeing a data change. */
  timedOut: boolean;
  /** Start (or restart) polling; call from the dispatch mutation's onSuccess. */
  begin: () => void;
  /** Stop polling and clear both flags. */
  stop: () => void;
}

export function usePipelinePoll(
  refetch: () => unknown,
  data: unknown,
  { intervalMs = 3000, timeoutMs = 5 * 60_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): PipelinePoll {
  const [pending, setPending] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const baselineRef = useRef<unknown>(undefined);
  const intervalRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const refetchRef = useRef(refetch);
  const dataRef = useRef(data);
  useEffect(() => {
    refetchRef.current = refetch;
    dataRef.current = data;
  });

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    setPending(false);
    setTimedOut(false);
  }, [clearTimers]);

  const begin = useCallback(() => {
    clearTimers();
    baselineRef.current = dataRef.current;
    setPending(true);
    setTimedOut(false);
    intervalRef.current = window.setInterval(() => {
      refetchRef.current();
    }, intervalMs);
    timerRef.current = window.setTimeout(() => {
      clearTimers();
      setPending(false);
      setTimedOut(true);
    }, timeoutMs);
  }, [clearTimers, intervalMs, timeoutMs]);

  // Stop as soon as the watched data actually changes.
  useEffect(() => {
    if (!pending) return;
    if (data !== baselineRef.current) stop();
  }, [data, pending, stop]);

  // Never leak timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  return { pending, timedOut, begin, stop };
}
