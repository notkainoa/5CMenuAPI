import type {
  ApiError,
  Fetcher,
  HallId,
  Meal,
  MenuItem,
  ParsedDay,
  ProviderResult,
  RefreshHall,
  SourceState,
  Station,
} from '../types';
import { boundedText } from './response';
import { validTime } from '../dates';
import { MEAL_PERIODS, withMealPeriod } from '../periods';
import { refineBonAppetitMeals, type CatalogItem } from './bon-appetit-catalog';

const STATE_VERSION = 7;
const PROVIDER = 'bon-appetit';

const CAFES = {
  collins: {
    origin: 'https://collins-cmc.cafebonappetit.com',
    slug: 'collins',
  },
  malott: {
    origin: 'https://scripps.cafebonappetit.com',
    slug: 'malott-dining-commons',
  },
  mcconnell: {
    origin: 'https://pitzer.cafebonappetit.com',
    slug: 'mcconnell-bistro',
  },
} as const satisfies Partial<Record<HallId, { origin: string; slug: string }>>;

interface CachedPage {
  url: string;
  digest: string;
  lastModified?: string;
  day: ParsedDay;
}

interface BonAppetitState extends SourceState {
  version: typeof STATE_VERSION;
  provider: typeof PROVIDER;
  hall: keyof typeof CAFES;
  pages: Record<string, CachedPage>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isServiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validMenuItem(value: unknown): value is MenuItem {
  return isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0 &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.vegan === undefined || typeof value.vegan === 'boolean') &&
    (value.vegetarian === undefined || typeof value.vegetarian === 'boolean') &&
    (value.featured === undefined || typeof value.featured === 'boolean') &&
    (value.calories === undefined || typeof value.calories === 'number' && Number.isFinite(value.calories) && value.calories >= 0);
}

function validDay(value: unknown, date: string): value is ParsedDay {
  if (!isRecord(value) || value.date !== date || !['ok', 'closed'].includes(String(value.status)) || !Array.isArray(value.meals)) return false;
  const mealsAreValid = value.meals.every(meal => isRecord(meal) && typeof meal.name === 'string' && meal.name.trim().length > 0 &&
    (meal.period === undefined || typeof meal.period === 'string' && (MEAL_PERIODS as readonly string[]).includes(meal.period)) &&
    (meal.startTime === undefined || validTime(meal.startTime)) &&
    (meal.endTime === undefined || validTime(meal.endTime)) &&
    Array.isArray(meal.stations) && meal.stations.every(station => isRecord(station) && typeof station.name === 'string' && station.name.trim().length > 0 &&
      Array.isArray(station.items) && station.items.every(validMenuItem)));
  if (!mealsAreValid) return false;
  const itemCount = (value.meals as Meal[]).reduce((sum, meal) =>
    sum + meal.stations.reduce((stationSum, station) => stationSum + station.items.length, 0), 0);
  return value.status === 'closed' ? value.meals.length === 0 : itemCount > 0;
}

function cafeUrl(hall: keyof typeof CAFES, date: string): string {
  const cafe = CAFES[hall];
  return `${cafe.origin}/cafe/${cafe.slug}/${date}/`;
}

function readPreviousState(value: SourceState | undefined, hall: keyof typeof CAFES): BonAppetitState | undefined {
  if (!isRecord(value) || value.version !== STATE_VERSION || value.provider !== PROVIDER || value.hall !== hall || !isRecord(value.pages)) return undefined;
  const pages: Record<string, CachedPage> = {};
  for (const [date, candidate] of Object.entries(value.pages)) {
    if (!isServiceDate(date) || !isRecord(candidate) || candidate.url !== cafeUrl(hall, date) ||
      typeof candidate.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(candidate.digest) ||
      (candidate.lastModified !== undefined && (typeof candidate.lastModified !== 'string' || !Number.isFinite(Date.parse(candidate.lastModified)))) ||
      !validDay(candidate.day, date)) continue;
    pages[date] = candidate as unknown as CachedPage;
  }
  return { version: STATE_VERSION, provider: PROVIDER, hall, pages };
}

