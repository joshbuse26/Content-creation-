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
 * the full JSON event in `data:`. If the endpoint errors before the first
 * event, the stream is replayed from fixtures with realistic pacing.
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
export function useScriptStream() {
  const [state, setState] = useState<StreamState>(initialStreamState());
  const [elapsedS, setElapsedS] = useState(0);
  const [simulated, setSimulated] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const timersRef = useRef<number[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const gotEventRef = useRef(false);
  const scriptIdRef = useRef<string | null>(null);

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

  const dispatch = useCallback((raw: unknown) => {
    const parsed = scriptStreamEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === "hooks" && scriptIdRef.current !== null) {
      storeHookCandidates(scriptIdRef.current, event.candidates);
    }
    setState((s) => applyStreamEvent(s, event));
  }, []);

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

  const start = useCallback(
    (scriptId: string, workspaceId: string) => {
      cleanup();
      gotEventRef.current = false;
      scriptIdRef.current = scriptId;
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
        runSimulation();
        return;
      }
      sourceRef.current = source;
      const onEvent = (msg: MessageEvent<string>) => {
        gotEventRef.current = true;
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
        source.close();
        sourceRef.current = null;
        if (!gotEventRef.current) {
          // Endpoint not available — fall back to the fixture replay.
          runSimulation();
        }
      };
    },
    [cleanup, dispatch, runSimulation],
  );

  return { state, elapsedS, simulated, start };
}
