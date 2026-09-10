# Gin Rummy

AI scriptwriting for YouTube creators — research, frame, script, revise, and package, end-to-end.

This repo is the **Day-1 skeleton** from the 6-day sprint plan: full schema, frozen contracts,
authz, auth, providers, queue wiring, CI and deploy config. Wave-2 agents (A1–A4) build on top of
it without changing the frozen layer.

## Stack

Next.js 15 (App Router) · TypeScript strict · Postgres 16 + Drizzle · tRPC v11 + Zod v4 ·
Auth.js v5 · BullMQ + Redis · Tailwind v4 · Vitest · pnpm · Node 22.

## Quick start (zero keys required)

```bash
pnpm install
pnpm dev            # http://localhost:3000 — runs entirely on fixture data
```

`PROVIDERS=fixture` is the default: every external API (Anthropic, YouTube, transcripts, search,
image gen) is served by deterministic fixture providers. No secrets, no network, reproducible
outputs.

With a local Postgres + Redis:

```bash
cp .env.example .env       # fill DATABASE_URL, REDIS_URL, AUTH_SECRET
pnpm db:migrate            # applies db/migrations
pnpm dev                   # web
pnpm worker                # queue worker (separate terminal)
```

**Magic-link sign-in in dev:** with no `RESEND_API_KEY`, the sign-in link is printed to the
server console (`DEV magic link`). Google sign-in activates automatically when
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.

## Commands

| Command                                                            | What                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                           | Next.js                                                                 |
| `pnpm worker`                                                      | BullMQ worker (needs `REDIS_URL`)                                       |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format:check` | CI gate, all must be green                                              |
| `pnpm db:generate`                                                 | regenerate migrations after editing `db/schema.ts` (frozen — see below) |
| `pnpm db:migrate`                                                  | apply migrations                                                        |

## Environment

All env vars are listed in `.env.example` (names only). Parsing is Zod-validated and fail-fast in
`lib/config.ts`:

- `PROVIDERS=fixture` (default) — zero keys needed anywhere.
- `PROVIDERS=live` — config **throws at startup** unless `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
  `TRANSCRIPT_API_KEY`, `SEARCH_API_KEY`, `IMAGE_API_KEY` are set.
- Production requires `AUTH_SECRET` (build phase exempt so `next build` compiles without secrets).

Branding: `PRODUCT_NAME` in `lib/branding.ts` is the single product-name constant. Never hardcode
"Gin Rummy" anywhere else.

## The frozen layer (do not edit without approval)

Per sprint plan §2, these files freeze at the end of Day 1. Changes go through Josh, are announced
to all agents, and should total ~3 for the sprint:

- `db/schema.ts` (+ `db/migrations/*`)
- `lib/types/ids.ts` — branded ID types
- `lib/types/enums.ts` — shared enums (feed both Zod and pgEnum)
- `lib/types/entities.ts` — entity schemas
- `lib/types/pipeline.ts` — pipeline stage names + stage input/output schemas
- `lib/types/api.ts` — router input/output schemas
- `server/routers/_contracts.ts` — tRPC router signatures (replace stub **bodies** only)
- `lib/providers/types.ts` — provider interfaces
- `queue/queues.ts` — queue/job names

Everything else is agent-owned per the sprint plan ownership table.

## Architecture map

```
app/                    Next.js App Router (A3 owns app/(app)/*)
  api/auth/[...nextauth] Auth.js handlers
  api/trpc/[trpc]        tRPC endpoint
  api/health             deploy healthcheck
server/
  auth.ts               Auth.js config (magic link + Google)
  membership.ts         session → workspace role resolution (db + fixture)
  trpc.ts               context, error shaping, workspaceProcedure (authz middleware)
  routers/_contracts.ts 18 routers, stubs returning fixtures  [FROZEN signatures]
db/                     Drizzle schema + migrations           [FROZEN]
lib/
  branding.ts           PRODUCT_NAME
  config.ts             Zod env config, fail-fast; LLM model pins
  authz.ts              assertAccess + role matrix (owner/admin/writer/viewer)
  types/                the frozen Zod layer
  fixtures/             deterministic fixtures (schema-validated at import)
  providers/            LlmProvider, YoutubeProvider, TranscriptProvider,
                        SearchProvider, ImageProvider — live/ + fixture impls
  cache.ts              Redis JSON cache (YouTube quota cache, rate limits)
queue/
  connection.ts, queues.ts   BullMQ queues: script, sync, packaging
  pipeline-runner.ts         stage executor: pipeline_runs rows, resume, 2× retry
  store.ts                   Drizzle-backed run store
worker/index.ts         worker entrypoint (Railway `worker` service)
prompts/                A2 owns — versioned prompt template functions
tests/                  authz, tenancy-through-middleware, pipeline, providers, config
```

## Authorization

Every workspace-scoped procedure is built with `workspaceProcedure(resource, action)` which calls
`assertAccess(userId, workspaceId, resource, action)` **before** the handler runs. Role matrix:
viewer = read · writer = +create/edit content · admin = +channels/members/templates · owner =
+billing/API keys. Non-membership and missing-permission produce identical FORBIDDEN errors.
Tenancy is tested through the real middleware in `tests/trpc-authz.test.ts`.

## Pipelines

Stages are named in `lib/types/pipeline.ts` (e.g. the 7 script stages). The `PipelineRunner`
persists one `pipeline_runs` row per stage, retries each stage 2× with exponential backoff, and on
re-enqueue **resumes from the failed stage** (done stages with the same input hash are skipped).
Queue names are frozen: `script`, `sync`, `packaging`.

## Deploy (Railway)

Two services from this one repo, plus managed Postgres and Redis, private networking:

1. Create a Railway project; add **Postgres** and **Redis**.
2. **web** service → this repo. Settings → Config file path: `railway.web.json`.
   Public domain on; healthcheck is `/api/health`.
3. **worker** service → same repo. Config file path: `railway.worker.json`. No public domain.
4. Set service variables on both (see `.env.example`): `DATABASE_URL` and `REDIS_URL` from the
   managed services (private URLs), `AUTH_SECRET`, `APP_URL`, `PROVIDERS=live` + provider keys
   when going live. Staging = separate Railway environment in the same project.
5. Run migrations: `railway run pnpm db:migrate` (or a pre-deploy command on the web service).

Cron (nightly syncs, daily ideas) will be BullMQ repeatable jobs in the worker — never platform
cron (spec §2.8).

## Pushing this repo to GitHub

```bash
git remote add origin git@github.com:<org>/gin-rummy.git
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests, build and
`pnpm audit --audit-level=high` on every push/PR. Keep it green — no red code handed off.

## Verification status (Day-1 handoff)

`pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ (44 tests) · `pnpm build` ✓ ·
`pnpm audit --audit-level=high` ✓
