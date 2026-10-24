import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/http';
import { CALL_INTERVAL_MS, generateHighlights, HIGHLIGHTS_KEY, menuVersion, withHighlights, PROMPT_VERSION } from '../src/highlights';
import { HIGHLIGHT_STATE_KEY, MAX_DAILY_CALLS, MAX_VERSION_ATTEMPTS, runHighlightJob, type JobStorage } from '../src/highlight-jobs';
import { highlightInput, highlightPrompt, validateSelections } from '../src/highlight-selection';
import { SNAPSHOT_KEY } from '../src/storage';
import { supportedDates } from '../src/dates';
import { HALLS, type Env, type Fetcher, type HallMenu, type Snapshot } from '../src/types';

const now = new Date('2026-09-29T19:00:00Z');
const menu: HallMenu = {
  hall: 'hoch', date: '2026-09-29', status: 'ok', sourceUrl: 'https://example.test',
  lastCheckedAt: now.toISOString(), lastSuccessfulCheckAt: now.toISOString(), menuUpdatedAt: now.toISOString(),
  meals: [
    { name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Tofu curry', vegan: true }] }] },
    { name: 'Dinner', stations: [{ name: 'Grill', items: [{ name: 'Chicken' }] }] },
  ],
};
const selections = { m0: [{ title: 'Tofu curry', sourceIds: ['m0:s0:i0'] }], m1: [{ title: 'Chicken', sourceIds: ['m1:s0:i0'] }] };

function fixture() {
  const snapshot: Snapshot = { version: 1, refreshedAt: now.toISOString(), menus: { [menu.date]: { hoch: structuredClone(menu) } }, sources: {} };
  const kv = new Map([[SNAPSHOT_KEY, JSON.stringify(snapshot)]]);
  const reads: string[] = [];
  const env: Env = { GROQ_API_KEY: 'test-key', MENUS: {
    async get(key) { reads.push(key); return kv.get(key) ?? null; },
    async put(key, value) { kv.set(key, value); },
  } };
  const durable = new Map<string, unknown>();
  const alarms: number[] = [];
  const storage: JobStorage = {
    async get<T>(key: string) { return structuredClone(durable.get(key)) as T | undefined; },
    async put(key, value) { durable.set(key, structuredClone(value)); },
    async setAlarm(time) { alarms.push(time); },
  };
  return { env, kv, reads, storage, durable, alarms, snapshot };
}

const goodResponse = (init?: RequestInit) => {
  const input = init ? JSON.parse(JSON.parse(String(init.body)).messages[1].content) : JSON.parse(highlightInput(menu));
  const meals = Object.fromEntries(input.meals.map((meal: { id: string; stations: { items: { id: string; name: string }[] }[] }) => {
    const item = meal.stations.flatMap(station => station.items)[0];
    return [meal.id, item ? [{ title: '', sourceIds: [item.id] }] : []];
  }));
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ meals }) } }] });
};

test('requests GPT-OSS 120B with low reasoning and strict JSON; preserves original item data', async () => {
  const output = await generateHighlights(menu, 'test-key', async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(PROMPT_VERSION, '9');
    assert.equal(body.max_completion_tokens, 2_000);
    assert.equal(body.messages[0].content, highlightPrompt(menu.hall));
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(JSON.parse(body.messages[1].content).meals.length, 2);
    return goodResponse(init);
  });
  assert.deepEqual(output, selections);
  const f = fixture();
  await runHighlightJob(f.env, f.storage, now, async (_url, init) => goodResponse(init));
  const result = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  const body = await result.json() as any;
  assert.equal(body.highlights.status, 'ready');
  assert.deepEqual(body.highlights.meals[0].items[0], { id: 'm0:s0:i0', station: 'Main', name: 'Tofu curry', vegan: true });
  assert.deepEqual(body.highlights.meals[0].groups, [{
    title: 'Tofu curry', kind: 'single', sourceIds: ['m0:s0:i0'],
    sourceItems: [{ id: 'm0:s0:i0', station: 'Main', name: 'Tofu curry', vegan: true }],
  }]);
  assert.equal(body.highlights.menuVersion, await menuVersion(menu));
});

