import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPomona } from '../src/providers/pomona';
import { parsePomonaHours } from '../src/providers/pomona-hours';
import { refreshSodexo } from '../src/providers/sodexo';
import type { Fetcher } from '../src/types';

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...init.headers },
  ...init,
});

test('Sodexo reads exact dates and preserves known item fields', async () => {
  const calls: string[] = [];
  const fetcher: Fetcher = async input => {
    calls.push(String(input));
    return jsonResponse([{
      name: 'LUNCH',
      groups: [{ name: 'CHEF &amp; CORNER', items: [{
        formalName: 'Rice &amp; Beans', description: 'With vegetables',
        isVegan: true, isVegetarian: true, isPlantBased: true, isMindful: true, calories: '320',
      }] }],
    }]);
  };
  const result = await refreshSodexo('hoch', ['2026-09-06', '2026-09-07'], undefined, fetcher);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /date=2026-09-07$/);
  assert.deepEqual(result.days[0], {
    date: '2026-09-06', status: 'ok', meals: [{ name: 'LUNCH', period: 'lunch', stations: [{
      name: 'CHEF & CORNER', items: [{ name: 'Rice & Beans', description: 'With vegetables', vegan: true, vegetarian: true, plantBased: true, mindful: true, calories: 320 }],
    }] }],
  });
});

test('Sodexo publishes plant-based and mindful yes/no and does not infer gluten-free from allergens', async () => {
  const result = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse([{
    name: 'LUNCH',
    groups: [{ name: 'Grill', items: [{
      formalName: 'Burger',
      isVegan: false, isVegetarian: false, isPlantBased: false, isMindful: false, isSwell: true,
      allergens: [{ allergen: 'Gluten', name: 'Gluten', contains: 'false' }],
    }] }],
  }]));
  assert.deepEqual(result.days[0].meals[0].stations[0].items[0], {
    name: 'Burger', vegan: false, vegetarian: false, plantBased: false, mindful: false,
  });
});

test('Sodexo publishes an explicit isGlutenFree flag when the feed sends it', async () => {
  const result = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse([{
    name: 'LUNCH',
    groups: [{ name: 'Grill', items: [{ formalName: 'Rice', isGlutenFree: true }] }],
  }]));
  assert.equal(result.days[0].meals[0].stations[0].items[0].glutenFree, true);
});

test('Sodexo publishes present allergens as a sorted lowercase list', async () => {
  const result = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse([{
    name: 'BREAKFAST',
    groups: [{ name: 'Bakery', items: [{
      formalName: 'Mini Chocolate Croissant', isVegetarian: true, calories: '100',
      allergens: [
        { allergen: 'Soy', name: 'Soy', contains: 'true' },
        { allergen: 'Milk', name: 'Milk', contains: 'true' },
        { allergen: 'Gluten', name: 'Gluten', contains: 'true' },
        { allergen: 'Wheat', name: 'Wheat', contains: 'true' },
        { allergen: 'Peanut', name: 'Peanut', contains: 'false' },
      ],
    }] }],
  }]));
  assert.deepEqual(result.days[0].meals[0].stations[0].items[0], {
    name: 'Mini Chocolate Croissant', vegetarian: true, calories: 100,
    allergens: ['gluten', 'milk', 'soy', 'wheat'],
  });
});

test('Sodexo reuses parsed results when the downloaded body is unchanged', async () => {
  const body = [{ name: 'DINNER', groups: [{ name: 'Grill', items: [{ formalName: 'Tacos' }] }] }];
  const first = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse(body));
  const second = await refreshSodexo('hoch', ['2026-09-06'], first.state, async () => jsonResponse(body));
  assert.deepEqual(second, first);
});

test('Sodexo reparses cached dates after a parser version bump so period is published', async () => {
  const body = [{ name: 'DINNER', groups: [{ name: 'Grill', items: [{ formalName: 'Tacos' }] }] }];
  const first = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse(body));
  const stale = structuredClone(first.state) as { provider: string; dates: Record<string, { hash: string; day: { meals: Array<{ period?: string }> } }> };
  delete (stale as { version?: number }).version;
  delete stale.dates['2026-09-06'].day.meals[0].period;
  const second = await refreshSodexo('hoch', ['2026-09-06'], stale, async () => jsonResponse(body));
  assert.equal(second.days[0].meals[0].period, 'dinner');
});

