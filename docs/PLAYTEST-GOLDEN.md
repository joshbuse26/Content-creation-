# Playtest: live golden-run checklist (Josh)

> Sample briefs in `scripts/golden-briefs.json` (~10) span common YouTube niches + archetype coverage. Swap any title/query for your real channel topics before treating scores as ship/no-ship. Fixture mode measures pipeline mechanics only — **live** is the taste pass.

## Score rubric (sheet column `Score (1-5)`)

| Score | Meaning |
| ----- | ------- |
| 1 | Unusable |
| 2 | Heavy rewrite |
| 3 | Usable with edits |
| 4 | Light edits |
| 5 | Shoot it as-is |

**Ship bar:** average ≥ **4.0**. Below 4.0 → prompt iteration in `prompts/` before users see output (PRODUCT-CONTRACTS §6).

## Env for live (cost-bearing)

Local `.env` defaults to `PROVIDERS=fixture` (no keys, no credits). For a real taste run set:

- `PROVIDERS=live`
- `LLM_BACKEND=grok` (product LLM path; UI must never say Grok/xAI)
- `XAI_API_KEY` — required when `LLM_BACKEND=grok`
- `GOOGLE_API_KEY`
- `TRANSCRIPT_API_KEY`
- `SEARCH_API_KEY`
- `IMAGE_API_KEY` — required by live config even if this run skips thumbs
- optional: `XAI_MODEL_MAIN`, `XAI_MODEL_FAST` (defaults in `lib/config.ts`)

See `.env.example` for the full list. Live config throws at startup if any required key is missing.

**Cost risk:** each brief runs research → frames → outline/hooks/draft (or legacy 7-stage) → titles against live models + search/transcript. Ten briefs ≈ a full golden suite — expect meaningful provider spend. Prefer one smoke brief first (below).

## Commands

From repo root (`~/Downloads/content-creation`):

```bash
# 0) Fixture dry-run (free, deterministic — verifies script loads + sheet shape)
PROVIDERS=fixture pnpm exec tsx scripts/golden-run.ts --out /tmp/golden-fixture.md

# 1) Smoke one live brief (1-element JSON)
PROVIDERS=live pnpm exec tsx scripts/golden-run.ts /tmp/one-brief.json --out /tmp/golden-smoke.md

# 2) Full live golden set → scoring sheet
PROVIDERS=live pnpm exec tsx scripts/golden-run.ts --out docs/golden-live-YYYYMMDD.md

# 3) Diff gate pass-rates vs fixture baseline (pipeline regression, not taste)
PROVIDERS=live pnpm exec tsx scripts/golden-run.ts \
  --out /tmp/golden-live.md \
  --compare docs/golden-baseline.md
```

Also accepts: `pnpm exec tsx scripts/golden-run.ts [briefs.json] [--out results.md] [--compare baseline.md]`.

Default briefs path: `scripts/golden-briefs.json`.

### One-brief smoke file example

Write a single-element array matching the brief schema (copy one object from `scripts/golden-briefs.json`), save as `/tmp/one-brief.json`, then run the smoke command above.

## How to score

1. Open the emitted markdown sheet (`--out …`).
2. For each brief: read the hook block, top titles, style-gate row, and flags.
3. Fill the blank **Score (1-5)** table cell and the **Notes / score** section under that brief.
4. Compute the average across all scored briefs.

Machine columns (`Gate`, `HookPat`, `CTA`, `ReadLvl`, `Claims`) are auto; they do **not** replace your 1–5 taste score.

## What to paste back to Claude (when avg < 4.0)

Paste this package so prompts can be iterated without re-running discovery:

1. **Average score** + per-brief scores (table excerpt is enough).
2. For each brief **≤3**: the hook quote, top titles, style-gate fails, and your 1–3 sentence note on *what felt wrong* (generic, wrong register, weak open, CTA awkward, claims soft, etc.).
3. Prompt version line from the sheet header (`Prompt version: …`).
4. `PROVIDERS` + whether `LLM_BACKEND=grok`.
5. Any briefs you customized (id + title) so Claude does not assume the sample set.

Do **not** paste API keys. Do not ask Claude to change free-admin, train-on-channel, or Coach persona branding in this loop — golden taste work stays in `prompts/` + style gates.

## Sample brief coverage (replace freely)

| id | Niche flavor | Mode |
| -- | ------------ | ---- |
| budget-espresso | Consumer tech / gear | data-storyteller |
| learn-piano-adult | Education / skills | friendly-coach |
| meal-prep-myths | Food / habits | rapid-listicle |
| shed-office-build | DIY / home | hands-on-builder×calm-explainer |
| phone-battery-myths | Tech myths | contrarian-essayist |
| vintage-camera-revival | Creative / gear | legacy (no archetype) |
| cold-plunge-30d | Fitness / challenge | high-stakes-challenge |
| olive-oil-supply-chain | Investigative consumer | investigative-narrator |
| smart-home-chaos | Tech comedy | deadpan-comedian |
| bronze-to-diamond | Gaming / ranked | hype-gamer |

Not in this sample set (easy swaps): `cozy-vlogger`, `story-time-confessional`, solo `calm-explainer`.

## Brief JSON shape

```json
{
  "id": "kebab-id",
  "title": "Video working title",
  "researchQuery": "search-y query for research stage",
  "targetMinutes": 10,
  "archetypeId": "friendly-coach"
}
```

- Set **either** `archetypeId` **or** `crossover` (`{ "a", "b", "weightA" }`), not both.
- Omit both mode fields → legacy 7-stage script path.
- Archetype/crossover briefs skip topics (brief *is* the topic) and run staged outline → hooks → draft.

## Guardrails for this playtest

- No Grok/xAI in any user-facing UI copy (keys/env only).
- Do not touch free-admin, train-on-channel, or Coach persona branding while iterating golden taste.
