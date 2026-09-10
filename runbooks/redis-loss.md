# Runbook: Redis loss (queue + cache down)

**Symptoms:** worker crash-loops or logs `REDIS_URL is not set` / connection refused; new
pipeline runs never start (`pipeline_runs` stuck in `queued`); readiness check
(`checkReadiness`) reports redis `ok:false`; rate limiting logs "failing open"; YouTube
search cache misses spike quota usage.

## What Redis holds (and what it doesn't)

- BullMQ queues/jobs (`script`, `sync`, `packaging`) — **in-flight work**.
- 24 h YouTube search cache, sliding-window rate-limit state — **rebuildable, losable**.
- Nothing durable lives only in Redis: pipeline progress is in Postgres
  (`pipeline_runs`), so a full flush loses queued _job messages_ but not the record of
  what was requested or completed.

## Confirm

1. Railway → Redis service: status, memory, restarts.
2. `redis-cli -u $REDIS_URL ping` from a Railway shell.
3. Worker logs for reconnect storms; web logs for rate-limit fail-open warnings (the API
   deliberately keeps serving without Redis — spec priority: don't take the app down).

## Mitigate

- Railway Redis restart usually suffices. BullMQ reconnects automatically
  (`maxRetriesPerRequest: null` is set for exactly this).
- If Redis is OOM: it's almost certainly cache keys — `redis-cli --scan --pattern 'yt:search:*' | head`;
  delete cache keys freely. NEVER `FLUSHALL` while queues hold jobs you care about.

## Recover after data loss (fresh/flushed Redis)

1. Restart worker + web so BullMQ re-creates queue structures.
2. Find work that was requested but never finished:
   `SELECT id, kind, stage, status FROM pipeline_runs WHERE status IN ('queued','running') AND updated_at < now() - interval '10 min';`
3. Re-enqueue those runs (resume-from-failed-stage skips completed stages; input hash
   guards against duplicates). For charged-but-lost runs that can't resume, refund via a
   `credit_ledger` `refund` entry.
4. Rate-limit and cache state rebuild themselves; expect one day of elevated YouTube
   quota use while the search cache warms — watch the 9,000-unit breaker.

## Prevention

Readiness endpoint already pings Redis — wire it to alerting. Consider enabling Railway
Redis persistence (AOF) before public launch.
