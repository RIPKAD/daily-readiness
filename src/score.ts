import { addDays } from './dates';
import { METRICS, metricMeta } from './scales';
import type { MetricKey, Settings } from './types';
import { METRIC_KEYS } from './types';

export const MIN_BASELINE_DAYS = 7;
export const DEFAULT_BASELINE_DAYS = 42;
export const SUGGEST_MIN_PAIRS = 40;
export const MIN_METRIC_PAIRS = 20;
export const SCORE_CENTER = 50;
export const SCORE_GAIN = 15;

export type Band = 'green' | 'amber' | 'red';

export type MetricReading = { date: string } & Partial<Record<MetricKey, number | null>>;

export type Contribution = {
  key: MetricKey;
  label: string;
  value: number;
  z: number;
  weight: number;
  points: number;
  baselineN: number;
  mean: number;
  sd: number;
};

export type Waiting = {
  key: MetricKey;
  label: string;
  have: number;
  need: number;
  reason: 'baseline' | 'weight';
};

export type ScoreResult = {
  status: 'empty' | 'building' | 'no-weight' | 'ready';
  score: number | null;
  band: Band | null;
  weightedMeanZ: number | null;
  contributions: Contribution[];
  waiting: Waiting[];
};

export function defaultWeights(): Record<MetricKey, number> {
  const weights = {} as Record<MetricKey, number>;
  for (const metric of METRICS) weights[metric.key] = metric.defaultWeight;
  return weights;
}

export function bandFor(score: number): Band {
  if (score >= 65) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

export function bandLabel(band: Band): string {
  if (band === 'green') return 'Ready';
  if (band === 'amber') return 'Steady';
  return 'Easy day';
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n − 1). Returns 0 when n < 2. */
export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  const ss = values.reduce((sum, value) => sum + (value - center) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function baselineValues(entries: MetricReading[], key: MetricKey, date: string, windowDays: number): number[] {
  const start = addDays(date, -windowDays);
  const values: number[] = [];
  for (const entry of entries) {
    if (entry.date < start || entry.date >= date) continue;
    const value = finiteOrNull(entry[key]);
    if (value != null) values.push(value);
  }
  return values;
}

/**
 * Score one morning against prior days only.
 * Positive z means more ready: low resting HR, low soreness, low stress, high HRV and feelings.
 * score = clamp(50 + 15 × weighted mean z, 0, 100).
 * Each contribution's points are that metric's share of (score − 50) before clamping.
 */
export function scoreDay(entries: MetricReading[], date: string, settings: Pick<Settings, 'baselineDays' | 'weights'>): ScoreResult {
  const windowDays = Math.max(MIN_BASELINE_DAYS, settings.baselineDays || DEFAULT_BASELINE_DAYS);
  const today = entries.find((entry) => entry.date === date);
  const contributions: Contribution[] = [];
  const waiting: Waiting[] = [];

  if (!today) {
    return { status: 'empty', score: null, band: null, weightedMeanZ: null, contributions, waiting };
  }

  for (const key of METRIC_KEYS) {
    const value = finiteOrNull(today[key]);
    if (value == null) continue;
    const meta = metricMeta(key);
    const history = baselineValues(entries, key, date, windowDays);
    if (history.length < MIN_BASELINE_DAYS) {
      waiting.push({ key, label: meta.label, have: history.length, need: MIN_BASELINE_DAYS, reason: 'baseline' });
      continue;
    }
    const weight = settings.weights[key] ?? 0;
    if (!(weight > 0)) {
      waiting.push({ key, label: meta.label, have: history.length, need: MIN_BASELINE_DAYS, reason: 'weight' });
      continue;
    }
    const center = mean(history);
    const sd = sampleStd(history);
    const rawZ = sd === 0 ? 0 : (value - center) / sd;
    const z = meta.higherIsBetter ? rawZ : -rawZ;
    contributions.push({
      key,
      label: meta.label,
      value,
      z,
      weight,
      points: 0,
      baselineN: history.length,
      mean: center,
      sd,
    });
  }

  if (!contributions.length) {
    const status = waiting.some((item) => item.reason === 'baseline')
      ? 'building'
      : waiting.some((item) => item.reason === 'weight')
        ? 'no-weight'
        : 'empty';
    return { status, score: null, band: null, weightedMeanZ: null, contributions, waiting };
  }

  const weightSum = contributions.reduce((sum, item) => sum + item.weight, 0);
  const weightedZ = contributions.reduce((sum, item) => sum + item.weight * item.z, 0) / weightSum;
  for (const item of contributions) {
    item.points = (SCORE_GAIN * item.weight * item.z) / weightSum;
  }
  const raw = SCORE_CENTER + SCORE_GAIN * weightedZ;
  const score = Math.min(100, Math.max(0, raw));
  return {
    status: 'ready',
    score,
    band: bandFor(score),
    weightedMeanZ: weightedZ,
    contributions,
    waiting,
  };
}

export type SuggestionRow = {
  key: MetricKey;
  label: string;
  pairs: number;
  r: number | null;
  current: number;
  proposed: number | null;
};

export type WeightSuggestion = {
  ready: boolean;
  pairedDays: number;
  needed: number;
  rows: SuggestionRow[];
};

export type WorkoutPair = {
  date: string;
  quality: number;
  kj?: number | null;
  movingSeconds?: number | null;
  isMain?: boolean;
  updatedAt?: string;
};

type MainWorkoutFields = {
  date: string;
  kj?: number | null;
  movingSeconds?: number | null;
  isMain?: boolean;
  updatedAt?: string;
};

/**
 * One log per date. A log marked main wins. Otherwise the highest kilojoule
 * log wins, then the longest moving time, then the most recently updated log.
 * Logs saved before kilojoules were stored still compare on the fields they have.
 */
export function mainWorkoutByDate<T extends MainWorkoutFields>(workouts: readonly T[]): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const workout of workouts) {
    const group = grouped.get(workout.date);
    if (group) group.push(workout);
    else grouped.set(workout.date, [workout]);
  }
  const picked = new Map<string, T>();
  for (const [date, group] of grouped) {
    const marked = group.filter((workout) => workout.isMain === true);
    const pool = marked.length > 0 ? marked : group;
    picked.set(date, [...pool].sort(compareMain)[0]);
  }
  return picked;
}

