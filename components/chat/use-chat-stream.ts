"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
}

function initialState(): ChatStreamState {
  return { phase: "idle", text: "", proposal: null, result: null, error: null };
}

export function useChatStream() {
  const [state, setState] = useState<ChatStreamState>(initialState());
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
            return { ...s, phase: "done" };
          case "error":
            return { ...s, phase: "error", error: event.message };
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
      setState({ ...initialState(), phase: "streaming" });
      return new Promise<void>((resolve) => {
        doneRef.current = resolve;
        let source: EventSource;
        try {
          source = new EventSource(streamPath);
        } catch {
          setState((s) => ({ ...s, phase: "error", error: "Could not reach the coach." }));
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
          // Terminal or unreachable — surface and stop (the turn is short and
          // the reply is already persisted server-side).
          if (source.readyState === EventSource.CLOSED) {
            source.close();
            sourceRef.current = null;
            setState((s) => (s.phase === "streaming" ? { ...s, phase: "done" } : s));
            doneRef.current?.();
            doneRef.current = null;
          }
        };
      });
    },
    [apply, cleanup],
  );

  const reset = useCallback(() => {
    cleanup();
    setState(initialState());
  }, [cleanup]);

  return { state, start, reset };
}
