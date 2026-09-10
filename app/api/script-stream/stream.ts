import type { ScriptEventBus } from "@/pipelines/script/events";

/**
 * SSE encoding for the script stream — separated from the route handler so
 * the streaming behavior is testable without HTTP/auth plumbing.
 *
 * Wire format per event (the frozen ScriptStreamEvent union, JSON-encoded):
 *   event: <event.type>
 *   data: <JSON of the whole event>
 *
 * A heartbeat comment line keeps proxies from idling the connection out.
 */

export const HEARTBEAT_MS = 15_000;

export function encodeSseEvent(event: { type: string }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createScriptSseStream(
  bus: ScriptEventBus,
  scriptId: string,
  options: { signal?: AbortSignal; heartbeatMs?: number } = {},
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
      // Flush a comment immediately so response headers reach the client
      // (EventSource onopen) before the first real event or heartbeat.
      safeEnqueue(`: connected ${Date.now().toString()}\n\n`);
      heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${Date.now().toString()}\n\n`);
      }, heartbeatMs);
      try {
        for await (const event of bus.subscribe(scriptId, options.signal)) {
          safeEnqueue(encodeSseEvent(event));
        }
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
