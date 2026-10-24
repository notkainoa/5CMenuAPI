import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { highlightInput, highlightSchema, MAX_INPUT_BYTES, resolveModelOutput, sourceTitle, validateSelections } from '../src/highlight-selection';
import type { HallMenu } from '../src/types';

const menu: HallMenu = {
  hall: 'mcconnell', date: '2026-10-04', status: 'ok', sourceUrl: 'https://example.test',
  lastCheckedAt: null, lastSuccessfulCheckAt: null, menuUpdatedAt: null,
  meals: [
    { name: 'Empty', stations: [] },
    { name: 'Dinner', stations: [
      { name: 'Global', items: [
        { name: 'beef bulgogi', description: 'with broccoli', calories: 300, allergens: ['soy'], containsBeef: true },
        { name: 'dak chicken bulgogi', containsPoultry: true },
        { name: 'orange tofu', vegan: true, description: 'with bulgogi sauce' },
        { name: 'barbacoa' }, { name: 'carne asada' },
        { name: 'Allergen Free Chicken Pho' }, { name: 'Vegetable Pho', description: 'allergen free broth' },
      ] },
      { name: 'Program', items: [{ name: 'Italian Pitzer Sunday' }] },
    ] },
    { name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Chicken' }] }] },
  ],
};
const output = (groups: unknown[]) => ({ meals: { m0: [], m1: groups, m2: [] } });
const one = (sourceIds: unknown[] = ['0'], title = '') => ({ sourceIds, title });
const dinner = (value: unknown, input = menu) => resolveModelOutput(value, input).m1;
/** Resolve one combined group; return the split reason, or null if it stayed combined. */
function splitReason(group: unknown, input = menu): string | null {
  const reasons: string[] = [];
  const groups = resolveModelOutput(output([group]), input, reason => reasons.push(reason)).m1;
  if (!reasons.length) { assert.equal(groups[0].kind, 'variants'); return null; }
  // A rejected combined title falls back to one source-named single per source.
  const sourceIds = (group as { sourceIds: string[] }).sourceIds;
  assert.deepEqual(groups.map(g => g.kind), sourceIds.map(() => 'single'));
  assert.deepEqual(groups.map(g => g.title), groups.map(g => sourceTitle(input.meals![1].stations[Number(g.sourceIds[0].split(':')[1].slice(1))].items[Number(g.sourceIds[0].split(':')[2].slice(1))].name)));
  return reasons[0];
}

test('schema requires every meal and limits each to its own hall-day-unique aliases', () => {
  const schema = highlightSchema(menu);
  assert.deepEqual(schema.properties.meals.required, ['m0', 'm1', 'm2']);
  const properties = schema.properties.meals.properties;
  assert.equal(properties.m0.maxItems, 0);
  assert.equal(properties.m1.maxItems, 5);
  assert.deepEqual(properties.m1.items.required, ['sourceIds', 'title']);
  assert.equal(properties.m1.items.additionalProperties, false);
  assert.deepEqual(properties.m1.items.properties.sourceIds.items.enum, ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(properties.m2.items.properties.sourceIds.items.enum, ['8']);
  const input = JSON.parse(highlightInput(menu));
  assert.deepEqual(input.meals[1].stations[1].items, [{ id: '7', name: 'Italian Pitzer Sunday' }]);
  assert.deepEqual(input.meals[2].stations[0].items, [{ id: '8', name: 'Chicken' }]);
});

test('single titles always come from the source name; model-authored single titles are ignored', () => {
  const before = structuredClone(menu);
  assert.deepEqual(dinner(output([one(['0'], 'Invented vegan salmon bowl'), one(['7'], 'Pasta bar')])), [
    { title: 'beef bulgogi', kind: 'single', sourceIds: ['m1:s0:i0'] },
    { title: 'Italian Pitzer Sunday', kind: 'single', sourceIds: ['m1:s1:i0'] },
  ]);
  assert.deepEqual(menu, before);
});

test('combined titles must be grounded in source names and share a named dish word, or they split into singles', () => {
  assert.deepEqual(dinner(output([one(['0', '1'], 'Chicken or beef bulgogi')])), [
    { title: 'Chicken or beef bulgogi', kind: 'variants', sourceIds: ['m1:s0:i0', 'm1:s0:i1'] },
  ]);
  for (const [group, error] of [
    [one(['0', '1'], 'Beef or chicken'), /No common named dish/],
    [one(['0', '1'], 'Beef or chicken bulgogi bowl'), /Ungrounded/],
    // Description words are not evidence for a title.
    [one(['0', '1'], 'Beef or chicken bulgogi with broccoli'), /Ungrounded/],
    [one(['0', '2'], 'Beef bulgogi or orange tofu'), /Ungrounded|No common named dish/],
    [one(['3', '4'], 'Barbacoa or carne asada'), /Ungrounded|No common named dish/],
    [one(['0', '1'], ''), /Invalid variant title/],
  ] as const) assert.match(splitReason(group) ?? 'kept', error);
});

test('generic proteins or cooking words alone cannot establish variants', () => {
  const input = structuredClone(menu);
  input.meals![1].stations[0].items[0].name = 'Grilled Chicken';
  input.meals![1].stations[0].items[1].name = 'Roasted Chicken';
  assert.match(splitReason(one(['0', '1'], 'Grilled or roasted chicken'), input)!, /No common named dish/);
});

test('dietary wording in a combined title must appear in every source name', () => {
  const input = structuredClone(menu);
  assert.match(splitReason(one(['5', '6'], 'Allergen free chicken or vegetable pho'), input)!, /Ungrounded|dietary/);
  assert.equal(splitReason(one(['5', '6'], 'Chicken or vegetable pho'), input), null);
  input.meals![1].stations[0].items[6].name = 'Allergen Free Vegetable Pho';
  assert.equal(splitReason(one(['5', '6'], 'Allergen-free chicken or vegetable pho'), input), null);
  const items = input.meals![1].stations[0].items;
  for (const [a, b, title] of [
    ['Vegan Pho', 'Chicken Pho', 'Vegan or chicken pho'],
    ['GF Chicken Pho', 'Beef Pho', 'GF chicken or beef pho'],
    ['Plant-Based Chicken Pho', 'Chicken Pho', 'Plant-based chicken pho'],
    ['Halal Chicken Pho', 'Beef Pho', 'Halal chicken or beef pho'],
    ['Gluten Free Chicken Pho', 'Beef Pho', 'Gluten-free chicken or beef pho'],
  ]) {
    items[5].name = a; items[6].name = b;
    assert.match(splitReason(one(['5', '6'], title), input)!, /Ungrounded|dietary/, title);
  }
});

test('rejects unknown keys, cross-meal or invented IDs, overlapping ownership, cardinality and coverage errors', () => {
  for (const value of [
    { meals: { m1: [], m2: [] } }, { meals: { m0: [], m1: [], m2: [], m3: [] } },
    { ...output([]), extra: true }, output([{ ...one(), kind: 'single' }]), output([{ sourceIds: ['0'] }]),
    output([one(['8'])]), output([one(['m1:s0:i0'])]), output([one(['00'])]), output([one([0])]),
    output([one(['0', '0'], 'Beef bulgogi')]), output([one(['0']), one(['0', '1'], 'Chicken or beef bulgogi')]),
    output(Array(6).fill(0).map((_, i) => one([String(i)]))),
    output([one([])]), output([one(['0', '1', '2', '3', '4'], 'bulgogi')]),
    { meals: { m0: [one()], m1: [], m2: [] } }, null, [], { meals: [] },
  ]) assert.throws(() => resolveModelOutput(value, menu));
  assert.deepEqual(resolveModelOutput({ meals: {} }, { ...menu, meals: null }), {});
});

test('claims carried by only some sources, symbols and emoji split instead of passing', () => {
  const input = structuredClone(menu);
  const items = input.meals![1].stations[0].items;
  for (const [a, b, title] of [
    ['chicken satay', 'beef satay', 'Chicken or beef satay 🌱'],
    ['Peanut-free chicken satay', 'beef satay', 'Peanut-free chicken or beef satay'],
    ['Chicken Pasta (G.F.)', 'beef pasta', 'G.F. chicken or beef pasta'],
    ['Meat-free chili', 'beef chili', 'Meat-free or beef chili'],
    ['Keto chicken bowl', 'beef bowl', 'Keto chicken or beef bowl'],
    ['chicken curry without nuts', 'beef curry', 'Chicken or beef curry without nuts'],
    ['Shellfish-free shrimp curry', 'chicken curry', 'Shellfish-free shrimp or chicken curry'],
  ]) {
    items[0].name = a; items[1].name = b;
    assert.ok(splitReason(one(['0', '1'], title), input), title);
  }
  items[0].name = 'Pork Banh Mi Sandwich'; items[1].name = 'Tofu Banh Mi Sandwich';
  assert.equal(splitReason(one(['0', '1'], 'Pork or tofu banh mi sandwich'), input), null);
  items[0].name = 'Halal chicken shawarma'; items[1].name = 'Halal beef shawarma';
  assert.equal(splitReason(one(['0', '1'], 'Halal chicken or beef shawarma'), input), null);
});

test('splitting respects the five-offering cap and keeps the model order', () => {
  const groups = [one(['0', '1', '3', '4'], 'Beef or carne'), one(['5']), one(['6']), one(['7'])];
  assert.deepEqual(dinner(output(groups)).map(group => group.sourceIds[0]), ['m1:s0:i0', 'm1:s0:i1', 'm1:s0:i3', 'm1:s0:i4', 'm1:s0:i5']);
  const saved = Object.fromEntries(Object.entries(resolveModelOutput(output(groups), menu)).map(([meal, list]) => [meal, list.map(({ title, sourceIds }) => ({ title, sourceIds }))]));
  // Revalidating the saved result is a fixed point.
  assert.deepEqual(validateSelections(saved, menu, 'id'), resolveModelOutput(output(groups), menu));
});

test('exact repeated dish rows collapse to one offering instead of taking two slots', () => {
  const input = structuredClone(menu);
  input.meals![1].stations[1].items.push({ name: 'BEEF  Bulgogi' });
  assert.deepEqual(dinner(output([one(['0']), one(['8'])]), input).map(group => group.sourceIds), [['m1:s0:i0']]);
});

test('long names that shorten to the same title are not collapsed; identical full names are', () => {
  const input = structuredClone(menu);
  const prefix = 'Build Your Own Burrito Bowl - choice of ';
  input.meals![1].stations[1].items = [{ name: `${prefix}chicken, carnitas, barbacoa, sofritas and more` }, { name: `${prefix}shrimp, steak, chorizo, black beans and more` }];
  const groups = dinner(output([one(['7']), one(['8'])]), input);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, groups[1].title);
});

test('saved records validate with public IDs and reject compact aliases', () => {
  const saved = { m0: [], m1: [{ title: 'Chicken or beef bulgogi', sourceIds: ['m1:s0:i0', 'm1:s0:i1'] }], m2: [] };
  assert.equal(validateSelections(saved, menu, 'id').m1[0].kind, 'variants');
  assert.throws(() => validateSelections({ m0: [], m1: [one(['0'])], m2: [] }, menu, 'id'), /belong/);
});

test('source titles strip markup, controls and URLs and shorten at word boundaries', () => {
  assert.equal(sourceTitle('<b>Chicken</b>\u0000 bulgogi'), 'Chicken bulgogi');
  assert.equal(sourceTitle('Chicken bulgogi https://example.test/menu'), 'Chicken bulgogi');
  assert.equal(sourceTitle('Chicken '.repeat(10).trim()), 'Chicken '.repeat(8).trim());
  assert.equal([...sourceTitle('𐐀'.repeat(70))].length, 64);
  assert.equal(sourceTitle(`Traditional Chicken and Beef Bulgogi Dinner Offering / - and or ${'x'.repeat(80)}`),
    'Traditional Chicken and Beef Bulgogi Dinner Offering');
  for (const name of ['Chicken with basil', 'Naan tacos with chicken or tofu', 'Steak - chef choice', 'Made-to-order omelet']) {
    assert.equal(sourceTitle(name), name);
  }
  assert.throws(() => sourceTitle('https://example.test/menu'), /Empty source title/);
  for (const title of ['<b>Chicken or beef bulgogi</b>', 'Chicken or beef bulgogi\u200b', ' Chicken or beef bulgogi', 'x'.repeat(65), 'https://bulgogi.example']) {
    assert.match(splitReason(one(['0', '1'], title))!, /Invalid variant title|Ungrounded/, title);
  }
});

test('captured verbose meal bars keep meaningful source prefixes', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/highlights/2026-10-04.json', import.meta.url), 'utf8')) as { halls: HallMenu[] };
  const frank = fixture.halls.find(hall => hall.hall === 'frank')!;
  const frary = fixture.halls.find(hall => hall.hall === 'frary')!;
  assert.equal(sourceTitle(frank.meals![1].stations[7].items[0].name), 'LOX AND BAGEL BAR');
  assert.equal(sourceTitle(frary.meals![2].stations[1].items[0].name), 'Naan Street Tacos');
});

