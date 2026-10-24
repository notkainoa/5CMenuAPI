import { mkdir, writeFile, access } from 'node:fs/promises';
import { refreshHall } from '../src/providers';
import { unavailableMenu } from '../src/menus';
import { HALLS, type HallMenu } from '../src/types';

const date = process.argv[2] ?? '2026-10-05';
const path = `.wrangler/group-eval/holdout-${date}.json`;
await mkdir('.wrangler/group-eval', { recursive: true });
if (await access(path).then(() => true).catch(() => false)) throw new Error('Holdout already captured; keep its original snapshot');
const halls: HallMenu[] = [];
for (const hall of HALLS) {
  let menu = unavailableMenu(hall.id, date);
  try {
    const result = await refreshHall(hall.id, [date], undefined, fetch);
    const day = result.days.find(d => d.date === date);
    const now = new Date().toISOString();
    menu = day ? { ...menu, ...day, lastCheckedAt: now, lastSuccessfulCheckAt: now, menuUpdatedAt: now, error: undefined } : menu;
  } catch { /* Missing source data remains explicitly unavailable. */ }
  halls.push(menu);
  console.log(JSON.stringify({ date, hall: hall.id, status: menu.status, meals: menu.meals?.length ?? 0 }));
}
await writeFile(path, JSON.stringify({ date, capturedAt: new Date().toISOString(), halls }, null, 2));
console.log(`Saved ${path}`);
