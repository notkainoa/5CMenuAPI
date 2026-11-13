import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/http.ts';
import { SNAPSHOT_KEY } from '../src/storage.ts';
import type { Env, HallMenu, Snapshot, SnapshotStore } from '../src/types.ts';

const NOW = new Date('2026-09-06T19:00:00.000Z'); // Noon in California during daylight saving time.
const TODAY = '2026-09-06';
const TOMORROW = '2026-09-07';

class MemoryStore implements SnapshotStore {
  reads = 0;
  writes = 0;

  constructor(private readonly value: string | null) {}

  async get(key: string): Promise<string | null> {
    assert.equal(key, SNAPSHOT_KEY);
    this.reads += 1;
    return this.value;
  }

  async put(): Promise<void> {
    this.writes += 1;
  }
}

function menu(hall: HallMenu['hall'], date = TODAY): HallMenu {
  return {
    hall,
    date,
    status: 'ok',
    sourceUrl: 'https://menus.example.test/',
    lastCheckedAt: '2026-09-06T18:00:00.000Z',
    lastSuccessfulCheckAt: '2026-09-06T18:00:00.000Z',
    menuUpdatedAt: '2026-09-06T18:00:00.000Z',
    meals: [{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta' }] }] }],
  };
}

function snapshot(): Snapshot {
  return {
    version: 1,
    refreshedAt: '2026-09-06T18:00:00.000Z',
    menus: { [TODAY]: { mcconnell: menu('mcconnell') } },
    sources: {},
  };
}

function environment(value: string | null = JSON.stringify(snapshot())): { env: Env; store: MemoryStore } {
  const store = new MemoryStore(value);
  return { env: { MENUS: store }, store };
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

test('lists public hall metadata without reading storage', async () => {
  const { env, store } = environment();
  const response = await handleRequest(new Request('https://api.example.test/v1/halls'), env, NOW);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
  assert.equal(store.reads, 0);
  assert.deepEqual((await json(response) as { halls: { id: string }[] }).halls.map(({ id }) => id), [
    'hoch', 'malott', 'mcconnell', 'collins', 'frank', 'frary', 'oldenborg',
  ]);
});

test('serves matching combined and individual menus from one snapshot read', async () => {
  const { env, store } = environment();
  const combined = await handleRequest(new Request(`https://api.example.test/v1/menus?date=${TODAY}`), env, NOW);
  const individual = await handleRequest(new Request(`https://api.example.test/v1/menus/mcconnel?date=${TODAY}`), env, NOW);

  assert.equal(combined.status, 200);
  assert.equal(store.reads, 2);
  const payload = await json(combined) as { date: string; timezone: string; halls: HallMenu[] };
  assert.equal(payload.date, TODAY);
  assert.equal(payload.timezone, 'America/Los_Angeles');
  assert.deepEqual(payload.halls.find(({ hall }) => hall === 'mcconnell'), await json(individual));
  assert.equal(store.writes, 0);
});

test('rejects malformed, unsupported, and unknown query input before storage access', async () => {
  const { env, store } = environment();
  for (const url of [
    'https://api.example.test/v1/menus?date=09-06-2026',
    `https://api.example.test/v1/menus?date=${TOMORROW}T00:00:00Z`,
    'https://api.example.test/v1/menus?date=2026-09-20',
    'https://api.example.test/v1/menus?hall=frary',
    `https://api.example.test/v1/menus?date=${TODAY}&date=${TOMORROW}`,
  ]) {
    const response = await handleRequest(new Request(url), env, NOW);
    assert.equal(response.status, 400);
    assert.match((await json(response) as { error: { code: string } }).error.code, /date|query/);
  }
  assert.equal(store.reads, 0);
});

test('accepts today through six days ahead and rejects the eighth calendar day', async () => {
  const { env, store } = environment();
  const lastSupported = await handleRequest(new Request('https://api.example.test/v1/menus?date=2026-09-12'), env, NOW);
  const eighthDay = await handleRequest(new Request('https://api.example.test/v1/menus?date=2026-09-13'), env, NOW);

  assert.equal(lastSupported.status, 503);
  assert.equal(store.reads, 1);
  assert.equal(eighthDay.status, 400);
  assert.equal((await json(eighthDay) as { error: { code: string } }).error.code, 'unsupported_date');
  assert.equal(store.reads, 1);
});

test('uses expected method, route, and hall errors', async () => {
  const { env } = environment();
  const method = await handleRequest(new Request('https://api.example.test/v1/menus', { method: 'POST' }), env, NOW);
  const route = await handleRequest(new Request('https://api.example.test/nope'), env, NOW);
  const hall = await handleRequest(new Request(`https://api.example.test/v1/menus/nope?date=${TODAY}`), env, NOW);
  const options = await handleRequest(new Request('https://api.example.test/nope', { method: 'OPTIONS' }), env, NOW);

  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(route.status, 404);
  assert.equal(hall.status, 404);
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), '*');
});

test('returns 503 for unavailable individual data and an all-unavailable combined response', async () => {
  const { env, store } = environment(null);
  const individual = await handleRequest(new Request(`https://api.example.test/v1/menus/frary?date=${TODAY}`), env, NOW);
  const combined = await handleRequest(new Request(`https://api.example.test/v1/menus?date=${TODAY}`), env, NOW);

  assert.equal(individual.status, 503);
  assert.equal((await json(individual) as HallMenu).status, 'unavailable');
  assert.equal(combined.status, 503);
  assert.equal((await json(combined) as { halls: HallMenu[] }).halls.every(({ status }) => status === 'unavailable'), true);
  assert.equal(store.reads, 2);
  assert.equal(store.writes, 0);
});

test('handles invalid stored data as a clean 503 response', async () => {
  const { env } = environment('{not json');
  const response = await handleRequest(new Request(`https://api.example.test/v1/menus?date=${TODAY}`), env, NOW);

  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), {
    error: { code: 'storage_unavailable', message: 'Stored menu data is temporarily unavailable.' },
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('one corrupted stored entry does not take down the rest of the API', async () => {
  const stored = snapshot();
  stored.menus[TODAY].collins = { ...menu('collins'), meals: [{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: '  ' }] }] }] };
  const { env } = environment(JSON.stringify(stored));
  const combined = await handleRequest(new Request(`https://api.example.test/v1/menus?date=${TODAY}`), env, NOW);
  const good = await handleRequest(new Request(`https://api.example.test/v1/menus/mcconnell?date=${TODAY}`), env, NOW);
  const bad = await handleRequest(new Request(`https://api.example.test/v1/menus/collins?date=${TODAY}`), env, NOW);

  assert.equal(combined.status, 200);
  const halls = (await json(combined) as { halls: HallMenu[] }).halls;
  assert.equal(halls.find(({ hall }) => hall === 'mcconnell')?.status, 'ok');
  assert.equal(halls.find(({ hall }) => hall === 'collins')?.status, 'unavailable');
  assert.equal(good.status, 200);
  assert.equal(bad.status, 503);
  assert.equal((await json(bad) as HallMenu).error?.code, 'MENU_UNAVAILABLE');
});

