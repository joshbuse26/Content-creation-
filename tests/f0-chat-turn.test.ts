import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, LLM_MODELS, parseEnv, resetConfigForTests, type AppConfig } from "@/lib/config";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { LlmProvider, LlmRequest, LlmResponse } from "@/lib/providers/types";
import { chatStreamEventSchema, type ChatStreamEvent } from "@/lib/types/chat";
import { chatMessageIdSchema, chatThreadIdSchema } from "@/lib/types/ids";
import { createChatSseStream } from "@/app/api/chat-stream/stream";
import { getProviders, resetProvidersForTests } from "@/lib/providers";
import { GrokLlm } from "@/lib/providers/live/grok";
import { getEngineDeps, setEngineDepsForTests } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { InMemoryChatStore, setChatStoreForTests } from "@/server/chat/store";
import {
  CHAT_TURN_FAILED_MESSAGE,
  CHAT_TURN_TIMEOUT_MESSAGE,
  ChatTurnTimeoutError,
  runAssistantTurn,
  withTurnDeadline,
} from "@/server/chat/turn";
import { RATE_LIMIT_POLICIES } from "@/server/ratelimit/policies";
import { chatImpl } from "@/server/routers/impl/chat";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * F0 — Coach reliability, server side (docs/COACH-RELIABILITY.md):
 *
 *  - the assistant turn has a HARD deadline: a provider that stalls (even one
 *    that ignores abort) yields a terminal `error` event and the SSE stream
 *    closes within the deadline — the browser never hangs on a spinner;
 *  - a provider failure is an `error` event with product copy, never a hang
 *    and never the vendor's text;
 *  - the fixture path streams send → message_delta… → done keyless, through
 *    the real SSE encoder;
 *  - under PROVIDERS=live the turn uses the provider getProviders() selected
 *    (the Grok backend), not the fixture synth;
 *  - chat reads carry their own rate-limit bucket, separate from `general`.
 */

// Hoisted: the logger (imported transitively by server/chat/turn) reads
// getConfig() at module load, before a plain top-level const would exist.
const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn<() => AppConfig | undefined>(),
}));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { getConfig: () => AppConfig }>();
  // Until a test stubs it, fall through to the real (env-derived) config.
  return { ...actual, getConfig: () => getConfigMock() ?? actual.getConfig() };
});

const threadId = chatThreadIdSchema.parse(FIXTURE_IDS.chatThread);
const assistantMessageId = chatMessageIdSchema.parse("00000000-0000-4000-8000-0000000000d1");

type Deps = ReturnType<typeof makeStageDeps>;
let deps: Deps;
let chatStore: InMemoryChatStore;

function fixtureConfig(): AppConfig {
  return parseEnv({ NODE_ENV: "test" });
}

function liveGrokConfig(): AppConfig {
  return parseEnv({
    NODE_ENV: "test",
    PROVIDERS: "live",
    LLM_BACKEND: "grok",
    XAI_API_KEY: "xai-test-key",
    GOOGLE_API_KEY: "g",
    TRANSCRIPT_API_KEY: "t",
    SEARCH_API_KEY: "s",
    IMAGE_API_KEY: "i",
  });
}

/** An LlmProvider whose complete() is fully scripted. */
function scriptedLlm(complete: (req: LlmRequest) => Promise<LlmResponse>): LlmProvider {
  return {
    complete,
    stream: () => {
      throw new Error("not used");
    },
  };
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** Drain an SSE byte stream into parsed chat events (from `data:` lines). */
async function drainSse(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => chatStreamEventSchema.parse(JSON.parse(line.slice(5).trim())));
}

beforeEach(() => {
  getConfigMock.mockReturnValue(fixtureConfig());
  resetSharedWorkspaceStoreForTests();
  deps = makeStageDeps();
  setEngineDepsForTests(deps.engine);
  setStageDepsForTests(deps);
  setPartnerSourceForTests(deps.partners);
  chatStore = new InMemoryChatStore();
  setChatStoreForTests(chatStore);
});

afterEach(() => {
  resetSharedWorkspaceStoreForTests();
  setEngineDepsForTests(undefined);
  setStageDepsForTests(undefined);
  setPartnerSourceForTests(undefined);
  setChatStoreForTests(undefined);
  resetProvidersForTests();
  resetConfigForTests();
  vi.restoreAllMocks();
});

