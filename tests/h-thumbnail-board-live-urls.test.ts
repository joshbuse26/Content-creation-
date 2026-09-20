import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { ImageProvider } from "@/lib/providers/types";
import { projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { fixturePackagingContext } from "@/pipelines/packaging";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import type * as thumbnails from "@/pipelines/thumbnails";
import {
  insertThumbnailConcepts,
  listBoardConcepts,
  resetThumbnailMemoryForTests,
  runConceptTweak,
  runThumbnailBoard,
  ThumbnailImageError,
  type ThumbnailPipelineDeps,
} from "@/pipelines/thumbnails";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { MemoryObjectStorage } from "@/server/storage";
import { fixtureCtx, makeDeps } from "./a2-helpers";

type ThumbnailsModule = typeof thumbnails;

/**
 * Prod bug (2026-09-19): the live image provider (fal.ai) returns hosted
 * URLs only; the board/tweak path had no default download and silently
 * returned an EMPTY board with a success toast. These pin the fix:
 *
 *  - a URL-only provider is downloaded and persisted for every concept —
 *    with an explicit fetchBytes AND with none (the default downloader),
 *    which is exactly how the router builds deps;
 *  - a provider/download failure REJECTS (never an empty success), and the
 *    router surfaces it as BAD_GATEWAY with the reason;
 *  - a failing tweak rejects too.
 */

const WS = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const PROJECT = projectIdSchema.parse(FIXTURE_IDS.project);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** A live-shaped provider: hosted URLs, no inline data. */
function urlOnlyProvider(): ImageProvider {
  return {
    generate: (req) =>
      Promise.resolve(
        Array.from({ length: req.count }, (_, i) => ({
          url: `https://img.example.com/${encodeURIComponent(req.prompt.slice(0, 12))}-${String(i)}.png`,
          base64Png: null,
        })),
      ),
  };
}

function depsWith(overrides: Partial<ThumbnailPipelineDeps>): ThumbnailPipelineDeps {
  return {
    runs: new InMemoryPipelineRunStore(),
    image: urlOnlyProvider(),
    storage: new MemoryObjectStorage(),
    recordCredits: () => Promise.resolve(),
    loadContext: () => Promise.resolve(fixturePackagingContext()),
    ...overrides,
  };
}

const genericProject = { generationMode: null, archetypeId: null, crossover: null };

beforeEach(() => {
  resetThumbnailMemoryForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setEngineDepsForTests(undefined);
});

describe("board with a URL-only image provider", () => {
  it("downloads every hosted image via the injected fetchBytes and persists N concepts", async () => {
    const fetched: string[] = [];
    const storage = new MemoryObjectStorage();
    const deps = depsWith({
      storage,
      fetchBytes: (url) => {
        fetched.push(url);
        return Promise.resolve(PNG_BYTES);
      },
    });
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 4,
      project: genericProject,
      actorUserId: null,
    });
    expect(board.concepts).toHaveLength(4);
    expect(fetched).toHaveLength(4);
    for (const c of board.concepts) {
      const stored = await storage.get(c.imageKey ?? "");
      expect(stored?.data.byteLength).toBe(PNG_BYTES.byteLength);
    }
  });

  it("with NO fetchBytes in deps (the router's shape) the default downloader is used", async () => {
    const fetchSpy = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const storage = new MemoryObjectStorage();
    const deps = depsWith({ storage }); // deliberately no fetchBytes
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    expect(board.concepts).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toMatch(/^https:\/\/img\.example\.com\//);
    }
    for (const c of board.concepts) {
      expect((await storage.get(c.imageKey ?? ""))?.contentType).toBe("image/png");
    }
  });
});

describe("board / tweak failures are loud", () => {
  const failing: ImageProvider = {
    generate: () => Promise.reject(new Error("Image API failed with status 401")),
  };

  it("a board that produces no images rejects with the provider's reason and inserts nothing", async () => {
    const deps = depsWith({ image: failing });
    await expect(
      runThumbnailBoard(deps, {
        workspaceId: WS,
        projectId: PROJECT,
        count: 3,
        project: genericProject,
        actorUserId: null,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof ThumbnailImageError && err.message.includes("status 401"),
    );
    expect(await listBoardConcepts(WS, PROJECT, "any")).toHaveLength(0);
  }, 20_000);

  it("a download failure (fetchBytes throws) rejects the same way", async () => {
    const deps = depsWith({
      fetchBytes: () => Promise.reject(new Error("image download failed with status 500")),
    });
    await expect(
      runThumbnailBoard(deps, {
        workspaceId: WS,
        projectId: PROJECT,
        count: 3,
        project: genericProject,
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(ThumbnailImageError);
  }, 20_000);

  it("a failing tweak rejects instead of returning null", async () => {
    const [row] = await insertThumbnailConcepts([
      {
        workspaceId: FIXTURE_IDS.workspace,
        projectId: FIXTURE_IDS.project,
        promptUsed: "p",
        compositionPattern: "big-text",
        imageKey: "thumbnails/x.png",
      },
    ]);
    if (row === undefined) throw new Error("insert failed");
    const deps = depsWith({ image: failing });
    await expect(
      runConceptTweak(deps, {
        workspaceId: WS,
        concept: row,
        actorUserId: null,
        overlayText: "new",
      }),
    ).rejects.toBeInstanceOf(ThumbnailImageError);
  }, 20_000);
});

describe("router mapping", () => {
  it("generateBoard surfaces an image failure as BAD_GATEWAY with the reason", async () => {
    vi.doMock("@/pipelines/thumbnails", async (importOriginal) => {
      const mod = await importOriginal<ThumbnailsModule>();
      return {
        ...mod,
        getThumbnailPipelineDeps: () =>
          Promise.resolve(
            depsWith({
              image: {
                generate: () => Promise.reject(new Error("Image API failed with status 503")),
              },
            }),
          ),
      };
    });
    try {
      const { thumbnailsImpl } = await import("@/server/routers/impl/thumbnails");
      setEngineDepsForTests(makeDeps());
      await expect(
        thumbnailsImpl.generateBoard({
          ctx: fixtureCtx,
          input: {
            workspaceId: WS,
            projectId: PROJECT,
            count: 3,
            overlayText: null,
            preset: null,
            subject: null,
            mood: null,
            brief: null,
            referenceImage: null,
          },
        }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof TRPCError &&
          err.code === "BAD_GATEWAY" &&
          err.message.includes("status 503"),
      );
    } finally {
      vi.doUnmock("@/pipelines/thumbnails");
    }
  }, 20_000);
});
