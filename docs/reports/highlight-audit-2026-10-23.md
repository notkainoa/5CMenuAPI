# Pick audit, October 23, 2026 (prompt v9)

This audit used live school menus, local `wrangler dev`, and the shipped pipeline. Each pick was checked against its full menu using the categories from [highlight-pick-audit.md](highlight-pick-audit.md): credible main, weak or unclear, clear side error, and meaningful omission. These are assistant judgments, not human-approved labels. Frank's Pomona source failed to fetch on every date, and Oldenborg published no menu, so five halls were audited.

## Two runs

| Run | Prompt | Groq calls | Ready halls | Picks | Clear side/heading errors | Weak or unclear |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | v9 as converged from v8 | 9 | 4 of 5 | 58 | 4 | 3 |
| 2 | v9 with the sweets/staples/heading edits | 5 | 5 of 5 | 68 | 1 | 5 |

Run 1 failures:

- Hoch hit `json_validate_failed` twice before succeeding. Under the old code the first of these would have been terminal.
- Frary failed three times on a combined title that had no shared dish word. That led to the split fallback, under which a bad combined title no longer sinks the whole hall.
- Collins breakfast filled three slots from its `sweets` station: chia pudding, scones and muffins.
- McConnell lunch picked `grill - market`, which is the grill station's own label.
- Malott breakfast took bacon and sausage from the first station and missed the burritos and scrambles listed later.

Run 2 used 27,817 tokens. Every hall succeeded on the first attempt, and none produced a combined group.

## Run 2 picks

| Hall / meal | Picks | Verdict |
| --- | --- | --- |
| Hoch breakfast | Sausage egg & cheese bagel; scrambled tofu; vegetarian sausage patty; hard boiled egg | 2 credible, 2 weak. French toast sticks missed. |
| Hoch lunch | Korean pork belly bao; hamburger; grilled chicken breast; veggie burger; BBQ chicken pizza | 5 credible, but three generic grill items. Lemongrass tofu bao, the bao counterpart, was not grouped. Gambas al ajillo and Spanish albondigas missed. |
| Hoch dinner | Spicy beef quesabirria; cauliflower buffalo wings; BBQ chicken wings; chicken alfredo pizza; halal meatloaf | 5 credible |
| Malott breakfast | Early riser plate; SW tofu & chickpea scramble; impossible oat hash; bacon & egg burrito; vegetarian quiche | 5 credible (run 1 had bacon and sausage) |
| Malott lunch | Herb roasted chicken; pepperoni pizza; fish taco bar; impossible burger; roasted pork | 5 credible. Penne alfredo and chickpea stew missed. |
| Malott dinner | Build-your-own pizza bar; chana masala; wings 'n' fries; beef sirloin; chicken penne alfredo | 5 credible |
| McConnell breakfast | Omelet burrito; scrambled eggs & Italian sausage; tofu skillet; French toast; salmon eggs benedict | 5 credible |
| McConnell lunch | The oasis experince (program); grilled halal steak; beef burger; impossible burger; cheese enchiladas | 4 credible, plus 1 overlap: the steak is part of the selected program. Pitzer ceviche bar, chicken fajitas and impossible loco moco missed. |
| McConnell dinner | Mac & cheese bar; pulled pork; buffalo fried chicken; grilled halal chicken; roasted lamb | 5 credible. No plant main, though BBQ jackfruit was available. Pad thai bowl missed. |
| Collins breakfast | Apple cinnamon French toast bake | 1 credible. Nashville scramble eggs missed. The tightened prompt now under-fills here. |
| Collins lunch | Stuffed bell peppers; tilapia calypso; Mongolian stir fry; turkey cacciatore; build-your-own pizza | 5 credible |
| Collins dinner | Spinach lasagna; mole poblano; Nashville hot chicken sandwich; fried rice; balsamic pork tenderloin | 4 credible, 1 unclear (plain "fried rice") |
| Frary breakfast | Omelet bar; steak & egg on sourdough; Beyond breakfast sausage | 2 credible, 1 weak. Tofu scramble was available. |
| Frary lunch | Banh mi with pork; Moroccan chicken stew; simply baked chicken; cheese pizza; **organic red & white quinoa** | 4 credible, 1 clear side. The tofu banh mi counterpart was not grouped. Spaghetti & meatballs missed. |
| Frary dinner | Char grilled steak; Moroccan chicken stew; simply baked chicken; pastrami sandwich; cheese pizza | 5 credible. Cheese pizza is generic. |

## Takeaways

- The structural pipeline worked end to end. Every served source matched its original menu row field for field (68 of 68). Repeated scheduled runs made no extra calls.
- Naming baked goods, smoothies and station-label rows in the prompt removed run 1's clear errors. Plain grains can still slip through, as with Frary's quinoa.
- The model ignores the instruction to group protein variants: the bao and banh mi pairs were both split, with only one side selected. Groups remain rare.
- Program/component overlap (McConnell's Oasis plus its steak) and strong programs missed in favour of grill staples are the main ranking problems. They match the earlier experiments.