describe("withTurnDeadline", () => {
  it("rejects with ChatTurnTimeoutError when the work never settles", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTurnDeadline(never, 20)).rejects.toBeInstanceOf(ChatTurnTimeoutError);
  });

  it("passes the value through (and clears its timer) when the work wins", async () => {
    await expect(withTurnDeadline(Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
  });
});

describe("assistant turn hard deadline", () => {
  it("a stalled provider → one error event, stream closed within the deadline", async () => {
    await chatStore.appendMessage({
      threadId,
      workspaceId: fixtureCtx.workspaceId,
      role: "user",
      content: "Give me 5 hooks for a tech explainer about phone batteries",
    });
    // A provider that ignores its timeout entirely: never resolves, never aborts.
    const complete = vi.fn((_req: LlmRequest) => new Promise<LlmResponse>(() => {}));
    setStageDepsForTests({
      ...deps,
      engine: { ...deps.engine, mode: "live", llm: scriptedLlm(complete) },
    });

    const started = Date.now();
    const events = await drainSse(
      createChatSseStream(
        runAssistantTurn({
          workspaceId: fixtureCtx.workspaceId,
          threadId,
          projectId: null,
          assistantMessageId,
          deadlineMs: 100,
        }),
        { heartbeatMs: 10_000 },
      ),
    );
    const elapsed = Date.now() - started;

    expect(complete).toHaveBeenCalledTimes(1);
    // The provider was handed the same budget so a well-behaved client aborts too.
    expect(complete.mock.calls[0]?.[0]?.timeoutMs).toBe(100);
    expect(events).toEqual([{ type: "error", message: CHAT_TURN_TIMEOUT_MESSAGE }]);
    expect(elapsed).toBeLessThan(2_000);
    // Nothing persisted for the turn: the user can simply retry.
    const messages = await chatStore.listMessages(fixtureCtx.workspaceId, threadId);
    expect(messages.some((m) => m.id === assistantMessageId)).toBe(false);
  });

  it("the deadline defaults to CHAT_TURN_DEADLINE_MS from config", async () => {
    getConfigMock.mockReturnValue(parseEnv({ NODE_ENV: "test", CHAT_TURN_DEADLINE_MS: "50" }));
    expect(getConfig().CHAT_TURN_DEADLINE_MS).toBe(50);
    const complete = vi.fn((_req: LlmRequest) => new Promise<LlmResponse>(() => {}));
    setStageDepsForTests({
      ...deps,
      engine: { ...deps.engine, mode: "live", llm: scriptedLlm(complete) },
    });
    const events = await collect(
      runAssistantTurn({
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        projectId: null,
        assistantMessageId,
      }),
    );
    expect(events).toEqual([{ type: "error", message: CHAT_TURN_TIMEOUT_MESSAGE }]);
    expect(complete.mock.calls[0]?.[0]?.timeoutMs).toBe(50);
  });

  it("a provider failure → one product-copy error event (never the vendor's text)", async () => {
    const complete = vi.fn(() => Promise.reject(new Error("Grok API error: HTTP 500")));
    setStageDepsForTests({
      ...deps,
      engine: { ...deps.engine, mode: "live", llm: scriptedLlm(complete) },
    });
    const events = await collect(
      runAssistantTurn({
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        projectId: null,
        assistantMessageId,
        deadlineMs: 5_000,
      }),
    );
    expect(events).toEqual([{ type: "error", message: CHAT_TURN_FAILED_MESSAGE }]);
    expect(JSON.stringify(events)).not.toMatch(/grok|xai/i);
  });
});

describe("fixture-mode stream smoke (zero keys)", () => {
  it("send → SSE message_delta… → done, end to end through the encoder", async () => {
    const ack = await chatImpl.sendMessage({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        content: "Give me 5 hooks for a tech explainer about phone batteries",
      },
    });
    expect(ack.status).toBe("streaming");
    expect(ack.streamPath).toContain(`messageId=${ack.assistantMessageId}`);

    const events = await drainSse(
      createChatSseStream(
        runAssistantTurn({
          workspaceId: fixtureCtx.workspaceId,
          threadId,
          projectId: null,
          assistantMessageId: ack.assistantMessageId,
        }),
        { heartbeatMs: 10_000 },
      ),
    );
    const deltas = events.filter((e) => e.type === "message_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);

    // The reply persisted at the ack id equals the streamed text.
    const messages = await chatStore.listMessages(fixtureCtx.workspaceId, threadId);
    const assistant = messages.find((m) => m.id === ack.assistantMessageId);
    expect(assistant?.role).toBe("assistant");
    const streamed = events.map((e) => (e.type === "message_delta" ? e.text : "")).join("");
    expect(streamed).toBe(assistant?.content);
  });
});