test('captured real menus fit the input guard and resolve compact aliases to original positions', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/highlights/2026-10-02.json', import.meta.url), 'utf8')) as { halls: HallMenu[] };
  for (const hall of fixture.halls.filter(hall => hall.status === 'ok')) {
    assert.ok(new TextEncoder().encode(highlightInput(hall)).byteLength <= MAX_INPUT_BYTES, hall.hall);
  }
  const collins = fixture.halls.find(hall => hall.hall === 'collins')!;
  const input = JSON.parse(highlightInput(collins));
  const allIds = input.meals.flatMap((m: { stations: { items: { id: string }[] }[] }) => m.stations.flatMap(s => s.items.map(i => i.id)));
  assert.equal(new Set(allIds).size, allIds.length);
  const dinnerStations = input.meals[3].stations;
  const ids = [dinnerStations[0].items[0].id, dinnerStations[2].items[0].id, dinnerStations[3].items[1].id];
  const meals = Object.fromEntries(input.meals.map((meal: { id: string }) => [meal.id, meal.id === 'm3' ? ids.map(id => one([id])) : []]));
  assert.deepEqual(resolveModelOutput({ meals }, collins).m3.map(group => group.sourceIds[0]), ['m3:s0:i0', 'm3:s2:i0', 'm3:s3:i1']);
  // A breakfast alias returned under dinner is rejected, not resolved.
  meals.m3 = [one([input.meals[0].stations[0].items[0].id])];
  assert.throws(() => resolveModelOutput({ meals }, collins), /belong/);
});
