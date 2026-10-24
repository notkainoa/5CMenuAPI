# Grouped menu highlights

The user wants distinct meal offerings, with up to five highlights per meal. A named Italian service can cover its pasta, meatballs and sauces. Genuine alternatives such as chicken and beef bulgogi can share a short title. A cap of five does not require filling five slots.

Pitzer's actual October 4 v5 dinner picks were beef bulgogi, orange tofu, smoked BBQ brisket, creamy macaroni and cheese, and grill slider bar. They did not include both bulgogi proteins. The user's confirmed target is Italian Pitzer Sunday, chicken or beef bulgogi, smoked BBQ brisket, and grill slider bar. Korean burrito is an optional candidate if room and distinct useful information remain. Other halls' preferences are assistant-provisional.

The flat v5 output could not express a combined title and its heading exclusion discouraged the Italian program. This is an output-contract problem as well as a selection problem. Higher model capacity alone cannot fix an unrepresentable answer.

## Local API candidate

Prompt version 8 retains GPT-OSS 120B with low reasoning. The exact current instructions are in `highlight-minimal-policy.ts` (now part of `src/highlight-selection.ts`). The smaller inference contract returns source IDs and a title only for combined variants. Singles, including one named program row, get a bounded faithful title from the original source name. The public response adds `highlights.meals[].groups`, with title, source IDs, and exact source item metadata. `items` retains one original anchor per group for existing clients. Current-version saved flat selections can render singleton groups; old menu hashes are invalidated when the model or prompt changes.

Combined titles use source-name words and a shared dish term. Dietary phrases require support in every represented source name. These lexical checks are conservative filters, not proof that dishes belong together or are good highlights. Every source belongs to its meal; duplicated ownership, invalid IDs and malformed groups fail validation. Original dietary flags, allergens and nutrition remain attached to each source item. Groups have no inferred aggregate dietary flags. Public IDs are positions in a menu version, not permanent dish IDs.

Detailed experimental program records can retain linked component items. The minimal candidate emits `kind: single` for one source row, even if that row is a meal program, and no component IDs. The full menu still supplies its associated foods. Apps display `group.title`, show choices from `group.sourceItems`, and use the full menu for details. `?highlights=false` still removes the enrichment and skips its KV read.

This is local, unreleased work. Validation and runtime checks do not establish selection quality. The experimental prompts have not earned a claim that all hall picks are better or that the API is ready for production.

## Reviews and experiment

Muse Spark 1.3 and GLM 5.3 Flash completed independent OpenCode reviews, alongside GPT-6.1 Sol. All agreed on the structural grouping problem. They disagreed about mac and cheese and the optional fifth choice. Calories, capitalization and broad station filters were rejected as eligibility rules. Recommendations for deprecated Groq models were checked against the live catalog rather than accepted. Follow-up Muse/GLM blind tasks hit the OpenCode Go usage limit; GPT's blind review completed.

Live Groq comparisons use currently available 120B, 20B and Qwen 3.8, captured hall-day menus, program-first versus cluster-first prompts, a smaller output contract, repeated Pitzer runs, a medium-reasoning probe, and a candidate-inventory pilot. All raw provider errors and rejected selections remain in `.wrangler/group-eval/`. A separate bounded attempt ledger does not reset the previous refinement budget. Provider errors without token usage are not treated as free or included in reported token totals.

Oct 4 is development data. A separate Oct 5 source capture and provisional rubric were frozen before model outputs. It is a holdout for the captured prompt/configuration, not a human answer key. GPT models use low reasoning and 2,000 completion tokens; Qwen uses none and 1,000 after account output-limit rejections. These are practical configurations, not equal reasoning compute.

The six-hall minimal development run passed reference/format validation in 6/6 for 120B and 5/6 for 20B and Qwen. GPT's blinded food review still identified three clear side/dessert/heading choices for 120B, one sauce for Qwen, and five clear side/dessert rows plus two weak cereal/grain staples for 20B. Qwen also returned an empty Hoch dinner. None exactly produced all four requested Pitzer representations in that run. Do not turn validity into an accuracy claim.

## Completed results

The grouping experiment recorded 100 outbound calls across nine rounds, representing 98 hall-day workflow records. The successful inventory pilot used two calls per workflow. Providers reported 330,073 tokens in total; errors without usage remain uncounted. Earlier research and refinement calls are outside this ledger.

