import { describe, expect, it } from 'vitest';
import catalog from '../public/foods.json';
import { detectImport, exportBackup, exportFoodCsv } from './exchange';
import { formatTargetLeft, macroShare, mergeFoods, parseRepoFoods, parseTargets, resolveDayTarget, scaled, sortFoods, tally, usageRank } from './food';
import { defaultSettings } from './storage';
import type { Food, FoodCatalogItem, FoodEntry, FoodTarget } from './types';

const now = '2026-11-21T12:00:00.000Z';

function repo(partial: Partial<FoodCatalogItem> & Pick<FoodCatalogItem, 'id' | 'name'>): FoodCatalogItem {
  return {
    serving: '1 serving',
    kcal: 100,
    protein: 10,
    carbs: 10,
    fat: 2,
    ...partial,
  };
}

function stored(item: FoodCatalogItem, extra: Partial<Food> = {}): Food {
  return {
    ...item,
    source: 'repo',
    edited: false,
    hidden: false,
    useCount: 0,
    lastUsedAt: null,
    updatedAt: now,
    ...extra,
  };
}

function entry(partial: Partial<FoodEntry> & Pick<FoodEntry, 'servings' | 'kcal' | 'protein' | 'carbs' | 'fat'>): FoodEntry {
  return {
    id: 'e1',
    date: '2026-11-21',
    foodId: 'banana-medium',
    name: 'Banana, medium',
    serving: '1 medium (118 g)',
    loggedAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe('food tally', () => {
  it('scales a serving and sums the day', () => {
    expect(scaled({ kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 }, 0.5)).toEqual({
      kcal: 52.5,
      protein: 0.65,
      carbs: 13.5,
      fat: 0.2,
    });
    const banana = entry({ servings: 1.5, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 });
    const egg = entry({
      id: 'e2',
      foodId: 'egg-large',
      name: 'Egg, large',
      servings: 2,
      kcal: 72,
      protein: 6.3,
      carbs: 0.4,
      fat: 4.8,
    });
    expect(tally([banana, egg])).toEqual({
      kcal: 105 * 1.5 + 72 * 2,
      protein: 1.3 * 1.5 + 6.3 * 2,
      carbs: 27 * 1.5 + 0.4 * 2,
      fat: 0.4 * 1.5 + 4.8 * 2,
    });
    const share = macroShare(tally([banana, egg]));
    const energy = (1.3 * 1.5 + 6.3 * 2) * 4 + (27 * 1.5 + 0.4 * 2) * 4 + (0.4 * 1.5 + 4.8 * 2) * 9;
    expect(share).not.toBeNull();
    expect(share!.protein + share!.carbs + share!.fat).toBeCloseTo(100, 8);
    expect(share!.protein).toBeCloseTo(((1.3 * 1.5 + 6.3 * 2) * 4 / energy) * 100, 8);
  });

  it('formats each summary as target / left, with a unit and an over state', () => {
    expect(formatTargetLeft(2291, 2140, '')).toBe('2291 / 151');
    expect(formatTargetLeft(149, 130, 'g')).toBe('149g / 19g');
    expect(formatTargetLeft(139, 93, 'g')).toBe('139g / 46g');
    expect(formatTargetLeft(126, 98, 'g')).toBe('126g / 28g');
    expect(formatTargetLeft(149, 160, 'g')).toBe('149g / 11g over');
    expect(formatTargetLeft(2291, 2400, '')).toBe('2291 / 109 over');
  });

  it('has no macro split when every gram is zero', () => {
    expect(macroShare({ kcal: 10, protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });
});

describe('food catalog merge', () => {
  const banana = repo({ id: 'banana-medium', name: 'Banana, medium', kcal: 105 });
  const egg = repo({ id: 'egg-large', name: 'Egg, large', kcal: 72 });

  it('updates an unedited repo food, keeps edits and custom foods, and drops a removed repo food', () => {
    const local = [
      stored(banana, { hidden: true, useCount: 4, lastUsedAt: '2026-11-20T08:00:00.000Z' }),
      stored(egg, { name: 'My egg', edited: true, kcal: 80 }),
      stored(repo({ id: 'oats', name: 'Oats' }), { source: 'custom' }),
      stored(repo({ id: 'yogurt', name: 'Yogurt' })),
      stored(repo({ id: 'rice', name: 'Rice, edited' }), { edited: true, source: 'repo' }),
    ];
    const merged = mergeFoods(local, [
      { ...banana, kcal: 110 },
      { ...egg, name: 'Egg, large' },
      repo({ id: 'apple', name: 'Apple' }),
    ], '2026-11-22T00:00:00.000Z');
    const byId = new Map(merged.map((food) => [food.id, food]));
    expect(byId.get('banana-medium')).toMatchObject({ kcal: 110, hidden: true, useCount: 4, edited: false, source: 'repo' });
    expect(byId.get('egg-large')).toMatchObject({ name: 'My egg', kcal: 80, edited: true });
    expect(byId.get('oats')?.source).toBe('custom');
    expect(byId.has('yogurt')).toBe(false);
    expect(byId.get('rice')).toMatchObject({ name: 'Rice, edited', edited: true });
    expect(byId.get('apple')).toMatchObject({ source: 'repo', hidden: false, useCount: 0 });
  });

  it('keeps a custom food when a repo row reuses its id', () => {
    const custom = stored(banana, { source: 'custom', name: 'Banana bread' });
    const merged = mergeFoods([custom], [{ ...banana, name: 'Banana, medium' }], now);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Banana bread');
    expect(merged[0].source).toBe('custom');
  });

  it('reads the repo file and ignores a broken row', () => {
    const parsed = parseRepoFoods([
      banana,
      { id: 'bad', name: 'Nope' },
      { ...egg, id: '  egg-large  ' },
    ]);
    expect(parsed.map((food) => food.id)).toEqual(['banana-medium', 'egg-large']);
    expect(() => parseRepoFoods({ foods: [] })).toThrow(/array/);
  });

  it('matches the seeded foods.json schema', () => {
    const foods = parseRepoFoods(catalog);
    expect(foods).toHaveLength(33);
    expect(foods).toHaveLength(catalog.length);
    expect(new Set(foods.map((food) => food.id)).size).toBe(foods.length);
    expect(foods.find((food) => food.id === 'banana-medium')).toEqual({
      id: 'banana-medium',
      name: 'Banana, medium',
      serving: '1 medium (118 g)',
      kcal: 105,
      protein: 1.3,
      carbs: 27,
      fat: 0.4,
    });
    expect(foods.find((food) => food.id === 'egg-large')).toEqual({
      id: 'egg-large',
      name: 'Egg, large',
      serving: '1 large (50 g)',
      kcal: 72,
      protein: 6.3,
      carbs: 0.4,
      fat: 4.8,
    });
    expect(foods.find((food) => food.id === 'olive-oil')).toMatchObject({ kcal: 126, fat: 14, protein: 0, carbs: 0 });
    expect(foods.find((food) => food.id === 'yellowfin-tuna-sushi-grade')).toMatchObject({ protein: 34.6, fat: 0.7 });
    for (const food of foods) {
      expect(Object.keys(food).sort()).toEqual(['carbs', 'fat', 'id', 'kcal', 'name', 'protein', 'serving']);
    }
  });

  it('keeps a hidden id hidden across a foods.json merge, and shows it again after unhide', () => {
    const local = [stored(banana, { useCount: 2 })];
    const updated = { ...banana, kcal: 110, name: 'Banana, medium' };
    const hidden = mergeFoods(local, [updated, egg], now, ['banana-medium']);
    const bananaRow = hidden.find((food) => food.id === 'banana-medium');
    expect(bananaRow).toMatchObject({ hidden: true, kcal: 110, useCount: 2 });
    expect(hidden.find((food) => food.id === 'egg-large')?.hidden).toBe(false);
    const shown = mergeFoods(hidden, [updated, egg], now, []);
    expect(shown.find((food) => food.id === 'banana-medium')?.hidden).toBe(false);
    const logged = entry({ foodId: 'banana-medium', servings: 1, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 });
    expect(tally([logged]).kcal).toBe(105);
  });

  it('ranks recently and frequently used foods ahead of unused ones', () => {
    const today = '2026-11-21';
    const recent = stored(banana, { useCount: 1, lastUsedAt: '2026-11-20T08:00:00.000Z' });
    const often = stored(egg, { useCount: 20, lastUsedAt: '2026-11-01T08:00:00.000Z' });
    const unused = stored(repo({ id: 'apple', name: 'Apple' }));
    expect(usageRank(often, today)).toBeGreaterThan(usageRank(recent, today));
    expect(usageRank(recent, today)).toBeGreaterThan(usageRank(unused, today));
    expect(sortFoods([unused, recent, often], today).map((food) => food.id)).toEqual(['egg-large', 'banana-medium', 'apple']);
  });
});

describe('daily targets', () => {
  const file = parseTargets({
    updated: '2026-11-23T01:00:00.000Z',
    days: {
      '2026-11-23': {
        kcal: 2291,
        protein: 149,
        carbs: 139,
        fat: 126,
        day_type: 'easy',
        planned_kj: 406,
        actual_kj: null,
        revised: false,
        note: 'easy day',
      },
      '2026-11-24': {
        kcal: 2800,
        protein: 160,
        carbs: 300,
        fat: 90,
        day_type: 'hard',
        planned_kj: 800,
        actual_kj: 900,
        revised: true,
        note: '',
      },
    },
  });

  it('uses the file day, and a saved override wins', () => {
    expect(parseTargets({ updated: '2026-11-23T00:00:00.000Z', days: {} }).days).toEqual({});
    const fromFile = resolveDayTarget('2026-11-23', file, []);
    expect(fromFile).toMatchObject({ source: 'file', kcal: 2291, protein: 149, carbs: 139, fat: 126 });
    expect(fromFile?.plan?.planned_kj).toBe(406);
    expect(resolveDayTarget('2026-11-01', file, [])).toBeNull();
    const override = resolveDayTarget('2026-11-23', file, [{
      date: '2026-11-23',
      kcal: 2000,
      protein: 140,
      carbs: 150,
      fat: 70,
      updatedAt: now,
      override: true,
    }]);
    expect(override).toMatchObject({ source: 'override', kcal: 2000, protein: 140 });
    expect(override?.plan?.day_type).toBe('easy');
    expect(resolveDayTarget('2026-11-24', file, [])?.plan?.revised).toBe(true);
  });
});

describe('food backup', () => {
  it('round-trips foods and still imports a backup from before the food log', () => {
    const food = stored(repo({ id: 'oats', name: 'Oats', kcal: 150, protein: 5, carbs: 27, fat: 3 }), { source: 'custom' });
    const eaten = entry({ id: 'bowl', foodId: 'oats', name: 'Oats', servings: 1.5, kcal: 150, protein: 5, carbs: 27, fat: 3 });
    const target: FoodTarget = { date: '2026-11-21', kcal: 2400, protein: 160, carbs: null, fat: 70, updatedAt: now };
    const json = exportBackup({
      settings: defaultSettings(),
      checkins: [],
      workouts: [],
      benchmarks: [],
      foods: [food],
      foodEntries: [eaten],
      foodTargets: [target],
    });
    const detected = detectImport(json);
    expect(detected.kind).toBe('json');
    if (detected.kind !== 'json') return;
    expect(detected.backup.foods[0]).toMatchObject({ id: 'oats', name: 'Oats', source: 'custom', kcal: 150 });
    expect(detected.backup.foodEntries[0]).toMatchObject({ servings: 1.5, kcal: 150 });
    expect(detected.backup.foodTargets[0]).toMatchObject({ kcal: 2400, protein: 160, carbs: null, fat: 70 });
    expect(json).not.toMatch(/apiKey/i);

    const csv = exportFoodCsv(detected.backup.foodEntries, detected.backup.foodTargets);
    expect(csv.split('\n')[0]).toBe('date,kcal,protein_g,carbs_g,fat_g,target_kcal,target_protein_g,target_carbs_g,target_fat_g');
    expect(csv).toContain('2026-11-21,225,7.5,40.5,4.5,2400,160,,70');

    const old = detectImport(JSON.stringify({
      kind: 'daily-readiness',
      version: 1,
      checkins: [{ date: '2026-11-01', restingHr: 44, soreness: 2 }],
    }));
    expect(old.kind).toBe('json');
    if (old.kind !== 'json') return;
    expect(old.backup.checkins[0].restingHr).toBe(44);
    expect(old.backup.checkins[0].soreness).toBe(2);
    expect(old.backup.foods).toEqual([]);
    expect(old.backup.foodEntries).toEqual([]);
    expect(old.backup.foodTargets).toEqual([]);
  });
});
