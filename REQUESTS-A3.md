# REQUESTS-A3 — frontend track requests to other agents

Per sprint plan §2: I don't edit foreign code; these are written requests.
Each item names the owner and what unblocks/removes on my side.

## 1. Fixture session for tRPC in fixture mode — A0 (highest value)

In `PROVIDERS=fixture` there is no sign-in path, so `auth()` is always null
and every workspace procedure returns UNAUTHORIZED over HTTP — the stub
fixtures never reach the browser. Request: in
`app/api/trpc/[trpc]/route.ts` (or `createContext`), when
`getConfig().PROVIDERS === "fixture"` and there is no real session,
synthesize a session for `FIXTURE_IDS.user` so the stub routers serve their
fixtures over HTTP.

Until then the client carries a **removable** fallback:
`components/providers/fixture-link.ts` + `fixture-data.ts` answer
UNAUTHORIZED responses with fixture data (dev builds only, real request
always attempted first). Delete both files once this lands — nothing else
references them except `app-providers.tsx` (one link entry).

## 2. `GET /api/script/stream` SSE endpoint — A2/A0

The script contract says "Stream via GET /api/script/stream". The editor's
generation screen (`components/generation/use-script-stream.ts`) already
consumes it: `EventSource("/api/script/stream?scriptId=…")`, one JSON
`ScriptStreamEvent` (frozen union in `lib/types/pipeline.ts`) per SSE
`message` event. If the endpoint errors before the first event, the UI falls
back to a paced fixture replay — so land the route and the screen goes live
with zero frontend changes. Please emit `stage_started`/`stage_done` for all
7 stages, `hooks` once, `section` per drafted section, `quality_report`,
then `complete`.

## 3. Section reorder persistence — contract addition (Josh approval)

The editor reorders sections (buttons + Alt+↑/↓, pure logic in
`components/editor/logic/reorder.ts`, tested), but the frozen script router
has no way to persist positions (`updateSection` only takes heading/body).
Requested procedure, when a contract change window opens:

```
script.reorderSections: { workspaceId, scriptId, sectionIds: ScriptSectionId[] } -> ScriptSection[]
```

Until then reorder is client-local (lost on reload). Wiring point:
`components/editor/editor-screen.tsx` `onMove` handler — one mutation call
to add.

## 4. Persist hook candidates — A2 (or contract addition)

Stage 3 produces 3 hook candidates; the SSE stream carries them, but no
procedure returns them afterwards, so the editor's hook switcher reads them
from localStorage (`components/editor/hook-store.ts`), falling back to
fixture candidates. Ideal fix: include `hookCandidates: HookCandidate[]` in
`script.get` output (contract change), or persist them on the hook section.
Wiring point: `components/editor/editor-screen.tsx` (`loadHookCandidates`).

## 5. Dependencies — A0 (package.json owner)

Nothing blocking; requested for polish:

- `lucide-react` — replace the hand-rolled icon set in
  `components/ui/icons.tsx` (API-compatible swap, all icons named).
- (optional) `@dnd-kit/core` + `@dnd-kit/sortable` — drag-handle reorder in
  the editor; keyboard/button reorder ships regardless.

## 6. PDF research uploads — A4/A0

`research.upload` takes text content, so the research screen accepts
`.txt`/`.md` only (read client-side). PDF needs a real multipart upload
route + server-side `pdf-parse` (spec §5.5). The intake card already
explains the limitation to users.

## 7. Note: `tests/home-page.test.ts` updated by A3

A0's test imported `@/app/page` (the Day-1 placeholder). That file became
the marketing landing page at `app/(marketing)/page.tsx` (A3-owned surface).
The test was updated in place to point at the new page and still asserts
branding renders from `PRODUCT_NAME`. Flagging since `tests/` is A0's dir.

## 8. OAuth channel-connect entry point — A1

The connect screens link the "Connect with Google" button to
`/api/auth/signin?callbackUrl=/channels`. When the real incremental-consent
flow exists, point me at its URL (or a procedure) and I'll swap the href in
`components/channels/connect-channel.tsx` (single location).
