# 5C Menu API

A public JSON API for the Claremont Colleges' dining menus. This repository contains the API and its hourly collector, not an app. The original PHP `api/` files remain as historical reference and are not deployed.

Live API: https://five-c-menu-api.kainoanewton.workers.dev/v1/menus

## How it works

Every hour, a Cloudflare Cron Trigger calls one private Durable Object. That collector checks the schools' menu sources, processes changed data, and saves one combined snapshot to Cloudflare KV. Public requests read the saved snapshot, with a short edge cache to reduce repeat reads.

The Durable Object gives collection a 30-second CPU allowance instead of the regular free Worker's 10 ms allowance. It uses SQLite storage for a small record of the last completed hour, preventing duplicate hourly runs. Apps never call the collector. Everything needed for operation runs on Cloudflare; GitHub Actions is used only for optional code checks.

The date window is **today through six days ahead in America/Los_Angeles**, seven calendar days total. Later dates in that window are collected before midnight when the schools have published them. Yesterday is never substituted for today.

## API

No API key is required. All routes support `GET`, `HEAD`, and browser CORS. `/` returns endpoint links.

| Route | Result |
| --- | --- |
| `/v1/halls` | Dining hall IDs, names, colleges, and source links |
| `/v1/menus` | Today's menus for all seven halls |
| `/v1/menus/collins` | Today's Collins menu |
| `/v1/menus?date=2026-09-07` | All halls on a supported date |
| `/v1/menus/collins?date=2026-09-07` | One hall on a supported date |

Canonical IDs: `hoch`, `malott`, `mcconnell`, `collins`, `frank`, `frary`, `oldenborg`. The old spelling `mcconnel` is an alias for `mcconnell`.

The only menu query parameter is `date`, supplied at most once as `YYYY-MM-DD`. Dates outside today through six days ahead return HTTP 400, even if an upstream feed contains more dates. Examples with fixed dates must be adjusted when used.

Individual response example, with illustrative food:

```json
{
  "hall": "collins",
  "date": "2026-09-06",
  "status": "ok",
  "sourceUrl": "https://collins-cmc.cafebonappetit.com/",
  "lastCheckedAt": "2026-09-06T19:00:00.000Z",
  "lastSuccessfulCheckAt": "2026-09-06T19:00:00.000Z",
  "menuUpdatedAt": "2026-09-06T16:00:00.000Z",
  "meals": [{
    "name": "Lunch",
    "period": "lunch",
    "startTime": "11:00",
    "endTime": "13:00",
    "stations": [{ "name": "Main", "items": [{ "name": "Vegetable curry", "vegan": true, "featured": true }] }]
  }]
}
```

The combined endpoint wraps those same objects in `{ "date": "2026-09-06", "timezone": "America/Los_Angeles", "halls": [...] }`. Actual combined responses always contain seven entries. Internal fingerprints, validators, and parsed source caches are never included in public responses.

### Availability and timestamps

| Status | Meaning | `meals` |
| --- | --- | --- |
| `ok` | Verified menu for the requested date | Array |
| `closed` | Source explicitly reports closure for that date | Empty array |
| `stale` | Last successful data for this same date; checking failed or is overdue | Saved array |
| `unavailable` | No verified data for this date | `null` |

Failures include `error: { "code": "...", "message": "..." }`. Menu codes are `SOURCE_FETCH_FAILED`, `MENU_NOT_PUBLISHED`, `MENU_UNAVAILABLE`, and `CHECK_OVERDUE`. If every hall is unavailable, the combined endpoint returns HTTP 503 but keeps its normal shape. A partially available combined response returns 200. An unavailable individual hall returns 503.

- `date` is when the meal is served, not when the feed was downloaded.
- `lastCheckedAt` is the latest attempted hourly check.
- `lastSuccessfulCheckAt` is when that exact date's data was last verified. An unchanged response can advance it.
- `menuUpdatedAt` is when this API last observed the normalized menu change. It is not a timestamp supplied by the school.

Timestamps use UTC ISO 8601 strings or `null` when unknown. Data becomes stale after 90 minutes without a successful check, with up to 60 seconds of additional response caching. A stale empty array can represent a previously verified closure. No successful menu from another service date is used as fallback.

