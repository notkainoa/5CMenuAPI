import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSodexo } from '../src/providers/sodexo';
import type { Fetcher } from '../src/types';

// Regression tests for the Hoch outage: Sodexo's old menu id answered 200 [] for every date.

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const htmlResponse = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });
const sodexoDay = [{ name: 'LUNCH', groups: [{ name: 'Grill', items: [{ formalName: 'Tacos' }] }] }];
const locationPage = (menuId: string) => `<!doctype html><html><body><script>self.__next_f.push([1,"{\\"metadata\\":{}}"])</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"menus":[{"sections":[],"metadata":{"locationId":"13147001","menuId":"${menuId}"}}]}}</script></body></html>`;

function sodexoFetcher(page: () => Response | Promise<Response>, liveMenuId: string, calls: string[] = []): Fetcher {
  return async input => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://hmc.sodexomyway.com/')) return page();
    const match = /\/v0\.2\/data\/menu\/13147001\/(\d+)\?date=/.exec(url);
    return jsonResponse(match?.[1] === liveMenuId ? sodexoDay : []);
  };
}

test('Sodexo discovers the current menu id from the Hoch location page and remembers it', async () => {
  const calls: string[] = [];
  const result = await refreshSodexo('hoch', ['2026-11-13', '2026-11-14'], undefined, sodexoFetcher(() => htmlResponse(locationPage('2468013')), '2468013', calls));
  assert.deepEqual(result.days.map(day => day.date), ['2026-11-13', '2026-11-14']);
  assert.equal(result.state.menuId, '2468013');
  assert.ok(calls.some(url => url.endsWith('/13147001/2468013?date=2026-11-13')));
  assert.equal(calls.some(url => url.includes('/15258')), false);
});

test('Sodexo reads an escaped menu id from streamed page data', async () => {
  const page = '<script>self.__next_f.push([1,"{\\"metadata\\":{\\"locationId\\":\\"13147001\\",\\"menuId\\":\\"777\\"}}"])</script>';
  const result = await refreshSodexo('hoch', ['2026-11-13'], undefined, sodexoFetcher(() => htmlResponse(page), '777'));
  assert.equal(result.state.menuId, '777');
  assert.equal(result.days.length, 1);
});

test('Sodexo falls back to the last known menu id when discovery fails', async () => {
  const first = await refreshSodexo('hoch', ['2026-11-13'], undefined, sodexoFetcher(() => htmlResponse(locationPage('555')), '555'));
  assert.equal(first.state.menuId, '555');
  const calls: string[] = [];
  const second = await refreshSodexo('hoch', ['2026-11-13'], first.state, sodexoFetcher(() => new Response('', { status: 503 }), '555', calls));
  assert.equal(second.days.length, 1);
  assert.equal(second.state.menuId, '555');
  assert.ok(calls.some(url => url.endsWith('/13147001/555?date=2026-11-13')));

  const thrown = await refreshSodexo('hoch', ['2026-11-13'], first.state, sodexoFetcher(() => { throw new Error('offline'); }, '555'));
  assert.equal(thrown.days.length, 1);
});

test('Sodexo falls back to the built-in current menu id without page or state', async () => {
  const calls: string[] = [];
  const result = await refreshSodexo('hoch', ['2026-11-13'], undefined, sodexoFetcher(() => htmlResponse('<html>redesigned</html>'), '1411281', calls));
  assert.equal(result.days.length, 1);
  assert.ok(calls.some(url => url.endsWith('/13147001/1411281?date=2026-11-13')));
});

test('Sodexo warns loudly when every requested date is an empty array', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const result = await refreshSodexo('hoch', ['2026-11-13', '2026-11-14'], undefined, sodexoFetcher(() => htmlResponse(locationPage('404')), 'none'));
  assert.deepEqual(result.days, []);
  const events = warn.mock.calls.map(call => JSON.parse(String(call.arguments[0])) as { event: string; menuId?: string });
  const empty = events.find(event => event.event === 'sodexo_all_dates_empty');
  assert.ok(empty, 'expected a sodexo_all_dates_empty warning');
  assert.equal(empty.menuId, '404');
});
