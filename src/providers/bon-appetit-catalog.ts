import type { Meal, MenuItem, Station } from '../types';
import { copyDietFlags } from '../diet';
import { mealPeriod, withMealPeriod } from '../periods';

export interface CatalogItem extends MenuItem {
  special?: unknown;
  ingredients?: string;
  hasRecipe?: boolean;
}

interface CatalogStation extends Station {
  items: CatalogItem[];
}

const HIDDEN_STATIONS = new Set([
  'breakfast toppings', 'breads, bagels and spreads', 'cold cereals', 'cold cereal', 'cereal',
  'fruits and yogurts', 'beverage', 'beverages', 'build your own sandwich',
  'toppings and condiments', 'condiments', 'deli bar', 'deli', 'omelet bar',
  'grill bread', 'grill fried side items', 'grill fried sides', 'breakfast bar',
  'pasta-express', 'pasta express',
]);

const PRESENCE_STATIONS = new Set(['salad bar']);
const JUICE_STATIONS = new Set(['juice and smoothie bar', 'juice bar']);
const COMBINED_STATIONS: Record<string, string> = { ovens2: 'ovens', 'grill special': 'grill', 'chocolate chip cookies': 'sweets' };
const ORDERED_STATIONS = [
  "chef's table", 'main plate', 'breakfast', 'breakfast @ home', 'breakfast @home', '@home', '@ home',
  'breakfast options', 'options', 'expo', 'global', 'comfort', 'grill', 'herbivore', 'oasis',
  'plant forward', 'simply oasis', 'hot cereal', 'ovens', 'sweets', 'stock pot', 'stocks',
];

const BARE_TOPPINGS = new Set([
  'spinach', 'onion', 'onions', 'lettuce', 'tomato', 'tomatoes', 'pepper', 'peppers',
  'mushroom', 'mushrooms', 'cinnamon', 'raisin', 'raisins', 'dried cranberry', 'dried cranberries',
  'cocoa powder', 'brown sugar', 'sugar brown', 'crushed red pepper', 'dried oregano', 'oregano',
  'liquid egg', 'whole egg', 'cheddar jack cheese', 'maple syrup', 'butter unsalted', 'unsalted butter',
  'pickle', 'parmesan cheese', 'red pepper flakes', 'salt', 'black pepper', 'cream cheese',
  'almond butter', 'peanut butter', 'honey', 'artichoke hearts', 'bell pepper', 'jalapeno',
  'pickled jalapeno', 'sun-dried tomatoes', 'flour tortilla', 'whipped butter', 'chocolate chips',
  'oreo crumbles',
]);

const BREAKFAST_GRILL_COMPONENTS = new Set([
  'fried egg', 'scrambled eggs', 'scrambled egg whites', 'cage-free scrambled eggs',
  'whole egg', 'liquid egg', 'cheddar jack cheese', 'flour tortilla', 'croissant',
  'italian sausage', 'pancetta', 'plant-based sausage (morningstar)', 'plant-based sausage',
]);

const GENERIC_SEASONINGS = new Set([
  'oil', 'canola oil', 'olive oil', 'salt', 'pepper', 'black pepper', 'water', 'cooking spray',
]);

const RECIPE_STAPLES = new Set([
  'flour', 'sugar', 'brown sugar', 'baking powder', 'baking soda', 'vanilla extract',
  'pure vanilla extract', 'sour cream',
]);

