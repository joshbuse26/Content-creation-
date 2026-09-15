# Coach reliability (F0) — root cause, fixes, playtest path

**Status:** P0 fixed on `track/f0`. Production symptom: "Coach won't load" — a
flood of `chat.listThreads` + `chat.getThread` `TOO_MANY_REQUESTS` in the same
millisecond, then `chat.sendMessage` 429s too.

## Root cause — a render→invalidate loop (not polling)

1. `useChatStream()` returned `{ state, start, reset }` as a **fresh object
   every render**. `ChatThreadView` had a `useEffect` with `stream` in its deps,
   so the effect re-ran on every render.
2. That effect, whenever `stream.state.phase === "done"`, called `refetch()`,
   which invalidated **both** `getThread` and `listThreads`. Invalidate →
   refetch → new data → render → effect re-runs (phase still `"done"`) →
   invalidate again. The 150 ms `stream.reset()` timer that would have ended
   the loop was **cleared by the effect cleanup on every re-run**, so it never
   fired while renders arrived faster than 150 ms. Self-sustaining, two
   invalidations per tick.
3. The global `retry: 1` retried every 429, so each loop tick cost ~4 requests.
4. `listThreads`, `getThread` and `sendMessage` all shared the `general`
   bucket (100/min per user). The read storm filled it, so **sending** was
   rate-limited as well — the user-visible outage.
5. `refetch()` also invalidated `listThreads` on confirmTool / rename / every
   send (needless), and `/api/chat-stream` had **no hard deadline** — a stalled
   provider hung the browser on a typing indicator.

## Fixes (each tied to a step above)

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Files                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `useChatStream` returns a **memoized** object and exposes a monotonic `state.completionId` (bumps once per transition into done/error). Any transport error is terminal (no EventSource auto-reconnect, which would re-run the turn); a drop before any reply text is an _error_, not a blank "done".                                                                                                                                                            | `components/chat/use-chat-stream.ts`                                                                                   |
| 2   | `ChatThreadView` reconciles **exactly once per completion**, keyed on `completionId` via a ref. `refetchThread()` invalidates **`getThread` only**. `listThreads` is invalidated only on createThread / renameThread / deleteThread. The live overlay is _derived_ from stream state (no mirrored state, no timer) and clears declaratively once the persisted assistant message id is in the thread. Optimistic user bubble keyed on the ack's `userMessageId`. | `components/chat/chat-panel.tsx`                                                                                       |
| 3   | `chat.listThreads` is hoisted into **`ChatThreadsProvider`** — one query per surface (Coach page / project chat page); the panel and its sidebar read context. `getThread` fetches on thread change only; `staleTime` 30 s, no focus/reconnect refetch, no interval.                                                                                                                                                                                             | `components/chat/chat-threads-context.tsx`, `app/(app)/coach/page.tsx`, `app/(app)/projects/[projectId]/chat/page.tsx` |
| 4   | QueryClient `retry` is a function that **never retries `TOO_MANY_REQUESTS`** (`shouldRetryQuery`). On a 429 the chat UI stops and shows one "Taking a breath" notice with a manual **Retry**; automatic retries back off 1 s → 2 s → 4 s → 8 s and the circuit **breaks after 5 consecutive 429s** (paused state, manual retry only).                                                                                                                            | `components/providers/query-client.ts`, `components/providers/app-providers.tsx`, `components/chat/rate-limit.tsx`     |
| 5   | Send flow: optimistic user bubble → `sendMessage` ack → EventSource on `streamPath` → `message_delta` / `tool_proposed` → done/error → one `getThread` refetch. Explicit empty / error / rate-limited / streaming states; a 429 on send is a toast, never a loop.                                                                                                                                                                                                | `components/chat/chat-panel.tsx`                                                                                       |
| 6   | **Hard deadline** on the assistant turn (`CHAT_TURN_DEADLINE_MS`, default 60 s): the provider call races a timer (the research `guardedFetch` pattern) and the provider gets the same `timeoutMs`. Past the deadline the turn emits a terminal `error` SSE event and the stream closes — even if the provider ignores abort. Provider failures emit product copy, never vendor text.                                                                             | `server/chat/turn.ts`, `lib/config.ts`                                                                                 |
| 7   | Live-provider path asserted: under `PROVIDERS=live` + `LLM_BACKEND=grok`, `getProviders()` selects `GrokLlm`, engine deps report `mode: "live"`, and `runAssistantTurn` calls `llm.complete` (not the fixture synth). `GrokLlm` logs failed responses with status + body truncated to 500 chars; the API key is never logged.                                                                                                                                    | `lib/providers/live/grok.ts`, `tests/f0-chat-turn.test.ts`                                                             |
| 8   | New **`chatRead` rate-limit policy (300/min per user)** on `listThreads` / `getThread`; `sendMessage` / `confirmTool` / create / rename / delete stay on `general`. A read burst can no longer lock out sending.                                                                                                                                                                                                                                                 | `server/ratelimit/policies.ts`, `server/routers/_contracts.ts`                                                         |

