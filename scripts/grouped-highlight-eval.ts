import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { highlightInput } from '../src/highlights';
import { createHash } from 'node:crypto';
import { groupedHighlightSchema, resolveGroupedOutput, type GroupedMealSelection } from '../src/highlight-groups';
import { groupedSystemPrompt, type GroupPromptStrategy } from '../src/highlight-group-policy';
import { minimalHighlightPrompt } from '../src/highlight-minimal-policy';
import { minimalHighlightSchema, resolveMinimalOutput } from '../src/highlight-minimal';
import { inventoryPrompt } from '../src/highlight-inventory-policy';
import { boundedText } from '../src/providers/response';
import type { HallMenu } from '../src/types';

// Separate reproducible experiment budget; never mutate earlier refinement runs.
const dir = '.wrangler/group-eval';
await mkdir(dir, { recursive: true });
const [phase = 'screen'] = process.argv.slice(2);
if (!['screen', 'screen-r2', 'minimal', 'medium', 'inventory', 'inventory-r2', 'inventory-r3', 'repeat', 'holdout'].includes(phase)) throw new Error('Unknown experiment phase');
const models = ['medium', 'inventory', 'inventory-r2', 'inventory-r3'].includes(phase) ? ['openai/gpt-oss-120b'] : ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
type Strategy = GroupPromptStrategy | 'minimal' | 'minimal-medium' | 'inventory' | 'inventory-r2' | 'inventory-r3';
const strategies: Strategy[] = phase.startsWith('inventory') ? [phase as Strategy] : phase === 'medium' ? ['minimal-medium'] : ['minimal', 'repeat', 'holdout'].includes(phase) ? ['minimal'] : ['program-first', 'cluster-first'];
const isMinimal = (strategy: Strategy) => strategy.startsWith('minimal') || strategy.startsWith('inventory');
const promptFor = (menu: HallMenu, strategy: Strategy) => isMinimal(strategy) ? minimalHighlightPrompt(menu.hall) : groupedSystemPrompt(menu.hall, strategy as GroupPromptStrategy);
const statePath = `${dir}/budget.json`;
const state = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => ({ attempts: 0, tokens: {}, next: {}, blocked: {} }));
const path = `${dir}/${phase}.json`;
const run = await readFile(path, 'utf8').then(JSON.parse).catch(() => ({ phase, startedAt: new Date().toISOString(), results: [] }));
const fixture = JSON.parse(await readFile(phase === 'holdout' ? `${dir}/holdout-2026-10-05.json` : 'test/fixtures/highlights/2026-10-04.json', 'utf8'));
let menus: HallMenu[] = fixture.halls.filter((m: HallMenu) => m.status === 'ok');
if (phase === 'repeat') menus = menus.filter(m => m.hall === 'mcconnell');
if (['medium', 'inventory', 'inventory-r2', 'inventory-r3'].includes(phase)) menus = menus.filter(m => ['hoch', 'mcconnell'].includes(m.hall));
const repetitions = phase === 'repeat' ? 2 : 1;
const config = { models, strategies, reasoning: { gpt: ['medium', 'inventory'].includes(phase) ? 'medium' : 'low', qwen: 'none' }, completionLimits: { gpt: 2000, qwen: 1000 },
  ...(phase === 'repeat' ? { additional120bMedium: true } : {}),
  ...(phase.startsWith('inventory') ? { inventoryPrompt, inventoryEffort: phase === 'inventory' ? 'medium' : 'low', inventoryIdEnum: phase === 'inventory', inventoryShape: phase === 'inventory-r3' ? 'items-object' : 'array' } : {}),
  promptHash: createHash('sha256').update(JSON.stringify(menus.map(m => strategies.map(s => promptFor(m, s))))).digest('hex'),
  fixtureHash: createHash('sha256').update(JSON.stringify(fixture)).digest('hex') };
