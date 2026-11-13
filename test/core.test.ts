import test from 'node:test';
import assert from 'node:assert/strict';
import { californiaDate, isValidDate, supportedDates } from '../src/dates';
import { menuFor } from '../src/menus';
import { refreshMenus } from '../src/refresh';
import { readSnapshot, validMeals } from '../src/storage';
import { HALLS, type ParsedDay, type RefreshHall, type SnapshotStore } from '../src/types';

class MemoryStore implements SnapshotStore {
  value: string | null = null;
  writes = 0;
  async get() { return this.value; }
  async put(_key: string, value: string) { this.value = value; this.writes++; }
}
const now = new Date('2026-09-06T19:00:00Z');
function day(date: string, name = 'Soup'): ParsedDay {
  return { date, status: 'ok', meals: [{ name: 'Lunch', stations: [{ name: 'Soup', items: [{ name }] }] }] };
}
const provider: RefreshHall = async (_hall, dates) => ({ days: dates.map(date => day(date)), state: { hash: 'same' } });

test('California calendar dates handle UTC rollover, leap years, and both DST transitions', () => {
  assert.equal(californiaDate(new Date('2026-09-07T06:59:59Z')), '2026-09-06');
  assert.equal(californiaDate(new Date('2026-09-07T07:00:00Z')), '2026-09-07');
  assert.deepEqual(supportedDates(new Date('2026-03-08T09:00:00Z')), [
    '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
  ]);
  assert.deepEqual(supportedDates(new Date('2026-11-01T08:00:00Z')), [
    '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
  ]);
  assert.equal(isValidDate('2024-02-29'), true);
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-01-01x', 'foo']) assert.equal(isValidDate(invalid), false);
});

test('one refresh writes one snapshot for every hall and date; unchanged data preserves update time', async () => {
  const store = new MemoryStore();
  const first = await refreshMenus({ MENUS: store }, provider, now);
  assert.equal(store.writes, 1);
  assert.deepEqual(Object.keys(first.menus).sort(), ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);
  assert.equal(Object.keys(first.menus['2026-09-06']).length, 7);
  const later = new Date('2026-09-06T20:00:00Z');
  const second = await refreshMenus({ MENUS: store }, provider, later);
  assert.equal(store.writes, 2);
  assert.equal(second.menus['2026-09-06'].collins?.menuUpdatedAt, now.toISOString());
  assert.equal(second.menus['2026-09-06'].collins?.lastSuccessfulCheckAt, later.toISOString());
  assert.deepEqual(await readSnapshot(store), JSON.parse(store.value!));
});

test('partial failure retains same-day data, marks only failed hall stale, and recovers', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const failed = await refreshMenus({ MENUS: store }, async (hall, ...args) => {
    if (hall === 'collins') throw new Error('upstream timeout');
    return provider(hall, ...args);
  }, new Date('2026-09-06T20:00:00Z'));
  assert.equal(failed.menus['2026-09-06'].collins?.status, 'stale');
  assert.equal(failed.menus['2026-09-06'].collins?.lastSuccessfulCheckAt, now.toISOString());
  assert.equal(failed.menus['2026-09-06'].frary?.status, 'ok');
  const recovered = await refreshMenus({ MENUS: store }, provider, new Date('2026-09-06T21:00:00Z'));
  assert.equal(recovered.menus['2026-09-06'].collins?.status, 'ok');
  assert.equal(recovered.menus['2026-09-06'].collins?.error, undefined);
});

test('new date never inherits an earlier date and old dates are pruned', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, async () => ({ days: [day('2026-09-06')], state: {} }), now);
  const next = await refreshMenus({ MENUS: store }, async () => { throw new Error('offline'); }, new Date('2026-09-07T08:00:00Z'));
  assert.equal(next.menus['2026-09-06'], undefined);
  assert.equal(next.menus['2026-09-07'].collins?.status, 'unavailable');
  assert.equal(next.menus['2026-09-07'].collins?.meals, null);
  assert.equal(menuFor(next, 'collins', '2026-09-06', now).status, 'unavailable');
});

