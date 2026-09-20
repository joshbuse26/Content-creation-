import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { fixturePackagingContext } from "@/pipelines/packaging";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import type { CreditRecord } from "@/pipelines/script/store";
import {
  applyThumbnailConceptTweak,
  boardCompositionPatterns,
  chooseThumbnailConcept,
  deterministicBoardId,
  getThumbnailConcept,
  insertThumbnailConcepts,
  listBoardConcepts,
  listThumbnailBoards,
  listThumbnailConcepts,
  resetThumbnailMemoryForTests,
  runConceptTweak,
  runThumbnailBoard,
  setThumbnailConceptFavorited,
  type ThumbnailPipelineDeps,
} from "@/pipelines/thumbnails";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { MemoryObjectStorage } from "@/server/storage";
import { thumbnailsImpl } from "@/server/routers/impl/thumbnails";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx, makeDeps } from "./a2-helpers";

const WS = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const OTHER_WS = workspaceIdSchema.parse(FIXTURE_IDS.otherWorkspace);
const PROJECT = projectIdSchema.parse(FIXTURE_IDS.project);

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

const archetypeProject = {
  generationMode: "archetype" as const,
  archetypeId: "calm-explainer",
  crossover: null,
};
const genericProject = { generationMode: null, archetypeId: null, crossover: null };

beforeEach(() => {
  resetThumbnailMemoryForTests();
});

