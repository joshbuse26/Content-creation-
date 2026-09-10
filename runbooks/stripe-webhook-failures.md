# Runbook: Stripe webhook failures

**Symptoms:** Stripe dashboard shows webhook endpoint failing/disabled; users paid but
plan/credits not applied; `workspaces.plan` or `credit_balance` out of date; signature
verification errors in web logs.

## Confirm

1. Stripe dashboard → Developers → Webhooks → the endpoint: recent delivery attempts,
   response codes, and whether Stripe auto-disabled it (happens after days of failures).
2. Classify the failure:
   - **401/400 signature errors** → `STRIPE_WEBHOOK_SECRET` mismatch (rotated secret,
     wrong environment, staging secret in prod).
   - **5xx** → our handler is throwing; check Sentry for the stack.
   - **Timeouts** → handler doing slow work inline (it must enqueue and return 2xx fast).

## Mitigate

- Secret mismatch: copy the signing secret for THIS endpoint from the Stripe dashboard
  into the Railway `web` service variables; redeploy. Each endpoint has its own secret —
  staging and prod differ.
- Handler bug: fix and deploy. The handler must be **idempotent** (Stripe retries, and we
  will replay) and must apply credit changes as `credit_ledger` entries, never direct
  balance writes.
- Do not mark the incident resolved while the endpoint is disabled in Stripe.

## Recover — replay missed events

1. Re-enable the endpoint in Stripe if auto-disabled.
2. Stripe dashboard → Webhooks → endpoint → filter failed deliveries since incident start
   → **Resend** each (or `stripe events resend <evt_id>` via CLI). Idempotency makes
   double-delivery safe.
3. Reconcile: for checkouts in the window, verify each paying workspace has the expected
   `plan` and a `plan_grant`/`purchase` ledger entry. The nightly credit reconciliation
   (`server/ops/reconcile-credits.ts`) will flag any workspace whose balance drifted —
   run it manually now: it logs drift per workspace.
4. Manually grant anything still missing via a ledger `adjustment` entry (never edit
   `credit_balance` directly).

## Prevention

Alert on: webhook failure count > 3 in 10 min; endpoint disabled. Keep grace-period logic
(7 days → read-only) in mind before disabling any paid workspace during an incident window.