Optional item fields are `description`, `vegan`, `vegetarian`, `glutenFree`, `halal`, `kosher`, `mindful`, `plantBased`, `containsPork`, `containsBeef`, `containsPoultry`, `featured`, `calories`, and `allergens`. Missing information stays absent. Schools that sent an explicit no publish `false`; a hall that never mentioned a label omits the key. `allergens` is a sorted lowercase list of present allergens (`egg`, `fish`, `gluten`, `milk`, `peanut`, `sesame`, `shellfish`, `soy`, `treenut`, `wheat`). It is omitted when the school listed none as present. Tree-nut varieties collapse to `treenut`. Bon Appétit items omit `allergens` because those pages have no structured allergen array. `featured` is `true` when a school marked the dish as today's special, `false` when it marked the dish as always-on, and omitted when the school did not say. Only Collins, Malott, and McConnell currently send that signal. Hoch and Pomona items omit the key; clients must not treat a missing `featured` field as non-featured. Meal `name` is the school's display label. `period` is an optional normalized token: `breakfast`, `brunch`, `lunch`, `dinner`, or `late_night`. It is omitted when the name matches none of those. `DINNER` and `Dinner` both become `period: "dinner"`; `Continental Breakfast` becomes `breakfast`. Meal `startTime` and `endTime`, when supplied, are local `HH:mm` times in California. Hoch and Oldenborg currently omit times because their menu feeds do not provide verified meal hours. Menus and dietary labels are reported as supplied by the schools.

Frank and Frary combine Pomona's Eatec food records with the active hours block on each hall's official page. Pomona uses `Breakfast` as the Eatec bucket for weekend brunch, so the API publishes that food under the official `Brunch` service name and time. A listed service such as continental breakfast can have an empty `stations` array when Pomona publishes hours but no separate dish list. The collector never copies another service's dishes into that empty period. If the hours page cannot be read, the food records remain available with their original Eatec labels and without inferred times.

Collins dated special hours override matching meal times. When those hours list brunch, the collector omits regular breakfast, continental breakfast, and lunch sections unless the special schedule also explicitly lists them. A dinner-only exception does not remove other meals. On regular weekdays, the collector also publishes Collins's schedule-only continental breakfast period with an empty `stations` array. It does not copy breakfast dishes into that period. This handles Collins's current holiday and weekly schedule markup; it is not a general operating-hours integration for every hall.

HTTP input/storage errors use `{ "error": { "code": "...", "message": "..." } }`. Codes include `invalid_date`, `unsupported_date`, `unknown_query_parameter`, `hall_not_found`, `not_found`, `method_not_allowed`, and `storage_unavailable`. Input errors return 400, unknown resources 404, unsupported methods 405, and storage failures 503.

Successful responses have an ETag and cache for at most 60 seconds, shortened before California midnight. Errors are not cached. `If-None-Match` can return 304 with no body. Cached calls still count as Worker requests, but can avoid KV reads and repeated JSON processing.

### Calling it from an app

```js
const response = await fetch(`${apiBase}/v1/menus`);
const data = await response.json();
if (Array.isArray(data.halls)) {
  // Inspect each hall.status, even when response.status is 503.
  // Display stale data with its lastSuccessfulCheckAt timestamp.
  // Display unavailable halls without food from a different date.
} else {
  throw new Error(data.error?.message ?? 'Menu request failed');
}
```

Use the combined endpoint for a screen showing several halls. Keep the downloaded response while navigating within your app. Refresh approximately once a minute at most while active, not on every render. The API checks upstream menus hourly.

## Local development

Requires Node.js 24 and npm. No PHP installation or Cloudflare login is needed for local tests.

```sh
npm ci
npm run check
npm run test:runtime
npm run build
npm run dev
```

The local API starts without menus. Trigger a local scheduled run to populate it:

```sh
curl 'http://localhost:8787/cdn-cgi/handler/scheduled?cron=0%20*%20*%20*%20*'
curl 'http://localhost:8787/v1/menus'
```

The scheduled development hook is supplied by Wrangler with `--test-scheduled`. It is not a public refresh route in the deployed API. The collector skips a second completed run within the same UTC hour.

