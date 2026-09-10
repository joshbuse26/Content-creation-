import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { getProviders, resetProvidersForTests } from "@/lib/providers";
import { resetConfigForTests, LLM_MODELS } from "@/lib/config";

describe("fixture providers", () => {
  beforeEach(() => {
    resetConfigForTests();
    resetProvidersForTests();
  });

  it("getProviders returns the fixture set with zero keys (PROVIDERS default)", async () => {
    delete process.env.PROVIDERS;
    const providers = await getProviders();
    const res = await providers.search.search("espresso grinders", 3);
    expect(res).toHaveLength(3);
  });

  it("llm.complete is deterministic for the same input", async () => {
    const { llm } = createFixtureProviders();
    const req = { model: LLM_MODELS.sonnet, prompt: "Write a hook about grinders", maxTokens: 500 };
    const [a, b] = await Promise.all([llm.complete(req), llm.complete(req)]);
    expect(a.text).toBe(b.text);
    expect(a.text.length).toBeGreaterThan(50);
  });

  it("llm.stream chunks concatenate to the complete() text", async () => {
    const { llm } = createFixtureProviders();
    const req = { model: LLM_MODELS.haiku, prompt: "Tag this video format", maxTokens: 100 };
    const full = await llm.complete(req);
    let streamed = "";
    for await (const chunk of llm.stream(req)) {
      streamed += chunk;
    }
    expect(streamed).toBe(full.text);
  });

  it("youtube provider returns batched stats with realistic shapes", async () => {
    const { youtube } = createFixtureProviders();
    const channel = await youtube.getChannel("@deepdivecasey");
    expect(channel.uploadsPlaylistId).toMatch(/^UU/);
    const ids = await youtube.listRecentVideoIds(channel.uploadsPlaylistId, 10);
    expect(ids).toHaveLength(10);
    const stats = await youtube.getVideoStats(ids);
    expect(stats).toHaveLength(10);
    for (const s of stats) {
      expect(s.viewCount).toBeGreaterThan(0);
      expect(Date.parse(s.publishedAt)).not.toBeNaN();
    }
    // Deterministic: same ids -> same stats
    const again = await youtube.getVideoStats(ids);
    expect(again).toEqual(stats);
  });

  it("transcript provider returns segments and full text", async () => {
    const { transcript } = createFixtureProviders();
    const t = await transcript.getTranscript("abc123");
    expect(t.segments.length).toBeGreaterThan(0);
    expect(t.fullText).toContain(t.segments[0]?.text ?? "@@missing@@");
  });

  it("image provider returns the requested number of deterministic images", async () => {
    const { image } = createFixtureProviders();
    const images = await image.generate({
      prompt: "thumbnail",
      width: 1280,
      height: 720,
      count: 3,
    });
    expect(images).toHaveLength(3);
    expect(images[0]?.base64Png).toBeTruthy();
    expect(images[0]?.url).toBeNull();
  });
});
