import { createHash } from "node:crypto";
import type { PipelineKind, PipelineRunStatus } from "@/lib/types/enums";

/**
 * PipelineRunner — executes a pipeline's named stages sequentially,
 * persisting a pipeline_runs row per stage, with:
 *
 * - resume-from-failed-stage: stages already `done` for the same input hash
 *   are skipped, so re-enqueueing a failed job restarts at the failure point;
 * - per-stage retries: 2 retries (3 attempts) with backoff before the run is
 *   marked failed (spec §5 — credits are refunded by the caller via a ledger
 *   entry when a charged run fails).
 *
 * The store is injectable: Drizzle-backed in production (queue/store.ts),
 * in-memory for tests and fixture mode.
 */

export interface PipelineRunRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  kind: PipelineKind;
  stage: string;
  status: PipelineRunStatus;
  attempt: number;
  inputHash: string;
  error: string | null;
  creditsCharged: number;
}

export interface ActiveRunKey {
  workspaceId: string;
  projectId: string | null;
  kind: PipelineKind;
  inputHash: string;
}

export interface PipelineRunStore {
  create(run: Omit<PipelineRunRecord, "id">): Promise<PipelineRunRecord>;
  update(
    id: string,
    patch: Partial<Pick<PipelineRunRecord, "status" | "attempt" | "error" | "creditsCharged">>,
  ): Promise<void>;
  /** Latest run row for this stage+input, or null. */
  find(key: {
    workspaceId: string;
    projectId: string | null;
    kind: PipelineKind;
    stage: string;
    inputHash: string;
  }): Promise<PipelineRunRecord | null>;
  /**
   * Most recently touched `running` stage row for this pipeline+input (any
   * stage), or null. Backs the runner claim: an identical run refuses to
   * start while another is running and fresh.
   */
  findRunning?(key: ActiveRunKey): Promise<{ id: string; updatedAt: Date } | null>;
}

export interface StageDefinition<TInput> {
  name: string;
  run(input: TInput): Promise<void>;
}

export interface PipelineDefinition<TInput> {
  kind: PipelineKind;
  stages: readonly StageDefinition<TInput>[];
}

export interface PipelineParams<TInput> {
  workspaceId: string;
  projectId: string | null;
  input: TInput;
  /** Defaults to sha-256 of the JSON input. */
  inputHash?: string;
}

export type PipelineResult =
  | { status: "done"; skippedStages: string[] }
  | { status: "failed"; stage: string; error: string; skippedStages: string[] };

