import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreSelections } from '../scripts/highlight-evaluation';
import { generateHighlights, highlightInput, validateSelections } from '../src/highlights';
import type { HallMenu } from '../src/types';

const fixture = JSON.parse(readFileSync('test/fixtures/highlights/2026-10-02.json', 'utf8'));
const collins: HallMenu = fixture.halls.find((m: HallMenu) => m.hall === 'collins');

test('saved bad picks expose sides and missing composed entrees in the evaluation', () => {
  const saved = fixture.halls.find((m: HallMenu) => m.hall === 'collins').highlights;
  const score = scoreSelections(collins, saved.meals.map((m: { mealIndex: number; items: { id: string }[] }) => ({
    mealId: `m${m.mealIndex}`, itemIds: m.items.map(i => i.id),
  })));
  assert.equal(score.sides, 2);
  assert.equal(score.checks, 6);
  assert.equal(score.passed, 2);
});

test('five different mains validate; six different mains fail', () => {
  const ids = ['m3:s0:i0', 'm3:s0:i2', 'm3:s1:i0', 'm3:s2:i0', 'm3:s3:i1', 'm3:s4:i0'];
  const selections = collins.meals!.map((_, m) => ({ mealId: `m${m}`, itemIds: m === 3 ? ids.slice(0, 5) : [] }));
  assert.doesNotThrow(() => validateSelections(selections, collins));
  selections[3].itemIds = ids;
  assert.throws(() => validateSelections(selections, collins), /Invalid item selection/);
});

test('compact inference IDs resolve to original positions across stations and meals', async () => {
  const input = JSON.parse(highlightInput(collins));
  const response = (ids: unknown[]) => Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ meals: { m0: [], m1: [], m2: [], m3: ids.map(id => ({ title: '', sourceIds: [id] })) } }),
  } }] });
  const dinner = input.meals[3];
  const ids = [dinner.stations[0].items[0].id, dinner.stations[1].items[0].id, dinner.stations[2].items[0].id,
    dinner.stations[3].items[1].id, dinner.stations[4].items[0].id];
  const allIds = input.meals.flatMap((m: { stations: { items: { id: string }[] }[] }) => m.stations.flatMap(s => s.items.map(i => i.id)));
  assert.equal(new Set(allIds).size, allIds.length);
  const output = await generateHighlights(collins, 'test-key', async () => response(ids));
  assert.deepEqual(output[3].itemIds, ['m3:s0:i0', 'm3:s1:i0', 'm3:s2:i0', 'm3:s3:i1', 'm3:s4:i0']);
  for (const invalid of [['9999'], ['01'], [0], [ids[0], ids[0]], [input.meals[0].stations[0].items[0].id]]) {
    await assert.rejects(generateHighlights(collins, 'test-key', async () => response(invalid)), /Invalid or overlapping minimal source/);
  }
});
