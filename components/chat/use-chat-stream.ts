"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatStreamEventSchema, type ChatStreamEvent } from "@/lib/types/chat";
import type { ChatToolCall } from "@/lib/types/entities";

/**
 * Consumes the chat SSE stream (GET /api/chat-stream, D1's route). Events
 * arrive with the SSE `event:` field set to the ChatStreamEvent type and the
 * full JSON event in `data:` — the same framing as the script stream, so the
 * client subscribes to every member of the chat union by name.
 *
 * The hook accumulates the assistant's streamed text, captures a proposed
 * tool, and surfaces terminal done/error. It drives BOTH the assistant-turn
 * stream and the draft bridge (which reuses message_delta + tool_result).
 *
 * Identity contract (F0): the returned object is memoized, so it is safe in
 * effect dependency lists — a fresh object per render was what turned the
 * chat panel's "reconcile on done" effect into a render→invalidate loop.
 * `state.completionId` increments exactly once per terminal transition
 * (done or error); consumers key one-shot work on it, never on `phase`.
 */

const CHAT_EVENT_TYPES = [
  "message_delta",
  "tool_proposed",
  "tool_result",
  "done",
  "error",
] as const;

export type ChatStreamPhase = "idle" | "streaming" | "done" | "error";

export interface ChatStreamState {
  phase: ChatStreamPhase;
  /** Accumulated assistant reply text. */
  text: string;
  /** A tool the Coach proposed this turn (awaiting confirm), if any. */
  proposal: ChatToolCall | null;
  /** A tool_result summary (draft bridge / confirm echo), if any. */
  result: { toolCallId: string; ok: boolean; summary: string } | null;
  error: string | null;
  /**
   * Monotonic counter, bumped once per transition INTO done/error. 0 until
   * the first completion. Lets a consumer react to a completion exactly once
   * (compare against the last value it handled) rather than on every render
   * while the phase happens to still read "done".
   */
  completionId: number;
}

/** Generic message when the stream cannot be opened or drops before any reply. */
export const STREAM_UNREACHABLE_MESSAGE = "Could not reach the coach. Try again.";

function initialState(completionId: number): ChatStreamState {
  return {
    phase: "idle",
    text: "",
    proposal: null,
    result: null,
    error: null,
    completionId,
  };
}

export function useChatStream() {
  const [state, setState] = useState<ChatStreamState>(() => initialState(0));
  const sourceRef = useRef<EventSource | null>(null);
  const doneRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const apply = useCallback(
    (event: ChatStreamEvent) => {
      setState((s) => {
        switch (event.type) {
          case "message_delta":
            return { ...s, phase: "streaming", text: s.text + event.text };
          case "tool_proposed":
            return {
              ...s,
              proposal: {
                toolCallId: event.toolCallId,
                name: event.name,
                args: event.args,
                estimatedCredits: event.estimatedCredits,
              },
            };
          case "tool_result":
            return {
              ...s,
              result: { toolCallId: event.toolCallId, ok: event.ok, summary: event.summary },
            };
          case "done":
            return s.phase === "streaming"
              ? { ...s, phase: "done", completionId: s.completionId + 1 }
              : s;
          case "error":
            return s.phase === "streaming"
              ? { ...s, phase: "error", error: event.message, completionId: s.completionId + 1 }
              : s;
        }
      });
      if (event.type === "done" || event.type === "error") {
        cleanup();
        doneRef.current?.();
        doneRef.current = null;
      }
    },
    [cleanup],
  );

  /** Open a stream; resolves when it reaches a terminal (done/error/close). */
  const start = useCallback(
    (streamPath: string): Promise<void> => {
      cleanup();
      setState((s) => ({ ...initialState(s.completionId), phase: "streaming" }));
      return new Promise<void>((resolve) => {
        doneRef.current = resolve;
        let source: EventSource;
        try {
          source = new EventSource(streamPath);
        } catch {
          setState((s) => ({
            ...s,
            phase: "error",
            error: STREAM_UNREACHABLE_MESSAGE,
            completionId: s.completionId + 1,
          }));
          doneRef.current = null;
          resolve();
          return;
        }
        sourceRef.current = source;
        const onEvent = (msg: MessageEvent<string>) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(msg.data);
          } catch {
            return;
          }
          const result = chatStreamEventSchema.safeParse(parsed);
          if (result.success) apply(result.data);
        };
        for (const type of CHAT_EVENT_TYPES) source.addEventListener(type, onEvent);
        source.onerror = () => {
          // Any transport error is TERMINAL for a one-shot turn: the reply is
          // persisted server-side before it streams, and the panel reconciles
          // by refetching the thread — so we never let EventSource auto-
          // reconnect (which would re-run the turn). A drop before ANY reply
          // text (e.g. the route answered 401/429/5xx) is surfaced as an
          // error, not a silent "done": the user must see something actionable.
          source.close();
          sourceRef.current = null;
          setState((s) =>
            s.phase === "streaming"
              ? s.text === "" && s.proposal === null && s.result === null
                ? {
                    ...s,
                    phase: "error",
                    error: STREAM_UNREACHABLE_MESSAGE,
                    completionId: s.completionId + 1,
                  }
                : { ...s, phase: "done", completionId: s.completionId + 1 }
              : s,
          );
          doneRef.current?.();
          doneRef.current = null;
        };
      });
    },
    [apply, cleanup],
  );

  const reset = useCallback(() => {
    cleanup();
    setState((s) => initialState(s.completionId));
  }, [cleanup]);

  return useMemo(() => ({ state, start, reset }), [state, start, reset]);
}