## Request budget (what the tests pin)

- Open the Coach: `listThreads` ×1, `getThread` ×1.
- Send a message: `sendMessage` ×1, `/api/chat-stream` ×1, `getThread` ×1
  (after `done`). `listThreads` ×0.
- Remount the surface 10×: `listThreads` ×1 (cache + staleTime).
- 429 on a read: notice shown, retries at 1/2/4/8 s, then paused —
  5 requests total, then 0 until the user clicks Retry.

## Tests

- `tests/f0-chat-panel.test.tsx` (7) — real `ChatPanel` + real tRPC batch
  link + real QueryClient policy against a counting fake transport and a fake
  `EventSource`: 429 affordance + backoff + circuit-break (listThreads and
  getThread), 10× remount budget, stream completion → one `getThread` /
  zero `listThreads`, stream drop → error not blank.
- `tests/f0-chat-turn.test.ts` (11) — `withTurnDeadline`, stalled provider →
  `error` event + closed SSE stream within the deadline, config default,
  provider failure copy, fixture-mode SSE smoke (send → deltas → done, keyless),
  live provider selection (`GrokLlm`, `mode: "live"`, synth not used),
  truncated-body failure logging, `chatRead` policy wiring.

## Live playtest path

1. Sign in → **Coach** (workspace-level). Network tab: one `chat.listThreads`,
   one `chat.getThread`, no 429s.
2. Send: **"Give me 5 hooks for a tech explainer about phone batteries"**.
3. Expect the user bubble immediately, typing dots, first tokens within ~2 s
   (live Grok), the full reply, then the overlay swaps for the persisted
   message with no flicker/duplicate. Network: `chat.sendMessage` ×1,
   `/api/chat-stream` ×1, `chat.getThread` ×1 after `done`. **No 429s.**
4. If the provider stalls: after `CHAT_TURN_DEADLINE_MS` the stream closes and
   a toast says "The coach took too long to answer. Try again in a moment."
   The composer is enabled again — no infinite spinner.
5. To see the 429 path deliberately: throttle `chatRead` (policies.ts) to a
   tiny limit locally — the panel shows "Taking a breath", retries at
   1/2/4/8 s, then pauses with a manual Retry.

## Notes for the next engineer

- The `general` bucket still covers `/api/chat-stream` opens (keyed by
  user+IP) and `sendMessage`; that is intentional — writes and stream opens
  are what we want to throttle.
- Base branch note: 6 tests in `b1-daily-ideas` / `b1-ideas-handlers` /
  `e3-competitor-compare` fail on the base commit (`fix(ideas): make on-demand
idea batches free for playtest`) before any F0 change — they assert the old
  1-credit charge. Out of F0 scope (credits); not touched.
