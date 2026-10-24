import { californiaDate } from './dates';
import { isRecord } from './storage';
import { boundedText } from './providers/response';
import type { Env, Fetcher, HallMenu, Meal, MenuItem } from './types';
import { MAX_HIGHLIGHTS_PER_MEAL } from './highlight-policy';
import { minimalHighlightPrompt } from './highlight-minimal-policy';
import { minimalHighlightSchema, resolveMinimalOutput } from './highlight-minimal';
import { validateGroupedSelections, type HighlightGroup } from './highlight-groups';
export { MAX_HIGHLIGHTS_PER_MEAL } from './highlight-policy';

export const HIGHLIGHTS_KEY = 'highlights:v1';
export const HIGHLIGHT_MODEL = 'openai/gpt-oss-120b';
export const PROMPT_VERSION = '8';
export const CALL_INTERVAL_MS = 65_000;

export const HIGHLIGHT_FAILURE_REASONS = ['daily_budget_exhausted', 'attempts_exhausted', 'input_too_large', 'generation_failed'] as const;
export type HighlightFailureReason = typeof HIGHLIGHT_FAILURE_REASONS[number];

export interface Selection { mealId: string; itemIds: string[]; groups?: HighlightGroup[]; }
export interface SavedHighlights {
  date: string;
  menuVersion: string;
  status: 'ready' | 'pending' | 'unavailable';
  generatedAt: string | null;
  reason?: HighlightFailureReason;
  selections: Selection[];
}
export type HighlightSourceItem = MenuItem & { id: string; station: string };
export type PublicHighlightGroup = HighlightGroup & { sourceItems: HighlightSourceItem[]; componentItems: HighlightSourceItem[] };
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

function indexedMeals(meals: Meal[]) {
  return meals.map((meal, m) => ({
    id: `m${m}`, name: meal.name,
    items: meal.stations.flatMap((station, s) => station.items.map((item, i) => ({
      id: `m${m}:s${s}:i${i}`, station: station.name, ...item,
    }))),
  }));
}

export async function menuVersion(menu: HallMenu): Promise<string> {
  const input = JSON.stringify([HIGHLIGHT_MODEL, PROMPT_VERSION, minimalHighlightPrompt(menu.hall), menu.hall, menu.date, indexedMeals(menu.meals ?? [])]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateSelections(value: unknown, menu: HallMenu): Selection[] {
  const meals = indexedMeals(menu.meals ?? []);
  if (!Array.isArray(value) || value.length !== meals.length) throw new Error('Invalid meal selections');
  const seen = new Set<string>();
  const selections = value.map(selection => {
    if (!isRecord(selection) || typeof selection.mealId !== 'string' || seen.has(selection.mealId)) throw new Error('Invalid meal ID');
    seen.add(selection.mealId);
    const meal = meals.find(meal => meal.id === selection.mealId);
    if (!meal || !Array.isArray(selection.itemIds) || selection.itemIds.length > MAX_HIGHLIGHTS_PER_MEAL ||
      new Set(selection.itemIds).size !== selection.itemIds.length ||
      selection.itemIds.some(id => typeof id !== 'string' || !meal.items.some(item => item.id === id))) {
      throw new Error('Invalid item selection');
    }
    return { mealId: selection.mealId, itemIds: selection.itemIds as string[],
      ...(selection.groups !== undefined ? { groups: selection.groups } : {}) };
  });
  if (selections.some(selection => selection.groups !== undefined)) {
    const grouped = validateGroupedSelections(selections.map(selection => ({
      mealId: selection.mealId, groups: selection.groups !== undefined ? selection.groups : [],
    })), menu);
    // Saved variant groups must meet the same source-name and common-dish
    // checks as newly resolved minimal output. Programs retain their canonical
    // component metadata for compatibility with previously saved groups.
    const aliases = new Map(meals.flatMap(meal => meal.items).map((item, index) => [item.id, String(index)]));
    resolveMinimalOutput({ meals: Object.fromEntries(grouped.map(meal => [meal.mealId,
      meal.groups.filter(group => group.kind === 'variants').map(group => ({
        title: group.title, sourceIds: group.sourceIds.map(id => aliases.get(id)!),
      })),
    ])) }, menu);
    return selections.map(selection => {
      if (selection.groups === undefined) return { mealId: selection.mealId, itemIds: [...selection.itemIds] };
      const groups = grouped.find(meal => meal.mealId === selection.mealId)!.groups;
      if (groups.length !== selection.itemIds.length || groups.some((group, index) => group.sourceIds[0] !== selection.itemIds[index])) {
        throw new Error('Invalid group anchor alignment');
      }
      return { mealId: selection.mealId, itemIds: [...selection.itemIds], groups };
    });
  }
  return selections.map(selection => ({ mealId: selection.mealId, itemIds: [...selection.itemIds] }));
}

export class HighlightGenerationError extends Error {
  constructor(message: string, readonly retryable = true, readonly retryAfterMs = CALL_INTERVAL_MS, readonly reason: HighlightFailureReason = 'generation_failed') { super(message); }
}

export function highlightInput(menu: HallMenu): string {
  // Group station names once and send selection context rather than nutrition
  // metadata. Short IDs are unique across the hall-day; display data and public IDs are
  // always resolved from the full original menu.
  let itemIndex = 0;
  const meals = (menu.meals ?? []).map((meal, m) => {
    return {
      id: `m${m}`, name: meal.name,
      stations: meal.stations.map(station => ({
        name: station.name,
        items: station.items.map(item => ({
          id: String(itemIndex++), name: item.name,
          ...Object.fromEntries((['description', 'vegan', 'vegetarian', 'plantBased', 'featured'] as const)
            .filter(field => item[field] !== undefined).map(field => [field, item[field]])),
        })),
      })),
    };
  });
  const content = JSON.stringify({ hall: menu.hall, date: menu.date, meals });
  // Bound requests before sending them. This is a payload guard, not a token count.
  if (new TextEncoder().encode(content).byteLength > 24_000) {
    throw new HighlightGenerationError('Menu exceeds highlight input limit', false, CALL_INTERVAL_MS, 'input_too_large');
  }
  return content;
}

export async function generateHighlights(menu: HallMenu, key: string, fetcher: Fetcher = fetch): Promise<Selection[]> {
  const content = highlightInput(menu);
  const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: HIGHLIGHT_MODEL, reasoning_effort: 'low', max_completion_tokens: 2_000,
      messages: [{ role: 'system', content: minimalHighlightPrompt(menu.hall) }, { role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: {
        name: 'menu_highlights', strict: true,
        schema: minimalHighlightSchema(menu),
      } },
    }),
  });
  if (!response.ok) {
    const delay = Number(response.headers.get('retry-after')) * 1_000;
    await response.body?.cancel();
    throw new HighlightGenerationError(`Groq HTTP ${response.status}`, response.status === 429 || response.status >= 500,
      Number.isFinite(delay) ? Math.max(CALL_INTERVAL_MS, delay) : CALL_INTERVAL_MS);
  }
  const body: unknown = JSON.parse(await boundedText(response, 128_000));
  if (!isRecord(body) || !Array.isArray(body.choices)) throw new Error('Invalid Groq response');
  const choice = body.choices[0];
  if (!isRecord(choice) || choice.finish_reason !== 'stop' || !isRecord(choice.message) ||
    choice.message.refusal || typeof choice.message.content !== 'string') throw new Error('Incomplete Groq response');
  const result: unknown = JSON.parse(choice.message.content);
  // Compact inference IDs resolve only within their supplied meal. Keep one
  // original source anchor per offering for clients using the legacy items list.
  const selections = validateSelections(resolveMinimalOutput(result, menu).map(selection => ({
    mealId: selection.mealId, groups: selection.groups,
    itemIds: selection.groups.map(group => group.sourceIds[0]),
  })), menu);
  const usage = isRecord(body.usage) ? body.usage : {};
  console.info(JSON.stringify({ event: 'highlights_generated', hall: menu.hall, date: menu.date,
    promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens }));
  return selections;
}

