import { daysBetween, isIsoDate } from './dates';
import type { Food, FoodCatalogItem, FoodEntry, FoodTarget } from './types';

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export function scaled(perServing: Macros, servings: number): Macros {
  return {
    kcal: perServing.kcal * servings,
    protein: perServing.protein * servings,
    carbs: perServing.carbs * servings,
    fat: perServing.fat * servings,
  };
}

export function tally(entries: FoodEntry[]): Macros {
  const total: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const entry of entries) {
    const row = scaled(entry, entry.servings);
    total.kcal += row.kcal;
    total.protein += row.protein;
    total.carbs += row.carbs;
    total.fat += row.fat;
  }
  return total;
}

/** Protein and carbs are 4 kcal/g, fat is 9. Shares are of that macro energy, not the label kcal. */
export function macroShare(total: Macros): { protein: number; carbs: number; fat: number } | null {
  const energy = total.protein * 4 + total.carbs * 4 + total.fat * 9;
  if (!(energy > 0)) return null;
  return {
    protein: (total.protein * 4 / energy) * 100,
    carbs: (total.carbs * 4 / energy) * 100,
    fat: (total.fat * 9 / energy) * 100,
  };
}

export function remaining(total: Macros, target: FoodTarget | null): Macros {
  return {
    kcal: target?.kcal == null ? Number.NaN : target.kcal - total.kcal,
    protein: target?.protein == null ? Number.NaN : target.protein - total.protein,
    carbs: target?.carbs == null ? Number.NaN : target.carbs - total.carbs,
    fat: target?.fat == null ? Number.NaN : target.fat - total.fat,
  };
}

/** Recent use and repeat use both lift a food. Unused foods rank 0. */
export function usageRank(food: Pick<Food, 'useCount' | 'lastUsedAt'>, today: string): number {
  const used = food.lastUsedAt?.slice(0, 10) ?? '';
  const recency = isIsoDate(used) ? Math.max(0, 30 - Math.abs(daysBetween(used, today))) : 0;
  const count = Number.isFinite(food.useCount) ? food.useCount : 0;
  return count * 2 + recency;
}

export function sortFoods(foods: Food[], today: string): Food[] {
  return [...foods].sort((a, b) => usageRank(b, today) - usageRank(a, today) || a.name.localeCompare(b.name));
}

export function parseRepoFoods(raw: unknown): FoodCatalogItem[] {
  if (!Array.isArray(raw)) throw new Error('foods.json must be an array.');
  const seen = new Set<string>();
  const foods: FoodCatalogItem[] = [];
  for (const row of raw) {
    const food = catalogItem(row);
    if (!food || seen.has(food.id)) continue;
    seen.add(food.id);
    foods.push(food);
  }
  return foods;
}

/**
 * Repo rows refresh local copies with the same id.
 * A food the user edited, and any custom food, keep the local copy.
 * An unedited repo food that left the file is dropped. Hidden stays with the row.
 */
export function mergeFoods(local: Food[], repo: FoodCatalogItem[], now: string): Food[] {
  const byId = new Map(local.map((food) => [food.id, food]));
  const seen = new Set<string>();
  const next: Food[] = [];
  for (const item of repo) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const existing = byId.get(item.id);
    if (!existing) {
      next.push(repoFood(item, now));
      continue;
    }
    if (existing.source === 'custom' || existing.edited) {
      next.push(existing);
      continue;
    }
    next.push(catalogMatches(existing, item) ? existing : { ...existing, ...item, source: 'repo', edited: false, updatedAt: now });
  }
  for (const food of local) {
    if (seen.has(food.id)) continue;
    if (food.source === 'repo' && !food.edited) continue;
    next.push(food);
  }
  return next;
}

export function sameFoodList(a: Food[], b: Food[]): boolean {
  return foodListKey(a) === foodListKey(b);
}

function foodListKey(foods: Food[]): string {
  return [...foods]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((food) => [
      food.id,
      food.name,
      food.serving,
      food.kcal,
      food.protein,
      food.carbs,
      food.fat,
      food.source,
      food.edited,
      food.hidden,
      food.useCount,
      food.lastUsedAt,
      food.updatedAt,
    ].join('|'))
    .join('\n');
}

function repoFood(item: FoodCatalogItem, now: string): Food {
  return {
    ...item,
    source: 'repo',
    edited: false,
    hidden: false,
    useCount: 0,
    lastUsedAt: null,
    updatedAt: now,
  };
}

function catalogMatches(food: Food, item: FoodCatalogItem): boolean {
  return food.name === item.name
    && food.serving === item.serving
    && food.kcal === item.kcal
    && food.protein === item.protein
    && food.carbs === item.carbs
    && food.fat === item.fat;
}

function catalogItem(raw: unknown): FoodCatalogItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<FoodCatalogItem>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.name !== 'string' || !row.name.trim()) return null;
  if (typeof row.serving !== 'string' || !row.serving.trim()) return null;
  const kcal = nonNegative(row.kcal);
  const protein = nonNegative(row.protein);
  const carbs = nonNegative(row.carbs);
  const fat = nonNegative(row.fat);
  if (kcal == null || protein == null || carbs == null || fat == null) return null;
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    serving: row.serving.trim(),
    kcal,
    protein,
    carbs,
    fat,
  };
}

function nonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function cleanFood(raw: unknown): Food | null {
  const item = catalogItem(raw);
  if (!item || !raw || typeof raw !== 'object') return null;
  const row = raw as Partial<Food>;
  const source = row.source === 'custom' ? 'custom' : 'repo';
  const useCount = typeof row.useCount === 'number' && Number.isFinite(row.useCount) && row.useCount > 0 ? Math.round(row.useCount) : 0;
  const lastUsedAt = typeof row.lastUsedAt === 'string' ? row.lastUsedAt : null;
  return {
    ...item,
    source,
    edited: row.edited === true,
    hidden: row.hidden === true,
    useCount,
    lastUsedAt,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function cleanFoodEntry(raw: unknown): FoodEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<FoodEntry>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  if (typeof row.name !== 'string' || !row.name.trim()) return null;
  const servings = typeof row.servings === 'number' && Number.isFinite(row.servings) && row.servings > 0 ? row.servings : null;
  const kcal = nonNegative(row.kcal);
  const protein = nonNegative(row.protein);
  const carbs = nonNegative(row.carbs);
  const fat = nonNegative(row.fat);
  if (servings == null || kcal == null || protein == null || carbs == null || fat == null) return null;
  const loggedAt = typeof row.loggedAt === 'string' ? row.loggedAt : new Date().toISOString();
  return {
    id: row.id,
    date: row.date,
    foodId: typeof row.foodId === 'string' && row.foodId ? row.foodId : null,
    name: row.name.trim(),
    serving: typeof row.serving === 'string' ? row.serving : '',
    servings,
    kcal,
    protein,
    carbs,
    fat,
    loggedAt,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : loggedAt,
  };
}

export function cleanFoodTarget(raw: unknown): FoodTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<FoodTarget>;
  if (typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  const target: FoodTarget = {
    date: row.date,
    kcal: optionalNonNegative(row.kcal),
    protein: optionalNonNegative(row.protein),
    carbs: optionalNonNegative(row.carbs),
    fat: optionalNonNegative(row.fat),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
  if (target.kcal == null && target.protein == null && target.carbs == null && target.fat == null) return null;
  return target;
}

function optionalNonNegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  return nonNegative(value);
}

export async function fetchRepoFoods(href = window.location.href): Promise<FoodCatalogItem[]> {
  const url = new URL('foods.json', href);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The food list responded ${response.status}.`);
  return parseRepoFoods(await response.json());
}