test('missing publication and invalid empty menus cannot erase valid meals', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const missing = await refreshMenus({ MENUS: store }, async () => ({ days: [], state: {} }), now);
  assert.equal(missing.menus['2026-09-06'].collins?.status, 'stale');
  assert.equal(missing.menus['2026-09-06'].collins?.error?.code, 'MENU_NOT_PUBLISHED');
  const empty = await refreshMenus({ MENUS: store }, async () => ({ days: [{ date: '2026-09-06', status: 'ok', meals: [] }], state: {} }), now);
  assert.equal(empty.menus['2026-09-06'].collins?.status, 'stale');
  assert.ok(empty.menus['2026-09-06'].collins?.meals?.length);
});

test('explicit closure is accepted but closed menus with items are rejected', async () => {
  const store = new MemoryStore();
  const closed = await refreshMenus({ MENUS: store }, async () => ({ days: [{ date: '2026-09-06', status: 'closed', meals: [] }], state: {} }), now);
  assert.equal(closed.menus['2026-09-06'].collins?.status, 'closed');
  assert.deepEqual(closed.menus['2026-09-06'].collins?.meals, []);
  const bad = await refreshMenus({ MENUS: store }, async () => ({ days: [{ ...day('2026-09-06'), status: 'closed' }], state: {} }), now);
  assert.equal(bad.menus['2026-09-06'].collins?.status, 'stale');
});

test('missed hourly run makes menus stale without mutating storage or substituting dates', async () => {
  const store = new MemoryStore();
  const snapshot = await refreshMenus({ MENUS: store }, provider, now);
  assert.equal(menuFor(snapshot, 'collins', '2026-09-06', new Date('2026-09-06T21:00:00Z')).status, 'stale');
  assert.equal(snapshot.menus['2026-09-06'].collins?.status, 'ok');
  assert.equal(store.writes, 1);
});

test('storage read failures abort the refresh and never trigger a destructive replacement', async () => {
  let calls = 0;
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const good = store.value;
  const throwingStore = { get: async () => { throw new Error('KV get failed'); }, put: async (_key: string, value: string) => { store.value = value; store.writes++; } };
  await assert.rejects(refreshMenus({ MENUS: throwingStore }, async (...args) => { calls++; return provider(...args); }, now), /KV get failed/);
  assert.equal(calls, 0);
  assert.equal(store.writes, 1);
  assert.equal(store.value, good);
  const failingStore = { get: async () => null, put: async () => { throw new Error('KV unavailable'); } };
  await assert.rejects(refreshMenus({ MENUS: failingStore }, provider, now), /KV unavailable/);
});

test('a structurally invalid snapshot is replaced by the next refresh', async () => {
  for (const corrupt of ['{broken json', JSON.stringify({ version: 2, refreshedAt: now.toISOString(), menus: {}, sources: {} }), 'null']) {
    const store = new MemoryStore();
    store.value = corrupt;
    await assert.rejects(readSnapshot(store), /Invalid menu snapshot/);
    const next = await refreshMenus({ MENUS: store }, provider, now);
    assert.equal(store.writes, 1);
    assert.equal(next.menus['2026-09-06'].collins?.status, 'ok');
    assert.deepEqual(await readSnapshot(store), JSON.parse(store.value!));
  }
});

test('one corrupted stored entry is dropped, not the whole snapshot, and refresh heals it', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const stored = JSON.parse(store.value!);
  // Simulates a deploy that tightened a validator while old entries were stored.
  stored.menus['2026-09-06'].collins.meals[0].stations[0].items[0].allergens = ['not-an-allergen'];
  stored.menus['2026-09-07'] = 'garbage';
  stored.sources.frary = 'garbage';
  store.value = JSON.stringify(stored);

  const read = await readSnapshot(store);
  assert.equal(read?.menus['2026-09-06'].collins, undefined);
  assert.equal(read?.menus['2026-09-06'].frary?.status, 'ok');
  assert.equal(read?.menus['2026-09-07'], undefined);
  assert.equal(read?.menus['2026-09-08'].collins?.status, 'ok');
  assert.equal(read?.sources.frary, undefined);
  assert.deepEqual(read?.sources.collins, { hash: 'same' });

  const later = new Date('2026-09-06T20:00:00Z');
  const healed = await refreshMenus({ MENUS: store }, provider, later);
  assert.equal(store.writes, 2);
  assert.equal(healed.menus['2026-09-06'].collins?.status, 'ok');
  assert.equal(healed.menus['2026-09-06'].frary?.menuUpdatedAt, now.toISOString());
  assert.deepEqual(await readSnapshot(store), JSON.parse(store.value!));
});

