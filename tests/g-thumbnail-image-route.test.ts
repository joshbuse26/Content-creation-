import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS } from "@/lib/fixtures";

// The route's session lookup is next-auth-backed, which vitest's node ESM
// resolver cannot load; the fixture user is what fixture mode would resolve.
vi.mock("@/server/session", () => ({
  getSessionWithFixtureFallback: () =>
    Promise.resolve({ user: { id: FIXTURE_IDS.user, email: "fixture@example.com" } }),
}));

import { GET } from "@/app/api/thumbnail-image/route";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { fixturePackagingContext } from "@/pipelines/packaging";
import {
  resetThumbnailMemoryForTests,
  runThumbnailBoard,
  type ThumbnailPipelineDeps,
} from "@/pipelines/thumbnails";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { getObjectStorage, setObjectStorageForTests } from "@/server/storage";

/**
 * Thumbnail Studio end to end, in ONE process: a board generated through the
 * pipeline is served back as a real PNG by /api/thumbnail-image. (On a bare
 * `next dev` the route and tRPC run in separate bundles with separate
 * in-memory stores, so the browser shows broken images there — this test is
 * the proof the production single-process path works.)
 */

const WS = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const PROJECT = projectIdSchema.parse(FIXTURE_IDS.project);

beforeEach(() => {
  resetThumbnailMemoryForTests();
  setObjectStorageForTests(undefined);
});
afterEach(() => {
  setObjectStorageForTests(undefined);
});

describe("GET /api/thumbnail-image", () => {
  it("serves every concept of a freshly generated board as image/png", async () => {
    const deps: ThumbnailPipelineDeps = {
      runs: new InMemoryPipelineRunStore(),
      image: createFixtureProviders().image,
      // The process-wide storage — the same instance the route reads from.
      storage: getObjectStorage(),
      recordCredits: () => Promise.resolve(),
      loadContext: () => Promise.resolve(fixturePackagingContext()),
    };
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 4,
      project: { generationMode: null, archetypeId: null, crossover: null },
      actorUserId: FIXTURE_IDS.user,
      overlayText: null,
    });
    expect(board.concepts).toHaveLength(4);

    for (const concept of board.concepts) {
      const res = await GET(
        new Request(
          `http://localhost/api/thumbnail-image?workspaceId=${WS}&conceptId=${concept.id}`,
        ),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });

  it("404s for an unknown concept", async () => {
    const res = await GET(
      new Request(
        `http://localhost/api/thumbnail-image?workspaceId=${WS}&conceptId=00000000-0000-4000-8000-00000000beef`,
      ),
    );
    expect(res.status).toBe(404);
  });
});
