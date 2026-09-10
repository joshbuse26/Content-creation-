# Launch Checklist — everything Josh does, in order

The code side is done and green. Each step below is human-only. Steps 1–4 get the app live in fixture mode; 5–8 make it real; 9–12 make it sellable.

## 1. Push the repo (5 min)

The repo on GitHub is `joshbuse26`'s "Content creation" (already connected to Railway project *content creation*). From wherever you extract `gin-rummy-repo.tar.gz` (or on the cloud session's copy once GitHub is connected to it):

```bash
cd content-creation
git remote add origin https://github.com/joshbuse26/<exact-repo-name>.git
git push -u origin main
```

If the GitHub repo already has commits (Railway showed a service online), and you don't need them:
`git push -u origin main --force`. Only force if you're sure nothing there matters.

## 2. Railway services (15 min)

The project needs TWO services from this one repo plus data stores:

- `web` — build with `railway.web.json` (config-as-code path in service settings). Public networking ON, healthcheck `/api/health`.
- `worker` — same repo, `railway.worker.json`. No public networking.
- Add **PostgreSQL** and **Redis** from the Railway catalog, and a **Storage Bucket** (not needed until thumbnails ship — can wait).

## 3. Environment variables

Set on BOTH web and worker unless noted:

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | ref → Postgres service | Railway reference variable |
| `REDIS_URL` | ref → Redis service | |
| `AUTH_SECRET` | `openssl rand -base64 33` | web only; required to boot |
| `CHANNEL_TOKEN_SECRET` | `openssl rand -base64 33` | encrypts YouTube refresh tokens |
| `PROVIDERS` | `fixture` for first boot → `live` when keys are in | prod + fixture is allowed only with NODE_ENV unset to production... it isn't: **production requires `live`** once you flip; app fail-fasts on prod+fixture by design |
| `NEXT_PUBLIC_FIXTURE_UI` | `1` only while PROVIDERS=fixture | web only, build-time |
| `ANTHROPIC_API_KEY` | console.anthropic.com | required for live |
| `RESEND_API_KEY` | resend.com | **required in production** — sign-in fails loudly without it |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GCP OAuth client | login + channel connect |
| `GOOGLE_API_KEY` | GCP, YouTube Data API v3 enabled | public channel mode |
| `TRANSCRIPT_API_KEY` | Supadata (or compatible) | competitor/public transcripts |
| `SEARCH_API_KEY` | Brave Search | research agent |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe | checkout stub until live billing ships |
| `SENTRY_DSN` | sentry.io | optional but do it |

After DB is up, run migrations + seed once (Railway shell on web service or locally against `DATABASE_URL`):
`pnpm db:migrate && pnpm seed`

## 4. First boot check (5 min)

Open the web URL: landing page loads → log in (magic link; with Resend key it emails, without it in non-prod the link is in logs) → projects page renders. Worker logs show the three nightly schedulers registered.

## 5. Google Cloud (start TODAY — it gates public launch)

1. GCP project → enable **YouTube Data API v3**.
2. OAuth consent screen: External, **Testing** mode. Add yourself + alpha users (up to 100) as test users.
3. OAuth client (web): authorized redirect URIs — `https://<your-domain>/api/auth/callback/google` and `https://<your-domain>/api/channels/oauth/callback`.
4. **Submit for verification** the moment /privacy and /terms are live on your domain (they ship with the app). Scope: `youtube.readonly`. Expect 2–4 weeks; testing mode covers alpha meanwhile.
5. Quota: default 10k units/day is fine for alpha; file for increase after ~2 weeks of usage.

## 6. Accounts (30 min total)

Anthropic (key + billing), Resend (verify sending domain), Brave Search API, Supadata, Stripe (activate: business details + bank), Sentry project. Paste keys as they arrive; flip `PROVIDERS=live` and remove `NEXT_PUBLIC_FIXTURE_UI` when Anthropic + Google + Resend are in; redeploy both services.

## 7. Domain

Buy the product domain → Railway web service → custom domain → update `AUTH_URL`/callback URLs in GCP to match.

## 8. First LIVE golden run (the important hour)

With `PROVIDERS=live`:

```bash
pnpm exec tsx scripts/golden-run.ts
```

Replace the 3 sample briefs in `scripts/golden-briefs.json` with your real 10 (write them — 1 hour, do it before touching anything else). Score each script 1–5 in the sheet it emits. Below 4.0 average → prompt iteration in `prompts/` before any user sees output. `docs/golden-baseline.md` holds the fixture-mode baseline for pipeline comparison.

## 9. Dogfood

Connect the devlog channel, run idea → research → frame → script → package end to end as a real user. Fix list from that session outranks all remaining feature work.

## 10. Legal (before charging anyone)

Subscribr permission letter in writing. Lawyer pass on the shipped /terms and /privacy. Creator license PDFs on file before any licensed voice profile is created (the DB refuses licensed voices without license fields — that's intentional, don't work around it).

## 11. Alpha

Add 5–10 users as GCP test users + allowlist. Onboard each on a call. Watch them use it.

## 12. What's deliberately NOT here (v1.1 backlog)

Ideation/outlier engine, thumbnail image gen, MCP server, billing tiers + metering, free tools, multi-voice + licensed-voice guard, dashboard tracking UI. See OPEN-ITEMS.md. Next build shift picks these up once keys exist and live quality is ≥4.0.
