# REQUESTS-B4 — thumbnails, templates, free tools (v1.1 sprint)

Everything below ships working and green without any action; these are the
wiring steps that turn interim fallbacks into the production configuration,
plus flagged cross-file edits.

## 1. Dependency: `@aws-sdk/client-s3` (integrator adds — package.json untouched)

Object storage (`server/storage/`) is live behind an interface. Until the SDK
lands, `getObjectStorage()` uses the in-memory backend (a warning is logged
once if `S3_*` env is set with no client registered — images then do not
survive restarts).

Once installed, register the client at startup in BOTH processes (web:
`instrumentation.ts` · worker: `worker/index.ts`), using the ready-made
snippet in the header of `server/storage/s3.ts`:

```ts
import { registerS3Client } from "@/server/storage";
// build S3ClientLike from @aws-sdk/client-s3 as shown in server/storage/s3.ts
registerS3Client(() => s3);
```

Env (already in `lib/config.ts` + `.env.example`, no config changes needed):
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

## 2. Worker: wire the `thumbnails` packaging job (worker/index.ts — not B4-owned)

The frozen `thumbnails` job on the `packaging` queue is currently an
acknowledged no-op in the worker. Replace it with:

```ts
import { handleThumbnailsJob } from "@/pipelines/thumbnails";

case JOB_NAMES.thumbnails:
  await handleThumbnailsJob(job.data);
  return;
```

Without Redis the same handler already runs inline at dispatch
(`dispatchPipelineJob`), so fixture/keyless mode is unaffected either way.

## 3. Marketing nav/footer links (components/marketing/site-chrome.tsx — not B4-owned)

The free tools live at `/tools` (index) plus `/tools/{title-generator,
tag-generator,description-generator,hook-analyzer}`. Please add a
"Free tools" link to `SiteNav` and/or `SiteFooter`; shared chrome was
deliberately not edited. When an `app/sitemap.ts` is added, include these
five routes — each page already exports canonical + OG metadata.

## 4. Cross-file edits outside the strict B4 list (flagged for review)

- `server/routers/_contracts.ts` — stub **bodies** for `thumbnails` and
  `templates` swapped to the impls (established integration pattern;
  signatures/inputs/outputs untouched, no frozen-layer change).
- `pipelines/packaging/persist.ts` — `findDescriptionTemplate` fixture-mode
  branch now reads the shared in-memory template store (was: always `null`
  without a DB), so created templates fill `{{slots}}` end-to-end keyless.
- `app/api/thumbnail-image/route.ts` — NEW route (nobody's namespace):
  serves stored thumbnail bytes with session + `assertAccess(thumbnail,
read)` + row-level workspace check; storage keys never come from clients.

## 5. Notes / small follow-ups (no action required to stay green)

- **Thumbnail credits**: 3/run (1 per image, spec §7), gated at dispatch via
  `requireCredits`, charged on completion with idempotency key
  `thumbnail:<input hash>`; the cost constant lives in
  `pipelines/thumbnails/pipeline.ts` (`THUMBNAIL_CREDIT_COST`) — fold into
  `CREDIT_COSTS` in `server/credits.ts` if you prefer one table.
- **Face reference uploads** (spec §5.10 "or uploads own face photo"): the
  frozen `thumbnails.generate` contract has no face field, so the pipeline
  accepts `faceImageKey` (frozen job input) but the router always passes
  null. Needs a frozen-contract addition + an upload route when scheduled.
- **Free-tool email gate** is client-side honor system per the sprint spec
  (localStorage counter; server-side per-IP cap of 5/day is authoritative).
  The captured email is not sent anywhere yet — wire to PostHog/Resend
  audience when analytics lands.
- **OPEN-ITEMS.md** should drop three entries once merged: thumbnails
  (image generation), templates (CRUD stub), `/tools/*` free pages. Left
  unedited to avoid clobbering parallel tracks.
