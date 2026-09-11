import { encodeChatSseEvent, type ChatStreamEvent } from "@/lib/types/chat";

/**
 * SSE encoding for the chat stream — separated from the route handler so the
 * streaming behavior is testable without HTTP/auth plumbing. Mirrors the
 * script stream (app/api/script-stream/stream.ts): each event is framed as
 *   event: <event.type>
 *   data:  <JSON of the whole event>
 * via the frozen encodeChatSseEvent, with a heartbeat comment to keep proxies
 * from idling the connection out. The event source is any AsyncIterable of
 * chat events (an assistant turn, or a bridged draft stream).
 */

export const HEARTBEAT_MS = 15_000;

export function createChatSseStream(
  events: AsyncIterable<ChatStreamEvent>,
  options: { heartbeatMs?: number } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Stream already closed by the client — nothing to do.
        }
      };
      safeEnqueue(`: connected ${Date.now().toString()}\n\n`);
      heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now().toString()}\n\n`);
      }, heartbeatMs);
      try {
        for await (const event of events) {
          safeEnqueue(encodeChatSseEvent(event));
        }
      } catch {
        safeEnqueue(
          encodeChatSseEvent({ type: "error", message: "The coach stream ended unexpectedly." }),
        );
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });
}
