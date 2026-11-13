import { HALLS, type HallId, type Meal, type Snapshot, type SnapshotStore } from './types';
import { isValidDate, validTime } from './dates';
import { ALLERGEN_TOKENS } from './allergens';
import { DIET_FLAGS } from './diet';
import { MEAL_PERIODS } from './periods';

export const SNAPSHOT_KEY = 'snapshot:v1';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validMeals(value: unknown): value is Meal[] {
  return Array.isArray(value) && value.length <= 30 && value.every(meal =>
    isRecord(meal) && typeof meal.name === 'string' && meal.name.trim().length > 0 &&
    (meal.period === undefined || typeof meal.period === 'string' && (MEAL_PERIODS as readonly string[]).includes(meal.period)) &&
    [meal.startTime, meal.endTime].every(time => time === undefined || validTime(time)) &&
    Array.isArray(meal.stations) && meal.stations.length <= 200 && meal.stations.every(station =>
      isRecord(station) && typeof station.name === 'string' && station.name.trim().length > 0 &&
      Array.isArray(station.items) && station.items.length <= 2000 && station.items.every(item =>
        isRecord(item) && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 2000 &&
        (item.description === undefined || typeof item.description === 'string') &&
        [item.featured, ...DIET_FLAGS.map(flag => item[flag])].every(flag => flag === undefined || typeof flag === 'boolean') &&
        (item.calories === undefined || typeof item.calories === 'number' && Number.isFinite(item.calories) && item.calories >= 0) &&
        (item.allergens === undefined || Array.isArray(item.allergens) && item.allergens.length >= 1 &&
          item.allergens.every((entry, index) => typeof entry === 'string' && (ALLERGEN_TOKENS as readonly string[]).includes(entry) &&
            (index === 0 || entry > (item.allergens as string[])[index - 1]))))));
}
function timestamp(value: unknown): boolean {
  return value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function validStoredMenu(menu: unknown, hall: string, date: string): boolean {
  return isRecord(menu) && menu.hall === hall && menu.date === date &&
    ['ok', 'closed', 'stale', 'unavailable'].includes(String(menu.status)) && typeof menu.sourceUrl === 'string' &&
    [menu.lastCheckedAt, menu.lastSuccessfulCheckAt, menu.menuUpdatedAt].every(timestamp) &&
    (menu.status === 'unavailable' ? menu.meals === null : validMeals(menu.meals)) &&
    !(menu.status === 'closed' && Array.isArray(menu.meals) && menu.meals.length !== 0) &&
    (menu.error === undefined || isRecord(menu.error) && typeof menu.error.code === 'string' && typeof menu.error.message === 'string');
}

/**
 * Parses a stored snapshot without letting one bad entry poison the rest.
 * Returns null for a structurally broken snapshot (bad JSON, wrong version,
 * missing maps). Individual hall/date menus
 * and source states that fail validation (for example after a deploy tightens
 * a validator) are dropped and logged; everything else is kept.
 */
export function parseSnapshot(raw: string): Snapshot | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    console.warn(JSON.stringify({ event: 'snapshot_invalid', reason: 'json' }));
    return null;
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.refreshedAt !== 'string' || !timestamp(value.refreshedAt) ||
    !isRecord(value.menus) || !isRecord(value.sources)) {
    console.warn(JSON.stringify({ event: 'snapshot_invalid', reason: 'structure' }));
    return null;
  }
  const dropped: string[] = [];
  const menus: Snapshot['menus'] = {};
  for (const [date, halls] of Object.entries(value.menus)) {
    if (!isValidDate(date) || !isRecord(halls)) { dropped.push(date); continue; }
    const kept: Record<string, unknown> = {};
    for (const [hall, menu] of Object.entries(halls)) {
      if (isHall(hall) && validStoredMenu(menu, hall, date)) kept[hall] = menu;
      else dropped.push(`${date}/${hall}`);
    }
    menus[date] = kept as Snapshot['menus'][string];
  }
  const sources: Record<string, unknown> = {};
  for (const [hall, state] of Object.entries(value.sources)) {
    if (isHall(hall) && isRecord(state)) sources[hall] = state;
    else dropped.push(`sources/${hall}`);
  }
  if (dropped.length > 0) console.warn(JSON.stringify({ event: 'snapshot_entries_dropped', count: dropped.length, entries: dropped.slice(0, 50) }));
  return { version: 1, refreshedAt: value.refreshedAt, menus, sources: sources as Snapshot['sources'] };
}

function isHall(value: string): value is HallId {
  return HALLS.some(candidate => candidate.id === value);
}

/**
 * For public reads. A KV failure or a structurally broken snapshot throws
 * (the API answers 503 storage_unavailable); bad individual entries are dropped.
 */
export async function readSnapshot(store: SnapshotStore): Promise<Snapshot | null> {
  const raw = await store.get(SNAPSHOT_KEY);
  if (raw === null) return null;
  const snapshot = parseSnapshot(raw);
  if (!snapshot) throw new Error('Invalid menu snapshot');
  return snapshot;
}

/**
 * For the refresh writer. A KV failure still throws so a transient read error
 * never overwrites the only good snapshot, but a structurally broken snapshot
 * reads as no snapshot so the refresh can replace it.
 */
export async function readPreviousSnapshot(store: SnapshotStore): Promise<Snapshot | null> {
  const raw = await store.get(SNAPSHOT_KEY);
  return raw === null ? null : parseSnapshot(raw);
}
