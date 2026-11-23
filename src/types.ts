export type MetricKey =
  | 'restingHr'
  | 'hrvRmssd'
  | 'hrvSdnn'
  | 'sleepQuality'
  | 'soreness'
  | 'fatigue'
  | 'stress'
  | 'mood'
  | 'feeling';

export type WorkoutQuality = 1 | 3 | 5 | 7 | 9;

export type IntervalsSync = {
  state: 'local' | 'synced' | 'failed';
  message: string;
  at?: string;
};

/** One morning. Subjective scales stay on the 1–7 / 1–8 / 1–3 labels in scales.ts. */
export type CheckIn = {
  date: string;
  restingHr: number | null;
  hrvRmssd: number | null;
  hrvSdnn: number | null;
  weightLb: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  fatigue: number | null;
  stress: number | null;
  mood: number | null;
  feeling: number | null;
  note: string;
  /** From intervals.icu. Not part of the score. */
  ctl: number | null;
  atl: number | null;
  /** Hours, from intervals sleepSecs. Not part of the score. */
  sleepHours: number | null;
  updatedAt: string;
  intervals: IntervalsSync;
};

export type WorkoutLog = {
  id: string;
  date: string;
  quality: WorkoutQuality;
  activityId: string | null;
  activityName: string | null;
  note: string;
  updatedAt: string;
  /** Kilojoules from the linked intervals.icu activity. Missing on logs saved before this field existed. */
  kj?: number | null;
  /** Moving time in seconds from the linked activity. Missing on older logs. */
  movingSeconds?: number | null;
  /** When set, this log is the day's main workout ahead of a longer session. */
  isMain?: boolean;
};

/** One row of public/foods.json. Numbers are for a single serving. */
export type FoodCatalogItem = {
  id: string;
  name: string;
  serving: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** A common food on this phone. Repo rows can be hidden or edited locally. */
export type Food = FoodCatalogItem & {
  source: 'repo' | 'custom';
  edited: boolean;
  hidden: boolean;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
};

/** One thing eaten. Macros are per serving; the day's tally multiplies by servings. */
export type FoodEntry = {
  id: string;
  date: string;
  foodId: string | null;
  name: string;
  serving: string;
  servings: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  updatedAt: string;
};

/** Targets apply to this date only. Null means that macro has no target. */
export type FoodTarget = {
  date: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  updatedAt: string;
};

export type StrengthKind = 'lower' | 'upper';

export type StrengthSet = {
  id: string;
  warmup: boolean;
  weightLb: number;
  reps: number;
  /** Reps the set was planned at. Stepper changes `reps` without moving this. */
  prescribedReps: number;
  completed: boolean;
  missed: boolean;
};

export type StrengthExercise = {
  id: string;
  name: string;
  sets: StrengthSet[];
};

export type StrengthTemplate = {
  kind: StrengthKind;
  exercises: StrengthExercise[];
  updatedAt: string;
};

export type StrengthSession = {
  id: string;
  date: string;
  kind: StrengthKind;
  exercises: StrengthExercise[];
  rpe: number | null;
  durationMin: number;
  notes: string;
  /** durationMin × 4.5. Not a workout-log entry and not sent to intervals.icu. */
  estKcal: number;
  updatedAt: string;
};

export type Benchmark = {
  id: string;
  date: string;
  name: string;
  result: string;
  notes: string;
  updatedAt: string;
};

export type Settings = {
  baselineDays: number;
  weights: Record<MetricKey, number>;
  /** Optional weekly mechanical work target, in kJ. Blank means no target. */
  weeklyKjTarget: number | null;
};

export const METRIC_KEYS: MetricKey[] = [
  'restingHr',
  'hrvRmssd',
  'hrvSdnn',
  'sleepQuality',
  'soreness',
  'fatigue',
  'stress',
  'mood',
  'feeling',
];
