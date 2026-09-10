# Runbook: YouTube API quota exhausted

**Symptoms:** channel sync failures with `quotaExceeded` (HTTP 403) from the YouTube Data
API; `channels.sync_status='failed'`; stale `last_synced_at`; outlier/ideation jobs (v1.1)
erroring. Daily quota: **10,000 units**, resets midnight Pacific.

## Confirm

1. Google Cloud console → APIs & Services → YouTube Data API v3 → Quotas: units used today.
2. What burned it? `search.list` = **100 units/call**; `videos.list`/`channels.list`/`playlistItems.list` = 1 unit.
   Worker logs: count YouTube calls by type over the last 24 h. Alpha-scale sync-only usage
   should be <500 units/day — if it's higher, something is looping.

## Mitigate

- The design already degrades: search results are cached 24 h in Redis (`yt:search:*` keys)
  and the spec's circuit breaker trips at 9,000 units → cached data + banner. Verify the
  banner is showing rather than hard errors.
- Stop the bleed: pause the nightly sync repeatable job in the worker (schedules live in
  code — comment out / feature-flag, deploy worker only). Do NOT disable the OAuth flows;
  connects are cheap (≈4 units).
- If a bug is looping `search.list`: fix > pause. A single retry loop can eat the whole
  day's quota in ~100 calls.

## Recover

1. Quota resets at 00:00 US-Pacific. Nothing to flush — syncs pick up on next run.
2. Re-run failed syncs for affected channels (channel sync is idempotent; snapshots append).
3. If this recurs at current user count: file the quota-increase request (console → Quotas →
   request increase) with usage evidence — spec §8 says file early.

## Prevention

- Keep per-channel search budget ≤6/day; channels in the same niche must share search results (key design point, spec §8).
- Add an alert at 7,000 units (before the 9,000 breaker).
