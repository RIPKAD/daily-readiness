import { isIsoDate } from './dates';
import { parseDelimited, parseHrvCsv, type HrvParseOk, type HrvRow } from './hrv';
import { blankCheckIn } from './intervals-map';
import { DEFAULT_BASELINE_DAYS, defaultWeights } from './score';
import { SCALE_BY_METRIC, WORKOUT_QUALITY } from './scales';
import { cleanFood, cleanFoodEntry, cleanFoodTarget } from './food';
import type { Benchmark, CheckIn, Food, FoodEntry, FoodTarget, MetricKey, Settings, WorkoutLog, WorkoutQuality } from './types';
import { METRIC_KEYS } from './types';

export type Backup = {
  settings: Settings | null;
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods: Food[];
  foodEntries: FoodEntry[];
  foodTargets: FoodTarget[];
  warnings: string[];
};

export type ImportKind =
  | { kind: 'json'; backup: Backup }
  | { kind: 'checkins'; checkins: CheckIn[]; warnings: string[] }
  | { kind: 'hrv'; result: HrvParseOk }
  | { kind: 'error'; error: string };

const CHECKIN_HEADER = [
  'date',
  'resting_hr_bpm',
  'hrv_rmssd_ms',
  'hrv_sdnn_ms',
  'weight_lb',
  'sleep_quality',
  'soreness',
  'fatigue',
  'stress',
  'mood',
  'feeling',
  'note',
  'ctl',
  'atl',
  'sleep_hours',
];

export function exportBackup(input: {
  settings: Settings;
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods?: Food[];
  foodEntries?: FoodEntry[];
  foodTargets?: FoodTarget[];
}, now = new Date().toISOString()): string {
  return JSON.stringify({
    kind: 'daily-readiness',
    version: 1,
    exportedAt: now,
    settings: {
      baselineDays: input.settings.baselineDays,
      weights: input.settings.weights,
      weeklyKjTarget: input.settings.weeklyKjTarget,
    },
    checkins: input.checkins,
    workouts: input.workouts,
    benchmarks: input.benchmarks,
    foods: input.foods ?? [],
    foodEntries: input.foodEntries ?? [],
    foodTargets: input.foodTargets ?? [],
  }, null, 2);
}

