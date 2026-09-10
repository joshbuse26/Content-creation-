# Runbook: LLM provider down (Anthropic API)

**Symptoms:** script/packaging pipeline runs failing at LLM stages; Sentry burst of
`pipeline <kind> failed at stage …` with 429/5xx/timeout messages; users see stalled
generation and "run failed" states; `pipeline_runs` rows stuck in `failed`.

## Confirm

1. https://status.anthropic.com — provider incident?
2. `SELECT stage, error, count(*) FROM pipeline_runs WHERE status='failed' AND updated_at > now() - interval '30 min' GROUP BY 1,2;`
   - 429s only → we are rate-limited, not an outage. Different playbook (back off, request tier bump).
3. Worker logs (Railway `worker` service): repeated retries with exponential backoff at LLM stages.

## Mitigate

- **Do nothing destructive.** Each stage already retries 2× with backoff; BullMQ retries the job once more. Short blips self-heal and runs resume from the failed stage (same input hash → done stages are skipped).
- Sustained outage (>15 min):
  1. Post a status banner (app config) telling users generation is delayed; queued work is safe.
  2. Do NOT drain or delete queued jobs — they are the users' paid work.
  3. If the queue is growing unbounded, pause workers (`railway scale worker=0` or pause the service) so jobs wait in Redis instead of burning retries.
- 429-storm variant: reduce worker concurrency to 1, confirm model pins (`lib/config.ts LLM_MODELS`) — Haiku for tags/fact-check, Sonnet elsewhere; a mispin to a bigger model can blow the rate tier.

## Recover

1. Resume/scale workers back up.
2. Re-enqueue failed runs (they resume at the failed stage). Failed _charged_ runs must have refund ledger entries — verify: every `pipeline_runs.status='failed'` with `credits_charged > 0` has a matching `credit_ledger` `refund` row; insert refunds where missing.
3. Confirm drain: `SELECT status, count(*) FROM pipeline_runs WHERE created_at > now() - interval '2 hours' GROUP BY 1;`

## Postmortem hooks

Alert threshold to add if this fired: >5 LLM-stage failures / 5 min. Consider queue-depth alarm on the `script` queue.
