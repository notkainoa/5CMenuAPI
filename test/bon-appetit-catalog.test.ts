import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { refineBonAppetitMeals, type CatalogItem } from '../src/providers/bon-appetit-catalog';

function item(name: string, extra: Partial<CatalogItem> = {}): CatalogItem {
  return { name, ...extra };
}

describe('refineBonAppetitMeals', () => {
  it('hides topping catalogs but keeps salad bar as a self-serve option', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Lunch',
        stations: [
          { name: 'Deli Bar', items: [item('rye bread', { special: 0 })] },
          { name: 'Cereal', items: [item('Cheerios', { special: 0 })] },
          { name: 'Salad Bar', items: [item('artichoke hearts', { special: 0 }), item('self serve salad bar', { special: 1 })] },
        ],
      },
    ]);
    assert.deepEqual(meals.map(meal => meal.stations.map(station => [station.name, station.items.map(entry => entry.name)])), [
      [['Salad Bar', ['self serve salad bar']]],
    ]);
  });

  it('keeps a toppings-only salad bar as a placeholder instead of listing garnishes', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [
          { name: 'Grill', items: [item('smash burger', { special: 1 })] },
          { name: 'Salad Bar', items: [item('arugula', { special: 0 })] },
        ],
      },
    ]);
    assert.deepEqual(meals[0].stations[1].items, [{ name: 'Self-serve' }]);
  });

  it('drops the always-on catalog even from stations with no specials', () => {
    // McConnell lists plain "bacon" under Additional Breakfast Favorites every
    // day, including days when no bacon is served.
    const meals = refineBonAppetitMeals([
      {
        name: 'Breakfast',
        stations: [
          { name: 'Comfort', items: [item('loaded hashbrown nest', { special: 1 })] },
          { name: 'Breakfast', items: [item('scrambled eggs', { special: 0 }), item('bacon', { special: 0 })] },
          { name: 'Ovens', items: [item('house-made scones', { special: 0 })] },
          { name: 'ovens2', items: [item('pepperoni pizza', { special: 1 }), item('dried oregano', { special: 0 })] },
        ],
      },
      { name: 'Lunch', stations: [{ name: 'Grill', items: [item('bacon', { special: 0 })] }] },
    ]);
    assert.deepEqual(meals.map(meal => [meal.name, meal.stations.map(station => [station.name, station.items.map(entry => entry.name)])]), [
      ['Breakfast', [['Comfort', ['loaded hashbrown nest']], ['Ovens', ['pepperoni pizza']]]],
      ['Lunch', []],
    ]);
  });

  it('drops always-on grill condiments after merging a second grill station', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [
          {
            name: 'Grill',
            items: [
              item('smash burger', { special: 1 }),
              item("lettuce, tomatoes, pickle, pepperoncini's, red onions, cheese", { special: 1 }),
              item('french fries', { special: 1 }),
            ],
          },
          {
            name: 'Grill',
            items: [
              item('beef patty', { special: 0 }),
              item('white hamburger bun', { special: 0 }),
              item('cheddar cheese', { special: 0 }),
              item('chipotle mayonnaise', { special: 0 }),
            ],
          },
        ],
      },
    ]);
    assert.deepEqual(meals[0].stations[0].items.map(entry => entry.name), ['smash burger', 'french fries']);
  });

  it('does not add a self-serve placeholder when a featured salad bar already exists', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Lunch',
        stations: [
          { name: 'Salad Bar', items: [item('self serve salad bar', { special: 1 })] },
          { name: 'Salad Bar', items: [item('artichoke hearts', { special: 0 })] },
        ],
      },
    ]);
    assert.deepEqual(meals[0].stations[0].items.map(entry => entry.name), ['self serve salad bar']);
  });

  it('folds grill topping lists onto featured dishes and drops always-on garnishes', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [{
          name: 'Grill',
          items: [
            item('live grill - made fresh to order', { special: 1 }),
            item('smash burger', { special: 1 }),
            item("lettuce, tomatoes, pickle, pepperoncini's, red onions, cheese", { special: 1 }),
            item('french fries', { special: 1 }),
            item('onion', { special: 0 }),
            item('beef patty', { special: 0 }),
          ],
        }],
      },
    ]);
    const grill = meals[0].stations[0];
    assert.deepEqual(grill.items.map(entry => entry.name), ['smash burger', 'french fries']);
    assert.match(grill.items[0].description ?? '', /lettuce/i);
    assert.equal(grill.items[1].description, undefined);
  });

  it('collapses a pasta bar and keeps a cooked vegetable plate as a dish', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [
          {
            name: 'Global',
            items: [
              item('pitzer pasta bar', { special: 1 }),
              item('marinara sauce', { special: 1 }),
              item('bow tie pasta', { special: 1 }),
            ],
          },
          { name: 'Comfort', items: [item('steamed spinach, kale, shallots', { special: 1 })] },
        ],
      },
    ]);
    assert.equal(meals[0].stations[0].items.length, 1);
    assert.match(meals[0].stations[0].items[0].description ?? '', /marinara/i);
    assert.equal(meals[0].stations[1].items[0].name, 'steamed spinach, kale, shallots');
  });

  it('strips portion and seasoning descriptions and backfills a short garnish list', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Brunch',
        stations: [{
          name: 'Comfort',
          items: [
            item('hash browns', { special: 1, description: 'with oil, salt, black pepper' }),
            item('garlic parsley breakfast potatoes', { special: 1, ingredients: 'potato, oil, salt, parsley, garlic, smoked paprika, black pepper' }),
          ],
        }],
      },
    ]);
    const names = Object.fromEntries(meals[0].stations[0].items.map(entry => [entry.name, entry.description]));
    assert.equal(names['hash browns'], undefined);
    assert.match(names['garlic parsley breakfast potatoes'] ?? '', /smoked paprika/);
  });

  it('keeps a catalog-only meal as a listed service with no dishes', () => {
    const meals = refineBonAppetitMeals([
      { name: 'Breakfast', stations: [{ name: 'Global', items: [item('omelet', { special: 1 })] }] },
      {
        name: 'Lunch',
        stations: [
          { name: 'Grill', items: [item('bacon', { special: 0 })] },
          { name: 'Salad Bar', items: [item('arugula', { special: 0 })] },
        ],
      },
    ]);
    assert.deepEqual(meals.map(meal => [meal.name, meal.stations.length]), [['Breakfast', 1], ['Lunch', 0]]);
  });

  it('names a merged alias after the canonical station even when the alias comes first', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Breakfast',
        stations: [
          { name: 'ovens2', items: [item('pepperoni pizza', { special: 1 })] },
          { name: 'Ovens', items: [item('house-made scones', { special: 1 })] },
        ],
      },
    ]);
    assert.deepEqual(meals[0].stations.map(station => [station.name, station.items.map(entry => entry.name)]), [
      ['Ovens', ['pepperoni pizza', 'house-made scones']],
    ]);
  });

  it('keeps the first station name when two canonical stations only differ by casing', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [
          { name: 'Grill', items: [item('smash burger', { special: 1 })] },
          { name: 'GRILL', items: [item('french fries', { special: 1 })] },
        ],
      },
    ]);
    assert.equal(meals[0].stations[0].name, 'Grill');
    assert.deepEqual(meals[0].stations[0].items.map(entry => entry.name), ['smash burger', 'french fries']);
  });

  it('orders known stations the same way as the PHP filter', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [
          { name: 'Sweets', items: [item('lemon bars', { special: 1 })] },
          { name: 'Grill', items: [item('smash burger', { special: 1 })] },
        ],
      },
    ]);
    assert.deepEqual(meals[0].stations.map(station => station.name), ['Grill', 'Sweets']);
  });

  it('keeps a four-part cooked plate as a dish instead of folding it away', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Dinner',
        stations: [{
          name: 'Comfort',
          items: [
            item('roasted chicken, mashed potatoes, green beans, gravy', { special: 1 }),
            item('roasted apple, roasted mushrooms, sautéed spinach, butternut squash', { special: 1 }),
          ],
        }],
      },
    ]);
    assert.deepEqual(meals[0].stations[0].items.map(entry => entry.name), [
      'roasted chicken, mashed potatoes, green beans, gravy',
    ]);
    assert.match(meals[0].stations[0].items[0].description ?? '', /roasted apple/);
  });

  it('hides a leftover breakfast station at dinner', () => {
    const meals = refineBonAppetitMeals([
      { name: 'Dinner', stations: [{ name: 'Breakfast', items: [item('peas', { special: 0 })] }] },
    ]);
    assert.deepEqual(meals, []);
  });

  it('keeps beverages at late night and hides them at dinner', () => {
    const dinner = refineBonAppetitMeals([
      { name: 'Dinner', stations: [{ name: 'Beverages', items: [item('soda', { special: 1 })] }] },
    ]);
    const late = refineBonAppetitMeals([
      { name: 'Late Night', stations: [{ name: 'Beverages', items: [item('soda', { special: 1 })] }] },
    ]);
    assert.deepEqual(dinner, []);
    assert.equal(late[0].period, 'late_night');
    assert.equal(late[0].name, 'Late Night');
    assert.equal(late[0].stations[0].name, 'Beverages');
  });

  it('publishes featured true, drops always-on items, and omits the field when the school did not say', () => {
    const meals = refineBonAppetitMeals([
      {
        name: 'Lunch',
        stations: [
          { name: 'Grill', items: [item('smash burger', { special: 1 }), item('onion', { special: 0 })] },
          { name: 'Sweets', items: [item('lemon bars', { special: 0 })] },
          { name: 'Global', items: [item('chef\'s choice')] },
        ],
      },
    ]);
    const byName = Object.fromEntries(meals[0].stations.map(station => [station.name, station.items]));
    assert.deepEqual(byName.Grill, [{ name: 'smash burger', featured: true }]);
    assert.equal(byName.Sweets, undefined);
    assert.deepEqual(byName.Global, [{ name: "chef's choice" }]);
  });
});
