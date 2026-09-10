import { describe, expect, it } from "vitest";
import { scriptIdSchema } from "@/lib/types/ids";
import { scriptStreamEventSchema, type ScriptStreamEvent } from "@/lib/types/pipeline";
import { InProcessScriptEventBus } from "@/pipelines/script/events";
import { createScriptSseStream, encodeSseEvent } from "@/app/api/script-stream/stream";

const SCRIPT_ID = "00000000-0000-4000-8000-000000000040";

const sampleEvents: ScriptStreamEvent[] = [
  { type: "stage_started", stage: "assemble_context" },
  { type: "stage_done", stage: "assemble_context" },
  { type: "stage_started", stage: "outline" },
  {
    type: "outline",
    outline: {
      sections: [
        { kind: "hook", heading: "Hook", purpose: "p", retentionNote: "r", targetSeconds: 20 },
        { kind: "chapter", heading: "One", purpose: "p", retentionNote: "r", targetSeconds: 120 },
        { kind: "outro", heading: "Out", purpose: "p", retentionNote: "r", targetSeconds: 15 },
      ],
    },
  },
  { type: "complete", scriptId: scriptIdSchema.parse(SCRIPT_ID) },
];

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("script SSE stream", () => {
  it("encodes events in the SSE wire format", () => {
    const encoded = encodeSseEvent({ type: "stage_started" });
    expect(encoded).toBe('event: stage_started\ndata: {"type":"stage_started"}\n\n');
  });

  it("replays buffered events in order and closes after the terminal event", async () => {
    const bus = new InProcessScriptEventBus();
    for (const event of sampleEvents) {
      await bus.publish(SCRIPT_ID, scriptStreamEventSchema.parse(event));
    }
    const body = await readAll(
      createScriptSseStream(bus, SCRIPT_ID, { heartbeatMs: 60_000 }),
    );
    const eventLines = body
      .split("\n")
      .filter((l) => l.startsWith("event: "))
      .map((l) => l.slice("event: ".length));
    expect(eventLines).toEqual([
      "stage_started",
      "stage_done",
      "stage_started",
      "outline",
      "complete",
    ]);
    // Each data line round-trips through the frozen event schema.
    const dataLines = body.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of dataLines) {
      scriptStreamEventSchema.parse(JSON.parse(line.slice("data: ".length)));
    }
  });

  it("delivers live events published after subscription starts", async () => {
    const bus = new InProcessScriptEventBus();
    const streamPromise = readAll(
      createScriptSseStream(bus, SCRIPT_ID, { heartbeatMs: 60_000 }),
    );
    // Publish after the stream is reading.
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const event of sampleEvents) {
      await bus.publish(SCRIPT_ID, scriptStreamEventSchema.parse(event));
    }
    const body = await streamPromise;
    expect(body).toContain("event: outline");
    expect(body.trimEnd().split("\n\n").at(-1)).toContain('"type":"complete"');
  });

  it("ends the subscription on abort", async () => {
    const bus = new InProcessScriptEventBus();
    const controller = new AbortController();
    const streamPromise = readAll(
      createScriptSseStream(bus, SCRIPT_ID, {
        heartbeatMs: 60_000,
        signal: controller.signal,
      }),
    );
    await bus.publish(SCRIPT_ID, { type: "stage_started", stage: "outline" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const body = await streamPromise;
    expect(body).toContain("event: stage_started");
  });
});
