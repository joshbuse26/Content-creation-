# Wave F1 — command-center shell

Dark creator command center for every authenticated route. Marketing stays light.

## Tokens (one source of truth: `app/globals.css` `@theme`)

| Token                          | Value                             | Use                                                |
| ------------------------------ | --------------------------------- | -------------------------------------------------- |
| `accent-50…950`                | Tailwind orange, 500 = `#f97316`  | THE accent. Primary CTAs, active nav marker, links |
| `accent-fg`                    | `#0b0f14`                         | Text on accent-filled controls                     |
| `bg` / `surface` / `surface-2` | `#0b0f14` / `#12181f` / `#1a222d` | page / rail+cards / elevated+hover                 |
| `line`                         | `#2a3340`                         | hairline borders                                   |
| `ink` / `muted`                | `#f4f4f5` / `#9aa3b2`             | primary / secondary text                           |
| `success`                      | `#2ba640`                         | positive deltas ONLY — never an accent             |
| `danger`                       | `#ef4444`                         |                                                    |
| `radius-card`                  | `10px`                            | `rounded-card`                                     |
| `spacing-rail`                 | `240px`                           | `w-rail`                                           |

Emerald is gone: the whole codebase was renamed `emerald-*` → `accent-*`, so the brand colour is
those eleven lines and nothing else. The Badge tone formerly called `emerald` is now `accent`.

Dark mode is class-driven (`@custom-variant dark (&:where(.dark, .dark *))`). `app/(app)/layout.tsx`
sets `.dark` + `data-app-shell` on its root; `html:has([data-app-shell])` paints the charcoal
background before hydration so there is no white flash. Marketing has no `.dark` ancestor and is
always light.

## Information architecture (`components/shell/nav.ts` — the only list)

Coach `/coach` (home) · Intel `/discover` · Projects `/projects` · Ideas `/ideas` · Channels
`/channels` · Tools `/toolkit` · Settings `/settings`.

`/toolkit`, not `/tools`: `/tools` is the public free-tools marketing route and Next refuses two
pages at one path. `APP_HOME = "/coach"` drives the wordmark, login callbacks and "Enter playtest".

## Shell (`components/shell/app-shell.tsx`)

- Left rail: wordmark → Coach · workspace + channel switchers · sections (active = `surface-2` +
  accent left bar) · on Coach: "+ New chat" + recent threads · footer: workspace · plan chip · credits.
- Top bar: breadcrumb (section) · search (filters projects by title via `/projects?q=`) · section
  CTA (Coach: New chat · Projects: New project → `/projects?new=1` · Channels: Connect channel →
  `/channels#connect`).
- Main is the scroll container, full-bleed (no `max-w-6xl` cage); an error boundary with Retry
  wraps the pane; `WorkspaceGate` unchanged.

### F0 request discipline, preserved

ONE `ChatThreadsProvider` is mounted by the shell on every route (stable tree; no remounts on
navigation) and only fetches on `/coach` (`enabled`). The rail and the Coach page both read it —
selection (`selectedId`/`select`/`startThread`) now lives in the provider so two renderers share one
state. `tests/f1-shell.test.tsx` pins: shell + Coach page = ONE `listThreads`; a non-chat route =
ZERO; a starter chip = ONE `createThread`. The F0 suite runs unmodified.

## Playtest (≤6 clicks)

1. Enter playtest → lands on `/coach`, dark shell, Coach highlighted.
2. Rail: Coach · Intel · Projects · Ideas · Channels · Tools · Settings, channel switcher above.
3. Rail "+ New chat" → a thread appears under Recent and opens.
4. Type "Give me 5 hooks for a tech explainer about phone batteries" → streams.
5. DevTools Network: one `listThreads`, one `getThread` per completion, no 429s.
6. Projects / Intel / Tools → full-bleed dark, no white flash; wordmark → Coach.

Known dev-only quirk (unchanged by F1): with no `DATABASE_URL`, `next dev` compiles the tRPC route
and `/api/chat-stream` as separate bundles, each with its own in-memory chat store, so a thread
created in one is "not found" by the other. Production (Postgres) and `pnpm build && start` are
unaffected; use the seeded fixture threads when playtesting on a bare dev server.

