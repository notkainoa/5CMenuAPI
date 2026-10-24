import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { minimalHighlightSchema, resolveMinimalOutput } from '../src/highlight-minimal';
import { validateGroupedSelections } from '../src/highlight-groups';
import { sourceHighlightTitle } from '../src/highlight-titles';
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

test('minimal schema emits only source IDs and optional-empty title with exact meal alias enums', () => {
  const schema = minimalHighlightSchema(menu);
  assert.deepEqual(schema.properties.meals.required, ['m0', 'm1', 'm2']);
  const properties = schema.properties.meals.properties;
  assert.equal(properties.m0.maxItems, 0);
  assert.equal(properties.m1.maxItems, 5);
  assert.deepEqual(properties.m1.items.required, ['sourceIds', 'title']);
  assert.equal(properties.m1.items.additionalProperties, false);
  assert.equal(properties.m1.items.properties.title.minLength, 0);
  assert.equal(properties.m1.items.properties.title.maxLength, 64);
  assert.deepEqual(properties.m1.items.properties.sourceIds.items.enum, ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(properties.m2.items.properties.sourceIds.items.enum, ['8']);
});

test('deterministic source-name singles ignore authored title and keep original menu metadata untouched', () => {
  const before = structuredClone(menu);
  const result = resolveMinimalOutput(output([one(['0'], 'Invented vegan salmon bowl'), one(['7'], 'Pasta bar')]), menu);
  assert.deepEqual(result[1].groups, [
    { title: 'beef bulgogi', kind: 'single', sourceIds: ['m1:s0:i0'], componentIds: [] },
    { title: 'Italian Pitzer Sunday', kind: 'single', sourceIds: ['m1:s1:i0'], componentIds: [] },
  ]);
  assert.equal('vegan' in result[1].groups[0], false);
  assert.equal('calories' in result[1].groups[0], false);
  assert.deepEqual(menu, before);
});

test('genuine named-dish variants allow grounded words and connectors', () => {
  const result = resolveMinimalOutput(output([one(['0', '1'], 'Chicken or beef bulgogi')]), menu);
  assert.deepEqual(result[1].groups, [{ title: 'Chicken or beef bulgogi', kind: 'variants', sourceIds: ['m1:s0:i0', 'm1:s0:i1'], componentIds: [] }]);
  for (const group of [
    one(['0', '1'], 'Beef or chicken'), one(['0', '1'], 'Beef or chicken bulgogi bowl'),
    one(['0', '1'], 'Beef or chicken bulgogi with broccoli'),
    one(['0', '2'], 'Beef bulgogi or orange tofu'), one(['3', '4'], 'Barbacoa or carne asada'),
    one(['0', '1'], ''),
  ]) assert.throws(() => resolveMinimalOutput(output([group]), menu));
});

test('generic proteins and dietary words alone cannot establish named-dish variants', () => {
  const input = structuredClone(menu);
  input.meals![1].stations[0].items[0].name = 'Grilled Chicken';
  input.meals![1].stations[0].items[1].name = 'Roasted Chicken';
  assert.throws(() => resolveMinimalOutput(output([one(['0', '1'], 'Grilled or roasted chicken')]), input), /No common named dish/);
});

test('combined dietary phrase must be explicitly supplied by every member name', () => {
  const input = structuredClone(menu);
  assert.throws(() => resolveMinimalOutput(output([one(['5', '6'], 'Allergen free chicken or vegetable pho')]), input), /Unsupported combined dietary title/);
  assert.doesNotThrow(() => resolveMinimalOutput(output([one(['5', '6'], 'Chicken or vegetable pho')]), input));
  input.meals![1].stations[0].items[6].name = 'Allergen Free Vegetable Pho';
  assert.doesNotThrow(() => resolveMinimalOutput(output([one(['5', '6'], 'Allergen-free chicken or vegetable pho')]), input));
});

test('rejects unknown keys, cross-meal IDs, ownership overlap, cardinality and coverage errors', () => {
  for (const value of [
    { meals: { m1: [], m2: [] } }, { meals: { m0: [], m1: [], m2: [], m3: [] } },
    { ...output([]), extra: true }, output([{ ...one(), kind: 'single' }]), output([{ sourceIds: ['0'] }]),
    output([one(['8'])]), output([one(['m1:s0:i0'])]), output([one(['00'])]), output([one([0])]),
    output([one(['0', '0'], 'Beef bulgogi')]), output([one(), one()]), output(Array(6).fill(one())),
    output([one([])]), output([one(['0', '1', '2', '3', '4'], 'bulgogi')]),
    { meals: { m0: [one()], m1: [], m2: [] } },
  ]) assert.throws(() => resolveMinimalOutput(value, menu));
  assert.deepEqual(resolveMinimalOutput({ meals: {} }, { ...menu, meals: null }), []);
});

test('source titles sanitize markup and controls, and shorten by Unicode codepoints at word boundaries', () => {
  const input = structuredClone(menu);
  const item = input.meals![1].stations[0].items[0];
  item.name = '<b>Chicken</b>\u0000 bulgogi';
  assert.equal(resolveMinimalOutput(output([one()]), input)[1].groups[0].title, 'Chicken bulgogi');
  item.name = 'Chicken '.repeat(10).trim();
  const shortened = resolveMinimalOutput(output([one()]), input)[1].groups[0].title;
  assert.equal(shortened, 'Chicken '.repeat(8).trim());
  item.name = '𐐀'.repeat(70);
  assert.equal([...resolveMinimalOutput(output([one()]), input)[1].groups[0].title].length, 64);
  assert.equal(item.name, '𐐀'.repeat(70));
});

test('variant title rejects nonplain text and bounds even ignored authored single titles', () => {
  for (const title of ['<b>Chicken or beef bulgogi</b>', 'Chicken or beef bulgogi\u200b', 'https://bulgogi.example', ' bulgogi', 'x'.repeat(65)]) {
    assert.throws(() => resolveMinimalOutput(output([one(['0', '1'], title)]), menu));
  }
  assert.throws(() => resolveMinimalOutput(output([one(['0'], 'x'.repeat(65))]), menu));
});

 test('deterministic sanitized and bounded source titles roundtrip through canonical grouped validation', () => {
  const input = structuredClone(menu);
  const item = input.meals![1].stations[0].items[0];
  for (const name of [
    'x'.repeat(80), '<b>Chicken</b>\u0000 bulgogi', 'Chicken: bulgogi, chef\'s choice!',
    'Chicken bulgogi https://example.test/menu', 'Chicken bulgogi example.test', 'Chicken bulgogi example.menu', '𐐀'.repeat(80),
  ]) {
    item.name = name;
    const resolved = resolveMinimalOutput(output([one(['0'], 'Fake vegan salmon')]), input);
    assert.equal(resolved[1].groups[0].title, sourceHighlightTitle(name));
    assert.deepEqual(validateGroupedSelections(resolved, input), resolved);
    const altered = structuredClone(resolved);
    altered[1].groups[0].title = 'Invented salmon';
    assert.throws(() => validateGroupedSelections(altered, input));
    assert.equal(item.name, name);
  }
  item.name = 'https://example.test/menu';
  assert.throws(() => resolveMinimalOutput(output([one()]), input), /Empty source title/);
});

 test('captured verbose meal bars retain meaningful source prefixes without incomplete choices', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/highlights/2026-10-04.json', import.meta.url), 'utf8')) as { halls: HallMenu[] };
  const frank = fixture.halls.find(hall => hall.hall === 'frank')!;
  const frary = fixture.halls.find(hall => hall.hall === 'frary')!;
  const lox = frank.meals![1].stations[7].items[0];
  const tacos = frary.meals![2].stations[1].items[0];
  const original = [lox.name, tacos.name];
  assert.equal(sourceHighlightTitle(lox.name), 'LOX AND BAGEL BAR');
  assert.equal(sourceHighlightTitle(tacos.name), 'Naan Street Tacos');
  assert.deepEqual([lox.name, tacos.name], original);
});

 test('truncated titles avoid dangling punctuation and connectors while short descriptive names remain complete', () => {
  const verbose = 'Traditional Chicken and Beef Bulgogi Dinner Offering';
  assert.equal(sourceHighlightTitle(`${verbose} or ${'choice '.repeat(10)}`), `${verbose} or choice`);
  const prefix = 'Traditional Chicken and Beef Bulgogi Dinner Offering';
  assert.equal(sourceHighlightTitle(`${prefix} / - and or ${'x'.repeat(80)}`), prefix);
  const shortNames = [
    'Chicken with basil', 'Lox and bagel bar', 'Naan tacos with chicken or tofu', 'Steak - chef choice',
    'Tofu curry', 'Beef bulgogi', 'Chicken piccata', 'Egg and cheese sandwich', 'Pasta with pesto',
    'Ravioli with tomato sauce', 'Chicken on naan', 'Turkey in gravy', 'French toast with berries',
    'Made-to-order omelet', 'Breakfast burrito', 'Biscuit with gravy', 'Pork with pineapple',
    'Salmon with herbs', 'Chickpea and potato curry', 'Mushroom marsala',
  ];
  for (const name of shortNames) assert.equal(sourceHighlightTitle(name), name);
});
