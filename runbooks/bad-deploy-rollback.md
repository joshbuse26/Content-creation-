# Runbook: bad deploy — rollback

**Symptoms:** error-rate spike right after a deploy; `/api/health` failing; Sentry
regression burst tagged with the new release; worker crash-looping on boot.

## Decide fast (2 minutes)

- Is it **web**, **worker**, or **both**? They deploy from the same repo but roll back
  independently in Railway.
- Did this deploy include a **DB migration**? Check the deploy's diff for
  `db/migrations/`. This decides which path below.

## Path A — no migration in the bad deploy (common case)

1. Railway → affected service → Deployments → previous good deployment → **Redeploy**.
2. Verify `/api/health` and `checkReadiness` output; watch Sentry error rate for 10 min.
3. Roll back web AND worker if the change touched shared code (queue payloads, schemas):
   a new web enqueueing jobs an old worker can't parse (or vice versa) is a classic
   split-brain — keep the pair on the same commit.

## Path B — the bad deploy ran a migration

**Do not** blindly redeploy old code over a new schema.

1. Assess: is old code compatible with the new schema? Additive migrations (new tables,
   nullable columns) → yes: roll back code only (Path A) and leave the schema.
2. Destructive/renaming migrations → restore discipline:
   - Freeze writes (scale worker to 0; put web in maintenance if available).
   - Restore the pre-deploy Postgres backup (Railway backup/PITR — the restore procedure
     rehearsed on Day 5), or write and apply an explicit down-migration.
   - Redeploy the previous code, verify, then unfreeze.
3. Any writes that happened between deploy and freeze are lost by a restore — prefer
   down-migrations over restores when the window isn't tiny.

## After rollback

1. Announce in the war room: `main` is now ahead of production — nobody merges until the
   cause is identified.
2. Reproduce the failure in staging; fix forward with a new deploy (never re-deploy the
   bad build).
3. Deploy freeze rules (sprint plan §5): no deploys after 8pm; hotfixes only on launch day.

## Verify checklist (both paths)

`/api/health` 200 · readiness db+redis ok · a fixture-mode smoke of the core loop ·
Sentry quiet for 15 min · queue depth draining, not growing.