if (run.config && JSON.stringify(run.config) !== JSON.stringify(config)) throw new Error('Run configuration changed. Use a new phase file.');
run.config = config;
await writeFile(path, JSON.stringify(run, null, 2));
const key = process.env.GROQ_API_KEY ?? (await readFile('.dev.vars', 'utf8')).match(/^GROQ_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
if (!key) throw new Error('GROQ_API_KEY missing');
const tasks = [];
for (let r = 0; r < repetitions; r++) for (let i = 0; i < menus.length; i++) {
  // Fixed balanced rotation avoids always testing a model/prompt first.
  for (let s = 0; s < strategies.length; s++) for (let k = 0; k < models.length; k++) {
    tasks.push({ menu: menus[i], model: models[(k + i + r + s) % models.length], strategy: strategies[(s + i + r) % strategies.length], repeat: r });
  }
  if (phase === 'repeat') tasks.push({ menu: menus[i], model: 'openai/gpt-oss-120b', strategy: 'minimal-medium' as Strategy, repeat: r });
}
for (const task of tasks) {
  const id = `${task.menu.date}/${task.menu.hall}/${task.model}/${task.strategy}/${task.repeat}`;
  if (run.results.some((r: { id: string }) => r.id === id)) continue;
  if (state.blocked[task.model]) { console.log(JSON.stringify({ event: 'model_blocked', model: task.model, reason: state.blocked[task.model] })); continue; }
  // 120B shares today's earlier evaluation usage; keep this batch conservative.
  const limit = 180_000;
  if ((state.tokens[task.model] ?? 0) >= limit) { console.log(JSON.stringify({ event: 'experiment_token_cap', model: task.model, limit })); continue; }
  if (state.attempts >= 120) throw new Error('Experiment stopped at 120 outbound attempts');
  while (Date.now() < (state.next[task.model] ?? 0)) {
    await new Promise(resolve => setTimeout(resolve, Math.min(25_000, state.next[task.model] - Date.now())));
  }
  state.attempts++;
  state.next[task.model] = Date.now() + 65_000;
  await writeFile(statePath, JSON.stringify(state, null, 2));
  const start = performance.now();
  let usage: any, providerOutput: unknown, providerError: unknown, error: string | undefined, headers: Record<string, string> = {};
  const stages: any[] = [];
  let selections: GroupedMealSelection[] | undefined;
  try {
    let input = highlightInput(task.menu);
    if (task.strategy.startsWith('inventory')) {
      const data = JSON.parse(input);
      const properties = Object.fromEntries(data.meals.map((meal: any) => {
        const array = { type: 'array', maxItems: 50, items: { type: 'string', ...(task.strategy !== 'inventory' ? {} : { enum: meal.stations.flatMap((s: any) => s.items.map((i: any) => i.id)).length ? meal.stations.flatMap((s: any) => s.items.map((i: any) => i.id)) : ['__empty__'] }) } };
        return [meal.id, task.strategy === 'inventory-r3' ? { type: 'object', required: ['items'], additionalProperties: false, properties: { items: array } } : array];
      }));
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model: task.model, reasoning_effort: task.strategy === 'inventory' ? 'medium' : 'low', max_completion_tokens: 2000,
          messages: [{ role: 'system', content: inventoryPrompt + (task.strategy === 'inventory-r3' ? '\nExact output shape: {"meals":{"meal_id":{"items":["source_id"]}}}. Each supplied meal maps to an object with only items, an array of ID strings. Use actual supplied IDs, not these placeholders.' : '') }, { role: 'user', content: input }],
          response_format: { type: 'json_schema', json_schema: { name: 'main_inventory', strict: true, schema: {
            type: 'object', additionalProperties: false, required: ['meals'], properties: { meals: { type: 'object', additionalProperties: false, required: data.meals.map((m: any) => m.id), properties } },
          } } } }), });
      const body = JSON.parse(await boundedText(response, 128_000));
      stages.push({ stage: 'inventory', status: response.status, usage: body.usage, content: body.choices?.[0]?.message?.content, error: body.error });
      usage = body.usage;
      if (body.usage?.total_tokens) state.tokens[task.model] = (state.tokens[task.model] ?? 0) + body.usage.total_tokens;
      if (!response.ok || body.choices?.[0]?.finish_reason !== 'stop') throw new Error(`Inventory failed: HTTP ${response.status}`);
      const rawInventory = JSON.parse(body.choices[0].message.content).meals;
      const inventory = task.strategy === 'inventory-r3' ? Object.fromEntries(Object.entries(rawInventory ?? {}).map(([id, value]: any) => [id, value.items])) : rawInventory;
      if (!inventory || Object.keys(inventory).length !== data.meals.length) throw new Error('Invalid inventory meal keys');
      for (const meal of data.meals) {
        const ids = inventory[meal.id];
        const originals = new Set(meal.stations.flatMap((s: any) => s.items.map((i: any) => i.id)));
        if (!Array.isArray(ids) || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id: unknown) => !originals.has(id))) throw new Error('Invalid candidate inventory');
        meal.stations = meal.stations.map((s: any) => ({ ...s, items: s.items.filter((i: any) => ids.includes(i.id)) })).filter((s: any) => s.items.length);
      }
      input = JSON.stringify(data);
      await writeFile(`${dir}/inventory-${task.menu.hall}-candidates.json`, JSON.stringify({ inventory, stages, input }, null, 2));
      while (Date.now() < state.next[task.model]) await new Promise(resolve => setTimeout(resolve, Math.min(25_000, state.next[task.model] - Date.now())));
      if (state.attempts >= 120) throw new Error('Experiment outbound cap before second stage');
      state.attempts++; state.next[task.model] = Date.now() + 65_000;
      await writeFile(statePath, JSON.stringify(state, null, 2));
    }
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ model: task.model, reasoning_effort: ['minimal-medium', 'inventory'].includes(task.strategy) ? 'medium' : task.model.startsWith('qwen/') ? 'none' : 'low', max_completion_tokens: task.model.startsWith('qwen/') ? 1000 : 2000,
        messages: [{ role: 'system', content: promptFor(task.menu, task.strategy) }, { role: 'user', content: input }],
        response_format: { type: 'json_schema', json_schema: { name: 'grouped_highlights', strict: true, schema: isMinimal(task.strategy) ? minimalHighlightSchema(task.menu) : groupedHighlightSchema(task.menu) } },
      }),
    });
    headers = Object.fromEntries(['x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens', 'retry-after'].flatMap(k => response.headers.has(k) ? [[k, response.headers.get(k)!]] : []));
    const body = JSON.parse(await boundedText(response, 128_000));
    stages.push({ stage: 'selection', status: response.status, usage: body.usage });
    usage = { ...body.usage, total_tokens: (usage?.total_tokens ?? 0) + (body.usage?.total_tokens ?? 0), prompt_tokens: (usage?.prompt_tokens ?? 0) + (body.usage?.prompt_tokens ?? 0), completion_tokens: (usage?.completion_tokens ?? 0) + (body.usage?.completion_tokens ?? 0) };
    if (typeof body.usage?.total_tokens === 'number') state.tokens[task.model] = (state.tokens[task.model] ?? 0) + body.usage.total_tokens;
    if (!response.ok) {
      providerError = body.error;
      if (response.status === 429) {
        const message = String(body.error?.message ?? '');
        if (/tokens per day|tokens_per_day|\bTPD\b|daily/i.test(message)) state.blocked[task.model] = message;
        else state.next[task.model] = Date.now() + Math.max(65_000, Number(response.headers.get('retry-after') ?? 65) * 1000);
      }
      throw new Error(`Groq HTTP ${response.status}: ${body.error?.message ?? 'unknown error'}`);
    }
    const choice = body.choices?.[0];
    providerOutput = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof providerOutput !== 'string') throw new Error('Incomplete response');
    if (task.strategy.startsWith('inventory')) {
      const candidateInput = JSON.parse(input);
      const output = JSON.parse(providerOutput);
      for (const meal of candidateInput.meals) {
        const allowed = new Set(meal.stations.flatMap((s: any) => s.items.map((i: any) => i.id)));
        if (!Array.isArray(output.meals?.[meal.id]) || output.meals[meal.id].some((g: any) => !Array.isArray(g.sourceIds) || g.sourceIds.some((id: unknown) => !allowed.has(id)))) throw new Error('Selection outside candidate inventory');
      }
    }
    selections = isMinimal(task.strategy) ? resolveMinimalOutput(JSON.parse(providerOutput), task.menu) : resolveGroupedOutput(JSON.parse(providerOutput), task.menu);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const result = { id, date: task.menu.date, hall: task.menu.hall, model: task.model, strategy: task.strategy, repeat: task.repeat,
    selections, providerOutput, providerError, usage, stages, error, headers, wallMs: Math.round(performance.now() - start), prompt: promptFor(task.menu, task.strategy) };
  run.results.push(result);
  await writeFile(path, JSON.stringify(run, null, 2));
  await writeFile(statePath, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ id, valid: !error, error, usage, wallMs: result.wallMs }));
}
console.log(`Saved ${path}`);