describe("deterministic board helpers", () => {
  it("board id is stable for identical params and differs when params change", () => {
    const a = deterministicBoardId('{"p":1}');
    const b = deterministicBoardId('{"p":1}');
    const c = deterministicBoardId('{"p":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // v4-shaped UUID.
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("board composition patterns are distinct and lead with the preset pattern", () => {
    const patterns = boardCompositionPatterns(
      {
        id: "x",
        compositionPatternId: "big-text",
        maxOverlayWords: 4,
        contrastRule: "light_on_dark",
        face: "required",
        paletteTemperature: "warm",
      },
      5,
    );
    expect(patterns).toHaveLength(5);
    expect(patterns[0]).toBe("big-text");
    expect(new Set(patterns).size).toBe(5);
  });
});

describe("runThumbnailBoard (fixture image provider, in-memory)", () => {
  it("generates N concepts sharing one board_id and charges N, once", async () => {
    const { deps, records } = depsWith();
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 4,
      project: archetypeProject,
      actorUserId: FIXTURE_IDS.user,
      overlayText: "proof in 60s",
    });

    expect(board.concepts).toHaveLength(4);
    const boardIds = new Set(board.concepts.map((c) => c.boardId));
    expect(boardIds.size).toBe(1);
    expect([...boardIds][0]).toBe(board.boardId);
    // Every concept is a stored image (keyless fixture, end-to-end).
    for (const c of board.concepts) {
      expect(c.imageKey).not.toBeNull();
      const stored = await deps.storage.get(c.imageKey ?? "");
      expect(stored?.contentType).toBe("image/png");
      expect(c.overlayText).toBe("proof in 60s");
      expect(c.presetId).toBe("calm-explainer");
    }
    // Distinct composition patterns across the board for comparison.
    expect(new Set(board.concepts.map((c) => c.compositionPattern)).size).toBe(4);
    // N images = N credits, each a single idempotent ledger entry of -1.
    expect(records).toHaveLength(4);
    expect(records.every((r) => r.delta === -1 && r.reason === "thumbnail")).toBe(true);
  });

  it("an identical re-run re-serves the same board and never double-charges", async () => {
    const storage = new MemoryObjectStorage();
    const runs = new InMemoryPipelineRunStore();
    const { deps, records } = depsWith({ storage, runs });
    const first = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    expect(first.concepts).toHaveLength(3);
    expect(records).toHaveLength(3);

    const second = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    expect(second.boardId).toBe(first.boardId);
    expect(second.concepts).toHaveLength(3);
    // Still exactly 3 concepts in the board (no duplicate rows) and 3 charges.
    const boardConcepts = await listBoardConcepts(WS, PROJECT, first.boardId);
    expect(boardConcepts).toHaveLength(3);
    expect(records).toHaveLength(3);
  });

  it("supports the 3-6 count range", async () => {
    const { deps } = depsWith();
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 6,
      project: archetypeProject,
      actorUserId: null,
    });
    expect(board.concepts).toHaveLength(6);
    expect(board.concepts.map((c) => c.sort)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("runConceptTweak", () => {
  it("regenerates one concept in place and charges 1, idempotent on the tweaked input", async () => {
    const storage = new MemoryObjectStorage();
    const runs = new InMemoryPipelineRunStore();
    const { deps, records } = depsWith({ storage, runs });
    const board = await runThumbnailBoard(deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    expect(records).toHaveLength(3);
    const target = board.concepts[0];
    if (target === undefined) throw new Error("no concept");

    const tweaked = await runConceptTweak(deps, {
      workspaceId: WS,
      concept: target,
      actorUserId: null,
      overlayText: "totally new overlay",
      compositionPattern: "countdown",
    });
    expect(tweaked?.id).toBe(target.id);
    expect(tweaked?.compositionPattern).toBe("countdown");
    expect(tweaked?.overlayText).toBe("totally new overlay");
    expect(tweaked?.imageKey).not.toBeNull();
    // One new charge for the tweak.
    expect(records).toHaveLength(4);

    // Re-tweak to the SAME params → idempotent, no extra charge.
    const again = await runConceptTweak(deps, {
      workspaceId: WS,
      concept: tweaked ?? target,
      actorUserId: null,
      overlayText: "totally new overlay",
      compositionPattern: "countdown",
    });
    expect(again?.id).toBe(target.id);
    expect(records).toHaveLength(4);
  });
});

describe("favorite / unfavorite (no charge)", () => {
  it("toggles favorited and is workspace-scoped", async () => {
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
    expect(row.favorited).toBe(false);

    const faved = await setThumbnailConceptFavorited(FIXTURE_IDS.workspace, row.id, true);
    expect(faved?.favorited).toBe(true);
    const unfaved = await setThumbnailConceptFavorited(FIXTURE_IDS.workspace, row.id, false);
    expect(unfaved?.favorited).toBe(false);

    // Cross-workspace → null (tenancy).
    expect(await setThumbnailConceptFavorited(FIXTURE_IDS.otherWorkspace, row.id, true)).toBeNull();
  });
});

describe("chooseWinner reconciles with choose", () => {
  it("marks one chosen, demotes others, and is visible through the project list", async () => {
    const board = await runThumbnailBoard(depsWith().deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    const [a, b] = board.concepts;
    if (a === undefined || b === undefined) throw new Error("board too small");

    const chosen = await chooseThumbnailConcept(FIXTURE_IDS.workspace, a.id);
    expect(chosen?.status).toBe("chosen");
    const chosen2 = await chooseThumbnailConcept(FIXTURE_IDS.workspace, b.id);
    expect(chosen2?.status).toBe("chosen");

    const listed = await listThumbnailConcepts(FIXTURE_IDS.workspace, FIXTURE_IDS.project);
    expect(listed.filter((c) => c.status === "chosen")).toHaveLength(1);
    expect(listed.find((c) => c.id === a.id)?.status).toBe("candidate");
  });
});

describe("listThumbnailBoards grouping + tenancy", () => {
  it("groups by board_id newest-first and keeps legacy (null board) rows in their own group", async () => {
    const d = depsWith();
    const board1 = await runThumbnailBoard(d.deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    // A second board with different params → different board_id.
    const board2 = await runThumbnailBoard(d.deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: archetypeProject,
      actorUserId: null,
      overlayText: "second board",
    });
    expect(board1.boardId).not.toBe(board2.boardId);

    const boards = await listThumbnailBoards(WS, PROJECT);
    const boardIds = boards.map((bd) => bd.boardId);
    expect(boardIds).toContain(board1.boardId);
    expect(boardIds).toContain(board2.boardId);
    // The reset seed leaves one legacy concept with board_id null.
    expect(boardIds).toContain(null);
    for (const bd of boards) {
      expect(bd.concepts.every((c) => (c.boardId ?? null) === bd.boardId)).toBe(true);
    }

    // Tenancy: another workspace sees none of these boards.
    expect(await listThumbnailBoards(OTHER_WS, PROJECT)).toHaveLength(0);
  });

  it("listBoardConcepts and getThumbnailConcept are workspace-scoped", async () => {
    const board = await runThumbnailBoard(depsWith().deps, {
      workspaceId: WS,
      projectId: PROJECT,
      count: 3,
      project: genericProject,
      actorUserId: null,
    });
    expect(await listBoardConcepts(OTHER_WS, PROJECT, board.boardId)).toHaveLength(0);
    const id = board.concepts[0]?.id;
    if (id === undefined) throw new Error("no concept");
    expect(await getThumbnailConcept(OTHER_WS, id)).toBeNull();
    expect(await getThumbnailConcept(WS, id)).not.toBeNull();
  });
});

describe("applyThumbnailConceptTweak direct persistence", () => {
  it("rewrites the row fields and refuses cross-workspace ids", async () => {
    const [row] = await insertThumbnailConcepts([
      {
        workspaceId: FIXTURE_IDS.workspace,
        projectId: FIXTURE_IDS.project,
        promptUsed: "old",
        compositionPattern: "big-text",
        imageKey: "thumbnails/old.png",
      },
    ]);
    if (row === undefined) throw new Error("insert failed");
    const updated = await applyThumbnailConceptTweak(FIXTURE_IDS.workspace, row.id, {
      imageKey: "thumbnails/new.png",
      promptUsed: "new",
      compositionPattern: "countdown",
      overlayText: "x",
      presetId: "calm-explainer",
      subjectMode: "face",
      colorMood: "vibrant",
    });
    expect(updated?.promptUsed).toBe("new");
    expect(updated?.compositionPattern).toBe("countdown");
    expect(updated?.subjectMode).toBe("face");
    expect(updated?.colorMood).toBe("vibrant");

    expect(
      await applyThumbnailConceptTweak(FIXTURE_IDS.otherWorkspace, row.id, {
        imageKey: null,
        promptUsed: "z",
        compositionPattern: "big-text",
        overlayText: null,
        presetId: null,
        subjectMode: null,
        colorMood: null,
      }),
    ).toBeNull();
  });
});

describe("thumbnails impl — credit gate + tenancy (zero env)", () => {
  beforeEach(() => {
    resetThumbnailMemoryForTests();
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    resetSharedWorkspaceStoreForTests();
    setEngineDepsForTests(undefined);
  });

  function setBalance(balance: number): void {
    const ws = getSharedWorkspaceStore().workspaces.find((w) => w.id === FIXTURE_IDS.workspace);
    if (ws === undefined) throw new Error("fixture workspace missing");
    ws.creditBalance = balance;
  }

  it("generateBoard rejects with PRECONDITION_FAILED at 0 credits", async () => {
    setBalance(0);
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
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("tweakConcept rejects with PRECONDITION_FAILED at 0 credits", async () => {
    setBalance(0);
    setEngineDepsForTests(makeDeps());
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
    await expect(
      thumbnailsImpl.tweakConcept({
        ctx: fixtureCtx,
        input: { workspaceId: WS, conceptId: row.id, overlayText: "new" },
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("generateBoard on a cross-workspace / missing project → NOT_FOUND", async () => {
    setBalance(100);
    setEngineDepsForTests(makeDeps());
    const foreignProject = projectIdSchema.parse("00000000-0000-4000-8000-0000000f0001");
    await expect(
      thumbnailsImpl.generateBoard({
        ctx: fixtureCtx,
        input: {
          workspaceId: WS,
          projectId: foreignProject,
          count: 3,
          overlayText: null,
          preset: null,
          subject: null,
          mood: null,
          brief: null,
          referenceImage: null,
        },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  });

  it("generateBoard end-to-end through the impl returns a board of N concepts (keyless)", async () => {
    setBalance(100);
    const deps = makeDeps();
    setEngineDepsForTests(deps);
    const board = await thumbnailsImpl.generateBoard({
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
    });
    expect(board.concepts).toHaveLength(3);
    expect(new Set(board.concepts.map((c) => c.boardId)).size).toBe(1);
    // Charged per image via the injected engine store ledger.
    expect(deps.store.creditEntries.filter((e) => e.reason === "thumbnail")).toHaveLength(3);

    // favorite/unfavorite/chooseWinner through the impl never charge.
    const first = board.concepts[0];
    if (first === undefined) throw new Error("no concept");
    const before = deps.store.creditEntries.length;
    await thumbnailsImpl.favorite({
      ctx: fixtureCtx,
      input: { workspaceId: WS, conceptId: first.id },
    });
    const won = await thumbnailsImpl.chooseWinner({
      ctx: fixtureCtx,
      input: { workspaceId: WS, conceptId: first.id },
    });
    expect(won.status).toBe("chosen");
    expect(deps.store.creditEntries.length).toBe(before);
  });
});
