# Gin Rummy

AI scriptwriting for YouTube creators — research, frame, script, revise, and package, end-to-end.

This is the integrated build from the 6-day sprint plus the v1.1 sprint: the Day-1 frozen skeleton
(schema, contracts, authz, providers, queues), the four wave-2 tracks — channel connect + audience
avatars (A1), the research → frame → script → revision → titles engine with SSE streaming (A2), the
full frontend (A3), packaging + exports + rate limiting + ops (A4) — and the four v1.1 tracks:
outlier index + daily idea feed (B1), the MCP server at `/api/mcp` with owner-managed API keys
(B2), live Stripe billing with tier limits and metered overage (B3), and thumbnail image
generation + description templates + free marketing tools at `/tools` (B4).

## Stack

Next.js 15 (App Router) · TypeScript strict · Postgres 16 + Drizzle · tRPC v11 + Zod v4 ·
Auth.js v5 · BullMQ + Redis · Tailwind v4 · Vitest · pnpm · Node 22.

## Quick start (zero keys required)

```bash
pnpm install
pnpm dev            # http://localhost:3000 — runs entirely on fixture data
```

`PROVIDERS=fixture` is the default: every external API (Anthropic, YouTube, transcripts, search,
image gen) is served by deterministic fixture providers, and API routes synthesize a session for
the fixture user — the whole product (connect a channel, research, generate a streamed script,
revise, package, export) works with no secrets, no network, reproducible outputs.

With a local Postgres + Redis:

```bash
cp .env.example .env       # fill DATABASE_URL, REDIS_URL, AUTH_SECRET
pnpm db:migrate            # applies db/migrations
pnpm seed                  # optional: idempotent demo dataset (fixture ids, real rows)
pnpm dev                   # web
pnpm worker                # queue worker (separate terminal)
```

**Magic-link sign-in in dev:** with no `RESEND_API_KEY`, the sign-in link is printed to the
server console (`DEV magic link`). Google sign-in activates automatically when
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set; the YouTube channel-connect flow
(`/api/channels/oauth/start`) uses the same client with incremental `youtube.readonly` consent.

## Commands

| Command                                                            | What                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                           | Next.js                                                                 |
| `pnpm worker`                                                      | BullMQ worker (needs `REDIS_URL`)                                       |
| `pnpm seed`                                                        | idempotent demo seed (needs `DATABASE_URL`)                             |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format:check` | CI gate, all must be green                                              |
| `pnpm exec tsx scripts/golden-run.ts`                              | golden-set script generation + scoring sheet (fixture or live)          |
| `pnpm db:generate`                                                 | regenerate migrations after editing `db/schema.ts` (frozen — see below) |
| `pnpm db:migrate`                                                  | apply migrations                                                        |

## Environment

All env vars are listed in `.env.example` (names only). Parsing is Zod-validated and fail-fast in
`lib/config.ts`:

- `PROVIDERS=fixture` (default) — zero keys needed anywhere.
- `PROVIDERS=live` — config **throws at startup** unless `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
  `TRANSCRIPT_API_KEY`, `SEARCH_API_KEY`, `IMAGE_API_KEY` are set.
- Production requires `AUTH_SECRET` (build phase exempt so `next build` compiles without secrets).
- `CHANNEL_TOKEN_SECRET` encrypts stored YouTube refresh tokens (AES-256-GCM); falls back to
  `AUTH_SECRET` — set it in production so token re-encryption is decoupled from session-secret
  rotation.
- `SENTRY_DSN` turns on error reporting (web via `instrumentation.ts`, worker at startup);
  without it the reporter is a typed no-op.

Branding: `PRODUCT_NAME` in `lib/branding.ts` is the single product-name constant. Never hardcode
"Gin Rummy" anywhere else.

## The frozen layer (do not edit without approval)