test('rejects cross-meal, invented, duplicate, missing, extra-meal, and excessive saved selections', () => {
  const group = (...sourceIds: string[]) => ({ title: '', sourceIds });
  for (const invalid of [
    { m0: [group('m1:s0:i0')], m1: [] },
    { m0: [group('invented')], m1: [] },
    { m0: [group('m0:s0:i0'), group('m0:s0:i0')], m1: [] },
    { m0: [] }, { m0: [], m1: [], m2: [] }, [], null,
    { m0: Array(6).fill(group('m0:s0:i0')), m1: [] },
    { m0: [{ sourceIds: ['m0:s0:i0'] }], m1: [] },
  ]) assert.throws(() => validateSelections(invalid, menu, 'id'));
  assert.deepEqual(validateSelections({ m0: [], m1: [] }, menu, 'id'), { m0: [], m1: [] });
});

test('public opt-out skips enrichment storage and malformed switches fail before storage', async () => {
  const f = fixture();
  const response = await handleRequest(new Request('https://test/v1/menus/hoch?highlights=false'), f.env, now);
  assert.deepEqual(await response.json(), menu);
  assert.deepEqual(f.reads, [SNAPSHOT_KEY]);
  for (const query of ['highlights=0', 'highlights=', 'highlights=true&highlights=false']) {
    assert.equal((await handleRequest(new Request(`https://test/v1/menus?${query}`), f.env, now)).status, 400);
  }
  assert.deepEqual(f.reads, [SNAPSHOT_KEY]);
});

test('changed menu content hides old selections; freshness timestamps do not invalidate them', async () => {
  const f = fixture();
  await runHighlightJob(f.env, f.storage, now, async (_url, init) => goodResponse(init));
  assert.equal(await menuVersion(menu), await menuVersion({ ...menu, lastCheckedAt: '2026-09-29T20:00:00Z' }));
  f.snapshot.menus[menu.date].hoch!.meals![0].stations[0].items[0].name = 'Replacement dish';
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  assert.equal((await response.json() as any).highlights.status, 'pending');
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + CALL_INTERVAL_MS), async (_url, init) => goodResponse(init));
  const updated = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  assert.equal((await updated.json() as any).highlights.meals[0].items[0].name, 'Replacement dish');
});

test('saved results survive job restart and a failed publish without duplicate inference', async () => {
  const f = fixture();
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => { calls++; return goodResponse(init); };
  let writes = 0;
  const put = f.env.MENUS.put;
  f.env.MENUS.put = async (key, value) => { if (++writes === 1) throw new Error('KV failure'); await put(key, value); };
  await assert.rejects(runHighlightJob(f.env, f.storage, now, fetcher), /KV failure/);
  assert.ok(f.durable.has(HIGHLIGHT_STATE_KEY));
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + CALL_INTERVAL_MS), fetcher);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(f.kv.get(HIGHLIGHTS_KEY)!).hoch.status, 'ready');
});

test('rate-limit retries honor Retry-After and stop after three attempts', async () => {
  const f = fixture();
  let calls = 0;
  const fetcher: Fetcher = async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '180' } }); };
  await runHighlightJob(f.env, f.storage, now, fetcher);
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + CALL_INTERVAL_MS), fetcher);
  assert.equal(calls, 1);
  for (let i = 1; i <= 4; i++) await runHighlightJob(f.env, f.storage, new Date(now.getTime() + i * 180_000), fetcher);
  assert.equal(calls, 3);
});

test('missing secret, kill switch, closed halls and future dates generate no calls', async () => {
  for (const mode of ['secret', 'disabled', 'closed', 'future']) {
    const f = fixture();
    if (mode === 'secret') delete f.env.GROQ_API_KEY;
    if (mode === 'disabled') f.env.HIGHLIGHTS_ENABLED = 'false';
    if (mode === 'closed') f.snapshot.menus[menu.date].hoch = { ...menu, status: 'closed', meals: [] };
    if (mode === 'future') f.snapshot.menus = { '2026-09-30': { hoch: { ...menu, date: '2026-09-30' } } };
    f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
    await runHighlightJob(f.env, f.storage, now, async () => { assert.fail('Unexpected Groq call'); });
  }
});

