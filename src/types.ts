import type { MealPeriod } from './periods';

export const HALLS = [
  { id: 'hoch', name: 'Hoch-Shanahan', college: 'Harvey Mudd', sourceUrl: 'https://hmc.sodexomyway.com/en-us/locations/hoch-shanahan-dining-commons' },
  { id: 'malott', name: 'Malott', college: 'Scripps', sourceUrl: 'https://scripps.cafebonappetit.com/' },
  { id: 'mcconnell', name: 'McConnell', college: 'Pitzer', sourceUrl: 'https://pitzer.cafebonappetit.com/' },
  { id: 'collins', name: 'Collins', college: 'Claremont McKenna', sourceUrl: 'https://collins-cmc.cafebonappetit.com/' },
  { id: 'frank', name: 'Frank', college: 'Pomona', sourceUrl: 'https://www.pomona.edu/administration/dining/menus/frank' },
  { id: 'frary', name: 'Frary', college: 'Pomona', sourceUrl: 'https://www.pomona.edu/administration/dining/menus/frary' },
  { id: 'oldenborg', name: 'Oldenborg', college: 'Pomona', sourceUrl: 'https://www.pomona.edu/administration/dining/menus/oldenborg' },
] as const;
export type HallId = typeof HALLS[number]['id'];
export type { MealPeriod };
export interface MenuItem {
  name: string;
  description?: string;
  vegan?: boolean;
  vegetarian?: boolean;
  glutenFree?: boolean;
  halal?: boolean;
  kosher?: boolean;
  mindful?: boolean;
  plantBased?: boolean;
  containsPork?: boolean;
  containsBeef?: boolean;
  containsPoultry?: boolean;
  featured?: boolean;
  calories?: number;
  allergens?: string[];
}
export interface Station { name: string; items: MenuItem[]; }
export interface Meal {
  name: string;
  period?: MealPeriod;
  startTime?: string;
  endTime?: string;
  stations: Station[];
}
export interface ParsedDay { date: string; status: 'ok' | 'closed'; meals: Meal[]; }
export interface ApiError { code: string; message: string; }
export interface HallMenu {
  hall: HallId; date: string; status: 'ok' | 'closed' | 'stale' | 'unavailable';
  sourceUrl: string; lastCheckedAt: string | null; lastSuccessfulCheckAt: string | null;
  menuUpdatedAt: string | null; meals: Meal[] | null; error?: ApiError;
}
// Provider-owned JSON-serializable state: validators and cached parsed data.
export type SourceState = Record<string, unknown>;
export interface ProviderResult { days: ParsedDay[]; state: SourceState; errors?: Record<string, ApiError>; }
export type Fetcher = typeof globalThis.fetch;
export type RefreshHall = (hall: HallId, dates: string[], previous: SourceState | undefined, fetcher: Fetcher) => Promise<ProviderResult>;
export interface Snapshot {
  version: 1; refreshedAt: string;
  menus: Record<string, Partial<Record<HallId, HallMenu>>>;
  sources: Partial<Record<HallId, SourceState>>;
}
export interface SnapshotStore { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; }
export interface Env {
  MENUS: SnapshotStore;
  GROQ_API_KEY?: string;
  HIGHLIGHTS_ENABLED?: string;
}
