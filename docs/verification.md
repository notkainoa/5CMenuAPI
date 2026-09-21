# Verification record

Local checks ran on 2026-09-06; production verification ran on 2026-09-07. This records implementation evidence, not a promise that third-party menus never change.

## Deterministic checks

Results: strict TypeScript checking passed; all 41 deterministic tests passed; both workerd integration scenarios passed; deployment dry-run passed with a 51.25 KiB bundle, 13.18 KiB gzipped.

Run `npm run check` for strict TypeScript checking and fixture/state/HTTP tests. Run `npm run test:runtime` for two integration scenarios in actual local workerd with KV and SQLite Durable Objects:

1. Empty storage, known snapshot, combined/individual agreement, HEAD, JSON errors, CORS, ETag/304, and no public KV writes.
2. Real scheduled entry point dispatching to the private collector, all three provider formats through controlled outbound responses, one completed snapshot, duplicate same-hour triggers, public API reads, and a cache hit after the underlying local KV key is removed.

Provider tests cover preserving rendered items, dates, validated closure, missing publication, malformed responses, 304 and content fingerprints, optional dietary/nutrition fields, and per-date source failures. State tests cover unchanged timestamps, partial outages, same-date fallback, rollover and old-date pruning, missed scheduler staleness, explicit closure, recovery, bounded concurrency, and KV failures. A failed KV read does not overwrite the previous snapshot.

Response-body limits are enforced even if Content-Length is absent. Requests have cancellation signals and 15-second deadlines covering download. Diagnostics and tests never need Cloudflare credentials.

`npm run build` produces a deployment bundle with KV and the private Durable Object binding. The legacy PHP directory is not bundled. CI runs type checks, deterministic tests, runtime tests, and bundle verification. Live network checks are separate so unpublished school menus cannot masquerade as code-test failures.

## Live source evidence

`npm run sources` at 2026-09-06T22:38:21Z requested September 6 and 7 in California. Counts below are published menu-item occurrences across meals and stations, not unique recipes. They can change on a later check.

| Hall | Sept 6 items | Sept 7 items | Result |
| --- | ---: | ---: | --- |
| Hoch | 104 | 178 | Both dates available |
| Malott | 246 | 543 | Both dates available |
| McConnell | 383 | 566 | Both dates available |
| Collins | 441 | 828 | Both dates available |
| Frank | 78 | 70 | Both dates available |
| Frary | 67 | 55 | Both dates available |
| Oldenborg | 0 | 0 | Neither date published |

The live diagnostic intentionally exits 1 when any requested date is unavailable. Oldenborg's response is a successful HTTP request containing old dates, not evidence of a current closure. The API returns `unavailable` with `MENU_NOT_PUBLISHED`.

The complete live pipeline was also tested with `npm run dev` and Wrangler's local scheduled hook. The actual local Durable Object fetched school sources, saved local KV, and `/v1/menus` returned HTTP 200 with the six available halls and the explicit Oldenborg failure. This supplements the controlled runtime test; it still does not measure remote Cloudflare CPU or provision the user's account.

### Sources and formats

- Bon Appetit legacy `legacy.cafebonappetit.com/api/2/menus` returned HTTP 403 with an authentication-required message. Current dated pages are `https://collins-cmc.cafebonappetit.com/cafe/collins/YYYY-MM-DD/`, `https://scripps.cafebonappetit.com/cafe/malott-dining-commons/YYYY-MM-DD/`, and `https://pitzer.cafebonappetit.com/cafe/mcconnell-bistro/YYYY-MM-DD/`. The adapter reads strict JSON from `Bamco.menu_items`, matches dated meal containers, and links rendered item IDs to that JSON. It does not execute page scripts. Collins also publishes a weekly schedule and dated special hours in the same HTML. The adapter uses those blocks only for Collins, skips weekly schedule synthesis on matching special dates, and leaves a schedule-only Continental Breakfast empty. Last-Modified is used only with previously validated data for the exact URL/date; unchanged bodies reuse parsed results.
- Hoch uses `https://api-prd.sodexomyway.net/v0.2/data/menu/13147001/15258?date=YYYY-MM-DD`. Its API-Key is shipped in HMC's public browser client. Responses contain meal arrays, groups, and items. No validators were observed, so the adapter compares response fingerprints. The requested date in this date-specific endpoint supplies the service date; an empty array is unpublished, not closed.
- Pomona food feeds are `https://api.pomona.edu/eatec/Frank.json`, `Frary.json`, and `Oldenborg.json`. They currently return `menuData(...)` JSONP with explicit service dates, meal records, recipes, nutrient-column labels, and dietary answers. Frank and Frary service hours come from `https://www.pomona.edu/administration/dining/menus/frank` and `https://www.pomona.edu/administration/dining/menus/frary`. The collector fetches each food feed and hours page in parallel. It maps Pomona's weekend `Breakfast` food bucket to the published `Brunch` service and leaves schedule-only periods empty. If the hours page fails or cannot be parsed, the collector keeps the raw Eatec meal names and omits inferred times. Oldenborg has no separate hours integration. ETag/Last-Modified support conditional food-feed requests. The food parser also accepts plain JSON. Nutrition follows the named CAL column; unknown dietary answers remain absent. Closure records cannot erase other published meals on the same day.

