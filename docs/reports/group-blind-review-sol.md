# Blind development food review, GPT-6.1 Sol

I reviewed the eighteen anonymous hall responses in `blind-development.json` against the exact Oct 4 menus and old v5 selections. I did not inspect model identities, guess which cell uses which model, read holdout results, or call an API. This is assistant judgment. Only the user's four Pitzer dinner expectations are human-approved. Each cell has one response per hall; this cannot establish stable performance or the benefit of a reasoning setting.

## Overall judgment

None of these minimal configurations is ready to replace v5 in production on this evidence. The simpler format makes selection and display mechanics easier to validate, but it does not reliably choose food. Cell B has the strongest general coverage in this sample, yet it selects an allergen heading, a vegetable side, and a cake. Cell A has excellent Collins coverage and the only merged Pitzer bulgogi, but returns an empty Hoch dinner and fails Frary entirely. Cell C has the most clear side/staple/dessert errors and a failed Frank response.

| Cell | Accepted hall responses | Clear invalid-food source selections | Parent/child redundant pairs | Specifically flagged credible-but-weak picks |
| --- | ---: | ---: | ---: | ---: |
| A | 5/6 | 1 | 0 | 2 |
| B | 6/6 | 3 | 0 | 7 |
| C | 5/6 | 7 | 1 | 7 |
| Old v5 | 6/6 populated halls | 0 unambiguous | 0 unambiguous | See contextual comparison below |

Counts cover accepted outputs only. Rejected responses are failures, not zero-error meals; unavailable Oldenborg is excluded. Credible-but-weak counts are explicit ranking judgments listed below, not every possible preference disagreement. Plain breakfast oatmeal/quinoa are counted as inappropriate staple padding here because stronger composed mains are available, consistent with the requested highlight policy. Beans have a menu-specific side role in the burrito station. Neither calories nor capitalization determined these judgments.

## Clear mistakes, with source evidence

- A Frank brunch selects Sweet Thai Chili Sauce `m1:s0:i5`. It is an accompaniment to rolls/dumplings, not a main.
- B Collins brunch selects cajun grill zucchini `m0:s2:i2`, next to herb-roasted turkey and gratin potatoes. B Collins dinner selects chocolate mousse cake `m1:s6:i0` from sweets. B Frank brunch selects the WHOLE EATS allergen notice `m1:s1:i0`; the actual composed dish immediately after it is garlic noodles with skirt steak.
- C Hoch brunch selects Hash Brown Patty `m0:s4:i0`; dinner selects Baja Black Beans `m1:s2:i0` among burrito accompaniments. C Malott brunch selects roasted sweet potatoes `m0:s0:i1` and breakfast potatoes with peppers/onions `m0:s0:i8`. C McConnell brunch selects hot quinoa `m0:s0:i3` and hot oatmeal `m0:s4:i0` despite the omelet burrito, meat loaf, machaca burrito and French toast casserole. C Frary dinner selects Raspberry Swirl Blondie `m2:s5:i0`.

C McConnell dinner also selects pull pork slider `m1:s3:i1` and grill slider bar `m1:s3:i0`. Those are one parent/child overlap, established by the slider choices beneath the bar. The simplified format does not carry that relationship, so ownership-ID uniqueness cannot catch it.

## Coverage and weaker choices by hall

Hoch: A chooses three brunch dishes, including both chicken tender and chicken nuggets, while omitting the filled omelet and substantive plant choices. Those chicken rows are a probable near-duplicate, not a parent/child pair. It returns no dinner highlights despite piccata, burritos, salmon, moussaka and Korean BBQ chicken. B's brunch leans on balsamic chicken and deli roast beef, and its dinner includes deli roast beef while omitting moussaka and salmon. These three B picks are credible or ambiguous proteins but weaker summaries than named composed alternatives. C has the two clear accompaniment errors and also weak deli roast beef at dinner. Old v5 has no such clear sides, includes moussaka and piccata, and gives a more useful dinner summary than any of these three responses. Its brunch still overlooks several composed breakfast options.

Malott: A and B find chilaquiles, beef sirloin and tofu scramble. Both spend another brunch slot on the plant sausage patty despite the deluxe bagel bar and French toast options. C chooses two potato sides and omits tofu scramble and the bagel bar. All three find the barbecue bacon cheeseburger that v5 missed. A also finds chicken penne alfredo. Each selects generic pepperoni pizza while other named mains remain; this is one weak dinner pick per cell. V5 preserves plant chicken strips, carnitas, ravioli, wings and alfredo, so the burger improvement does not establish a wholesale quality improvement.

