import { afterEach, describe, expect, it } from "vitest";
import { LLM_MODELS } from "@/lib/config";
import { createFixtureProviders } from "@/lib/providers/fixture";
import type { LlmProvider, LlmRequest } from "@/lib/providers/types";
import { MemorySlidingWindowStore, RateLimiter, setRateLimiterForTests } from "@/server/ratelimit";
import {
  analyzeHook,
  FREE_TOOL_MAX_TOKENS,
  freeToolRequestSchema,
  runFreeTool,
} from "@/server/tools";
import { isPlausibleEmail, shouldGate, FREE_USES_BEFORE_GATE } from "@/components/tools/gate";
import { POST } from "@/app/api/tools/route";

const fixtureLlm = createFixtureProviders().llm;

function capturingLlm(): { llm: LlmProvider; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = {
    complete: (req) => {
      requests.push(req);
      return Promise.resolve({
        text: "generic reply",
        inputTokens: 10,
        outputTokens: 10,
        stopReason: "end_turn" as const,
      });
    },
    stream: () => {
      let done = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: (): Promise<IteratorResult<string>> => {
              if (done) return Promise.resolve({ done: true, value: undefined });
              done = true;
              return Promise.resolve({ done: false, value: "generic reply" });
            },
          };
        },
      };
    },
  };
  return { llm, requests };
}

afterEach(() => {
  setRateLimiterForTests(undefined);
});

describe("fast-tier enforcement", () => {
  it("every free tool calls the haiku tier with a tight token budget", async () => {
    const { llm, requests } = capturingLlm();
    await runFreeTool(llm, { tool: "title-generator", topic: "budget espresso" });
    await runFreeTool(llm, { tool: "tag-generator", topic: "budget espresso" });
    await runFreeTool(llm, {
      tool: "description-generator",
      summary: "I compare three budget grinders and pick a winner.",
    });
    await runFreeTool(llm, {
      tool: "hook-analyzer",
      hook: "Everyone says you need a $500 grinder. I proved that wrong.",
    });
    expect(requests).toHaveLength(4);
    for (const req of requests) {
      expect(req.model).toBe(LLM_MODELS.haiku);
      expect(req.maxTokens).toBeLessThanOrEqual(FREE_TOOL_MAX_TOKENS);
    }
  });
});

describe("free tools produce useful output in fixture mode (prose LLM)", () => {
  it("titles: 10 options grounded in the topic", async () => {
    const res = await runFreeTool(fixtureLlm, {
      tool: "title-generator",
      topic: "sourdough starters",
    });
    expect(res.items).not.toBeNull();
    expect(res.items).toHaveLength(10);
    expect(res.items?.some((t) => t.toLowerCase().includes("sourdough starters"))).toBe(true);
    expect(res.text).toBeNull();
  });

  it("tags: 15-20 lowercase tags without hashtags", async () => {
    const res = await runFreeTool(fixtureLlm, {
      tool: "tag-generator",
      topic: "Budget Espresso Setup",
    });
    expect(res.items).not.toBeNull();
    expect(res.items?.length).toBeGreaterThanOrEqual(15);
    expect(res.items?.length).toBeLessThanOrEqual(20);
    for (const tag of res.items ?? []) {
      expect(tag).toBe(tag.toLowerCase());
      expect(tag.startsWith("#")).toBe(false);
      expect(tag.length).toBeLessThanOrEqual(60);
    }
  });

  it("description: structured text with an overview and subscribe line", async () => {
    const res = await runFreeTool(fixtureLlm, {
      tool: "description-generator",
      summary:
        "I compare three budget espresso grinders. Consistency matters most. Workflow is a close second. Taste testing settles it.",
    });
    expect(res.text).not.toBeNull();
    expect((res.text ?? "").length).toBeGreaterThan(80);
  });

  it("hook analyzer: score, style, signals and suggestions", async () => {
    const res = await runFreeTool(fixtureLlm, {
      tool: "hook-analyzer",
      hook: "Everyone says you need a $500 grinder for espresso. I spent 30 days proving that wrong — and the truth surprised me.",
    });
    expect(res.text).toContain("Score: ");
    expect(res.text).toContain("Style: ");
    expect(res.text).toContain("Try next:");
  });
});

