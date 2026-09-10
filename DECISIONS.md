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

## 2026-09-10 — Integration pass (A0)

**Merge order A1 → A2 → A3 → A4, no conflicts.** Disjoint ownership held; the one known overlap
(`tests/home-page.test.ts`, updated by A3) merged clean because main never touched it after
Day 1. Worktrees removed, track branches deleted.

**Three approved frozen-layer changes, nothing else.** (1) `"sync"` added to `PIPELINE_KINDS`
(+ migration `0001`) so channel-sync stages persist to pipeline_runs like every other pipeline.
(2) `script.reorderSections` procedure added — the editor's reorder now persists (A3 request).
(3) `hookCandidates` added to `script.get` output so the hook switcher reads server data. Hook
candidates (like quality reports) live in a process-local store cache — no table in the frozen
schema — so the output is nullable and the editor keeps its localStorage bridge as the
post-restart fallback.

**One export implementation.** A2 and A4 both built script exports; A4's pure
`server/export` (`exportScript`) is canonical — `scriptImpl.export` now delegates to it and
A2's inline docx/formatting code was deleted. Filenames are slugified titles (A4 behavior),
covered by snapshot tests.

**Rate limits attached in `_contracts.ts`, not in `trpc.ts`.** Every procedure chains
`.use(rateLimitMiddleware("general"))`; the eleven generation endpoints add the stricter
`generation` policy. Attaching per-procedure (a body-level concern, signatures untouched)
avoids a module cycle between `server/trpc.ts` and `server/ratelimit`.

**Fixture session is server-side now.** In fixture mode, API routes (tRPC + SSE + OAuth start)
synthesize a session for the fixture user (`server/session.ts`), so the browser exercises the
real HTTP → authz → handler path. A3's client-side UNAUTHORIZED-fallback link
(`fixture-link.ts`/`fixture-data.ts`) was deleted; boot smoke confirmed all screens work over
real tRPC.

**Fixture role resolution reads a shared in-memory workspace store.** `fixtureRoleResolver` now
consults `server/workspace/memory.ts` (seeded with exactly the fixture membership, so default
behavior is unchanged) — workspaces/members created at runtime in fixture mode are actually
reachable through the authz middleware instead of dead-on-arrival.

**Workspace/project handlers are real; project storage rides the EngineStore.** Projects
created via tRPC go into the same store A2's pipelines read (Drizzle or the shared in-memory
instance), so a fixture-mode project flows straight into research → script. `project.archive`
is a hard delete (no soft-delete in the frozen schema; children cascade). Member management
guards the last owner. `billing.summary` reads the real workspace + ledger when a DB exists.

**SSE aligned on `/api/script-stream`.** A2's route won (it already does auth + replay +
heartbeats); A3's consumer was updated (URL + workspaceId param + named-event listeners — the
route sets the SSE `event:` field, so `onmessage` alone would never fire). The stream now
flushes a `: connected` comment immediately so EventSource `onopen`/headers don't wait 15s for
the first heartbeat.

**Worker fully wired.** script queue → A2 job handlers; sync queue → A1 `processSyncQueueJob`;
packaging → A2 titles + A4 `handlePackagingJob`; `registerSyncSchedules()` at startup plus a
worker-local `credit-reconcile` repeatable job (03:00 UTC) — its name is deliberately NOT in the
frozen `JOB_NAMES` since it never leaves the worker process. `initErrorReporting()` runs at
worker startup and in the web via `instrumentation.ts`; worker `failed`/`error` handlers report
to Sentry when configured.

**OAuth channel connect mounted under `app/api/channels/oauth/`.** `start` builds the
incremental-consent URL (youtube.readonly, offline, HMAC-signed workspaceId state) and
`callback` exchanges the code, discovers the channel via `channels.list mine=true`, and hands
the plaintext refresh token to A1's `connectOauthChannel` (which encrypts and stores). 503 with
a clear message when Google OAuth isn't configured. `CHANNEL_TOKEN_SECRET` added to config +
`.env.example`.

**Dependencies added (only these):** `@sentry/node` (v8, matches A4's env-gated dynamic
import), `lucide-react` (requested by A3; icon swap itself deferred), and the `seed` script
(`tsx` was already present). `@dnd-kit/*` and `pdf-parse` deferred — see OPEN-ITEMS.md.

**One test intent updated.** `tests/trpc-authz.test.ts`'s stub-era spot check asserted the
fixture quality report; with the real handler wired, a `drafting` script correctly has no
quality report (computed for final scripts only) — the assertion now reflects that.

## 2026-09-10 — v1.1 integration pass (B1–B4)

