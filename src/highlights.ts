import { californiaDate } from './dates';
import { isRecord } from './storage';
import { boundedText } from './providers/response';
import {
  hasItems, highlightInput, highlightPrompt, highlightSchema, indexMenu, InputTooLargeError, resolveModelOutput, validateSelections,
  type HighlightGroup, type SelectionMap,
} from './highlight-selection';
import type { Env, Fetcher, HallMenu, MenuItem } from './types';

export const HIGHLIGHTS_KEY = 'highlights:v1';
export const HIGHLIGHT_MODEL = 'openai/gpt-oss-120b';
// Bump when the prompt, schema, validation rules or saved format change. The
// version, model and prompt text are all part of the menu hash, so a bump
// invalidates every saved selection immediately.
export const PROMPT_VERSION = '9';
export const CALL_INTERVAL_MS = 65_000;
export const REQUEST_TIMEOUT_MS = 45_000;

export const HIGHLIGHT_FAILURE_REASONS = ['daily_budget_exhausted', 'attempts_exhausted', 'input_too_large', 'generation_failed'] as const;
export type HighlightFailureReason = typeof HIGHLIGHT_FAILURE_REASONS[number];

export interface SavedHighlights {
  date: string;
  menuVersion: string;
  status: 'ready' | 'pending' | 'unavailable';
  generatedAt: string | null;
  reason?: HighlightFailureReason;
  /** Meal ID → groups with public item IDs. Revalidated on every read. */
  selections: SelectionMap;
}
export type HighlightSourceItem = MenuItem & { id: string; station: string };
export type PublicHighlightGroup = HighlightGroup & { sourceItems: HighlightSourceItem[] };
export type MenuHighlights = {
  status: 'pending' | 'unavailable' | 'disabled' | 'not_applicable';
  reason?: HighlightFailureReason;
  meals: [];
} | {
  status: 'ready';
  provider: 'groq';
  model: typeof HIGHLIGHT_MODEL;
  generatedAt: string;
  menuVersion: string;
  meals: { mealIndex: number; name: string; items: HighlightSourceItem[]; groups: PublicHighlightGroup[] }[];
};
export type HighlightedMenu = HallMenu & { highlights: MenuHighlights };

export function highlightsEnabled(env: Env): boolean {
  return !!env.GROQ_API_KEY && env.HIGHLIGHTS_ENABLED !== 'false';
}

