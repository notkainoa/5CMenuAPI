## Review: Oct 4 highlights v5 — structural failure, not model capacity

### 1. Root causes

1. **Flat-ID schema + `never combine names` + `exclude headings` makes correct answer inexpressible.**
   - `mcconnell/m1` dinner has 3 true programs that are *bars with components sharing one station*:
     - `s0 chef's table`: `m1:s0:i0 italian pitzer sunday` + pastas `i1,i2,i3` + meatballs `i4,i5,i6` + sauces `i8,i9,i10` + `i11 garlic bread` + `i7 roasted broccoli,` + `i12 crushed peppers`
     - `s1 global`: `i0 korean burrito` + `i1 beef bulgogi` + `i2 dak chicken bulgogi` + `i3 orange tofu` + bases `i4 steamed rice,i5 jap chae` + sauces `i7,i8,i9` + `i6 fried egg`. All share identical description `green onions, onions...` = one bar.
     - `s3 grill`: `m1:s3:i0 grill slider bar` + `i1 pull pork,i2 beef,i3 bbq tofu,i4 caprese` + `i5 fries`.
   - Policy says “prefer bar ID, don’t spend slots on components” but also “exclude station headings, never combine names.” Model cannot emit `Chicken or beef bulgogi` or `Italian pasta bar`. So v5 emits singletons: `m1:s1:i1 beef bulgogi + m1:s1:i3 orange tofu + m1:s2:i5 brisket + m1:s2:i2 mac + m1:s3:i0 slider`. Misses Italian entirely, double-counts Korean bar, fills 5th slot with a side.
2. **Heading vs program classifier missing.** `italian pitzer sunday`, `grill slider bar`, `NACHO BAR`, `BURGER BAR`, `PASTA BAR`, `OMELET BAR`, `LOX AND BAGEL BAR`, `deluxe bagel bar`, `Mongolian stir fry`, `build your own omelet burrito` are items that *are* programs. `TODAY'S SOUP/SALADS/SMOOTHIE`, `WHOLE EATS STATION...`, `Self-serve`, `Have A Nice Day`, `made without top-9...`, `OUTDOOR PATIO - Omelettes...` (descriptive duplicate of next item), `NACHO BAR` duplicated in `frank/m2 s0:i0` + `s3:i0` are empty headings/duplicates. Current prompt: “exclude all station headings” with no test. Result: Italian skipped as “heading”, slider picked correctly by luck, Frank nacho double-count risk.
3. **Overlapping parent/child not enforced cross-station.** Same nacho proteins in `frank/m2 s0:i1,i2` and `s3:i1,i2`; pasta bar `frary/m2 s2:i3 PASTA BAR` vs `i4 penne,i5 tortellini`; burger bar `m2:s3:i0` vs `i1-i4 patties`; Korean burrito vs bulgogi vs tofu (same banchan). V5 has no dedup rule beyond “avoid near-duplicates.”
4. **Plant preference forces bad sides when no entree exists.** Correct behavior per prompt (“never elevate a side”) but v5 violates it: picks `plant-based chicken strips` (generic patty), `creamy mac` as “variety”, misses real entrees `eggplant parmesan m1:s4:i0`, `stuffed tomatoes m1:s2:i4`, `marinated herb tofu`. In halls with no plant main (`malott/m1 dinner`, `frank/m2 dinner`) correct is 4 highlights, not 5 with cauliflower/rice.
5. **Brunch/lunch hybrid + `featured` noise.** `mcconnell/m0` mixes breakfast + `global i4 impossible meat loaf,i5 fried chicken` + `stocks`. V5 picks plain `waffle`, plain `egg sandwich` over `brioche french toast casserole`, `beef machaca burritos`, `just eggs scrambled`. `malott` `featured:true` on everything (including `pesto 17940 cal`, `teriyaki`, allergen notice) is ignored correctly by v5 except waste.

### 2. On user’s Pitzer/McConnell four

Agree with structure, with labeled disagreement:

- Agree: Italian bar, bulgogi-merged, brisket, slider-bar = 4 groups, cap 5 is max not target. `korean burrito m1:s1:i0` should **not** be 5th — same bar/components as bulgogi, would double-count. `creamy mac m1:s2:i2` should be dropped — side/starch served with `pull pork slider with mac`, not a main.
- **Disagreement with user preference (food-evidence):** if a 5th is used, it should not be `orange tofu m1:s1:i3` (same Korean bar, same description) nor `korean burrito`. Distinct plant is `eggplant parmesan m1:s4:i0` (marinara+daiya, own station) or hearty `beef menudo m1:s6:i0`. I propose 4 + optional eggplant = 5. `roasted broccoli,` (trailing comma), `steamed rice/jap chae`, sauces, `garlic bread`, `fries` are sides.

### 3. Proposed grouped highlights, Oct 4, canonical IDs

