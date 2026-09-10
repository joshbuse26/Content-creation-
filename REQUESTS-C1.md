# REQUESTS-C1 — staged pipeline track (wave C)

Notes to the integrator and to C2/C3. Everything below is either a request
for a change I could not make in my own lane, or a heads-up about seams I
built for the other tracks.

## Requests (integrator action)

1. **`OPEN-ITEMS.md` — prune the C1 handoff bullet.** The "C1 (staged
   pipeline)" paragraph under "Wave C contracts pass" is fully delivered
   (real staged bodies, idempotency-keyed charges, crossover merge, partner
   resolution, channel-ownership + niche topics, orchestrator, both style
   gates). The file is integrator-owned, so I did not edit it.
2. **`tests/b2-mcp.test.ts` updated in my lane** (one test:
   "generate_script charges 6 credits…"). `script.generate` is now the
   staged orchestrator, so the MCP tool's ledger is itemized
   (−1/−1/−4, keys `outline:`/`hooks:`/`draft:`) instead of one −6 entry;
   the test now pins exactly that (sum still −6, all keyed, same actor).
   Flagging because the file is B2's — the change is assertion-shape only.
3. **Stage outputs are recomputed, not persisted.** `topics`/`outline`/
   `hooks` have no output table in the frozen schema; an identical
   re-submit finds the done run row, recomputes the response and the keyed
   charge dedupes (free). In LIVE mode that recompute re-calls Grok (still
   uncharged). If replaying stage outputs byte-identically ever matters, a
   `jsonb` output column on `pipeline_runs` (or the scripts hook/quality
   cache table already wished for in OPEN-ITEMS) would fix it — frozen-
   layer request, not made this wave.

## Heads-up for C2 (frontend)

- `script.draft` REJECTS (BAD_REQUEST, before charging) a chosen hook whose
  technique is not in the resolved card's `hookPatterns` — filter the hook
  picker to the card's techniques when a card is active.
- `script.hooks` candidates are already constrained to the card and the
  auto-picked one follows `hookPatterns[0]`; `hooks[i].autoPicked` marks it.
- `qualityReport.styleGates` sub-fields are now populated whenever a card
  exists; `hookPatternOk === null` still appears on recomputed reports
  after a web-process restart (hook cache gone) — keep rendering null as
  "not evaluated".
- A second identical staged call while one is in flight returns CONFLICT
  ("an identical run is already in progress") — treat as retry-later.

## Heads-up for C3 (golden/adversarial)

- Per-card readingLevel is a ONE-SIDED ceiling (grade > maxGrade fails;
  below-band only warns) — documented in DECISIONS and
  `pipelines/script/quality-gate.ts`; score sheets should read
  `styleGates.readingGrade` for the raw number.
- Stage metering surfaces to probe: `<stage>:<input hash>` idempotency keys
  (reason `script_generation`), per-stage `pipeline_runs` rows under kind
  `script` with stage names `topics`/`outline`/`hooks`, orchestrator
  itemization (−1/−1/−4), and the dispatch-time tenant checks (validation
  precedes `requireCreditsWithOverage` in all four stages).
- Partner registry in fixture mode is EMPTY by default
  (`pipelines/stages/partners.ts`); `setPartnerSourceForTests` /
  `InMemoryPartnerSource.set` seed it for adversarial runs.
