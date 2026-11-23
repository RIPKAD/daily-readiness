import { todayIso } from './dates';
import type { TargetsFile } from './food';
import { defaultSettings } from './storage';
import type { Benchmark, CheckIn, Food, FoodEntry, FoodTarget, Settings, StrengthSession, StrengthTemplate, WorkoutLog } from './types';

export type Route = 'today' | 'food' | 'strength' | 'workout' | 'history' | 'settings';

export type State = {
  route: Route;
  date: string;
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods: Food[];
  foodEntries: FoodEntry[];
  foodTargets: FoodTarget[];
  strengthSessions: StrengthSession[];
  strengthTemplates: StrengthTemplate[];
  hiddenFoodIds: string[];
  plannedTargets: TargetsFile | null;
  settings: Settings;
  apiKey: string;
  preview: boolean;
  ready: boolean;
  loadError: string | null;
  foodCatalogError: string | null;
};

export const state: State = {
  route: 'today',
  date: todayIso(),
  checkins: [],
  workouts: [],
  benchmarks: [],
  foods: [],
  foodEntries: [],
  foodTargets: [],
  strengthSessions: [],
  strengthTemplates: [],
  hiddenFoodIds: [],
  plannedTargets: null,
  settings: defaultSettings(),
  apiKey: '',
  preview: false,
  ready: false,
  loadError: null,
  foodCatalogError: null,
};
