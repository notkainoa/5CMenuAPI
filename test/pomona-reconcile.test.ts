import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPomona } from '../src/providers/pomona';
import type { Fetcher, ParsedDay } from '../src/types';

// Regression tests for the Frank outage: meals the weekly hours page did not list
// were dropped, leaving days with only empty hours-only meals.

const htmlResponse = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });

const frankHours = `<div class="dining-hours-top editorial"><h2 class="font-serif" id="hours">Hours</h2><p><strong class="text-brown-300">Regular operating hours:</strong></p><p class="mb-10"><strong>Sunday – Thursdays</strong></p><p><span class="text-brown-300">Continental Breakfast:</span> 7:30 – 9:30 a.m.<br><span class="text-brown-300">Brunch:</span> 10:30 a.m. – 1:30 p.m.<br><span class="text-brown-300">Dinner:</span> 5 – 7:30 p.m.</p><p class="mb-10"><strong>Fridays</strong></p><p><span class="text-brown-300">Lunch only:</span> 12 – 1 p.m. for <strong>language table participants only</strong></p></div><div class="dining-hall-location"></div>`;

const dish = (name: string) => ({ '@shortName': name, '@category': 'Main', '@nutrients': '100' });
function frankFeed(records: Array<[string, string, string]>): string {
  const menu = records.map(([date, meal, name]) => ({ '@servedate': date, '@mealperiodname': meal, nutrients: 'Calories (kcal)~CAL', recipes: { recipe: dish(name) } }));
  return `/**/ menuData(${JSON.stringify({ EatecExchange: { menu } })});`;
}
function frankFetcher(feed: string, hours: () => Response | Promise<Response> = () => htmlResponse(frankHours)): Fetcher {
  return async input => String(input).endsWith('/Frank.json')
    ? new Response(feed, { headers: { 'content-type': 'application/json' } })
    : hours();
}
const summary = (day: ParsedDay) => day.meals.map(meal => ({
  name: meal.name, startTime: meal.startTime, endTime: meal.endTime,
  dishes: meal.stations.flatMap(station => station.items.map(item => item.name)),
}));
const itemCount = (day: ParsedDay) => day.meals.flatMap(meal => meal.stations).flatMap(station => station.items).length;

test('Frank Friday keeps the feed breakfast when hours list only lunch', async () => {
  const result = await refreshPomona('frank', ['2026-11-13'], undefined, frankFetcher(frankFeed([['20261113', 'Breakfast', 'Bagels']])));
  assert.equal(result.days.length, 1);
  assert.ok(itemCount(result.days[0]) > 0);
  assert.deepEqual(summary(result.days[0]), [
    { name: 'Breakfast', startTime: undefined, endTime: undefined, dishes: ['Bagels'] },
    { name: 'Lunch', startTime: '12:00', endTime: '13:00', dishes: [] },
  ]);
});

test('Frank Sunday keeps a feed lunch the hours page does not list', async () => {
  const result = await refreshPomona('frank', ['2026-11-15'], undefined, frankFetcher(frankFeed([
    ['20261115', 'Breakfast', 'Waffles'],
    ['20261115', 'Lunch', 'Soup'],
    ['20261115', 'Dinner', 'Pasta'],
  ])));
  assert.deepEqual(summary(result.days[0]), [
    { name: 'Continental Breakfast', startTime: '07:30', endTime: '09:30', dishes: [] },
    { name: 'Brunch', startTime: '10:30', endTime: '13:30', dishes: ['Waffles'] },
    { name: 'Lunch', startTime: undefined, endTime: undefined, dishes: ['Soup'] },
    { name: 'Dinner', startTime: '17:00', endTime: '19:30', dishes: ['Pasta'] },
  ]);
  assert.equal(result.days[0].meals[1].period, 'brunch');
});

test('Frank never publishes an all-empty day when the feed had food', async () => {
  const result = await refreshPomona('frank', ['2026-11-13', '2026-11-15', '2026-11-16'], undefined, frankFetcher(frankFeed([
    ['20261113', 'Breakfast', 'Bagels'],
    ['20261115', 'Late Snack', 'Popcorn'],
    ['20261116', 'Dinner', 'Pasta'],
  ])));
  assert.equal(result.days.length, 3);
  for (const day of result.days) assert.ok(itemCount(day) > 0, `${day.date} lost its food`);
  assert.ok(result.days[1].meals.some(meal => meal.name === 'Late Snack' && meal.startTime === undefined));
});

test('Pomona gives the hours page its own signal so a slow page cannot abort the feed', async () => {
  const signals: Record<string, AbortSignal | undefined> = {};
  const result = await refreshPomona('frank', ['2026-11-16'], undefined, async (input, init) => {
    const url = String(input);
    signals[url.endsWith('/Frank.json') ? 'feed' : 'hours'] = init?.signal ?? undefined;
    if (url.endsWith('/Frank.json')) return new Response(frankFeed([['20261116', 'Dinner', 'Pasta']]), { headers: { 'content-type': 'application/json' } });
    throw new Error('hours page down');
  });
  assert.ok(signals.feed && signals.hours);
  assert.notEqual(signals.feed, signals.hours);
  assert.equal(result.days[0].meals[0].name, 'Dinner');
});