Format: groups count toward 5-cap. `anchor` is display source; `members` are merged variants/components. Flat fallback = anchors only.

```json
{
  "hoch": {
    "m0": {"groups": [
      {"label": "Made To Order Filled Omelet", "anchor": "m0:s4:i1", "members": []},
      {"label": "Texas French Toast", "anchor": "m0:s5:i1", "members": []},
      {"label": "Spinach And Feta Cheese Roll", "anchor": "m0:s6:i2", "members": []},
      {"label": "Balsamic Grilled Chicken", "anchor": "m0:s10:i0", "members": []}
    ]},
    "m1": {"groups": [
      {"label": "Grilled Salmon", "anchor": "m1:s1:i4", "members": []},
      {"label": "Chicken Machaca Burrito", "anchor": "m1:s2:i4", "members": []},
      {"label": "Carne Asada", "anchor": "m1:s2:i5", "members": []},
      {"label": "Korean Bbq Chicken", "anchor": "m1:s4:i3", "members": []},
      {"label": "Eggplant Lentil Moussaka", "anchor": "m1:s5:i5", "members": []}
    ]}
  },
  "malott": {
    "m0": {"groups": [
      {"label": "herb roasted beef sirloin", "anchor": "m0:s0:i5", "members": []},
      {"label": "chilaquiles rojo", "anchor": "m0:s0:i6", "members": []},
      {"label": "tofu and broccoli scramble", "anchor": "m0:s0:i4", "members": []},
      {"label": "scrambled eggs", "anchor": "m0:s0:i0", "members": []},
      {"label": "deluxe bagel bar", "anchor": "m0:s4:i0", "members": []}
    ]},
    "m1": {"groups": [
      {"label": "cheese ravioli", "anchor": "m1:s0:i0", "members": []},
      {"label": "carnitas bowl", "anchor": "m1:s2:i0", "members": []},
      {"label": "roasted achiote chicken wings", "anchor": "m1:s2:i1", "members": []},
      {"label": "barbecue bacon cheeseburger on a brioche bun", "anchor": "m1:s5:i0", "members": []},
      {"label": "baked chicken penne alfredo", "anchor": "m1:s8:i1", "members": []}
    ]}
  },
  "mcconnell": {
    "m0": {"groups": [
      {"label": "build your own omelet burrito", "anchor": "m0:s3:i0", "members": []},
      {"label": "brioche french toast casserole", "anchor": "m0:s2:i3", "members": []},
      {"label": "beef machaca burritos", "anchor": "m0:s2:i4", "members": []},
      {"label": "just eggs scrambled", "anchor": "m0:s2:i2", "members": []},
      {"label": "beef menudo", "anchor": "m0:s7:i0", "members": []}
    ]},
    "m1": {"groups": [
      {"label": "Italian Pitzer Sunday", "anchor": "m1:s0:i0", "members": ["m1:s0:i1","m1:s0:i2","m1:s0:i4","m1:s0:i5","m1:s0:i6"]},
      {"label": "Chicken or Beef Bulgogi", "anchor": "m1:s1:i1", "members": ["m1:s1:i2"]},
      {"label": "smoked bbq brisket", "anchor": "m1:s2:i5", "members": []},
      {"label": "grill slider bar", "anchor": "m1:s3:i0", "members": ["m1:s3:i1","m1:s3:i2","m1:s3:i3","m1:s3:i4"]}
    ], "optional5th": {"label": "eggplant parmesan", "anchor": "m1:s4:i0", "members": []}}
  },
  "collins": {
    "m0": {"groups": [
      {"label": "lumberjack scramble eggs", "anchor": "m0:s0:i1", "members": []},
      {"label": "pomegranate cheese blintz", "anchor": "m0:s1:i0", "members": []},
      {"label": "the CarveCraft", "anchor": "m0:s2:i0", "members": []},
      {"label": "acai bowls", "anchor": "m0:s3:i0", "members": []},
      {"label": "early meal", "anchor": "m0:s4:i0", "members": []}
    ]},
    "m1": {"groups": [
      {"label": "stuffed bell pepper", "anchor": "m1:s0:i0", "members": []},
      {"label": "lemon-herb bone-in chicken", "anchor": "m1:s0:i2", "members": []},
      {"label": "Mongolian stir fry", "anchor": "m1:s1:i0", "members": []},
      {"label": "plant based orange chicken stir fry", "anchor": "m1:s3:i0", "members": []},
      {"label": "pork carnitas", "anchor": "m1:s4:i0", "members": []}
    ]}
  },
  "frank": {
    "m0": {"groups": []},
    "m1": {"groups": [
      {"label": "Vegetable and Beef Mandu Dumpling", "anchor": "m1:s0:i2", "members": []},
      {"label": "Vietnamese American Garlic Noodles with Skirt Steak", "anchor": "m1:s1:i1", "members": []},
      {"label": "OUTDOOR OMELET BAR", "anchor": "m1:s4:i1", "members": []},
      {"label": "LOX AND BAGEL BAR", "anchor": "m1:s7:i0", "members": []},
      {"label": "Tofu Scramble", "anchor": "m1:s3:i6", "members": []}
    ]},
    "m2": {"groups": [
      {"label": "NACHO BAR", "anchor": "m2:s0:i0", "members": ["m2:s0:i1","m2:s0:i2"]},
      {"label": "Meatballs with Crisp Red Potatoes and Brussels Sprouts", "anchor": "m2:s1:i1", "members": []},
      {"label": "Birria Bao Bun Taco", "anchor": "m2:s2:i0", "members": []},
      {"label": "Chicken Tortilla Soup", "anchor": "m2:s4:i0", "members": []}
    ]}
  },
  "frary": {
    "m0": {"groups": []},
    "m1": {"groups": [
      {"label": "OMELET BAR", "anchor": "m1:s1:i0", "members": []},
      {"label": "Tofu Scramble", "anchor": "m1:s0:i4", "members": []},
      {"label": "Angel Hair al Pomodoro", "anchor": "m1:s2:i3", "members": []},
      {"label": "Pozole", "anchor": "m1:s4:i1", "members": []},
      {"label": "Smoked Salmon Bar", "anchor": "m1:s5:i1", "members": []}
    ]},
    "m2": {"groups": [
      {"label": "Char Grilled Steak", "anchor": "m2:s0:i0", "members": []},
      {"label": "Marinated Herb Tofu", "anchor": "m2:s0:i3", "members": []},
      {"label": "Naan Street Tacos", "anchor": "m2:s1:i0", "members": ["m2:s1:i2"]},
      {"label": "PASTA BAR", "anchor": "m2:s2:i3", "members": ["m2:s2:i4","m2:s2:i5"]},
      {"label": "BURGER BAR", "anchor": "m2:s3:i0", "members": []}
    ]}
  },
  "oldenborg": null
}
```

