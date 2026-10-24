# Final experiment review, GPT-6.1 Sol

The strongest result here is Qwen's Oct 5 coverage on the five halls whose responses were accepted. That does not justify a production model switch. It rejects the entire McConnell hall and repeats invalid grouping there on Oct 4. GPT-OSS 20B returns all six holdout halls, but repeatedly spends slots on sides, breakfast staples and many pizza variants. GPT-OSS 120B has no completed holdout response because its daily token quota was exhausted. The v8 medium-reasoning repeat also received a quota error. An earlier v7 medium probe did complete two calls; those exploratory results are discussed separately below and do not establish a benefit.

I reviewed all twelve recorded holdout responses against the original Oct 5 menus and frozen assistant rubric, plus all six v8 repeat records and the two earlier v7 medium records against Oct 4 menus and the user's Pitzer expectations. No code, prompt or rubric was changed. The local v8 prompt was locked before holdout. The rubric is assistant-provisional, `humanApproved: false`; only the user's four Pitzer dinner expectations are human-approved. Rubric misses are coverage diagnostics, not an exact human gold set or proof that every alternative ranking is wrong.

## Holdout counts

| Model | Accepted halls | Clear sides/desserts/unsupported headings | Credible-but-weak or disputed picks explicitly flagged | Parent/child redundant pairs | Missed provisional critical groups in accepted meals |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-OSS 20B | 6/6 | 7 | 18 | 1 | 24/51 |
| Qwen 3.8 27B | 5/6 | 1 | 7 | 0 | 7/42 |
| GPT-OSS 120B | Untested | Not measured | Not measured | Not measured | Not measured |

The manual source review counts seven clear 20B mistakes, while the frozen hard-ID exclusions count six. The additional manual error is Collins's chocolate cookies `m2:s6:i0`, an obvious dessert that was not enumerated in the rubric's deliberately limited side/heading list. This broader review is kept separate from automated frozen-rubric counts.

Twenty-B's accepted Malott lists also consume eight extra slots on overlapping pizza flavor choices: five separately listed pizzas at lunch and another five at dinner. These are eligible foods but poor distinct-offering coverage, rather than eight literal side errors. Qwen's nine McConnell rubric groups are outside its accepted-response denominator; the rejection is an availability failure, not nine accepted food mistakes. Across all fifty-one critical groups it delivers thirty-five, while sixteen remain uncovered, nine due to rejection. Twenty-B covers twenty-seven of fifty-one. These numbers depend on the provisional rubric and should not be mistaken for calibrated preference scores.

## Source-grounded holdout audit by hall

### Hoch

Twenty-B breakfast is useful and covers all three provisional breakfast checks. Lunch finds chicken and beef stir fry but substitutes a generic cheeseburger `m1:s5:i2` and vegetable pizza `m1:s9:i0` for the lox sandwich `m1:s2:i0` and the stronger named plant offering alternatives: ratatouille portobello `m1:s6:i1`, vegetable risotto `m1:s6:i4`, or chickpea stew `m1:s6:i5`. Those burger/pizza picks are eligible but weak here. Dinner includes garlic bread `m2:s7:i0`, a clear side. It misses chicken shawarma `m2:s4:i2` and meat lasagna `m2:s7:i2` while using only four slots.

Qwen breakfast is similarly good. Lunch preserves Moroccan chickpea stew `m1:s6:i5` but misses the same lox sandwich. Bok choy stir fry `m1:s4:i2` is disputed: its description is mixed stir-fried vegetables with oil, and it sits beside beef stir fry and rice. I flag it as a likely accompaniment, not a certain main or a hard counted exclusion. Its quinoa salad is a substantial composed grain/vegetable dish and should not be rejected because it contains quinoa. Dinner covers shawarma, lasagna and a plant main without an obvious side.

Critical misses: 20B four; Qwen one.

### Malott

