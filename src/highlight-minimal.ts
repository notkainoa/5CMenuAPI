import { MAX_HIGHLIGHTS_PER_MEAL } from './highlight-policy';
import { MAX_GROUP_TITLE_LENGTH, type GroupedMealSelection, type HighlightGroup } from './highlight-groups';
import { isRecord } from './storage';
import { sourceHighlightTitle } from './highlight-titles';
import type { HallMenu } from './types';

function indexedMeals(menu: HallMenu) {
  let alias = 0;
  return (menu.meals ?? []).map((meal, m) => ({
    id: `m${m}`,
    items: meal.stations.flatMap((station, s) => station.items.map((item, i) => ({
      id: `m${m}:s${s}:i${i}`, alias: String(alias++), item,
    }))),
  }));
}

export function minimalHighlightSchema(menu: HallMenu) {
  const meals = indexedMeals(menu);
  return {
    type: 'object', additionalProperties: false, required: ['meals'],
    properties: { meals: {
      type: 'object', additionalProperties: false, required: meals.map(meal => meal.id),
      properties: Object.fromEntries(meals.map(meal => [meal.id, {
        type: 'array', maxItems: meal.items.length ? MAX_HIGHLIGHTS_PER_MEAL : 0,
        items: {
          type: 'object', additionalProperties: false, required: ['sourceIds', 'title'],
          properties: {
            sourceIds: { type: 'array', minItems: 1, maxItems: 4, items: {
              type: 'string', enum: meal.items.length ? meal.items.map(item => item.alias) : ['__empty__'],
            } },
            title: { type: 'string', minLength: 0, maxLength: MAX_GROUP_TITLE_LENGTH },
          },
        },
      }])),
    } },
  };
}

const CONNECTORS = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'on', 'in', 'of', 'to', 'for']);
const GENERIC_COMMON_WORDS = new Set([
  ...CONNECTORS, 'beef', 'chicken', 'pork', 'turkey', 'tofu', 'fish', 'salmon', 'shrimp',
  'vegetable', 'vegetables', 'veggie', 'meat', 'cheese', 'egg', 'eggs',
  'vegan', 'vegetarian', 'plant', 'based', 'halal', 'kosher', 'gluten', 'free',
  'allergen', 'allergens', 'dairy', 'nut', 'soy', 'wheat', 'safe',
  'grilled', 'roasted', 'fried', 'baked', 'steamed', 'seasoned',
]);
function tokens(text: string): string[] {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function variantTitle(title: string, names: string[]): string {
  if (!title.trim() || title !== title.trim() || /[\p{C}\p{Zl}\p{Zp}<>]/u.test(title) ||
    /(?:https?:|www\.|[\p{L}\p{N}]+\.[a-z]{2,}(?:\/|\b))/iu.test(title)) throw new Error('Invalid variant title');
  const titleTokens = tokens(title);
  const nameTokens = names.map(name => tokens(name));
  const evidence = new Set(nameTokens.flat());
  if (!titleTokens.length || titleTokens.some(token => !CONNECTORS.has(token) && !evidence.has(token))) throw new Error('Ungrounded variant title');
  // A common named-dish token is necessary, not sufficient semantic proof.
  // Broad terms such as bowl or pasta can still require contextual review.
  const sharedDishTokens = nameTokens[0].filter(token => !GENERIC_COMMON_WORDS.has(token) &&
    nameTokens.every(words => words.includes(token)));
  if (!sharedDishTokens.some(token => titleTokens.includes(token))) throw new Error('No common named dish');
  const normalizedTitle = titleTokens.join(' ');
  const phrases = normalizedTitle.match(/\b(?:plant based|(?:gluten|dairy|nut|soy|egg|wheat|allergen|allergens) free|vegan|vegetarian|halal|kosher|safe|safely|allergenfree)\b/g) ?? [];
  const normalizedNames = nameTokens.map(words => ` ${words.join(' ')} `);
  if (phrases.some(phrase => !normalizedNames.every(name => name.includes(` ${phrase} `)))) throw new Error('Unsupported combined dietary title');
  return title;
}

export function resolveMinimalOutput(value: unknown, menu: HallMenu): GroupedMealSelection[] {
  const meals = indexedMeals(menu);
  if (!isRecord(value) || !exactKeys(value, ['meals']) || !isRecord(value.meals) ||
    !exactKeys(value.meals, meals.map(meal => meal.id))) throw new Error('Invalid minimal meal output');
  const output = value.meals;
  return meals.map(meal => {
    const values = output[meal.id];
    if (!Array.isArray(values) || values.length > (meal.items.length ? MAX_HIGHLIGHTS_PER_MEAL : 0)) throw new Error('Invalid minimal groups');
    const owned = new Set<string>();
    const groups: HighlightGroup[] = values.map(group => {
      if (!isRecord(group) || !exactKeys(group, ['sourceIds', 'title']) || typeof group.title !== 'string' ||
        [...group.title].length > MAX_GROUP_TITLE_LENGTH || !Array.isArray(group.sourceIds) ||
        group.sourceIds.length < 1 || group.sourceIds.length > 4) throw new Error('Invalid minimal group');
      const sources = group.sourceIds.map(alias => {
        const source = typeof alias === 'string' ? meal.items.find(item => item.alias === alias) : undefined;
        if (!source || owned.has(source.id)) throw new Error('Invalid or overlapping minimal source');
        owned.add(source.id);
        return source;
      });
      return {
        title: sources.length === 1 ? sourceHighlightTitle(sources[0].item.name) : variantTitle(group.title, sources.map(source => source.item.name)),
        kind: sources.length === 1 ? 'single' : 'variants',
        sourceIds: sources.map(source => source.id), componentIds: [],
      };
    });
    return { mealId: meal.id, groups };
  });
}
