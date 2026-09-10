import { afterEach, describe, expect, it, vi } from "vitest";
import { GrokLlm } from "@/lib/providers/live/grok";
import { LLM_MODELS, parseEnv, type AppConfig } from "@/lib/config";

const getConfigMock = vi.fn<() => AppConfig>();
vi.mock("@/lib/config", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getConfig: () => getConfigMock() };
});

const baseEnv = {
  XAI_API_KEY: "xai-test-key",
  XAI_MODEL_MAIN: "grok-4.6",
  XAI_MODEL_FAST: "grok-4.1-fast",
};

function stubConfig(): void {
  getConfigMock.mockReturnValue(parseEnv(baseEnv));
}

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GrokLlm.complete", () => {
  it("maps the request to OpenAI-compatible shape and translates tier models", async () => {
    stubConfig();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
        { status: 200 },
      ),
    );

    const res = await new GrokLlm().complete({
      model: LLM_MODELS.sonnet,
      system: "be brief",
      prompt: "say hello",
      maxTokens: 100,
      temperature: 0.4,
    });

    expect(res).toEqual({
      text: "hello",
      inputTokens: 12,
      outputTokens: 3,
      stopReason: "end_turn",
    });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.x.ai/v1/chat/completions");
    const init = call?.[1];
    const body = JSON.parse(init?.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
      max_tokens: number;
      temperature: number;
    };
    expect(body.model).toBe("grok-4.6");
    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "say hello" },
    ]);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.4);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer xai-test-key");
  });

  it("routes the fast tier to XAI_MODEL_FAST and maps length finishes", async () => {
    stubConfig();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "t" }, finish_reason: "length" }],
          usage: {},
        }),
        { status: 200 },
      ),
    );
    const res = await new GrokLlm().complete({
      model: LLM_MODELS.haiku,
      prompt: "classify",
      maxTokens: 10,
    });
    expect(res.stopReason).toBe("max_tokens");
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body as string) as {
      model: string;
    };
    expect(body.model).toBe("grok-4.1-fast");
  });

  it("throws a clean error on non-2xx", async () => {
    stubConfig();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 429 }));
    await expect(
      new GrokLlm().complete({ model: LLM_MODELS.sonnet, prompt: "x", maxTokens: 5 }),
    ).rejects.toThrow("Grok API error: HTTP 429");
  });

  it("refuses to run without XAI_API_KEY", async () => {
    getConfigMock.mockReturnValue(parseEnv({}));
    await expect(
      new GrokLlm().complete({ model: LLM_MODELS.sonnet, prompt: "x", maxTokens: 5 }),
    ).rejects.toThrow("XAI_API_KEY");
  });
});

describe("GrokLlm.stream", () => {
  it("yields deltas across split SSE frames and stops at [DONE]", async () => {
    stubConfig();
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\ndata: {"choices":[{"del',
      'ta":{"content":"world"}}]}\n',
      "data: [DONE]\n",
      'data: {"choices":[{"delta":{"content":"never"}}]}\n',
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sseBody(frames), { status: 200 }));

    const chunks: string[] = [];
    for await (const delta of new GrokLlm().stream({
      model: LLM_MODELS.sonnet,
      prompt: "stream it",
      maxTokens: 50,
    })) {
      chunks.push(delta);
    }
    expect(chunks.join("")).toBe("Hello world");
  });
});

describe("config: LLM_BACKEND", () => {
  it("live + grok requires XAI_API_KEY instead of ANTHROPIC_API_KEY", () => {
    const grokLive = {
      PROVIDERS: "live",
      LLM_BACKEND: "grok",
      GOOGLE_API_KEY: "g",
      TRANSCRIPT_API_KEY: "t",
      SEARCH_API_KEY: "s",
      IMAGE_API_KEY: "i",
    };
    expect(() => parseEnv(grokLive)).toThrow(/XAI_API_KEY/);
    expect(() => parseEnv(grokLive)).not.toThrow(/ANTHROPIC_API_KEY/);
    expect(parseEnv({ ...grokLive, XAI_API_KEY: "xai" }).LLM_BACKEND).toBe("grok");
  });

  it("defaults to anthropic with default Grok tier models", () => {
    const cfg = parseEnv({});
    expect(cfg.LLM_BACKEND).toBe("anthropic");
    expect(cfg.XAI_MODEL_MAIN).toBe("grok-4.6");
    expect(cfg.XAI_MODEL_FAST).toBe("grok-4.1-fast");
  });
});