McConnell: B brunch is particularly good: omelet burrito, machaca burritos, French toast casserole, Impossible meat loaf and fried chicken. A finds three strong dishes plus beef menudo, a credible hearty soup, while missing a plant main. Its dinner jap chae noodles `m1:s1:i5` are questionable as a standalone highlight in the global burrito/bulgogi service; the copied station description does not establish a composed noodle entree. I record this as contextual uncertainty rather than an additional clear error. C pads brunch with grain/cereal staples and duplicates the slider program at dinner.

Collins: A is the best individual hall response, finding all five distinctive brunch offerings and five strong dinner mains. B improves carving/blintz coverage over v5 but spends a slot on zucchini; its dinner adds cake and cauliflower-crust vegetable pizza while omitting the stuffed pepper and named chicken. The pizza is eligible, just a weaker ranking choice here. C is credible, but its plain brunch eggs and cauliflower-crust pepperoni pizza are less informative than lumberjack eggs, carving, or Mongolian stir fry. V5 dinner is already the same strong set as A.

Frank: A identifies the lox/bagel bar that v5 missed, but its sauce is a clear error and it omits the outdoor omelet bar. B's allergen heading replaces an actual dish and it omits both meal bars. Both cells choose carne asada and pollo asado separately at dinner, leaving the named nacho program unrepresented. This is missed grouping, not counted as a parent/child redundant pair because neither selects the parent. A's chicken tortilla soup and B's kale salad are uncertain weaker meal choices; I do not count them in the conservative weak-pick totals. C fails the schema with six brunch groups; no accepted food list is available.

Frary: A is rejected for an ungrounded variant title. B and C both miss the mussels, shrimp and angel hair al pomodoro at brunch. B's Beyond breakfast sausage and C's pork sausage patty are weak picks while those substantive mains exist. C also spends two slots on blueberry/chocolate-chip pancakes; that is a second probable near-duplicate rather than a parent/child relationship. B dinner essentially matches v5's useful steak, tofu, taco, burger and pasta offering set. C replaces tofu/pasta with generic cheese pizza and a blondie. Its cheese pizza is the seventh counted credible-but-weak pick, while the blondie is a separate clear error.

The seven B weak picks are its three Hoch plain/deli proteins, Malott sausage and pepperoni pizza, Collins vegetable pizza, and Frary breakfast sausage. The seven C weak picks are Hoch deli roast beef, Malott plain scrambled eggs and pepperoni pizza, Collins plain scrambled eggs and pepperoni pizza, Frary breakfast sausage and cheese pizza. A's two are Malott sausage and pepperoni pizza. These counts do not imply a universal ban on those foods.

## User-approved Pitzer dinner expectations

| Cell | Italian Sunday | Bulgogi | Brisket | Slider bar |
| --- | --- | --- | --- | --- |
| A | Present | Beef/chicken merged | Present | Missing |
| B | Present | Beef only | Present | Present |
| C | Present | Missing; Korean burrito instead | Present | Present, but child also selected |
| Old v5 | Missing | Beef only | Present | Present |

B covers the four main offering categories if one beef alternative is accepted, but does not display the user's desired chicken-or-beef choice. A handles that merge correctly while missing sliders. No cell fully delivers the merged example and all four categories together. Old v5 selected beef, orange tofu, brisket, creamy macaroni and cheese, and slider bar; it did not select both bulgogis. Its macaroni is a contextual weaker accompaniment in that comfort station, not a universally ineligible pasta. B's eggplant parmesan is a stronger fifth highlight.

## What is worth testing next

There is concrete evidence for an inventory-then-ranking experiment. Across cells, strong candidates are often available and found somewhere, but eligibility and coverage fail at final selection: C picks potatoes, B picks a notice and cake, A empties dinner, and all accepted Frank responses miss the nacho parent. Require an initial inventory that separates credible mains, named programs, components and exclusions across every station. Rank validated distinct offerings in a second stage. Measure whether that reduces these specific errors enough to justify latency and cost; two passes are not automatically better.

The common-word variant guard is a necessary lexical screen, not semantic proof. Two dishes sharing pizza or noodles may still deserve separate ranking, and grouping does not establish that either is a main. The minimal format also cannot prevent parent/child duplication without additional relationship evidence. Preserve deterministic titles and exact source metadata, but treat eligibility, parent recognition and ranking as separate quality checks.

Some deterministic titles end awkwardly after truncation, including Frary's naan taco title ending in `or` and the omelet title ending after a comma. Original metadata remains available, but this needs display polishing before release. Shorten source titles at a meaningful phrase boundary, retaining choices through detail metadata rather than implying an incomplete option list.

Nothing in this blind file establishes an improvement from medium reasoning or identifies model configurations. Do not attribute B's better coverage to an unobserved setting. Evaluate any proposed setting against repeated, identically captured inputs and frozen quality criteria. Keep human preference judgments distinct from schema validity, hard exclusion mistakes and reviewer disagreements.
