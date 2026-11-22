import type { MetricKey, WorkoutQuality } from './types';

export type ScaleOption = { value: number; label: string };

/**
 * Kaden's scales. Stored values are the numbers. Higher soreness, fatigue, and
 * stress are worse, and the score flips them. Sleep, mood, and overall feeling
 * are better when the number is higher.
 */
export const SLEEP_QUALITY: ScaleOption[] = [
  { value: 1, label: 'Horrible' },
  { value: 2, label: 'Poor' },
  { value: 3, label: 'Bad' },
  { value: 4, label: 'Average' },
  { value: 5, label: 'Good' },
  { value: 6, label: 'Better' },
  { value: 7, label: 'Best' },
];

export const SORENESS: ScaleOption[] = [
  { value: 1, label: 'None' },
  { value: 2, label: 'Extremely Low' },
  { value: 3, label: 'Very Low' },
  { value: 4, label: 'Low' },
  { value: 5, label: 'Moderately Low' },
  { value: 6, label: 'Moderate' },
  { value: 7, label: 'Moderately High' },
  { value: 8, label: 'High' },
];

export const FATIGUE: ScaleOption[] = [
  { value: 1, label: 'Very Low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Average' },
  { value: 4, label: 'High' },
  { value: 5, label: 'Very High' },
];

export const STRESS: ScaleOption[] = [
  { value: 1, label: 'None' },
  { value: 2, label: 'Very Low' },
  { value: 3, label: 'Low' },
  { value: 4, label: 'Average' },
  { value: 5, label: 'High' },
  { value: 6, label: 'Very High' },
  { value: 7, label: 'Extreme' },
];

export const MOOD: ScaleOption[] = [
  { value: 1, label: 'Worse than normal' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Better than normal' },
];

export const FEELING: ScaleOption[] = [
  { value: 1, label: 'Horrible' },
  { value: 2, label: 'Extremely Poor' },
  { value: 3, label: 'Poor' },
  { value: 4, label: 'Bad' },
  { value: 5, label: 'Below Average' },
  { value: 6, label: 'Above Average' },
  { value: 7, label: 'Good' },
  { value: 8, label: 'Superior' },
];

export const WORKOUT_QUALITY: { value: WorkoutQuality; label: string }[] = [
  { value: 1, label: 'Very weak' },
  { value: 3, label: 'Weak' },
  { value: 5, label: 'Normal' },
  { value: 7, label: 'Strong' },
  { value: 9, label: 'Very strong' },
];

export const SCALE_BY_METRIC: Record<
  'sleepQuality' | 'soreness' | 'fatigue' | 'stress' | 'mood' | 'feeling',
  ScaleOption[]
> = {
  sleepQuality: SLEEP_QUALITY,
  soreness: SORENESS,
  fatigue: FATIGUE,
  stress: STRESS,
  mood: MOOD,
  feeling: FEELING,
};

export function optionLabel(options: ScaleOption[], value: number | null): string {
  if (value == null) return '';
  const found = options.find((option) => option.value === value);
  return found ? found.label : String(value);
}

export type MetricMeta = {
  key: MetricKey;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  defaultWeight: number;
  hint: string;
};

export const METRICS: MetricMeta[] = [
  {
    key: 'restingHr',
    label: 'Resting HR',
    unit: 'bpm',
    higherIsBetter: false,
    defaultWeight: 1.5,
    hint: 'Lower than your usual is better.',
  },
  {
    key: 'hrvRmssd',
    label: 'HRV rMSSD',
    unit: 'ms',
    higherIsBetter: true,
    defaultWeight: 3,
    hint: 'Higher than your usual is better.',
  },
  {
    key: 'hrvSdnn',
    label: 'HRV SDNN',
    unit: 'ms',
    higherIsBetter: true,
    defaultWeight: 1.5,
    hint: 'Higher than your usual is better.',
  },
  {
    key: 'sleepQuality',
    label: 'Sleep quality',
    unit: '',
    higherIsBetter: true,
    defaultWeight: 1.5,
    hint: 'Higher means better sleep.',
  },
  {
    key: 'soreness',
    label: 'Soreness',
    unit: '',
    higherIsBetter: false,
    defaultWeight: 1.5,
    hint: 'Higher means more sore. The score flips this.',
  },
  {
    key: 'fatigue',
    label: 'Fatigue',
    unit: '',
    higherIsBetter: false,
    defaultWeight: 1.5,
    hint: 'Higher means more fatigued. The score flips this.',
  },
  {
    key: 'stress',
    label: 'Stress',
    unit: '',
    higherIsBetter: false,
    defaultWeight: 1.5,
    hint: 'Higher means more stress. The score flips this.',
  },
  {
    key: 'mood',
    label: 'Mood',
    unit: '',
    higherIsBetter: true,
    defaultWeight: 1,
    hint: 'Higher means a better mood.',
  },
  {
    key: 'feeling',
    label: 'Overall feeling',
    unit: '',
    higherIsBetter: true,
    defaultWeight: 3,
    hint: 'Higher means you feel better.',
  },
];

export function metricMeta(key: MetricKey): MetricMeta {
  const found = METRICS.find((metric) => metric.key === key);
  if (!found) throw new Error(`Unknown metric ${key}`);
  return found;
}

/** intervals.icu sleepQuality is 1 excellent … 4 poor. It is not copied into the 1–7 field. */
export const INTERVALS_SLEEP_QUALITY: Record<number, string> = {
  1: 'Excellent',
  2: 'Good',
  3: 'Average',
  4: 'Poor',
};
