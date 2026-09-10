# Requests from A4 (Packaging + Hardening) → A0 / other agents

A4 cannot edit `package.json`, frozen contracts, `worker/index.ts`, or `app/**`.
Everything below is copy-paste-ready for the owner of those files.

## 1. package.json (A0)

- **Add dependency: `@sentry/node`** (latest v8). `server/ops/sentry.ts` is already
  env-gated and loads it via dynamic import — it becomes live the moment the dep +
  `SENTRY_DSN` exist; until then it is a typed no-op with a startup warning. No other
  code change needed.
- **Add script target:**
  ```json
  "seed": "node --import tsx scripts/seed.ts"
  ```
  (`scripts/seed.ts` is idempotent; requires `DATABASE_URL`.)

## 2. Wire impl handlers into `server/routers/_contracts.ts` (A0 — stub-body swap only)

Handlers are exported keyed by procedure name and match the frozen schemas exactly:

| Router      | Import                                                                    | Procedures               |
| ----------- | ------------------------------------------------------------------------- | ------------------------ |
| description | `import { descriptionHandlers } from "@/server/routers/impl/description"` | generate, list, update   |
| tags        | `import { tagsHandlers } from "@/server/routers/impl/tags"`               | generate, latest, update |
| chapters    | `import { chaptersHandlers } from "@/server/routers/impl/chapters"`       | derive, latest, update   |
| dashboard   | `import { dashboardHandlers } from "@/server/routers/impl/dashboard"`     | overview, tracking       |

Body swap pattern (signatures unchanged):
`.mutation(({ ctx, input }) => descriptionHandlers.generate({ ctx, input }))`

Also available for the script router's `export` procedure (A2/A0):
`exportScript(input, format)` from `@/server/export` returns the exact
`scriptContracts.export` output shape.

## 3. worker/index.ts (A0) — packaging queue

Replace the skeleton no-op cases with:

```ts
import { handlePackagingJob } from "@/pipelines/packaging";
// in the packaging Worker switch:
case JOB_NAMES.description:
case JOB_NAMES.tags:
case JOB_NAMES.chapters:
  await handlePackagingJob(job.name, job.data);
  return;
```

Job payload: `packagingJobInputSchema` = `{ workspaceId, projectId, mode?, templateId? }`.

Nightly credit reconciliation (BullMQ repeatable job, schedules-in-code per spec §2.8):
call `runCreditReconciliation()` from `@/server/ops` on a `0 3 * * *` repeatable job
(any queue; suggest `sync`). It logs drift at error level and returns a report.

## 4. Rate-limit attachment points (A0/A2)

From `@/server/ratelimit`:

- tRPC: `.use(rateLimitMiddleware("general"))` on standard procedures,
  `.use(rateLimitMiddleware("generation"))` on `script.generate`, `revision.run`,
  `research.search`, `frame.propose`, `titles.generate`, `thumbnails.generate`,
  `description.generate`, `tags.generate`, `avatar.regenerate`, `ideas.requestBatch`.
- Auth route handlers: `enforceRateLimit("auth", ip)` (throws TRPCError) or
  `checkRateLimit` + `rateLimitHeaders(decision)` for a plain 429 response.
- Future `/tools/*`: `checkRateLimit("freeTools", ip)` — 5/day per IP.

Redis-backed when `REDIS_URL` is set; per-process in-memory fallback otherwise
(logged). Store failures fail open by design.

## 5. Health endpoints (A0/A3)

`healthCheck()` and `checkReadiness()` from `@/server/ops` are ready for
`/api/health` (already exists) and an `/api/ready` route if wanted — readiness pings
DB + Redis only when configured, so fixture mode stays green.

## 6. Sentry init call site (A0)

Call `await initErrorReporting()` once at worker startup and in the web
instrumentation hook; use `getErrorReporter().captureException(err, {...})` in the
tRPC error formatter and worker `failed` handlers. No-op without `SENTRY_DSN`.