Notes: `frank/m0`, `frary/m0` are empty `stations:[]` → `[]` (v5 correct). `oldenborg` unavailable → skip. Dropped: `Have A Nice Day`, `Self-serve`, `TODAY'S*`, `WHOLE EATS...`, allergen notices, desserts, sauces, plain rice/potatoes/vegetables, duplicate `frank/m2 s3 nacho` (covered by `s0`).

### 4. API/schema for grouped labels

```ts
type HighlightGroup = {
  label: string;          // short display, grounded
  anchorId: string;       // canonical m:s:i, resolves image/nutrition/link
  memberIds: string[];    // merged variants/components, same meal
  kind: "meal-bar" | "merged-variants";
};
type SelectionV2 = { mealId: string; groups: HighlightGroup[]; flatIds: string[]; };
```

- Validation: `1-5 groups/meal`; every ID exists in same meal; members share station except documented duplicates (nacho `s0/s3`); `label` must have token overlap with anchor/member names (e.g. `bulgogi` ⊂ members, `slider` ⊂ anchor) — reject invented cuisine; `flatIds = groups.map(anchor)` keeps `validateSelections` passing.
- Back-compat: keep `Selection {mealId,itemIds}`; add optional `groups`; old clients render `flatIds`; bump `PROMPT_VERSION` + include groups in `menuVersion`; fallback to flat when groups absent.

### 5. Two prompt strategies (distinct)

- **A. Program-first, two-pass:** Pass 1: list true programs (named bar + ≥3 components/sauces/bases in same station, or `BAR`/`build your own` in name + composed description). Pass 2: fill remaining slots with standalone composed entrees only. Explicit heading test: ALL-CAPS + no protein/description + calories absurd (`33285.5`, `256701`) or `Self-serve` → heading.
- **B. Cluster-and-suppress:** Enumerate all candidate mains, cluster by normalized name/description token overlap + station (e.g. Korean `banchan` cluster, slider cluster, pasta cluster, nacho duplicate cluster). Pick one anchor per cluster. Hard denylist: `sauce, rice, bread, fries, beans (unless stew), soup heading, dessert, Self-serve, Have A Nice Day`. Plant rule: only if cluster is named entree/stew, never promote side cluster.

### 6. Fair Groq A/B + evaluation

- Models: `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `moonshotai/kimi-k2-instruct` (or current Groq equivalents), same `highlightInput`, `reasoning_effort low`, temp 0. Blind, randomized order.
- Split: tune on `2026-09-30` only; holdout `2026-10-04`; never tune on holdout. Do not treat prior audit/reviewer votes as truth — use fresh double-blind food judges with guidelines.
- Metrics: program recall (Italian/slider/nacho/pasta/bagel/omelet found?), singleton precision (no sides/sauces/desserts/headings), duplicate rate (components + bar both picked), plant precision (named entree vs forced side), cap compliance, pairwise usefulness preference. Report per-hall, not pooled.

