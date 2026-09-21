import { mealPeriod } from '../periods';
import type { Meal, ParsedDay } from '../types';

export interface PomonaService {
  name: string;
  startTime: string;
  endTime: string;
}

export type PomonaWeek = Partial<Record<number, PomonaService[]>>;

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', quot: '"' };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity; } catch { return entity; }
  });
}

function activeHoursLines(html: string): string[] {
  const active = html.replace(/<!--[\s\S]*?-->/g, '');
  const marker = active.search(/class\s*=\s*["'][^"']*\bdining-hours-top\b[^"']*["']/i);
  if (marker < 0) return [];
  const start = active.lastIndexOf('<', marker);
  const location = active.search(/class\s*=\s*["'][^"']*\bdining-hall-location\b[^"']*["']/i);
  const section = active.slice(start < 0 ? marker : start, location > marker ? location : undefined);
  return decodeEntities(section
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function weekdays(label: string): number[] | undefined {
  const fixed = label.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/^(?:every day|daily)$/.test(fixed)) return [0, 1, 2, 3, 4, 5, 6];
  const values: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  const matches = Array.from(fixed.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/g), match => values[match[1]]);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches;
  if (matches.length > 2) return Array.from(new Set(matches));
  const days = [matches[0]];
  while (days.at(-1) !== matches[1]) days.push((days.at(-1)! + 1) % 7);
  return days;
}

function meridiem(value: string | undefined): 'am' | 'pm' | undefined {
  if (!value) return undefined;
  return value.toLowerCase().startsWith('p') ? 'pm' : 'am';
}

function clock(hour: number, minute: number, period: 'am' | 'pm'): string {
  const hour24 = hour % 12 + (period === 'pm' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function service(line: string): PomonaService | undefined {
  const match = /^(Continental Breakfast|Breakfast|Brunch|Lunch(?: only)?|Dinner):?\s+(1[0-2]|[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–]\s*(1[0-2]|[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(line);
  if (!match) return undefined;
  const name = match[1].replace(/\s+only$/i, '');
  const startHour = Number(match[2]);
  const endHour = Number(match[5]);
  const endPeriod = meridiem(match[7]);
  let startPeriod = meridiem(match[4]);
  if (!endPeriod) return undefined;
  if (!startPeriod) {
    startPeriod = endPeriod === 'am' ? 'am' : startHour === 12 ? 'pm' : startHour > endHour ? 'am' : 'pm';
  }
  return {
    name,
    startTime: clock(startHour, Number(match[3] ?? 0), startPeriod),
    endTime: clock(endHour, Number(match[6] ?? 0), endPeriod),
  };
}

export function parsePomonaHours(html: string): PomonaWeek | undefined {
  const week: PomonaWeek = {};
  let days: number[] | undefined;
  for (const line of activeHoursLines(html)) {
    const nextDays = weekdays(line);
    if (nextDays) {
      days = nextDays;
      continue;
    }
    const nextService = service(line);
    if (nextService) {
      if (days) for (const day of days) (week[day] ??= []).push(nextService);
      continue;
    }
    // Unsupported timed services (for example Continuous Service) remain in the
    // current day group. A plain heading ends it so later hours cannot leak into
    // the previous recognized range.
    if (!/\b(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)?\s*[-–]\s*(?:1[0-2]|[1-9])\b/i.test(line)) days = undefined;
  }
  return Object.keys(week).length > 0 ? week : undefined;
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function reconcilePomonaHours(days: ParsedDay[], week: PomonaWeek | undefined): ParsedDay[] {
  if (!week) return days;
  return days.map(day => {
    const services = week[dayOfWeek(day.date)];
    if (day.status !== 'ok' || !services?.length) return day;
    const remaining = [...day.meals];
    const brunchUsesBreakfast = services.some(entry => mealPeriod(entry.name) === 'brunch') &&
      !services.some(entry => mealPeriod(entry.name) === 'breakfast' && entry.name.toLowerCase() !== 'continental breakfast');
    const meals: Meal[] = services.map(entry => {
      const period = mealPeriod(entry.name);
      let match = -1;
      if (period === 'brunch') {
        match = remaining.findIndex(meal => meal.period === 'brunch');
        if (match < 0 && brunchUsesBreakfast) match = remaining.findIndex(meal => meal.period === 'breakfast');
      } else if (!(period === 'breakfast' && brunchUsesBreakfast)) {
        match = remaining.findIndex(meal => meal.period === period);
      }
      const source = match >= 0 ? remaining.splice(match, 1)[0] : undefined;
      return {
        ...(source ?? { stations: [] }),
        name: entry.name,
        ...(period ? { period } : {}),
        startTime: entry.startTime,
        endTime: entry.endTime,
      };
    });
    return { ...day, meals };
  });
}