export function exportFoodCsv(entries: FoodEntry[], targets: FoodTarget[]): string {
  const lines = ['date,kcal,protein_g,carbs_g,fat_g,target_kcal,target_protein_g,target_carbs_g,target_fat_g'];
  const dates = new Set<string>([...entries.map((entry) => entry.date), ...targets.map((target) => target.date)]);
  const byDate = new Map(targets.map((target) => [target.date, target]));
  for (const date of [...dates].sort()) {
    const day = entries.filter((entry) => entry.date === date);
    const total = day.reduce(
      (sum, entry) => ({
        kcal: sum.kcal + entry.kcal * entry.servings,
        protein: sum.protein + entry.protein * entry.servings,
        carbs: sum.carbs + entry.carbs * entry.servings,
        fat: sum.fat + entry.fat * entry.servings,
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
    const target = byDate.get(date);
    lines.push([
      date,
      cell(roundCsv(total.kcal)),
      cell(roundCsv(total.protein)),
      cell(roundCsv(total.carbs)),
      cell(roundCsv(total.fat)),
      cell(target?.kcal),
      cell(target?.protein),
      cell(target?.carbs),
      cell(target?.fat),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

function roundCsv(value: number): number {
  return Math.round(value * 10) / 10;
}

export function exportCheckinsCsv(checkins: CheckIn[]): string {
  const lines = [CHECKIN_HEADER.join(',')];
  for (const checkin of [...checkins].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([
      checkin.date,
      cell(checkin.restingHr),
      cell(checkin.hrvRmssd),
      cell(checkin.hrvSdnn),
      cell(checkin.weightLb),
      cell(checkin.sleepQuality),
      cell(checkin.soreness),
      cell(checkin.fatigue),
      cell(checkin.stress),
      cell(checkin.mood),
      cell(checkin.feeling),
      cell(checkin.note),
      cell(checkin.ctl),
      cell(checkin.atl),
      cell(checkin.sleepHours),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function exportWorkoutsCsv(workouts: WorkoutLog[]): string {
  const lines = ['id,date,quality,activity_id,activity_name,note'];
  for (const workout of [...workouts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    lines.push([
      cell(workout.id),
      workout.date,
      String(workout.quality),
      cell(workout.activityId),
      cell(workout.activityName),
      cell(workout.note),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function detectImport(text: string): ImportKind {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { kind: 'error', error: 'The file is empty.' };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const backup = parseBackup(trimmed);
    return backup.ok ? { kind: 'json', backup: backup.backup } : { kind: 'error', error: backup.error };
  }
  const table = parseDelimited(trimmed);
  const header = (table[0] ?? []).map((value) => value.trim().toLowerCase());
  if (header.includes('resting_hr_bpm') || header.includes('weight_lb')) {
    return { kind: 'checkins', ...parseCheckinCsv(trimmed) };
  }
  const hrv = parseHrvCsv(trimmed);
  if (hrv.ok) return { kind: 'hrv', result: hrv };
  return { kind: 'error', error: hrv.error };
}

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The backup was not an object.' };
  const record = raw as Record<string, unknown>;
  if (record.kind && record.kind !== 'daily-readiness') {
    return { ok: false, error: 'This JSON is not a Daily readiness backup.' };
  }
  const warnings: string[] = [];
  if ('apiKey' in record || 'intervalsApiKey' in record) {
    warnings.push('An API key in the file was ignored. Paste it into Settings if you want it on this phone.');
  }
  const checkins = Array.isArray(record.checkins) ? record.checkins.flatMap((row) => cleanCheckin(row) ?? []) : [];
  const workouts = Array.isArray(record.workouts) ? record.workouts.flatMap((row) => cleanWorkout(row) ?? []) : [];
  const benchmarks = Array.isArray(record.benchmarks) ? record.benchmarks.flatMap((row) => cleanBenchmark(row) ?? []) : [];
  const foods = Array.isArray(record.foods) ? record.foods.flatMap((row) => cleanFood(row) ?? []) : [];
  const foodEntries = Array.isArray(record.foodEntries) ? record.foodEntries.flatMap((row) => cleanFoodEntry(row) ?? []) : [];
  const foodTargets = Array.isArray(record.foodTargets) ? record.foodTargets.flatMap((row) => cleanFoodTarget(row) ?? []) : [];
  return {
    ok: true,
    backup: {
      settings: cleanSettings(record.settings),
      checkins,
      workouts,
      benchmarks,
      foods,
      foodEntries,
      foodTargets,
      warnings,
    },
  };
}

export function mergeCheckins(current: CheckIn[], incoming: CheckIn[]): CheckIn[] {
  const map = new Map(current.map((checkin) => [checkin.date, checkin]));
  for (const checkin of incoming) map.set(checkin.date, checkin);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeHrvRows(current: CheckIn[], rows: HrvRow[], now: string): { checkins: CheckIn[]; updated: number; created: number } {
  const map = new Map(current.map((checkin) => [checkin.date, checkin]));
  let updated = 0;
  let created = 0;
  for (const row of rows) {
    const existing = map.get(row.date);
    const next = existing
      ? { ...existing, intervals: { ...existing.intervals } }
      : blankCheckIn(row.date, now);
    if (row.rmssd != null) next.hrvRmssd = row.rmssd;
    if (row.sdnn != null) next.hrvSdnn = row.sdnn;
    next.updatedAt = now;
    if (existing) updated += 1;
    else created += 1;
    map.set(row.date, next);
  }
  return {
    checkins: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)),
    updated,
    created,
  };
}

export function mergeBackup(current: {
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods?: Food[];
  foodEntries?: FoodEntry[];
  foodTargets?: FoodTarget[];
}, backup: Backup): {
  checkins: CheckIn[];
  workouts: WorkoutLog[];
  benchmarks: Benchmark[];
  foods: Food[];
  foodEntries: FoodEntry[];
  foodTargets: FoodTarget[];
} {
  const checkins = new Map(current.checkins.map((row) => [row.date, row]));
  for (const row of backup.checkins) checkins.set(row.date, row);
  const workouts = new Map(current.workouts.map((row) => [row.id, row]));
  for (const row of backup.workouts) workouts.set(row.id, row);
  const benchmarks = new Map(current.benchmarks.map((row) => [row.id, row]));
  for (const row of backup.benchmarks) benchmarks.set(row.id, row);
  const foods = new Map((current.foods ?? []).map((row) => [row.id, row]));
  for (const row of backup.foods) foods.set(row.id, row);
  const foodEntries = new Map((current.foodEntries ?? []).map((row) => [row.id, row]));
  for (const row of backup.foodEntries) foodEntries.set(row.id, row);
  const foodTargets = new Map((current.foodTargets ?? []).map((row) => [row.date, row]));
  for (const row of backup.foodTargets) foodTargets.set(row.date, row);
  return {
    checkins: [...checkins.values()].sort((a, b) => a.date.localeCompare(b.date)),
    workouts: [...workouts.values()].sort((a, b) => a.date.localeCompare(b.date)),
    benchmarks: [...benchmarks.values()].sort((a, b) => a.date.localeCompare(b.date)),
    foods: [...foods.values()].sort((a, b) => a.name.localeCompare(b.name)),
    foodEntries: [...foodEntries.values()].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
    foodTargets: [...foodTargets.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function parseCheckinCsv(text: string): { checkins: CheckIn[]; warnings: string[] } {
  const table = parseDelimited(text);
  const header = (table[0] ?? []).map((value) => value.trim().toLowerCase());
  const index = new Map(header.map((name, position) => [name, position]));
  const warnings: string[] = [];
  const checkins: CheckIn[] = [];
  for (const row of table.slice(1)) {
    const date = row[index.get('date') ?? 0] ?? '';
    if (!isIsoDate(date)) {
      warnings.push(`Skipped a row with date “${date.slice(0, 24)}”.`);
      continue;
    }
    const checkin = blankCheckIn(date);
    checkin.restingHr = numAt(row, index, 'resting_hr_bpm');
    checkin.hrvRmssd = numAt(row, index, 'hrv_rmssd_ms');
    checkin.hrvSdnn = numAt(row, index, 'hrv_sdnn_ms');
    checkin.weightLb = numAt(row, index, 'weight_lb');
    checkin.sleepQuality = scaleAt(row, index, 'sleep_quality', 'sleepQuality');
    checkin.soreness = scaleAt(row, index, 'soreness', 'soreness');
    checkin.fatigue = scaleAt(row, index, 'fatigue', 'fatigue');
    checkin.stress = scaleAt(row, index, 'stress', 'stress');
    checkin.mood = scaleAt(row, index, 'mood', 'mood');
    checkin.feeling = scaleAt(row, index, 'feeling', 'feeling');
    checkin.note = row[index.get('note') ?? -1] ?? '';
    checkin.ctl = numAt(row, index, 'ctl');
    checkin.atl = numAt(row, index, 'atl');
    checkin.sleepHours = numAt(row, index, 'sleep_hours');
    checkins.push(checkin);
  }
  return { checkins, warnings: warnings.slice(0, 6) };
}

function cleanCheckin(raw: unknown): CheckIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<CheckIn>;
  if (typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  const checkin = blankCheckIn(row.date, typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString());
  checkin.restingHr = num(row.restingHr);
  checkin.hrvRmssd = num(row.hrvRmssd);
  checkin.hrvSdnn = num(row.hrvSdnn);
  checkin.weightLb = num(row.weightLb);
  checkin.sleepQuality = scale(row.sleepQuality, 'sleepQuality');
  checkin.soreness = scale(row.soreness, 'soreness');
  checkin.fatigue = scale(row.fatigue, 'fatigue');
  checkin.stress = scale(row.stress, 'stress');
  checkin.mood = scale(row.mood, 'mood');
  checkin.feeling = scale(row.feeling, 'feeling');
  checkin.note = typeof row.note === 'string' ? row.note.slice(0, 2000) : '';
  checkin.ctl = num(row.ctl);
  checkin.atl = num(row.atl);
  checkin.sleepHours = num(row.sleepHours);
  if (row.intervals && typeof row.intervals === 'object') {
    const state = row.intervals.state;
    checkin.intervals = {
      state: state === 'synced' || state === 'failed' ? state : 'local',
      message: typeof row.intervals.message === 'string' ? row.intervals.message.slice(0, 300) : '',
      at: typeof row.intervals.at === 'string' ? row.intervals.at : undefined,
    };
  }
  return checkin;
}

function cleanWorkout(raw: unknown): WorkoutLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<WorkoutLog>;
  if (typeof row.id !== 'string' || typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  const quality = WORKOUT_QUALITY.find((option) => option.value === row.quality)?.value;
  if (!quality) return null;
  return {
    id: row.id,
    date: row.date,
    quality,
    activityId: typeof row.activityId === 'string' ? row.activityId : null,
    activityName: typeof row.activityName === 'string' ? row.activityName : null,
    note: typeof row.note === 'string' ? row.note.slice(0, 2000) : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    kj: num(row.kj),
    movingSeconds: num(row.movingSeconds),
    ...(row.isMain === true ? { isMain: true as const } : {}),
  };
}

function cleanBenchmark(raw: unknown): Benchmark | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<Benchmark>;
  if (typeof row.id !== 'string' || typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  if (typeof row.name !== 'string' || !row.name.trim()) return null;
  return {
    id: row.id,
    date: row.date,
    name: row.name.trim().slice(0, 120),
    result: typeof row.result === 'string' ? row.result.slice(0, 120) : '',
    notes: typeof row.notes === 'string' ? row.notes.slice(0, 2000) : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function cleanSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<Settings>;
  const weights = defaultWeights();
  if (row.weights && typeof row.weights === 'object') {
    for (const key of METRIC_KEYS) {
      const value = row.weights[key as MetricKey];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) weights[key] = value;
    }
  }
  const baseline = typeof row.baselineDays === 'number' && row.baselineDays >= 7 && row.baselineDays <= 365
    ? Math.round(row.baselineDays)
    : DEFAULT_BASELINE_DAYS;
  const target = typeof row.weeklyKjTarget === 'number' && row.weeklyKjTarget > 0 ? row.weeklyKjTarget : null;
  return { baselineDays: baseline, weights, weeklyKjTarget: target };
}

function num(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function scale(value: unknown, key: keyof typeof SCALE_BY_METRIC): number | null {
  if (typeof value !== 'number') return null;
  return SCALE_BY_METRIC[key].some((option) => option.value === value) ? value : null;
}

function numAt(row: string[], index: Map<string, number>, name: string): number | null {
  const position = index.get(name);
  if (position == null) return null;
  const text = (row[position] ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function scaleAt(row: string[], index: Map<string, number>, name: string, key: keyof typeof SCALE_BY_METRIC): number | null {
  const value = numAt(row, index, name);
  if (value == null) return null;
  return SCALE_BY_METRIC[key].some((option) => option.value === value) ? value : null;
}

function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function isWorkoutQuality(value: number): value is WorkoutQuality {
  return WORKOUT_QUALITY.some((option) => option.value === value);
}