function compareMain(a: MainWorkoutFields, b: MainWorkoutFields): number {
  const byKj = preferHigher(finiteOrMissing(a.kj), finiteOrMissing(b.kj));
  if (byKj !== 0) return byKj;
  const byMoving = preferHigher(finiteOrMissing(a.movingSeconds), finiteOrMissing(b.movingSeconds));
  if (byMoving !== 0) return byMoving;
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
}

function finiteOrMissing(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Sort comparator: the higher present number comes first. A missing value loses to any number. */
function preferHigher(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/**
 * Correlate each readiness-oriented metric with the main workout's quality
 * on the same date. A second session that day is left out.
 * Proposed weights are max(0, r), rescaled to the current weight total of the
 * metrics that received a proposal. This function does not write settings.
 */
export function suggestWeights(
  entries: MetricReading[],
  workouts: WorkoutPair[],
  settings: Pick<Settings, 'weights'>,
): WeightSuggestion {
  const qualityByDate = new Map<string, number>();
  for (const workout of mainWorkoutByDate(workouts).values()) {
    if (!Number.isFinite(workout.quality)) continue;
    qualityByDate.set(workout.date, workout.quality);
  }
  const pairedDates = entries
    .map((entry) => entry.date)
    .filter((date, index, all) => all.indexOf(date) === index)
    .filter((date) => qualityByDate.has(date))
    .sort();

  const rows: SuggestionRow[] = METRIC_KEYS.map((key) => ({
    key,
    label: metricMeta(key).label,
    pairs: 0,
    r: null,
    current: settings.weights[key] ?? 0,
    proposed: null,
  }));

  if (pairedDates.length < SUGGEST_MIN_PAIRS) {
    return { ready: false, pairedDays: pairedDates.length, needed: SUGGEST_MIN_PAIRS, rows };
  }

  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  for (const row of rows) {
    const meta = metricMeta(row.key);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const date of pairedDates) {
      const value = finiteOrNull(byDate.get(date)?.[row.key]);
      const quality = qualityByDate.get(date);
      if (value == null || quality == null) continue;
      xs.push(meta.higherIsBetter ? value : -value);
      ys.push(quality);
    }
    row.pairs = xs.length;
    if (xs.length < MIN_METRIC_PAIRS) continue;
    row.r = pearson(xs, ys);
    if (row.r == null) continue;
    row.proposed = Math.max(0, row.r);
  }

  const proposedRows = rows.filter((row) => row.proposed != null);
  const rawSum = proposedRows.reduce((sum, row) => sum + (row.proposed ?? 0), 0);
  const currentSum = proposedRows.reduce((sum, row) => sum + row.current, 0);
  const target = currentSum > 0 ? currentSum : proposedRows.length;
  if (rawSum > 0) {
    for (const row of proposedRows) {
      row.proposed = ((row.proposed ?? 0) / rawSum) * target;
    }
  } else {
    for (const row of proposedRows) row.proposed = 0;
  }
  for (const row of proposedRows) {
    row.proposed = Math.round((row.proposed ?? 0) * 10) / 10;
  }

  return { ready: true, pairedDays: pairedDates.length, needed: SUGGEST_MIN_PAIRS, rows };
}

export function applySuggestion(settings: Settings, suggestion: WeightSuggestion): Settings {
  const weights = { ...settings.weights };
  if (suggestion.ready) {
    for (const row of suggestion.rows) {
      if (row.proposed != null) weights[row.key] = row.proposed;
    }
  }
  return { ...settings, weights };
}
