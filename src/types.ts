export type MetricKey =
  | 'restingHr'
  | 'hrvRmssd'
  | 'hrvSdnn'
  | 'sleepQuality'
  | 'soreness'
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
  'stress',
  'mood',
  'feeling',
];
