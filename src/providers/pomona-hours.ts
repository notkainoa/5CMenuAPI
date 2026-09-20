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
  if (fixed.includes('monday') && fixed.includes('friday')) return [1, 2, 3, 4, 5];
  if (fixed.includes('saturday') && fixed.includes('sunday')) return [6, 0];
  if (fixed.includes('sunday') && fixed.includes('thursday')) return [0, 1, 2, 3, 4];
  if (/^fridays?$/.test(fixed)) return [5];
  if (/^saturdays?$/.test(fixed)) return [6];
  if (/^sundays?$/.test(fixed)) return [0];
  return undefined;
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
  const match = /^(Continental Breakfast|Breakfast|Brunch|Lunch(?: only)?|Dinner):?\s+(1[0-2]|[1-9])(?::([0-5]\d))?\s*(a\.?m\.?)?\s*[-–]\s*(1[0-2]|[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(line);
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
    if (!days) continue;
    const nextService = service(line);
    if (!nextService) continue;
    for (const day of days) (week[day] ??= []).push(nextService);
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
    const hasContinentalAndBrunch = services.some(entry => entry.name.toLowerCase() === 'continental breakfast') &&
      services.some(entry => mealPeriod(entry.name) === 'brunch');
    const meals: Meal[] = services.map(entry => {
      const period = mealPeriod(entry.name);
      let match = -1;
      if (period === 'brunch' && hasContinentalAndBrunch) {
        match = remaining.findIndex(meal => meal.period === 'brunch' || meal.period === 'breakfast');
      } else if (!(period === 'breakfast' && hasContinentalAndBrunch)) {
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
    return { ...day, meals: [...meals, ...remaining] };
  });
}
