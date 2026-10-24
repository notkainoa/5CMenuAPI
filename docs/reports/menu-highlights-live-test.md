# Live Groq test results

Tested October 2, 2026, using the local Worker, local KV and SQLite Durable Object storage, real school menus, and the user's Groq account. Production was not changed. The local server was stopped after testing; its state remains under ignored `.wrangler/groq-live`.

## Final run

Six available halls completed on their first attempt. Oldenborg had no available menu and caused no inference request. Each request contained the complete published hall-day menu. Frank's source published only Lunch for this date; the API did not invent missing services.

| Hall | Input tokens | Completion tokens | Total tokens |
| --- | ---: | ---: | ---: |
| hoch | 6,802 | 410 | 7,212 |
| malott | 4,025 | 546 | 4,571 |
| mcconnell | 6,406 | 337 | 6,743 |
| collins | 2,559 | 360 | 2,919 |
| frank | 632 | 278 | 910 |
| frary | 2,420 | 415 | 2,835 |
| **Total** | **22,844** | **2,351** | **25,195** |

Completion counts include reasoning tokens. These totals describe the final six-request run, not earlier diagnostics. Today's separate replay of the earlier Collins failure consumed another 3,021 tokens. Earlier September 30 runs also consumed quota; usage was not captured for every rejected or invalid response.

## Checks passed

- All 61 selected items belonged to their reported meal and matched the original school's item fields exactly.
- Combined and individual responses agreed.
- `highlights=false` omitted enrichment and preserved the base menu.
- CORS, HEAD, ETag/304, malformed query handling, and all six future dates behaved correctly.
- Future-date menus had `not_applicable` highlights.
- Repeated public reads and another same-hour scheduled trigger left the successful inference count at six, with zero failed inference calls in the final run.
- 114 automated tests, Workers runtime tests with actual alarm delivery, and the build passed.

The short response cache briefly continued showing `pending` after the final result was generated. A fresh dated URL exposed the ready result immediately, and the original URL updated after cache expiry. This matches the documented cache behavior.

## Bug found and fixed

The earlier live Collins run failed validation three times. A replay reproduced the cause: the model omitted Continental Breakfast because that service contained no dishes. The original strict schema enforced the shape of each array entry but could not require every meal ID to occur.

The inference response now uses an object whose meal-ID keys are all required by the strict JSON schema. Empty services must still be present. The server converts this map to the existing internal selection array; the public API shape is unchanged. Prompt version is now 3, so old selections are not mistaken for results from this contract. A regression test covers both required empty services and rejection of omitted meals.

Collins succeeded in the final live run with all four services, including an empty Continental Breakfast selection.

An earlier Hoch request returned HTTP 413. Replaying the same saved menu directly succeeded, and today's Worker request also succeeded. The original rejection's specific provider error was not captured, so its cause remains unconfirmed. No 413 occurred in the final run.

The README's local scheduler URL was also corrected to `/__scheduled`, matching the installed Wrangler version.

## Selection quality

Most selections were useful mains: pork belly bao, carnitas, fish, roasted chicken, tofu fajitas, vegetarian risotto, and plant-based entrees. Original dietary labels remained unchanged.

Some choices were weaker highlights: Collins included hash brown potatoes, Malott included roasted cauliflower, and Frary included plain quinoa. These passed structural validation because they are real dishes, but do not fully satisfy the preference for substantial mains. The integration works; prompt quality still merits tuning and evaluation across more dates before treating the picks as consistently curated recommendations.

No Instructor dependency was needed. Native strict output plus menu-specific validation detected the missing-meal problem, and required per-meal schema keys prevented it in the final run.