function attribute(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes);
  return match?.[1] ?? match?.[2];
}

function hasClass(attributes: string, className: string): boolean {
  const classes = attribute(attributes, 'class');
  return classes !== undefined && classes.split(/\s+/).includes(className);
}

const ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  ndash: '-', mdash: '-', hellip: '...', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') return ENTITIES[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

function textContent(value: string): string {
  return decodeEntities(value.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function elementBlocks(html: string, tagName: string, className: string): Array<{ attributes: string; body: string }> {
  const tags = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
  const blocks: Array<{ attributes: string; body: string }> = [];
  let opening: RegExpExecArray | null;
  while ((opening = tags.exec(html)) !== null) {
    if (opening[0][1] === '/') continue;
    const attributes = opening[0].slice(tagName.length + 1, -1);
    if (!hasClass(attributes, className)) continue;
    const bodyStart = tags.lastIndex;
    let depth = 1;
    let closing: RegExpExecArray | null;
    while ((closing = tags.exec(html)) !== null) {
      depth += closing[0][1] === '/' ? -1 : 1;
      if (depth === 0) {
        blocks.push({ attributes, body: html.slice(bodyStart, closing.index) });
        break;
      }
    }
    if (depth !== 0) throw new Error(`Malformed Bon Appétit ${tagName} markup`);
  }
  return blocks;
}

function jsonAssignment(html: string, property: string): unknown {
  const marker = new RegExp(`\\bBamco\\.${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*`, 'g').exec(html);
  if (!marker) throw new Error(`Bon Appétit page lacks Bamco.${property}`);
  const start = marker.index + marker[0].length;
  const opener = html[start];
  if (opener !== '{' && opener !== '[') throw new Error(`Invalid Bamco.${property} assignment`);
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opener) depth += 1;
    else if (character === closer && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        throw new Error(`Invalid Bamco.${property} JSON`);
      }
    }
  }
  throw new Error(`Unterminated Bamco.${property} assignment`);
}

function calorieValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyBonAppetitIcons(item: CatalogItem, labels: Set<string>): void {
  if (labels.has('vegan')) item.vegan = true;
  if (labels.has('vegetarian')) item.vegetarian = true;
  if (labels.has('halal')) item.halal = true;
  if (labels.has('kosher')) item.kosher = true;
  if ([...labels].some(label => /\bmindful\b/.test(label))) item.mindful = true;
  for (const label of labels) {
    if (
      label === 'gluten free' || label === 'gluten-free' || label === 'gluten friendly' || label === 'gluten-friendly' ||
      label.includes('made without gluten-containing ingredients') ||
      label.includes('made without gluten containing ingredients')
    ) {
      item.glutenFree = true;
      break;
    }
  }
}

function parseItem(value: unknown): CatalogItem {
  if (!isRecord(value) || typeof value.label !== 'string') throw new Error('Bon Appétit menu item lacks a label');
  const name = textContent(value.label);
  if (!name) throw new Error('Bon Appétit menu item has an empty label');
  const item: CatalogItem = { name };
  if (typeof value.description === 'string') {
    const description = textContent(value.description);
    if (description) item.description = description;
  }
  if ('special' in value) item.special = value.special;
  if (typeof value.ingredients === 'string') {
    const ingredients = textContent(value.ingredients);
    if (ingredients) item.ingredients = ingredients;
  }

  const iconLabels = new Set<string>();
  if (isRecord(value.cor_icon)) {
    for (const icon of Object.values(value.cor_icon)) if (typeof icon === 'string') iconLabels.add(icon.trim().toLowerCase());
  }
  if (isRecord(value.ordered_cor_icon)) {
    for (const icon of Object.values(value.ordered_cor_icon)) {
      if (isRecord(icon) && typeof icon.label === 'string') iconLabels.add(icon.label.trim().toLowerCase());
    }
  }
  applyBonAppetitIcons(item, iconLabels);

  const detailedCalories = isRecord(value.nutrition_details) && isRecord(value.nutrition_details.calories)
    ? calorieValue(value.nutrition_details.calories.value) : undefined;
  const summaryCalories = isRecord(value.nutrition) ? calorieValue(value.nutrition.kcal) : undefined;
  const calories = detailedCalories ?? summaryCalories;
  if (calories !== undefined) item.calories = calories;
  return item;
}

