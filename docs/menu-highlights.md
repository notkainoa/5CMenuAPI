# Menu highlights

Each hall's menu for today can include up to five highlighted offerings per meal, chosen by `openai/gpt-oss-120b` on Groq. The API generates highlights in the background and saves them. Apps only read the saved results: they need no Groq key, no prompt, and no extra request.

This document is the integration contract. For how the selection was tuned and what is still imperfect, see [highlights-history.md](highlights-history.md).

## Requesting highlights

Highlights are included by default on both menu routes.

| Request | Result |
| --- | --- |
| `GET /v1/menus` | All seven halls, each with a `highlights` object |
| `GET /v1/menus/collins` | One hall with `highlights` |
| `GET /v1/menus?highlights=false` | The original response shape: no `highlights` field, and no extra storage read |
| `GET /v1/menus/collins?date=2026-10-24&highlights=true` | `date` and `highlights` can be combined |

`highlights` accepts only the literal values `true` and `false`, at most once. Anything else returns HTTP 400 with error code `invalid_highlights`. The base menu fields are identical with or without highlights.

## The `highlights` object

Every hall response has `highlights.status`, plus a `meals` array that is empty unless the status is `ready`.

| `status` | Meaning | What to show |
| --- | --- | --- |
| `ready` | Valid picks for exactly this menu content | The highlights |
| `pending` | Not generated yet for this menu version. Covers the first run of the day, a menu that just changed, and retries in progress. | The full menu; check again later |
| `unavailable` | Generation finished without a usable result. See `reason`. | The full menu |
| `disabled` | The server has no Groq key, or the operator turned highlights off | The full menu; hide any highlights UI |
| `not_applicable` | Closed or unavailable hall, a menu with no items, or any date other than today | The full menu |

`unavailable` responses can include a `reason`:

| `reason` | Meaning |
| --- | --- |
| `attempts_exhausted` | Three attempts for this menu version failed (rate limits, timeouts, malformed or invalid model output) |
| `daily_budget_exhausted` | The server's 21-call daily cap was reached before this version could finish its attempts |
| `input_too_large` | This hall-day menu is too large to send |
| `generation_failed` | Groq rejected the request in a way that retrying will not fix |

A saved record that fails revalidation, which should not happen, is also reported as `unavailable`, with no `reason`.

`hall.status` is independent of highlights. A `stale` menu still shows its last verified food, so it gets highlights for that exact content. Keep showing the existing staleness messaging.

### Ready example

```json
{
  "hall": "mcconnell",
  "date": "2026-10-04",
  "status": "ok",
  "meals": [ "...unchanged base menu..." ],
  "highlights": {
    "status": "ready",
    "provider": "groq",
    "model": "openai/gpt-oss-120b",
    "generatedAt": "2026-10-04T15:03:00.000Z",
    "menuVersion": "9c1f…",
    "meals": [
      {
        "mealIndex": 1,
        "name": "Dinner",
        "items": [
          { "id": "m1:s1:i1", "station": "global", "name": "beef bulgogi", "containsBeef": true, "allergens": ["soy"] },
          { "id": "m1:s0:i0", "station": "chef's table", "name": "Italian Pitzer Sunday" }
        ],
        "groups": [
          {
            "title": "Chicken or beef bulgogi",
            "kind": "variants",
            "sourceIds": ["m1:s1:i1", "m1:s1:i2"],
            "sourceItems": [
              { "id": "m1:s1:i1", "station": "global", "name": "beef bulgogi", "containsBeef": true, "allergens": ["soy"] },
              { "id": "m1:s1:i2", "station": "global", "name": "dak chicken bulgogi", "containsPoultry": true }
            ]
          },
          {
            "title": "Italian Pitzer Sunday",
            "kind": "single",
            "sourceIds": ["m1:s0:i0"],
            "sourceItems": [{ "id": "m1:s0:i0", "station": "chef's table", "name": "Italian Pitzer Sunday" }]
          }
        ]
      }
    ]
  }
}
```

