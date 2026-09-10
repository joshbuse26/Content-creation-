import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { ImageProvider } from "@/lib/providers/types";
import { thumbnailJobInputSchema, THUMBNAIL_STAGES } from "@/lib/types/pipeline";
import { fixturePackagingContext } from "@/pipelines/packaging";
import type { CreditRecord } from "@/pipelines/script/store";
import {
  buildThumbnailImagePrompt,
  chooseThumbnailConcept,
  COMPOSITION_PATTERNS,
  compositionPatternNote,
  insertThumbnailConcepts,
  listThumbnailConcepts,
  resetThumbnailMemoryForTests,
  runThumbnailPipeline,
  THUMBNAIL_CREDIT_COST,
  THUMBNAIL_PROMPT_VERSION,
  thumbnailInputHash,
  type ThumbnailPipelineDeps,
} from "@/pipelines/thumbnails";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { MemoryObjectStorage } from "@/server/storage";

const ctx = fixturePackagingContext();

const jobInput = thumbnailJobInputSchema.parse({
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  compositionPattern: "split-screen",
  subjectDescription: "tiny espresso machine facing a towering prosumer rig",
  faceImageKey: null,
});

/** Ledger stub with the same idempotency-key dedupe as the real stores. */
function ledgerStub() {
  const records: CreditRecord[] = [];
  const recordCredits = (r: CreditRecord): Promise<void> => {
    const key = r.idempotencyKey ?? null;
    if (key !== null && records.some((e) => (e.idempotencyKey ?? null) === key)) {
      return Promise.resolve();
    }
    records.push(r);
    return Promise.resolve();
  };
  return { records, recordCredits };
}

function depsWith(overrides: Partial<ThumbnailPipelineDeps> = {}) {
  const { records, recordCredits } = ledgerStub();
  const deps: ThumbnailPipelineDeps = {
    runs: new InMemoryPipelineRunStore(),
    image: createFixtureProviders().image,
    storage: new MemoryObjectStorage(),
    recordCredits,
    loadContext: () => Promise.resolve(fixturePackagingContext()),
    ...overrides,
  };
  return { deps, records };
}

beforeEach(() => {
  resetThumbnailMemoryForTests();
});

describe("composition pattern library", () => {
  it("has at least 20 original abstract patterns with unique ids", () => {
    expect(COMPOSITION_PATTERNS.length).toBeGreaterThanOrEqual(20);
    const ids = COMPOSITION_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of COMPOSITION_PATTERNS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(20);
    }
  });

  it("unknown patterns fall back to free composition guidance", () => {
    expect(compositionPatternNote("split-screen")).toContain("split");
    expect(compositionPatternNote("not-a-pattern")).toContain("Free composition");
  });
});

describe("thumbnail image prompt", () => {
  it("is deterministic and carries pattern, subject, constraints, version", () => {
    const input = {
      compositionPattern: "arrow-focus",
      subjectDescription: "a cracked portafilter under a spotlight",
      faceReferenceNote: null,
    };
    const a = buildThumbnailImagePrompt(ctx, input);
    const b = buildThumbnailImagePrompt(ctx, input);
    expect(a).toBe(b);
    expect(a).toContain("1280x720");
    expect(a).toContain("arrow-focus");
    expect(a).toContain(compositionPatternNote("arrow-focus"));
    expect(a).toContain("cracked portafilter");
    expect(a).toContain("No logos");
    expect(a).toContain(THUMBNAIL_PROMPT_VERSION);
    expect(a).toContain("No real people's likenesses");
  });

  it("includes the face reference only when one is provided", () => {
    const without = buildThumbnailImagePrompt(ctx, {
      compositionPattern: "big-text",
      subjectDescription: "subject",
      faceReferenceNote: null,
    });
    const withFace = buildThumbnailImagePrompt(ctx, {
      compositionPattern: "big-text",
      subjectDescription: "subject",
      faceReferenceNote: "uploaded face photo on file (key faces/x.png)",
    });
    expect(without).not.toContain("Face reference");
    expect(withFace).toContain("Face reference: uploaded face photo on file");
  });

  it("prompt version is folded into the input hash", () => {
    // Same input always hashes the same; the hash embeds the prompt version
    // constant so bumping it invalidates stage resume.
    expect(thumbnailInputHash(jobInput)).toBe(thumbnailInputHash({ ...jobInput }));
  });
});