Twenty-B breakfast spends four slots on sausage patty `m0:s0:i0`, turkey sausage `m0:s0:i1`, turkey bacon `m0:s0:i2`, and plain eggs `m0:s0:i3`, despite named composed breakfasts in Breakfast Grill. It does include bacon/egg burrito. The missed plant-breakfast check accepts southwestern tofu/chickpea scramble `m0:s4:i20`, Impossible oat hash `m0:s4:i21`, kale squash scramble `m0:s4:i25`, avocado toast `m0:s4:i26`, or root-vegetable breakfast bowl `m0:s4:i29`. Brunch includes clear hash-brown `m1:s1:i8` and potato `m1:s1:i9` sides, plus weak grilled ham `m1:s1:i11`.

Its lunch and dinner each select only the five ovens pizzas `m2:s3:i0` through `i4`, and `m3:s3:i0` through `i4`. All are plausible mains; together they suppress distinct offerings. Lunch misses the hot-honey chicken sandwich `m2:s5:i0`, mushroom bowl `m2:s1:i0` or seasoned tofu `m2:s0:i1`, and orange-tamari chicken `m2:s0:i0`. Dinner misses pasta bar `m3:s0:i0`, quesa birria `m3:s6:i0`, and plant picadillo `m3:s1:i2`.

Qwen breakfast finds composed dishes and the tofu/chickpea scramble. Its brunch returns only `teriyaki` `m1:s1:i14`. The menu supplies no protein or composed dish for this fragment; it cannot be promoted into a meal by assuming missing information. This is its one clear unsupported heading/sauce-fragment selection. It misses French toast alternatives `m1:s1:i3`, `i6`, `i7` and pancakes/waffles `m1:s1:i4`, `i5`. Lunch merges named orange-tamari chicken/tofu and finds the hot-honey sandwich; the plain roasted chicken `m2:s2:i0` is a weaker pick than the omitted mushroom bowl, though the merged tofu satisfies the rubric's plant alternative. Dinner finds birria and picadillo but misses pasta bar `m3:s0:i0`; plain roasted chicken `m3:s2:i0` again ranks weakly.

Critical misses: 20B seven; Qwen three. Additional overlapping pizza slots: 20B eight.

### McConnell

Twenty-B breakfast includes roasted sweet potatoes `m0:s0:i19`, a clear side, and weak plain eggs `m0:s0:i0` and bacon `m0:s0:i9`. It misses all three provisional checks: omelet burrito `m0:s1:i0`, chicken/waffles `m0:s2:i4`, portobello skillet `m0:s2:i2`. Lunch includes roasted potatoes al mojo `m1:s2:i3`, another clear side, while missing composed Cuban pork `m1:s2:i5`. The oasis experience is provisionally supported as a program by eggplant/chicken/pita/hummus; its vague title alone would not establish this.

Dinner selects Mediterranean pita pockets `m2:s0:i0` and their shawarma protein `m2:s0:i2` separately. This is one parent/child redundant pair. It misses stuffed salmon `m2:s2:i4`, although portobello fajitas satisfies its plant-main check. Pita choices, Thai wok and quesadilla plate are otherwise recognizable programs.

Qwen is rejected for `No common named dish`. Its raw lunch tries to group the oasis title with unrelated eggplant/chicken children. That diagnosis explains the rejection; none of the raw picks is counted as accepted food coverage. A rejected hall loses all meals, not just the one bad cluster.

Critical misses in accepted output: 20B five. Qwen has no accepted McConnell food list.

### Collins

Twenty-B breakfast includes the named pancakes, but plain eggs `m0:s0:i0`, bacon `m0:s0:i3`, sausage `m0:s0:i4`, and oatmeal `m0:s0:i6` are weak staple padding. It misses greens/gouda scramble `m0:s0:i1`. Lunch selects chocolate cookies `m2:s6:i0`, a clear dessert, and weaker meat-lover pizza `m2:s5:i0` and chicken/rice soup `m2:s7:i0` instead of chicken caprese sandwich `m2:s3:i0`. Lentil bolognese and beef stroganoff remain good picks. Dinner is strong and covers its checks.

Qwen breakfast covers greens scramble and pancakes. Coconut chia pudding `m0:s2:i2` and Morningstar sausage `m0:s0:i5` are lower-priority or disputed breakfast highlights; neither is called a hard side error. Lunch covers bolognese/stroganoff but uses chicken/rice soup `m2:s7:i0` while missing caprese `m2:s3:i0`. Dinner is useful and varied. Both correctly preserve the empty continental service.

