# REQUESTS-A2 — Script Engine track

Requests to other agents / Josh, per the sprint rule that a needed change in
foreign code is a written request, not an edit. Nothing here blocks A2's
deliverables — all items have working interim behavior.

## To A0 (integrator)

1. **Wire the impl handlers into `server/routers/_contracts.ts`** (frozen file —
   A0-owned). Replace stub bodies with delegation; signatures unchanged:
   - `server/routers/impl/research.ts` → `researchImpl.{list,get,search,importTranscript,upload,remove}`
   - `server/routers/impl/frame.ts` → `frameImpl.{list,propose,choose,update}`
   - `server/routers/impl/script.ts` → `scriptImpl.{generate,get,listVersions,updateSection,regenerateSection,setSectionLock,export}`
   - `server/routers/impl/revision.ts` → `revisionImpl.{run,list,accept,reject}`
   - `server/routers/impl/titles.ts` → `titlesImpl.{generate,latest}`

   Pattern: `.mutation((opts) => researchImpl.search(opts))` — the impl ctx is a
   structural subset of the post-`workspaceProcedure` ctx (`userId`,
   `workspaceId`), so no adapter is needed.

2. **Wire worker job handlers** in `worker/index.ts` (A0-owned): replace the
   skeleton no-ops with the handlers from `pipelines/script/jobs.ts` —
   `generate-script` → `handleGenerateScriptJob`, `revision-pass` →
   `handleRevisionPassJob`, `research` → `handleResearchJob`, `propose-frames`
   → `handleProposeFramesJob`, and on the packaging queue `titles` →
   `handleTitlesJob`. Each parses its own payload and throws on pipeline
   failure so the BullMQ safety-net retry applies.

3. **`jobAccepted.pipelineRunIds` is currently an opaque token** (one random
   UUID per dispatch). Real `pipeline_runs` row ids are created inside the
   PipelineRunner as stages start, i.e. after the mutation returned. If the
   dashboard needs to link a mutation to its runs, the cleanest fix is a
   `run_group_id` column on pipeline_runs (frozen-layer change, needs Josh
   approval) — or the dashboard can query runs by `project_id` + `kind`,
   which works today.

4. **Quality-gate reports have no table** in the frozen schema. A2 keeps them
   in a process-local cache AND recomputes them on demand from persisted
   sections + the chosen frame (the gate is pure code), so `script.get`
   always returns a correct report for final scripts. One nuance:
   `autoFixAttempted` and historical warnings don't survive a process
   restart — only the recomputed current-state report does. Fine for v1;
   a `quality_report jsonb` column on scripts would fix it if we ever care.

5. **Pipeline kinds**: the frozen `pipeline_kind` enum has no `research`,
   `frame`, or `titles` members, so those pipelines record runs under kind
   `script` (stage names are distinct so runs stay unambiguous). If we want
   proper kinds it's a frozen-layer enum addition.

## To A3 (frontend)

6. **SSE endpoint**: `GET /api/script-stream?workspaceId=<uuid>&scriptId=<uuid>`
   — events per the frozen `scriptStreamEventSchema` union, `event:` field =
   event type, `data:` = full JSON event. Full replay on (re)connect, closes
   after `complete`/`failed`. Heartbeat comments every 15s.

7. **script.generate returns `scriptId` immediately** — open the SSE stream
   with it right after the mutation resolves; replay guarantees no missed
   events even if the pipeline already finished (fixture mode is instant).

## Dependencies (none added — package.json is frozen to A2)

8. **pdf-parse** (or `unpdf`): the frozen `research.upload` contract accepts
   already-parsed text, so PDF text extraction must happen before the tRPC
   call. Either A3 parses client-side, or we add a server upload endpoint +
   `pdf-parse` dependency in v1.x. MD/TXT work end-to-end today.

## Notes for Josh

9. **PROMPT_VERSION** (`prompts/version.ts`, currently `2026-09-10.1`) is
   folded into every stage's `input_hash` on pipeline_runs — that's how the
   prompt generation is recorded per run, and it auto-invalidates stage
   resume when prompts change. Bump it on any prompt edit (Day 4 iteration).
10. **Golden set**: `pnpm exec tsx scripts/golden-run.ts` (fixture mode, zero
    env) or with `PROVIDERS=live` + keys for real output. Add your 10 briefs
    to `scripts/golden-briefs.json` (schema: id, title, researchQuery,
    targetMinutes). `--out sheet.md` writes the scoring sheet to a file.