describe("live provider selection (PROVIDERS=live, LLM_BACKEND=grok)", () => {
  it("getProviders() selects the Grok backend and engine deps report mode=live", async () => {
    getConfigMock.mockReturnValue(liveGrokConfig());
    resetProvidersForTests();
    setEngineDepsForTests(undefined);
    const providers = await getProviders();
    expect(providers.llm).toBeInstanceOf(GrokLlm);
    const engine = await getEngineDeps();
    expect(engine.mode).toBe("live");
    expect(engine.llm).toBe(providers.llm);
  });

  it("the turn calls the live provider — the fixture synth is NOT used", async () => {
    getConfigMock.mockReturnValue(liveGrokConfig());
    const complete = vi.fn((req: LlmRequest) =>
      Promise.resolve<LlmResponse>({
        text: `LIVE REPLY to: ${req.prompt.split("\n").at(-1) ?? ""}`,
        inputTokens: 10,
        outputTokens: 5,
        stopReason: "end_turn",
      }),
    );
    setStageDepsForTests({
      ...deps,
      engine: { ...deps.engine, mode: "live", llm: scriptedLlm(complete) },
    });
    await chatStore.appendMessage({
      threadId,
      workspaceId: fixtureCtx.workspaceId,
      role: "user",
      content: "Give me 5 hooks",
    });

    const events = await collect(
      runAssistantTurn({
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        projectId: null,
        assistantMessageId,
        deadlineMs: 5_000,
      }),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    const req = complete.mock.calls[0]?.[0];
    expect(req?.model).toBe(LLM_MODELS.sonnet);
    expect(req?.system).toContain("Coach");
    expect(req?.prompt).toContain("Creator: Give me 5 hooks");
    const text = events.map((e) => (e.type === "message_delta" ? e.text : "")).join("");
    expect(text).toBe("LIVE REPLY to: Creator: Give me 5 hooks");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("GrokLlm logs a failed provider response with status + truncated body, never the key", async () => {
    getConfigMock.mockReturnValue(liveGrokConfig());
    const { logger } = await import("@/lib/logger");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(2_000), { status: 429, statusText: "Too Many Requests" }),
    );
    await expect(
      new GrokLlm().complete({ model: LLM_MODELS.sonnet, prompt: "hi", maxTokens: 10 }),
    ).rejects.toThrow("Grok API error: HTTP 429");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [fields] = errorSpy.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ provider: "llm", kind: "complete", status: 429 });
    const body = (fields as { body: string }).body;
    expect(body).toHaveLength(500);
    expect(JSON.stringify(fields)).not.toContain("xai-test-key");
  });
});

describe("rate-limit policies", () => {
  it("chat reads have their own bucket, larger than general", () => {
    expect(RATE_LIMIT_POLICIES.chatRead.id).not.toBe(RATE_LIMIT_POLICIES.general.id);
    expect(RATE_LIMIT_POLICIES.chatRead.limit).toBeGreaterThan(RATE_LIMIT_POLICIES.general.limit);
    expect(RATE_LIMIT_POLICIES.chatRead.windowMs).toBe(60_000);
  });

  it("listThreads/getThread use chatRead; sendMessage stays on general (contracts source)", () => {
    const src = readFileSync(join(__dirname, "..", "server", "routers", "_contracts.ts"), "utf8");
    const chatRouter = src.slice(
      src.indexOf("export const chatRouter"),
      src.indexOf("export const ideasRouter"),
    );
    const policyOf = (proc: string): string | undefined =>
      new RegExp(`${proc}: workspaceProcedure\\("chat", "\\w+"\\)\\s*\\.use\\((\\w+)\\)`).exec(
        chatRouter,
      )?.[1];
    expect(policyOf("listThreads")).toBe("chatRead");
    expect(policyOf("getThread")).toBe("chatRead");
    expect(policyOf("sendMessage")).toBe("general");
    expect(policyOf("confirmTool")).toBe("general");
  });
});