test('Sodexo reparses cached dates after a parser version bump so diet flags are published', async () => {
  const body = [{ name: 'LUNCH', groups: [{ name: 'Grill', items: [{ formalName: 'Rice', isPlantBased: true, isGlutenFree: true }] }] }];
  const first = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse(body));
  const stale = structuredClone(first.state) as { provider: string; version: number; dates: Record<string, { hash: string; day: { meals: Array<{ stations: Array<{ items: Array<{ plantBased?: boolean; glutenFree?: boolean }> }> }> } }> };
  stale.version = 1;
  delete stale.dates['2026-09-06'].day.meals[0].stations[0].items[0].plantBased;
  delete stale.dates['2026-09-06'].day.meals[0].stations[0].items[0].glutenFree;
  const second = await refreshSodexo('hoch', ['2026-09-06'], stale, async () => jsonResponse(body));
  assert.equal(second.days[0].meals[0].stations[0].items[0].plantBased, true);
  assert.equal(second.days[0].meals[0].stations[0].items[0].glutenFree, true);
});

test('Sodexo reparses cached dates after a parser version bump so allergens are published', async () => {
  const body = [{ name: 'LUNCH', groups: [{ name: 'Grill', items: [{
    formalName: 'Rice',
    allergens: [{ allergen: 'Soy', name: 'Soy', contains: 'true' }, { allergen: 'Milk', name: 'Milk', contains: 'true' }],
  }] }] }];
  const first = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse(body));
  const stale = structuredClone(first.state) as { provider: string; version: number; dates: Record<string, { hash: string; day: { meals: Array<{ stations: Array<{ items: Array<{ allergens?: string[] }> }> }> } }> };
  stale.version = 2;
  delete stale.dates['2026-09-06'].day.meals[0].stations[0].items[0].allergens;
  const second = await refreshSodexo('hoch', ['2026-09-06'], stale, async () => jsonResponse(body));
  assert.deepEqual(second.days[0].meals[0].stations[0].items[0].allergens, ['milk', 'soy']);
});

test('Sodexo treats an empty date as unpublished and rejects malformed data', async () => {
  const missing = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse([]));
  assert.deepEqual(missing.days, []);
  for (const response of [jsonResponse([{ name: 'Lunch', groups: [{ name: 'Grill', items: [{}] }] }]), new Response('login', { headers: { 'content-type': 'text/html' } })]) {
    const failed = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => response);
    assert.deepEqual(failed.days, []);
    assert.equal(failed.errors?.['2026-09-06'].code, 'SOURCE_FETCH_FAILED');
  }
});

function pomonaJsonp(menu: unknown): string {
  const addLabels = (value: unknown) => ({ nutrients: 'Calories (kcal)~CAL|Fat (g)~TL', ...(value as object) });
  return `/**/ menuData(${JSON.stringify({ EatecExchange: { menu: Array.isArray(menu) ? menu.map(addLabels) : addLabels(menu) } })});`;
}

const recipe = {
  '@shortName': 'Vegetable Curry', '@category': 'Expo Station', '@itemDailyComment': 'With rice',
  '@nutrients': '245.5|10|2',
  dietaryChoices: { dietaryChoice: [
    { '@id': 'Vegetarian', '#text': 'Yes' }, { '@id': 'Vegan', '#text': 'No' },
    { '@id': 'Gluten Free', '#text': 'Yes' }, { '@id': 'Halal', '#text': 'No' },
    { '@id': 'Contains Pork', '#text': 'Yes' }, { '@id': 'Organic', '#text': 'Yes' },
  ] },
  allergens: { allergen: [
    { '@id': 'Soy', '#text': 'Yes' },
    { '@id': 'Tree Nut (Walnut)', '#text': 'Yes' },
    { '@id': 'Tree Nut (Almond)', '#text': 'Yes' },
    { '@id': 'Milk', '#text': 'No' },
    { '@id': 'Egg', '#text': 'Yes' },
  ] },
};

