# Highlights review — Oct 4 audit + policy/fixtures

I've read `src/highlight-policy.ts`, `src/highlights.ts`, the full Oct 4 day-audit (all 5 live halls), and both fixtures, plus `test/highlight-quality.test.ts`. Everything below is food-evidence grounded; opinions are labeled.

## 1. What the Oct 4 v5 run actually selected

- **hoch BRUNCH**: Omelet (m0:s4:i1), Belgian Waffle (m0:s1:i4), Balsamic Grilled Chicken (m0:s10:i0), **Crispy Chicken Tender (m0:s1:i0), Veggie Chick'n Nuggets (m0:s1:i2)**. Missed Texas French Toast, Chocolate Chip Pancakes, Sausage Gravy & Biscuit; the two Chef Corner nugget/tender items are appetizer-grade (120/250 cal) and ate 2 of 5 slots.
- **hoch DINNER**: Grilled Salmon (m1:s1:i4), **Carne Asada (m1:s2:i5), Burrito Bar Beef Barbacoa (m1:s2:i3)**, Eggplant Lentil Moussaka (m1:s5:i5), Chicken Piccata (m1:s8:i2). Two of five slots went to components of the same HMC Burrito Bar program while the composed Chicken Machaca Burrito (730 cal, m1:s2:i4) was skipped.
- **malott BRUNCH**: scrambled eggs, herb roasted beef sirloin, chilaquiles rojo, whole grain french toast, tofu-and-broccoli scramble — good, but the named **deluxe bagel bar** (m0:s4:i0) was missed despite the prompt's "prefer the bar's ID" rule.
- **malott DINNER**: cheese ravioli, **plant-based chicken strips** (generic), carnitas bowl, **roasted achiote chicken wings** (appetizer), baked chicken penne alfredo; skipped the PM Grill barbecue bacon cheeseburger.
- **mcconnell BRUNCH**: omelet burrito bar, impossible meat loaf, buttermilk fried chicken, egg-and-cheese muffin, blueberry pancakes — solid; beef machaca burritos / brioche french toast casserole missed (cap-bound, fine).
- **mcconnell DINNER** (confirmed): beef bulgogi (m1:s1:i1), orange tofu (m1:s1:i3), smoked bbq brisket (m1:s2:i5), creamy macaroni and cheese (m1:s2:i2), grill slider bar (m1:s3:i0). It did **not** pick both bulgogi proteins.
- **collins BRUNCH**: scrambled eggs (staple), lumberjack scramble, "early meal" — missed acai bowls, blintz, the CarveCraft. **collins DINNER**: genuinely good (lemon-herb chicken, stuffed bell pepper, Mongolian stir fry, carnitas, plant-based orange chicken).
- **frank BRUNCH**: garlic noodles w/ skirt steak (great), plus scrambled eggs / tofu scramble / pancakes / French toast from the grill line; missed the **Outdoor Omelet Bar** (m1:s4:i1) and **Lox & Bagel Bar** (m1:s7:i0). **frank DINNER**: carne asada, pollo asado, meatballs, birria bao, garlic-cheese-bread squares (weak 5th).
- **frary BRUNCH**: omelet bar, blueberry pancakes, cinnamon French toast, tofu scramble, Beyond sausage (staple). **frary DINNER**: Char Grilled Steak, Naan Street Tacos, Marinated Herb Tofu, **"BURGER BAR" (m2:s3:i0)** and **"PASTA BAR" (m2:s2:i3)** — it selected the two in-feed headings as items.
- Empty/heading cases: frank & frary "Continental Breakfast" are true empty meals (`stations: []`), correctly `[]` and forced `maxItems: 0` by schema. "NACHO BAR", "FRARY FAVES", "TODAY`S SOUP", "made without the top-9…" were correctly avoided — except the two frary picks above.

## 2. Root causes (structural, not model capacity)