export interface PipelineRunnerOptions {
  /** Retries per stage after the first attempt. Default 2 (spec §5). */
  maxRetries?: number;
  /** Backoff before retry `attempt` (1-based). Default 1s * 2^(attempt-1). */
  backoffMs?: (attempt: number) => number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * How recently a concurrent `running` row must have been touched to block
   * an identical run from starting. Default 5 minutes — a crashed run's
   * stale row stops blocking once it ages out.
   */
  claimFreshnessMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Error message returned when an identical run is already in progress. */
export const RUN_ALREADY_IN_PROGRESS = "an identical run is already in progress";

export function hashInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex");
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PipelineRunner {
  private readonly maxRetries: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly claimFreshnessMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: PipelineRunStore,
    options: PipelineRunnerOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffMs = options.backoffMs ?? ((attempt) => 1_000 * 2 ** (attempt - 1));
    this.sleep = options.sleep ?? defaultSleep;
    this.claimFreshnessMs = options.claimFreshnessMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  async execute<TInput>(
    pipeline: PipelineDefinition<TInput>,
    params: PipelineParams<TInput>,
  ): Promise<PipelineResult> {
    const inputHash = params.inputHash ?? hashInput(params.input);
    const skippedStages: string[] = [];

    // Runner claim: refuse to start when an identical run (same workspace,
    // project, kind and input hash) has a fresh `running` stage row — a
    // duplicate enqueue or an overlapping BullMQ retry must not execute the
    // same work (and charge for it) twice. Stale rows from crashed runs age
    // out after claimFreshnessMs.
    if (this.store.findRunning !== undefined) {
      const active = await this.store.findRunning({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        kind: pipeline.kind,
        inputHash,
      });
      if (active !== null && this.now() - active.updatedAt.getTime() < this.claimFreshnessMs) {
        return {
          status: "failed",
          stage: pipeline.stages[0]?.name ?? "start",
          error: RUN_ALREADY_IN_PROGRESS,
          skippedStages,
        };
      }
    }

    for (const stage of pipeline.stages) {
      const key = {
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        kind: pipeline.kind,
        stage: stage.name,
        inputHash,
      };

      const existing = await this.store.find(key);
      if (existing?.status === "done") {
        skippedStages.push(stage.name);
        continue;
      }

      const record =
        existing ??
        (await this.store.create({
          ...key,
          status: "queued",
          attempt: 0,
          error: null,
          creditsCharged: 0,
        }));

      const outcome = await this.runStageWithRetries(stage, params.input, record);
      if (outcome !== null) {
        return { status: "failed", stage: stage.name, error: outcome, skippedStages };
      }
    }

    return { status: "done", skippedStages };
  }

  /** Returns null on success, or the final error message on exhaustion. */
  private async runStageWithRetries<TInput>(
    stage: StageDefinition<TInput>,
    input: TInput,
    record: PipelineRunRecord,
  ): Promise<string | null> {
    const totalAttempts = this.maxRetries + 1;
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      await this.store.update(record.id, { status: "running", attempt, error: null });
      try {
        await stage.run(input);
        await this.store.update(record.id, { status: "done" });
        return null;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < totalAttempts) {
          await this.sleep(this.backoffMs(attempt));
        }
      }
    }

    await this.store.update(record.id, { status: "failed", error: lastError });
    return lastError;
  }
}

/** In-memory store — tests and fixture mode. */
export class InMemoryPipelineRunStore implements PipelineRunStore {
  public readonly rows: PipelineRunRecord[] = [];
  private readonly touchedAt = new Map<string, Date>();
  private seq = 0;

  create(run: Omit<PipelineRunRecord, "id">): Promise<PipelineRunRecord> {
    this.seq += 1;
    const record: PipelineRunRecord = { ...run, id: `run-${this.seq}` };
    this.rows.push(record);
    this.touchedAt.set(record.id, new Date());
    return Promise.resolve(record);
  }

  update(
    id: string,
    patch: Partial<Pick<PipelineRunRecord, "status" | "attempt" | "error" | "creditsCharged">>,
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row === undefined) return Promise.reject(new Error(`run ${id} not found`));
    Object.assign(row, patch);
    this.touchedAt.set(id, new Date());
    return Promise.resolve();
  }

  findRunning(key: ActiveRunKey): Promise<{ id: string; updatedAt: Date } | null> {
    const match = [...this.rows]
      .reverse()
      .find(
        (r) =>
          r.workspaceId === key.workspaceId &&
          r.projectId === key.projectId &&
          r.kind === key.kind &&
          r.inputHash === key.inputHash &&
          r.status === "running",
      );
    if (match === undefined) return Promise.resolve(null);
    return Promise.resolve({ id: match.id, updatedAt: this.touchedAt.get(match.id) ?? new Date() });
  }

  /** Test hook: back-date a row's last-touched time (stale-claim tests). */
  setTouchedAtForTests(id: string, when: Date): void {
    this.touchedAt.set(id, when);
  }

  find(key: {
    workspaceId: string;
    projectId: string | null;
    kind: PipelineKind;
    stage: string;
    inputHash: string;
  }): Promise<PipelineRunRecord | null> {
    const matches = this.rows.filter(
      (r) =>
        r.workspaceId === key.workspaceId &&
        r.projectId === key.projectId &&
        r.kind === key.kind &&
        r.stage === key.stage &&
        r.inputHash === key.inputHash,
    );
    return Promise.resolve(matches.at(-1) ?? null);
  }
}
