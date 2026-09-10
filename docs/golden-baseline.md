# Golden-set scoring sheet

> Baseline regenerated 2026-09-10 (wave-C integration) via `PROVIDERS=fixture pnpm exec tsx scripts/golden-run.ts --out docs/golden-baseline.md`. Golden loop v2 on the REAL staged pipeline (C1): archetype/crossover briefs run outline → hooks → draft through the production stage handlers (topics skipped — the brief is the topic), the legacy brief runs the v1 7-stage pipeline. HookPat/ReadLvl columns are now evaluated, and the meal-prep-myths CTA canary passes (fixture outline honors the card's ctaHabits placement). Fixture-mode output measures pipeline mechanics, not writing quality — regenerate with `PROVIDERS=live` once keys exist and score 1–5 per brief. Diff a new run against this file with `--compare docs/golden-baseline.md`.

- Date: 2026-09-10T19:14:18.361Z
- Providers: fixture · Prompt version: 2026-09-10.2
- Scoring: 1 = unusable · 2 = heavy rewrite · 3 = usable with edits · 4 = light edits · 5 = shoot it as-is
- Style gate columns (frozen styleGateReportSchema): HookPat = hook technique ∈ card.hookPatterns · CTA = placement matches ctaHabits · ReadLvl = reading grade in the card's band · Claims = bannedClaims scan. n/e = typed but not evaluated yet (C1 fills hookPattern/readingLevel); - = no style card in play.

| Brief                  | Mode                                  | Hook (style)                                                                            | Words | Runtime | Gate | HookPat | CTA  | ReadLvl | Claims | Flags                                                                            | Wall clock | Score (1-5) |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ----- | ------- | ---- | ------- | ---- | ------- | ------ | -------------------------------------------------------------------------------- | ---------- | ----------- |
| budget-espresso        | data-storyteller                      | Most of what you have heard about this is wrong, and I can show you wh… (bold_claim)    | 1883  | 12:33   | pass | pass    | pass | pass    | pass   | Reading grade 3.2 sits below the card's grade 8-11 band — simpler than target (n | 0.1s       |             |
| learn-piano-adult      | friendly-coach                        | There is one result in this test I still cannot fully explain. Learnin… (open_loop)     | 1517  | 10:07   | pass | pass    | pass | pass    | pass   | Reading grade 3.5 sits below the card's grade 5-8 band — simpler than target (no | 0.0s       |             |
| meal-prep-myths        | rapid-listicle                        | Most of what you have heard about this is wrong, and I can show you wh… (bold_claim)    | 1232  | 8:13    | pass | pass    | pass | pass    | pass   | Reading grade 3.5 sits below the card's grade 5-7 band — simpler than target (no | 0.0s       |             |
| shed-office-build      | hands-on-builder×calm-explainer (0.6) | Round three. The cheap one is still standing, the expensive one is smo… (in_medias_res) | 2203  | 14:41   | pass | pass    | pass | pass    | pass   | Reading grade 3.3 sits below the card's grade 6-9 band — simpler than target (no | 0.0s       |             |
| phone-battery-myths    | contrarian-essayist                   | Most of what you have heard about this is wrong, and I can show you wh… (bold_claim)    | 1436  | 9:34    | pass | pass    | pass | pass    | pass   | Reading grade 3.3 sits below the card's grade 9-12 band — simpler than target (n | 0.0s       |             |
| vintage-camera-revival | legacy                                | There is one result in this test I still cannot fully explain. I shot … (open_loop)     | 1750  | 11:40   | pass | pass    | pass | pass    | pass   | Reading grade 3.3 sits below the card's grade 6-9 band — simpler than target (no | 0.0s       |             |

---

## budget-espresso — Budget espresso setup vs. the $2k rig

**Mode:** data-storyteller

**Hook (bold_claim):**

> Most of what you have heard about this is wrong, and I can show you where. Budget espresso setup vs. the $2k rig: I tested it under real conditions, and the winner is not the obvious one. I put that idea through a real test, wrote down every number, and the winner is not the one the internet keeps telling you to buy.

**Top titles:**

- [82] One Week, One Rule: Budget espresso setup vs. the $2k rig Only _(challenge)_
- [81] The Truth About Budget espresso setup vs. the $2k rig _(curiosity_gap)_
- [81] 7 Budget espresso setup vs. the $2k rig Myths, Tested _(listicle)_

**Style gates:**

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.2)
- bannedClaims: pass

