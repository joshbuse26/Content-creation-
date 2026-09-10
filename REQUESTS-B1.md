# REQUESTS-B1 — ideation track (outlier index §5.3 + daily ideas §5.4)

Requests and wiring notes for A0 (integrator). B1 touched only its owned
paths: `pipelines/ideation/**`, `server/routers/impl/ideas.ts`,
`app/(app)/ideas/**`, `components/ideas/**`, `tests/b1-*`, this file.

## Integrator wiring (required to activate the feature)

1. **Router bodies** — `server/routers/_contracts.ts` (frozen, so B1 did not
   touch it) still serves the Day-1 fixture stubs for `ideas`. Swap the five
   bodies for the impl, mirroring every other router:

   ```ts
   import { ideasHandlers } from "@/server/routers/impl/ideas";
   // feed:         .query(({ ctx, input }) => ideasHandlers.feed({ ctx, input }))
   // save:         .mutation(({ ctx, input }) => ideasHandlers.save({ ctx, input }))
   // dismiss:      .mutation(({ ctx, input }) => ideasHandlers.dismiss({ ctx, input }))
   // promote:      .mutation(({ ctx, input }) => ideasHandlers.promote({ ctx, input }))
   // requestBatch: .mutation(({ ctx, input }) => ideasHandlers.requestBatch({ ctx, input }))
   ```

   Handlers implement the frozen signatures exactly (same `HandlerOpts`
   shape as A1/A2/A4 impls); `fixtureIdea`/`fixtureProject` imports in
   `_contracts.ts` become unused once swapped. The UI at `/ideas` runs
   against the stubs until this lands (cards render, actions no-op-ish).

2. **Worker routing** — `worker/index.ts` sync-queue switch: replace the
   `JOB_NAMES.dailyIdeas` / `JOB_NAMES.outlierRefresh` no-op acks with

   ```ts
   import { processIdeationJob, registerIdeationSchedules } from "@/pipelines/ideation";
   case JOB_NAMES.dailyIdeas:
   case JOB_NAMES.outlierRefresh:
     await processIdeationJob(job);
     return;
   ```

   and call `await registerIdeationSchedules();` next to
   `registerSyncSchedules()` at startup. Schedules registered:
   `nightly-outlier-refresh` 04:10 UTC (after the 03:10 channel-sync sweep so
   medians are fresh) and `daily-idea-feed` 06:00 America/New_York (spec
   §5.4). Both fire `{sweep: true}` and fan out; no new job names were
   needed — the frozen `outlier-refresh` / `daily-ideas` names on the `sync`
   queue are used as-is.

3. **Sidebar nav** — the shell is owned by the frontend track: add an
   "Ideas" item linking to `/ideas` in `components/shell/app-shell.tsx`
   (between Projects and Channels reads naturally).

## Frozen-layer requests (non-blocking)

- **`CREDIT_COSTS.ideaBatch`** — `server/credits.ts` (A0-owned) has no idea
  batch entry; B1 defines `IDEA_BATCH_CREDIT_COST = 1` in
  `pipelines/ideation/ideas.ts` (spec §7: extra idea batch = 1 credit).
  Fold it into `CREDIT_COSTS` when touching billing next.
- **Global pipeline runs can't persist** — `pipeline_runs.workspace_id` is a
  NOT NULL FK to `workspaces`, but outlier-refresh runs are global (the
  outlier index is shared across workspaces). Those runs therefore use an
  in-memory run store for the runner's sequencing/retry mechanics only —
  same precedent as the pre-approval sync pipeline. A nullable
  `workspace_id` (or a sentinel workspace) would let them persist;
  workspace-scoped daily-ideas runs DO persist under kind `"ideas"`.
- **Ideation prompts live at `pipelines/ideation/prompts.ts`**, not
  `prompts/*` (A2-owned dir, spec §5 letter). Versioned + typed either way
  (`IDEATION_PROMPT_VERSION` folded into stage input hashes); move when
  convenient — same note as A1's avatar prompt.

## Deferred / accepted for v1.1

- **Embedding dedup deferred.** Spec §5.4 wants embedding cosine > 0.85;
  there is no embedding provider in the frozen provider set, so dedup ships
  as deterministic trigram Jaccard on normalized titles (>= 0.6 = dup,
  pg_trgm-style padding — `pipelines/ideation/similarity.ts`). Swap-in
  point: `isDuplicateTitle` inside the `dedup_ideas` stage.
- **"Fresh" outliers** = published within 90 days (search window and feed
  filter); the daily prompt takes the top 20 by outlier ratio.
- **Same-day identical daily runs resume, requested batches always run**:
  scheduled runs hash on (input, day) so duplicate enqueues resume; each
  user-requested batch carries a `batchNonce` so it is a genuinely new run
  with its own idempotent 1-credit charge (charged on completion, never on
  failure, never twice — `idea_batch:<run hash>` ledger key).
- **Quota** (spec §8): search results cached 24h by normalized query
  (channels sharing a niche share searches; the sweep also dedupes identical
  normalized keyword sets globally), competitor channel medians cached 7d,
  ≤6 searches/run enforced by the frozen `outlierJobInputSchema`, and every
  YouTube call charges the shared circuit breaker BEFORE running — a
  tripped breaker degrades the run to cached data instead of failing it.
