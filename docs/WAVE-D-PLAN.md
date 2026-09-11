# Wave D+ — Subscribr-parity + chat-first

> Engineering owner: Claude/Fable. Grok Bot owns free-admin, seed-copy, golden-run taste, Resend/OAuth/Stripe. LLM stays Grok-only; the UI never says "Grok" — the chat persona is product-native ("Coach"). Additive only, exclusive worktrees, gates green before handoff.

## 1. Gap audit vs North Star (against main @ a969f2a)

| Capability | State | Notes |
|---|---|---|
| 12 archetype StyleCards + crossover | **done** | first-class; cold-start voices |
| Staged metered pipeline topics→outline→hooks→draft | **done** | itemized credits, idempotent, P0-fixed |
| Framing / research / editor / packaging screens | **done** | staged wizard UI |
| Multi-voice section overrides + licensed guard | **done** | guard fail-closed; flagged off until partners |
| Audience avatar from channel data | **partial** | generated + editable; not yet injected into every generation's context surface as a first-class block |
| Voice training from user's channel (`train_on_my_channel`) | **missing** | enum exists, REJECTED (server/modes.ts). Wave D2 builds it |
| Competitor-pattern → new original card (remix) | **missing** | crossover blends archetypes only; no channel-derived remix |
| Outlier/trend research UX | **partial** | backend outlier index + ideas feed exist; no pre-write "trend + search demand" surface |
| Unique angle field (steerable perspective) | **missing** | `angle` exists on frame/idea as free text, not an enforced non-generic driver |
| Fact-check research sync w/ surviving citations | **partial** | research docs + per-fact source URLs in pipeline; PDF binary upload still open (upload.ts note) |
| Dedicated hooks / retention / WPM caster / section regen / style gates | **done** | |
| Metadata packer (titles/thumbs/desc/tags/chapters) | **done** | preset thumbs, 3 desc modes |
| Light TEXT visual cues in script | **missing** | small; a draft-stage option, not an editor toolchain |
| Chat-first home surface | **missing** | app home is project list + staged wizard; no chat |
| Chat tool-calling to pipeline stages w/ metering | **missing** | core of D1 |

Out of scope (not building): video editing, dead-air/b-roll/caption-from-footage, AI avatars as production, unauthorized named-creator cloning, caption scraping.

## 2. Frozen contracts (D0 — freeze before parallel work)

### 2a. Chat threads & messages
- `chat_threads` table: id, workspace_id, project_id (nullable → workspace-level "coach"), title, created/updated. Tenancy-scoped.
- `chat_messages` table: id, thread_id, workspace_id (denormalized), role (`user`|`assistant`|`tool`), content (text), tool_calls jsonb (nullable), tool_call_id (nullable, links a tool result), credits_charged int default 0, created_at. Ordered by created_at + monotonic seq.
- Procedures (tRPC, additive): `chat.listThreads`, `chat.getThread` (messages page), `chat.createThread`, `chat.sendMessage` (SSE-streamed assistant reply; may emit tool-call proposals), `chat.confirmTool` (execute a proposed credit-costing tool after user confirm), `chat.renameThread`, `chat.deleteThread`.
- SSE event union for chat streaming: `message_delta`, `tool_proposed` (name+args+estimatedCredits), `tool_result`, `done`, `error`. Reuses the frozen SSE plumbing pattern.

### 2b. Chat tool-calling → existing pipeline (no business-logic duplication)
- A single `CHAT_TOOLS` registry (typed): `list_topics`, `make_outline`, `make_hooks`, `draft_section`/`draft_script`, `revise_section`, `make_titles`, `thumbnail_brief`, `fetch_research`. Each maps to the EXISTING stage handler/impl (import, never reimplement) with its existing `CREDIT_COSTS` and idempotent charging.
- Zero-cost tools (list/read) run inline; credit-costing tools go through `tool_proposed` → user confirm → `chat.confirmTool` → same `requireCreditsWithOverage` + idempotent ledger path as the staged UI. A chat tool call and the staged UI hitting the same stage with the same input share the idempotency key (no double charge).
- The chat's system context ALWAYS includes: active StyleCard (archetype|crossover|trained), audience avatar, research pack summary, unique angle, duration target — assembled by a pure `buildCoachContext(projectId)` helper.
- Persona: a product-native system prompt ("Coach"); the word "Grok"/"xAI" never appears in any user-facing string (copy-lint extended to fail on them).

### 2c. `train_on_my_channel` StyleCard derivation
- `voice_profiles.source` already has a slot; add derivation: `trainStyleCardFromChannel(channelId, sampleVideoIds?)` → pulls transcripts via TranscriptProvider (Supadata; NEVER caption scraping) → LLM derives a structured StyleCard (same frozen shape) → persists a `source="trained"` voice profile, first-class alongside archetypes. Consent-gated: explicit user action, records `trained_from_channel_id` + `trained_at`; never trains silently on private data.
- Competitor remix: `trainStyleCardFromChannel` with `remixFrom` = competitor channel(s) → derives an ORIGINAL card capturing structural patterns, run through the same seed-lint / no-named-creator guard; output card carries no real-person name. Distinct from licensed-voice path (which needs a signed license + the similarity guard).
- `VOICE_SOURCES` gains `"trained"`; `server/modes.ts` train_on_my_channel resolves a trained card instead of rejecting, once a trained card exists for the project's channel (else a clear "train a voice first" error).

## 3. Wave plan

- **D0 (contracts, solo, freeze):** chat tables + procedures + SSE union, CHAT_TOOLS registry + buildCoachContext, train derivation contract, VOICE_SOURCES += trained, copy-lint "no Grok/xAI in UI". Fixtures + stubs so chat renders keyless. Gates green.
- **D1 (chat shell + context + tool-calling) — BUILD FIRST for playtest:** chat home surface (project-scoped thread + optional workspace coach), streaming replies, system context assembly, tool proposals + confirm → real staged pipeline with metering, persona "Coach". Staged wizard stays for power users.
- **D2 (train-on-channel):** real `trainStyleCardFromChannel` + competitor remix, consent flow, trained cards first-class in the picker + chat context; wire train_on_my_channel mode end-to-end.
- **D3 (outlier/idea UX):** pre-write trend + search-demand surface (front the existing outlier index/ideas), promote into chat/project.
- **D4 (research depth + unique angle):** finish PDF binary upload (pdf-parse + upload endpoint), citations survive into script, unique-angle as an enforced non-generic driver in outline/draft prompts + a required steerable field.

## 4. Guardrails (unchanged, enforced)
Grok-only LLM; "Grok"/"xAI" never in UI (copy-lint); no named-creator claims without partner flag; seed-lint no real names; licensed guard stays fail-closed; metering through chat identical to staged (idempotent, no free-script regression); fixture mode works with zero keys; no free-admin (Grok Bot); no Railway secrets in repo.
