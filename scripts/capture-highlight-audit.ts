/** Capture one fresh hall-day selection per available source menu for review. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { HALLS, type HallMenu } from '../src/types';
import { refreshHall } from '../src/providers';
import { unavailableMenu } from '../src/menus';
import { generateHighlights, PROMPT_VERSION, HighlightGenerationError } from '../src/highlights';
import { californiaDate } from '../src/dates';

const date = process.argv[2] ?? californiaDate(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use YYYY-MM-DD');
const dir = '.wrangler/day-audit';
await mkdir(dir, { recursive: true });
const path = `${dir}/${date}.json`;
const existing = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const run = existing ?? { date, capturedAt: new Date().toISOString(), promptVersion: PROMPT_VERSION, halls: [], attempts: 0, nextCallAt: 0 };
let key = process.env.GROQ_API_KEY;
if (!key) key = (await readFile('.dev.vars', 'utf8')).match(/^GROQ_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
if (!key) throw new Error('GROQ_API_KEY missing');
const save = () => writeFile(path, JSON.stringify(run, null, 2));

for (const hall of HALLS) {
  if (run.halls.some((h: HallMenu) => h.hall === hall.id)) continue;
  let menu: HallMenu = unavailableMenu(hall.id, date);
  try {
    const provider = await refreshHall(hall.id, [date], undefined, fetch);
    const day = provider.days.find(day => day.date === date);
    const now = new Date().toISOString();
    menu = day ? { ...menu, ...day, lastCheckedAt: now, lastSuccessfulCheckAt: now, menuUpdatedAt: now, error: undefined }
      : { ...menu, lastCheckedAt: now, error: provider.errors?.[date] ?? { code: 'MENU_NOT_PUBLISHED', message: 'Source did not publish this date.' } };
  } catch (error) {
    menu.error = { code: 'SOURCE_FETCH_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
  const entry = { ...menu, selections: null as unknown, generationError: null as string | null, generatedAt: null as string | null };
  if (menu.status === 'ok') {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (run.attempts >= 14) throw new Error('Audit stopped at 14 outbound attempts');
      while (Date.now() < run.nextCallAt) {
        console.log(JSON.stringify({ event: 'audit_pacing', hall: hall.id, remainingSeconds: Math.ceil((run.nextCallAt - Date.now()) / 1000) }));
        await new Promise(resolve => setTimeout(resolve, Math.min(25_000, run.nextCallAt - Date.now())));
      }
      run.attempts++;
      run.nextCallAt = Date.now() + 65_000;
      await save();
      try {
        entry.selections = await generateHighlights(menu, key);
        entry.generatedAt = new Date().toISOString();
        entry.generationError = null;
        break;
      } catch (error) {
        entry.generationError = error instanceof Error ? error.message : String(error);
        console.log(JSON.stringify({ event: 'audit_generation_failed', hall: hall.id, attempt: attempt + 1, error: entry.generationError }));
        if (error instanceof HighlightGenerationError) {
          run.nextCallAt = Math.max(run.nextCallAt, Date.now() + error.retryAfterMs);
          await save();
          if (!error.retryable) break;
        }
      }
    }
  }
  run.halls.push(entry);
  await save();
  console.log(JSON.stringify({ hall: hall.id, date, status: menu.status, meals: menu.meals?.length ?? 0,
    items: menu.meals?.flatMap(m => m.stations).flatMap(s => s.items).length ?? 0, ready: entry.selections !== null, error: entry.generationError ?? menu.error?.message }));
}
console.log(`Saved ${path}`);
