# REQUESTS-B3 — billing & monetization (Stripe live)

Track B3, v1.1 sprint. Everything below is either a frozen-layer change made
under the pre-approved narrow class, or wiring the integrator must do in
files B3 does not own. All B3 code is green: `pnpm typecheck` · `lint` ·
`format:check` · `test` (372 tests, 55 new).

## 1. Frozen-layer changes MADE (pre-approved narrow class)

Migration `db/migrations/0003_busy_patriot.sql` — exactly the approved
class: **nullable columns on `workspaces` + one new table**, nothing else.

- `workspaces.stripe_subscription_id` text NULL — active subscription id.
- `workspaces.billing_period_end` timestamptz NULL — current period end
  (cycle progress + downgrade boundary).
- `workspaces.pending_plan` plan NULL — up/downgrade staged by
  `customer.subscription.updated`, applied at the next `invoice.paid`.
- `workspaces.payment_failed_at` timestamptz NULL — grace-period start;
  read-only is **computed** (`isWorkspaceReadOnly`, 7 days), no cron flag.
- `workspaces.overage_used` integer NULL (null ⇒ 0) — overage credits
  metered this cycle; reset by `invoice.paid`.
- New table `stripe_events` (`event_id` unique) — webhook idempotency.

## 2. Wiring the integrator does (B3 may not touch these files)

### 2a. Swap requireCredits → requireCreditsWithOverage (import-only swap)

`requireCreditsWithOverage(workspaceId, cost)` from `@/server/billing` is a
drop-in superset of `requireCredits` (server/credits.ts stays untouched).
It adds: read-only lockdown after the 7-day grace, and allow-and-meter
overage for paid plans (capped at 200 credits/cycle). Call sites:

| File                              | Line | Cost                            |
| --------------------------------- | ---- | ------------------------------- |
| `server/routers/impl/script.ts`   | 71   | `CREDIT_COSTS.scriptGeneration` |
| `server/routers/impl/revision.ts` | 27   | `CREDIT_COSTS.revisionPass`     |
| `server/routers/impl/research.ts` | 44   | `CREDIT_COSTS.researchRun`      |
| `server/routers/impl/titles.ts`   | 18   | `CREDIT_COSTS.titles`           |
| `server/routers/impl/avatar.ts`   | 83   | `CREDIT_COSTS.avatarRegen`      |

Optional but recommended: pass `{ idempotencyKey: <pipeline input hash> }`
where one is available so a retried dispatch cannot double-meter (without
it a random key is used per call — safe, but retries meter again).

Note: read-only enforcement therefore covers all _generation_ dispatch. If
the sprint wants read-only to also block content _edits_ (sections,
packaging, etc.), that needs a tRPC middleware in `server/trpc.ts` calling
`isWorkspaceReadOnly` — B3 exports the helper; happy to pair.

### 2b. Tier limit enforcement (spec §7)

From `@/server/billing` (throw `PRECONDITION_FAILED` with upgrade copy):

- `assertChannelLimit(plan, currentChannelCount)` — call before inserting a
  channel in:
  - `server/routers/impl/channel.ts` → `connectPublic` (fn starts line 68),
    after fetching the workspace plan + `channelRepo.list(...).length`;
  - `app/api/channels/oauth/callback/route.ts` → before
    `connectOauthChannel(...)` (line 123).
- `assertSeatLimit(plan, currentMemberCount)` — call in
  `server/routers/impl/workspace.ts` → `invite` (fn starts line 183),
  before the membership insert (both the fixture-store and db branches).

Pure non-throwing variants (`checkChannelLimit`/`checkSeatLimit`) exist for
UI gating; `TIERS` is client-import-safe (no server deps).

### 2c. billing.checkout / billing.portal stub swap in `_contracts.ts`

Replace the fixture stub bodies (lines ~491–503) with:

```ts
checkout: ...mutation(({ ctx, input }) => billingHandlers.checkout({ ctx, input })),
portal:   ...mutation(({ ctx }) => billingHandlers.portal({ ctx })),
```

Both handlers keep the exact fixture URLs when `STRIPE_SECRET_KEY` is unset,
so the zero-key boot and existing fixture expectations are unchanged.

### 2d. Env vars → `.env.example` + `lib/config.ts` (names only)

B3 does not own these files; please add:

```
STRIPE_PRICE_STARTER=
STRIPE_PRICE_TEAM=
STRIPE_PRICE_AGENCY=
STRIPE_PRICE_OVERAGE=
```

Each accepts a price id (`price_…`, used directly) **or a price lookup
key** (resolved via `prices.list`). Until they land in `lib/config.ts`,
`server/billing` reads them via `process.env` (single accessor,
`priceEnvValue` in `server/billing/checkout.ts`) — moving them into the
Zod env schema is a mechanical follow-up.

## 3. Frozen-layer requests NOT made (worked around; approve when convenient)

- **`"overage"` member in `CREDIT_REASONS`** (lib/types/enums.ts, frozen):
  overage top-ups are written as reason `purchase` with idempotency keys
  prefixed `overage:` — fully auditable, but a first-class reason would be
  cleaner. Mechanically: the ledger cannot go negative
  (`workspaces_credit_balance_floor` CHECK) and pipelines charge at
  completion, so overage is implemented as _meter + top-up grant of the
  shortfall_, letting the normal completion charge land at 0.
- **`billing.summary` output extension**: read-only state, grace clock,
  pending plan, period end and overage usage cannot ride the frozen
  summary contract; they are served by `GET /api/stripe/billing-status`
  (session + `billing:read` authz). Folding them into the tRPC summary
  later is an additive output change.

## 4. Stripe dashboard setup (ops)

1. Products/prices per tier (Starter $49, Team $99, Agency $249, monthly);
   set the four env vars above (lookup keys recommended).
2. Billing **Meter** named `overage_credits` + a metered price at
   **$0.60/credit** attached via `STRIPE_PRICE_OVERAGE` (checkout adds it
   as a quantity-less line item automatically). stripe-node v22 has no
   legacy usage-records API — overage reports as meter events
   (`identifier` = ledger idempotency key ⇒ Stripe-side dedupe too).
3. Webhook endpoint → `POST /api/stripe/webhook`, secret in
   `STRIPE_WEBHOOK_SECRET`, events:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.

## 5. Behavior notes (for DECISIONS.md if you want them)

- **Monthly reset = expire-and-grant**: `invoice.paid`
  (`billing_reason ≠ subscription_create`) writes `monthly_reset:<evt>`
  (−remainder) then `plan_grant:<evt>` (+tier credits) — no rollover, and
  both entries idempotent on the event id independently of the
  `stripe_events` guard.
- **Downgrades at the boundary**: `customer.subscription.updated` only
  stages `pending_plan`; the next cycle's `invoice.paid` applies it with
  the new plan's grant. Upgrades bought through our checkout apply
  immediately via `checkout.session.completed` metadata.
- **Grace**: first `invoice.payment_failed` stamps `payment_failed_at`
  (later retries do NOT restart the clock); any `invoice.paid` clears it.
- **Meter failure after grant** is logged (`overage metering failed…`) and
  generation proceeds — bounded by the 200-credit ceiling and auditable
  via `overage:` ledger keys.
- **Subscription cancel** (`customer.subscription.deleted`) expires the
  remaining balance to 0 and returns the workspace to `free`.
