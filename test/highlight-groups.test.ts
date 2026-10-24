import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { groupedHighlightSchema, MAX_GROUP_TITLE_LENGTH, resolveGroupedOutput, validateGroupedSelections, type HighlightGroup } from '../src/highlight-groups';
import type { HallMenu } from '../src/types';

const menu: HallMenu = {
  hall: 'mcconnell', date: '2026-10-04', status: 'ok', sourceUrl: 'https://example.test',
  lastCheckedAt: null, lastSuccessfulCheckAt: null, menuUpdatedAt: null,
  meals: [
    { name: 'Empty', stations: [] },
    { name: 'Dinner', stations: [
      { name: "chef's table", items: [
        { name: 'italian pitzer sunday' }, { name: 'spaghetti pasta' }, { name: 'impossible meatballs' },
      ] },
      { name: 'global', items: [
        { name: 'beef bulgogi' }, { name: 'dak chicken bulgogi' },
        { name: 'orange tofu', description: 'Gluten free and vegan; with cilantro', vegan: true },
        { name: 'plant-based chicken strips' }, { name: 'Vegan Black Bean Burger' },
      ] },
    ] },
    { name: 'Lunch', stations: [{ name: 'Main', items: [{ name: 'Chicken' }] }] },
  ],
};
const single = (title = 'Orange tofu'): HighlightGroup => ({ title, kind: 'single', sourceIds: ['m1:s1:i2'], componentIds: [] });
const selections = (groups: unknown[]) => [{ mealId: 'm0', groups: [] }, { mealId: 'm1', groups }, { mealId: 'm2', groups: [] }];