/** Content hash of everything that affects selection. Freshness timestamps and meal hours are excluded. */
export async function menuVersion(menu: HallMenu): Promise<string> {
  const meals = indexMenu(menu).map(meal => ({ id: meal.id, name: meal.name, items: meal.items.map(({ id, station, item }) => ({ id, station, ...item })) }));
  const input = JSON.stringify([HIGHLIGHT_MODEL, PROMPT_VERSION, highlightPrompt(menu.hall), menu.hall, menu.date, meals]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class HighlightGenerationError extends Error {
  constructor(message: string, readonly retryable = true, readonly retryAfterMs = CALL_INTERVAL_MS, readonly reason: HighlightFailureReason = 'generation_failed') { super(message); }
}

/** Throws HighlightGenerationError (non-retryable) when the input cannot be sent at all. */
export function checkedInput(menu: HallMenu): string {
  try { return highlightInput(menu); }
  catch (error) {
    if (error instanceof InputTooLargeError) throw new HighlightGenerationError(error.message, false, CALL_INTERVAL_MS, 'input_too_large');
    throw error;
  }
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after') ?? NaN);
  return Number.isFinite(seconds) ? Math.max(CALL_INTERVAL_MS, seconds * 1_000) : CALL_INTERVAL_MS;
}

/** One request covers every meal for the hall-day. Any thrown error means nothing usable was produced. */
export async function generateHighlights(menu: HallMenu, key: string, fetcher: Fetcher = fetch): Promise<SelectionMap> {
  const content = checkedInput(menu);
  const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: HIGHLIGHT_MODEL, reasoning_effort: 'low', max_completion_tokens: 2_000,
      messages: [{ role: 'system', content: highlightPrompt(menu.hall) }, { role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'menu_highlights', strict: true, schema: highlightSchema(menu) } },
    }),
  });
  if (!response.ok) {
    // Only inspect the error code; never log or store the provider body.
    const code = await boundedText(response, 16_000).then(text => {
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === 'string' ? parsed.error.code : undefined;
    }).catch(() => undefined);
    const status = response.status;
    // json_validate_failed is the model missing the schema, so another sample can succeed.
    const retryable = status === 429 || status >= 500 || code === 'json_validate_failed';
    throw new HighlightGenerationError(`Groq HTTP ${status}${code ? ` ${code}` : ''}`, retryable, retryAfterMs(response),
      status === 413 ? 'input_too_large' : 'generation_failed');
  }
  const body: unknown = JSON.parse(await boundedText(response, 128_000));
  if (!isRecord(body) || !Array.isArray(body.choices)) throw new Error('Invalid Groq response');
  const choice = body.choices[0];
  if (!isRecord(choice) || choice.finish_reason !== 'stop' || !isRecord(choice.message) ||
    choice.message.refusal || typeof choice.message.content !== 'string') throw new Error('Incomplete Groq response');
  const splitReasons: string[] = [];
  const groups = resolveModelOutput(JSON.parse(choice.message.content), menu, reason => splitReasons.push(reason));
  const usage = isRecord(body.usage) ? body.usage : {};
  console.info(JSON.stringify({ event: 'highlights_generated', hall: menu.hall, date: menu.date, splitGroups: splitReasons,
    promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }));
  return Object.fromEntries(Object.entries(groups).map(([mealId, list]) => [mealId, list.map(({ title, sourceIds }) => ({ title, sourceIds }))]));
}

export async function readHighlights(env: Env): Promise<Record<string, unknown>> {
  try {
    const raw = await env.MENUS.get(HIGHLIGHTS_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch { return {}; } // Optional enrichment must not take menus offline.
}

export async function withHighlights(menu: HallMenu, records: Record<string, unknown>, env: Env, now: Date): Promise<HighlightedMenu> {
  const empty = (status: Exclude<MenuHighlights['status'], 'ready'>, reason?: HighlightFailureReason): HighlightedMenu =>
    ({ ...menu, highlights: { status, ...(reason ? { reason } : {}), meals: [] } });
  if (!highlightsEnabled(env)) return empty('disabled');
  if (menu.status === 'closed' || menu.status === 'unavailable' || menu.date !== californiaDate(now) || !hasItems(menu)) return empty('not_applicable');
  const saved = records[menu.hall];
  // Check the cheap fields before hashing the menu.
  if (!isRecord(saved) || saved.date !== menu.date || saved.menuVersion !== await menuVersion(menu)) return empty('pending');
  if (saved.status === 'pending' || saved.status === 'unavailable') {
    return empty(saved.status, HIGHLIGHT_FAILURE_REASONS.find(reason => reason === saved.reason));
  }
  if (saved.status !== 'ready' || typeof saved.generatedAt !== 'string' || !Number.isFinite(Date.parse(saved.generatedAt))) return empty('unavailable');
  try {
    const groups = validateSelections(saved.selections, menu, 'id');
    return { ...menu, highlights: {
      status: 'ready', provider: 'groq', model: HIGHLIGHT_MODEL, generatedAt: saved.generatedAt, menuVersion: saved.menuVersion,
      meals: indexMenu(menu).map((meal, mealIndex) => {
        const sourceItem = (id: string): HighlightSourceItem => {
          const { station, item } = meal.items.find(entry => entry.id === id)!;
          return { id, station, ...item };
        };
        const mealGroups = groups[meal.id];
        return {
          mealIndex, name: meal.name,
          items: mealGroups.map(group => sourceItem(group.sourceIds[0])),
          groups: mealGroups.map(group => ({ ...group, sourceItems: group.sourceIds.map(sourceItem) })),
        };
      }),
    } };
  } catch { return empty('unavailable'); }
}
