import { MAX_HIGHLIGHTS_PER_MEAL } from './highlight-policy';
import { isRecord } from './storage';
import { sourceHighlightTitle } from './highlight-titles';
import type { HallMenu, MenuItem } from './types';

export interface HighlightGroup {
  title: string;
  kind: 'single' | 'variants' | 'program';
  sourceIds: string[];
  componentIds: string[];
}
export interface GroupedMealSelection { mealId: string; groups: HighlightGroup[]; }
export const MAX_GROUP_TITLE_LENGTH = 64;

function indexedMeals(menu: HallMenu) {
  let alias = 0;
  return (menu.meals ?? []).map((meal, m) => ({
    id: `m${m}`,
    items: meal.stations.flatMap((station, s) => station.items.map((item, i) => ({
      id: `m${m}:s${s}:i${i}`, alias: String(alias++), item,
    }))),
  }));
}

export function groupedHighlightSchema(menu: HallMenu) {
  const meals = indexedMeals(menu);
  return {
    type: 'object', additionalProperties: false, required: ['meals'],
    properties: { meals: {
      type: 'object', additionalProperties: false, required: meals.map(meal => meal.id),
      properties: Object.fromEntries(meals.map(meal => {
        // Empty services have no groups. A nonempty enum keeps the unreachable
        // item schema valid for providers that reject an empty enum.
        const id = { type: 'string', enum: meal.items.length ? meal.items.map(item => item.alias) : ['__empty__'] };
        return [meal.id, {
          type: 'array', maxItems: meal.items.length ? MAX_HIGHLIGHTS_PER_MEAL : 0,
          items: {
            type: 'object', additionalProperties: false,
            required: ['title', 'kind', 'sourceIds', 'componentIds'],
            properties: {
              title: { type: 'string', minLength: 1, maxLength: MAX_GROUP_TITLE_LENGTH },
              kind: { type: 'string', enum: ['single', 'variants', 'program'] },
              sourceIds: { type: 'array', minItems: 1, maxItems: 4, items: id },
              componentIds: { type: 'array', maxItems: 24, items: id },
            },
          },
        }];
      })),
    } },
  };
}

