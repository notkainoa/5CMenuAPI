import type { Meal, MenuItem, ParsedDay, RefreshHall, SourceState, Station } from '../types';
import { isValidDate } from '../dates';
import { uniqueSortedAllergens } from '../allergens';
import { withMealPeriod } from '../periods';
import { parsePomonaHours, reconcilePomonaHours, type PomonaWeek } from './pomona-hours';

const FEEDS = {
  frank: 'https://api.pomona.edu/eatec/Frank.json',
  frary: 'https://api.pomona.edu/eatec/Frary.json',
  oldenborg: 'https://api.pomona.edu/eatec/Oldenborg.json',
} as const;
const HOURS_PAGES = {
  frank: 'https://www.pomona.edu/administration/dining/menus/frank',
  frary: 'https://www.pomona.edu/administration/dining/menus/frary',
} as const;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const STATE_VERSION = 4;

type JsonRecord = Record<string, unknown>;
interface PomonaState extends SourceState {
  provider: 'pomona';
  version: typeof STATE_VERSION;
  etag?: string;
  lastModified?: string;
  hash: string;
  sourceDays: ParsedDay[];
  days: ParsedDay[];
  hours?: PomonaWeek;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOrMany(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function requiredString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Pomona returned ${label} without ${key}`);
  return value.trim();
}

function yesNo(value: unknown, id: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  for (const choice of oneOrMany(value.dietaryChoice)) {
    if (!isRecord(choice) || typeof choice['@id'] !== 'string' || typeof choice['#text'] !== 'string') continue;
    if (choice['@id'].toLowerCase() === id.toLowerCase()) {
      const answer = choice['#text'].trim().toLowerCase();
      return answer === 'yes' ? true : answer === 'no' ? false : undefined;
    }
  }
  return undefined;
}

function presentAllergens(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  const labels: string[] = [];
  for (const entry of oneOrMany(value.allergen)) {
    if (!isRecord(entry) || typeof entry['@id'] !== 'string' || typeof entry['#text'] !== 'string') continue;
    if (entry['#text'].trim().toLowerCase() !== 'yes') continue;
    labels.push(entry['@id']);
  }
  return uniqueSortedAllergens(labels);
}

function parseItem(value: unknown, calorieIndex: number): { station: string; item: MenuItem } {
  if (!isRecord(value)) throw new Error('Pomona returned a malformed recipe');
  const name = requiredString(value, '@shortName', 'a recipe');
  const station = requiredString(value, '@category', 'a recipe');
  const item: MenuItem = { name };
  const comment = value['@itemDailyComment'];
  if (typeof comment === 'string' && comment.trim()) item.description = comment.trim();
  const vegetarian = yesNo(value.dietaryChoices, 'Vegetarian');
  const vegan = yesNo(value.dietaryChoices, 'Vegan');
  if (vegetarian !== undefined) item.vegetarian = vegetarian;
  if (vegan !== undefined) item.vegan = vegan;
  const glutenFree = yesNo(value.dietaryChoices, 'Gluten Free');
  const halal = yesNo(value.dietaryChoices, 'Halal');
  const kosher = yesNo(value.dietaryChoices, 'Kosher');
  const mindful = yesNo(value.dietaryChoices, 'Mindful Mondays');
  const containsPork = yesNo(value.dietaryChoices, 'Contains Pork');
  const containsBeef = yesNo(value.dietaryChoices, 'Contains Beef');
  const containsPoultry = yesNo(value.dietaryChoices, 'Contains Poultry');
  if (glutenFree !== undefined) item.glutenFree = glutenFree;
  if (halal !== undefined) item.halal = halal;
  if (kosher !== undefined) item.kosher = kosher;
  if (mindful !== undefined) item.mindful = mindful;
  if (containsPork !== undefined) item.containsPork = containsPork;
  if (containsBeef !== undefined) item.containsBeef = containsBeef;
  if (containsPoultry !== undefined) item.containsPoultry = containsPoultry;
  const allergens = presentAllergens(value.allergens);
  if (allergens) item.allergens = allergens;
  const nutrients = value['@nutrients'];
  if (typeof nutrients === 'string' && calorieIndex >= 0) {
    const raw = nutrients.split('|')[calorieIndex]?.trim();
    const calories = Number(raw);
    if (raw && /^\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(calories)) item.calories = calories;
  }
  return { station, item };
}

function serviceDate(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error('Pomona returned an invalid service date');
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!isValidDate(date)) throw new Error('Pomona returned an invalid service date');
  return date;
}

function parseFeed(text: string): ParsedDay[] {
  const match = text.match(/^\s*\/\*\*\/\s*menuData\((.*)\);\s*$/s);
  const jsonText = match?.[1] ?? text.trim();
  let json: unknown;
  try { json = JSON.parse(jsonText); } catch { throw new Error(match ? 'Pomona returned invalid JSON' : 'Pomona returned an invalid JSONP wrapper'); }
  if (!isRecord(json) || !isRecord(json.EatecExchange)) throw new Error('Pomona response lacks EatecExchange');
  const records = oneOrMany(json.EatecExchange.menu);
  if (records.length === 0) throw new Error('Pomona response lacks menu records');

  const byDate = new Map<string, { closed: boolean; meals: Map<string, Map<string, MenuItem[]>> }>();
  for (const value of records) {
    if (!isRecord(value)) throw new Error('Pomona returned a malformed menu record');
    const date = serviceDate(requiredString(value, '@servedate', 'a menu record'));
    const mealName = requiredString(value, '@mealperiodname', 'a menu record');
    const bulletin = typeof value['@menubulletin'] === 'string' ? value['@menubulletin'].trim() : '';
    let day = byDate.get(date);
    if (!day) { day = { closed: false, meals: new Map() }; byDate.set(date, day); }
    if (mealName.toLowerCase() === 'closed' && bulletin.toLowerCase() === 'closed') {
      day.closed = true;
      continue;
    }
    if (!isRecord(value.recipes)) throw new Error('Pomona menu record lacks recipes');
    const recipes = oneOrMany(value.recipes.recipe);
    if (recipes.length === 0) throw new Error('Pomona menu record has no recipes');
    let stations = day.meals.get(mealName);
    if (!stations) { stations = new Map(); day.meals.set(mealName, stations); }
    const nutrientNames = typeof value.nutrients === 'string' ? value.nutrients.split('|') : [];
    const calorieIndex = nutrientNames.findIndex(name => /~CAL$/i.test(name.trim()));
    for (const recipe of recipes) {
      const parsed = parseItem(recipe, calorieIndex);
      const items = stations.get(parsed.station) ?? [];
      items.push(parsed.item);
      stations.set(parsed.station, items);
    }
  }

  return Array.from(byDate, ([date, day]): ParsedDay => {
    // A closed meal record must not erase other published meals on the same day.
    if (day.closed && day.meals.size === 0) return { date, status: 'closed', meals: [] };
    const meals: Meal[] = Array.from(day.meals, ([name, stationMap]) => withMealPeriod({
      name,
      stations: Array.from(stationMap, ([stationName, items]): Station => ({ name: stationName, items })),
    }));
    if (!meals.some(meal => meal.stations.some(station => station.items.length > 0))) throw new Error('Pomona day has no menu items');
    return { date, status: 'ok', meals };
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('Pomona response is too large');
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Pomona response is too large');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Pomona response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function oldState(value: SourceState | undefined): PomonaState | undefined {
  if (!isRecord(value) || value.provider !== 'pomona' || value.version !== STATE_VERSION || typeof value.hash !== 'string' ||
    !Array.isArray(value.sourceDays) || !Array.isArray(value.days)) return undefined;
  return value as unknown as PomonaState;
}

async function request(url: string, previous: PomonaState | undefined, fetcher: typeof fetch, conditional: boolean, signal: AbortSignal): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if (conditional && previous?.etag) headers.set('If-None-Match', previous.etag);
  if (conditional && previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified);
  return fetcher(url, { headers, signal });
}

async function fetchHours(hall: keyof typeof FEEDS, fetcher: typeof fetch, signal: AbortSignal): Promise<PomonaWeek | undefined> {
  if (!(hall in HOURS_PAGES)) return undefined;
  try {
    const response = await fetcher(HOURS_PAGES[hall as keyof typeof HOURS_PAGES], {
      headers: { Accept: 'text/html' },
      signal,
    });
    if (!response.ok) return undefined;
    return parsePomonaHours(await boundedText(response));
  } catch {
    return undefined;
  }
}

export const refreshPomona: RefreshHall = async (hall, dates, previous, fetcher) => {
  if (!(hall in FEEDS)) throw new Error(`Pomona does not provide ${hall}`);
  const prior = oldState(previous);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = FEEDS[hall as keyof typeof FEEDS];
    let response = await request(url, prior, fetcher, true, controller.signal);
    if (response.status === 304) {
      const covered = prior ? dates.filter(date => prior.days.some(day => day.date === date)).length : 0;
      // A shorter cached window must not hide newly requested dates behind an unchanged ETag.
      if (!prior || covered < dates.length) {
        response = await request(url, undefined, fetcher, false, controller.signal);
      } else {
        const hours = await fetchHours(hall as keyof typeof FEEDS, fetcher, controller.signal) ?? prior.hours;
        const days = reconcilePomonaHours(prior.sourceDays, hours);
        const state: PomonaState = { ...prior, days, ...(hours ? { hours } : {}) };
        return { days: days.filter(day => dates.includes(day.date)), state };
      }
    }
    if (!response.ok) throw new Error(`Pomona returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.toLowerCase();
    if (contentType && !contentType.includes('application/json') && !contentType.includes('text/javascript')) throw new Error('Pomona returned an unexpected content type');
    const text = await boundedText(response);
    const hash = await sha256(text);
    const sourceDays = prior?.hash === hash ? prior.sourceDays : parseFeed(text);
    const hours = await fetchHours(hall as keyof typeof FEEDS, fetcher, controller.signal) ?? prior?.hours;
    const allDays = reconcilePomonaHours(sourceDays, hours);
    const state: PomonaState = {
      provider: 'pomona',
      version: STATE_VERSION,
      hash,
      sourceDays,
      days: allDays,
      ...(hours ? { hours } : {}),
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
      ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified')! } : {}),
    };
    return { days: allDays.filter(day => dates.includes(day.date)), state };
  } finally {
    clearTimeout(timeout);
  }
};