Field reference for a `ready` meal:

- `mealIndex` is the index into the hall's base `meals` array. `name` repeats that meal's name. There is one entry for every base meal, in the same order. A meal with no worthwhile mains has `items: []` and `groups: []`.
- `groups` holds the offerings, between zero and five, in the model's ranked order. Five is a cap, not a target.
  - `title` is plain text of at most 64 characters. For `kind: "single"` it is the source item's name with markup stripped, shortened at a word boundary only if it is too long. For `kind: "variants"` it is a short combined label such as "Chicken or beef bulgogi" (see the rules below).
  - `kind` is `"single"` (one menu row, including a named meal program such as "Grill slider bar") or `"variants"` (two to four rows that are the same dish with different proteins or options).
  - `sourceIds` and `sourceItems` list the underlying menu rows. Each `sourceItems` entry is the original school-provided item, unchanged, plus `id` and `station`.
- `items` has one entry per group: the first source of each group, in the same order. It is a flat convenience list for clients that don't render groups.

Groups have **no aggregate dietary, allergen or nutrition fields**. Each source item keeps its own `vegan`, `allergens`, `calories` and so on. A "Chicken or tofu curry" group does not claim to be vegan, even if one of its sources is.

### IDs

`id` values such as `m1:s0:i2` mean meal 1, station 0, item 2. They are **positions within one menu version, not permanent dish IDs**. If the school edits the menu, the same dish can get a different ID, and the old highlights are withdrawn (status becomes `pending`) until new ones are generated. Use IDs only to cross-reference the same response, never to store favorites or track a dish across days. `menuVersion` identifies the exact content the picks were made for.

## What an app should render

- Show `groups[].title` as the highlight label, in the order given.
- For `variants`, show the choices from `sourceItems`, such as "beef bulgogi · dak chicken bulgogi". Take dietary badges and allergens from each source item, never from the group.
- Link a highlight to its row in the full menu with `mealIndex` and the source `id`. When displaying a source in the menu context, prefer `sourceItems[].station`.
- Show nothing extra for statuses other than `ready`. Always keep the full menu available, since highlights are a shortcut, not a filter.
- Do not label highlights as "recommended by chefs" or "healthy". They are model-picked main dishes from the published menu.

```js
const url = new URL('/v1/menus', apiBase);
if (!settings.showHighlights) url.searchParams.set('highlights', 'false');
const data = await (await fetch(url)).json();
if (!Array.isArray(data.halls)) throw new Error(data.error?.message ?? 'Menu request failed');
for (const hall of data.halls) {
  const featured = hall.highlights?.status === 'ready' ? hall.highlights.meals : [];
  renderHall(hall, featured); // Keep handling hall.status, including stale and unavailable.
}
```

## Validation guarantees

The server validates every model response, and re-validates every saved record each time it is served. Anything that fails is never shown as `ready`.

- Every base meal appears exactly once. Empty services have no groups.
- Each source belongs to that meal. IDs from another meal and invented IDs are rejected.
- No source appears in more than one group. A meal has at most five groups, and a group has one to four sources.
- Exact repeated rows collapse into one offering. Two singles collapse when their full source names match after normalizing case, punctuation and accents.
- Single titles always come from the menu. The model cannot rename a dish.
- Combined titles:
  - must be plain text (no markup, URLs or control characters);
  - must use only letters, digits, spaces and `' & , / ( ) -`;
  - must take every word from every source name, apart from connectors such as "or" and "with" and the words that tell variants apart (proteins such as chicken, beef or tofu, plus vegetable, cheese, egg, and cooking styles such as grilled or fried). Those may come from just one source. So "Pork or tofu banh mi sandwich" passes. "Peanut-free chicken or beef satay", "Keto chicken or beef bowl" and "Vegan or chicken pho" are rejected when only one source says so;
  - must include a dish word shared by every source, so "Beef bulgogi or orange tofu" is rejected.

