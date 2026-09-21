import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { californiaDate, supportedDates } from '../src/dates';
import { SNAPSHOT_KEY } from '../src/storage';
import { HALLS, type Snapshot } from '../src/types';

const bundle = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, external: ['cloudflare:workers'] });
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-06',
  kvNamespaces: ['MENUS'],
  durableObjects: { COLLECTOR: { className: 'MenuCollector', useSQLite: true } },
}));
try {
  const empty = await runtime.dispatchFetch('https://menu.test/v1/menus');
  assert.equal(empty.status, 503);
  const now = new Date();
  const dates = supportedDates(now);
  const snapshot: Snapshot = { version: 1, refreshedAt: now.toISOString(), menus: {}, sources: { collins: { privateMarker: 'never expose this' } } };
  for (const date of dates) {
    snapshot.menus[date] = Object.fromEntries(HALLS.map(hall => [hall.id, {
      hall: hall.id, date, status: 'ok', sourceUrl: hall.sourceUrl,
      lastCheckedAt: now.toISOString(), lastSuccessfulCheckAt: now.toISOString(), menuUpdatedAt: now.toISOString(),
      meals: [{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Runtime test meal' }] }] }],
    }]));
  }
  const kv = await runtime.getKVNamespace('MENUS');
  await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  const combined = await runtime.dispatchFetch(`https://menu.test/v1/menus?date=${dates[0]}`);
  assert.equal(combined.status, 200);
  assert.equal(combined.headers.get('access-control-allow-origin'), '*');
  const combinedText = await combined.text();
  assert.ok(!combinedText.includes('privateMarker'));
  const json = JSON.parse(combinedText);
  assert.equal(json.halls.length, 7);
  const individual = await runtime.dispatchFetch(`https://menu.test/v1/menus/collins?date=${dates[0]}`);
  assert.deepEqual(await individual.json(), json.halls.find((hall: { hall: string }) => hall.hall === 'collins'));
  const unchanged = await runtime.dispatchFetch(`https://menu.test/v1/menus?date=${dates[0]}`, { headers: { 'If-None-Match': combined.headers.get('etag')! } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  const bad = await runtime.dispatchFetch('https://menu.test/v1/menus?date=2026-02-30');
  assert.equal(bad.status, 400);
  const head = await runtime.dispatchFetch('https://menu.test/v1/halls', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(await kv.get(SNAPSHOT_KEY), JSON.stringify(snapshot));
  console.log('Workers runtime smoke passed: real workerd, local KV, combined/individual JSON, errors, CORS, ETag, HEAD, no public writes.');
} finally {
  await runtime.dispose();
}

let sourceCalls = 0;
function nearbyServiceDates(now: Date): string[] {
  const start = new Date(`${californiaDate(now)}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  return Array.from({ length: 10 }, (_, offset) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}
const pomonaDates = nearbyServiceDates(new Date());
const collectorRuntime = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-06',
  kvNamespaces: ['MENUS'],
  durableObjects: { COLLECTOR: { className: 'MenuCollector', useSQLite: true } },
  outboundService: async request => {
    sourceCalls++;
    const url = new URL(request.url);
    if (url.hostname.endsWith('cafebonappetit.com')) {
      const date = url.pathname.split('/').filter(Boolean).at(-1);
      const collinsHours = url.hostname === 'collins-cmc.cafebonappetit.com'
        ? `<p class="current-status">Weekly Schedule</p><ul><li class="day-part dotted-leader-container"><span class="pull-left">Continental Breakfast</span><span class="pull-right">Mon-Fri, 9:00 am - 10:00 am</span></li></ul>`
        : '';
      return new RuntimeResponse(`<script>Bamco.menu_items={"1":{"label":"Tofu"}};</script><section class="site-panel--daypart" data-jump-nav-title="Lunch"><div class="site-panel__daypart-container" data-end-date="${date}"><h3 class="site-panel__daypart-station-title">Main</h3><div class="site-panel__daypart-item" data-id="1"></div></div></section>${collinsHours}`, { headers: { 'content-type': 'text/html' } });
    }
    if (url.hostname === 'api-prd.sodexomyway.net') {
      return new RuntimeResponse(JSON.stringify([{ name: 'Lunch', groups: [{ name: 'Main', items: [{ formalName: 'Rice' }] }] }]), { headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'api.pomona.edu') {
      const records = pomonaDates.flatMap(date => {
        const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
        return (weekend ? ['Breakfast', 'Dinner'] : ['Breakfast', 'Lunch', 'Dinner']).map(meal => ({
          '@servedate': date.replaceAll('-', ''), '@mealperiodname': meal,
          recipes: { recipe: { '@shortName': `${meal} dish`, '@category': 'Main' } },
        }));
      });
      return new RuntimeResponse(`/**/ menuData(${JSON.stringify({ EatecExchange: { menu: records } })});`, { headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'www.pomona.edu') {
      return new RuntimeResponse(`<div class="dining-hours-top editorial">
        <p><strong>Monday - Friday</strong></p><p><span>Breakfast:</span> 7:30 - 9 a.m.<br><span>Lunch:</span> 11 a.m. - 1 p.m.<br><span>Dinner:</span> 5 - 7 p.m.</p>
        <p><strong>Saturdays &amp; Sundays</strong></p><p><span>Continental Breakfast:</span> 7:30 - 9:30 a.m.<br><span>Brunch:</span> 10:30 a.m. - 1:30 p.m.<br><span>Dinner:</span> 5 - 7:30 p.m.</p>
      </div><div class="dining-hall-location">Test</div>`, { headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`Unexpected outbound request in runtime test: ${url}`);
  },
}));
try {
  const worker = await collectorRuntime.getWorker();
  const scheduled = await worker.scheduled({ cron: '0 * * * *' });
  assert.equal(scheduled.outcome, 'ok');
  const kv = await collectorRuntime.getKVNamespace('MENUS');
  const stored = await kv.get(SNAPSHOT_KEY);
  assert.ok(stored);
  const snapshot = JSON.parse(stored) as Snapshot;
  const dates = Object.keys(snapshot.menus).sort();
  assert.equal(dates.length, 7);
  // 3 Bon Appétit halls × 7 dates, 7 Sodexo dates, 3 Pomona feeds, and 2 Pomona hours pages.
  const expectedSourceCalls = 3 * dates.length + dates.length + 3 + 2;
  assert.equal(sourceCalls, expectedSourceCalls);
  for (const date of dates) {
    assert.equal(Object.keys(snapshot.menus[date]).length, 7);
    assert.ok(Object.values(snapshot.menus[date]).every(menu => menu?.status === 'ok'));
  }
  const weekend = dates.find(date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
  assert.ok(weekend);
  for (const hall of ['frank', 'frary'] as const) {
    assert.deepEqual(snapshot.menus[weekend][hall]?.meals?.map(meal => ({
      name: meal.name, startTime: meal.startTime, endTime: meal.endTime,
      dishes: meal.stations.flatMap(station => station.items).length,
    })), [
      { name: 'Continental Breakfast', startTime: '07:30', endTime: '09:30', dishes: 0 },
      { name: 'Brunch', startTime: '10:30', endTime: '13:30', dishes: 1 },
      { name: 'Dinner', startTime: '17:00', endTime: '19:30', dishes: 1 },
    ]);
  }
  const weekday = dates.find(date => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });
  assert.ok(weekday);
  assert.deepEqual(snapshot.menus[weekday].collins?.meals?.map(meal => ({
    name: meal.name, startTime: meal.startTime, endTime: meal.endTime,
    dishes: meal.stations.flatMap(station => station.items).length,
  })), [
    { name: 'Continental Breakfast', startTime: '09:00', endTime: '10:00', dishes: 0 },
    { name: 'Lunch', startTime: undefined, endTime: undefined, dishes: 1 },
  ]);
  // Same-hour duplicate triggers must not scrape or rewrite the snapshot.
  await Promise.all([worker.scheduled(), worker.scheduled()]);
  assert.equal(sourceCalls, expectedSourceCalls);
  assert.equal(await kv.get(SNAPSHOT_KEY), stored);
  const response = await collectorRuntime.dispatchFetch('https://menu.test/v1/menus');
  assert.equal(response.status, 200);
  const output = await response.json() as { halls: { status: string }[] };
  assert.equal(output.halls.length, 7);
  assert.ok(output.halls.every(hall => hall.status === 'ok'));
  assert.equal(sourceCalls, expectedSourceCalls);
  // Cached public reads do not need KV. Prove by temporarily removing the key.
  await kv.delete(SNAPSHOT_KEY);
  const cached = await collectorRuntime.dispatchFetch('https://menu.test/v1/menus');
  assert.equal(cached.status, 200);
  const cachedConditional = await collectorRuntime.dispatchFetch('https://menu.test/v1/menus', { headers: { 'If-None-Match': response.headers.get('etag')! } });
  assert.equal(cachedConditional.status, 304);
  assert.equal(sourceCalls, expectedSourceCalls);
  console.log('Collector runtime passed: cron → private SQLite Durable Object → mocked live-format providers → KV → public API; duplicate triggers coalesced; edge cache verified.');
} finally { await collectorRuntime.dispose(); }