function canonicalStationName(name: string): string {
  return name.toLowerCase().replace(/[’‘`]/g, "'").replace(/&/g, 'and').replace(/\s+/g, ' ').replace('@ home', '@home').trim();
}

function mealKey(name: string): string {
  return mealPeriod(name) ?? name.toLowerCase().trim();
}

function shouldHideStation(canonical: string, meal: string): boolean {
  if (HIDDEN_STATIONS.has(canonical)) {
    return !(canonical === 'beverage' || canonical === 'beverages') || meal !== 'late_night';
  }
  if (/^chef's table\s*:/.test(canonical)) return true;
  return canonical === 'breakfast' && meal !== 'breakfast' && meal !== 'brunch';
}

function isFeatured(item: CatalogItem): boolean {
  return item.special === true || item.special === 1 || item.special === '1';
}

function isAlwaysOn(item: CatalogItem): boolean {
  return item.special === false || item.special === 0 || item.special === '0';
}

function featuredFlag(item: CatalogItem): boolean | undefined {
  if (isFeatured(item)) return true;
  if (isAlwaysOn(item)) return false;
  return undefined;
}

function keepJuiceSpecials(canonical: string, items: CatalogItem[]): CatalogItem[] {
  if (!JUICE_STATIONS.has(canonical)) return items;
  const featured = items.filter(isFeatured);
  return featured.length > 0 ? featured : [];
}

const SELF_SERVE = 'Self-serve';

function isPlaceholderOnly(station: Station): boolean {
  return station.items.every(item => item.name === SELF_SERVE && item.featured === undefined);
}

function keepPresenceStation(canonical: string, items: CatalogItem[]): CatalogItem[] {
  if (!PRESENCE_STATIONS.has(canonical)) return items;
  const featured = items.filter(isFeatured);
  if (featured.length > 0) return featured;
  return [{ name: SELF_SERVE }];
}

// Always-on items are the "Additional Favorites" tabs: the same long catalog
// repeats every day, so it says nothing about what is served on this date.
function dropAlwaysOn(items: CatalogItem[]): CatalogItem[] {
  return items.filter(item => !isAlwaysOn(item));
}

function isBareTopping(name: string, canonicalStation: string): boolean {
  const fixed = canonicalStationName(name).replace(/^(add|extra|real|fresh|house-made|house made)\s+/, '');
  if (BARE_TOPPINGS.has(fixed)) return true;
  return canonicalStation === 'breakfast grill' && BREAKFAST_GRILL_COMPONENTS.has(fixed);
}

function isBarHeader(name: string): boolean {
  const fixed = name.toLowerCase();
  return /\bbuild your own\b/.test(fixed) || /\b(salad bar|pasta bar|parfait bar|fruit salad bar)\b/.test(fixed);
}

function isInstruction(name: string): boolean {
  const fixed = name.toLowerCase();
  return /made (fresh )?to order/.test(fixed) || /available upon request/.test(fixed) ||
    /^live grill\b/.test(fixed) || /^toppings$/.test(fixed);
}

function isBoilerplateInstruction(text: string): boolean {
  return /^(live grill\s*-+\s*)?made (fresh )?to order$/i.test(text.trim());
}

function isCookedDishName(name: string): boolean {
  return /\b(grilled|roasted|steamed|baked|sauteed|sautéed|fried|braised|poached|smoked|charbroil|charred|seared|stuffed|glazed|marinated)\b/i.test(name);
}

function isComposedPlate(name: string, segmentCount: number): boolean {
  if (!isCookedDishName(name)) return false;
  if (segmentCount < 4) return true;
  return /\b(chicken|beef|steak|pork|turkey|fish|salmon|cod|tofu|tempeh|potato|potatoes|mashed|rice|gravy|pasta|noodles)\b/i.test(name);
}

function isComponentList(name: string): boolean {
  const segments = name.split(',').map(part => part.trim()).filter(Boolean);
  if (segments.length < 3) return false;
  const allShort = segments.every(segment => segment.length <= 50);
  if (isComposedPlate(name, segments.length)) return false;
  if (segments.length >= 4 && allShort) return true;
  return segments.length === 3 && allShort;
}

// A kitchen recipe marks a dish the hall cooks, even when its name reads as a
// comma list ("quinoa, vegetable, and white bean soup"). Topping lists typed in
// by hand have none; a recipe made only of bare toppings is still a list.
function isToppingList(item: CatalogItem): boolean {
  if (!isComponentList(item.name)) return false;
  return !item.hasRecipe || item.name.split(',').every(part => isBareTopping(part, ''));
}

function extraNoteText(item: CatalogItem): string {
  const name = item.name;
  const description = item.description ?? '';
  if (isBoilerplateInstruction(name) && description === '') return '';
  if (/^toppings$/i.test(name)) return description;
  if (isComponentList(name) || isInstruction(name) || isBareTopping(name, '')) {
    return description !== '' ? `${name}: ${description}` : name;
  }
  return description !== '' ? `${name}: ${description}` : name;
}

function textAlreadyCovered(haystack: string | undefined, needle: string): boolean {
  const hay = (haystack ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const need = needle.toLowerCase().replace(/\s+/g, ' ').trim();
  if (hay === '' || need === '') return false;
  if (hay.includes(need)) return true;
  const prefix = need.slice(0, Math.min(40, need.length));
  return prefix.length >= 20 && hay.includes(prefix);
}

function joinDescriptions(existing: string | undefined, extra: string): string | undefined {
  const current = (existing ?? '').trim();
  const addition = extra.trim();
  if (addition === '') return current === '' ? undefined : current;
  if (current === '') return addition;
  if (textAlreadyCovered(current, addition)) return current;
  return `${current}; ${addition}`;
}

function applyNotes(dishes: CatalogItem[], noteItems: CatalogItem[]): void {
  if (dishes.length < 1 || noteItems.length < 1) return;
  const notes: string[] = [];
  for (const noteItem of noteItems) {
    const note = extraNoteText(noteItem);
    if (note === '' || isBoilerplateInstruction(note)) continue;
    if (dishes.some(dish => textAlreadyCovered(dish.description, note))) continue;
    notes.push(note);
  }
  if (notes.length < 1) return;
  const joined = notes.join('; ');
  for (const dish of dishes) dish.description = joinDescriptions(dish.description, joined);
}

function foldStationExtras(items: CatalogItem[]): CatalogItem[] {
  const headerIndex = items.findIndex(item => isBarHeader(item.name));
  if (headerIndex !== -1) {
    const header = { ...items[headerIndex] };
    const notes: string[] = [];
    for (const [index, item] of items.entries()) {
      if (index === headerIndex) continue;
      const note = extraNoteText(item);
      if (note !== '' && !textAlreadyCovered(header.description, note) && !textAlreadyCovered(notes.join('; '), note)) {
        notes.push(note);
      }
    }
    if (notes.length > 0) header.description = joinDescriptions(header.description, notes.join(', '));
    return [header];
  }

  const dishes: CatalogItem[] = [];
  const pendingPrefix: CatalogItem[] = [];
  let pendingSuffix: CatalogItem[] = [];
  for (const item of items) {
    if (isInstruction(item.name) || isToppingList(item)) {
      if (dishes.length < 1) pendingPrefix.push(item);
      else pendingSuffix.push(item);
      continue;
    }
    if (pendingSuffix.length > 0 && dishes.length > 0) {
      applyNotes(dishes, pendingSuffix);
      pendingSuffix = [];
    }
    dishes.push({ ...item });
  }
  applyNotes(dishes, [...pendingPrefix, ...pendingSuffix]);
  return dishes;
}

function dropBareToppings(canonical: string, items: CatalogItem[]): CatalogItem[] {
  return items.filter(item => !isBareTopping(item.name, canonical));
}

function cleanDescription(description: string | undefined): string | undefined {
  const value = (description ?? '').replace(/\s+/g, ' ').trim();
  if (value === '') return undefined;
  if (/^\d+(\/\d+)?\s*(cup|each|fl oz|oz|tbsp|tsp)$/i.test(value)) return undefined;
  const parts = value.toLowerCase().split(',').map(part => part.replace(/^with\s+/, '').trim());
  if (parts.every(part => part === '' || GENERIC_SEASONINGS.has(part) || /cooking spray$/.test(part))) return undefined;
  return value;
}

function ingredientWordsCoveredByName(name: string, ingredient: string): boolean {
  const words = ingredient.split(/[\s-]+/).filter(word => word.length >= 3);
  return words.length > 0 && words.every(word => name.includes(word));
}

function joinList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function descriptionFromIngredients(name: string, ingredients: string | undefined): string | undefined {
  const value = (ingredients ?? '').replace(/\s+/g, ' ').trim();
  if (value === '' || value.includes('(')) return undefined;
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  const nameLower = name.toLowerCase();
  const kept: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (GENERIC_SEASONINGS.has(lower) || /cooking spray$/.test(lower)) continue;
    if (RECIPE_STAPLES.has(lower)) return undefined;
    if (/\b(\d+\s*(fl oz|oz)|rtc|curate|frozen)\b/.test(lower) || part.length > 48) continue;
    if (nameLower.includes(lower)) continue;
    const stem = lower.replace(/s$/, '');
    if (stem.length >= 3 && nameLower.includes(stem)) continue;
    if (ingredientWordsCoveredByName(nameLower, lower)) continue;
    kept.push(part);
  }
  if (kept.length < 1 || kept.length > 4 || parts.length >= 8) return undefined;
  const pretty = joinList(kept);
  return /^with\b/i.test(pretty) ? pretty : `with ${pretty}`;
}

function publicItem(item: CatalogItem): MenuItem | undefined {
  const name = item.name.trim();
  if (name === '') return undefined;
  let description = cleanDescription(item.description);
  if (description === undefined) description = descriptionFromIngredients(name, item.ingredients);
  const published: MenuItem = { name };
  if (description) published.description = description;
  copyDietFlags(item, published);
  const featured = featuredFlag(item);
  if (featured !== undefined) published.featured = featured;
  if (item.calories !== undefined) published.calories = item.calories;
  if (item.allergens && item.allergens.length > 0) published.allergens = item.allergens;
  return published;
}

function mergeStationKey(canonical: string): string {
  return COMBINED_STATIONS[canonical] ?? canonical;
}

function prettyStationName(canonical: string): string {
  return canonical.replace(/\b([a-z])/g, char => char.toUpperCase())
    .replace(/ And /g, ' and ')
    .replace(/@home/gi, '@Home')
    .replace(/@ Home/g, '@Home');
}

function stationRank(mergeKey: string): number {
  const index = ORDERED_STATIONS.indexOf(mergeKey);
  return index === -1 ? 1000 : index;
}

function refineStation(station: CatalogStation, meal: string): Station | undefined {
  const canonical = canonicalStationName(station.name);
  if (shouldHideStation(canonical, meal)) return undefined;
  let items = keepJuiceSpecials(canonical, station.items);
  items = keepPresenceStation(canonical, items);
  items = dropAlwaysOn(items);
  items = foldStationExtras(items);
  items = dropBareToppings(canonical, items);
  const published = items.map(publicItem).filter((item): item is MenuItem => item !== undefined);
  if (published.length < 1) return undefined;
  return { name: station.name, items: published };
}

function groupStations(stations: CatalogStation[], meal: string): CatalogStation[] {
  const grouped = new Map<string, CatalogStation>();
  const order: string[] = [];
  for (const station of stations) {
    const canonical = canonicalStationName(station.name);
    if (shouldHideStation(canonical, meal)) continue;
    const mergeKey = mergeStationKey(canonical);
    const existing = grouped.get(mergeKey);
    if (!existing) {
      const name = mergeKey === canonical ? station.name : prettyStationName(mergeKey);
      grouped.set(mergeKey, { name, items: station.items.map(item => ({ ...item })) });
      order.push(mergeKey);
      continue;
    }
    for (const item of station.items) {
      if (!existing.items.some(current => current.name.toLowerCase() === item.name.toLowerCase())) {
        existing.items.push({ ...item });
      }
    }
  }
  order.sort((left, right) => stationRank(left) - stationRank(right));
  return order.map(mergeKey => grouped.get(mergeKey)).filter((station): station is CatalogStation => station !== undefined);
}

/** Drop always-on topping catalogs and fold build-your-own extras into descriptions. */
export function refineBonAppetitMeals(meals: Array<Meal & { stations: CatalogStation[] }>): Meal[] {
  const refined: Meal[] = [];
  for (const meal of meals) {
    const key = mealKey(meal.name);
    const grouped = groupStations(meal.stations, key);
    const stations = grouped
      .map(station => refineStation(station, key))
      .filter((station): station is Station => station !== undefined);
    if (stations.length > 0 && !stations.every(isPlaceholderOnly)) {
      refined.push(withMealPeriod({ ...meal, stations }));
    } else if (stations.length > 0 || grouped.some(station => station.items.some(isAlwaysOn))) {
      // A listed service with only the always-on catalog or the Self-serve
      // placeholder has no dishes posted yet: keep its name and hours.
      refined.push(withMealPeriod({ ...meal, stations: [] }));
    }
  }
  return refined;
}
