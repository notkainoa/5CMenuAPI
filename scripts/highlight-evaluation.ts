import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { generateHighlights, PROMPT_VERSION, validateSelections, type Selection } from '../src/highlights';
import type { HallMenu } from '../src/types';
import { isRecord } from '../src/storage';
import { highlightSystemPrompt } from '../src/highlight-policy';

// Provisional engineering labels, not user-approved ground truth. Keep explicit
// acceptable alternatives so ranking several legitimate mains is not a failure.
const priorities: Record<string, string[][]> = {
  '2026-10-02/collins/Breakfast': [['huevos rancheros'], ['french toast with berry butter']],
  '2026-10-02/collins/Dinner': [['vegetable pot pie'], ['Mundo Latino - Southwest grilled chicken bowl'], ['Nashville hot chicken sandwich + spicy aioli'], ['plant based meatballs and rustic marinara sauce']],
  '2026-10-02/frary/Lunch': [['Santa Fe Chicken Tostada Bowl'], ['Spinach Stuffed Eggplant Rolls with Mint Pepita Crunch']],
  '2026-10-02/frary/Dinner': [['Poke Bowl'], ['Hickory BBQ Turkey Burger'], ['Ropa Vieja']],
  '2026-10-02/malott/Lunch': [['fish taco bar'], ['Gardein plant based "fish"', 'chickpea stew'], ['roasted achiote chicken wings', 'herb roasted beef sirloin', 'herb roasted chicken']],
  '2026-10-02/malott/Breakfast': [['burst cherry tomato basil & goat cheese scramble egg toast', 'english muffin breakfast sandwich', 'bacon & egg breakfast burrito', 'vegetarian quiche', 'impossible quinoa breakfast bowl', 'breakfast tortilla fold wrap']],
  '2026-10-02/hoch/LUNCH': [['Korean Pork Belly Bao'], ['Lemongrass Tofu Bao']],
  '2026-10-02/mcconnell/Lunch': [['build your own cajun saute'], ['southwest impossible loaf'], ['pan seared potato tacos', 'roasted fire halal chicken']],
  '2026-10-02/mcconnell/Dinner': [["ken's pad thai bar"], ['tofu fajitas'], ['pitzer macaroni cheese bar', 'creamy macaroni and cheese', 'creamy cheesy macaroni']],
  '2026-10-02/frank/Lunch': [['Orange Chicken']],
  '2026-09-30/collins/Breakfast': [['bacon + cheese scramble', 'french toast']],
  '2026-09-30/collins/Lunch': [['tofu and vegetable stir fry with orange tamari sauce'], ['Mongolian stir fry', 'turkey club ciabatta sandwich with creamy boursin sun-dried tomato spread', 'deluxe turkey burger with avocado and roasted garlic aioli']],
  '2026-09-30/collins/Dinner': [['butter chicken'], ['poke bowl', 'superfood power bowl'], ['vietnamese style tempeh with agave lime sauce', 'massor dal']],
  '2026-09-30/frary/Lunch': [['Shrimp Scampi'], ['Pumpkin Butter Chicken']],
  '2026-09-30/frary/Dinner': [['General Tso`s Chicken Bowl'], ['Spicy  Savory Mapo Tofu', 'General Tso`s Tofu'], ['Alberto`s BLT on Sourdough with Avocado Mayo']],
  '2026-09-30/malott/Lunch': [['gyro bar'], ['jackfruit with coconut milk-green curry sauce']],
  '2026-09-30/malott/Dinner': [['japanese-style tofu curry'], ['japanese-style chicken curry'], ['quesadilla bar', 'spinach, tofu, pinto bean, corn and pickled onion bowl with mojo sauce with honey citrus dressing']],
};

const sideNames = new Set([
  'roasted cauliflower', 'roasted garlic and herb polenta', 'Simply Prepared Organic Red  White Quinoa',
  'hash brown potatoes', 'hash browns', 'tater tots', 'roasted sweet potatoes', 'french fries', 'French Fries',
  'Onion Rings', 'Hamburger Bun', 'Steamed Jasmine Rice', 'Baja Black Beans', 'Brown Rice',
  'Cilantro Lime Rice', 'cajun rice', 'lime herb butter couscous', 'wild rice pilaf',
  'roasted garden vegetables', 'steamed fresh zucchini', 'sauteed spinach', 'Self-serve',
  'chimichurri', 'quinoa and cauliflower rice', 'Turkey Gravy', 'Mojo Sauce', 'FRARY FAVES',
  'TODAY`S SOUP', 'Have A Nice Day', 'made without the top-9 food allergens + gluten-containing ingredients',
  'chocolate chip cookies',
]);

