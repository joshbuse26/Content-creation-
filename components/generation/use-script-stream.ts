"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scriptStreamEventSchema } from "@/lib/types/pipeline";
import { storeHookCandidates } from "@/components/editor/hook-store";
import { applyStreamEvent, initialStreamState, type StreamState } from "./stream-reducer";
import { buildFixtureStream } from "./stream-fixtures";

/**
 * Consumes the script pipeline SSE stream
 * (GET /api/script-stream?workspaceId=…&scriptId=…, A2's route). Events
 * arrive with the SSE `event:` field set to the ScriptStreamEvent type and
 * the full JSON event in `data:`.
 *
 * Resilience: transient mid-stream errors are left to EventSource's
 * auto-reconnect (the route replays history, so nothing is lost). After
 * MAX_CONSECUTIVE_ERRORS without an event in between — or a terminal close —
 * the phase surfaces as "stalled" with retry() re-opening the stream. The
 * fixture replay runs ONLY under an explicit fixture-UI signal
 * (NEXT_PUBLIC_FIXTURE_UI), never merely because the endpoint errored.
 */

const STREAM_EVENT_TYPES = [
  "stage_started",
  "stage_done",
  "outline",
  "section",
  "hooks",
  "quality_report",
  "failed",
  "complete",
] as const;

const MAX_CONSECUTIVE_ERRORS = 5;

/** Explicit, build-time fixture-mode signal — never inferred from errors. */
const FIXTURE_UI =
  process.env.NEXT_PUBLIC_FIXTURE_UI === "1" || process.env.NEXT_PUBLIC_FIXTURE_UI === "true";

export function useScriptStream() {
  const [state, setState] = useState<StreamState>(initialStreamState());
  const [elapsedS, setElapsedS] = useState(0);
  const [simulated, setSimulated] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const timersRef = useRef<number[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const gotEventRef = useRef(false);
  const errorCountRef = useRef(0);
  const scriptIdRef = useRef<string | null>(null);
  const lastArgsRef = useRef<{ scriptId: string; workspaceId: string } | null>(null);

  const cleanup = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Wall-clock timer.
  useEffect(() => {
    if (state.phase !== "running") return;
    const interval = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 500);
    return () => {
      window.clearInterval(interval);
    };
  }, [state.phase]);

  const dispatch = useCallback(
    (raw: unknown) => {
      const parsed = scriptStreamEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "hooks" && scriptIdRef.current !== null) {
        storeHookCandidates(scriptIdRef.current, event.candidates);
      }
      if (event.type === "complete" || event.type === "failed") {
        // The run is over — close before the server drop triggers
        // EventSource's auto-reconnect loop.
        cleanup();
      }
      setState((s) => applyStreamEvent(s, event));
    },
    [cleanup],
  );

  const runSimulation = useCallback(() => {
    setSimulated(true);
    let at = 0;
    for (const { delayMs, event } of buildFixtureStream()) {
      at += delayMs;
      const timer = window.setTimeout(() => {
        dispatch(event);
      }, at);
      timersRef.current.push(timer);
    }
  }, [dispatch]);

  const markStalled = useCallback(() => {
    // Never leave a spinner + timer running against a dead source.
    setState((s) => (s.phase === "running" ? { ...s, phase: "stalled" } : s));
  }, []);

  const start = useCallback(
    (scriptId: string, workspaceId: string) => {
      cleanup();
      gotEventRef.current = false;
      errorCountRef.current = 0;
      scriptIdRef.current = scriptId;
      lastArgsRef.current = { scriptId, workspaceId };
      startedAtRef.current = Date.now();
      setElapsedS(0);
      setSimulated(false);
      setState({ ...initialStreamState(), phase: "running" });

      let source: EventSource;
      try {
        source = new EventSource(
          `/api/script-stream?workspaceId=${encodeURIComponent(workspaceId)}&scriptId=${encodeURIComponent(scriptId)}`,
        );
      } catch {
        if (FIXTURE_UI) runSimulation();
        else markStalled();
        return;
      }
      sourceRef.current = source;
      const onEvent = (msg: MessageEvent<string>) => {
        gotEventRef.current = true;
        errorCountRef.current = 0;
        try {
          dispatch(JSON.parse(msg.data));
        } catch {
          // Ignore malformed frames; the schema parse guards shape.
        }
      };
      // The route names each SSE event after its type, so plain onmessage
      // never fires — subscribe to every member of the frozen union.
      for (const type of STREAM_EVENT_TYPES) {
        source.addEventListener(type, onEvent);
      }
      source.onerror = () => {
        if (!gotEventRef.current) {
          // Could not establish the stream at all.
          source.close();
          sourceRef.current = null;
          if (FIXTURE_UI) runSimulation();
          else markStalled();
          return;
        }
        errorCountRef.current += 1;
        if (
          source.readyState === EventSource.CLOSED ||
          errorCountRef.current >= MAX_CONSECUTIVE_ERRORS
        ) {
          // Terminal failure (or too many reconnect attempts) — surface it.
          source.close();
          sourceRef.current = null;
          markStalled();
          return;
        }
        // Transient mid-stream error: leave the source open and let
        // EventSource auto-reconnect (the route replays history).
      };
    },
    [cleanup, dispatch, markStalled, runSimulation],
  );

  /** Re-open the stream after a stall — the replay endpoint restores history. */
  const retry = useCallback(() => {
    const args = lastArgsRef.current;
    if (args !== null) start(args.scriptId, args.workspaceId);
  }, [start]);

  return { state, elapsedS, simulated, start, retry };
}
