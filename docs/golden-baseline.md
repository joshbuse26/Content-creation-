# Golden baseline — fixture mode

> Generated 2026-09-10 via `PROVIDERS=fixture pnpm exec tsx scripts/golden-run.ts --out docs/golden-baseline.md`. Golden loop v2: briefs carry archetype/crossover targets and run the STAGED pipeline path (topics skipped — the brief is the topic; outline → hooks → draft through the stage handlers), the legacy brief runs the v1 7-stage pipeline, and the sheet carries the per-gate style columns from the frozen `styleGateReportSchema`. Fixture-mode output measures pipeline mechanics, not writing quality — regenerate with `PROVIDERS=live` once keys exist and score 1–5 per brief. Diff a new run against this file with `--compare docs/golden-baseline.md`. `n/e` columns (hookPattern, readingLevel) fill in when C1 lands the real staged pipeline.

# Golden-set scoring sheet

- Date: 2026-09-10T18:34:58.456Z
- Providers: fixture · Prompt version: 2026-09-10.1
- Scoring: 1 = unusable · 2 = heavy rewrite · 3 = usable with edits · 4 = light edits · 5 = shoot it as-is
- Style gate columns (frozen styleGateReportSchema): HookPat = hook technique ∈ card.hookPatterns · CTA = placement matches ctaHabits · ReadLvl = reading grade in the card's band · Claims = bannedClaims scan. n/e = typed but not evaluated yet (C1 fills hookPattern/readingLevel); - = no style card in play.

| Brief                  | Mode                                  | Hook (style)                                                                        | Words | Runtime | Gate | HookPat | CTA  | ReadLvl | Claims | Flags                                                       | Wall clock | Score (1-5) |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- | ----- | ------- | ---- | ------- | ---- | ------- | ------ | ----------------------------------------------------------- | ---------- | ----------- |
| budget-espresso        | data-storyteller                      | There is one result in this test I still cannot fully explain. Budget … (open_loop) | 1798  | 11:59   | pass | n/e     | pass | n/e     | pass   | none                                                        | 0.0s       |             |
| learn-piano-adult      | friendly-coach                        | There is one result in this test I still cannot fully explain. Learnin… (open_loop) | 1503  | 10:01   | pass | n/e     | pass | n/e     | pass   | none                                                        | 0.0s       |             |
| meal-prep-myths        | rapid-listicle                        | There is one result in this test I still cannot fully explain. Seven m… (open_loop) | 1209  | 8:04    | FAIL | n/e     | FAIL | n/e     | pass   | First CTA lands at ~93% of runtime; card targets 30% (±15). | 0.0s       |             |
| shed-office-build      | hands-on-builder×calm-explainer (0.6) | There is one result in this test I still cannot fully explain. Turning… (open_loop) | 2114  | 14:06   | pass | n/e     | pass | n/e     | pass   | none                                                        | 0.0s       |             |
| phone-battery-myths    | contrarian-essayist                   | There is one result in this test I still cannot fully explain. Why you… (open_loop) | 1361  | 9:04    | pass | n/e     | pass | n/e     | pass   | none                                                        | 0.0s       |             |
| vintage-camera-revival | legacy                                | There is one result in this test I still cannot fully explain. I shot … (open_loop) | 1728  | 11:31   | pass | n/e     | pass | n/e     | pass   | 6 unsupported claim(s)                                      | 0.0s       |             |

---

## budget-espresso — Budget espresso setup vs. the $2k rig

**Mode:** data-storyteller

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. Budget espresso setup vs. the $2k rig: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [82] One Week, One Rule: Budget espresso setup vs. the $2k rig Only _(challenge)_
- [81] The Truth About Budget espresso setup vs. the $2k rig _(curiosity_gap)_
- [81] 7 Budget espresso setup vs. the $2k rig Myths, Tested _(listicle)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: pass (1 CTA)
- readingLevel: n/e
- bannedClaims: pass

**Notes / score:**

_(write here)_

## learn-piano-adult — Learning piano from zero at 35 — what actually worked

**Mode:** friendly-coach

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. Learning piano from zero at 35 — what actually worked: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [83] The Learning piano from zero at 35 — what ac Test Everyone Refuses to Run _(curiosity_gap)_
- [81] Don't Buy Learning piano from zero at 35 — what ac Until You See This _(negative_command)_
- [81] Get Better Learning piano from zero at 35 — what ac Results for Half the Price _(outcome_promise)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: pass (1 CTA)
- readingLevel: n/e
- bannedClaims: pass

**Notes / score:**

_(write here)_

## meal-prep-myths — Seven meal prep rules I stopped following

**Mode:** rapid-listicle

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. Seven meal prep rules I stopped following: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [81] I Tested Seven meal prep rules I stopped followin So You Don't Have To _(confession)_
- [81] My Seven meal prep rules I stopped followin Mistake Cost Me $400 _(confession)_
- [79] Why the Worst Seven meal prep rules I stopped followin Pick Won _(contrarian)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: FAIL (1 CTA)
- readingLevel: n/e
- bannedClaims: pass
  - First CTA lands at ~93% of runtime; card targets 30% (±15).

**Flags:**

- First CTA lands at ~93% of runtime; card targets 30% (±15).

**Notes / score:**

_(write here)_

## shed-office-build — Turning a garden shed into an office for under $900

**Mode:** hands-on-builder×calm-explainer (0.6)

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. Turning a garden shed into an office for under $900: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [83] 3 Turning a garden shed into an office for Upgrades That Actually Matter _(listicle)_
- [79] I Tested Turning a garden shed into an office for So You Don't Have To _(confession)_
- [75] Never Trust a Turning a garden shed into an office for Review Again _(negative_command)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: pass (1 CTA)
- readingLevel: n/e
- bannedClaims: pass

**Notes / score:**

_(write here)_

## phone-battery-myths — Why your phone battery advice is a decade out of date

**Mode:** contrarian-essayist

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. Why your phone battery advice is a decade out of date: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [79] Stop Overpaying for Why your phone battery advice is a decad _(negative_command)_
- [79] I Was Wrong About Why your phone battery advice is a decad _(confession)_
- [79] My Why your phone battery advice is a decad Mistake Cost Me $400 _(confession)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: pass (1 CTA)
- readingLevel: n/e
- bannedClaims: pass

**Notes / score:**

_(write here)_

## vintage-camera-revival — I shot a wedding on a $30 flea-market camera

**Mode:** legacy

**Hook (open_loop):**

> There is one result in this test I still cannot fully explain. I shot a wedding on a $30 flea-market camera: I tested it under real conditions, and the winner is not the obvious one — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.

**Top titles:**

- [83] I shot a wedding on a $30 flea-market ca on a $200 Budget: Full Test _(challenge)_
- [81] I shot a wedding on a $30 flea-market ca: Cheap vs Expensive, Tested _(versus)_
- [81] The I shot a wedding on a $30 flea-market ca Test Everyone Refuses to Run _(curiosity_gap)_

**Style gates:**

- hookPattern: n/e
- ctaPlacement: pass (1 CTA)
- readingLevel: n/e
- bannedClaims: pass

**Flags:**

- 6 unsupported claim(s)

**Notes / score:**

_(write here)_