const fraryHours = `<!doctype html><div class="dining-hours-top editorial">
  <h2>Hours</h2><div><p><strong>Frary's regular hours of operation are:</strong></p></div>
  <div><div><p><strong>Monday - Friday</strong></p><p>
    <span>Breakfast:</span> 7:30 - 10 a.m.<br>
    <span>Lunch:</span> 11 a.m. - 1:30 p.m.<br>
    <span>Continuous Service:</span> 1:30 - 4:30 p.m.<br>
    <span>Dinner:</span> 5 - 7:30 p.m.
  </p></div><div><p><strong>Saturdays &amp; Sundays (and holidays)</strong></p><p>
    <span>Continental Breakfast:</span> 7:30 - 9:30 a.m.<br>
    <span>Brunch:</span> 10:30 a.m. - 1:30 p.m.<br>
    <!-- <span>Breakfast:</span> 6 - 8 a.m.<br> -->
    <span>Continuous Service:</span> 1:30 - 4:30 p.m.<br>
    <span>Dinner:</span> 5 - 7:30 p.m.
  </p></div></div>
</div>`;

test('Pomona hours accept generic day ranges and PM starts without leaking across headings', () => {
  const hours = parsePomonaHours(`<div class="dining-hours-top">
    <p>Monday - Thursday</p><p>Dinner: 4 p.m. - 6 p.m.</p>
    <p>Winter Break</p><p>Dinner: 5 p.m. - 7 p.m.</p>
    <p>Tuesday - Saturday</p><p>Lunch: 11 a.m. - 1 p.m.</p>
    <p>Every day</p><p>Breakfast: 7 a.m. - 9 a.m.</p>
  </div>`);
  assert.deepEqual(hours?.[0], [{ name: 'Breakfast', startTime: '07:00', endTime: '09:00' }]);
  assert.deepEqual(hours?.[1], [
    { name: 'Dinner', startTime: '16:00', endTime: '18:00' },
    { name: 'Breakfast', startTime: '07:00', endTime: '09:00' },
  ]);
  assert.deepEqual(hours?.[5], [
    { name: 'Lunch', startTime: '11:00', endTime: '13:00' },
    { name: 'Breakfast', startTime: '07:00', endTime: '09:00' },
  ]);
  assert.equal(hours?.[1]?.some(service => service.startTime === '17:00'), false);
});