test('optional storage failures and truncated model responses leave base menus available', async () => {
  const f = fixture();
  const get = f.env.MENUS.get;
  f.env.MENUS.get = async key => { if (key === HIGHLIGHTS_KEY) throw new Error('unavailable'); return get(key); };
  const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).meals[0].stations[0].items[0].name, 'Tofu curry');
  await assert.rejects(generateHighlights(menu, 'test-key', async () => Response.json({
    choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ meals: { m0: [], m1: [] } }) } }],
  })), /Incomplete/);
});


test('unattempted halls stay pending and the combined and individual projections agree', async () => {
  const f = fixture();
  f.snapshot.menus[menu.date].collins = { ...menu, hall: 'collins' };
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  await runHighlightJob(f.env, f.storage, now, async (_url, init) => goodResponse(init));
  const combined = await handleRequest(new Request('https://test/v1/menus'), f.env, now);
  const body = await combined.json() as { halls: (HallMenu & { highlights: { status: string } })[] };
  assert.equal(body.halls.find(hall => hall.hall === 'collins')!.highlights.status, 'pending');
  const individual = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  assert.deepEqual(body.halls.find(hall => hall.hall === 'hoch'), await individual.json());
});


test('24 hourly collections of seven dates still produce only seven Groq calls for unchanged today menus', async () => {
  const f = fixture();
  const start = new Date('2026-09-29T07:00:00Z'); // California midnight.
  const dates = supportedDates(start);
  const calls: { hall: string; date: string }[] = [];
  const fetcher: Fetcher = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const content = JSON.parse(body.messages[1].content);
    calls.push({ hall: content.hall, date: content.date });
    assert.equal(content.meals.length, 2);
    return goodResponse(init);
  };
  for (let hour = 0; hour < 24; hour++) {
    const checkedAt = new Date(start.getTime() + hour * 3_600_000);
    f.snapshot.menus = Object.fromEntries(dates.map(date => [date, Object.fromEntries(HALLS.map(({ id }) => [id, {
      ...menu, hall: id, date, lastCheckedAt: checkedAt.toISOString(), lastSuccessfulCheckAt: checkedAt.toISOString(),
    }]))]));
    f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
    for (let tick = 0; tick < 8; tick++) {
      await runHighlightJob(f.env, f.storage, new Date(checkedAt.getTime() + tick * 70_000), fetcher);
    }
    const future = await handleRequest(new Request(`https://test/v1/menus/hoch?date=${dates[1]}`), f.env, checkedAt);
    assert.equal((await future.json() as any).highlights.status, 'not_applicable');
  }
  assert.equal(calls.length, 7);
  assert.equal(new Set(calls.map(call => call.hall)).size, 7);
  assert.ok(calls.every(call => call.date === menu.date));
});

test('daily request ceiling stops revisions and publishes a terminal status, then resets for the next date', async () => {
  const f = fixture();
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => { calls++; return goodResponse(init); };
  for (let revision = 0; revision <= MAX_DAILY_CALLS; revision++) {
    f.snapshot.menus[menu.date].hoch!.meals![0].stations[0].items[0].name = `Revision ${revision}`;
    f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
    await runHighlightJob(f.env, f.storage, new Date(now.getTime() + revision * 70_000), fetcher);
  }
  assert.equal(calls, MAX_DAILY_CALLS);
  const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  const body = await response.json() as any;
  assert.equal(body.highlights.status, 'unavailable');
  assert.equal(body.highlights.reason, 'daily_budget_exhausted');
  const tomorrow = new Date('2026-09-30T19:00:00Z');
  f.snapshot.menus = { '2026-09-30': { hoch: {
    ...menu, date: '2026-09-30', lastSuccessfulCheckAt: tomorrow.toISOString(),
  } } };
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  await runHighlightJob(f.env, f.storage, tomorrow, fetcher);
  assert.equal(calls, MAX_DAILY_CALLS + 1);
});

