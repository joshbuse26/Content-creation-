# REQUESTS-C3 — thumbnails/golden/guardrails track (wave C)

Integrator notes + frozen-layer requests from C3. Everything below is either
a request for a frozen-surface change or a seam another track should know
about; the work itself is done and green.

## Frozen-layer requests

1. **`overlayText` on `thumbnails.generate`** (additive input field,
   `z.string().max(200).nullable().default(null)`). The pipeline and job
   payload (`pipelines/thumbnails/jobs.ts`) already accept and cap-enforce
   overlay text against the archetype preset's `maxOverlayWords`
   (reject-with-clear-error, never silent truncation —
   `pipelines/thumbnails/presets.ts`), and it is folded into the input hash.
   The frozen contract has no field for it, so the router passes `null`
   today; exposing user-supplied overlay text needs this contract addition.

## Additive conventions (no schema change needed)

- **`compositionPattern: "auto"`** on `thumbnails.generate` means "use the
  project archetype's preset pattern" (`AUTO_COMPOSITION_PATTERN`,
  `pipelines/thumbnails/presets.ts`). The frozen contract requires a
  non-empty pattern string, so the preset default rides this sentinel. Any
  explicit pattern id is a user override and wins — the preset is the
  default, not a cage. `"auto"` on a project with no archetype/crossover is
  a clear BAD_REQUEST. **C2:** send `"auto"` by default for archetype
  projects; keep the pattern picker as the override.
- **Crossover thumbnail preset: the heavier archetype's preset wins whole**
  (`weightA >= 0.5` → `a`, tie included — same deterministic rule as the C0
  style-card stub). Presets are discrete composition rules; blending two
  patterns is meaningless. **C1:** if your documented style-card merge rules
  pick a different tie-break, update `resolveThumbnailPreset` to match so
  card and preset never disagree about which archetype "won".

## Golden loop v2 seams (C1 especially)

- Archetype/crossover briefs run the STAGED path by calling the real stage
  handlers (`scriptStagesImpl.outline/hooks/draft`) with the brief as the
  chosen topic (topics stage skipped). When C1 replaces the stub bodies,
  `golden-run` exercises the real staged pipeline with zero changes.
- The `HookPat` and `ReadLvl` sheet columns render `n/e` today because the
  frozen report's `hookPatternOk`/`readingLevelOk` are typed-null until C1
  computes them. They will fill in (and `--compare` will start diffing
  them) automatically.
- Known fixture-mode gate failure, kept on purpose: `meal-prep-myths`
  (rapid-listicle) FAILs CTA placement — the fixture draft puts the CTA at
  the end, the card wants ~30%. It is a canary: C1's real draft stage
  should place CTAs per the card and flip that cell to `pass`.
- The staged path goes through the production credit gate
  (`requireCreditsWithOverage`). Keyless runs use the in-memory fixture
  workspace; a DB-backed golden run needs the seeded fixture workspace
  (`pnpm seed`).

## Guardrails

- **Copy-lint coverage checked, no extension needed:** scanned `lib/`,
  `pipelines/`, `prompts/`, `server/`, `scripts/`, `app/`, `runbooks/`,
  `worker/`, `queue/`, `db/` for C0's named-creator claim patterns — zero
  matches outside the dirs `tests/copy-lint.test.ts` already scans
  (`app/(marketing)`, `components`). C0's test is untouched.
- **Seed-data lint** (`tests/c3-seed-lint.test.ts`): archetype seeds +
  fixture content (`lib/fixtures/index.ts`,
  `pipelines/script/fixture-content.ts`, `scripts/seed.ts`) are scanned for
  famous-creator names (denylist — never allowlistable) and
  name-shaped strings (heuristic — reviewed false positives live in
  `tests/seed-lint.allowlist.json`), and `exampleSnippets` are capped at
  400 chars. **Whoever lands Josh's real seed copy (`TODO(seed-copy)`):**
  the new copy must keep this test green — real-person names will fail it
  by design, and snippets must stay ≤ 400 chars.
- `runbooks/partnered-mode-enable.md` is the ops checklist for ever
  enabling `FEATURE_PARTNERED_NAMED` (signed license → partner row with
  license fields → flag → copy-lint `partnerAllowlist` entry). The flag
  stays off without licenses; the partners table deliberately has no
  routers.
