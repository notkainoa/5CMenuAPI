# Menu highlights: history and known limits

This file summarizes how the highlights pipeline got to its current shape and what is still wrong with it. The integration contract is in [menu-highlights.md](menu-highlights.md). The original experiment write-ups are archived in [reports/](reports/). They mention modules that have since been removed.

## Timeline

| Dates (2026) | Prompt version | What happened |
| --- | --- | --- |
| Sep 29 – Oct 2 | 1–3 | First integration. One GPT-OSS 120B request per hall-day with strict JSON output, plus scheduling, budgets and validation. The first live test found that the model left out empty services, so the schema now requires every meal key. |
| Oct 3 | 5 | Refinement loop on saved Oct 2 and Sep 30 menus. Defined what counts as a main, added ranking, and raised the cap from four to five. Introduced short aliases that are unique across the hall-day. Four known side-dish picks dropped to zero on the provisional checklist (12/24 → 21/24). |
| Oct 4 | 5 | Pick-by-pick audit of a fresh day (53 credible, 5 weak, 0 clear sides out of 58 picks). The flat list could not express "chicken or beef bulgogi", and it split meal programs into their components. |
| Oct 4 – 5 | 6–8 | Grouping experiment across 100 Groq calls: program-first vs cluster-first prompts, a full grouped contract with program components, a two-step candidate inventory, medium reasoning, and the 20B and Qwen models. The v8 "minimal" contract (source IDs, plus a title only for combined variants) validated most reliably. Blind comparison rounds were cut short by provider quota limits. |
| Oct 23 | 9 | Converged on the v8 contract as v9. Removed the other variants, simplified the public group shape, hardened failure handling, and added prompt rules for sweets, staples and station labels. In a live one-day audit the final prompt made 1 clear error and 5 weak picks out of 68 ([report](reports/highlight-audit-2026-10-23.md)). |

## What was kept and what was dropped

Kept:

- **GPT-OSS 120B with low reasoning.** No other model or setting showed a better result. Medium reasoning produced 413/400 errors or no gain. The 20B model picked clear sides. Qwen picked fewer sides but failed validation more often.
- **The minimal contract.** Each offering is one source ID, or two to four true variants with a short grounded title. Single titles always come from the menu.

Dropped:

- **The full grouped contract** (`kind: program`, `componentIds`). The model's component bookkeeping was unreliable, and nothing in the shipped pipeline produced it.
- **The candidate-inventory pilot and both grouped prompt strategies.** Neither consistently beat v8.
- **Station-guide hints from v5.** v8 dropped them, and v8 did no worse.

## Known limits

The pipeline is structurally sound: every response is validated and nothing invalid is ever served. **Selection quality is decent but not curated.** These problems appeared repeatedly and are not solved:

- **Ranking among real mains.** Picks are usually legitimate dishes, but not always the ones a person would choose. Brunch is the weakest, because the model under-scans the lunch-style stations.
- **Meal programs and their components.** The model sometimes selects a bar and also one of its proteins, or a protein without its bar. The prompt discourages this, but nothing in code enforces it. The code knows nothing about which rows belong to a program.
- **Occasional weak staples and sides.** Standalone breakfast sausage, hard-boiled eggs, plain pizza and generic grill items still show up when better options exist. Plain grains occasionally slip in too (Frary quinoa on Oct 23). Thin breakfasts can now be under-filled: Collins got one pick when two were reasonable.
- **Protein variants are rarely grouped.** The prompt asks for "pork or tofu banh mi"-style groups. On Oct 23 the model split both available pairs and selected only one side of each.
- **Variant grouping is conservative.** A combined title must share a non-generic dish word across all of its sources, so some genuine pairs are rejected. "Vegan or chicken pho" fails because the dietary word is not in every source name. In those cases the sources are shown as separate singles, never under a misleading title. Combined groups are uncommon in practice: the Oct 23 run produced none.
- **Labels are not ground truth.** The checklists in the archived reports were written by the assistant. The only human-confirmed expectation is one Pitzer dinner.

If quality needs to improve further, the most promising next step recorded in the experiments is to build explicit program/component relationships before ranking. Classify the rows, validate the parent/child references, and assemble the offerings in code. Evaluate on unseen days first.