test('one invalid day fails only its own date and keeps that date stale', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const later = new Date('2026-09-06T20:00:00Z');
  const invalidDays: ParsedDay[] = [
    { date: '2026-09-06', status: 'ok', meals: [] },
    { date: '2026-09-07', status: 'ok', meals: [{ name: 'Lunch', stations: [{ name: 'Soup', items: [{ name: '   ' }] }] }] },
    { date: '2026-09-08', status: 'ok', meals: Array.from({ length: 31 }, () => day('2026-09-08').meals[0]) },
  ];
  const result = await refreshMenus({ MENUS: store }, async (hall, dates) => hall !== 'collins' ? provider(hall, dates, undefined, fetch) : ({
    days: [...invalidDays, ...dates.slice(3).map(date => day(date, 'Stew'))],
    state: { hash: 'new' },
  }), later);
  for (const date of ['2026-09-06', '2026-09-07', '2026-09-08']) {
    assert.equal(result.menus[date].collins?.status, 'stale');
    assert.equal(result.menus[date].collins?.error?.code, 'SOURCE_FETCH_FAILED');
    assert.equal(result.menus[date].collins?.meals?.[0].stations[0].items[0].name, 'Soup');
    assert.equal(result.menus[date].collins?.lastSuccessfulCheckAt, now.toISOString());
  }
  for (const date of ['2026-09-09', '2026-09-12']) {
    assert.equal(result.menus[date].collins?.status, 'ok');
    assert.equal(result.menus[date].collins?.meals?.[0].stations[0].items[0].name, 'Stew');
  }
  assert.equal(result.menus['2026-09-06'].frary?.status, 'ok');
  // State that produced an invalid day is not kept, so the next run refetches.
  assert.equal(result.sources.collins, undefined);
  assert.deepEqual(result.sources.frary, { hash: 'same' });
});

test('a structurally broken provider result still fails the whole hall', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  for (const broken of [null, { days: 'nope', state: {} }, { days: [], state: [] }, { days: [], state: {}, errors: [] }]) {
    const result = await refreshMenus({ MENUS: store }, async (hall, ...args) =>
      hall === 'collins' ? broken as never : provider(hall, ...args), now);
    for (const date of supportedDates(now)) assert.equal(result.menus[date].collins?.error?.code, 'SOURCE_FETCH_FAILED');
  }
});

test('a failing provider does not carry its source state into the next run', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const failed = await refreshMenus({ MENUS: store }, async (hall, ...args) => {
    if (hall === 'collins') throw new Error('cached parse keeps failing');
    return provider(hall, ...args);
  }, new Date('2026-09-06T20:00:00Z'));
  assert.equal(failed.sources.collins, undefined);
  assert.deepEqual(failed.sources.frary, { hash: 'same' });
  const seen: Record<string, unknown> = {};
  await refreshMenus({ MENUS: store }, async (hall, dates, previous) => {
    seen[hall] = previous;
    return provider(hall, dates, previous, fetch);
  }, new Date('2026-09-06T21:00:00Z'));
  assert.equal(seen.collins, undefined);
  assert.deepEqual(seen.frary, { hash: 'same' });
});

test('provider concurrency is bounded and previous state is passed through', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  let active = 0; let peak = 0;
  await refreshMenus({ MENUS: store }, async (_hall, dates, previous) => {
    assert.equal(previous?.hash, 'same');
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return { days: dates.map(date => day(date)), state: {} };
  }, now);
  assert.equal(peak, 2);
  assert.equal(HALLS.length, 7);
});