**Merge order b1 → b2 → b3 → b4, all clean.** No track touched another's files;
`server/routers/_contracts.ts` was edited only by B4 (thumbnails/templates stub-body swap —
the established integration pattern, signatures untouched), so the "frozen file conflict"
risk never materialized. `components/settings` (b3 billing-panel vs b2 api-keys-panel) and
`components/packaging` (b4 only) stayed disjoint.

**Stub bodies swapped for B1/B2/B3 in `_contracts.ts`.** ideas (5 procedures) → `ideasHandlers`,
apiKeys (3) → `apiKeysImpl`, billing.checkout/portal → `billingHandlers` (which keep the exact
fixture URLs when `STRIPE_SECRET_KEY` is unset, so zero-key boots are unchanged). The now-unused
fixture imports and the local `queued` constant were removed.

**`requireCredits` → `requireCreditsWithOverage` at the five generation dispatch sites**
(script/revision/research/titles/avatar) — import-only swap; brings the 7-day read-only lockdown
and allow-and-meter overage (200-credit/cycle ceiling) to all generation. Per-dispatch
idempotency keys (recommended, optional) were NOT threaded through — the default random key is
safe (retries can re-meter, bounded by the ceiling); revisit if retry double-metering shows up.

**`"overage"` added to `CREDIT_REASONS`** (approved frozen-layer change; migration
`0004_fixed_metal_master.sql`, `ALTER TYPE … ADD VALUE`). B3's documented workaround (reason
`purchase` + `overage:` key prefix) was updated to write the first-class reason — the ripple was
one line in `server/billing/overage.ts` plus one test expectation. `CREDIT_COSTS.ideaBatch = 1`
also folded in; `pipelines/ideation`'s `IDEA_BATCH_CREDIT_COST` now aliases it.

**Tier limits enforced at the three insert points.** `connectPublic` and the OAuth callback check
`assertChannelLimit`/`checkChannelLimit` only for genuinely NEW channels, so idempotent
reconnects are never blocked; the callback redirects with a new `channel_limit` connectError flag
(human copy added to the channels screen) rather than surfacing a TRPCError in a redirect flow.
`invite` checks `assertSeatLimit` before the membership insert in both the fixture and db
branches; the plan comes from `getBillingStore().getWorkspace` (works in both modes).

**S3 wired via a shared `server/storage/register-s3.ts`.** Both processes (web
`instrumentation.ts`, worker startup) register the same `S3ClientLike` adapter built from
`@aws-sdk/client-s3` per the snippet in `server/storage/s3.ts`. Registration is unconditional
and lazy — no AWS client is constructed unless the `S3_*` quartet is set, so fixture boots stay
on memory storage. `@modelcontextprotocol/sdk` deliberately NOT added (hand-rolled protocol
stays; see OPEN-ITEMS.md).

**MCP `generate_thumbnail` dispatches to the real pipeline only when the deployment can persist
images** (`IMAGE_API_KEY` set AND `S3_*` configured); otherwise it keeps the zero-cost TEXT
BRIEF fallback. Fixture/keyless boots therefore still get the brief — deliberate: an MCP agent
should not spend 3 credits on images that die with the process, and the b2 contract tests keep
their meaning.

**Worker fully wired for v1.1.** sync queue `daily-ideas`/`outlier-refresh` → `processIdeationJob`
with `registerIdeationSchedules()` at startup (outlier refresh 04:10 UTC after the 03:10 sync
sweep; daily ideas 06:00 America/New_York); packaging queue `thumbnails` → `handleThumbnailsJob`.

**`STRIPE_PRICE_STARTER/TEAM/AGENCY/OVERAGE` added to the Zod env schema** (optional strings)
and `.env.example`; `server/billing/checkout.ts` still reads them via its `priceEnvValue`
accessor (`process.env`) — pointing it at `getConfig()` is a mechanical follow-up, left as-is to
keep the billing files untouched in this pass.

## 2026-09-10 — Wave C contracts pass (C0)

**Frozen layers extended, not forked.** C0 is the wave-C contracts agent; the changes below ARE
the approved frozen-layer deltas for the wave. Everything is additive except the StyleCard shape,
which the wave-0 product contracts explicitly promote.