test('oversized input is rejected before reserving a Groq request', async () => {
  const f = fixture();
  f.snapshot.menus[menu.date].hoch!.meals![0].stations[0].items[0].description = 'x'.repeat(25_000);
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  await runHighlightJob(f.env, f.storage, now, async () => { assert.fail('Must not call Groq'); });
  const state = f.durable.get(HIGHLIGHT_STATE_KEY) as { calls: number };
  assert.equal(state.calls, 0);
  const saved = JSON.parse(f.kv.get(HIGHLIGHTS_KEY)!).hoch;
  assert.equal(saved.status, 'unavailable');
  assert.equal(saved.reason, 'input_too_large');
});

test('a previously completed menu version is reused when the source reverts A → B → A', async () => {
  const f = fixture();
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => { calls++; return goodResponse(init); };
  for (const [index, name] of ['Tofu curry', 'Replacement dish', 'Tofu curry'].entries()) {
    f.snapshot.menus[menu.date].hoch!.meals![0].stations[0].items[0].name = name;
    f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
    await runHighlightJob(f.env, f.storage, new Date(now.getTime() + index * 70_000), fetcher);
  }
  assert.equal(calls, 2);
  assert.equal(JSON.parse(f.kv.get(HIGHLIGHTS_KEY)!).hoch.status, 'ready');
});

test('retry backoff starts at error receipt and survives California midnight', async () => {
  const f = fixture();
  const beforeMidnight = new Date('2026-09-30T06:59:50Z');
  f.snapshot.menus[menu.date].hoch!.lastSuccessfulCheckAt = beforeMidnight.toISOString();
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  let clock = 0;
  let calls = 0;
  await runHighlightJob(f.env, f.storage, beforeMidnight, async () => {
    calls++;
    clock += 40_000;
    return new Response('', { status: 429, headers: { 'retry-after': '180' } });
  }, () => clock);
  const expectedRetry = beforeMidnight.getTime() + 220_000;
  assert.equal(f.alarms.at(-1), expectedRetry);
  f.snapshot.menus = { '2026-09-30': { hoch: {
    ...menu, date: '2026-09-30', lastSuccessfulCheckAt: new Date(beforeMidnight.getTime() + 70_000).toISOString(),
  } } };
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  const fetcher: Fetcher = async (_url, init) => { calls++; return goodResponse(init); };
  await runHighlightJob(f.env, f.storage, new Date(beforeMidnight.getTime() + 190_000), fetcher);
  assert.equal(calls, 1);
  assert.equal(f.alarms.at(-1), expectedRetry);
  await runHighlightJob(f.env, f.storage, new Date(expectedRetry), fetcher);
  assert.equal(calls, 2);
});

test('crashes after the last persisted reservation recover to unavailable, never permanent pending', async () => {
  const f = fixture();
  const setAlarm = f.storage.setAlarm;
  const noFetch: Fetcher = async () => { assert.fail('Failure happens before inference'); };
  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt++) {
    f.storage.setAlarm = async () => { throw new Error('simulated crash'); };
    await assert.rejects(runHighlightJob(f.env, f.storage, new Date(now.getTime() + attempt * 70_000), noFetch), /simulated crash/);
  }
  f.storage.setAlarm = setAlarm;
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + MAX_VERSION_ATTEMPTS * 70_000), noFetch);
  const saved = JSON.parse(f.kv.get(HIGHLIGHTS_KEY)!).hoch;
  assert.equal(saved.status, 'unavailable');
  assert.equal(saved.reason, 'attempts_exhausted');
});


test('compact prompts retain selection context and group stations while omitting nutrition metadata', () => {
  const input = structuredClone(menu);
  const item = input.meals![0].stations[0].items[0];
  Object.assign(item, { description: 'Coconut curry', featured: true, calories: 450, allergens: ['soy'] });
  const prompt = JSON.parse(highlightInput(input));
  assert.deepEqual(prompt.meals[0].stations[0], {
    name: 'Main', items: [{ id: '0', name: 'Tofu curry', description: 'Coconut curry', vegan: true, featured: true }],
  });
  assert.equal(item.calories, 450);
  assert.deepEqual(item.allergens, ['soy']);
});