Critical misses: 20B two; Qwen one.

### Frank

Twenty-B brunch misses all three provisional checks: chicken fried waffle sandwich `m1:s3:i9`, balsamic pork tenderloin `m1:s1:i1`, and outdoor omelet alternatives `m1:s4:i0` or `i1`. Herb chicken, vegetable penne and vegan cutlet are credible picks. Thai mango salad `m1:s0:i8`/`m1:s6:i0` and chicken gnocchi soup `m1:s0:i6` are weaker or disputed uses of the remaining slots. The repeated salad occurrences are merged into one group, so they do not consume two slots, but calling identical occurrences `variants` is conceptually imprecise. Dinner misses pasta bar `m2:s4:i0` while selecting five credible named mains, including pad thai and sesame tofu. That particular rubric miss is not itself a proven poor ranking.

Qwen brunch finds the waffle sandwich and pork plus two substantial dishes, but misses the outdoor omelet in a four-item list. Dinner covers fried rice, pasta bar and plant pad thai. Empty continental breakfast remains empty.

Critical misses: 20B four; Qwen one.

### Frary

Twenty-B breakfast misses Simple Vegan Breakfast Hash `m0:s0:i3`, but its omelet and biscuit sandwich are credible. Lunch selects generic cheese pizza `m1:s2:i0` among stronger named alternatives. Dinner includes fries `m2:s3:i3`, a clear side, and misses sweet/sour tofu `m2:s0:i1`. Fried rice `m2:s0:i2` is contextual uncertainty: the name can describe a composed entree, but here it appears alongside beef/tofu and vegetable accompaniments without a confirming description. I do not turn a blanket rice rule into a hard exclusion. Its upgraded evening omelet selection is valid despite the lengthy station-like source title.

Qwen breakfast covers all checks, and lunch is credible, including carbonara, quesadilla and named chicken. Dinner finds tofu and ham/cheese sandwich but misses upgraded omelet `m2:s1:i0` while selecting four items, including the weaker simply grilled chicken `m2:s3:i2`.

Critical misses: 20B two; Qwen one.

The eighteen explicitly flagged 20B weak/disputed picks are Hoch's two generic mains; Malott's four breakfast staples and grilled ham; McConnell's plain eggs/bacon; Collins's four breakfast staples plus lunch pizza/soup; Frank's salad/soup; Frary's cheese pizza. Frary fried rice is an additional uncertainty, kept outside that conservative count to avoid inflating it. Qwen's seven are Hoch bok choy, Malott's two plain chicken picks, Collins's pudding/sausage/soup, and Frary's simply grilled chicken.

## Oct 4 repeat evidence

There are six repeat records: one accepted 120B-low response, one accepted 20B response, two rejected Qwen responses, one rejected second 20B response, and the quota-blocked 120B-medium call.

120B-low selects Italian Sunday `m1:s0:i0`, spaghetti `m1:s0:i1`, beef meatballs `m1:s0:i4`, merged beef/chicken bulgogi `m1:s1:i1`/`i2`, and brisket `m1:s2:i5`. The Italian parent has two selected children. Spaghetti is also an uncomposed accompaniment here, not an independently established composed pasta entree. The duplicated children displace the user-approved slider bar `m1:s3:i0`. Brunch selects hot oatmeal `m0:s4:i0` over the available French toast casserole, a weak staple. Thus the repeat disproves an assumption that 120B reliably understands parent suppression even when all IDs and titles validate.

Accepted 20B selects Italian Sunday, Korean burrito `m1:s1:i0`, brisket, slider bar `m1:s3:i0`, and pull-pork slider `m1:s3:i1`. That is one parent/child overlap, and it misses the user-approved bulgogi offering. Its brunch adds clear steamed rice `m0:s1:i0` and weaker Impossible breakfast patties `m0:s2:i6` beside otherwise composed choices.