function mealFromSection(section: { attributes: string; body: string }, items: JsonRecord): Meal {
  const nameFromAttribute = attribute(section.attributes, 'data-jump-nav-title');
  const heading = /<h2\b[^>]*class=(?:"[^"]*site-panel__daypart-panel-title[^"]*"|'[^']*site-panel__daypart-panel-title[^']*')[^>]*>([\s\S]*?)<\/h2>/i.exec(section.body)?.[1];
  const name = textContent(nameFromAttribute ?? heading ?? '');
  if (!name) throw new Error('Bon Appétit daypart lacks a name');

  const containerTag = /<div\b([^>]*)>/gi;
  let containerAttributes: string | undefined;
  let containerMatch: RegExpExecArray | null;
  while ((containerMatch = containerTag.exec(section.body)) !== null) {
    if (hasClass(containerMatch[1], 'site-panel__daypart-container')) {
      containerAttributes = containerMatch[1];
      break;
    }
  }
  if (containerAttributes === undefined) throw new Error('Bon Appétit daypart lacks its dated container');

  const meal: Meal = withMealPeriod({ name, stations: [] });
  const startTime = attribute(containerAttributes, 'data-start-time');
  const endTime = attribute(containerAttributes, 'data-end-time');
  if (startTime && validTime(startTime)) meal.startTime = startTime;
  if (endTime && validTime(endTime)) meal.endTime = endTime;

  const tags = /<(h3|div)\b([^>]*)>/gi;
  let currentStation: Station | undefined;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(section.body)) !== null) {
    const [, tagName, attributes] = tag;
    if (tagName.toLowerCase() === 'h3' && hasClass(attributes, 'site-panel__daypart-station-title')) {
      const closingIndex = section.body.indexOf('</h3>', tags.lastIndex);
      if (closingIndex === -1) throw new Error('Malformed Bon Appétit station heading');
      const stationName = textContent(section.body.slice(tags.lastIndex, closingIndex));
      if (!stationName) throw new Error('Bon Appétit station has an empty name');
      currentStation = { name: stationName, items: [] };
      meal.stations.push(currentStation);
      tags.lastIndex = closingIndex + '</h3>'.length;
    } else if (tagName.toLowerCase() === 'div' && hasClass(attributes, 'site-panel__daypart-item')) {
      if (!currentStation) throw new Error('Bon Appétit menu item appears before a station');
      const id = attribute(attributes, 'data-id');
      if (!id || !(id in items)) throw new Error(`Bon Appétit page references unknown menu item ${id ?? '(missing id)'}`);
      currentStation.items.push(parseItem(items[id]));
    }
  }
  return meal;
}

function sectionDate(section: { body: string }): string | undefined {
  const divTags = /<div\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = divTags.exec(section.body)) !== null) {
    if (hasClass(match[1], 'site-panel__daypart-container')) return attribute(match[1], 'data-end-date');
  }
  return undefined;
}

function isClosedSection(section: { attributes: string; body: string }): boolean {
  const title = attribute(section.attributes, 'data-jump-nav-title');
  const heading = /<h2\b[^>]*class=(?:"[^"]*site-panel__daypart-panel-title[^"]*"|'[^']*site-panel__daypart-panel-title[^']*')[^>]*>([\s\S]*?)<\/h2>/i.exec(section.body)?.[1];
  return /^closed(?:\s+for\s+.+)?$/i.test(textContent(title ?? heading ?? ''));
}

function twelveHourClock(hour: string, minute: string, period: string): string {
  return `${String(Number(hour) % 12 + (period.toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute}`;
}

function weekdayRangeIncludes(date: string, start: string, end: string): boolean {
  const weekdays: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const first = weekdays[start.toLowerCase()];
  const last = weekdays[end.toLowerCase()];
  if (first === undefined || last === undefined) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return first <= last ? weekday >= first && weekday <= last : weekday >= first || weekday <= last;
}