test('handles a failed KV read as a clean 503 response', async () => {
  const env: Env = {
    MENUS: {
      async get(): Promise<string | null> { throw new Error('KV unavailable'); },
      async put(): Promise<void> {},
    },
  };
  const response = await handleRequest(new Request(`https://api.example.test/v1/menus?date=${TODAY}`), env, NOW);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await json(response) as { error: { code: string } }).error.code, 'storage_unavailable');
});

test('changes the implicit service date at California midnight and expires the cache before rollover', async () => {
  const { env } = environment();
  const beforeMidnight = new Date('2026-09-07T06:59:59.000Z');
  const afterMidnight = new Date('2026-09-07T07:00:01.000Z');
  const before = await handleRequest(new Request('https://api.example.test/v1/menus'), env, beforeMidnight);
  const after = await handleRequest(new Request('https://api.example.test/v1/menus'), env, afterMidnight);

  assert.equal((await json(before) as { date: string }).date, TODAY);
  assert.equal((await json(after) as { date: string }).date, TOMORROW);
  assert.equal(before.headers.get('cache-control'), 'public, max-age=1, must-revalidate');
  assert.equal(after.headers.get('cache-control'), 'no-store');
});

test('supports conditional GET, HEAD, and conservative cache headers', async () => {
  const { env } = environment();
  const first = await handleRequest(new Request(`https://api.example.test/v1/menus/mcconnell?date=${TODAY}`), env, NOW);
  const tag = first.headers.get('etag');
  assert.ok(tag);
  assert.match(first.headers.get('cache-control') ?? '', /max-age=(?:[0-9]|[1-5][0-9]|60)/);

  const conditional = await handleRequest(new Request(`https://api.example.test/v1/menus/mcconnell?date=${TODAY}`, {
    headers: { 'If-None-Match': tag },
  }), env, NOW);
  const head = await handleRequest(new Request('https://api.example.test/v1/menus/mcconnell', { method: 'HEAD' }), env, NOW);
  const defaultDate = await handleRequest(new Request('https://api.example.test/v1/menus/mcconnell'), env, NOW);

  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('etag'), tag);
  assert.equal(defaultDate.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
});