**StyleCard v2 replaces the v1 blob** (`lib/types/entities.ts styleCardSchema`): structured
`voice{pov,diction,rhythm}`, `tone{register,never}`, `pacing{wpmTarget,sectionSeconds,
rehookSeconds}`, `hookPatterns[]` (frozen hook-technique enum + guidance, min 1),
`ctaHabits{placement,placementPct,phrasingStyle,maxPerVideo}`, `bannedClaims[]` (machine-checkable
enum `BANNED_CLAIM_TYPES`), `readingLevel{minGrade,maxGrade}`, `energy 1–5`, `exampleSnippets[]`
(≤4; `TODO(seed-copy)` placeholders allowed), `thumbnailPresetId` (nullable). One shape for
archetype and channel-learned cards; `voice_profiles.source` gained the value `"archetype"`.
Migration `0005` transforms legacy rows in SQL; `lib/style-card.ts` is the in-memory twin
(`upgradeLegacyStyleCard` / `parseStyleCard`) — keep the two mappings in sync. Catchphrases
migrate into `exampleSnippets` (they are the creator's own words); taboos into `tone.never`.

**Archetypes are a GLOBAL seeded table with slug PKs.** `archetypes` (id = one of the 12 frozen
`ARCHETYPE_IDS` slugs, not a uuid) carries display name, pitch, StyleCard, structured
`thumbnailPreset{compositionPatternId (from the existing 20-pattern library), maxOverlayWords,
contrastRule, face, paletteTemperature}`, sort. `lib/archetypes.ts` is the single source of truth:
`scripts/seed.ts` UPSERTS it (so card refinements reach existing DBs) and fixture mode serves it
directly — `archetypes.list` is never empty, keyless included. Style-card values are authored
generic archetype craft; `pitch` and `exampleSnippets` stay `TODO(seed-copy)` until Josh's copy
pipeline delivers. No real creator's name/catchphrase/wording anywhere, enforced by review + the
copy-lint test.

**Modes ship as schema + guard, feature-gated.** `generation_mode` pgEnum
(archetype/crossover/partnered_named/train_on_my_channel); projects AND scripts carry nullable
`generation_mode`, `archetype_id`, `crossover jsonb {a,b,weightA}` (weightB = 1−weightA),
`partner_id` — null means the legacy voice-profile flow, and DB CHECKs force the matching
reference per mode. `partners` table stub reuses the licensed-voice constraint pattern
(`enabled ⇒ both license fields non-null`). `FEATURE_PARTNERED_NAMED` (lib/config, default false)
is enforced in `server/modes.ts` (`assertGenerationTargetAllowed`) — the ONE shared guard every
dispatch site calls; `train_on_my_channel` is enum-only and always rejected this wave.

**Script pipeline split into staged metered procedures** (`script.topics` 1cr, `script.outline`
1cr, `script.hooks` 1cr, `script.draft` 4cr) with `CREDIT_COSTS` entries; outline+hooks+draft sum
to the composite `scriptGeneration` (6) — a unit test pins that identity. `script.generate`
keeps its frozen signature (plus additive `generation` param) and is CONTRACTED to become an
orchestrator over the stages (C1); it may not bypass stage metering. Wave-C bodies are
deterministic fixture-grade stubs in `server/routers/impl/script-stages.ts`: real credit gate at
dispatch, one itemized ledger entry per stage (reason `script_generation` — the frozen enum has
no per-stage members), contract-validated outputs, working end-to-end keyless. Stage charges in
the stubs are synchronous-completion charges; C1 brings input-hash idempotency keys with the
resumable pipeline.

**Style-aware golden gates: types now, trivial checks now, LLM-adjacent checks C1.**
`qualityGateReportSchema` gained `styleGates` (nullable, default null so old reports parse):
bannedClaims scan (HARD FAIL) and CTA placement are implemented in `lib/style-gates.ts` (pure
code, conservative high-precision regexes per claim type) and wired into
`pipelines/script/quality-gate.ts`; `hookPatternOk` and per-card `readingLevel` are typed but
null until C1 threads the chosen hook technique + per-card readability through (the per-card
band then REPLACES the global Flesch ≥ 60 where a card is present).

**Copy-lint guardrail is a test, with a reviewed allowlist.** `tests/copy-lint.test.ts` scans
`app/(marketing)/**` + `components/**` for named-creator claim patterns ("sounds (exactly) like
<ProperNoun>", "write(s) like <ProperNoun>", "in <ProperNoun>'s voice"); exact-match allowlist
in `tests/copy-lint.allowlist.json` (empty today — current copy is clean), with a separate
`partnerAllowlist` that only counts when `FEATURE_PARTNERED_NAMED=true`.

**Migration 0005 verified against a live Postgres 16**: full migrate from zero, seed (12
archetypes upserted), legacy style-card transform (only legacy rows touched), mode CHECKs and the
partner license CHECK all exercised.

## 2026-09-10 — Wave C staged pipeline (C1)

**The four staged procedures are real** (`server/routers/impl/script-stages.ts` +
`pipelines/stages/**`): mode-guarded (`assertGenerationTargetAllowed`), tenant-validated BEFORE
`requireCreditsWithOverage` (a cross-workspace probe is NOT_FOUND and never charges), executed
through the PipelineRunner (kind `script`, stage names `topics`/`outline`/`hooks` + the seven
frozen draft stages), and completion-charged with idempotency key `<stage>:<input hash>` —
identical re-submits re-serve the (deterministic-in-fixture) result and the ledger dedupes, so
each stage charges exactly once per distinct input. `topics` validates channel ownership, then
feeds niche keywords + fresh ideation-store outliers + the resolved style card into the prompt;
`outline` honors `pacing.sectionSeconds` (chapter norm) and the ±10% target-length rule;
`hooks` yields 3 tagged candidates CONSTRAINED to the card's hookPatterns (repeats get distinct
bodies when a card allows < 3 techniques), auto-picked by the card's preference order; `draft`
reuses the whole 7-stage engine with the approved outline/hook adopted verbatim — SSE section
streaming, retention/voice/fact-check/quality passes and resume come for free, and the frozen
`ScriptStreamEvent` union is untouched.

**`script.generate` is the orchestrator.** Same job name (frozen queue contract), new
discriminator on the payload (`dispatch: legacy | draft | generate` — pre-deploy queued jobs
parse as `legacy` and keep the single −6 charge). The orchestrator runs outline → hooks → draft
as one pipeline over ONE SSE stream and writes ITEMIZED ledger entries per stage — outline (−1)
when the outline stage completes, hooks (−1) when candidates are produced, draft (−4) on
completion — summing to `CREDIT_COSTS.scriptGeneration` (6), each keyed `<stage>:<hash>`; MCP's
`generate_script` rides the same path, so nothing bypasses stage metering
(tests/c1-staged-pipeline.test.ts pins the ledger shape; the b2 MCP charge test was updated to
the itemized shape). Direct `runScriptPipeline` callers default to the legacy composite charge.

**Crossover merge rules (deterministic, documented in `pipelines/stages/crossover.ts`):**
(1) the heavier archetype is DOMINANT (ties at weightA = 0.5 go to A) and supplies the surface
voice verbatim — `voice`, `tone`, `ctaHabits`, `readingLevel`, `exampleSnippets`,
`thumbnailPresetId`; (2) pacing numbers (`wpmTarget`/`sectionSeconds`/`rehookSeconds`) blend
linearly by weight; (3) hookPatterns = dominant's patterns first (preference order preserved),
then union by technique, capped at the schema's 4; (4) bannedClaims = union (strictest of both —
a crossover is never a loophole); (5) energy = weighted round, clamped 1–5. Result re-parsed
through the frozen `styleCardSchema`.