function collinsWeeklyContinental(html: string, date: string): Meal | undefined {
  for (const row of elementBlocks(html, 'li', 'day-part')) {
    const label = elementBlocks(row.body, 'span', 'pull-left')[0];
    const hours = elementBlocks(row.body, 'span', 'pull-right')[0];
    if (!label || !hours || textContent(label.body).toLowerCase() !== 'continental breakfast') continue;
    const match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)-(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*(1[0-2]|[1-9]):([0-5]\d)\s*(am|pm)\s*-\s*(1[0-2]|[1-9]):([0-5]\d)\s*(am|pm)$/i.exec(textContent(hours.body));
    if (!match || !weekdayRangeIncludes(date, match[1], match[2])) continue;
    return withMealPeriod({
      name: 'Continental Breakfast',
      startTime: twelveHourClock(match[3], match[4], match[5]),
      endTime: twelveHourClock(match[6], match[7], match[8]),
      stations: [],
    });
  }
  return undefined;
}

function collinsSpecialHours(html: string, date: string, meals: Meal[]): { meals: Meal[]; brunchSpecial: boolean } {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [year, month, day] = date.split('-').map(Number);
  const dateLabel = `${monthNames[month - 1]} ${day}`;
  const special = new Map<string, { startTime: string; endTime: string }>();
  for (const block of elementBlocks(html, 'div', 'cafe-hours-special')) {
    for (const row of elementBlocks(block.body, 'li', 'dotted-leader-container')) {
      const label = elementBlocks(row.body, 'span', 'pull-left')[0];
      const hours = elementBlocks(row.body, 'span', 'pull-right')[0];
      if (!label || !hours) continue;
      const value = textContent(hours.body);
      const match = /^(\w+ \d{1,2})(?:, (\d{4}))?, (1[0-2]|[1-9]):([0-5]\d) (am|pm) - (1[0-2]|[1-9]):([0-5]\d) (am|pm)$/i.exec(value);
      if (!match || match[1] !== dateLabel || match[2] && Number(match[2]) !== year) continue;
      const name = textContent(label.body).toLowerCase();
      if (!meals.some(meal => meal.name.toLowerCase() === name)) throw new Error('Collins special-hours meal lacks a dated menu');
      special.set(name, { startTime: twelveHourClock(match[3], match[4], match[5]), endTime: twelveHourClock(match[6], match[7], match[8]) });
    }
  }
  // Collins leaves regular weekday pantry menus in the HTML on holiday brunch
  // days. A dated brunch replaces morning service, unless explicitly listed too.
  const reconciled = meals.filter(meal => !special.has('brunch') || special.has(meal.name.toLowerCase()) ||
    !['breakfast', 'continental breakfast', 'lunch'].includes(meal.name.toLowerCase()))
    .map(meal => ({ ...meal, ...special.get(meal.name.toLowerCase()) }));
  return { meals: reconciled, brunchSpecial: special.has('brunch') };
}

function addCollinsWeeklyContinental(html: string, date: string, meals: Meal[]): Meal[] {
  if (meals.some(meal => meal.name.toLowerCase() === 'continental breakfast')) return meals;
  const continental = collinsWeeklyContinental(html, date);
  if (!continental) return meals;
  return [...meals, continental].sort((left, right) =>
    (left.startTime ?? '99:99').localeCompare(right.startTime ?? '99:99'));
}