1. **The merge you want is impossible by construction.** `Selection` is a flat `itemIds: string[]`; `withHighlights` resolves display names from the original menu; no label field exists anywhere. The system prompt even forbids it ("Never… combine item names"). GPT-OSS-120b did the only allowed thing: pick `beef bulgogi` alone. This is a data-model constraint, not prompt-adherence or model capacity.
2. **The prompt contradicts itself on bars vs headings.** It says "exclude station headings" but "prefer a named meal bar's existing ID; don't spend slots on the bar's components." With zero reliable signal in the feed, the model resolved that tension differently per hall: it took the literal "BURGER BAR"/"PASTA BAR" item IDs at frary (defensible under the bar rule, useless in display), avoided "italian pitzer sunday" at pitzer/pitzer-mac-bar-style names, and was burned by registration noise — the only signal is item position (index 0 + ≥3 sibling components, often ALL-CAPS, shared descriptions) and feed junk like 33,285-calorie cupcakes, a 17,940-cal "pesto", 12,672-cal Pollo Asado, "roasted broccoli,"
3. **Duplicated program components stay eligible.** hoch took two burrito-bar fillings; frank took carne asada + pollo asado (duplicated across Mainline and Grill). The prompt's "avoid near-duplicates" doesn't cover sibling components of one program.
4. Side leakage persists in borderline forms (malott wings, garlic-cheese-bread squares, collins polenta) — mild, not the 10-02-style failures (which were worse: basmati/brown rice as dinner mains, but that predates this policy).

Structural code note (read-only): `highlightInput` and `generateHighlights` each re-derive the short-integer ordering independently; they agree only by being copies of the same two loops. Any edit to one silently misassigns IDs — the round-trip test in `test/highlight-quality.test.ts` is the only guard.

## 3. Proposed grouped highlights — every nonempty Oct 4 meal (canonical IDs)

