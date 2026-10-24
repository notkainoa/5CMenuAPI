# Group screening review, GPT-6.1 Sol

This is an assistant-provisional semantic review, not a human-approved benchmark. I inspected the full Oct 4 source menus, the current grouped policy, and exactly 12 completed results from `.wrangler/group-eval/screen-r2.json`. That snapshot contains Hoch and Malott only, each with three models and two strategies, one run per condition. I did not inspect holdout results or call Groq. The recorded prompt hash is `9be6051c4a3c888d8850eea88e7c171846371a7db7501aa8d15163ad89663442`.

## Reliability in this snapshot

| Model | Valid hall responses | Observed failures |
| --- | ---: | --- |
| GPT-OSS 120B | 4/4 | None rejected, but several semantic errors |
| GPT-OSS 20B | 1/4 | Two provider JSON failures; one ungrounded title |
| Qwen 3.8 27B | 0/4 | Ownership overlap, invalid kind/cardinality, ungrounded title |

These are twelve exploratory calls, not evidence of stable model rankings or a prompt winner. The valid 20B result returns an empty Malott brunch despite multiple credible mains. Syntactic success is not useful coverage.

The 20B provider failures include malformed `componentIds` keys, a dinner salmon ID under Hoch brunch, and ten Malott brunch groups despite the cap. The rejected 20B Hoch cluster result has a near-miss `Roasted Beef` title for source `Roast Beef`, but also selects hash browns and steamed rice, omits substantial plant mains, and elevates deli roast beef.

Qwen's Hoch program result owns the beef barbacoa ID both as parent and component and combines balsamic chicken with Belgian waffle as variants. Its Hoch cluster result attaches components to singles and merges chicken machaca burrito with carne asada. Its Malott cluster result calls a one-source bagel bar `variants`; its program result invents `margargarita` in a pizza title. Some underlying picks are useful, but repairing these arrays mechanically would not repair semantic mistakes.

The schema and its overlapping source/component concepts plausibly add difficulty. This snapshot does not isolate that cause from model ability, prompt length, model-specific constrained JSON support, or generation settings. GPT models have a 2000-token completion budget with low reasoning; Qwen has 1000 with no reasoning. Recorded successful responses are not obviously truncated. Test a simpler schema under controlled settings before blaming output complexity alone.

## Semantic mistakes that pass validation

Both 120B Hoch strategies promote two pho broths as a main offering. The source lists broth, not a composed pho meal or noodle/protein bar. Grouping two ineligible rows does not make an eligible entree. The program-first version also prefixes the combined title with `Allergen Free`, although only the chicken broth name supplies that phrase. Lexical source grounding permits the phrase while incorrectly transferring its scope to vegetable broth.

Both 120B Hoch results turn `Hmc Burrito Bar Beef Barbacoa` into `Burrito Bar`. The abbreviated title is technically a deletion from a source name, so calling its wording wholly invented would be wrong. The semantic leap is treating a row whose description is specifically braised beef as the parent of the separate composed chicken machaca burrito. The station context may suggest a burrito service, but the menu does not cleanly establish that row as the named umbrella. Its program status needs an ambiguity judgment, not a substring rule. The cluster result additionally folds carne asada and several accompaniments beneath that beef row.

Hoch program-first omits chicken piccata while choosing vegetable fried rice next to grilled salmon. The rice description is composed, so this is a contextual ranking concern rather than a guaranteed side error. Hoch cluster chooses plain deli roast beef despite available Korean BBQ chicken. Both brunch outputs omit several useful composed breakfast or named plant dishes while spending slots on broth and multiple chicken/nugget selections.

Malott 120B cluster merges chicken apple sausage with plant-based sausage patty. They are breakfast protein alternatives in a broad sense, but weak standalone staples under this menu's stronger options. Its dinner groups four pizza rows, then omits the named barbecue bacon cheeseburger and baked chicken penne alfredo. Program-first also selects generic pepperoni pizza over those specific dishes. Neither strategy's ordering instructions reliably replace weak staples with strong composed meals.

Malott's bagel bar appears as `program` in one 120B response and `single` in the other. That kind disagreement is less consequential than missing an offering, but demonstrates that kind semantics are not stable. The current prompt already explicitly requests source-name titles, avoids unrelated variant merges, and describes cardinality. More repetitions of those instructions alone are unlikely to solve the observed failures.

## Pitzer expectations and rubric status

There are no McConnell results in the exact twelve-result snapshot, including failed raw provider generations. Therefore I cannot report whether this batch captures the user's four Pitzer dinner expectations. Absence of an unexecuted hall is not a miss. Check later McConnell valid and failed raw outputs separately for Italian Pitzer Sunday, merged beef/chicken bulgogi, smoked BBQ brisket, and grill slider bar. Orange tofu must not become tofu bulgogi, and the Korean burrito should not become a second overlapping bulgogi program without justification.

I froze `.wrangler/group-eval/oct4-rubric.json` with two or three critical offering alternatives for every nonempty meal, plus conservative side/heading IDs, program relationships and variants. The source contains fourteen meal records, twelve nonempty, not fourteen nonempty meals. The two continental breakfasts are empty; Oldenborg has no published menu. This rubric explicitly records that the review is not blind: Oct 4 menus and one current screening result had been inspected before freezing. User-approved Pitzer expectations are separate from assistant-provisional labels.

## Architecture recommendations

Resolve singles and programs deterministically to their original source names by default. Apply a faithful length-bound shortening only where needed, retaining the original name in source metadata. The model should choose an offering, not recreate its spelling. This removes `Roasted Beef`, pizza typos and much title-generation work. It also avoids changing an opaque real name into an invented bowl or broad bar title. It does not establish program eligibility: exact naming cannot fix an incorrectly selected beef row as parent.

For variants, require a shared named dish concept and preserve a concise explicit choice title. Bulgogi, French toast and pizza are examples. Common words such as chicken, vegetable, grilled, rice or a shared station are inadequate. A shared-word check is a useful conservative filter, not proof: chicken burrito and beef burrito can be variants, but two unrelated chicken dishes cannot. Keep eligibility before grouping so breakfast sausages and pho broths do not acquire priority through grouping. Reject combined dietary labels unless their scope is explicit across every represented alternative; preferably omit those labels from generated combined titles.

A simpler inference contract could select bounded candidate IDs and limited variant member IDs. The server can construct titles and component links from a validated candidate inventory. Separate parent identification from ranking, or provide a compact list of contextual candidate programs with uncertainty instead of asking smaller models to rediscover and serialize every component relationship. Preserve raw output for diagnosis and distinguish provider-schema errors, reference errors, semantic errors and preference disagreements. Avoid silently salvaging invalid generations into public highlights.

Improve coverage through an all-station candidate inventory, then eligibility, parent/child suppression, deduplication, and ranking of distinct offerings. Track omitted stronger composed dishes against selected generic staples. This works for Pitzer's Italian program, Frank's omelet and lox bars, Frary's seafood/pasta, and Collins's blintz and carving descriptions without hardcoding the user's four dishes. The cap stays up to five, and a plant option must be substantial rather than a side selected for variety.

Compare the current contract against deterministic titles and a reduced relationship schema on identical menus with repeated calls. Include end-to-end valid-and-useful coverage, not just JSON validity. Do not use reviewer votes as a substitute for human preference labels.
