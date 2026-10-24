import { californiaDate } from './dates';
import { CALL_INTERVAL_MS, checkedInput, generateHighlights, HighlightGenerationError, HIGHLIGHTS_KEY, highlightsEnabled, menuVersion, type HighlightFailureReason, type SavedHighlights } from './highlights';
import { readSnapshot } from './storage';
import { menuFor } from './menus';
import { HALLS, type Env, type Fetcher } from './types';
import { hasItems, validateSelections } from './highlight-selection';

export const HIGHLIGHT_STATE_KEY = 'highlight-jobs:v2';
export const MAX_DAILY_CALLS = 21;
export const MAX_VERSION_ATTEMPTS = 3;
interface Job { record: SavedHighlights; attempts: number; retryAt: number; finished: boolean; }
interface JobState {
  date: string; calls: number; nextCallAt: number; needsPublish: boolean;
  jobs: Record<string, Job>; history: Record<string, Job>;
}
export interface JobStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
  setAlarm(time: number): Promise<unknown>;
}

/** One bounded request per alarm. Persist attempts before external I/O for crash recovery. */
export async function runHighlightJob(env: Env, storage: JobStorage, now = new Date(), fetcher: Fetcher = fetch, clock = Date.now): Promise<void> {
  if (!highlightsEnabled(env)) return;
  const time = now.getTime();
  const startedAt = clock();
  const currentTime = () => time + Math.max(0, clock() - startedAt);
  const date = californiaDate(now);
  const old = await storage.get<JobState>(HIGHLIGHT_STATE_KEY);
  // Provider cooldowns outlive our California calendar-day accounting boundary.
  const state: JobState = old?.date === date ? old : {
    date, calls: 0, nextCallAt: old?.nextCallAt ?? 0, needsPublish: false, jobs: {}, history: {},
  };
  const serializedRecords = () => JSON.stringify(Object.fromEntries(
    Object.entries(state.jobs).map(([hall, job]) => [hall, job.record]),
  ));
  const publish = () => env.MENUS.put(HIGHLIGHTS_KEY, serializedRecords());
  async function saveAndPublish(): Promise<void> {
    state.needsPublish = true;
    await storage.put(HIGHLIGHT_STATE_KEY, state);
    await storage.setAlarm(Math.max(currentTime() + CALL_INTERVAL_MS, state.nextCallAt));
    await publish();
    state.needsPublish = false;
    await storage.put(HIGHLIGHT_STATE_KEY, state);
  }
  // Republish persisted results after a failed KV write without another Groq call.
  if (state.needsPublish) {
    await publish();
    state.needsPublish = false;
    await storage.put(HIGHLIGHT_STATE_KEY, state);
    await storage.setAlarm(Math.max(time + CALL_INTERVAL_MS, state.nextCallAt));
    return;
  }
  if (state.nextCallAt > time) { await storage.setAlarm(state.nextCallAt); return; }
  const previousRecords = serializedRecords();
  const snapshot = await readSnapshot(env.MENUS);
  const candidates = [];
  for (const { id } of HALLS) {
    const menu = menuFor(snapshot, id, date, now);
    // Stale menus still show their last verified food, and picks are tied to
    // that exact content, so they remain eligible.
    if (menu.status !== 'ok' && menu.status !== 'stale' || !hasItems(menu)) continue;
    const version = await menuVersion(menu);
    let job = state.jobs[id];
    if (!job || job.record.menuVersion !== version) {
      // Reuse A if an upstream source changes A → B → A. Failed versions retain
      // their attempt count too. Only attempted versions need historical state.
      if (job?.attempts) state.history[job.record.menuVersion] = job;
      job = state.history[version] ?? { record: { date, menuVersion: version, status: 'pending', generatedAt: null, selections: {} }, attempts: 0, retryAt: 0, finished: false };
      delete state.history[version];
      state.jobs[id] = job;
    }
    // A deploy with stricter validation can invalidate a saved result for an
    // unchanged menu. Requeue it within the version's remaining attempts.
    if (job.finished && job.record.status === 'ready') {
      try { validateSelections(job.record.selections, menu, 'id'); }
      catch {
        job.finished = false;
        job.record = { ...job.record, status: 'pending', generatedAt: null, selections: {} };
      }
    }
    if (!job.finished && (job.attempts >= MAX_VERSION_ATTEMPTS || state.calls >= MAX_DAILY_CALLS)) {
      job.finished = true;
      job.record.status = 'unavailable';
      job.record.reason = job.attempts >= MAX_VERSION_ATTEMPTS ? 'attempts_exhausted' : 'daily_budget_exhausted';
    }
    if (!job.finished) candidates.push({ menu, job });
  }
  // Give each hall a first attempt before spending requests on retries.
  candidates.sort((a, b) => a.job.attempts - b.job.attempts);
  const candidate = candidates.find(({ job }) => job.retryAt <= time);
  if (!candidate) {
    if (serializedRecords() !== previousRecords) await saveAndPublish();
    if (candidates.length) await storage.setAlarm(Math.max(time + CALL_INTERVAL_MS, Math.min(...candidates.map(({ job }) => job.retryAt))));
    return;
  }
  const { menu, job } = candidate;
  try { checkedInput(menu); }
  catch (error) {
    if (!(error instanceof HighlightGenerationError)) throw error;
    job.finished = true;
    job.record.status = 'unavailable';
    job.record.reason = error.reason;
    await saveAndPublish();
    return;
  }
  job.attempts++;
  state.calls++;
  state.nextCallAt = time + CALL_INTERVAL_MS;
  job.retryAt = state.nextCallAt;
  await storage.put(HIGHLIGHT_STATE_KEY, state);
  await storage.setAlarm(state.nextCallAt);
  try {
    job.record.selections = await generateHighlights(menu, env.GROQ_API_KEY!, fetcher);
    job.record.status = 'ready';
    job.record.generatedAt = new Date(currentTime()).toISOString();
    delete job.record.reason;
    job.finished = true;
  } catch (error) {
    // Anything other than a classified provider error (timeouts, malformed JSON,
    // failed validation) is retryable within the version's attempt allowance.
    let reason: HighlightFailureReason = 'generation_failed';
    if (error instanceof HighlightGenerationError) {
      job.finished = !error.retryable;
      reason = error.reason;
      job.retryAt = currentTime() + error.retryAfterMs;
      // Groq limits apply to the whole organization, not just this hall.
      state.nextCallAt = Math.max(state.nextCallAt, job.retryAt);
    }
    if (!job.finished && job.attempts >= MAX_VERSION_ATTEMPTS) {
      job.finished = true;
      reason = 'attempts_exhausted';
    }
    // Stay pending while another attempt is planned.
    job.record.status = job.finished ? 'unavailable' : 'pending';
    if (job.finished) job.record.reason = reason;
    else delete job.record.reason;
    // Our own messages carry no secrets or provider bodies; bound them anyway.
    console.warn(JSON.stringify({ event: 'highlights_failed', hall: menu.hall, date, attempt: job.attempts, willRetry: !job.finished,
      reason: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'Unknown failure' }));
  }
  await saveAndPublish();
}