```jsonc
{
  "hoch": {
    "m0": [
      {"itemIds": ["m0:s4:i1"]},                                   // Made To Order Filled Omelet
      {"itemIds": ["m0:s5:i1"]},                                   // Texas French Toast
      {"itemIds": ["m0:s5:i5"]},                                   // Sausage Gravy & Biscuit
      {"itemIds": ["m0:s10:i0"]},                                  // Balsamic Grilled Chicken
      {"itemIds": ["m0:s6:i3"]},                                   // Jerk Tofu (plant main)
      // alt: m0:s1:i4 Belgian Waffle, m0:s5:i13 Chocolate Chip Pancakes;
      // deliberately dropped: crispy chicken tender m0:s1:i0, veggie chick'n nuggets m0:s1:i2 (appetizer-grade)
    ],
    "m1": [
      {"itemIds": ["m1:s2:i4"]},                                   // Chicken Machaca Burrito (composed)
      {"itemIds": ["m1:s1:i4"]},                                   // Grilled Salmon
      {"itemIds": ["m1:s8:i2"]},                                   // Chicken Breast Piccata
      {"itemIds": ["m1:s5:i5"]},                                   // Eggplant Lentil Moussaka (plant)
      {"itemIds": ["m1:s2:i5"], "label": "Burrito Bar Carne Asada", "absorbs": ["m1:s2:i3"]}
      // or label "HMC Burrito Bar" absorbing m1:s2:i3+i4+i5 — but no bar item ID exists; station-derived label
    ]
  },
  "malott": {
    "m0": [
      {"itemIds": ["m0:s0:i6"]},     // chilaquiles rojo
      {"itemIds": ["m0:s0:i5"]},     // herb roasted beef sirloin
      {"itemIds": ["m0:s4:i0"]},     // deluxe bagel bar (named bar)
      {"itemIds": ["m0:s6:i3"]},     // whole grain french toast
      {"itemIds": ["m0:s0:i4"]}      // tofu and broccoli scramble (drop plain scrambled eggs)
    ],
    "m1": [
      {"itemIds": ["m1:s2:i0"]},     // carnitas bowl
      {"itemIds": ["m1:s8:i1"]},     // baked chicken penne alfredo
      {"itemIds": ["m1:s0:i0"]},     // cheese ravioli
      {"itemIds": ["m1:s5:i0"]},     // barbecue bacon cheeseburger (PM Grill)
      {"itemIds": ["m1:s1:i0"]}      // plant-based chicken strips — only plant option; weak but not a forced side
      // dropped: achiote chicken wings m1:s2:i1 (appetizer)
    ]
  },
  "mcconnell": {
    "m0": [
      {"itemIds": ["m0:s3:i0"]},     // build your own omelet burrito
      {"itemIds": ["m0:s2:i4"]},     // beef machaca burritos
      {"itemIds": ["m0:s1:i5"]},     // buttermilk fried chicken
      {"itemIds": ["m0:s2:i3"]},     // brioche french toast casserole
      {"itemIds": ["m0:s1:i4"]}      // impossible meat loaf (plant)
    ],
    "m1": [
      {"itemIds": ["m1:s0:i0"], "label": "Italian Pitzer Sunday", "absorbs": ["m1:s0:i1","m1:s0:i2","m1:s0:i3","m1:s0:i4","m1:s0:i5","m1:s0:i6","m1:s0:i7","m1:s0:i8","m1:s0:i9","m1:s0:i10","m1:s0:i11","m1:s0:i12"]},
      {"itemIds": ["m1:s1:i1", "m1:s1:i2"], "label": "Beef or Chicken Bulgogi"},
      {"itemIds": ["m1:s2:i5"]},     // smoked bbq brisket
      {"itemIds": ["m1:s3:i0"], "label": "Grill Slider Bar", "absorbs": ["m1:s3:i1","m1:s3:i2","m1:s3:i3","m1:s3:i4"]},
      {"itemIds": ["m1:s1:i3"]}      // orange tofu (my 5th pick) — alt: m1:s1:i0 Korean burrito (user preference)
    ]
  },
  "collins": {
    "m0": [
      {"itemIds": ["m0:s0:i1"]},     // lumberjack scramble
      {"itemIds": ["m0:s1:i0"]},     // pomegranate cheese blintz
      {"itemIds": ["m0:s2:i0"]},     // the CarveCraft
      {"itemIds": ["m0:s3:i0"]},     // acai bowls
      {"itemIds": ["m0:s4:i0"]}      // early meal
    ],
    "m1": [  // endorse the actual v5 run as-is
      {"itemIds": ["m1:s0:i2"]}, {"itemIds": ["m1:s0:i0"]}, {"itemIds": ["m1:s1:i0"]},
      {"itemIds": ["m1:s3:i0"]}, {"itemIds": ["m1:s4:i0"]}
    ]
  },
  "frank": {
    "m0": [],                        // Continental Breakfast: stations [] — true empty meal
    "m1": [
      {"itemIds": ["m1:s1:i1"]},     // Vietnamese garlic noodles w/ skirt steak
      {"itemIds": ["m1:s4:i1"], "label": "Outdoor Omelet Bar"},
      {"itemIds": ["m1:s7:i0"], "label": "Lox & Bagel Bar"},
      {"itemIds": ["m1:s3:i8"]},     // Buttermilk Pancakes
      {"itemIds": ["m1:s3:i11"]}     // Cinnamon French Toast
    ],
    "m2": [
      {"itemIds": ["m2:s0:i1", "m2:s0:i2"], "label": "Nacho Bar: Carne Asada or Pollo Asado", "absorbs": ["m2:s0:i0"]},
      {"itemIds": ["m2:s1:i1"]},     // Meatballs w/ crisp red potatoes
      {"itemIds": ["m2:s2:i0"]},     // Birria Bao Bun Taco
      {"itemIds": ["m2:s2:i1"]}      // Garlic Cheese Bread Squares (weak 4th — cap may close at 3-4 honestly)
    ]
  },
  "frary": {
    "m0": [],                        // Continental Breakfast — true empty meal
    "m1": [
      {"itemIds": ["m1:s1:i0"], "label": "Omelet Bar"},
      {"itemIds": ["m1:s2:i1"]},     // Breaded Butterfly Shrimp (Pizza station hosts mains)
      {"itemIds": ["m1:s3:i0"]},     // Blueberry Pancakes
      {"itemIds": ["m1:s3:i3"]},     // Cinnamon French Toast
      {"itemIds": ["m1:s0:i4"]}      // Tofu Scramble (plant; Beyond sausage dropped as staple)
    ],
    "m2": [
      {"itemIds": ["m2:s0:i0"]},     // Char Grilled Steak
      {"itemIds": ["m2:s1:i0"]},     // Naan Street Tacos (itself a chicken/beef/tofu choice — no merge needed)
      {"itemIds": ["m2:s3:i1", "m2:s3:i2"], "label": "Burger Bar: Beef or Turkey", "absorbs": ["m2:s3:i0","m2:s3:i3","m2:s3:i4"]},
      {"itemIds": ["m2:s0:i3"]},     // Marinated Herb Tofu (plant; plantBased=true)
      {"itemIds": ["m2:s2:i2"]}      // Turkey Bacon Bravo Flatbread (replaces "PASTA BAR" heading)
    ]
  }
}
```
No label/object-keys on a highlight = display the resolved original item name. `absorbs` documents station siblings the parent covers (not stored — see §5).