| Comparison | Valid responses | Limited offering checks | Finding |
| --- | --- | --- | --- |
| 120B, first minimal contract, Oct 4 | 6/6 | 27/36 | Strongest coverage in that run, but three clear food/heading mistakes |
| 20B, same development run | 5/6 | 17/36 | Five clear side/dessert choices and two weak cereal/grain staples |
| Qwen, same development run | 5/6 | 20/36 | One sauce, empty Hoch dinner, rejected Frary merge |
| 120B, medium reasoning, two halls | 2/2 | 7/12 | Pitzer target fell to 1/4; no demonstrated reasoning benefit |
| 120B, successful inventory pilot, two halls | 2/2 | 11/12 | Better shortlist coverage, but Pitzer still 3/4 and no relationship enforcement |
| 120B, tighter v8 prompt, Pitzer repeat | 1/1 tested | 5/6 | Correct bulgogi merge, two Italian component duplicates, missing slider bar |
| 20B, v8 Oct 5 holdout | 6/6 | 27/51 | Manual review found seven clear sides/desserts, plus one parent/component overlap |
| Qwen, v8 Oct 5 holdout | 5/6 | 35/51 | One unsupported teriyaki fragment; stronger accepted food coverage, rejected McConnell |
| 120B, v8 Oct 5 holdout | Not tested | Not assessed | Daily token quota blocked all six planned calls |

Coverage checks are assistant-provisional and incomplete. Invalid model outputs contribute no usable coverage; quota rejections and skipped requests are excluded. Oct 4 labels were written after inspecting early development outputs. Oct 5 labels were frozen before outputs. Neither checklist is a human accuracy benchmark. Pilot configurations changed schema and reasoning together, so improvement cannot be attributed to one factor.

The holdout food review checked accepted picks against source context beyond the frozen checklist. It found seven clear sides/desserts for 20B, eighteen explicitly flagged weak or disputed picks, one pita-program/component pair and eight extra overlapping pizza-flavor slots. Qwen had one unsupported teriyaki fragment and seven weak/disputed picks. Its accepted five halls covered 35/42 provisional checks, but the rejected McConnell hall lost nine more. The seven manual 20B hard errors include cookies, which the limited frozen exclusion list did not contain. These distinctions explain why food-review counts differ from automated checklist counts.

The latest valid 120B Pitzer dinner returned Italian Pitzer Sunday, spaghetti pasta, beef meatballs, beef or chicken bulgogi, and smoked BBQ brisket. Compared with v5, the user's exact preferred representations increased from 2/4 to 3/4. Two components still repeated the Italian parent, and slider bar disappeared. This single result demonstrates the new representation, not stable improvement. The second low-reasoning repeat and medium repeats were curtailed by the daily 120B quota. Both Qwen Pitzer repeats failed the conservative merge guard; one 20B repeat failed its response shape.

## Recommended direction

Keep GPT-OSS 120B as the model choice. These experiments do not establish a replacement, and 120B has no Oct 5 holdout result. Higher reasoning alone did not fix the problem. Avoid adding more examples of the same Pitzer dinner and treating that as general improvement.

The next experiment should build explicit source relationships before ranking. Classify credible mains, real named programs, components and true variants across all stations. Each component must point to an existing program ID in the same meal. Each variant family must preserve its original source choices. Validate references and ownership, then assemble distinct offerings in code. Rank those offerings to the five-slot maximum. Selecting a parent should suppress its known components; selecting a variant family should show its members. Uncertain relationships should remain separate instead of forcing a merge.

The tested inventory pilot returned eligible source IDs only. It did not build those relationships, so it cannot enforce parent suppression or variant completeness. The minimal contract made responses easier to validate but deliberately removed relationship bookkeeping. That tradeoff now explains the remaining duplicates. The proposed richer inventory needs its own repeated, unseen-menu evaluation before becoming the production default. Hall-specific guidance can explain source layout, but should not hardcode preferred dishes or ban whole stations.

The local API candidate supports grouped display and exact source metadata. It remains unreleased while these selection errors persist. Source-grounded reviews are in `docs/reports/group-blind-review-sol.md` and `docs/reports/group-final-review-sol.md`; the interactive report retains every tested round and the older saved-menu audit.

## Reproduce

Run commands through `rtk`, as required by this workspace:

```sh
rtk proxy npx tsx scripts/capture-group-holdout.ts 2026-10-05
rtk proxy npx tsx scripts/grouped-highlight-eval.ts repeat
rtk proxy npx tsx scripts/grouped-highlight-eval.ts holdout
rtk proxy npx tsx scripts/score-grouped-highlights.ts
rtk proxy python3 docs/reports/build-highlight-pick-audit.py
```

Existing phase files resume rather than regenerate finished calls. Hash mismatches require a separate phase file. The scoring rubric is a limited critical-offering checklist; rejected model outputs contribute zero coverage, while quota rejections and skipped requests are excluded. Conditional coverage is also reported. A source-grounded food audit supplements the incomplete checklist. Only the user's Pitzer four are human-approved.

Primary references checked October 4: [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [reasoning/API controls](https://console.groq.com/docs/api-reference), [rate limits](https://console.groq.com/docs/rate-limits), and [model deprecations](https://console.groq.com/docs/deprecations). Actual account limits and live model availability were also checked directly.