Public feed dates, upstream caching, and publication quality remain controlled by the schools. Meal times come from a dated menu page, a verified schedule block on that page, or the active Frank and Frary hours pages listed above. If none is available, the API omits the times instead of inventing them.

## Local performance evidence

`npm run benchmark` at 2026-09-06T22:39:16Z captured 11 upstream requests and a roughly 548 KB snapshot. With responses replayed from memory:

| Operation | Median elapsed time |
| --- | ---: |
| Full parse and collection | 58.1 ms |
| Collection with unchanged downloaded bodies | 33.1 ms |
| Combined HTTP response before edge caching | 1.37 ms |

These measurements explain the private Durable Object collector. They are not Cloudflare billed CPU timings. The ordinary scheduled Worker only calls it and receives a small summary. The collector has a 30-second default CPU allowance, while free ordinary Workers have 10 ms. Approximate daily usage and official quota links are in README.md.

## Deployment status

### Dining-hours reconciliation

Checks on 2026-09-21 passed all 97 deterministic tests, both real-workerd runtime scenarios, and the Wrangler deployment dry run. The scheduled-collector runtime fixture now proves that Frank and Frary publish an empty Continental Breakfast followed by Brunch with the original Eatec breakfast dishes. It also proves that Collins publishes its empty weekly Continental Breakfast even when the dated page contains only a Lunch menu section.

Live parsing on September 21 checked September 21, 22, and 27. Frank and Frary returned their active published service names and times, including weekend Continental Breakfast, Brunch, and Dinner. Collins returned weekday Breakfast, empty Continental Breakfast, Lunch, and Dinner, then its dated Sunday Brunch and Dinner schedule. Malott, McConnell, and Oldenborg matched `main` on the sampled dates. The full live diagnostic still exited 1 because Oldenborg had no current menus and one unchanged Hoch request timed out. Neither result came from a provider changed by this work.

### Seven-day public window

The collector now stores today through six days ahead in America/Los_Angeles. Public `?date=` values outside that window still return HTTP 400. Deterministic tests cover the seven-day range, including spring-forward and fall-back calendar arithmetic. All 44 deterministic tests and both workerd scenarios passed. Dry-run bundle is 53.25 KiB, 13.90 KiB gzipped.

`npm run sources` at 2026-09-12T22:19:36Z requested September 12 through 18. Six halls returned verified menus for every date in that window (Frank closed on the 12th, one breakfast item on the 18th). Oldenborg remains unpublished. Hoch's Sodexo feed continues through September 25. Bon Appétit dated pages for Collins, Malott, and McConnell still contain menus on sampled dates through November 1. Production still served only today and tomorrow until the next deployment and hourly collection after this change.

### September 7 Collins correction

Deployed version `a3af9c61-d643-4cbe-b6a0-81d4a1073bb4` reconciles Collins dated special hours. Live-source parsing produces September 7 Brunch 10:30-12:30 and Dinner 16:30-18:30; September 8 retains its four regular periods. The previous five-period September 7 response copied source menu sections without reconciling the holiday schedule.

All 43 deterministic tests and both workerd scenarios pass. Regression coverage includes other dates/halls, dinner-only exceptions, explicitly retained breakfast, missing special-period menus, and invalidating old parsed caches. Public KV changes on the next hourly collection after deployment; deployment alone does not rewrite the snapshot. The bundle is 53.10 KiB, 13.84 KiB gzipped.

### Initial deployment

Deployed at https://five-c-menu-api.kainoanewton.workers.dev. Initially verified version: `16c4bbf8-aafc-4299-8a37-7fcb229e27f8`. Wrangler confirmed the production KV binding, SQLite-backed `MenuCollector` Durable Object, and hourly `0 * * * *` Cron Trigger. That bundle was 51.25 KiB, 13.18 KiB gzipped.

Production requests at approximately 2026-09-07T16:53Z confirmed a saved snapshot checked by the hourly collector at `2026-09-07T16:01:25.611Z`. No manual snapshot upload was needed. Both September 7 and September 8 returned HTTP 200 with six `ok` halls and Oldenborg `unavailable` with `MENU_NOT_PUBLISHED`.

Live assertions passed for all fourteen individual hall/date responses matching their combined response, CORS, ETag/304, empty HEAD bodies, invalid-date 400, unknown-hall 404, and the `mcconnel` alias. The development-only scheduled hook returned 404 in production. The root and hall-directory routes returned 200.

This verifies production collection, persisted menu reads, and the public response contract. Cloudflare billed CPU, duration, and account-wide quota consumption have not been measured in this record. Continued upstream availability and future cron delivery are not guaranteed by a successful deployment.
