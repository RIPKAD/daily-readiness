import { todayIso } from './dates';
import { defaultSettings } from './storage';
import type { Benchmark, CheckIn, Settings, WorkoutLog } from './types';

export type Route = 'today' | 'workout' | 'history' | 'settings';

export type State = {
  route: Route;
  date: string;
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  settings: Settings;
  apiKey: string;
  preview: boolean;
  ready: boolean;
  loadError: string | null;
};

export const state: State = {
  route: 'today',
  date: todayIso(),
  checkins: [],
  workouts: [],
  benchmarks: [],
  settings: defaultSettings(),
  apiKey: '',
  preview: false,
  ready: false,
  loadError: null,
};
