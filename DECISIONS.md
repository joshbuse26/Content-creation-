# Decisions log — Gin Rummy

Format: date · decision · rationale. A0 (Foundation/Integrator), Day 1.

## 2026-09-10 — Day-1 skeleton

**Product name is a constant.** `PRODUCT_NAME = "Gin Rummy"` in `lib/branding.ts`; imported
everywhere branding appears (layout metadata, emails, config errors). Working name may change;
rename must be a one-line diff.

**Zod v4.** Installed zod 4 (current stable). Notable API surface used: `z.uuid()`, `z.email()`,
`z.url()`, `z.iso.date()`, `z.partialRecord()`, `z.treeifyError()`. Wave-2: don't use zod-v3-isms
(`.string().uuid()`, `.flatten()`).

**Branded IDs via `z.brand()`.** `lib/types/ids.ts` brands every entity's UUID at the type level;
schemas are the only constructor. Prevents cross-entity ID mixups at compile time with zero
runtime cost beyond the parse we already do.

**Enums defined once.** `lib/types/enums.ts` arrays feed both the Zod schemas and the Drizzle
`pgEnum`s, so DB and API can't drift.

**Full schema now, including cut features** (niche_videos, ideas, thumbnails, templates,
api_keys, tracking columns) per sprint plan Day 1 — schema changes later are the expensive kind.
Auth.js tables (accounts/sessions/verification_tokens) added to the spec §3 set because the
Drizzle adapter needs them.

**workspace_id denormalized on every tenant row** (spec §3 convention) so row-level authz checks
never require joins. `niche_videos` is deliberately global (the outlier index is shared across
workspaces in a niche — spec §8 key design point).

**Licensed-voice constraint is a DB CHECK**, not just app logic: `source='licensed'` requires
both license fields non-null. The similarity guard itself is v1.1; the schema constraint ships
now so no licensed voice row can ever exist without a license doc.

**Authz: single `assertAccess` with injectable role resolver.** Production resolver queries
`memberships`; fixture/test resolver is pure. Enforced in tRPC middleware via
`workspaceProcedure(resource, action)` — a procedure that skips it doesn't parse `workspaceId`
at all, making "forgot the check" structurally hard. Non-member and no-permission return
identical FORBIDDEN (tenancy not probeable). Billing reads restricted to admin+; API keys owner-only.

**Contracts as data.** Router IO schemas live in `lib/types/api.ts` as `{input, output}` pairs;
`_contracts.ts` wires them with `.input().output()` so stub outputs are runtime-validated against
the frozen contracts. Fixtures are also parsed through entity schemas at import — contract drift
fails the test suite immediately, not at integration time.

**Fixture mode is first-class** (`PROVIDERS=fixture`, the default). All five provider interfaces
have deterministic implementations seeded by FNV-1a of the input. The app boots, renders, and
serves every router with ZERO env vars. Live SDKs are lazily imported so fixture mode never
evaluates them.

**Model pins** (spec §2.2): `claude-sonnet-5` (outline/draft/retention/voice/revision),
`claude-haiku-4-5-20251001` (fact-check/scoring/tags/classification) in `lib/config.ts
LLM_MODELS`. Never Opus-class models in the runtime.

**Config fail-fast with two deliberate exemptions:** (1) `next build` runs with
NODE_ENV=production but must compile without secrets → AUTH_SECRET check skips when
`NEXT_PHASE=phase-production-build`; (2) DATABASE_URL/REDIS_URL are optional at parse time and
enforced at first use (`getDb()`/`getRedisConnection()` throw), because fixture-mode web needs
neither.

**Pipeline runner is queue-agnostic.** BullMQ delivers jobs; `PipelineRunner` owns stage
sequencing, `pipeline_runs` persistence, resume-from-failed-stage (done stages keyed by
`input_hash` are skipped) and per-stage 2× retry with exponential backoff. BullMQ job-level
`attempts: 2` is a safety net for infra failures only. Store is injectable: Drizzle in prod,
in-memory in tests — so resumability is tested without Postgres.

**Three queues** (`script`, `sync`, `packaging`) so long script runs can't starve syncs or
packaging. Names frozen in `queue/queues.ts` alongside job names.

**BullMQ not exercised against ioredis-mock.** BullMQ leans on Lua/streams that ioredis-mock
fakes unreliably; testing the runner directly + a real `lib/cache.ts` test against ioredis-mock
gives coverage without flaky green. Queue integration is exercised on staging Redis.

**Auth.js v5 with database sessions** when a DB is configured (magic-link requires it), JWT
fallback otherwise so the app still boots keyless. Dev magic-link transport logs the URL instead
of sending mail; Resend used automatically when `RESEND_API_KEY` is set. Google provider
registers only when its keys exist. `youtube.readonly` scope is NOT requested at sign-in — the
channel-connect flow (A1) requests incremental consent later.

**ESLint: typescript-eslint `strictTypeChecked`** across the repo, `@next/eslint-plugin-next` on
`app/`. Two rule tunings (config, not suppressions): template literals may embed numbers/booleans;
unused vars must be `_`-prefixed. Zero `eslint-disable` comments in the codebase; keep it that way.

**Toolchain pins:** TypeScript 5.9 and ESLint 9 (registry latest resolved to TS 7 / ESLint 10,
which typescript-eslint 8 and Next 15 don't support). Vitest uses `@vitejs/plugin-react` because
tsconfig `jsx: preserve` (required by Next) isn't transformed by Vite 8 itself.

**postcss override** (`pnpm.overrides`) to `>=8.5.18`: Next 15 pins a postcss with two high-severity
advisories; the override clears `pnpm audit --audit-level=high` in CI.

**Railway config-as-code:** two config files (`railway.web.json`, `railway.worker.json`) from one
repo; each service points at its file via "Config file path". Healthcheck `/api/health` on web
only; worker exits non-zero without REDIS_URL so Railway restarts/flags it rather than running dark.

**Sentry/PostHog not wired yet** — A4 owns observability (sprint §2); DSN/key slots exist in
config so wiring is additive.