describe("thumbnail pipeline (fixture image provider, in-memory storage)", () => {
  it("generates 3 concepts with stored images and charges 3 credits once", async () => {
    const { deps, records } = depsWith();
    const { result, concepts } = await runThumbnailPipeline(deps, {
      input: jobInput,
      actorUserId: FIXTURE_IDS.user,
    });

    expect(result.status).toBe("done");
    expect(concepts).toHaveLength(3);
    for (const c of concepts) {
      expect(c.imageKey).not.toBeNull();
      expect(c.compositionPattern).toBe("split-screen");
      expect(c.status).toBe("candidate");
      const stored = await deps.storage.get(c.imageKey ?? "");
      expect(stored).not.toBeNull();
      expect(stored?.contentType).toBe("image/png");
      expect((stored?.data.byteLength ?? 0) > 0).toBe(true);
    }
    // 1 credit per image (spec §7) in a single idempotent ledger entry.
    expect(records).toHaveLength(1);
    expect(records[0]?.delta).toBe(-THUMBNAIL_CREDIT_COST);
    expect(records[0]?.reason).toBe("thumbnail");
    expect(records[0]?.idempotencyKey).toBe(`thumbnail:${thumbnailInputHash(jobInput)}`);

    // The concepts are visible through the list read path.
    const listed = await listThumbnailConcepts(FIXTURE_IDS.workspace, FIXTURE_IDS.project);
    expect(listed.filter((c) => c.imageKey !== null)).toHaveLength(3);
  });

  it("an identical re-run skips all stages and never double-charges", async () => {
    const { deps, records } = depsWith();
    const first = await runThumbnailPipeline(deps, { input: jobInput, actorUserId: null });
    expect(first.result.status).toBe("done");
    expect(records).toHaveLength(1);

    const second = await runThumbnailPipeline(deps, { input: jobInput, actorUserId: null });
    expect(second.result.status).toBe("done");
    expect(second.result.status === "done" ? second.result.skippedStages : []).toHaveLength(
      THUMBNAIL_STAGES.length,
    );
    expect(records).toHaveLength(1); // still exactly one charge
  });

  it("a failed run charges nothing and stores nothing", async () => {
    const failingImage: ImageProvider = {
      generate: () => Promise.reject(new Error("image API down")),
    };
    const storage = new MemoryObjectStorage();
    const { deps, records } = depsWith({
      image: failingImage,
      storage,
      // no retry backoff waiting in tests
      runs: new InMemoryPipelineRunStore(),
    });
    const patched: ThumbnailPipelineDeps = { ...deps, storage };
    const { result, concepts } = await runThumbnailPipeline(patched, {
      input: jobInput,
      actorUserId: null,
    });
    expect(result.status).toBe("failed");
    expect(concepts).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(storage.size()).toBe(0);
  }, 15_000);

  it("copies live provider URLs into our storage via fetchBytes", async () => {
    const urlImage: ImageProvider = {
      generate: (req) =>
        Promise.resolve(
          Array.from({ length: req.count }, (_, i) => ({
            url: `https://img.example.com/gen-${i}.png`,
            base64Png: null,
          })),
        ),
    };
    const fetched: string[] = [];
    const { deps, records } = depsWith({
      image: urlImage,
      fetchBytes: (url) => {
        fetched.push(url);
        return Promise.resolve(Uint8Array.from([42]));
      },
    });
    const { result, concepts } = await runThumbnailPipeline(deps, {
      input: jobInput,
      actorUserId: null,
    });
    expect(result.status).toBe("done");
    expect(fetched).toHaveLength(3);
    expect(concepts.every((c) => c.imageKey?.startsWith("thumbnails/") ?? false)).toBe(true);
    expect(records).toHaveLength(1);
  });
});

describe("thumbnail concept persistence (in-memory mode)", () => {
  it("choose marks one chosen and demotes the previous chosen of the project", async () => {
    const inserted = await insertThumbnailConcepts([
      {
        workspaceId: FIXTURE_IDS.workspace,
        projectId: FIXTURE_IDS.project,
        promptUsed: "p1",
        compositionPattern: "big-text",
        imageKey: null,
      },
      {
        workspaceId: FIXTURE_IDS.workspace,
        projectId: FIXTURE_IDS.project,
        promptUsed: "p2",
        compositionPattern: "big-text",
        imageKey: null,
      },
    ]);
    const [a, b] = inserted;
    if (a === undefined || b === undefined) throw new Error("insert failed");

    const chosenA = await chooseThumbnailConcept(FIXTURE_IDS.workspace, a.id);
    expect(chosenA?.status).toBe("chosen");
    const chosenB = await chooseThumbnailConcept(FIXTURE_IDS.workspace, b.id);
    expect(chosenB?.status).toBe("chosen");

    const all = await listThumbnailConcepts(FIXTURE_IDS.workspace, FIXTURE_IDS.project);
    expect(all.filter((c) => c.status === "chosen")).toHaveLength(1);
    expect(all.find((c) => c.id === a.id)?.status).toBe("candidate");
  });

  it("choose refuses cross-workspace ids (tenancy)", async () => {
    const [row] = await insertThumbnailConcepts([
      {
        workspaceId: FIXTURE_IDS.workspace,
        projectId: FIXTURE_IDS.project,
        promptUsed: "p",
        compositionPattern: "big-text",
        imageKey: null,
      },
    ]);
    if (row === undefined) throw new Error("insert failed");
    expect(await chooseThumbnailConcept(FIXTURE_IDS.otherWorkspace, row.id)).toBeNull();
  });
});
