import { supportedDates } from './dates';
import { unavailableMenu } from './menus';
import { isRecord, readPreviousSnapshot, SNAPSHOT_KEY, validMeals } from './storage';
import { HALLS, type ApiError, type Env, type Fetcher, type HallId, type HallMenu, type ParsedDay, type ProviderResult, type RefreshHall, type Snapshot } from './types';

interface CheckedResult { days: Map<string, ParsedDay>; invalid: Set<string>; errors: Record<string, ApiError>; }

function validError(error: unknown): error is ApiError {
  return isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string';
}

/**
 * Validates a provider result one day at a time. Only a structurally broken
 * result throws (failing the whole hall); an invalid day fails just its date.
 */
function checkResult(result: ProviderResult, dates: string[]): CheckedResult {
  if (!isRecord(result) || !Array.isArray(result.days) || !isRecord(result.state)) throw new Error('Invalid provider result');
  if (result.errors !== undefined && !isRecord(result.errors)) throw new Error('Invalid provider errors');
  const errors: Record<string, ApiError> = {};
  const days = new Map<string, ParsedDay>();
  const invalid = new Set<string>();
  for (const [date, error] of Object.entries(result.errors ?? {})) {
    if (!dates.includes(date)) continue;
    // The provider flagged this date; a garbled flag still means "don't trust it".
    if (validError(error)) errors[date] = error;
    else invalid.add(date);
  }
  for (const day of result.days as unknown[]) {
    const date = isRecord(day) && typeof day.date === 'string' ? day.date : undefined;
    if (date === undefined || !dates.includes(date)) continue; // Not attributable to a requested date.
    if (invalid.has(date)) continue;
    // Duplicates and days that also report an error are ambiguous, so neither copy is trusted.
    if (days.has(date) || errors[date] || !validDay(day as ParsedDay)) {
      days.delete(date);
      invalid.add(date);
      continue;
    }
    days.set(date, day as ParsedDay);
  }
  return { days, invalid, errors };
}
function validDay(day: ParsedDay): boolean {
  if (!['ok', 'closed'].includes(day.status) || !validMeals(day.meals)) return false;
  // An "ok" day needs food and a "closed" day must not list any.
  const items = day.meals.flatMap(meal => meal.stations).flatMap(station => station.items);
  return day.status === 'ok' ? items.length > 0 : day.meals.length === 0;
}
function success(hall: HallId, day: ParsedDay, old: HallMenu | undefined, checkedAt: string): HallMenu {
  const changed = !old || JSON.stringify(old.meals) !== JSON.stringify(day.meals) || (old.status === 'closed') !== (day.status === 'closed') && old.status !== 'stale';
  return {
    ...unavailableMenu(hall, day.date), status: day.status, meals: day.meals,
    lastCheckedAt: checkedAt, lastSuccessfulCheckAt: checkedAt,
    menuUpdatedAt: changed ? checkedAt : old!.menuUpdatedAt ?? checkedAt,
    error: undefined,
  };
}
function failure(hall: HallId, date: string, old: HallMenu | undefined, checkedAt: string, missing: boolean, error?: ApiError): HallMenu {
  const menu = old?.date === date && old.meals !== null ? { ...old, status: 'stale' as const } : unavailableMenu(hall, date);
  return { ...menu, lastCheckedAt: checkedAt, error: error ?? {
    code: missing ? 'MENU_NOT_PUBLISHED' : 'SOURCE_FETCH_FAILED',
    message: missing ? 'The source did not publish a verified menu for this date.' : 'The menu source could not be fetched or validated.',
  } };
}

/** One scheduled writer; public requests never call this function. */
export async function refreshMenus(env: Env, refreshHall: RefreshHall, now = new Date(), fetcher: Fetcher = globalThis.fetch): Promise<Snapshot> {
  // A storage read failure must not overwrite the only good snapshot, but a
  // corrupt snapshot reads as empty so this run can replace it.
  const previous = await readPreviousSnapshot(env.MENUS);
  const dates = supportedDates(now);
  const checkedAt = now.toISOString();
  const next: Snapshot = { version: 1, refreshedAt: checkedAt, menus: Object.fromEntries(dates.map(date => [date, {}])), sources: {} };
  let cursor = 0;
  async function work(): Promise<void> {
    while (cursor < HALLS.length) {
      const hall = HALLS[cursor++].id;
      try {
        const raw = await refreshHall(hall, dates, previous?.sources[hall], fetcher);
        const result = checkResult(raw, dates);
        // A cached parse that produced an invalid day would be served again
        // from this state, so drop it and let the next run refetch.
        if (result.invalid.size === 0) next.sources[hall] = raw.state;
        else console.warn(JSON.stringify({ event: 'source_days_invalid', hall, dates: [...result.invalid] }));
        for (const date of dates) {
          const day = result.days.get(date);
          const old = previous?.menus[date]?.[hall];
          next.menus[date][hall] = day ? success(hall, day, old, checkedAt)
            : failure(hall, date, old, checkedAt, !result.invalid.has(date), result.errors[date]);
        }
      } catch (error) {
        // Do not carry this hall's source state forward: if it holds a cached
        // parse that keeps failing, reusing it would repeat the failure until
        // upstream content changed. Without it the next run refetches.
        console.warn(JSON.stringify({ event: 'source_failed', hall, message: error instanceof Error ? error.message : 'Unknown provider failure' }));
        for (const date of dates) next.menus[date][hall] = failure(hall, date, previous?.menus[date]?.[hall], checkedAt, false);
      }
    }
  }
  // At most two halls in flight; provider adapters must also bound their fetches.
  await Promise.all([work(), work()]);
  const serialized = JSON.stringify(next);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > 5 * 1024 * 1024) throw new Error('Snapshot exceeds the 5 MB application limit');
  await env.MENUS.put(SNAPSHOT_KEY, serialized);
  console.info(JSON.stringify({ event: 'refresh_complete', at: checkedAt, bytes }));
  return next;
}