## 4. Programs vs. headings, and disagreement with the user's four

- **True empty meals**: frank/frary Continental Breakfast (`stations: []`). Honest empties beat padding — the schema already forces this.
- **Heading-like in-feed items**: `NACHO BAR`, `PASTA BAR`, `BURGER BAR`, `FRARY FAVES`, `TODAY`S SOUP/SALADS/SMOOTHIE`, `WHOLE EATS STATION…`, `OUTDOOR PATIO…`, "made without the top-9…", `Self-serve`, `Have A Nice Day`, `teriyaki`/`pesto` (mis-keyed condiments). Distinguishing signal: ALL-CAPS (Pomona), index-0 position followed by ≥3 sibling components with shared/copy-pasted descriptions, no cooking verbs of its own.
- **True named meal programs** (booking by that name yields a full meal): `grill slider bar`, `build your own omelet burrito`, `deluxe bagel bar`, `fish taco bar`, `build your own cajun saute` (description literally enumerates proteins+pasta), `ken's pad thai bar`, `Mongolian stir fry`, `southern surf and turf bar`, `the oasis experience`. **`italian pitzer sunday` qualifies**: index-0 item with no description, followed by 3 pastas/3 meatballs/3 sauces/broccoli/garlic bread — the pitzer-mac-bar shape from 10-02. It's an inference, not a labeled fact — the feed never says so.
- **Overlapping parent/child**: the crux. Three shapes recur: (a) parent item exists (`italian pitzer sunday`, `grill slider bar`, `BURGER BAR`) → select parent, suppress children; (b) program has no parent item (hoch CREATIONS burrito bar) → children must compete on their own merit — that's where Carne-Asada-plus-Barbacoa double-spending happens; (c) no parent, no program — siblings sharing a description are *alternatives within one option*, the beef/dak-chicken bulgogi case. These need different handling; a single rule can't.