test('schema requires every meal and uses globally unique inference aliases scoped to its meal', () => {
  const schema = groupedHighlightSchema(menu);
  assert.deepEqual(schema.properties.meals.required, ['m0', 'm1', 'm2']);
  const properties = schema.properties.meals.properties;
  assert.equal(properties.m0.maxItems, 0);
  assert.equal(properties.m1.maxItems, 5);
  assert.equal(properties.m1.items.properties.sourceIds.minItems, 1);
  assert.equal(properties.m1.items.properties.sourceIds.maxItems, 4);
  assert.equal(properties.m1.items.properties.componentIds.maxItems, 24);
  assert.deepEqual(properties.m1.items.properties.sourceIds.items.enum, ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(properties.m2.items.properties.sourceIds.items.enum, ['8']);
});

test('resolves Pitzer program and bulgogi variants without changing menu or aggregating metadata', () => {
  const before = structuredClone(menu);
  const output = resolveGroupedOutput({ meals: { m0: [], m1: [
    { title: 'Italian Pitzer Sunday', kind: 'program', sourceIds: ['0'], componentIds: ['1', '2'] },
    { title: 'Chicken or beef bulgogi', kind: 'variants', sourceIds: ['3', '4'], componentIds: [] },
    { title: 'Orange tofu with cilantro', kind: 'single', sourceIds: ['5'], componentIds: [] },
  ], m2: [] } }, menu);
  assert.deepEqual(output[1].groups[0].componentIds, ['m1:s0:i1', 'm1:s0:i2']);
  assert.deepEqual(output[1].groups[1].sourceIds, ['m1:s1:i0', 'm1:s1:i1']);
  assert.deepEqual(validateGroupedSelections(output, menu), output);
  assert.deepEqual(menu, before);
  assert.deepEqual(Object.keys(output[1].groups[2]).sort(), ['componentIds', 'kind', 'sourceIds', 'title']);
});

test('rejects missing, duplicate, invented, cross-meal and nonempty empty services', () => {
  for (const value of [
    selections([]).slice(1), [selections([])[0], selections([])[0], selections([])[2]],
    selections([{ ...single(), sourceIds: ['invented'] }]),
    selections([{ ...single(), sourceIds: ['m2:s0:i0'] }]),
    [{ mealId: 'm0', groups: [single()] }, ...selections([]).slice(1)],
    selections(Array(6).fill(single())),
  ]) assert.throws(() => validateGroupedSelections(value, menu));
  assert.throws(() => resolveGroupedOutput({ meals: { m0: [], m1: [{ ...single(), sourceIds: ['8'] }], m2: [] } }, menu));
  assert.throws(() => resolveGroupedOutput({ meals: { m0: [], m1: [] } }, menu));
  assert.throws(() => resolveGroupedOutput({ meals: { m0: [], m1: [], m2: [] }, extra: true }, menu));
});

test('rejects ownership overlap within and across program, sources and components', () => {
  const program: HighlightGroup = { title: 'Italian Pitzer Sunday', kind: 'program', sourceIds: ['m1:s0:i0'], componentIds: ['m1:s0:i1'] };
  for (const groups of [
    [{ ...program, componentIds: ['m1:s0:i0'] }],
    [{ ...program, sourceIds: ['m1:s0:i0', 'm1:s0:i0'] }],
    [{ ...program, componentIds: ['m1:s0:i1', 'm1:s0:i1'] }],
    [program, { title: 'Spaghetti pasta', kind: 'single', sourceIds: ['m1:s0:i1'], componentIds: [] }],
    [single(), single()],
  ]) assert.throws(() => validateGroupedSelections(selections(groups), menu));
});

test('enforces kind cardinality and source/component bounds', () => {
  for (const group of [
    { ...single(), kind: 'made-up' },
    { ...single(), componentIds: ['m1:s0:i1'] },
    { ...single(), sourceIds: ['m1:s1:i2', 'm1:s1:i0'] },
    { ...single(), kind: 'variants' },
    { ...single(), sourceIds: [] },
    { ...single(), kind: 'program', componentIds: Array(25).fill('m1:s0:i1') },
    { ...single(), kind: 'program', sourceIds: Array(5).fill('m1:s1:i2') },
    { ...single(), extra: true },
  ]) assert.throws(() => validateGroupedSelections(selections([group]), menu));
});

test('title grounding rejects invented food, stemming, HTML, URLs, controls and description-based safety claims', () => {
  for (const title of ['Orange tofu bowl', 'Orange tofu with salmon', 'Oranges tofu', '<b>Orange tofu</b>',
    'Orange tofu\n', 'Orange tofu\u200b', 'https://tofu.example', 'www.tofu.com', 'Orange tofu safe',
    'Gluten-free orange tofu', 'Vegan orange tofu', 'Allergen-free orange tofu', '', '   ', ' and or ',
    'Orange tofu '.repeat(6),
  ]) assert.throws(() => validateGroupedSelections(selections([single(title)]), menu), title);
  for (const [title, id] of [['Plant-based chicken strips', 'm1:s1:i3'], ['Vegan black bean burger', 'm1:s1:i4']]) {
    assert.doesNotThrow(() => validateGroupedSelections(selections([{ ...single(title), sourceIds: [id] }]), menu));
  }
});

test('normalizes case, punctuation and diacritics without inventing abbreviations', () => {
  const input = structuredClone(menu);
  input.meals![1].stations[1].items[2].name = 'Crème tofu';
  assert.doesNotThrow(() => validateGroupedSelections(selections([single('CREME tofu')]), input));
  assert.throws(() => validateGroupedSelections(selections([single('BBQ tofu')]), input));
  input.meals![1].stations[1].items[2].name = '𐐀'.repeat(MAX_GROUP_TITLE_LENGTH);
  assert.doesNotThrow(() => validateGroupedSelections(selections([single('𐐀'.repeat(MAX_GROUP_TITLE_LENGTH))]), input));
  assert.throws(() => validateGroupedSelections(selections([single('𐐀'.repeat(MAX_GROUP_TITLE_LENGTH + 1))]), input));
});

test('null menus and all-empty services preserve exact empty coverage', () => {
  assert.deepEqual(resolveGroupedOutput({ meals: {} }, { ...menu, meals: null }), []);
  assert.deepEqual(validateGroupedSelections(selections([]), menu), selections([]));
});

 test('captured Oct4 Pitzer programs and merged bulgogi retain exact canonical references', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/highlights/2026-10-04.json', import.meta.url), 'utf8')) as { halls: HallMenu[] };
  const pitzer = fixture.halls.find(hall => hall.hall === 'mcconnell')!;
  const before = structuredClone(pitzer);
  const groups: HighlightGroup[] = [
    { title: 'Italian Pitzer Sunday', kind: 'program', sourceIds: ['m1:s0:i0'], componentIds: ['m1:s0:i1', 'm1:s0:i4', 'm1:s0:i6'] },
    { title: 'Chicken or beef bulgogi', kind: 'variants', sourceIds: ['m1:s1:i1', 'm1:s1:i2'], componentIds: [] },
    { title: 'Smoked BBQ brisket', kind: 'single', sourceIds: ['m1:s2:i5'], componentIds: [] },
    { title: 'Grill slider bar', kind: 'program', sourceIds: ['m1:s3:i0'], componentIds: ['m1:s3:i1', 'm1:s3:i3'] },
    { title: 'Eggplant parmesan', kind: 'single', sourceIds: ['m1:s4:i0'], componentIds: [] },
  ];
  const selections = [{ mealId: 'm0', groups: [] }, { mealId: 'm1', groups }];
  assert.deepEqual(validateGroupedSelections(selections, pitzer), selections);
  assert.deepEqual(pitzer, before);
});

 test('preserves each explicit source-name dietary phrase without inferring claims from descriptions or flags', () => {
  const input = structuredClone(menu);
  const item = input.meals![1].stations[1].items[2];
  item.name = 'Allergen Free Chicken Pho';
  item.description = 'Gluten free and vegan; safe chicken broth';
  for (const title of ['Allergen Free Chicken Pho', 'Allergen-free chicken pho']) {
    assert.doesNotThrow(() => validateGroupedSelections(selections([single(title)]), input));
  }
  for (const title of ['Gluten-free chicken pho', 'Vegan chicken pho', 'Safe chicken pho']) {
    assert.throws(() => validateGroupedSelections(selections([single(title)]), input));
  }
  item.name = 'Gluten-Free Vegan Egg Bowl';
  assert.doesNotThrow(() => validateGroupedSelections(selections([single('Vegan gluten-free egg bowl')]), input));
  item.name = 'Gluten Chicken Pho';
  assert.throws(() => validateGroupedSelections(selections([single('Gluten-free chicken pho')]), input));
});

 test('combined dietary phrase must appear in every variant source name', () => {
  const input = structuredClone(menu);
  const items = input.meals![1].stations[1].items;
  items[0].name = 'Allergen Free Chicken Pho';
  items[1].name = 'Vegetable Pho';
  const group = { title: 'Allergen free chicken or vegetable pho', kind: 'variants', sourceIds: ['m1:s1:i0', 'm1:s1:i1'], componentIds: [] };
  assert.throws(() => validateGroupedSelections(selections([group]), input), /Unsupported dietary title/);
  items[1].name = 'Allergen Free Vegetable Pho';
  assert.doesNotThrow(() => validateGroupedSelections(selections([group]), input));
});