**Flags:**

- Reading grade 3.2 sits below the card's grade 8-11 band — simpler than target (not a failure).
- 11 unsupported claim(s)

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

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.5)
- bannedClaims: pass

**Flags:**

- Reading grade 3.5 sits below the card's grade 5-8 band — simpler than target (not a failure).
- 9 unsupported claim(s)

**Notes / score:**

_(write here)_

## meal-prep-myths — Seven meal prep rules I stopped following

**Mode:** rapid-listicle

**Hook (bold_claim):**

> Most of what you have heard about this is wrong, and I can show you where. Seven meal prep rules I stopped following: I tested it under real conditions, and the winner is not the obvious one. I put that idea through a real test, wrote down every number, and the winner is not the one the internet keeps telling you to buy.

**Top titles:**

- [81] I Tested Seven meal prep rules I stopped followin So You Don't Have To _(confession)_
- [81] My Seven meal prep rules I stopped followin Mistake Cost Me $400 _(confession)_
- [79] Why the Worst Seven meal prep rules I stopped followin Pick Won _(contrarian)_

**Style gates:**

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.5)
- bannedClaims: pass

**Flags:**

- Reading grade 3.5 sits below the card's grade 5-7 band — simpler than target (not a failure).
- 13 unsupported claim(s)

**Notes / score:**

_(write here)_

## shed-office-build — Turning a garden shed into an office for under $900

**Mode:** hands-on-builder×calm-explainer (0.6)

**Hook (in_medias_res):**

> Round three. The cheap one is still standing, the expensive one is smoking, and I am staring at my notes wondering what I got wrong. Turning a garden shed into an office for under $900: I tested it under real conditions, and the winner is not the obvious one — that is how this started, three days and one ruined afternoon ago.

**Top titles:**

- [83] 3 Turning a garden shed into an office for Upgrades That Actually Matter _(listicle)_
- [79] I Tested Turning a garden shed into an office for So You Don't Have To _(confession)_
- [75] Never Trust a Turning a garden shed into an office for Review Again _(negative_command)_

**Style gates:**

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.3)
- bannedClaims: pass

**Flags:**

- Reading grade 3.3 sits below the card's grade 6-9 band — simpler than target (not a failure).
- 14 unsupported claim(s)

**Notes / score:**

_(write here)_

## phone-battery-myths — Why your phone battery advice is a decade out of date

**Mode:** contrarian-essayist

**Hook (bold_claim):**

> Most of what you have heard about this is wrong, and I can show you where. Why your phone battery advice is a decade out of date: I tested it under real conditions, and the winner is not the obvious one. I put that idea through a real test, wrote down every number, and the winner is not the one the internet keeps telling you to buy.

**Top titles:**

- [79] Stop Overpaying for Why your phone battery advice is a decad _(negative_command)_
- [79] I Was Wrong About Why your phone battery advice is a decad _(confession)_
- [79] My Why your phone battery advice is a decad Mistake Cost Me $400 _(confession)_

**Style gates:**

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.3)
- bannedClaims: pass

**Flags:**

- Reading grade 3.3 sits below the card's grade 9-12 band — simpler than target (not a failure).
- 7 unsupported claim(s)

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

- hookPattern: pass
- ctaPlacement: pass (1 CTA)
- readingLevel: pass (grade 3.3)
- bannedClaims: pass

**Flags:**

- Reading grade 3.3 sits below the card's grade 6-9 band — simpler than target (not a failure).
- 9 unsupported claim(s)

**Notes / score:**

_(write here)_