Qwen's first raw repeat has an empty title for multiple Italian rows and mixes orange tofu into beef/chicken bulgogi; the second again tries the tofu-bulgogi merge. Those are rejected by title/common-dish validation. Orange tofu is a real eligible main, but the source does not name it bulgogi. The second 20B raw response puts dinner outside the `meals` object, so it is rejected for missing `m1`; it is not an accepted partial brunch result.

No repeat produces all four user-approved offerings with the merged beef/chicken option and no redundant components. The original v5 dinner had beef bulgogi, orange tofu, brisket, macaroni/cheese and slider bar. Its Italian omission persists as the motivating bug, while the newer output introduces different failures rather than proving a dependable fix.

## Earlier medium probe, separate from the locked v8 repeat

The earlier `medium.json` phase has two completed GPT-OSS 120B medium calls on Hoch and McConnell using the v7 prompt. Both validate. They cover seven of twelve provisional critical checks: Hoch one brunch and two dinner checks; McConnell three brunch and one dinner checks. These are assistant rubric diagnostics, not human preference truth.

Hoch brunch again favors plain/deli proteins and misses stronger composed breakfast choices. Dinner lists beef barbacoa, chicken burrito and carne asada separately, with salmon/piccata, and misses moussaka. McConnell dinner selects a meatball variant group `m1:s0:i4`/`i5`/`i6`, separately lists beef bulgogi `m1:s1:i1` and chicken bulgogi `m1:s1:i2`, and adds orange tofu and brisket. It omits Italian Sunday and the slider bar and does not merge the bulgogi choices. Under the requested distinct-offering representation, only brisket satisfies the full four-offering Pitzer expectation; the split bulgogi rows show that both proteins were found but were represented redundantly. Thus the reported Pitzer result is one of four, not a claim that neither bulgogi was recognized.

This small completed v7 probe provides medium-reasoning evidence, but does not demonstrate an improvement. It differs in prompt version from the locked v8 evaluation and has only one call per hall. The v8 medium repeat remains untested because its request was quota-blocked. Keep those two facts separate.

## Decision

Do not switch production to 20B or Qwen based on these results. Twenty-B's availability advantage is accompanied by poorer meal summaries. Qwen is a useful candidate for further testing, with stronger accepted holdout food choices, but McConnell reliability is unacceptable and the dinner grouping failures repeat. There is no 120B holdout comparison. Earlier v7 medium calls are valid but weak exploratory evidence, and the v8 medium repeat is quota-blocked; neither supports a medium-setting superiority claim.

The initial blind mapping is now known: A was Qwen, B was 120B, C was 20B. That earlier single-run review also found B's clear cake, zucchini and allergen-heading picks. The repeat adds its parent/child failures. None of the three has demonstrated production readiness. Keep the local v8 candidate unreleased, preserve the frozen holdout as a result of that locked prompt, and use the observed failures to design a future experiment rather than retune this holdout and call it independent validation.

A validated inventory followed by ranking remains worth testing because these failures separate identifiable tasks: explicit sides/staples are admitted, real programs are missed, and selected parents are duplicated by children. Two-pass work should earn its cost through fewer hard errors and more useful accepted hall responses. It cannot be justified merely by another assistant vote or better-looking JSON.

## Interactive review annotations

`group-food-review.json` annotates all twenty-nine accepted minimal-development, repeat and holdout cases, including reviewed cases with empty flag lists. Rejected responses are excluded. Empty flags mean no listed concern, not a certification that the food list is correct. Each annotation references a source selected in that exact phase/model/hall/repeat; original source IDs are retained.

These are broad per-source review annotations, not a scoring rubric. They include contextual uncertainties, probably overlapping dishes, selected parent components and the eight extra Malott pizza flavor slots. Consequently weak-flag totals exceed the conservative credible-but-weak counts above. Duplicate occurrences within one group can receive separate source annotations without counting as two highlight slots. Plain oatmeal is annotated as weak staple padding; clear standalone grains, potato sides, desserts, condiments and notices are annotated as wrong. No new human-approved labels are implied.

The parent report conservatively recategorizes breakfast hot quinoa as a weak grain/cereal staple, alongside oatmeal, rather than a definite side error. That yields five clear side/dessert picks and two weak grain/cereal picks in the initial minimal 20B run. The original blind review retains its broader policy judgment for traceability.
