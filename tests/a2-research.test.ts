import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { fixtureProject, fixtureWorkspace } from "@/lib/fixtures";
import { runResearchPipeline } from "@/pipelines/research/pipeline";
import {
  assertPublicUrl,
  guardedFetch,
  htmlToText,
  isPrivateIp,
  SsrfBlockedError,
  type DnsLookupFn,
} from "@/pipelines/research/ssrf";
import { importTranscript, parseYoutubeVideoId, TranscriptImportError } from "@/pipelines/research/transcript";
import { saveUpload, UploadCapError } from "@/pipelines/research/upload";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { researchImpl } from "@/server/routers/impl/research";
import { fixtureCtx, makeDeps } from "./a2-helpers";

const publicLookup: DnsLookupFn = () => Promise.resolve([{ address: "93.184.216.34" }]);
const privateLookup: DnsLookupFn = () => Promise.resolve([{ address: "10.1.2.3" }]);

describe("SSRF guard", () => {
  it.each([
    ["10.0.0.1", true],
    ["127.0.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["::1", true],
    ["fc00::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["93.184.216.34", false],
    ["8.8.8.8", false],
    ["2606:2800:220:1:248:1893:25c8:1946", false],
  ])("classifies %s private=%s", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });

  it("blocks non-http protocols, localhost names, and private-resolving hosts", async () => {
    await expect(assertPublicUrl("ftp://example.com/x", publicLookup)).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertPublicUrl("http://localhost:3000/", publicLookup)).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertPublicUrl("http://10.0.0.5/admin", publicLookup)).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertPublicUrl("https://internal.example.com/", privateLookup)).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(
      assertPublicUrl("https://example.com/page", publicLookup),
    ).resolves.toBeInstanceOf(URL);
  });

  it("re-checks redirect hops and blocks a redirect into private space", async () => {
    const fetchImpl: typeof fetch = (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://example.com/")) {
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: "http://169.254.169.254/meta" } }),
        );
      }
      return Promise.resolve(new Response("should never get here", { status: 200 }));
    };
    await expect(
      guardedFetch("https://example.com/start", { lookup: publicLookup, fetchImpl }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("caps the response at maxBytes", async () => {
    const big = "a".repeat(10_000);
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(big, { status: 200 }));
    const page = await guardedFetch("https://example.com/big", {
      lookup: publicLookup,
      fetchImpl,
      maxBytes: 1_000,
    });
    expect(page.body.length).toBeLessThanOrEqual(1_000);
  });

  it("strips HTML to text", () => {
    const { title, text } = htmlToText(
      "<html><head><title>The Page</title><script>evil()</script></head><body><h1>Hi</h1><p>First para.</p><p>Second &amp; last.</p></body></html>",
    );
    expect(title).toBe("The Page");
    expect(text).toContain("First para.");
    expect(text).toContain("Second & last.");
    expect(text).not.toContain("evil");
  });
});

describe("research pipeline (fixture mode)", () => {
  it("plans, fetches, compiles a cited brief, persists it, charges 1 credit", async () => {
    const deps = makeDeps();
    const before = (await deps.store.listResearchDocs(fixtureCtx.workspaceId, fixtureProject.id))
      .length;
    const result = await runResearchPipeline(deps, {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        query: "budget espresso machines under $300",
      },
      actorUserId: fixtureCtx.userId,
    });
    expect(result.status).toBe("done");
    const docs = await deps.store.listResearchDocs(fixtureCtx.workspaceId, fixtureProject.id);
    expect(docs).toHaveLength(before + 1);
    const brief = docs.at(-1);
    expect(brief?.kind).toBe("web");
    expect(brief?.content).toContain("(source: http");
    expect(brief?.wordCount).toBeGreaterThan(20);
    expect(deps.store.creditEntries).toEqual([
      expect.objectContaining({ delta: -1, reason: "research_run" }),
    ]);
  });
});

describe("transcript import", () => {
  it("parses the URL shapes users paste", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYoutubeVideoId("not a url")).toBeNull();
  });

  it("saves a transcript research doc via the provider", async () => {
    const deps = makeDeps();
    const doc = await importTranscript(deps, {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      youtubeVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(doc.kind).toBe("transcript");
    expect(doc.content).toMatch(/^\[0:00\]/);
    expect(doc.wordCount).toBeGreaterThan(10);
  });

  it("rejects an unparseable URL", async () => {
    const deps = makeDeps();
    await expect(
      importTranscript(deps, {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        youtubeVideoUrl: "https://example.com/video/123",
      }),
    ).rejects.toThrow(TranscriptImportError);
  });
});

describe("upload word caps by plan", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("free tier caps at 5k words; paid at 25k", async () => {
    const deps = makeDeps();
    deps.store.setPlan(fixtureCtx.workspaceId, "free");
    await expect(
      saveUpload(deps, {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        filename: "notes.md",
        kind: "upload",
        content: words(5_001),
      }),
    ).rejects.toThrow(UploadCapError);

    deps.store.setPlan(fixtureCtx.workspaceId, fixtureWorkspace.plan); // starter
    const doc = await saveUpload(deps, {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      filename: "notes.md",
      kind: "upload",
      content: words(6_000),
    });
    expect(doc.wordCount).toBe(6_000);
  });
});

describe("research impl handlers", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
    setEngineDepsForTests(deps);
  });
  afterEach(() => {
    setEngineDepsForTests(undefined);
  });

  it("search kicks off the pipeline inline (no Redis) and lists the new doc", async () => {
    const accepted = await researchImpl.search({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        query: "grinder burr geometry",
      },
    });
    expect(accepted.status).toBe("queued");
    const listed = await researchImpl.list({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, projectId: fixtureProject.id },
    });
    expect(listed.length).toBeGreaterThanOrEqual(2);
    // list omits content per contract
    expect(Object.keys(listed[0] ?? {})).not.toContain("content");
  });

  it("upload cap surfaces as BAD_REQUEST", async () => {
    deps.store.setPlan(fixtureCtx.workspaceId, "free");
    await expect(
      researchImpl.upload({
        ctx: fixtureCtx,
        input: {
          workspaceId: fixtureCtx.workspaceId,
          projectId: fixtureProject.id,
          filename: "big.txt",
          kind: "upload",
          content: Array.from({ length: 5_100 }, (_, i) => `w${i}`).join(" "),
        },
      }),
    ).rejects.toThrow(TRPCError);
  });
});