const CONNECTORS = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'on', 'in', 'of', 'to', 'for']);
function tokens(text: string): string[] {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function validateTitle(title: unknown, sources: MenuItem[], kind: HighlightGroup['kind']): string {
  if (typeof title !== 'string' || !title.trim() || title !== title.trim() ||
    [...title].length > MAX_GROUP_TITLE_LENGTH || /[\p{C}\p{Zl}\p{Zp}<>]/u.test(title)) {
    throw new Error('Invalid group title');
  }
  // An exact deterministic source title may contain a bounded word prefix or
  // sanitized markup. It is trusted only for its one original source row;
  // generated alternatives must still pass grounding and claim validation.
  if (kind === 'single' && sources.length === 1 && title === sourceHighlightTitle(sources[0].name)) return title;
  if (/(?:https?:|www\.|[\p{L}\p{N}]+\.[a-z]{2,}(?:\/|\b))/iu.test(title)) throw new Error('Invalid group title');
  const titleTokens = tokens(title);
  const evidence = new Set(sources.flatMap(item => tokens(`${item.name} ${item.description ?? ''}`)));
  // Lexical grounding rejects new ingredients; it cannot establish that two
  // dishes are semantic variants or that an item is a genuine meal program.
  if (!titleTokens.length || titleTokens.every(token => CONNECTORS.has(token)) ||
    titleTokens.some(token => !CONNECTORS.has(token) && !evidence.has(token))) {
    throw new Error('Ungrounded group title');
  }
  // Preserve explicit source-name dietary wording, never create a claim from
  // booleans, component metadata, or prose in a description.
  const normalizedTitle = titleTokens.join(' ');
  const sourceNames = sources.map(item => ` ${tokens(item.name).join(' ')} `);
  const dietaryPhrases = normalizedTitle.match(/\b(?:plant based|(?:gluten|dairy|nut|soy|egg|wheat|allergen|allergens) free|vegan|vegetarian|halal|kosher|safe|safely|allergenfree)\b/g) ?? [];
  if (dietaryPhrases.some(phrase => !(kind === 'variants' ? sourceNames.every(name => name.includes(` ${phrase} `)) : sourceNames.some(name => name.includes(` ${phrase} `))))) {
    throw new Error('Unsupported dietary title');
  }
  return title;
}

export function validateGroupedSelections(value: unknown, menu: HallMenu): GroupedMealSelection[] {
  const meals = indexedMeals(menu);
  if (!Array.isArray(value) || value.length !== meals.length) throw new Error('Invalid grouped meal selections');
  const seenMeals = new Set<string>();
  return value.map(selection => {
    if (!isRecord(selection) || typeof selection.mealId !== 'string' || seenMeals.has(selection.mealId)) throw new Error('Invalid grouped meal ID');
    seenMeals.add(selection.mealId);
    const meal = meals.find(meal => meal.id === selection.mealId);
    if (!meal || !Array.isArray(selection.groups) || selection.groups.length > (meal.items.length ? MAX_HIGHLIGHTS_PER_MEAL : 0)) throw new Error('Invalid highlight groups');
    const owned = new Set<string>();
    const groups = selection.groups.map(value => {
      if (!isRecord(value) || Object.keys(value).some(key => !['title', 'kind', 'sourceIds', 'componentIds'].includes(key)) ||
        typeof value.kind !== 'string' || !['single', 'variants', 'program'].includes(value.kind) ||
        !Array.isArray(value.sourceIds) || value.sourceIds.length < 1 || value.sourceIds.length > 4 ||
        !Array.isArray(value.componentIds) || value.componentIds.length > 24) throw new Error('Invalid highlight group');
      const kind = value.kind as HighlightGroup['kind'];
      if ((kind === 'single' && (value.sourceIds.length !== 1 || value.componentIds.length !== 0)) ||
        (kind === 'variants' && (value.sourceIds.length < 2 || value.componentIds.length !== 0))) throw new Error('Invalid group kind');
      const sourceIds: string[] = [];
      const componentIds: string[] = [];
      for (const [ids, target] of [[value.sourceIds, sourceIds], [value.componentIds, componentIds]] as const) {
        for (const id of ids) {
          if (typeof id !== 'string' || owned.has(id) || !meal.items.some(item => item.id === id)) throw new Error('Invalid or overlapping group source');
          owned.add(id);
          target.push(id);
        }
      }
      const sources = sourceIds.map(id => meal.items.find(item => item.id === id)!.item);
      return { title: validateTitle(value.title, sources, kind), kind, sourceIds, componentIds };
    });
    return { mealId: selection.mealId, groups };
  });
}

export function resolveGroupedOutput(value: unknown, menu: HallMenu): GroupedMealSelection[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.meals)) throw new Error('Invalid grouped output');
  const meals = indexedMeals(menu);
  const selections = Object.entries(value.meals).map(([mealId, groups]) => {
    const meal = meals.find(meal => meal.id === mealId);
    if (!meal || !Array.isArray(groups)) throw new Error('Invalid grouped meal selections');
    const aliases = new Map(meal.items.map(item => [item.alias, item.id]));
    return { mealId, groups: groups.map(group => {
      if (!isRecord(group)) throw new Error('Invalid highlight group');
      const resolve = (ids: unknown) => {
        if (!Array.isArray(ids)) throw new Error('Invalid group IDs');
        return ids.map(id => {
          const canonical = typeof id === 'string' ? aliases.get(id) : undefined;
          if (!canonical) throw new Error('Invalid group ID');
          return canonical;
        });
      };
      return { ...group, sourceIds: resolve(group.sourceIds), componentIds: resolve(group.componentIds) };
    }) };
  });
  return validateGroupedSelections(selections, menu);
}