describe("analyzeHook heuristics (pure)", () => {
  it("rewards short, viewer-addressed, specific curiosity hooks", () => {
    const strong = analyzeHook(
      "You are wasting money on espresso gear. I tested 12 grinders for 30 days and the truth surprised me.",
    );
    const weak = analyzeHook(
      "In this video we will be going over some general information about various pieces of equipment and eventually getting to a few thoughts near the end of the discussion after some background context and history and a long preamble about my personal journey with coffee over many years of gradual experimentation and upgrades and side quests. ".repeat(
        2,
      ),
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.estSeconds).toBeLessThanOrEqual(30);
    expect(weak.estSeconds).toBeGreaterThan(30);
  });

  it("detects styles deterministically", () => {
    expect(analyzeHook("What if everything you know about sleep is wrong?").style).toBe(
      "open_loop",
    );
    expect(analyzeHook("You will lose money if you skip this warning about brokers.").style).toBe(
      "stakes",
    );
    expect(analyzeHook("I benchmarked 12 laptops in 7 days flat.").style).toBe("bold_claim");
  });
});

describe("POST /api/tools (route handler)", () => {
  function request(body: unknown, ip = "203.0.113.7"): Request {
    return new Request("http://localhost/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  it("valid request returns a result with no auth", async () => {
    setRateLimiterForTests(new RateLimiter(new MemorySlidingWindowStore()));
    const res = await POST(request({ tool: "title-generator", topic: "budget espresso" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: string[] | null };
    expect(data.items).toHaveLength(10);
  });

  it("enforces the freeTools IP limit: 5/day then 429 with headers", async () => {
    setRateLimiterForTests(new RateLimiter(new MemorySlidingWindowStore()));
    const ip = "198.51.100.42";
    for (let i = 0; i < 5; i++) {
      const ok = await POST(request({ tool: "tag-generator", topic: "meal prep" }, ip));
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(request({ tool: "tag-generator", topic: "meal prep" }, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();

    // A different IP has its own bucket.
    const other = await POST(request({ tool: "tag-generator", topic: "meal prep" }, "192.0.2.1"));
    expect(other.status).toBe(200);
  });

  it("rejects malformed and unknown-tool bodies with a generic 400", async () => {
    setRateLimiterForTests(new RateLimiter(new MemorySlidingWindowStore()));
    const bad = await POST(request({ tool: "seo-audit", url: "https://example.com" }));
    expect(bad.status).toBe(400);
    const noJson = await POST(
      new Request("http://localhost/api/tools", { method: "POST", body: "not json" }),
    );
    expect(noJson.status).toBe(400);
    const tooShort = await POST(request({ tool: "title-generator", topic: "x" }));
    expect(tooShort.status).toBe(400);
  });

  it("input schema caps lengths (no unbounded prompt stuffing)", () => {
    const parsed = freeToolRequestSchema.safeParse({
      tool: "hook-analyzer",
      hook: "y".repeat(2000),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("email gate counter logic", () => {
  it("gates exactly from the 3rd use, unless unlocked", () => {
    expect(FREE_USES_BEFORE_GATE).toBe(2);
    expect(shouldGate(0, false)).toBe(false);
    expect(shouldGate(1, false)).toBe(false);
    expect(shouldGate(2, false)).toBe(true); // 3rd use
    expect(shouldGate(9, false)).toBe(true);
    expect(shouldGate(2, true)).toBe(false);
  });

  it("email plausibility check", () => {
    expect(isPlausibleEmail("creator@example.com")).toBe(true);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("  padded@example.org  ")).toBe(true);
  });
});