test('Pomona reconciles Frary weekend hours without inventing a continental menu', async () => {
  const menu = [
    { '@servedate': '20260920', '@mealperiodname': 'Breakfast', recipes: { recipe } },
    { '@servedate': '20260920', '@mealperiodname': 'Dinner', recipes: { recipe } },
  ];
  const result = await refreshPomona('frary', ['2026-09-20'], undefined, async input => {
    if (String(input).endsWith('/Frary.json')) {
      return new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(fraryHours, { headers: { 'content-type': 'text/html' } });
  });
  assert.deepEqual(result.days[0].meals.map(meal => ({
    name: meal.name,
    period: meal.period,
    startTime: meal.startTime,
    endTime: meal.endTime,
    dishes: meal.stations.flatMap(station => station.items).length,
  })), [
    { name: 'Continental Breakfast', period: 'breakfast', startTime: '07:30', endTime: '09:30', dishes: 0 },
    { name: 'Brunch', period: 'brunch', startTime: '10:30', endTime: '13:30', dishes: 1 },
    { name: 'Dinner', period: 'dinner', startTime: '17:00', endTime: '19:30', dishes: 1 },
  ]);
});

test('Pomona prefers a real brunch meal and drops feed periods outside official hours', async () => {
  const menu = [
    { '@servedate': '20260920', '@mealperiodname': 'Breakfast', recipes: { recipe: { ...recipe, '@shortName': 'Breakfast dish' } } },
    { '@servedate': '20260920', '@mealperiodname': 'Brunch', recipes: { recipe: { ...recipe, '@shortName': 'Brunch dish' } } },
    { '@servedate': '20260920', '@mealperiodname': 'Lunch', recipes: { recipe: { ...recipe, '@shortName': 'Lunch dish' } } },
    { '@servedate': '20260920', '@mealperiodname': 'Dinner', recipes: { recipe } },
  ];
  const result = await refreshPomona('frary', ['2026-09-20'], undefined, async input =>
    String(input).endsWith('/Frary.json')
      ? new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } })
      : new Response(fraryHours, { headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(result.days[0].meals.map(meal => meal.name), ['Continental Breakfast', 'Brunch', 'Dinner']);
  assert.equal(result.days[0].meals[1].stations[0].items[0].name, 'Brunch dish');
});

test('Pomona maps Breakfast to an official Brunch service even without Continental Breakfast', async () => {
  const hours = `<div class="dining-hours-top"><p>Saturday - Sunday</p><p>Brunch: 10:30 a.m. - 1 p.m.</p></div>`;
  const menu = { '@servedate': '20260920', '@mealperiodname': 'Breakfast', recipes: { recipe } };
  const result = await refreshPomona('frary', ['2026-09-20'], undefined, async input =>
    String(input).endsWith('/Frary.json')
      ? new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } })
      : new Response(hours, { headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(result.days[0].meals.map(meal => meal.name), ['Brunch']);
  assert.equal(result.days[0].meals[0].stations[0].items[0].name, 'Vegetable Curry');
});

test('Pomona fetches feed and hours concurrently', async () => {
  let hoursStarted = false;
  const menu = { '@servedate': '20260920', '@mealperiodname': 'Breakfast', recipes: { recipe } };
  await refreshPomona('frary', ['2026-09-20'], undefined, async input => {
    if (!String(input).endsWith('/Frary.json')) {
      hoursStarted = true;
      return new Response(fraryHours, { headers: { 'content-type': 'text/html' } });
    }
    await Promise.resolve();
    assert.equal(hoursStarted, true);
    return new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } });
  });
});

test('Pomona clears cached hours when the current hours page fails', async () => {
  const menu = { '@servedate': '20260920', '@mealperiodname': 'Breakfast', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-20'], undefined, async input =>
    String(input).endsWith('/Frary.json')
      ? new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json', etag: '"same"' } })
      : new Response(fraryHours, { headers: { 'content-type': 'text/html' } }));

  for (const feedStatus of [200, 304]) {
    const result = await refreshPomona('frary', ['2026-09-20'], first.state, async input => {
      if (!String(input).endsWith('/Frary.json')) return new Response('', { status: 503 });
      return feedStatus === 304
        ? new Response(null, { status: 304 })
        : new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } });
    });
    assert.deepEqual(result.days[0].meals.map(({ name, startTime, endTime }) => ({ name, startTime, endTime })), [
      { name: 'Breakfast', startTime: undefined, endTime: undefined },
    ]);
    assert.equal('hours' in result.state, false);
  }
});

test('Pomona groups records into meals and stations without dropping recipes', async () => {
  const menu = [
    { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe: [recipe, { ...recipe, '@shortName': 'Second Curry' }] } },
    { '@servedate': '20260906', '@mealperiodname': 'Dinner', '@menubulletin': '', recipes: { recipe: { ...recipe, '@category': 'Mainline' } } },
  ];
  const response = new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json', etag: '"abc"', 'last-modified': 'Sun, 06 Sep 2026 19:00:00 GMT' } });
  const result = await refreshPomona('frank', ['2026-09-06'], undefined, async input =>
    String(input).endsWith('/Frank.json') ? response : new Response('', { status: 503 }));
  assert.equal(result.days[0].meals.length, 2);
  assert.equal(result.days[0].meals[0].name, 'Lunch');
  assert.equal(result.days[0].meals[0].period, 'lunch');
  assert.equal(result.days[0].meals[1].name, 'Dinner');
  assert.equal(result.days[0].meals[1].period, 'dinner');
  assert.equal(result.days[0].meals[0].stations[0].items.length, 2);
  assert.deepEqual(result.days[0].meals[0].stations[0].items[0], {
    name: 'Vegetable Curry', description: 'With rice', vegetarian: true, vegan: false,
    glutenFree: true, halal: false, containsPork: true, calories: 245.5,
    allergens: ['egg', 'soy', 'treenut'],
  });
  assert.equal(result.state.etag, '"abc"');
});