/** Parse one dated public cafe page. A null result means that exact date was not published. */
export function parseBonAppetitPage(html: string, requestedDate: string, hall?: HallId): ParsedDay | null {
  if (!isServiceDate(requestedDate)) throw new Error('Invalid Bon Appétit service date');
  const matchingSections = elementBlocks(html, 'section', 'site-panel--daypart')
    .filter(section => sectionDate(section) === requestedDate);
  if (matchingSections.length === 0) return null;
  if (matchingSections.every(isClosedSection)) return { date: requestedDate, status: 'closed', meals: [] };

  const itemData = jsonAssignment(html, 'menu_items');
  if (!isRecord(itemData)) throw new Error('Bamco.menu_items is not an object');
  const mealSections = matchingSections.filter(section => !isClosedSection(section));
  const parsedMeals = mealSections.map(section => mealFromSection(section, itemData));
  const collins = hall === 'collins' ? collinsSpecialHours(html, requestedDate, parsedMeals) : undefined;
  const refinedMeals = refineBonAppetitMeals(collins?.meals ?? parsedMeals);
  const meals = hall === 'collins' && !collins?.brunchSpecial
    ? addCollinsWeeklyContinental(html, requestedDate, refinedMeals) : refinedMeals;
  const itemCount = meals.reduce((sum, meal) => sum + meal.stations.reduce((stationSum, station) => stationSum + station.items.length, 0), 0);
  if (itemCount === 0) throw new Error('Bon Appétit page has dated dayparts but no menu items');
  return { date: requestedDate, status: 'ok', meals };
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function validLastModified(value: string | null): string | undefined {
  return value !== null && Number.isFinite(Date.parse(value)) ? value : undefined;
}

async function fetchDate(
  hall: keyof typeof CAFES,
  date: string,
  previous: CachedPage | undefined,
  fetcher: Fetcher,
): Promise<CachedPage | null> {
  const url = cafeUrl(hall, date);
  const headers = new Headers({ accept: 'text/html,application/xhtml+xml' });
  if (previous?.lastModified) headers.set('if-modified-since', previous.lastModified);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, { headers, signal: controller.signal });
    if (response.status === 304) {
      if (!previous) throw new Error(`Bon Appétit returned 304 without a cached menu for ${date}`);
      return previous;
    }
    if (!response.ok) throw new Error(`Bon Appétit returned HTTP ${response.status} for ${date}`);
    const contentType = response.headers.get('content-type');
    if (contentType !== null && !contentType.toLowerCase().includes('text/html')) {
      throw new Error(`Bon Appétit returned non-HTML content for ${date}`);
    }
    const html = await boundedText(response, 4 * 1024 * 1024);
    const inputDigest = await digest(html);
    if (previous?.digest === inputDigest) return previous;
    const day = parseBonAppetitPage(html, date, hall);
    if (!day) return null;
    const lastModified = validLastModified(response.headers.get('last-modified'));
    return { url, digest: inputDigest, ...(lastModified ? { lastModified } : {}), day };
  } finally { clearTimeout(timeout); }
}

export const refreshBonAppetit: RefreshHall = async (hall, dates, previous, fetcher): Promise<ProviderResult> => {
  if (!(hall in CAFES)) throw new Error(`Hall ${hall} is not served by Bon Appétit`);
  const bonAppetitHall = hall as keyof typeof CAFES;
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.some(date => !isServiceDate(date))) throw new Error('Invalid Bon Appétit service date');
  const oldState = readPreviousState(previous, bonAppetitHall);
  const errors: Record<string, ApiError> = {};
  const fetched = await Promise.all(uniqueDates.map(async date => {
    try {
      return { page: await fetchDate(bonAppetitHall, date, oldState?.pages[date], fetcher), publish: true };
    } catch {
      // Keep the last validated input state for conditional recovery, but do not
      // report its parsed day as a successful check for this run.
      errors[date] = {
        code: 'SOURCE_FETCH_FAILED',
        message: 'The menu source could not be fetched or validated.',
      };
      return { page: oldState?.pages[date] ?? null, publish: false };
    }
  }));
  const pages: Record<string, CachedPage> = {};
  const days: ParsedDay[] = [];
  for (let index = 0; index < uniqueDates.length; index += 1) {
    const { page, publish } = fetched[index];
    if (!page) continue;
    pages[uniqueDates[index]] = page;
    if (publish) days.push(page.day);
  }
  const state: BonAppetitState = { version: STATE_VERSION, provider: PROVIDER, hall: bonAppetitHall, pages };
  return { days, state, ...(Object.keys(errors).length > 0 ? { errors } : {}) };
};