`npm run sources` checks live sites and prints dates, item counts, requests, and response sizes. It exits nonzero if any requested hall/date is unavailable. This is separate from deterministic tests: a school may not publish a menu. `npm run benchmark` downloads inputs once, replays them from memory, and measures local processing. Its numbers are not Cloudflare billing measurements.

## Deploy to Cloudflare Free

The current deployment uses the KV namespace configured in `wrangler.jsonc`. To update it, authenticate to the same Cloudflare account and run `npm run deploy`. For a separate account:

1. Run `npx wrangler login` for your Cloudflare account.
2. Run `npx wrangler kv namespace create MENUS`.
3. Replace the existing KV namespace `id` in `wrangler.jsonc` with the resulting namespace ID.
4. Run `npm run deploy`.
5. Allow the hourly Cron Trigger to run, then inspect `/v1/menus` and the Worker logs. Cron configuration can take time to propagate. Until collection succeeds, the API reports unavailable.

The configuration creates a **SQLite-backed** `MenuCollector` Durable Object, as required by the free tier, and one hourly Cron Trigger. Its binding is private. The Worker only dispatches collection and receives a tiny summary; parsing runs inside the Durable Object. Do not add another writer for the same snapshot.

No external scheduler, public refresh endpoint, Cloudflare API token in application code, or custom domain is required. Use the deployed `workers.dev` URL. The public Sodexo browser key in its adapter comes from HMC's own public client; it is not a Cloudflare account credential.

At 20,000 API calls/day, the estimated budget is:

| Resource | Expected use | Free daily allowance |
| --- | --- | --- |
| Worker requests | About 20,000 plus 24 scheduled invocations | 100,000 |
| KV reads | At most one per uncached menu request, plus 24 refresh reads | 100,000 |
| KV writes | Normally 24 | 1,000 |
| Durable Object requests | Normally 24 | 100,000 |
| Durable Object duration | About 62 GB-seconds if each refresh lasts 20 seconds | 13,000 GB-seconds |
| Durable Object storage writes | Normally 24 small completion records | 100,000 rows |

These allowances are shared with other projects on the account. The duration estimate is `24 × 20 seconds × 0.128 GB`; actual duration varies with school response times. Network waiting counts toward Durable Object duration, though it is excluded from CPU time. Unchanged checks still save freshness metadata. Old public dates are removed when the snapshot is replaced. Deletion does not refund writes.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Maintenance and evidence

Provider modules have independent tests and share the contract in `src/types.ts`. To repair a provider, inspect its new public format, update the adapter and fixture tests, then run the full checks. No client update should be needed if the public JSON contract remains unchanged.

See [overhaul-plan.md](overhaul-plan.md) for requirements, task dependencies, and the subagent strategy. See [docs/verification.md](docs/verification.md) for current evidence and deployment limits. The PHP source and Apache license are retained.

## Historical PHP checker

The legacy PHP parsers, Docker Compose file, and browser checker from GitHub `main` remain in the tree as reference. They are not deployed to Cloudflare. The PHP entry point is the `run` function in `api/menuParser.php`. The local PHP checker returns the selected day plus the next six calendar days, for up to seven days total. Pass `days=1` through `days=7` to request a shorter window. It only returns dates the upstream dining provider has published.

Run the PHP API and browser checker together with Docker:

```sh
docker compose up --build
```

Open http://localhost:8080. The page requests every supported dining hall from the local PHP API, renders each meal and station, and marks empty or invalid responses as failures.

If port 8080 is already in use, choose another host port:

```sh
PORT=8055 docker compose up --build
```

Run the automated API check in another terminal:

```sh
node tests/ApiSmokeTest.mjs http://127.0.0.1:8080
```

The focused Bon Appétit parser checks run without a local PHP installation:

```sh
docker run --rm -v "$PWD:/app" -w /app php:8.4-cli-alpine php tests/MenuWindowTest.php
docker run --rm -v "$PWD:/app" -w /app php:8.4-cli-alpine php tests/BonAppetitWebParserTest.php
docker run --rm -v "$PWD:/app" -w /app php:8.4-cli-alpine php tests/LiveBonAppetitCheck.php
```