test('Pomona only marks a date closed from an explicit closed record', async () => {
  const closed = { '@servedate': '20260906', '@mealperiodname': 'Closed', '@menubulletin': 'Closed', recipes: { closed: 'date' } };
  const result = await refreshPomona('oldenborg', ['2026-09-06', '2026-09-07'], undefined, async () => new Response(pomonaJsonp(closed), { headers: { 'content-type': 'application/json' } }));
  assert.deepEqual(result.days, [{ date: '2026-09-06', status: 'closed', meals: [] }]);
  assert.equal(result.days.some(day => day.date === '2026-09-07'), false);
});

test('Pomona conditional requests reuse verified parsed state on 304', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json', etag: '"same"', 'last-modified': 'Sun, 06 Sep 2026 19:00:00 GMT' },
  }));
  let checkedHeaders: Headers | undefined;
  const second = await refreshPomona('frary', ['2026-09-06'], first.state, async (input, init) => {
    if (!String(input).endsWith('/Frary.json')) return new Response('', { headers: { 'content-type': 'text/html' } });
    checkedHeaders = new Headers(init?.headers);
    return new Response(null, { status: 304 });
  });
  assert.equal(checkedHeaders?.get('if-none-match'), '"same"');
  assert.equal(checkedHeaders?.get('if-modified-since'), 'Sun, 06 Sep 2026 19:00:00 GMT');
  assert.deepEqual(second, first);
});

test('Pomona reparses cached feeds after a parser version bump so period is published', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json', etag: '"same"' },
  }));
  const stale = structuredClone(first.state) as { provider: string; hash: string; days: Array<{ meals: Array<{ period?: string }> }> };
  delete (stale as { version?: number }).version;
  delete stale.days[0].meals[0].period;
  const second = await refreshPomona('frary', ['2026-09-06'], stale, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(second.days[0].meals[0].period, 'lunch');
});

test('Pomona reparses cached feeds after a parser version bump so diet flags are published', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json' },
  }));
  const stale = structuredClone(first.state) as { provider: string; version: number; hash: string; days: Array<{ meals: Array<{ stations: Array<{ items: Array<{ glutenFree?: boolean }> }> }> }> };
  stale.version = 1;
  delete stale.days[0].meals[0].stations[0].items[0].glutenFree;
  const second = await refreshPomona('frary', ['2026-09-06'], stale, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(second.days[0].meals[0].stations[0].items[0].glutenFree, true);
});

test('Pomona reparses cached feeds after a parser version bump so allergens are published', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json' },
  }));
  const stale = structuredClone(first.state) as { provider: string; version: number; hash: string; days: Array<{ meals: Array<{ stations: Array<{ items: Array<{ allergens?: string[] }> }> }> }> };
  stale.version = 2;
  delete stale.days[0].meals[0].stations[0].items[0].allergens;
  const second = await refreshPomona('frary', ['2026-09-06'], stale, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json' },
  }));
  assert.deepEqual(second.days[0].meals[0].stations[0].items[0].allergens, ['egg', 'soy', 'treenut']);
});

