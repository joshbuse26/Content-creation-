# Product Contracts — Wave-0 frozen (read with the build spec + sprint plan)

> Same weight as the DB/API contracts: every agent implements against these; none invents around them. Product: mass-market app — pick an **archetype** (later: partnered named creator or crossover blend), generate the next video's script + thumbnail in that voice. Grok is the ONLY live LLM (`LLM_BACKEND=grok`); fixture twin stays. No fine-tuning in v1; no YouTube scraping for training data in this repo; unauthorized named-creator impersonation is not a feature.

## 1. StyleCard (first-class model, not a prompt blob)

Structured columns/typed JSON, all fields required unless noted:

- `voice` — POV, diction register, sentence rhythm (short text fields, not prose soup)
- `tone` — emotional register + what it never is (e.g. "warm, wry; never sarcastic at the viewer")
- `pacing` — words/min target, section-length norms, re-hook cadence seconds
- `hookPatterns` — ordered list of technique tags from the frozen hook-technique enum + per-pattern guidance
- `ctaHabits` — placement rule (timestamp %, after-payoff, end-only), phrasing style, max per video
- `bannedClaims` — list of claim types this style must never make (checked by machine gate, not vibes)
- `readingLevel` — target grade band (drives the Flesch gate per-style instead of the global ≥60)
- `energy` — 1–5
- `exampleSnippets` — 2–4 short ORIGINAL sample passages (seed copy supplied by Josh's content pipeline; placeholders `TODO(seed-copy)` until then — never paste real creators' words)
- `thumbnailPresetId` — FK to the preset keyed to the same archetype

Existing `voice_profiles.style_card` migrates INTO this shape (one shape for archetype cards and channel-learned cards; `source` distinguishes them).

## 2. Archetypes (seeded, never an empty DB)

12 original archetypes ship in seed + fixture data. IDs frozen:
`high-stakes-challenge`, `calm-explainer`, `data-storyteller`, `investigative-narrator`, `rapid-listicle`, `contrarian-essayist`, `hands-on-builder`, `friendly-coach`, `deadpan-comedian`, `hype-gamer`, `cozy-vlogger`, `story-time-confessional`.

Each is a StyleCard + display name + one-line pitch + thumbnail preset. They are GENERIC archetypes: no real creator's name, catchphrase, or signature wording anywhere in seed data or marketing copy. Copy fields left as `TODO(seed-copy)` placeholders where final copy is pending — do not invent fake famous people.

## 3. Modes (enum on script generation, feature-flagged)

- `archetype` — v1 default: one archetype id.
- `crossover` — blend of 2 archetypes with weights (0–1, sum 1); prompt layer merges style cards deterministically (documented merge rules, not "mix it").
- `partnered_named` — FLAGGED OFF (`FEATURE_PARTNERED_NAMED=false` default). Schema + plumbing may exist; UI hidden and server rejects when flag off. Requires a partner record with signed license fields (reuse the licensed-voice DB constraint pattern) before it can ever enable.
- `train_on_my_channel` — LATER. Not built in this wave beyond the enum value. Explicit-consent flow required before any user data trains/derives a card; no silent learning from private data.

## 4. Script pipeline — separate metered procedures (never one opaque call)

Staged, individually charged, individually streamable, all Grok-backed via the LlmProvider seam:

- `script.topics` — topic candidates for a channel/archetype (1 credit)
- `script.outline` — outline from chosen topic + style card (1 credit)
- `script.hooks` — 3 tagged hook candidates (1 credit)
- `script.draft` — full script from approved outline+hook, section-streamed (4 credits)
  Retention/voice/fact-check/quality passes stay inside `draft` (they are not user-facing stages). Each stage: `requireCreditsWithOverage` at dispatch, idempotent completion charge, resumable, SSE-streamable. The existing composite `generate` remains as an orchestrator that calls the stages in order (summed cost, itemized ledger entries) for MCP/one-click use — it may not bypass stage metering.

## 5. Thumbnail presets — keyed to archetype ids (pattern engine, never cloned frames)

One preset per archetype: composition rule (from the existing 20-pattern library), max overlay-text words, contrast rule (light-on-dark / dark-on-light / complementary), `face` (required | optional | none), palette temperature. Generation = preset + user subject → image prompt. Never reference or reproduce a real video's thumbnail; patterns are abstract rules only.

## 6. Golden-brief loop — machine gates + human hook

Machine gates (code, per-script, style-card-aware): hook length ≤30s AND matches an allowed hookPattern; CTA placement matches ctaHabits rule; duration within ±15% of target; readingLevel per card (not global); bannedClaims scan (fact-check stage flags + hard-fail on card's banned list); banned AI-ism list. Gate report persisted per script. Human hook: golden-run emits the scoring sheet with a per-brief 1–5 column + per-gate pass/fail for Josh; below 4.0 avg = prompt iteration before users see output.

## 7. Guardrails (enforced, tested)

- Marketing/product copy may never claim to "sound exactly like" / "write like" a named real creator unless that creator's partner flag is on — add a copy-lint test that scans app/(marketing) and UI strings for named-creator claim patterns.
- No scraping or bulk-downloading YouTube in this repo; ingest stays behind YoutubeProvider/TranscriptProvider + fixtures, at existing quota budgets.
- No secrets in repo/seeds/chat; env documented in LAUNCH-CHECKLIST only.
- Tenancy, idempotent credit charging, injection defense: same bars as before; adversarial pass after each wave covers credits, tenancy, script pipeline, thumbnails.
