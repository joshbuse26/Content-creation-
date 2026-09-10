import { describe, expect, it } from "vitest";
import {
  hashInput,
  InMemoryPipelineRunStore,
  PipelineRunner,
  RUN_ALREADY_IN_PROGRESS,
  RunClaimConflictError,
  type PipelineDefinition,
} from "@/queue/pipeline-runner";

const noSleep = () => Promise.resolve();

interface Input {
  value: string;
}

function pipelineWith(
  stages: { name: string; impl: (input: Input) => Promise<void> }[],
): PipelineDefinition<Input> {
  return {
    kind: "script",
    stages: stages.map((s) => ({ name: s.name, run: s.impl })),
  };
}

const params = { workspaceId: "ws-1", projectId: "proj-1", input: { value: "a" } };

describe("PipelineRunner", () => {
  it("runs every stage and persists a done row per stage", async () => {
    const store = new InMemoryPipelineRunStore();
    const runner = new PipelineRunner(store, { sleep: noSleep });
    const calls: string[] = [];
    const result = await runner.execute(
      pipelineWith([
        { name: "outline", impl: (i) => (calls.push(`outline:${i.value}`), Promise.resolve()) },
        { name: "draft", impl: () => (calls.push("draft"), Promise.resolve()) },
      ]),
      params,
    );
    expect(result.status).toBe("done");
    expect(calls).toEqual(["outline:a", "draft"]);
    expect(store.rows.map((r) => [r.stage, r.status, r.attempt])).toEqual([
      ["outline", "done", 1],
      ["draft", "done", 1],
    ]);
  });

  it("retries a failing stage twice with backoff, then succeeds", async () => {
    const store = new InMemoryPipelineRunStore();
    const backoffs: number[] = [];
    const runner = new PipelineRunner(store, {
      sleep: (ms) => (backoffs.push(ms), Promise.resolve()),
    });
    let attempts = 0;
    const result = await runner.execute(
      pipelineWith([
        {
          name: "flaky",
          impl: () => {
            attempts += 1;
            return attempts < 3 ? Promise.reject(new Error("boom")) : Promise.resolve();
          },
        },
      ]),
      params,
    );
    expect(result.status).toBe("done");
    expect(attempts).toBe(3);
    expect(backoffs).toEqual([1000, 2000]); // exponential
    expect(store.rows[0]?.status).toBe("done");
    expect(store.rows[0]?.attempt).toBe(3);
  });

  it("marks the run failed after 3 attempts and stops the pipeline", async () => {
    const store = new InMemoryPipelineRunStore();
    const runner = new PipelineRunner(store, { sleep: noSleep });
    let laterRan = false;
    const result = await runner.execute(
      pipelineWith([
        { name: "always-fails", impl: () => Promise.reject(new Error("nope")) },
        { name: "never-reached", impl: () => ((laterRan = true), Promise.resolve()) },
      ]),
      params,
    );
    expect(result).toMatchObject({ status: "failed", stage: "always-fails", error: "nope" });
    expect(laterRan).toBe(false);
    expect(store.rows[0]?.status).toBe("failed");
    expect(store.rows[0]?.error).toBe("nope");
    expect(store.rows).toHaveLength(1);
  });

  it("resumes from the failed stage, skipping stages already done", async () => {
    const store = new InMemoryPipelineRunStore();
    const runner = new PipelineRunner(store, { sleep: noSleep });
    let stage1Runs = 0;
    let stage2ShouldFail = true;

    const pipeline = pipelineWith([
      { name: "one", impl: () => (stage1Runs++, Promise.resolve()) },
      {
        name: "two",
        impl: () => (stage2ShouldFail ? Promise.reject(new Error("transient")) : Promise.resolve()),
      },
    ]);

    const first = await runner.execute(pipeline, params);
    expect(first.status).toBe("failed");
    expect(stage1Runs).toBe(1);

    // The failure clears (e.g. upstream outage over); re-enqueue the same job.
    stage2ShouldFail = false;
    const second = await runner.execute(pipeline, params);
    expect(second).toMatchObject({ status: "done", skippedStages: ["one"] });
    expect(stage1Runs).toBe(1); // stage one did NOT rerun
    // The failed row for stage two was reused and is now done.
    const stageTwoRows = store.rows.filter((r) => r.stage === "two");
    expect(stageTwoRows).toHaveLength(1);
    expect(stageTwoRows[0]?.status).toBe("done");
  });

  it("different input hash reruns all stages", async () => {
    const store = new InMemoryPipelineRunStore();
    const runner = new PipelineRunner(store, { sleep: noSleep });
    let runs = 0;
    const pipeline = pipelineWith([{ name: "only", impl: () => (runs++, Promise.resolve()) }]);
    await runner.execute(pipeline, params);
    await runner.execute(pipeline, { ...params, input: { value: "different" } });
    expect(runs).toBe(2);
    expect(store.rows).toHaveLength(2);
  });

  it("hashInput is deterministic and input-sensitive", () => {
    expect(hashInput({ a: 1 })).toBe(hashInput({ a: 1 }));
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }));
  });

  it("two truly concurrent identical executes: one runs, one CONFLICTs (atomic claim)", async () => {
    const store = new InMemoryPipelineRunStore();
    const runner = new PipelineRunner(store, { sleep: noSleep });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const pipeline = pipelineWith([
      {
        name: "slow",
        impl: async () => {
          runs += 1;
          await gate;
        },
      },
    ]);
    // Both dispatches start before either has persisted a row — the old
    // check-then-create claim let both execute; the atomic create must not.
    const both = Promise.all([runner.execute(pipeline, params), runner.execute(pipeline, params)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const results = await both;
    expect(runs).toBe(1);
    expect(results.map((r) => r.status).sort()).toEqual(["done", "failed"]);
    const loser = results.find((r) => r.status === "failed");
    expect(loser).toMatchObject({ error: RUN_ALREADY_IN_PROGRESS });
    // Exactly one row was ever created for the input.
    expect(store.rows).toHaveLength(1);
  });

  it("the in-memory store's create mirrors the partial unique claim index", async () => {
    const store = new InMemoryPipelineRunStore();
    const base = {
      workspaceId: "ws-1",
      projectId: "proj-1",
      kind: "script" as const,
      stage: "outline",
      status: "running" as const,
      attempt: 1,
      inputHash: "same-hash",
      error: null,
      creditsCharged: 0,
    };
    await store.create(base);
    await expect(store.create({ ...base, stage: "draft" })).rejects.toBeInstanceOf(
      RunClaimConflictError,
    );
    // A finished claim frees the slot: done/failed rows never block.
    const finished = await store.create({ ...base, inputHash: "other-hash" });
    await store.update(finished.id, { status: "done" });
    await expect(
      store.create({ ...base, inputHash: "other-hash", status: "queued" }),
    ).resolves.toMatchObject({ inputHash: "other-hash" });
  });
});
