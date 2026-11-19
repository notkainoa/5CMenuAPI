export const DIET_FLAGS = [
  'vegan', 'vegetarian', 'glutenFree', 'halal', 'kosher',
  'mindful', 'plantBased', 'containsPork', 'containsBeef', 'containsPoultry',
] as const;
export type DietFlag = typeof DIET_FLAGS[number];
