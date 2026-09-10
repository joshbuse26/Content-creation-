# Open items — post-v1.1-integration

Consolidated from REQUESTS-A1..A4 (v1 pass) and REQUESTS-B1..B4 (v1.1 pass,
2026-09-10). Everything wired and verified is gone from this list; what
follows is deferred, cut, or knowingly imperfect.

## Deferred dependencies

- **`@modelcontextprotocol/sdk`** — the official MCP server SDK. `/api/mcp`
  ships on a hand-rolled streamable-HTTP JSON-RPC layer (protocol revision
  2025-06-18, single messages, no SSE/sessions/resources). The protocol
  surface is isolated in `server/mcp/protocol.ts` + `app/api/mcp/route.ts`;
  swapping the SDK in later replaces only those two files — `tools.ts`,
  `auth.ts`, `keys.ts` are transport-agnostic.
- **`@dnd-kit/core` + `@dnd-kit/sortable`** — drag-handle section reorder in
  the editor. Button/keyboard reorder ships and persists via
  `script.reorderSections`; dnd is polish.
- **`pdf-parse` (or `unpdf`)** — PDF research uploads. `research.upload`
  takes parsed text, so PDF needs a server-side multipart upload route +
  extraction. `.txt`/`.md` work end-to-end today; the research screen
  explains the limitation.

## Deferred features / follow-up slices

- **Face-photo thumbnails** (spec §5.10 "or uploads own face photo") — the
  frozen `thumbnails.generate` contract has no face field; the pipeline
  already accepts `faceImageKey` (frozen job input) but the router always
  passes null. Needs a frozen-contract addition + an upload route when
  scheduled.
- **Embedding dedup for ideas** (spec §5.4 wants embedding cosine > 0.85) —
  no embedding provider in the frozen provider set, so dedup ships as
  deterministic trigram Jaccard on normalized titles (>= 0.6 = dup,
  `pipelines/ideation/similarity.ts`). Swap-in point: `isDuplicateTitle`
  inside the `dedup_ideas` stage; `VOYAGE_API_KEY` slot already exists.
- **Multi-voice + licensed-voice similarity guard** — still pending from the
  v1 backlog. The DB CHECK (licensed voices require license fields) ships;
  the similarity guard and multi-voice profile UI do not.
- **Dashboard `tracking.actualViews` stays null** until the §5.12 read path
  (niche_videos ↔ projects.published_video_id join) is wired into
  `dashboardHandlers.tracking`; the nightly tracking sweep itself runs.
- **PostHog** — key slot in config, nothing instrumented. Free-tool email
  capture (client-side gate in `components/tools/gate.ts`) is stored
  locally and not sent anywhere — wire to PostHog/Resend audience when
  analytics lands.
- **`app/sitemap.ts`** — not built; when added, include `/tools` and the
  four generator pages (each already exports canonical + OG metadata).

## Frozen-layer requests not (yet) made

- **`billing.summary` output extension** — read-only state, grace clock,
  pending plan, period end and overage usage cannot ride the frozen summary
  contract; they are served by `GET /api/stripe/billing-status` (session +
  `billing:read` authz). Folding them into the tRPC summary later is an
  additive output change.
- **Per-call MCP audit rows** — "every call writes credit_ledger" (spec §6)
  is implemented as: every credit-charging call writes the ledger (via the
  shared pipelines, idempotency-keyed). Zero-cost reads write no rows. If
  per-call audit rows are genuinely wanted, that needs an mcp_calls table.
- **Nullable `pipeline_runs.workspace_id` (or a sentinel workspace)** —
  global outlier-refresh runs can't persist (NOT NULL FK), so they use an
  in-memory run store for sequencing/retry only (same precedent as the
  pre-approval sync pipeline). Workspace-scoped daily-ideas runs DO persist
  under kind `"ideas"`.
- **`run_group_id` on pipeline_runs** — `jobAccepted.pipelineRunIds` is an
  opaque dispatch token (runs are created after the mutation returns);
  dashboards query runs by `project_id` + `kind` instead.
- **research/frame/titles pipeline runs record under kind `script`** — the
  frozen `pipeline_kind` enum has no members for them (stage names keep runs
  unambiguous).

## Known-imperfect (accepted)

- **Read-only lockdown covers generation dispatch only** — the 7-day
  post-payment-failure lockdown lives in `requireCreditsWithOverage`, so it
  gates all generation. Blocking content _edits_ (sections, packaging, …)
  too would need a tRPC middleware in `server/trpc.ts` calling
  `isWorkspaceReadOnly`.
- **`THUMBNAIL_CREDIT_COST` lives in `pipelines/thumbnails/pipeline.ts`**
  (3 = 1/image), not in `CREDIT_COSTS` — fold in if one table is preferred
  (`ideaBatch` was folded during integration).
- **Quality reports + hook candidates are process-local caches.** No table
  in the frozen schema; `script.get` recomputes quality reports for final
  scripts (pure code) but returns `hookCandidates: null` after a web-process
  restart — the editor then falls back to its localStorage bridge
  (`components/editor/hook-store.ts`). A `jsonb` column on scripts would fix
  both.
- **Avatar regen does not charge its 1 credit** (spec §7). Script (6),
  revision (2), research (1), titles (1), idea batch (1) and thumbnails (3)
  all charge via the ledger; the avatar pipeline predates the ledger helper.
  Wrap `avatarHandlers.regenerate` with a debit/refund when next touched.
- **Prompts outside `prompts/*`** — the avatar prompt
  (`pipelines/avatar/prompt.ts`) and ideation prompts
  (`pipelines/ideation/prompts.ts`) live with their pipelines, not in the
  A2-owned `prompts/` dir (spec §5 letter). Versioned + typed either way;
  move when convenient.
- **FixtureLlm returns prose, never JSON** — A1's avatar pipeline keeps its
  deterministic schema-valid fallback (`deterministicAvatar`). If the
  fixture LLM learns to answer JSON-shaped prompts, that fallback becomes
  dead code.
- **Golden-output title truncation artifact** — fixture title seeds embed
  `projectTitle.slice(0, 40)` (`pipelines/script/fixture-content.ts`,
  `buildTitles`), which chops mid-word. Fixture-only cosmetic; live titles
  come from the LLM.
- **Free-tool email gate is a client-side honor system** per the sprint spec
  (localStorage counter); the server-side per-IP cap of 5/day is
  authoritative.

## Ops / launch checklist

- **Stripe dashboard setup** (before flipping live billing):
  products/prices per tier (Starter $49,
  Team $99, Agency $249 monthly) → `STRIPE_PRICE_*` env vars (price ids or
  lookup keys); a Billing **Meter** named `overage_credits` + metered
  $0.60/credit price on `STRIPE_PRICE_OVERAGE`; webhook endpoint →
  `POST /api/stripe/webhook` (`STRIPE_WEBHOOK_SECRET`) subscribed to
  `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- Google OAuth app verification (2–4 weeks lead) before public launch;
  until then run in testing mode with allowlisted accounts.
- Set `CHANNEL_TOKEN_SECRET` in production so refresh-token encryption is
  decoupled from `AUTH_SECRET` rotation (falls back to AUTH_SECRET today).
- YouTube quota increase application at launch (spec §8).
- Sentry: set `SENTRY_DSN` and the reporter goes live (web via
  `instrumentation.ts`, worker at startup) — no code change needed.
- S3-compatible bucket (Railway Storage Bucket / R2): set the `S3_*` quartet
  on BOTH web and worker — thumbnails persist to it now; without it the
  in-memory fallback logs a warning and images don't survive restarts.