Per sprint plan §2 these files are frozen; changes go through Josh. Three were approved during
v1 integration: `"sync"` added to `PIPELINE_KINDS` (sync stages now persist to pipeline_runs),
`script.reorderSections` added, and `hookCandidates` added to `script.get` output. Two more in the
v1.1 integration pass: `"overage"` added to `CREDIT_REASONS` (migration 0004 — first-class ledger
reason for metered overage grants) and `CREDIT_COSTS.ideaBatch = 1` in `server/credits.ts`.
B3's approved narrow-class migration 0003 added nullable Stripe billing columns on `workspaces`
plus the `stripe_events` webhook-idempotency table.

- `db/schema.ts` (+ `db/migrations/*`)
- `lib/types/ids.ts` — branded ID types
- `lib/types/enums.ts` — shared enums (feed both Zod and pgEnum)
- `lib/types/entities.ts` — entity schemas
- `lib/types/pipeline.ts` — pipeline stage names + stage input/output schemas
- `lib/types/api.ts` — router input/output schemas
- `server/routers/_contracts.ts` — tRPC router signatures (bodies delegate to `impl/*`)
- `lib/providers/types.ts` — provider interfaces
- `queue/queues.ts` — queue/job names

## Architecture map

```
app/
  (marketing)/ (app)/ (onboarding)/   pages — landing, login, projects, editor, settings
  api/auth/[...nextauth]              Auth.js handlers
  api/trpc/[trpc]                     tRPC endpoint (fixture-session fallback in fixture mode)
  api/script-stream                   SSE: script pipeline events, full replay on reconnect
  api/channels/oauth/{start,callback} YouTube connect (incremental consent → connectOauthChannel)
  api/mcp                             MCP server (streamable HTTP, API-key auth, 8 tools)
  api/stripe/{webhook,billing-status} Stripe webhook + extended billing status
  api/tools                           free-tools endpoint (no auth, per-IP limited)
  api/thumbnail-image                 stored thumbnail bytes (session + row-level authz)
  api/health                          deploy healthcheck
components/                           frontend (A3): shell, projects, editor, generation,
                                      channels, packaging, settings, ui kit
server/
  auth.ts / session.ts                Auth.js config; fixture-session synthesis for API routes
  membership.ts                       session → workspace role resolution (db + fixture store)
  trpc.ts                             context, error shaping, workspaceProcedure (authz)
  routers/_contracts.ts               frozen signatures; bodies wired to routers/impl/*
  routers/impl/                       real handlers: channel, avatar, research, frame, script,
                                      revision, titles, description, tags, chapters, dashboard,
                                      workspace, project, billing, ideas, apiKeys, thumbnails,
                                      templates
  billing/                            B3: tiers/limits, Stripe checkout/portal, webhook handlers,
                                      overage metering (requireCreditsWithOverage)
  mcp/                                B2: API keys (hashed, show-once), JSON-RPC protocol, tools
  storage/                            B4: object storage (memory / S3 behind injectable client)
  tools/                              B4: free-tool definitions + fast-tier runner
  channel/                            A1 domain: repos, crypto (token encryption), oauth, jobs
  workspace/                          workspace/membership store (fixture-mode fallback)
  export/                             canonical script exports: txt / md / docx / teleprompter
  ratelimit/                          sliding-window limiter (Redis or in-memory), tRPC middleware
  ops/                                sentry, health/readiness, structured logging, credit
                                      reconciliation
pipelines/
  sync/                               §5.1/§5.12: channel sync, nightly sweeps, quota breaker
  avatar/                             §5.2: audience avatar generation
  ideation/                           §5.3/§5.4: outlier index + daily idea feed (B1)
  script/                             §5.7: 7-stage script engine, SSE events, engine store
  research/ revision/                 §5.5 / §5.8
  packaging/                          §5.11: descriptions, tags, chapters, thumbnail briefs
  thumbnails/                         §5.10: thumbnail image generation (B4)
prompts/                              versioned prompt templates (PROMPT_VERSION in input hashes)
queue/                                BullMQ queues (script/sync/packaging) + PipelineRunner
worker/index.ts                       worker entrypoint: all queues wired, nightly schedules
db/                                   Drizzle schema + migrations           [FROZEN]
lib/                                  config, authz, branded types, fixtures, providers, cache
scripts/                              seed.ts (demo data) · golden-run.ts (quality eval)
tests/                                498 tests: authz/tenancy, pipelines, exports, rate limits,
                                      ideation, MCP, billing/webhooks, thumbnails, free tools…
```