**Labeled disagreements (my opinion vs. stated user preference):**
- I'd rank the 4 exactly as the user wants except item 1's classification: "Italian Pitzer Sunday" is a program label, not a dish — as a highlight it must visibly stand for the pasta/meatball program, which is what a grouped label gives. (Mild caveat, keep the pick.)
- The merged bulgogi pairing is **data-backed**, not cosmetic: `beef bulgogi` and `dak chicken bulgogi` carry byte-identical descriptions; only the protein token differs. Merge justified.
- I do **not** fully endorse the Korean-burrito-for-orange-tofu substitution if it's meant as a replacement: `orange tofu` is the Korean program's actual vegan entree. My candidate 5th is orange tofu; Korean burrito is a fine alternate if vegetable-forward variety beats the vegan entree. Both are food-legitimate — this is preference, not correctness. (And keeping `creamy macaroni and cheese` in the actual v5 run is defensible under "substantial pasta" — it's a composed vegetarian comfort main, not a forced side.)

## 5. API/schema suggestion (grouped display labels, back-compatible)

Keep storage flat and additive:

```jsonc
// highlights:v1 (v2 key once shipped)
"selections": [{
  "mealId": "m1",
  "itemIds": ["m1:s0:i0","m1:s1:i1","m1:s1:i2","m1:s2:i5","m1:s3:i0"],   // unchanged, legacy readers keep working
  "groups": [                                                            // new optional field
    {"itemIds": ["m1:s0:i0"], "label": null},                            // singleton, no rename
    {"itemIds": ["m1:s1:i1","m1:s1:i2"], "label": "Beef or Chicken Bulgogi"},
    {"itemIds": ["m1:s2:i5"], "label": null},
    {"itemIds": ["m1:s3:i0"], "label": null}
  ]
}]
```

- **Validation** (`validateSelections` extension): every group's `itemIds` resolves through the same existing ID-against-meal check; groups are disjoint; an ID inside a group may not also appear outside groups in that meal; groups count + solo picks ≤ 5; `label` allowed only when a group has >1 item and every character of the label comes from the source items' names/transitions ("or", title-cased) — bans invented dishes and dietary claims by construction.
- **Resolution**: display name = `label` if present, else the resid­olved `item.name` — labels are decoration over verified source items, so a hallucination can't leak through.
- **Backwards compat**: old records without `groups` synthesize singletons; the public `meals[].items` shape is untouched, `groups` rides along additive. Bump `PROMPT_VERSION` to `'6'`/new key only because the model-facing schema changes; `menuVersion` already keys invalidation correctly.
- **Model-facing schema** (only if the model emits groups): each meal array of `{itemIds: string[], label?: string}` with `maxItems` on both levels, strict, `label` constrained — else keep the model output flat and do grouping app-side (Strategy 1 below needs no schema change at all).

## 6. Two substantially different prompt strategies

**Strategy A — single-pass, deterministic app-side grouping (no schema change).** Model keeps returning ranked IDs. The merger happens in TypeScript: (1) identical-description siblings *within a station* whose names differ by one protein token → one highlight, label "Beef or Chicken Bulgogi"; (2) recognized parent item (index 0 + ALL-CAPS-or-"bar" name + ≥3 siblings sharing a description) → singleton program highlight, siblings excluded; (3) honest cap enforcement — model is told the *display* item count matters, so station-relative redundancy costs a slot. Zero extra tokens, fully back-compatible, fully testable offline against 09-30/10-02 fixtures.

**Strategy B — two-pass generate→critic.** Pass 1: same hall-day input, model lists **all** candidate mains with one-word role tags (`main | bar | heading | side`), no cap. Pass 2 (cheap/short, deterministic prompt): apply the elimination checklist — drop headings/sides, collapse program children into parents, merge protein twins — and return ≤5 ordered IDs. The structural constraint is enforced between passes by code, and the critic sees the full candidate inventory (fixing the "fill the list as you read station 1" failure mode directly). Costs one extra call per hall-day; keep `CALL_INTERVAL_MS` budgeting and fall back to Strategy A grouping if pass 2 is empty.

## 7. Fair multi-model Groq A/B + evaluation

- **Arms**: `openai/gpt-oss-120b` (current) vs a comparable Groq model (e.g. `llama-3.3-70b-versatile`), crossed with prompt v5 vs Strategy-B (2×2), or at minimum model-only. Identical `reasoning_effort`, token budget, temp 0.
- **Examples**: tune on **09-30** (rich failure variety: frary BURGER BAR problem shape absent — but hoch/malott/mcconnell brewing classics are all there) plus 10-02's four other halls; **holdout = Oct 4** entirely, and never re-tuned après inspection. Explicitly do **not** double-book a fixture: if any Oct 4 finding motivates a prompt tweak, that tweak is validated on 09-30/10-02 only.
- **Gold, not opinions**: before running arms, hand-build the holdout mains label set (§3 above is exactly that — derived from menus alone, before seeing any output). Scored dimensions: composed-entree precision/recall vs. gold; side leakage (measured the same way `scoreSelections` already does: sides/checks); heading leakage (new explicit check); bar handling (parent picked, zero children); plant-entree coverage *without forced padding* — count plain-plant-side picks as fails; slot efficiency (distinct programs/highlights per meal); ID/schema-valid rate; tokens, latency, and `attempts`/`duration` cost.
- **Measurement hygiene**: paired per hall-meal (not pooled), ≥3 samples/arm for variance; reviewer votes, when used for anything judge-flavored (e.g. "is mac & cheese a main"), are one signal with reported inter-rater agreement — **never ground truth**; disagreements with the user's stated preferences get logged as exactly that (I've done 2 above).

**Bottom line**: the Oct 4 v5 outputs are mostly sound with a consistent failure family — bar/heading sin and sibling-component double-spending — and the merged-highlight change the user wants cannot happen inside the current flat `itemIds` contract at any model size; it needs the additive `groups` layer (app-side labels for Strategy 1, model-side for Strategy 2), and "italian pitzer sunday" legitimately plays the same eligible named-program role the prompt already grants `grill slider bar` and `Mongolian stir fry`.

No files were modified; no model APIs called.