---

# Wave G — simplified playtest (2026-09-18)

## A) No paywalls

- **Server:** while `PLAYTEST_AUTH_BYPASS` is on, `isCreditExempt()` (server/credits.ts) returns
  true for everyone — no gating, no debits, for every metered path (staged pipeline, chat tools,
  thumbnails, research, titles, train-voice, competitor compare). The ledger code is untouched and
  still tested with the flag off; flipping the env restores metering. TEMPORARY — remove with the
  auth bypass before public launch.
- **UI:** no product CTA carries "N credit(s)" copy any more (Intel batch/concepts, competitor
  compare, thumbnail board/quick-3/tweak, titles, research, Coach confirm cards + toasts, train
  voice). `tests/g-playtest-simplify.test.tsx` greps every component for charge copy; the only
  allowed surfaces are the billing page, the rail footer balance link, the staged pipeline's
  exempt-aware notes, and the public marketing tool page.

## B) Ideas is a Tools card

Rail: Coach · Intel · Projects · Channels · Tools · Settings. `/ideas` redirects to `/toolkit`; the
Ideas card opens the Coach with an ideas prompt. (`components/ideas/ideas-feed.tsx` is kept —
nothing links to it; delete or re-home it in a later wave.)

## C) Tools open the Coach with the job in the composer

`coachLaunchHref(prompt)` → `/coach?prompt=…`. The Coach page reads the param once, opens ONE new
conversation with the prompt seeded in the composer, then `router.replace("/coach")` so refresh /
back never opens another. Hooks, titles, ideas, research, outline/script, description/tags all
launch this way; Thumbnail Studio and Intel are their own screens.

## D) Thumbnail Studio (Tools → `/toolkit/thumbnails`)

