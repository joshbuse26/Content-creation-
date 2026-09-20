import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { ImageProvider, ImageRequest } from "@/lib/providers/types";
import { projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { fixturePackagingContext } from "@/pipelines/packaging";
import {
  buildBoardConceptPrompt,
  conceptInputHash,
  parseReferenceImage,
  REFERENCE_STRENGTH,
  resetThumbnailMemoryForTests,
  runConceptTweak,
  runThumbnailBoard,
  type ThumbnailPipelineDeps,
} from "@/pipelines/thumbnails";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { MemoryObjectStorage } from "@/server/storage";
import { LiveImage } from "@/lib/providers/live/image";
import { resetConfigForTests } from "@/lib/config";

/**
 * Wave I — Thumbnail Studio reference images + brief.
 *  - the brief and a reference land in the prompt; a new reference is new work
 *    (different input hash) so idempotency never re-serves the wrong image;
 *  - the reference is stored content-addressed and handed to the provider as
 *    image-to-image; a tweak with no new reference re-reads the stored one;
 *  - the live provider switches endpoints and payload when a reference is set;
 *  - the Wave H download path (URL-only provider) still works with a reference.
 */

const WS = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const PROJECT = projectIdSchema.parse(FIXTURE_IDS.project);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const REF = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const OTHER_REF = `data:image/jpeg;base64,${Buffer.from([1, 2, 3, 4]).toString("base64")}`;
const generic = { generationMode: null, archetypeId: null, crossover: null };

/** URL-only provider (live-shaped) that records every request it gets. */
function recordingProvider(): { provider: ImageProvider; requests: ImageRequest[] } {
  const requests: ImageRequest[] = [];
  return {
    requests,
    provider: {
      generate: (req) => {
        requests.push(req);
        return Promise.resolve(
          Array.from({ length: req.count }, (_, i) => ({
            url: `https://img.example.com/${String(requests.length)}-${String(i)}.png`,
            base64Png: null,
          })),
        );
      },
    },
  };
}

function depsWith(overrides: Partial<ThumbnailPipelineDeps>): ThumbnailPipelineDeps {
  return {
    runs: new InMemoryPipelineRunStore(),
    image: recordingProvider().provider,
    storage: new MemoryObjectStorage(),
    recordCredits: () => Promise.resolve(),
    loadContext: () => Promise.resolve(fixturePackagingContext()),
    fetchBytes: () => Promise.resolve(PNG),
    ...overrides,
  };
}

beforeEach(() => {
  resetThumbnailMemoryForTests();
});

describe("prompt + hash", () => {
  const base = {
    compositionPattern: "big-text",
    overlayText: null,
    presetId: null,
    subjectMode: null,
    colorMood: null,
    brief: null,
    referenceHash: null,
  };

  it("folds the brief and the reference into the prompt and flips the likeness rule", () => {
    const plain = buildBoardConceptPrompt(fixturePackagingContext(), base, null);
    expect(plain).toContain("No real people's likenesses");
    expect(plain).not.toContain("Creator's brief");

    const guided = buildBoardConceptPrompt(
      fixturePackagingContext(),
      { ...base, brief: "45 sec educational video, photo of him", referenceHash: "abc" },
      null,
    );
    expect(guided).toContain("Creator's brief: 45 sec educational video, photo of him");
    expect(guided).toContain("A reference image is provided");
    expect(guided).toContain("No real people other than the one in the reference image");
  });

  it("a different brief or reference is different work", () => {
    const a = conceptInputHash(WS, PROJECT, base);
    const b = conceptInputHash(WS, PROJECT, { ...base, brief: "x" });
    const c = conceptInputHash(WS, PROJECT, { ...base, referenceHash: "h1" });
    const d = conceptInputHash(WS, PROJECT, { ...base, referenceHash: "h2" });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("parseReferenceImage rejects non-image and empty payloads", () => {
    expect(() => parseReferenceImage("data:text/plain;base64,aGk=")).toThrow(/PNG, JPEG or WebP/);
    expect(() => parseReferenceImage("data:image/png;base64,")).toThrow();
    expect(parseReferenceImage(REF).contentType).toBe("image/png");
  });
});

describe("board with a reference", () => {
  it("stores the reference once, sends it to the provider for every concept, and persists N real images", async () => {
    const { provider, requests } = recordingProvider();
    const storage = new MemoryObjectStorage();
    const deps = depsWith({ image: provider, storage });
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: generic,
      actorUserId: null,
      brief: "photo of him",
      referenceImage: REF,
    });
    expect(board.concepts).toHaveLength(3);
    expect(requests).toHaveLength(3);
    for (const req of requests) {
      expect(req.reference).toEqual({ dataUrl: REF, strength: REFERENCE_STRENGTH });
      expect(req.prompt).toContain("Creator's brief: photo of him");
    }
    const refKeys = new Set(board.concepts.map((c) => c.referenceImageKey));
    expect(refKeys.size).toBe(1);
    const [refKey] = refKeys;
    expect(refKey).toMatch(/\/refs\/[0-9a-f]+\.png$/);
    expect((await storage.get(refKey ?? ""))?.contentType).toBe("image/png");
    expect(board.concepts.every((c) => c.brief === "photo of him")).toBe(true);
    // The generated images themselves were downloaded and stored (Wave H path).
    for (const c of board.concepts) {
      expect((await storage.get(c.imageKey ?? ""))?.data.byteLength).toBe(PNG.byteLength);
    }
  });

  it("a tweak with no new reference re-reads the stored one; null drops it; a new one replaces it", async () => {
    const { provider, requests } = recordingProvider();
    const storage = new MemoryObjectStorage();
    const deps = depsWith({ image: provider, storage });
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: generic,
      actorUserId: null,
      referenceImage: REF,
    });
    const target = board.concepts[0];
    if (target === undefined) throw new Error("no concept");
    requests.length = 0;

    const kept = await runConceptTweak(deps, {
      workspaceId: WS,
      concept: target,
      actorUserId: null,
      overlayText: "new overlay",
    });
    expect(requests[0]?.reference?.dataUrl).toBe(REF);
    expect(kept?.referenceImageKey).toBe(target.referenceImageKey);

    const dropped = await runConceptTweak(deps, {
      workspaceId: WS,
      concept: kept ?? target,
      actorUserId: null,
      referenceImage: null,
    });
    expect(requests[1]?.reference).toBeUndefined();
    expect(dropped?.referenceImageKey).toBeNull();

    const replaced = await runConceptTweak(deps, {
      workspaceId: WS,
      concept: dropped ?? target,
      actorUserId: null,
      referenceImage: OTHER_REF,
    });
    expect(requests[2]?.reference?.dataUrl).toBe(OTHER_REF);
    expect(replaced?.referenceImageKey).toMatch(/\.jpg$/);
  });
});