## Authorization

Every workspace-scoped procedure is built with `workspaceProcedure(resource, action)` which calls
`assertAccess(userId, workspaceId, resource, action)` **before** the handler runs, and every repo
method additionally filters on the denormalized `workspace_id`. Role matrix: viewer = read ·
writer = +create/edit content · admin = +channels/members/templates · owner = +billing/API keys.
Non-membership and missing-permission produce identical FORBIDDEN errors. Tenancy is tested
through the real middleware in `tests/trpc-authz.test.ts`.

## Rate limits

`server/ratelimit` — sliding window, Redis-backed when `REDIS_URL` is set (per-process memory
otherwise), fail-open on store errors. Every tRPC procedure carries the `general` policy
(100/min/user); generation endpoints (script/revision/research/frames/titles/description/tags/
avatar-regen/thumbnails/idea-batch) also carry `generation` (10/min). An `auth` and `freeTools`
policy exist for route handlers.

## Pipelines & worker

Stages are named in `lib/types/pipeline.ts`. The `PipelineRunner` persists one `pipeline_runs`
row per stage, retries each stage 2× with backoff, and resumes from the failed stage on
re-enqueue. Queues: `script` (generate/revision/research/frames), `sync` (channel sync, avatar,
post-publish tracking, credit reconciliation), `packaging` (titles/description/tags/chapters).
Nightly repeatable jobs are registered in code at worker startup (spec §2.8): channel-sync sweep
03:10 UTC, post-publish tracking 03:40 UTC, credit-ledger reconciliation 03:00 UTC, outlier-index
refresh 04:10 UTC, daily idea feed 06:00 America/New_York.

Script generation streams over SSE (`/api/script-stream?workspaceId&scriptId`) with the frozen
`ScriptStreamEvent` union — full history replay on (re)connect, heartbeats every 15s.

## Deploy (Railway)

Two services from this one repo, plus managed Postgres and Redis, private networking:

1. Create a Railway project; add **Postgres** and **Redis**.
2. **web** service → this repo. Settings → Config file path: `railway.web.json`.
   Public domain on; healthcheck is `/api/health`.
3. **worker** service → same repo. Config file path: `railway.worker.json`. No public domain.
4. Set service variables on both (see `.env.example`): `DATABASE_URL` and `REDIS_URL` from the
   managed services (private URLs), `AUTH_SECRET`, `CHANNEL_TOKEN_SECRET`, `APP_URL`,
   `PROVIDERS=live` + provider keys, `SENTRY_DSN`. Staging = separate Railway environment.
5. Run migrations: `railway run pnpm db:migrate` (or a pre-deploy command on the web service).

Cron is BullMQ repeatable jobs registered by the worker — never platform cron (spec §2.8).

## Pushing this repo to GitHub

```bash
git remote add origin git@github.com:<org>/gin-rummy.git
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests, build and
`pnpm audit --audit-level=high` on every push/PR. Keep it green — no red code handed off.

## Verification status (v1.1 integration handoff)

`pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm format:check` ✓ · `pnpm test` ✓ (498 tests) ·
`pnpm build` ✓ · `pnpm audit --audit-level=high` ✓ · fixture-mode boot smoke ✓ (marketing +
app pages incl. /ideas, /tools, /settings/api-keys; MCP `tools/list` with the fixture key;
free-tool POST returns results).

Remaining scope is tracked in `OPEN-ITEMS.md`; integration decisions in `DECISIONS.md`.
