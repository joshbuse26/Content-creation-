# REQUESTS-B2 — MCP surface (api keys · /api/mcp · settings panel)

Track B2, 2026-09-10. Everything below is wiring/decisions for the
integrator (A0); the code itself is self-contained and green
(typecheck · lint · format:check · 347 tests).

## Requested dependency (deferred, not blocking)

- **`@modelcontextprotocol/sdk`** — the official MCP server SDK. Not added
  (package.json untouched per sprint rules). The streamable-HTTP protocol is
  hand-rolled instead: JSON-RPC 2.0 over POST with `initialize`,
  `notifications/*`, `ping`, `tools/list`, `tools/call` (protocol revision
  2025-06-18, single messages only — batching was removed in that revision).
  The protocol layer is isolated in `server/mcp/protocol.ts` and the route is
  ~40 lines; swapping the SDK in later replaces only those two files —
  `server/mcp/tools.ts` (definitions + dispatch), `auth.ts` and `keys.ts` are
  transport-agnostic. Deliberately NOT built: server-initiated SSE streams
  (GET is 405), sessions/resumability, resources/prompts capabilities.

## Integrator wiring

1. **apiKeys router bodies** (`server/routers/_contracts.ts`, signatures
   untouched — same swap pattern as every other impl):

   ```ts
   import { apiKeysImpl } from "./impl/apiKeys";
   // list:   .query(({ ctx, input }) => apiKeysImpl.list({ ctx, input }))
   // create: .mutation(({ ctx, input }) => apiKeysImpl.create({ ctx, input }))
   // revoke: .mutation(({ ctx, input }) => apiKeysImpl.revoke({ ctx, input }))
   ```

   (Also drop the now-unused `fixtureApiKey` import there.)

2. **Settings mount** (files owned by A3/A0 — not created here):
   - `app/(app)/settings/api-keys/page.tsx`:

     ```tsx
     "use client";
     import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
     export default function SettingsApiKeysPage() {
       return <ApiKeysPanel />;
     }
     ```

   - Add `{ href: "/settings/api-keys", label: "API keys" }` to the `tabs`
     array in `app/(app)/settings/layout.tsx`.

   The panel self-gates (owner-only message for non-owners), so the tab can
   be visible to everyone or filtered by role — either works.

3. **generate_thumbnail reconciliation** (parallel image-gen track): the MCP
   tool currently returns the packaging TEXT brief
   (`buildThumbnailBrief`) with an explicit "text brief only, no credits
   charged" note — matching the current thumbnails router stub. When image
   generation lands, point the `generate_thumbnail` case in
   `server/mcp/tools.ts` at the real thumbnails impl (same
   caller-dispatch pattern as generate_titles); the 1-credit/image charge
   then comes along for free from the shared pipeline.

## Decisions worth knowing (flag to Josh if wrong)

- **Scopes = tool names.** `api_keys.scopes` holds MCP tool names (matches
  the seeded fixture key); `apiKeys.create` rejects anything else.
  `channel_ids` scopes channels; **empty = all channels in the workspace**
  (the frozen contract defaults `channelIds` to `[]`).
- **MCP calls act as the workspace owner.** The frozen schema has no user
  column on api_keys and keys are owner-only to create, so each call
  resolves the workspace's owner and dispatches through a tRPC caller —
  same authz, per-procedure rate limits, `requireCredits` gating and
  idempotent completion charges as the web app; zero duplicated logic. The
  owner is the `actor_user_id` on ledger entries.
- **"Every call writes credit_ledger" (spec §6) is implemented as: every
  credit-charging call writes the ledger** (via the shared pipelines,
  idempotency-keyed). Zero-cost reads write no rows: `credit_reason` is a
  frozen enum with no zero-cost/MCP value, and zero-delta spam would fight
  the nightly reconciliation. If per-call audit rows are genuinely wanted,
  that needs a frozen-layer change (new enum value or an mcp_calls table).
- **List shows a TRUE key prefix without storing plaintext**: secrets are
  `gr_live_<first-8-hex-of-row-uuid>_<32-bytes-base64url>`, so the UI derives
  `gr_live_xxxxxxxx…` from the row id alone (`server/mcp/key-format.ts`).
  Only the SHA-256 hash is stored (`hashed_key`); the plaintext is returned
  once from `create` and never again.
- **Revoked keys stay listed** (revoked badge) and 401 immediately;
  revocation is idempotent. Invalid and revoked keys get the same generic
  401 message.
- **Rate limiting**: the route enforces the `general` policy per key
  (`mcp-key:<id>` subject) BEFORE dispatch; generation tools additionally
  hit the `generation` (10/min) policy inside their tRPC procedures.
- **Fixture mode**: the in-memory key store seeds the fixture key with the
  documented secret `FIXTURE_MCP_API_KEY_SECRET` (`server/mcp/keys.ts`), so
  `/api/mcp` is callable zero-env (e.g. from Claude Code) out of the box —
  fixture key is read-only scoped (get_channel_stats, get_idea_feed,
  get_script). Never used when a DATABASE_URL is configured.
