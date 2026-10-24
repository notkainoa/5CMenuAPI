import { readFile, writeFile } from 'node:fs/promises';
import { resolveGroupedOutput } from '../src/highlight-groups';
import { resolveMinimalOutput } from '../src/highlight-minimal';
import type { HallMenu } from '../src/types';

// Offline scoring. Labels are review judgments, except the user's four Pitzer
// offerings. Do not treat this limited checklist as exhaustive food accuracy.
const dir = '.wrangler/group-eval';
const fixtures: Record<string, HallMenu[]> = {};
fixtures['2026-10-04'] = JSON.parse(await readFile('test/fixtures/highlights/2026-10-04.json', 'utf8')).halls;
fixtures['2026-10-05'] = JSON.parse(await readFile(`${dir}/holdout-2026-10-05.json`, 'utf8')).halls;
const rubrics: Record<string, any> = {};
for (const [date, file] of [['2026-10-04', 'oct4-rubric'], ['2026-10-05', 'holdout-rubric']]) {
  rubrics[date] = await readFile(`${dir}/${file}.json`, 'utf8').then(JSON.parse).catch(() => undefined);
}
const cases: any[] = [];
const planned: any[] = [];
const budget = await readFile(`${dir}/budget.json`, 'utf8').then(JSON.parse);
const foodReview = JSON.parse(await readFile('docs/reports/group-food-review.json', 'utf8'));
const reportError = (message?: string) => message?.replace(/in organization `[^`]+`/g, 'on this account');
for (const phase of ['screen', 'screen-r2', 'minimal', 'medium', 'inventory', 'inventory-r2', 'inventory-r3', 'repeat', 'holdout']) {
  const run = await readFile(`${dir}/${phase}.json`, 'utf8').then(JSON.parse).catch(() => undefined);
  if (!run) continue;
  if (run.config) {
    const halls = ['medium', 'inventory', 'inventory-r2', 'inventory-r3'].includes(phase) ? 2 : phase === 'repeat' ? 1 : 6;
    for (const model of run.config.models) for (const strategy of run.config.strategies) planned.push({ phase, model, strategy, planned: halls * (phase === 'repeat' ? 2 : 1) });
    if (phase === 'repeat') planned.push({ phase, model: 'openai/gpt-oss-120b', strategy: 'minimal-medium', planned: 2 });
  }
  for (const result of run.results) {
    const menu = fixtures[result.date].find(m => m.hall === result.hall)!;
    const quotaError = /(?:Groq HTTP 429|tokens per day|\bTPD\b|output tokens per minute)/i.test(result.error ?? '');
    let selections = result.selections, validationError = result.error;
    if (result.providerOutput) {
      try { selections = result.strategy.startsWith('minimal') || result.strategy.startsWith('inventory') ? resolveMinimalOutput(JSON.parse(result.providerOutput), menu) : resolveGroupedOutput(JSON.parse(result.providerOutput), menu); validationError = undefined; }
      catch (e) { validationError = (e as Error).message; selections = undefined; }
    }
    const metrics = { criticalHit: 0, criticalTotal: 0, clearSideGroups: 0, overlapPairs: 0, variantSplitPairs: 0, groups: 0 };
    const review = !validationError && foodReview.cases.find((c: any) => c.phase === phase && c.model === result.model && c.hall === result.hall && (c.repeat ?? 0) === (result.repeat ?? 0));
    if (review) {
      const selectedIds = new Set(selections.flatMap((meal: any) => meal.groups.flatMap((group: any) => group.sourceIds)));
      if (review.flags.some((flag: any) => !selectedIds.has(flag.sourceId))) throw new Error(`Food annotation is not selected in ${phase}/${result.id}`);
    }
    const meals = (menu.meals ?? []).map((meal, i) => {
      const groups = selections?.find((s: any) => s.mealId === `m${i}`)?.groups ?? [];
      const source = new Map<string, any>(meal.stations.flatMap((station, s) => station.items.map((item, n) => [`m${i}:s${s}:i${n}`, { ...item, station: station.name }] as const)));
      const rubric = rubrics[result.date]?.meals[`${menu.hall}:m${i}`];
      const checks = (rubric?.criticalOfferingGroups ?? []).map((check: any) => ({ label: check.label,
        found: groups.some((g: any) => g.sourceIds.some((id: string) => check.sourceIds.includes(id))) }));
      metrics.criticalTotal += quotaError ? 0 : checks.length;
      metrics.criticalHit += checks.filter((c: any) => c.found).length;
      metrics.groups += groups.length;
      metrics.clearSideGroups += groups.filter((g: any) => g.sourceIds.every((id: string) => rubric?.sideOrHeadingIds?.includes(id))).length;
      for (const relation of rubric?.programRelations ?? []) {
        const parents = groups.filter((g: any) => g.sourceIds.some((id: string) => relation.parentIds.includes(id)));
        const children = groups.filter((g: any) => g.sourceIds.some((id: string) => relation.componentIds.includes(id)));
        metrics.overlapPairs += parents.flatMap((p: any) => children.filter((c: any) => c !== p)).length;
      }
      for (const set of rubric?.interchangeableVariantSets ?? []) {
        metrics.variantSplitPairs += Math.max(0, groups.filter((g: any) => g.sourceIds.some((id: string) => set.sourceIds.includes(id))).length - 1);
      }
      return { name: meal.name, mealId: `m${i}`, checks, groups: groups.map((g: any) => {
        const flags = review?.flags.filter((flag: any) => g.sourceIds.includes(flag.sourceId)) ?? [];
        return { ...g,
        foodVerdict: review ? flags.some((flag: any) => flag.verdict === 'wrong') ? 'wrong' : flags.length ? 'weak' : 'unflagged' : undefined,
        foodReasons: [...new Set(flags.map((flag: any) => flag.reason))],
        sourceItems: g.sourceIds.map((id: string) => ({ id, ...source.get(id) })),
        componentItems: g.componentIds.map((id: string) => ({ id, ...source.get(id) })),
      }; }) };
    });
    let pitzerChecks;
    if (!quotaError && result.date === '2026-10-04' && result.hall === 'mcconnell') {
      const groups = meals[1].groups;
      pitzerChecks = [
        { label: 'Italian Pitzer Sunday', found: groups.some((g: any) => g.sourceIds.includes('m1:s0:i0')) },
        { label: 'Chicken or beef bulgogi', found: groups.some((g: any) => ['m1:s1:i1', 'm1:s1:i2'].every(id => g.sourceIds.includes(id)) && g.sourceIds.length === 2) },
        { label: 'Smoked BBQ brisket', found: groups.some((g: any) => g.sourceIds.includes('m1:s2:i5')) },
        { label: 'Grill slider bar', found: groups.some((g: any) => g.sourceIds.includes('m1:s3:i0')) },
      ];
    }
    cases.push({ phase, id: result.id, model: result.model, strategy: result.strategy, hall: result.hall,
      date: result.date, repeat: result.repeat, valid: !validationError, originalError: reportError(result.error),
      error: reportError(validationError), quotaError,
      foodReviewed: Boolean(review),
      usage: result.usage, reportedUsage: result.stages ? result.stages.some((s: any) => typeof s.usage?.total_tokens === 'number') : typeof result.usage?.total_tokens === 'number',
      outboundCalls: Math.max(1, result.stages?.length ?? 1), wallMs: result.wallMs, metrics, meals, pitzerChecks });
  }
}
const summaries: any[] = [];
for (const row of cases) {
  let sum = summaries.find(s => s.phase === row.phase && s.model === row.model && s.strategy === row.strategy);
  if (!sum) { sum = { phase: row.phase, model: row.model, strategy: row.strategy, attempts: 0, valid: 0, tokens: 0,
    criticalHit: 0, criticalTotal: 0, validCriticalTotal: 0, clearSideGroups: 0, overlapPairs: 0, groups: 0, quotaErrors: 0,
    pitzerHit: 0, pitzerTotal: 0, wallMs: [] }; summaries.push(sum); }
  sum.attempts++; sum.valid += Number(row.valid); sum.tokens += row.usage?.total_tokens ?? 0;
  sum.quotaErrors += Number(row.quotaError);
  for (const key of ['criticalHit', 'criticalTotal', 'clearSideGroups', 'overlapPairs', 'groups']) sum[key] += row.metrics[key];
  if (row.valid) sum.validCriticalTotal += row.metrics.criticalTotal;
  sum.wallMs.push(row.wallMs);
  if (row.pitzerChecks) { sum.pitzerTotal += 4; sum.pitzerHit += row.pitzerChecks.filter((c: any) => c.found).length; }
}
for (const item of planned) {
  let sum = summaries.find(s => s.phase === item.phase && s.model === item.model && s.strategy === item.strategy);
  if (!sum) { sum = { ...item, attempts: 0, valid: 0, tokens: 0, criticalHit: 0, criticalTotal: 0, validCriticalTotal: 0, clearSideGroups: 0, overlapPairs: 0, groups: 0, quotaErrors: 0, pitzerHit: 0, pitzerTotal: 0, wallMs: [] }; summaries.push(sum); }
  sum.planned = item.planned;
  sum.skipped = Math.max(0, item.planned - sum.attempts);
  if (sum.skipped && budget.blocked[item.model]) sum.skipReason = 'Groq daily token quota';
}
await writeFile(`${dir}/summary.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
  outboundCalls: budget.attempts, reportedTokens: Object.values(budget.tokens).reduce((sum: number, value) => sum + Number(value), 0),
  labelStatus: 'assistant-provisional except four user-approved Pitzer offerings', cases, summaries }, null, 2));
console.log(JSON.stringify(summaries.map(({ wallMs, ...s }) => s), null, 2));
