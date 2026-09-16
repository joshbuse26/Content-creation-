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