If a combined title breaks these rules, the group is not dropped and the response is not rejected. Each of its sources is shown as its own `single`, titled from its menu name, still within the five-offering cap. Structural problems (wrong meal, unknown ID, duplicate ownership, malformed JSON) reject the whole response, which is then retried.

These rules are conservative lexical checks. They prevent invented dishes and claims. They do not prove that a pick is a good one.

## Freshness and caching

- Highlights cover **today only** (America/Los_Angeles). Future dates are always `not_applicable`.
- The hourly collector refreshes menus, then schedules generation for halls whose menu content changed. The first picks of the day usually arrive within about ten minutes of the first hourly collection. Halls are generated one at a time, at least 65 seconds apart.
- A content hash covers the hall, date, every meal, station and item field, the model, the prompt version, and the prompt text. Any change to food, labels or ordering hides old picks immediately. Freshness timestamps and meal hours do not count as changes.
- Responses are edge-cached for up to 60 seconds, so a newly ready result can take that long to appear.

## Operating it

**Setup.** Store the Groq key as a Worker secret: `npx wrangler secret put GROQ_API_KEY`. Never put it in an app or in committed config. For local development, put `GROQ_API_KEY=...` in the gitignored `.dev.vars`. A configured key enables highlights. Setting the variable `HIGHLIGHTS_ENABLED` to `"false"` stops both generation and serving: every hall then reports `disabled`. No public request can start or force generation.

**Local run.**

```sh
npm run dev                                  # wrangler dev --test-scheduled
curl 'http://localhost:8787/__scheduled'     # collect menus and schedule generation
curl 'http://localhost:8787/v1/menus/collins'
```

**How generation runs.** The existing `MenuCollector` Durable Object runs generation from its alarm, after the hourly snapshot is saved. No new Cloudflare resource is needed.

- Each alarm sends at most one Groq request, then schedules the next.
- Attempts are recorded in Durable Object storage before the request goes out.
- Results are written to the `highlights:v1` KV key.
- A failed KV write is retried without calling Groq again.
- A crash after Groq accepts a request but before the result is saved can cause one repeat call, so this is bounded, not exactly-once.

**Budgets.**

| Situation | Groq calls |
| --- | --- |
| Seven open halls, first run of the day | 7 (one per hall-day, all meals in one request) |
| Hourly checks with unchanged food | 0 |
| Any number of public API requests | 0 |
| One hall's menu changes | Normally 1 |
| Menu reverts to an already generated version the same day | 0 |
| Retryable failure (429, 5xx, timeout, malformed or invalid output, `json_validate_failed`) | Up to 3 in total for that menu version |
| Global ceiling | 21 reserved attempts per California day |

`Retry-After` pauses all halls, because Groq quotas are per account. The pause carries across midnight. Other 4xx errors stop that version immediately; 413 reports `input_too_large`. Requests use low reasoning effort, a 45-second timeout, 2,000 completion tokens (including reasoning), and a 24,000-byte input guard. That guard is not a token count. A typical day uses roughly 25–35k tokens across all halls. Set spending and rate limits in the Groq console as well; the call ceiling does not limit tokens.

**Logs.** `highlights_generated` records hall, date and token usage. `highlights_failed` records hall, attempt, whether a retry is planned, and a short reason. Logs never include the key, provider error bodies, or reasoning text.

**Changing the prompt.** The prompt, schema and validation live in `src/highlight-selection.ts`. Bump `PROMPT_VERSION` in `src/highlights.ts` whenever any of them, or the saved format, changes. The bump invalidates all saved picks. To review a day's picks against the live menus with the shipped pipeline, run `npm run highlights:audit`. It uses `.dev.vars` and costs up to one Groq call per hall.

References: [GPT-OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b), [structured outputs](https://console.groq.com/docs/structured-outputs), [rate limits](https://console.groq.com/docs/rate-limits), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
