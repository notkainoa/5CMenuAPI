import { californiaDate, isValidDate, supportedDates } from './dates.ts';
import { menuFor } from './menus.ts';
import { highlightsEnabled, readHighlights, withHighlights } from './highlights';
import { readSnapshot } from './storage.ts';
import { HALLS, type Env, type HallId, type HallMenu } from './types.ts';

const TIME_ZONE = 'America/Los_Angeles';
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

type Json = Record<string, unknown> | readonly unknown[];

function corsHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers': 'Content-Type, If-None-Match',
    'access-control-expose-headers': 'ETag, Cache-Control',
  });
}

function errorBody(code: string, message: string): Json {
  return { error: { code, message } };
}

function jsonResponse(body: Json, status: number, request: Request, headers = corsHeaders()): Response {
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers });
}

function errorResponse(request: Request, status: number, code: string, message: string, headers?: Headers): Response {
  return jsonResponse(errorBody(code, message), status, request, headers);
}

function californiaParts(now: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function cacheControl(now: Date, _explicitDate: boolean): string {
  // The unqualified /v1/menus cache key changes meaning at California midnight.
  // Both dated and implicit URLs expire before California midnight.

  const part = californiaParts(now);
  const currentLocalTime = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  const nextMidnight = Date.UTC(part.year, part.month - 1, part.day + 1);
  const secondsToMidnight = Math.max(0, Math.floor((nextMidnight - currentLocalTime - now.getMilliseconds()) / 1_000));
  return `public, max-age=${Math.min(60, secondsToMidnight)}, must-revalidate`;
}

async function etagFor(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `"${hex}"`;
}

function ifNoneMatchMatches(value: string | null, etag: string): boolean {
  if (!value) return false;
  return value.split(',').some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, '');
    return normalized === '*' || normalized === etag;
  });
}

async function successResponse(request: Request, body: Json, now: Date, explicitDate: boolean): Promise<Response> {
  const serialized = JSON.stringify(body);
  const etag = await etagFor(serialized);
  const headers = corsHeaders();
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', cacheControl(now, explicitDate));
  headers.set('etag', etag);

  if (ifNoneMatchMatches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : serialized, { status: 200, headers });
}

function knownRoute(pathname: string): boolean {
  return pathname === '/'
    || pathname === '/v1/halls'
    || pathname === '/v1/menus'
    || /^\/v1\/menus\/[^/]+$/.test(pathname);
}

function requestedDate(url: URL, now: Date): { date: string; explicit: boolean } | ApiInputError {
  const entries = [...url.searchParams.entries()];
  if (entries.some(([name]) => name !== 'date' && name !== 'highlights')) {
    return { code: 'unknown_query_parameter', message: 'Only date and highlights query parameters are supported.' };
  }
  if (url.searchParams.getAll('date').length > 1) {
    return { code: 'invalid_date', message: 'Supply date at most once.' };
  }

  const highlights = url.searchParams.getAll('highlights');
  if (highlights.length > 1 || highlights.some(value => value !== 'true' && value !== 'false')) {
    return { code: 'invalid_highlights', message: 'Supply highlights at most once, as true or false.' };
  }
  const date = url.searchParams.get('date');
  if (date === null) return { date: californiaDate(now), explicit: false };
  if (!isValidDate(date)) return { code: 'invalid_date', message: 'date must use YYYY-MM-DD.' };
  if (!supportedDates(now).includes(date)) {
    return { code: 'unsupported_date', message: 'date must be today through six days ahead in America/Los_Angeles.' };
  }
  return { date, explicit: true };
}

interface ApiInputError { code: string; message: string; }

function isInputError(value: { date: string; explicit: boolean } | ApiInputError): value is ApiInputError {
  return 'code' in value;
}

function canonicalHall(pathname: string): HallId | null {
  const encoded = pathname.slice('/v1/menus/'.length);
  let hall: string;
  try {
    hall = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (hall === 'mcconnel') hall = 'mcconnell';
  return HALLS.some(({ id }) => id === hall) ? hall as HallId : null;
}

function isUnavailable(menu: HallMenu): boolean {
  return menu.status === 'unavailable';
}

/** Handles the public, read-only menu API. */
export async function handleRequest(request: Request, env: Env, now = new Date()): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (method !== 'GET' && method !== 'HEAD') {
    if (knownRoute(url.pathname)) {
      const headers = corsHeaders();
      headers.set('allow', ALLOWED_METHODS);
      return errorResponse(request, 405, 'method_not_allowed', 'Use GET, HEAD, or OPTIONS.', headers);
    }
    return errorResponse(request, 404, 'not_found', 'No endpoint matches this path.');
  }

  if (url.pathname === '/') {
    if (url.search) return errorResponse(request, 400, 'unknown_query_parameter', 'This endpoint does not accept query parameters.');
    return successResponse(request, {
      name: '5C Menu API',
      links: { halls: '/v1/halls', menus: '/v1/menus', menuByHall: '/v1/menus/{hall}' },
    }, now, false);
  }

  if (url.pathname === '/v1/halls') {
    if (url.search) return errorResponse(request, 400, 'unknown_query_parameter', 'This endpoint does not accept query parameters.');
    return successResponse(request, { halls: HALLS }, now, false);
  }

  if (url.pathname !== '/v1/menus' && !/^\/v1\/menus\/[^/]+$/.test(url.pathname)) {
    return errorResponse(request, 404, 'not_found', 'No endpoint matches this path.');
  }

  const hall = url.pathname === '/v1/menus' ? null : canonicalHall(url.pathname);
  if (url.pathname !== '/v1/menus' && !hall) {
    return errorResponse(request, 404, 'hall_not_found', 'Unknown dining hall.');
  }

  const input = requestedDate(url, now);
  if (isInputError(input)) return errorResponse(request, 400, input.code, input.message);

  let snapshot;
  try {
    // All public menu responses derive from one KV read and never update it.
    snapshot = await readSnapshot(env.MENUS);
  } catch {
    return errorResponse(request, 503, 'storage_unavailable', 'Stored menu data is temporarily unavailable.');
  }

  const includeHighlights = url.searchParams.get('highlights') !== 'false';
  const records = includeHighlights && highlightsEnabled(env) && input.date === californiaDate(now) ? await readHighlights(env) : {};
  const present = async (id: HallId) => {
    const menu = menuFor(snapshot, id, input.date, now);
    return includeHighlights ? withHighlights(menu, records, env, now) : menu;
  };

  if (url.pathname === '/v1/menus') {
    const halls = await Promise.all(HALLS.map(({ id }) => present(id)));
    const body = { date: input.date, timezone: TIME_ZONE, halls };
    // Keep the documented combined shape even when every individual hall is unavailable.
    if (halls.every(isUnavailable)) return jsonResponse(body, 503, request);
    return successResponse(request, body, now, input.explicit);
  }

  // The earlier route check has already rejected an unknown hall.
  if (!hall) return errorResponse(request, 404, 'hall_not_found', 'Unknown dining hall.');
  const menu = await present(hall);
  if (isUnavailable(menu)) {
    return jsonResponse(menu as unknown as Json, 503, request);
  }
  return successResponse(request, menu as unknown as Json, now, input.explicit);
}