test('strict schema requires empty meal services as well as populated ones', async () => {
  const input = structuredClone(menu);
  input.meals!.splice(1, 0, { name: 'Continental Breakfast', stations: [] });
  const result = await generateHighlights(input, 'test-key', async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const schema = request.response_format.json_schema.schema.properties.meals;
    assert.deepEqual(schema.required, ['m0', 'm1', 'm2']);
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.m0.maxItems, 5);
    assert.equal(schema.properties.m0.items.properties.sourceIds.maxItems, 4);
    assert.equal(schema.properties.m0.items.properties.title.maxLength, 64);
    assert.equal(schema.properties.m1.maxItems, 0);
    assert.deepEqual(schema.properties.m0.items.required, ['sourceIds', 'title']);
    assert.deepEqual(schema.properties.m0.items.properties.sourceIds.items.enum, ['0']);
    assert.deepEqual(schema.properties.m2.items.properties.sourceIds.items.enum, ['1']);
    return Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ meals: { m0: [{ title: '', sourceIds: ['0'] }], m1: [], m2: [{ title: '', sourceIds: ['1'] }] } }),
    } }] });
  });
  assert.deepEqual(result.m1, []);
  await assert.rejects(generateHighlights(input, 'test-key', async () => Response.json({ choices: [{
    finish_reason: 'stop', message: { content: JSON.stringify({ meals: { m0: [], m2: [] } }) },
  }] })), /Meal keys do not match/);
});

test('grouped API adds exact variant sources while items keep one original anchor per offering', async () => {
  const input = structuredClone(menu);
  input.meals![0].stations[0].items = [
    { name: 'Beef bulgogi', containsBeef: true, allergens: ['soy'], calories: 300 },
    { name: 'Chicken bulgogi', containsPoultry: true, allergens: ['wheat'], calories: 200 },
    { name: 'Slider bar' },
  ];
  const before = structuredClone(input);
  const generated = await generateHighlights(input, 'test-key', async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ meals: { m0: [
      { title: 'Chicken or beef bulgogi', sourceIds: ['0', '1'] },
      { title: '', sourceIds: ['2'] },
    ], m1: [] } }),
  } }] }));
  assert.deepEqual(generated.m0, [
    { title: 'Chicken or beef bulgogi', sourceIds: ['m0:s0:i0', 'm0:s0:i1'] },
    { title: 'Slider bar', sourceIds: ['m0:s0:i2'] },
  ]);
  const result = await withHighlights(input, { hoch: {
    date: input.date, menuVersion: await menuVersion(input), status: 'ready', generatedAt: now.toISOString(), selections: generated,
  } }, fixture().env, now);
  if (result.highlights.status !== 'ready') assert.fail('Expected ready highlights');
  const lunch = result.highlights.meals[0];
  const source = (i: number) => ({ id: `m0:s0:i${i}`, station: 'Main', ...input.meals![0].stations[0].items[i] });
  assert.deepEqual(lunch.items, [source(0), source(2)]);
  assert.deepEqual(lunch.groups[0], {
    title: 'Chicken or beef bulgogi', kind: 'variants', sourceIds: ['m0:s0:i0', 'm0:s0:i1'], sourceItems: [source(0), source(1)],
  });
  assert.equal(lunch.groups[1].kind, 'single');
  // No aggregate dietary, allergen or nutrition fields on groups.
  assert.deepEqual(Object.keys(lunch.groups[0]).sort(), ['kind', 'sourceIds', 'sourceItems', 'title']);
  assert.deepEqual(result.highlights.meals[1], { mealIndex: 1, name: 'Dinner', items: [], groups: [] });
  assert.deepEqual(input, before);
});