export async function readHighlights(env: Env): Promise<Record<string, unknown>> {
  try {
    const raw = await env.MENUS.get(HIGHLIGHTS_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch { return {}; } // Optional enrichment must not take menus offline.
}

export async function withHighlights(menu: HallMenu, records: Record<string, unknown>, env: Env, now: Date): Promise<HighlightedMenu> {
  const empty = (status: Exclude<MenuHighlights['status'], 'ready'>, reason?: HighlightFailureReason): HighlightedMenu => ({ ...menu, highlights: { status, ...(reason ? { reason } : {}), meals: [] } });
  if (!highlightsEnabled(env)) return empty('disabled');
  if (menu.status === 'closed' || menu.status === 'unavailable' || menu.date !== californiaDate(now)) return empty('not_applicable');
  const version = await menuVersion(menu);
  const saved = records[menu.hall];
  if (!isRecord(saved) || saved.date !== menu.date || saved.menuVersion !== version) return empty('pending');
  if (saved.status === 'pending' || saved.status === 'unavailable') {
    const reason = HIGHLIGHT_FAILURE_REASONS.find(reason => reason === saved.reason);
    return empty(saved.status, reason);
  }
  if (saved.status !== 'ready' || typeof saved.generatedAt !== 'string' || !Number.isFinite(Date.parse(saved.generatedAt))) return empty('unavailable');
  try {
    const selections = validateSelections(saved.selections, menu);
    const meals = indexedMeals(menu.meals ?? []);
    return { ...menu, highlights: {
      status: 'ready', provider: 'groq', model: HIGHLIGHT_MODEL, generatedAt: saved.generatedAt, menuVersion: version,
      meals: meals.map((meal, mealIndex) => {
        const selection = selections.find(selection => selection.mealId === meal.id)!;
        const sourceItem = (id: string) => meal.items.find(item => item.id === id)!;
        const groups: HighlightGroup[] = selection.groups ?? selection.itemIds.map(id => ({
          title: sourceItem(id).name, kind: 'single', sourceIds: [id], componentIds: [],
        }));
        return {
          mealIndex, name: meal.name,
          items: selection.itemIds.map(sourceItem),
          groups: groups.map(group => ({
            ...group, sourceItems: group.sourceIds.map(sourceItem), componentItems: group.componentIds.map(sourceItem),
          })),
        };
      }),
    } };
  } catch { return empty('unavailable'); }
}
