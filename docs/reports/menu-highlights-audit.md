# Menu highlights audit

This report describes the pre-live audit. See [the later live test results](menu-highlights-live-test.md) for the empty-service schema fix and measured token usage.

Audited the uncommitted highlights implementation against `HEAD` and the conversation specification. Live payload measurements use the September 29, 2026 California menu. No Groq inference or deployment was performed during this audit.

## Behavior verified

The hourly collector retrieves menus for today and six following dates. That collection is independent of Groq. Highlight generation handles today only, using one request containing all meals for one hall. Public API requests only read stored results.

With seven available, unchanged hall-days, generation makes seven requests total. Hourly checks do not repeat inference. Closed, unavailable, stale, and future menus cause no new inference. Changed menu contents can trigger additional requests. A successful prior version is reused if the source reverts to it within the day.

There are at most three reserved outbound attempts per distinct hall-day version and 21 across all halls per California day. The counter is persisted before network I/O, so crashes can consume a reservation without actually sending a request. A crash after Groq accepts a request but before persistence can also cause a repeat request. This is bounded processing, not an exactly-once guarantee.

Calls are normally spaced by at least 65 seconds. Retry-After pauses the shared scheduler from the time the error arrives. Cooldowns survive midnight; daily accounting and historical version records reset for the new service date.

## Standards and correctness findings

| Finding | Resolution |
| --- | --- |
| Retry-After was measured from request start, shortening backoff after a slow response | Fixed: use error receipt time, with an injectable elapsed clock for tests |
| An outstanding provider cooldown could be lost at the daily reset | Fixed: carry the cooldown across California midnight |
| Crashes after the last reservation could leave a version pending indefinitely | Fixed: publish unavailable with `attempts_exhausted` |
| A source reverting A → B → A repeated generation for A | Fixed: retain attempted versions and their results for the service day |
| Runtime test directly invoked the alarm method and did not prove actual delivery | Fixed: test calls the real refresh method and waits for an actual scheduled alarm to publish |

The review found no inherent overlapping-inference race: production inference is confined to the object's alarm handler. Cloudflare documents that only one alarm handler runs at a time per object. [Alarm semantics](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Specification findings

| Finding | Resolution |
| --- | --- |
| After reaching the daily cap, changed menus remained pending even though generation could not run | Fixed: reconcile current versions and publish unavailable with `daily_budget_exhausted` |
| Oversized inputs consumed request budget without contacting Groq | Fixed: validate input size before reserving an outbound attempt |
| The original 24,000-byte guard excluded two of today's real hall menus | Fixed for the observed inputs: group station names once and omit nutrition fields from the prompt |

Default inclusion, `?highlights=false`, strict JSON output, low reasoning, original item data, and cross-meal membership validation match the agreed specification. Future dates remain menu-only. Automatic splitting of oversized menus is still deferred, as previously disclosed.

## Live input sizes

These are JSON menu payload bytes, excluding system instructions and output schema. They are not token counts.

| Hall | Before compaction | After compaction |
| --- | ---: | ---: |
| Hoch | 31,094 | 21,932 |
| Malott | 16,574 | 12,737 |
| McConnell | 28,815 | 21,596 |
| Collins | 9,001 | 7,244 |
| Frank | 17,831 | 6,309 |
| Frary | 20,298 | 7,108 |

Oldenborg had no available menu. All six available hall-day inputs fit the local byte guard after compaction. The model still receives item names, descriptions, dietary selection flags, featured status, and meal/station groupings. Public results retain all original item fields.

The live API rejected `?highlights=false` as an unknown parameter during the audit, confirming it still serves the earlier API contract. The changes remain local.

## Verification and remaining limits

Tests simulate 24 hourly collections containing all seven dates and all seven halls. The result is exactly seven Groq calls, all for today. Additional cases cover version changes, A/B/A reuse, daily budget exhaustion and reset, unsent oversized requests, delayed 429 responses across midnight, persistence failures, and crashes after the final reservation.

The Workers runtime test uses real local SQLite Durable Object storage, actual alarm scheduling/delivery, local KV, mocked Groq, and public response/cache checks. It does not prove production deployment behavior or every platform retry scenario.

Selection quality and actual token usage remain unmeasured. Fitting 24,000 bytes does not guarantee fitting Groq's token allowance. Groq lists an 8,000-token-per-minute and 200,000-token-per-day free allowance for this model, but organization-specific limits can differ and are shared with other usage. The 21-request application ceiling is not a token or spending limit. [Groq rate limits](https://console.groq.com/docs/rate-limits)

Before enabling this publicly, evaluate real hall-day selections and observed token usage with the configured account. Larger future inputs may still exceed the byte guard; those return `input_too_large` until meal splitting is implemented. An API consumer can always render the complete menu when highlights are unavailable.
