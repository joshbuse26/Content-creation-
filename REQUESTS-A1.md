# REQUESTS-A1 — Channel track (A1) → other agents

Format per sprint plan §2: a needed change in foreign code is a written
request, not an edit. Each item has a one-line justification and the
workaround currently in place.

## To A0 (Foundation/Integrator)

1. **Wire the real channel/avatar handlers into `server/routers/_contracts.ts`.**
   Replace the stub bodies (signatures unchanged) with:
   - `channelRouter`: `channelHandlers.{list,get,connectPublic,sync,updateNiche,disconnect}`
     from `server/routers/impl/channel.ts`, e.g.
     `.query(({ ctx, input }) => channelHandlers.list({ ctx, input }))`.
   - `avatarRouter`: `avatarHandlers.{get,update,regenerate}` from
     `server/routers/impl/avatar.ts`.
     Justification: _contracts.ts is frozen; only the integrator swaps bodies.
     Workaround: none needed — handlers are live-callable and fully tested.

2. **Wire the sync-queue worker cases to `processSyncQueueJob`.**
   In `worker/index.ts`'s sync Worker, delegate `channel-sync`,
   `avatar-generate` and `post-publish-tracking` to
   `processSyncQueueJob(job)` from `pipelines/sync/processor.ts` (it parses
   job data itself, including the nightly `{sweep: true}` payload), and call
   `registerSyncSchedules()` (`pipelines/sync/schedule.ts`) once at worker
   startup to register the two nightly repeatable jobs (03:10 / 03:40 UTC).
   Justification: worker/index.ts is A0-owned; A1 may not edit it.
   Workaround: skeleton no-ops keep running until wired.

3. **Add `"sync"` to `PIPELINE_KINDS` (frozen-layer change, Josh approval).**
   `pipeline_runs.kind` has no member for the §5.1 sync pipeline, so sync
   stage rows cannot be persisted to `pipeline_runs`; the channel-sync
   pipeline currently runs its stages through PipelineRunner with a per-run
   in-memory store (sequencing + 2× retries intact, no resume-across-enqueue
   — acceptable: sync is cheap and idempotent). One enum member + one
   migration makes sync runs observable like every other pipeline.

4. **Mount the OAuth channel-connect callback.** A1 may not add routes under
   `app/api`. The domain logic is ready: from the Google OAuth callback
   (incremental `youtube.readonly` consent), call `connectOauthChannel()`
   (`server/channel/oauth.ts`) with the plaintext refresh token — it
   encrypts (AES-256-GCM, `server/channel/crypto.ts`), stores, and queues the
   first sync + avatar generation. Please also add `CHANNEL_TOKEN_SECRET` to
   `.env.example`/config (falls back to `AUTH_SECRET` today) so token
   re-encryption isn't coupled to session-secret rotation.

5. **Credit charge for avatar regen (1 credit, spec §7).** The ledger is
   A0-owned billing domain. `avatar.regenerate` currently queues without
   charging; suggest the integrator wraps the handler with the ledger
   debit/refund helper once it exists.

6. **Dashboard `tracking` read path.** §5.12 stats land in `niche_videos`
   keyed by `youtube_video_id` (join `projects.published_video_id`) — that's
   where `dashboard.tracking`'s `actualViews`/`capturedAt`
   (`last_refreshed_at`) come from.

## To A2 (Script Engine)

7. **Avatar prompt location.** Spec §5 says prompts live in `prompts/*.ts`,
   which A2 owns. The avatar prompt is a versioned typed template at
   `pipelines/avatar/prompt.ts` (`AVATAR_PROMPT_VERSION = "avatar.v1"`); move
   or re-export under `prompts/` whenever convenient — no coupling either way.

8. **Fixture LLM and structured output.** `FixtureLlm` returns canned prose,
   never JSON, so any pipeline that Zod-parses LLM JSON fails in fixture
   mode. A1's avatar pipeline handles this with a deterministic schema-valid
   fallback (`deterministicAvatar`); if A0/A2 teach the fixture LLM to answer
   JSON-shaped prompts with JSON, the fallback becomes dead code and can go.