test('invalid or tampered saved records are served as unavailable, never as ready', async () => {
  const input = structuredClone(menu);
  input.meals![0].stations[0].items = [{ name: 'Beef bulgogi' }, { name: 'Chicken bulgogi' }, { name: 'Orange tofu' }];
  const version = await menuVersion(input);
  const saved = (selections: unknown, extra = {}) => ({ hoch: {
    date: input.date, menuVersion: version, status: 'ready', generatedAt: now.toISOString(), selections, ...extra,
  } });
  for (const value of [
    { m0: [{ title: 'Chicken', sourceIds: ['m1:s0:i0'] }], m1: [] },
    { m0: [{ title: 'Beef bulgogi', sourceIds: ['m0:s0:i0', 'm0:s0:i0'] }], m1: [] },
    { m0: [{ title: 'Orange tofu', sourceIds: ['m0:s0:i2'], extra: true }], m1: [] },
    [{ mealId: 'm0', itemIds: ['m0:s0:i0'] }],
    null,
  ]) {
    const result = await withHighlights(input, saved(value), fixture().env, now);
    assert.equal(result.highlights.status, 'unavailable');
    assert.deepEqual(result.highlights.meals, []);
    assert.deepEqual(result.meals, input.meals);
  }
  // A saved combined title that no longer passes the rules is served split, never as written.
  const split = await withHighlights(input, saved({ m0: [{ title: 'Vegan bulgogi', sourceIds: ['m0:s0:i0', 'm0:s0:i1'] }], m1: [] }), fixture().env, now);
  if (split.highlights.status !== 'ready') assert.fail('Expected ready highlights');
  assert.deepEqual(split.highlights.meals[0].groups.map(group => [group.kind, group.title]), [['single', 'Beef bulgogi'], ['single', 'Chicken bulgogi']]);
  const noTimestamp = await withHighlights(input, saved({ m0: [], m1: [] }, { generatedAt: null }), fixture().env, now);
  assert.equal(noTimestamp.highlights.status, 'unavailable');
  const otherVersion = await withHighlights(input, saved({ m0: [], m1: [] }, { menuVersion: 'old' }), fixture().env, now);
  assert.equal(otherVersion.highlights.status, 'pending');
  const otherDate = await withHighlights(input, saved({ m0: [], m1: [] }, { date: '2026-09-28' }), fixture().env, now);
  assert.equal(otherDate.highlights.status, 'pending');
});

test('corrupt highlights storage never breaks the base menu response', async () => {
  const f = fixture();
  f.kv.set(HIGHLIGHTS_KEY, '{not json');
  const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.highlights.status, 'pending');
  assert.deepEqual(body.meals, menu.meals);
});

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Fetcher =>
  async () => Response.json(body, { status, headers });
const savedHoch = (f: ReturnType<typeof fixture>) => JSON.parse(f.kv.get(HIGHLIGHTS_KEY)!).hoch;

test('retryable failures stay pending between attempts, then become unavailable with attempts_exhausted', async () => {
  const failures: [string, Fetcher][] = [
    ['server error', reply(503)],
    ['schema miss', reply(400, { error: { code: 'json_validate_failed', message: 'x' } })],
    ['timeout', async () => { throw new DOMException('The operation timed out', 'TimeoutError'); }],
    ['malformed body', async () => new Response('<html>oops</html>', { status: 200 })],
    ['malformed content', async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"meals":' } }] })],
    ['failed validation', async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ meals: { m0: [{ title: '', sourceIds: ['1'] }], m1: [] } }) } }] })],
  ];
  for (const [label, fetcher] of failures) {
    const f = fixture();
    let calls = 0;
    const counted: Fetcher = async (url, init) => { calls++; return fetcher(url, init); };
    for (let attempt = 1; attempt <= MAX_VERSION_ATTEMPTS + 1; attempt++) {
      await runHighlightJob(f.env, f.storage, new Date(now.getTime() + attempt * 70_000), counted);
      const saved = savedHoch(f);
      if (attempt < MAX_VERSION_ATTEMPTS) {
        assert.equal(saved.status, 'pending', label);
        assert.equal(saved.reason, undefined, label);
        const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
        assert.equal((await response.json() as any).highlights.status, 'pending', label);
      }
    }
    assert.equal(calls, MAX_VERSION_ATTEMPTS, label);
    assert.equal(savedHoch(f).status, 'unavailable', label);
    assert.equal(savedHoch(f).reason, 'attempts_exhausted', label);
  }
});