**Partner resolution** (`pipelines/stages/partners.ts`): flag enforced upstream by
`server/modes.ts`; the resolver then requires the row to exist (NOT_FOUND), be `enabled`
(FORBIDDEN — the DB CHECK ties enabled to signed license fields) and carry a card
(PRECONDITION_FAILED). Production reads the `partners` table; keyless/fixture mode has an
in-memory registry that is EMPTY by default, so a flag-on fixture boot still cannot generate as
a named partner.

**Style gates completed.** `hookPatternOk` = chosen hook's technique ∈ card.hookPatterns —
evaluated whenever the pipeline knows the technique (always, in-run; recomputes recover it from
the hook-candidate cache, else null = "not evaluated"); hooks generation is constrained and
`script.draft` rejects a user-chosen off-card hook at dispatch (BAD_REQUEST, no charge), and a
false value fails the gate but is deliberately NOT an auto-fix violation (a section rewrite
cannot change a technique tag). Per-card `readingLevel`: Flesch–Kincaid grade
(`fleschKincaidGrade`, pipelines/script/readability.ts) REPLACES the global Flesch ≥ 60 gate
whenever a card is present (`readabilityOk` reflects it). The band check is ONE-SIDED: grade >
maxGrade fails (too complex for the audience); grade < minGrade warns but passes — simpler-than-
target spoken prose never hurts retention, and the global gate it replaces was also one-sided.

**Legacy null-generation path unchanged.** `generation: null` still resolves the voice profile's
card through the same seam; archetype/crossover/partner cards flow through the identical
`styleCard` injection (prompts, voice pass, gates) as channel-learned cards. `PROMPT_VERSION`
bumped to `2026-09-10.2` (outline prompt now renders the style card + pacing rule; hook prompt
gained the allowed-techniques constraint; new topics prompt).
