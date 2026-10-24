"""Render an assistant audit of every saved pick against its exact source menu.

Judgments below follow review of the saved names, descriptions and station context.
They are editorial labels, not independent human ground truth or model predictions.
"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.wrangler/highlight-comparison'
OUT.mkdir(exist_ok=True)

WRONG = {
    ('malott', 'roasted cauliflower'): 'Plain roasted vegetable. The menu lists separate chicken, fish and other mains; cauliflower is an accompaniment.',
    ('collins', 'hash brown potatoes'): 'Breakfast potatoes, not a main dish. French toast and huevos rancheros were available.',
    ('collins', 'roasted garlic and herb polenta'): 'Standalone polenta beside meatballs and vegetables, not a composed entrée or a meal bar.',
    ('frary', 'Simply Prepared Organic Red  White Quinoa'): 'Plain quinoa listed separately from the chicken stew. A grain side should not take a main-dish slot.',
}
WEAK = {
    ('hoch', 'Pork Sausage Links'): 'Standalone breakfast sausage. Edible breakfast food, but a weak highlight while a filled bagel, crepes and waffles were available.',
    ('malott', 'plant-based sausage patty (vegetarian) (morningstar)'): 'A standalone breakfast sausage patty. A plant-based label does not make this a substantial main; composed breakfast dishes were available.',
    ('malott', 'grilled ham'): 'Standalone breakfast meat. Shakshuka and the tofu/chickpea scramble were better main-dish highlights.',
    ('mcconnell', 'hot oatmeal'): 'A breakfast staple that can be a meal, but a weak highlight here. The menu also offered an omelet burrito and composed breakfast sandwiches.',
    ('mcconnell', 'pad thai noodles'): 'Listed as the noodle component under Ken\'s pad thai bar, alongside separate proteins and sauce. The assembled meal is not described for this item; the named bar is the clearer pick.',
    ('collins', 'Morningstar sausage patty'): 'A standalone breakfast sausage patty. Still a weak choice beside composed egg dishes and French toast.',
    ('frary', 'Beyond Breakfast Sausage'): 'A standalone breakfast sausage. The menu had a filled egg dish or omelet bar that would give a better main-dish overview.',
    ('frank', 'Garlic Cheese Bread Pizza Squares'): 'The name mixes garlic bread with pizza squares, and the source gives no description. This could be substantial pizza or a bread accompaniment; do not call it definitely wrong.',
    ('frary', 'Polenta Scramble with Oat Milk'): 'The name says scramble, but gives no ingredients beyond polenta and oat milk. It may be a composed breakfast dish or mainly cereal/grain; the source does not settle that.',
}

ALTERNATIVES = {
    '2026-10-02/hoch/0': ['Bacon, Egg And Cheese Bagel', 'Crepes Made To Order With Fresh Berries', 'Belgian Waffle'],
    '2026-10-02/hoch/1': ['Lemongrass Tofu Bao', 'Peruvian Lime Chicken Breast', 'Bbq Chicken Pizza'],
    '2026-10-02/hoch/2': ['Individual Chicken Alfredo Pizza', 'Carne Asada', 'Impossible Taco Meat'],
    '2026-10-02/malott/0': ['burst cherry tomato basil & goat cheese scramble egg toast', 'english muffin breakfast sandwich', 'bacon & egg breakfast burrito'],
    '2026-10-02/malott/1': ['baked chicken penne alfredo', 'chickpea stew', 'herb roasted beef sirloin'],
    '2026-10-02/malott/2': ['butternut squash risotto', 'cuban sandwich', "wings 'n' fries"],
    '2026-10-02/mcconnell/0': ['build your own omelet burrito', 'churro style waffles', "meat lover's breakfast croissant sandwich"],
    '2026-10-02/mcconnell/1': ['pan seared potato tacos', 'roasted fire halal chicken', 'roasted lemon tofu'],
    '2026-10-02/mcconnell/2': ['tofu fajitas', "ken's pad thai bar", 'pitzer macaroni cheese bar'],
    '2026-10-02/collins/0': ['french toast with berry butter'],
    '2026-10-02/collins/2': ['gnocchi + sage brown butter', 'Mongolian stir fry', 'Italian melt'],
    '2026-10-02/collins/3': ['vegetable pot pie', 'Mundo Latino - Southwest grilled chicken bowl', 'Nashville hot chicken sandwich + spicy aioli'],
    '2026-10-02/frank/0': ['Greek Chicken Salad'],
    '2026-10-02/frary/0': ['Chorizo and Egg Burrito', 'Soyrizo and Egg Burrito', 'Tofu Scramble'],
    '2026-10-02/frary/1': ['Santa Fe Chicken Tostada Bowl', 'Grilled Cheese Sandwich', 'Turkey Cobb Salad'],
    '2026-10-02/frary/2': ['Poke Bowl', 'Hickory BBQ Turkey Burger', 'Turkey Cobb Salad'],
    '2026-09-30/malott/0': ['bacon & egg breakfast burrito', 'english muffin breakfast sandwich', 'vegetarian quiche'],
    '2026-09-30/malott/1': ['gyro bar', 'mortadella sandwich on focaccia with lemon ricotta & basil parmesan pesto'],
    '2026-09-30/malott/2': ['quesadilla bar', 'beef pot roast'],
    '2026-09-30/mcconnell/0': ['breakfast tortas', 'sweet potato breakfast bowl'],
    '2026-09-30/mcconnell/1': ['vegetable quinoa stuffed mushrooms', 'sweet potato and black beans patties'],
    '2026-09-30/mcconnell/2': ['skillet enchiladas bar', 'stuffed avocado'],
    '2026-09-30/frank/1': ['Vegan BBQ "Beef" Tips', 'Chorizo Kebab with Blistered Green Beans and Pepitas', 'Thai Chicken Pizza'],
    '2026-09-30/frank/2': ['Chorizo and Jalapeno Pizza'],
    '2026-09-30/frary/0': ['Breakfast Quesadilla with Scrambled Eggs, Jack and Cheddar Cheese'],
    '2026-09-30/frary/1': ['Pumpkin Butter Chicken'],
    '2026-09-30/frary/2': ['General Tso`s Chicken Bowl', 'Alberto`s BLT on Sourdough with Avocado Mayo'],
    '2026-10-04/hoch/0': ['Jerk Tofu', 'Spinach And Feta Cheese Roll', 'Texas French Toast'],
    '2026-10-04/hoch/1': ['Chicken Machaca Burrito', 'Korean Bbq Chicken', 'Spinach And Feta Cheese Roll'],
    '2026-10-04/malott/0': ['deluxe bagel bar'],
    '2026-10-04/malott/1': ['barbecue bacon cheeseburger on a brioche bun'],
    '2026-10-04/mcconnell/0': ['beef machaca burritos', 'brioche french toast casserole'],
    '2026-10-04/mcconnell/1': ['italian pitzer sunday', 'dak chicken bulgogi', 'eggplant parmesan', 'korean burrito'],
    '2026-10-04/collins/0': ['the CarveCraft', 'pomegranate cheese blintz'],
    '2026-10-04/collins/1': ['cauliflower crust vegetable pizza'],
    '2026-10-04/frank/1': ['Bacon Western Cheeseburger Pizza', 'LOX AND BAGEL BAR - Assorted 42nd Street Bagels, Smoked Salmon, Whipped Cream Cheese, Sliced Red Onion, Capers, Sliced Tomato, Avocado'],
    '2026-10-04/frank/2': ['NACHO BAR'],
    '2026-10-04/frary/1': ['Steamed Mussels with Herb Butter', 'Breaded Butterfly Shrimp', 'Angel Hair al Pomodoro'],
    '2026-10-04/frary/2': ['Turkey Bacon Bravo Flatbread'],
}

def main_reason(item):
    name = item['name'].lower()
    if 'bar' in name and not any(word in name for word in ['barbacoa', 'barley']):
        return 'A named build-your-own meal. It describes a meal choice rather than an individual topping.'
    if any(word in name for word in ['sandwich', 'burrito', 'toast', 'bagel', 'wrap', 'quesadilla', 'tostada']):
        return 'A composed meal or filled bread/tortilla dish, rather than a plain bread accompaniment.'
    if any(word in name for word in ['scramble', 'omelet', 'eggs', 'waffle', 'pancake', 'shakshuka']):
        return 'A breakfast main. Egg/tofu dishes and pancakes or waffles qualify for breakfast highlights.'
    if 'pizza' in name:
        return 'Pizza is a main dish. Simpler pizzas can still rank below more specific menu specials.'
    if any(word in name for word in ['bowl', 'curry', 'stew', 'loaf', 'risotto', 'ravioli', 'penne', 'moussaka', 'parmesan', 'paella', 'rolls']):
        return 'A named composed dish, substantial pasta, bowl or stew. The menu supports treating it as an entrée.'
    if 'salad' in name:
        return 'A composed salad with a named entrée protein. This is different from a plain side salad or salad-bar heading.'
    return 'A credible entrée protein or substantial named dish in this meal. Generic grill proteins qualify, even when a more specific dish would be a better highlight.'

def load_original(path, key, label):
    raw = json.loads((ROOT / path).read_text())
    return {'id': key, 'label': label, 'date': raw['date'], 'halls': raw['halls']}

datasets = [
    load_original('.wrangler/groq-live-results-oct2.json', 'original', 'Original test · Oct 2'),
    load_original('.wrangler/groq-live-results-oct2.json', 'refined', 'Refined test · Oct 2'),
    load_original('.wrangler/day-audit/2026-10-04.json', 'today', 'Fresh today · Oct 4'),
    load_original('.wrangler/groq-live-results.json', 'earlier', 'Earlier test · Sep 30'),
]
frozen = json.loads((ROOT / '.wrangler/highlight-eval/1791086353782-live-2026-10-02.json').read_text())
refined = {h['hall']: h['selections'] for h in frozen['results']}
reviewed = {'original': {'hoch', 'malott', 'mcconnell', 'collins', 'frank', 'frary'},
            'refined': {'hoch', 'malott', 'mcconnell', 'collins', 'frank', 'frary'},
            'earlier': {'malott', 'mcconnell', 'frank', 'frary'},
            'today': {'hoch', 'malott', 'mcconnell', 'collins', 'frank', 'frary'}}
report = []
for dataset in datasets:
    result = {k: v for k, v in dataset.items() if k != 'halls'}
    result['halls'] = []
    for hall in dataset['halls']:
        selections = hall.get('selections') if dataset['id'] == 'today' else refined.get(hall['hall']) if dataset['id'] == 'refined' else (
            [{'mealId': f"m{meal['mealIndex']}", 'itemIds': [item['id'] for item in meal['items']]}
             for meal in hall.get('highlights', {}).get('meals', [])]
            if hall.get('highlights', {}).get('status') == 'ready' else None)
        if selections is not None:
            assert hall['hall'] in reviewed[dataset['id']], f"Unreviewed hall {hall['hall']}"
        out = {'id': hall['hall'], 'date': hall['date'], 'sourceUrl': hall['sourceUrl'], 'sourceStatus': hall['status'],
               'ready': selections is not None, 'error': hall.get('generationError') or hall.get('error', {}).get('message'),
               'generatedAt': hall.get('generatedAt') or hall.get('highlights', {}).get('generatedAt'), 'meals': []}
        for mi, meal in enumerate(hall.get('meals') or []):
            selected = next((s['itemIds'] for s in selections or [] if s['mealId'] == f'm{mi}'), [])
            assert len(selected) == len(set(selected))
            if selections is not None:
                assert len(selected) <= (4 if dataset['id'] in ['original', 'earlier'] else 5)
            items = []
            for si, station in enumerate(meal['stations']):
                for ii, item in enumerate(station['items']):
                    id = f'm{mi}:s{si}:i{ii}'
                    record = {'id': id, 'name': item['name'], 'station': station['name'], 'description': item.get('description'), 'picked': id in selected}
                    if record['picked']:
                        pair = (hall['hall'], item['name'])
                        record.update(verdict='correct', reason=main_reason(item))
                        if pair in WRONG: record.update(verdict='wrong', reason=WRONG[pair])
                        if pair in WEAK: record.update(verdict='weak', reason=WEAK[pair])
                        if dataset['id'] == 'refined' and hall['hall'] == 'mcconnell' and mi == 2 and item['name'] in ['bbq pull pork', 'baked fried tofu']:
                            record.update(verdict='weak', reason='An entrée protein, but the menu lists it as a component of the macaroni cheese bar already selected. This duplicates a meal and uses a slot that could cover tofu fajitas.')
                        if dataset['id'] == 'today' and hall['hall'] == 'mcconnell' and item['name'] == 'creamy macaroni and cheese':
                            record.update(verdict='weak', reason='Disputed ranking judgment. Macaroni and cheese can be a main, and GLM accepts it. Here the user prefers covering Italian Pitzer Sunday, merged bulgogi, brisket and slider bar. This pick uses a slot without fixing those omissions.')
                        if dataset['id'] == 'today' and hall['hall'] == 'hoch' and mi == 1 and 'Barbacoa' in item['name']:
                            record.update(verdict='weak', reason='A legitimate beef main, but the list also chooses carne asada from the burrito service. This spends two slots on overlapping meal options and misses the composed chicken machaca burrito. Grouping requires context; the two beef dishes are not the same named dish.')
                        if dataset['id'] == 'today' and hall['hall'] == 'frank' and mi == 2 and item['name'] == 'Pollo Asado':
                            record.update(verdict='weak', reason='A legitimate chicken main, but alongside carne asada it repeats the nacho-bar program. A single named nacho-bar highlight gives a clearer overview. This is redundancy, not a side mistaken for food.')
                    items.append(record)
            assert set(selected) <= {item['id'] for item in items}, 'Selected item is absent from its source meal'
            alternatives = []
            for name in ALTERNATIVES.get(f"{hall['date']}/{hall['hall']}/{mi}", []):
                matches = [item for item in items if item['name'] == name]
                assert matches, f'Missing alternative {name}'
                if not any(item['picked'] for item in matches): alternatives.append(matches[0]['id'])
            out['meals'].append({'name': meal['name'], 'items': items, 'selectionOrder': selected, 'alternatives': alternatives})
        out['counts'] = dict(Counter(item['verdict'] for meal in out['meals'] for item in meal['items'] if item['picked']))
        result['halls'].append(out)
    result['counts'] = dict(Counter({status: sum(h['counts'].get(status, 0) for h in result['halls']) for status in ['correct', 'weak', 'wrong']}))
    result['total'] = sum(result['counts'].values())
    result['readyHalls'] = sum(h['ready'] for h in result['halls'])
    report.append(result)

assert report[0]['total'] == 61 and report[0]['counts']['wrong'] == 4
assert report[1]['total'] == 77 and report[1]['counts']['wrong'] == 0
assert report[3]['total'] == 40
template = (ROOT / 'docs/reports/highlight-pick-audit.template.html').read_text()
benchmark_path = ROOT / '.wrangler/group-eval/summary.json'
benchmark = json.loads(benchmark_path.read_text()) if benchmark_path.exists() else {'cases': [], 'summaries': []}
section = (ROOT / 'docs/reports/grouped-highlight-section.template.html').read_text()
script = (ROOT / 'docs/reports/grouped-highlight-script.template.html').read_text()
template = template.replace('<section class="hero-grid"', section + '\n<section class="hero-grid"', 1)
template = template.replace('</body>', script + '\n</body>', 1)
template = template.replace('Better at avoiding sides.<br><span>Still missing good mains.</span>', 'See the meal.<br><span>Group the choices.</span>')
template = template.replace("I checked every selected item against its own menu, including the descriptions and nearby dishes. The old test had four clear side mistakes. Today's fresh picks have none, but there are still weak choices and obvious mains left out.", "Pitzer's dinner exposed the missing step. Italian Pitzer Sunday represents a whole pasta service, and chicken and beef bulgogi can share one short highlight. This report compares the original picks, your preferred Pitzer overview, and live tests of three Groq models.")
template = template.replace("I'd keep the refined version. The next change should help it scan every brunch station and favor named, composed mains. Another general &quot;don't pick sides&quot; instruction will not fix the missed turkey and blintzes.", 'The earlier audit understated the program problem. Italian Pitzer Sunday was a missing offering. The new output groups related choices and evaluates coverage and duplication alongside individual main-dish eligibility.')
template = template.replace("Today's misses are mostly ranking problems", "Today's misses include programs and ranking")
template = template.replace('while leaving out eggplant parmesan and the named Korean burrito.', 'while omitting Italian Pitzer Sunday and the chicken bulgogi alternative. Eggplant parmesan and Korean burrito are also eligible candidates.')
template = template.replace('<strong>Two separate comparisons.</strong> Original and refined tests use the same October 2 menu. Today\'s picks use freshly fetched October 4 menus. The explorer also includes the original September 30 test.', '<strong>Saved picks and new experiments.</strong> Original and refined tests use the same October 2 menu. Fresh v5 picks use October 4 menus. Grouping tests use October 4 development menus and a separate October 5 holdout. The older explorer also includes September 30.')
content = template.replace('__DATA__', json.dumps(report, ensure_ascii=False).replace('<', '\\u003c')).replace('__BENCHMARK__', json.dumps(benchmark, ensure_ascii=False).replace('<', '\\u003c'))
(OUT / 'index.html').write_text(content)
(OUT / 'audit.json').write_text(json.dumps({'reviewer': 'assistant', 'humanApproved': False, 'datasets': report}, indent=2))
print(json.dumps([{'dataset': r['id'], 'date': r['date'], 'halls': r['readyHalls'], 'total': r['total'], 'counts': r['counts']} for r in report]))
