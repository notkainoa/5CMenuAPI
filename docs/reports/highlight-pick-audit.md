# Every highlight checked against its menu

The refined selector avoids the old clear side mistakes. It still needs work on finding and ranking mains, especially at brunch. This audit checks each selected item against its own source menu, rather than grading only the previously flagged priority groups.

| Set | Menu date | Ready halls | Credible mains | Weak or unclear | Clear side errors | Total picks |
| --- | --- | --- | --- | --- | --- | --- |
| Original test | October 2 | 6 | 50 | 7 | 4 | 61 |
| Refined test, same menu | October 2 | 6 | 74 | 3 | 0 | 77 |
| Fresh selections for this audit | October 4 | 6 | 53 | 5 | 0 | 58 |
| Earlier original test | September 30 | 4 | 37 | 3 | 0 | 40 |

These are assistant judgments from saved dish names, descriptions and station context. They are not human-approved ground truth or overall accuracy measurements. A credible main can still be a poor ranking choice. Missing mains do not appear in the totals of selected items above.

The four clear original October 2 mistakes were Malott roasted cauliflower, Collins hash brown potatoes, Collins plain polenta, and Frary plain quinoa. All were absent from the fixed final refined October 2 run.

The October 2 weak/unclear picks were four standalone breakfast sausages, McConnell oatmeal and pad-thai noodle components, and Frank garlic-bread/pizza squares. The refined run still selected Collins breakfast sausage and two proteins already represented by its selected McConnell macaroni cheese bar.

## Today's actual picks

There was no saved October 4 selection before this request. We fetched today's menus directly through the existing source adapters and generated one valid hall-day result for each available hall using GPT-OSS 120B, low reasoning effort and prompt version 5. Oldenborg had no published menu. Frank and Frary's empty continental breakfast services have empty selections.

Seven outbound attempts produced six successful results. The first Hoch response assigned an item to the wrong meal and failed validation; its retry succeeded. Requests were spaced at least 65 seconds apart. This separate capture did not reset or bypass the prior 34-attempt refinement budget. The production API was not deployed or changed by the audit.

Today's five weak/unclear picks, after reconsidering duplicate meal offerings:

- Frary brunch, Beyond Breakfast Sausage: a standalone breakfast meat, chosen while composed mains remained available.
- Frank dinner, Garlic Cheese Bread Pizza Squares: the name does not establish whether this is a main-sized pizza or bread accompaniment; no description resolves it.
- McConnell dinner, creamy macaroni and cheese: a disputed main and ranking choice. GLM accepts it as a main; here the user prefers covering the Italian program and both bulgogi options.
- Hoch dinner, beef barbacoa: a legitimate main, but overlaps the burrito service already represented by carne asada and misses the composed chicken machaca burrito.
- Frank dinner, pollo asado: a legitimate main, but redundant alongside carne asada from the same nacho-bar program.

Today's meaningful omissions:

- Collins brunch only returned three highlights. The source also listed `the CarveCraft`, described as herb roasted turkey, and pomegranate cheese blintz. Both could fill the remaining slots.
- Frary brunch chose breakfast sausage while leaving out steamed mussels with herb butter, breaded butterfly shrimp and angel hair al Pomodoro. Brunch needs a scan of its lunch-style dishes too.
- McConnell dinner omitted Italian Pitzer Sunday and the chicken bulgogi alternative. The flat output could not express the combined protein choice. Eggplant parmesan and Korean burrito remain credible optional candidates, not mandatory extra highlights.
- Frank dinner omitted the named nacho bar while separately selecting its carne asada and pollo asado. Grouping the bar would leave more room for distinct dishes.

Other mains in the explorer are examples, not an exhaustive list of missing items. Five highlights cannot cover every credible main. Do not treat every unselected main as a model error.

## Report and verification

The AgentDrop report now includes all four sets, every pick's verdict and reason, a full saved-menu view, and other credible mains in the same meal. It replaces the earlier checklist-only graphic on the same private site.

Build it with `rtk proxy python3 docs/reports/build-highlight-pick-audit.py`. It writes the standalone page and detailed audit JSON into `.wrangler/highlight-comparison/`. The builder validates selected item membership, counts, limits and all alternative dish references against the exact menu records.

Sources are `.wrangler/groq-live-results-oct2.json`, `.wrangler/groq-live-results.json`, `.wrangler/highlight-eval/1791086353782-live-2026-10-02.json` and the fresh `.wrangler/day-audit/2026-10-04.json`. The new capture script is `scripts/capture-highlight-audit.ts`; repeating it resumes saved results rather than generating a fresh result again.

TypeScript checks passed. Desktop and 390px mobile layouts had no horizontal overflow or browser console errors. Original-side filtering, fresh-pick filtering, full menus, missing saved selections and other-main references were checked in the collaborative browser.

The grouping experiments now compare 100 outbound Groq attempts across three models. See [grouped highlight findings](highlight-grouping.md) for the reviewers, repeated Pitzer tests, Oct 5 holdout and remaining relationship errors. The historical v5 improvement on Oct 2 does not establish that the newer grouped candidate improves every hall. More source descriptions and human-reviewed offering labels would help resolve disputed food roles and ranking preferences.