test('non-retryable provider errors stop after one call with a terminal reason', async () => {
  for (const [status, reason] of [[401, 'generation_failed'], [400, 'generation_failed'], [413, 'input_too_large']] as const) {
    const f = fixture();
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; return Response.json({ error: { code: 'other' } }, { status }); };
    for (let tick = 0; tick < 3; tick++) await runHighlightJob(f.env, f.storage, new Date(now.getTime() + tick * 70_000), fetcher);
    assert.equal(calls, 1, String(status));
    assert.deepEqual([savedHoch(f).status, savedHoch(f).reason], ['unavailable', reason]);
    const response = await handleRequest(new Request('https://test/v1/menus/hoch'), f.env, now);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.deepEqual(body.highlights, { status: 'unavailable', reason, meals: [] });
  }
});

test('a hall-wide Retry-After cooldown also delays other halls', async () => {
  const f = fixture();
  f.snapshot.menus[menu.date].collins = { ...structuredClone(menu), hall: 'collins' };
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  const halls: string[] = [];
  const fetcher: Fetcher = async (_url, init) => {
    halls.push(JSON.parse(JSON.parse(String(init?.body)).messages[1].content).hall);
    return halls.length === 1 ? new Response('', { status: 429, headers: { 'retry-after': '600' } }) : goodResponse(init);
  };
  await runHighlightJob(f.env, f.storage, now, fetcher, () => 0);
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + 120_000), fetcher, () => 0);
  assert.equal(halls.length, 1);
  assert.equal(f.alarms.at(-1), now.getTime() + 600_000);
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + 600_000), fetcher, () => 0);
  assert.equal(halls.length, 2);
});

test('stale menus with food still generate; menus with no items are not_applicable and never call Groq', async () => {
  const f = fixture();
  f.snapshot.menus[menu.date].hoch!.lastSuccessfulCheckAt = new Date(now.getTime() - 3 * 3_600_000).toISOString();
  f.snapshot.menus[menu.date].collins = { ...structuredClone(menu), hall: 'collins', meals: [{ name: 'Continental Breakfast', stations: [] }] };
  f.kv.set(SNAPSHOT_KEY, JSON.stringify(f.snapshot));
  const halls: string[] = [];
  const fetcher: Fetcher = async (_url, init) => { halls.push(JSON.parse(JSON.parse(String(init?.body)).messages[1].content).hall); return goodResponse(init); };
  for (let tick = 0; tick < 3; tick++) await runHighlightJob(f.env, f.storage, new Date(now.getTime() + tick * 70_000), fetcher);
  assert.deepEqual(halls, ['hoch']);
  const body = await (await handleRequest(new Request('https://test/v1/menus'), f.env, now)).json() as any;
  const status = (id: string) => body.halls.find((hall: any) => hall.hall === id);
  assert.equal(status('hoch').status, 'stale');
  assert.equal(status('hoch').highlights.status, 'ready');
  assert.deepEqual(status('collins').highlights, { status: 'not_applicable', meals: [] });
});

test('a saved ready result that no longer validates is requeued within its attempt budget', async () => {
  const f = fixture();
  let calls = 0;
  const fetcher: Fetcher = async (_url, init) => { calls++; return goodResponse(init); };
  await runHighlightJob(f.env, f.storage, now, fetcher);
  // Simulate a stricter validator by corrupting the saved selection in place.
  const state = f.durable.get(HIGHLIGHT_STATE_KEY) as any;
  state.jobs.hoch.record.selections = { m0: [{ title: '', sourceIds: ['m1:s0:i0'] }], m1: [] };
  f.durable.set(HIGHLIGHT_STATE_KEY, state);
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + 70_000), fetcher);
  assert.equal(calls, 2);
  assert.equal(savedHoch(f).status, 'ready');
  await runHighlightJob(f.env, f.storage, new Date(now.getTime() + 140_000), fetcher);
  assert.equal(calls, 2);
});