test('a snapshot over 5 MB fails the refresh without writing', async () => {
  const store = new MemoryStore();
  const items = Array.from({ length: 80 }, (_, index) => ({ name: `${index}:${'n'.repeat(1990)}` }));
  await assert.rejects(refreshMenus({ MENUS: store }, async (_hall, dates) => ({
    days: dates.map(date => ({ date, status: 'ok' as const, meals: [{ name: 'Lunch', stations: [{ name: 'Main', items }] }] })),
    state: { hash: 'huge' },
  }), now), /5 MB/);
  assert.equal(store.writes, 0);
});

test('per-date provider errors publish successful dates and mark the rest failed', async () => {
  const store = new MemoryStore();
  const failed = await refreshMenus({ MENUS: store }, async (_hall, dates) => ({
    days: [day(dates[0])],
    state: { hash: 'partial' },
    errors: { [dates[1]]: { code: 'SOURCE_FETCH_FAILED', message: 'The menu source could not be fetched or validated.' } },
  }), now);
  assert.equal(failed.menus['2026-09-06'].collins?.status, 'ok');
  assert.equal(failed.menus['2026-09-07'].collins?.status, 'unavailable');
  assert.equal(failed.menus['2026-09-07'].collins?.error?.code, 'SOURCE_FETCH_FAILED');
});

test('stored snapshots drop invalid meal times and closed menus that still list food', async () => {
  const store = new MemoryStore();
  await refreshMenus({ MENUS: store }, provider, now);
  const snapshot = JSON.parse(store.value!) as { menus: Record<string, { collins: { meals: { startTime?: string }[]; status: string } }> };
  snapshot.menus['2026-09-06'].collins.meals[0].startTime = 'noon';
  store.value = JSON.stringify(snapshot);
  const read = await readSnapshot(store);
  assert.equal(read?.menus['2026-09-06'].collins, undefined);
  assert.equal(read?.menus['2026-09-06'].frary?.status, 'ok');

  const closedStore = new MemoryStore();
  await refreshMenus({ MENUS: closedStore }, async () => ({
    days: [{ date: '2026-09-06', status: 'closed' as const, meals: [] }],
    state: {},
  }), now);
  const closed = JSON.parse(closedStore.value!) as { menus: Record<string, { collins: { status: string; meals: unknown } }> };
  closed.menus['2026-09-06'].collins.meals = [{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta' }] }] }];
  closedStore.value = JSON.stringify(closed);
  assert.equal((await readSnapshot(closedStore))?.menus['2026-09-06'].collins, undefined);
});

test('stored items accept featured true or false and reject non-boolean featured', () => {
  const meals = [{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', featured: false }] }] }];
  assert.equal(validMeals(meals), true);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', featured: true }] }] }]), true);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', featured: 1 }] }] }]), false);
});

test('stored meals accept known period tokens and reject unknown labels', () => {
  assert.equal(validMeals([{ name: 'DINNER', period: 'dinner', stations: [{ name: 'Main', items: [{ name: 'Pasta' }] }] }]), true);
  assert.equal(validMeals([{ name: 'Snack', stations: [{ name: 'Main', items: [{ name: 'Pasta' }] }] }]), true);
  assert.equal(validMeals([{ name: 'DINNER', period: 'DINNER', stations: [{ name: 'Main', items: [{ name: 'Pasta' }] }] }]), false);
});

test('stored items accept explicit diet no values and reject non-boolean diet flags', () => {
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', glutenFree: false, plantBased: true }] }] }]), true);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', glutenFree: 'yes' }] }] }]), false);
});

test('stored items accept a sorted unique allergen list and reject invalid entries', () => {
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: ['milk', 'wheat'] }] }] }]), true);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: [] }] }] }]), false);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: ['wheat', 'milk'] }] }] }]), false);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: ['Milk', 'wheat'] }] }] }]), false);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: ['soybeans'] }] }] }]), false);
  assert.equal(validMeals([{ name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Pasta', allergens: ['milk', 'milk'] }] }] }]), false);
});