test('Pomona refetches when a 304 cache covers only part of the requested window', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('frary', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), {
    headers: { 'content-type': 'application/json', etag: '"same"' },
  }));
  const statuses: number[] = [];
  const expanded = await refreshPomona('frary', ['2026-09-06', '2026-09-07'], first.state, async (input, init) => {
    if (!String(input).endsWith('/Frary.json')) return new Response('', { headers: { 'content-type': 'text/html' } });
    if (new Headers(init?.headers).has('if-none-match')) {
      statuses.push(304);
      return new Response(null, { status: 304 });
    }
    statuses.push(200);
    return new Response(pomonaJsonp([
      menu,
      { '@servedate': '20260907', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } },
    ]), { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(statuses, [304, 200]);
  assert.deepEqual(expanded.days.map(day => day.date), ['2026-09-06', '2026-09-07']);
});

test('Pomona refetches on 304 when cached days miss the entire requested window', async () => {
  const closed = { '@servedate': '20260503', '@mealperiodname': 'Closed', '@menubulletin': 'Closed', recipes: { closed: 'date' } };
  const september = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: { recipe } };
  const first = await refreshPomona('oldenborg', ['2026-05-03'], undefined, async () => new Response(pomonaJsonp(closed), {
    headers: { 'content-type': 'application/json', etag: '"old"' },
  }));
  const statuses: number[] = [];
  const expanded = await refreshPomona('oldenborg', ['2026-09-06'], first.state, async (_input, init) => {
    if (new Headers(init?.headers).has('if-none-match')) {
      statuses.push(304);
      return new Response(null, { status: 304 });
    }
    statuses.push(200);
    return new Response(pomonaJsonp(september), { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(statuses, [304, 200]);
  assert.deepEqual(expanded.days.map(day => day.date), ['2026-09-06']);
  assert.equal(expanded.days[0].status, 'ok');
});

test('Pomona rejects bad wrappers and recipe records instead of publishing empty menus', async () => {
  await assert.rejects(
    refreshPomona('frank', ['2026-09-06'], undefined, async () => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    /lacks EatecExchange/,
  );
  const noRecipes = { '@servedate': '20260906', '@mealperiodname': 'Lunch', '@menubulletin': '', recipes: {} };
  await assert.rejects(
    refreshPomona('frank', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(noRecipes), { headers: { 'content-type': 'application/json' } })),
    /no recipes/,
  );
});

test('Pomona unknown dietary answers remain absent and nutrition follows column labels', async () => {
  const menu = { '@servedate': '20260906', '@mealperiodname': 'Lunch', nutrients: 'Fat (g)~TL|Calories (kcal)~CAL', recipes: { recipe: {
    ...recipe, '@nutrients': '8|200', dietaryChoices: { dietaryChoice: [{ '@id': 'Vegan', '#text': 'Unknown' }] },
  } } };
  const result = await refreshPomona('frank', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } }));
  const item = result.days[0].meals[0].stations[0].items[0];
  assert.equal(item.calories, 200);
  assert.equal(item.vegan, undefined);
});

test('Pomona closed records do not hide other published meals on that date', async () => {
  const menu = [
    { '@servedate': '20260906', '@mealperiodname': 'Closed', '@menubulletin': 'Closed' },
    { '@servedate': '20260906', '@mealperiodname': 'Lunch', recipes: { recipe } },
  ];
  const result = await refreshPomona('frank', ['2026-09-06'], undefined, async () => new Response(pomonaJsonp(menu), { headers: { 'content-type': 'application/json' } }));
  assert.equal(result.days[0].status, 'ok');
  assert.equal(result.days[0].meals[0].name, 'Lunch');
  assert.equal(result.days[0].meals[0].period, 'lunch');
});

test('Sodexo keeps unknown meal names and omits period', async () => {
  const result = await refreshSodexo('hoch', ['2026-09-06'], undefined, async () => jsonResponse([{
    name: 'Snack Window',
    groups: [{ name: 'Main', items: [{ formalName: 'Rice' }] }],
  }]));
  assert.deepEqual(result.days[0].meals[0], { name: 'Snack Window', stations: [{ name: 'Main', items: [{ name: 'Rice' }] }] });
});

test('Sodexo date failures preserve other dates and never invent whitespace calories', async () => {
  const result = await refreshSodexo('hoch', ['2026-09-06', '2026-09-07'], undefined, async input => {
    if (String(input).includes('2026-09-07')) throw new Error('offline');
    return jsonResponse([{ name: 'Lunch', groups: [{ name: 'Main', items: [{ formalName: 'Rice', calories: '  ' }] }] }]);
  });
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].meals[0].stations[0].items[0].calories, undefined);
  assert.equal(result.errors?.['2026-09-07'].code, 'SOURCE_FETCH_FAILED');
});