export function scoreSelections(menu: HallMenu, selections: Selection[]) {
  validateSelections(selections, menu);
  // Both saved McConnell dates have only pastries/desserts in ovens and sweets.
  // This is a fixture annotation, not a runtime station filter.
  const fixtureDesserts = new Set(menu.hall === 'mcconnell' && ['2026-10-02', '2026-09-30'].includes(menu.date)
    ? (menu.meals ?? []).flatMap(meal => meal.stations.filter(s => ['ovens', 'sweets'].includes(s.name)).flatMap(s => s.items.map(i => i.name)))
    : []);
  const meals = (menu.meals ?? []).map((meal, m) => {
    const ids = selections.find(s => s.mealId === `m${m}`)!.itemIds;
    const names = ids.map(id => {
      const [, s, i] = id.split(':');
      return meal.stations[Number(s.slice(1))].items[Number(i.slice(1))].name;
    });
    const groups = priorities[`${menu.date}/${menu.hall}/${meal.name}`] ?? [];
    // Fail stale or misspelled labels instead of silently scoring invalid fixtures.
    for (const group of groups) for (const name of group) {
      if (!meal.stations.some(s => s.items.some(i => i.name === name))) throw new Error(`Missing label ${name}`);
    }
    const missed = groups.filter(group => !group.some(name => names.includes(name)));
    const sides = names.filter(name => sideNames.has(name) || fixtureDesserts.has(name));
    return { meal: meal.name, names, sides, missed, checks: groups.length, passed: groups.length - missed.length };
  });
  return { hall: menu.hall, date: menu.date, meals, sides: meals.reduce((sum, m) => sum + m.sides.length, 0),
    checks: meals.reduce((sum, m) => sum + m.checks, 0), passed: meals.reduce((sum, m) => sum + m.passed, 0) };
}

async function main() {
  const [mode = 'baseline', date = '2026-10-02', halls = 'collins,malott,frary', promptPath] = process.argv.slice(2);
  if (!['baseline', 'live'].includes(mode)) throw new Error('Use baseline or live');
  const reasoningEffort = process.env.HIGHLIGHT_EVAL_REASONING_EFFORT ?? 'low';
  if (!['low', 'medium'].includes(reasoningEffort)) throw new Error('Evaluation reasoning effort must be low or medium');
  const fixture = JSON.parse(await readFile(`test/fixtures/highlights/${date}.json`, 'utf8'));
  const menus = (fixture.halls as (HallMenu & { highlights?: { status: string; meals?: { mealIndex: number; items: { id: string }[] }[] } })[])
    .filter(menu => halls.split(',').includes(menu.hall) && menu.status === 'ok');
  const prompt = promptPath ? await readFile(promptPath, 'utf8') : undefined;
  let key = process.env.GROQ_API_KEY;
  if (mode === 'live' && !key) {
    const vars = await readFile('.dev.vars', 'utf8');
    key = vars.match(/^GROQ_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
  }
  if (mode === 'live' && !key) throw new Error('GROQ_API_KEY missing');
  const dir = '.wrangler/highlight-eval';
  await mkdir(dir, { recursive: true });
  const statePath = `${dir}/budget.json`;
  const state = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => ({ calls: 0, nextCallAt: 0 }));
  const run = { mode, date, promptPath, promptVersion: PROMPT_VERSION, startedAt: new Date().toISOString(), prompt, results: [] as unknown[] };
  const outputPath = `${dir}/${Date.now()}-${mode}-${date}.json`;
  for (const menu of menus) {
    let selections: Selection[];
    let usage: unknown;
    let providerOutput: unknown;
    let providerError: unknown;
    if (mode === 'baseline') {
      if (menu.highlights?.status !== 'ready') { console.log(`${menu.hall}: no saved baseline`); continue; }
      selections = menu.highlights.meals!.map(m => ({ mealId: `m${m.mealIndex}`, itemIds: m.items.map(i => i.id) }));
    } else {
      if (state.calls >= 34) throw new Error('Evaluation stopped at 34 outbound attempts');
      while (Date.now() < state.nextCallAt) {
        console.log(`Pacing next ${menu.hall} request, ${Math.ceil((state.nextCallAt - Date.now()) / 1000)}s remaining`);
        await new Promise(resolve => setTimeout(resolve, Math.min(25_000, state.nextCallAt - Date.now())));
      }
      state.calls++;
      // Persist the reservation before network I/O, including failed attempts.
      state.nextCallAt = Date.now() + 65_000;
      await writeFile(statePath, JSON.stringify(state));
      try {
        selections = await generateHighlights(menu, key!, async (url, init) => {
          const body = JSON.parse(String(init?.body));
          if (prompt) body.messages[0].content = prompt;
          body.reasoning_effort = reasoningEffort;
          const response = await fetch(url, { ...init, body: JSON.stringify(body) });
          const copy = await response.clone().json().catch(() => ({}));
          usage = isRecord(copy) ? copy.usage : undefined;
          if (isRecord(copy) && isRecord(copy.error)) providerError = { message: copy.error.message, type: copy.error.type, code: copy.error.code };
          if (isRecord(copy) && Array.isArray(copy.choices)) {
            const first = copy.choices[0];
            if (isRecord(first) && isRecord(first.message)) providerOutput = first.message.content;
          }
          if (response.status === 429) {
            state.nextCallAt = Date.now() + Math.max(65_000, Number(response.headers.get('retry-after') ?? 65) * 1_000);
            await writeFile(statePath, JSON.stringify(state));
          }
          return response;
        });
      } catch (error) {
        run.results.push({ hall: menu.hall, error: String(error), usage, providerOutput, providerError });
        await writeFile(outputPath, JSON.stringify(run, null, 2));
        console.error(`${menu.hall}: ${String(error)}`);
        process.exitCode = 1;
        continue;
      }
    }
    const score = scoreSelections(menu, selections);
    run.results.push({ ...score, selections, usage, providerOutput, ...(mode === 'live' ? { systemPrompt: prompt ?? highlightSystemPrompt(menu.hall), reasoningEffort } : {}) });
    await writeFile(outputPath, JSON.stringify(run, null, 2));
    console.log(JSON.stringify(score));
    if (score.sides || score.passed < score.checks) process.exitCode = 1;
  }
  console.log(`Saved ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