Pick a video (or name a new one in one field) → the whiteboard: how many (3–6, default 4), preset,
subject, mood, overlay text → **Generate N thumbnails** → real 1280×720 images → ★ star keepers,
Pick winner (attaches to that video's packaging), Export (downloads the PNG), Regenerate one with
tweaks. Same `thumbnails.generateBoard` path the packaging stage uses; `ThumbnailBoard` now takes a
`projectId` prop instead of reading the project route.

### Image provider env (Railway, both `web` and `worker`)

| Var                                                                       | Value                           | Notes                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMAGE_API_KEY`                                                           | fal.ai key                      | `lib/providers/live/image.ts` calls `https://fal.run/fal-ai/flux/dev` (FLUX), 1280×720, N images per call. Required when `PROVIDERS=live`.                                                                                                                    |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Railway Storage Bucket (S3 API) | Generated images are copied from the provider's short-lived URL into the bucket and served by `/api/thumbnail-image`. Without `S3_*` the app falls back to in-memory storage (images vanish on restart — fine for a quick playtest, not for keeping winners). |

No other provider is wired; swapping models means editing the one fetch in `live/image.ts`.

## Playtest (≤6 clicks)

1. Enter playtest → rail shows no Ideas; no button anywhere says "credit".
2. Tools → Hook Generator → lands on the Coach in a NEW conversation with "Give me 5 hooks for a
   video about: " in the composer → finish the sentence → Enter → streams.
3. Tools → Thumbnail Studio → pick/name a video → Generate 4 thumbnails → four 1280×720 images → ★
   one → Pick winner → Export.
4. Intel → "New batch" / "Get concepts now" — no credit suffix.

---

# Wave H — Thumbnail Studio: images actually land (2026-09-19)

Prod symptom: "Generate 4 thumbnails" → toast "Board generated." → empty board. Root cause: the
board/tweak path (`pipelines/thumbnails/board.ts`) had no default downloader for provider-hosted
URLs (fal.ai returns `{ url }` only) and the router never passed one, so every concept's image
stage failed and `runThumbnailBoard` returned `{ concepts: [] }` as a success.

Fix: `defaultFetchBytes` (bounded 10s / 10MB download) is exported from `pipeline.ts` and is the
default for the board and tweak paths, exactly like the one-shot path. A board that produces zero
images now throws `ThumbnailImageError` (with the provider/download reason, never a key), which the
router maps to `BAD_GATEWAY` so the UI shows the real reason instead of a masked "Something went
wrong"; a failing tweak throws the same way. The success toast reports the count ("4 thumbnails
ready." / "3 of 4 … run again to fill the rest." — a partial board heals on the next identical run).
`tests/h-thumbnail-board-live-urls.test.ts` pins: URL-only provider → N downloaded + persisted
concepts, with and without an injected `fetchBytes`; provider/download failure → rejects; router →
`BAD_GATEWAY`.

Storage reminder: without `S3_*` on web+worker, images live in the web process's memory and vanish
on restart/redeploy. Fine for a look; set the bucket before keeping winners.

---

# Wave I — Intel = your own channel · Thumbnail references (2026-09-20)

## Intel (`/discover`) is strictly the creator's own channel

Headline sentence → three hero stats (subscribers + delta · median views / video · uploads last
30 days) → lifetime views, like rate, comment rate → **What's working / What's not** in plain
English → by-period and by-length breakdowns → the upload table (views, ×median, views/day, like
rate, Strong / Typical / Weak / Too early) → an honest **Needs YouTube Analytics access** block.
No concept cards, batches, niche chips or competitor compare on Intel any more — those are the
**Ideas** tool (`/toolkit/ideas`; `/ideas` redirects there). Not connected → "Connect YouTube".

### Data, honestly

| Source                                              | Fields we use                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube Data API v3 (public `@handle`, demo, OAuth) | per video: views, likes, comments, duration, publish date, thumbnail · per channel: subscribers, lifetime views (snapshot per sync)     |
| Derived (`lib/intel/stats.ts`, pure, unit-tested)   | median / avg views, ×median per video, views per day, like & comment rate, upload cadence, length bands, subs & views delta (snapshots) |
| YouTube Analytics API — **not wired**               | watch time, average view duration, impressions, impressions CTR, subscribers gained per video → shown as N/A with the reason            |
| Monetary (RPM / CPM / "CPA")                        | needs the monetary scope on a monetized channel → **not available; never invented**                                                     |

Unlocking Analytics later = adding `yt-analytics.readonly` to the OAuth scope + an Analytics fetch
in the sync pipeline; the overview schema already carries the `analytics` block to fill.

### Migration 0013 — `channel_videos`

The sync pipeline already fetched per-video stats but only persisted the snapshot; it now upserts
the creator's uploads (keyed on channel + video) after `fetch_videos`. `channel.stats` reads them
with the last 60 snapshots. `connectDemo` seeds six uploads for the demo channel.

## Thumbnail Studio — reference image + brief

On `/toolkit/thumbnails` (and the packaging stage): a **Brief** field ("45 sec educational video,
photo of him") and a **drag-and-drop reference** (one PNG/JPEG/WebP — a face photo or an example
frame). The browser frames it to 1280×720 (cover-crop, JPEG) before upload, so a 12MB phone photo
becomes ~200KB and the output size matches.

Server: the reference is stored content-addressed (`thumbnails/<ws>/<project>/refs/<hash>.<ext>`),
its hash joins the concept input hash (a new reference is new work), the brief and a "keep the
subject, framing and the person in the reference" line join the prompt, and the live provider runs
**image-to-image** (`fal-ai/flux/dev/image-to-image`, `strength` = `REFERENCE_STRENGTH` 0.7).
Tweak/regenerate re-reads the concept's stored reference unless a new one (or `null`) is sent.
Wave H's download path is unchanged and re-tested with a reference present.

Honesty note in the UI: the reference guides framing, subject and colours — it is not an identity
match (FLUX img2img is not a face-ID model). Migration 0014 adds `brief` and `reference_image_key`
to `thumbnail_concepts`.

**Migrate: 0013 + 0014** (`pnpm db:migrate`), both additive.