describe("LiveImage endpoint selection", () => {
  const original = process.env.IMAGE_API_KEY;
  beforeEach(() => {
    process.env.IMAGE_API_KEY = "test-key";
    resetConfigForTests();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.IMAGE_API_KEY;
    else process.env.IMAGE_API_KEY = original;
    resetConfigForTests();
    vi.unstubAllGlobals();
  });

  it("text-to-image without a reference; image-to-image with one (image_url + strength, no image_size)", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        if (typeof url !== "string" || typeof init?.body !== "string") {
          throw new Error("LiveImage is expected to call fetch(stringUrl, { body: string })");
        }
        calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
        return Promise.resolve(
          new Response(JSON.stringify({ images: [{ url: "https://x/1.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
    const live = new LiveImage();
    await live.generate({ prompt: "p", width: 1280, height: 720, count: 1 });
    await live.generate({
      prompt: "p",
      width: 1280,
      height: 720,
      count: 1,
      reference: { dataUrl: REF, strength: 0.7 },
    });
    expect(calls[0]?.url).toBe("https://fal.run/fal-ai/flux/dev");
    expect(calls[0]?.body).toEqual({
      prompt: "p",
      image_size: { width: 1280, height: 720 },
      num_images: 1,
    });
    expect(calls[1]?.url).toBe("https://fal.run/fal-ai/flux/dev/image-to-image");
    expect(calls[1]?.body).toEqual({ prompt: "p", image_url: REF, strength: 0.7, num_images: 1 });
  });
});
