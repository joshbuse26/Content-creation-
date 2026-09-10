# Open items — post-integration

Consolidated from REQUESTS-A1..A4 after the integration pass (2026-09-10).
Everything wired and verified is gone from this list; what follows is
deferred, cut, or knowingly imperfect.

## Deferred dependencies

- **`@dnd-kit/core` + `@dnd-kit/sortable`** — drag-handle section reorder in
  the editor. Button/keyboard reorder ships and now persists via
  `script.reorderSections`; dnd is polish.
- **`pdf-parse` (or `unpdf`)** — PDF research uploads. `research.upload`
  takes parsed text, so PDF needs a server-side multipart upload route +
  extraction. `.txt`/`.md` work end-to-end today; the research screen
  explains the limitation.

## Cut features (fixture-stub routers, schema already in place)

- **ideas** — outlier index (§5.3) + daily idea feed (§5.4). Router serves
  fixtures; `daily-ideas`/`outlier-refresh` jobs are acknowledged no-ops in
  the worker.
- **thumbnails** — image generation (§5.10). Text-only thumbnail _briefs_
  ship in packaging (A4); the thumbnails router itself is a stub. No
  ImageProvider usage anywhere.
- **templates** — description templates CRUD is stubbed; `{{slot}}` filling
  logic itself is live in the packaging pipeline.
- **apiKeys + `/api/mcp`** — MCP surface (§6) is v1.1; contracts frozen,
  router stubbed.
- **billing.checkout / billing.portal** — need live Stripe products +
  webhook. `billing.summary` reads the real workspace + credit ledger when a
  DB is configured. Webhook handler (upgrade/downgrade/failed payment) not
  built.
- **`/tools/*` free pages** — not built (the `freeTools` rate-limit policy
  exists and waits for them).
- **PostHog** — key slot in config, nothing instrumented.

## Known-imperfect (accepted for v1)

- **Quality reports + hook candidates are process-local caches.** No table
  in the frozen schema; `script.get` recomputes quality reports for final
  scripts (pure code) but returns `hookCandidates: null` after a web-process
  restart — the editor then falls back to its localStorage bridge
  (`components/editor/hook-store.ts`), which is why that bridge was kept.
  A `jsonb` column on scripts would fix both; not worth a schema change
  tonight.
- **`jobAccepted.pipelineRunIds` is an opaque dispatch token** (runs are
  created after the mutation returns). Dashboards query runs by
  `project_id` + `kind` instead. Proper fix: `run_group_id` column on
  pipeline_runs (frozen-layer change).
- **research/frame/titles pipeline runs record under kind `script`** — the
  frozen `pipeline_kind` enum has no members for them (stage names keep runs
  unambiguous). `sync` was added (approved); the other three were not needed
  for observability tonight.
- **Avatar regen does not charge its 1 credit** (spec §7). Script (6),
  revision (2), research (1) and titles (1) all charge via the ledger; the
  avatar pipeline predates the ledger helper. Wrap
  `avatarHandlers.regenerate` with a debit/refund when touching billing
  next.
- **FixtureLlm returns prose, never JSON** — A1's avatar pipeline keeps its
  deterministic schema-valid fallback (`deterministicAvatar`). If the
  fixture LLM learns to answer JSON-shaped prompts, that fallback becomes
  dead code.
- **Avatar prompt lives at `pipelines/avatar/prompt.ts`**, not `prompts/*`
  (spec §5 letter). Versioned + typed either way; move when convenient.
- **`/channels` does not yet surface the `connectError` query flag** set by
  the OAuth callback redirect (one banner to add in
  `components/channels/*`).
- **Dashboard `tracking.actualViews` stays null** until the §5.12 read path
  (niche_videos ↔ projects.published_video_id join) is wired into
  `dashboardHandlers.tracking`; the nightly tracking sweep itself runs (A1).

## Ops / launch checklist

- Google OAuth app verification (2–4 weeks lead) before public launch;
  until then run in testing mode with allowlisted accounts.
- Set `CHANNEL_TOKEN_SECRET` in production so refresh-token encryption is
  decoupled from `AUTH_SECRET` rotation (falls back to AUTH_SECRET today).
- YouTube quota increase application at launch (spec §8).
- Sentry: set `SENTRY_DSN` and the reporter goes live (web via
  `instrumentation.ts`, worker at startup) — no code change needed.
