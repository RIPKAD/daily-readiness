import { INTERVALS_SLEEP_QUALITY } from './scales';
import type { CheckIn } from './types';
import { kgToLb, lbToKg, roundTo } from './units';

export type IntervalsPrefill = {
  restingHr: number | null;
  hrvRmssd: number | null;
  hrvSdnn: number | null;
  weightLb: number | null;
  ctl: number | null;
  atl: number | null;
  sleepHours: number | null;
  intervalsSleepQuality: number | null;
  intervalsSleepLabel: string | null;
};

export type ActivitySummary = {
  id: string;
  name: string;
  type: string;
  date: string;
  movingSeconds: number | null;
  kj: number | null;
};

/**
 * Fields whose scales match intervals.icu one-to-one.
 * Sleep, soreness, stress, mood, and feeling use different scales, so they are omitted.
 */
export function wellnessPayload(checkin: Pick<CheckIn, 'restingHr' | 'hrvRmssd' | 'hrvSdnn' | 'weightLb'>): Record<string, number> {
  const body: Record<string, number> = {};
  if (isPositive(checkin.restingHr)) body.restingHR = Math.round(checkin.restingHr);
  if (isPositive(checkin.hrvRmssd)) body.hrv = roundTo(checkin.hrvRmssd, 2);
  if (isPositive(checkin.hrvSdnn)) body.hrvSDNN = roundTo(checkin.hrvSdnn, 2);
  if (isPositive(checkin.weightLb)) body.weight = roundTo(lbToKg(checkin.weightLb), 3);
  return body;
}

export function mapWellness(raw: unknown): IntervalsPrefill {
  const record = asRecord(raw);
  const sleepQuality = positiveInt(record?.sleepQuality);
  return {
    restingHr: metric(record?.restingHR),
    hrvRmssd: metric(record?.hrv),
    hrvSdnn: metric(record?.hrvSDNN),
    weightLb: metric(record?.weight) == null ? null : roundTo(kgToLb(metric(record?.weight)!), 1),
    ctl: load(record?.ctl),
    atl: load(record?.atl),
    sleepHours: metric(record?.sleepSecs) == null ? null : roundTo(metric(record?.sleepSecs)! / 3600, 2),
    intervalsSleepQuality: sleepQuality,
    intervalsSleepLabel: sleepQuality == null ? null : INTERVALS_SLEEP_QUALITY[sleepQuality] ?? null,
  };
}

export function mapWellnessList(raw: unknown): { date: string; prefill: IntervalsPrefill }[] {
  const rows = Array.isArray(raw) ? raw : [];
  const mapped: { date: string; prefill: IntervalsPrefill }[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const date = typeof record?.id === 'string' ? record.id.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    mapped.push({ date, prefill: mapWellness(row) });
  }
  return mapped;
}

export function mapActivities(raw: unknown, fallbackDate: string): ActivitySummary[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.flatMap((row) => {
    const record = asRecord(row);
    if (!record || record.id == null) return [];
    const local = typeof record.start_date_local === 'string' ? record.start_date_local.slice(0, 10) : fallbackDate;
    const joules = metric(record.icu_joules);
    return [{
      id: String(record.id),
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Activity',
      type: typeof record.type === 'string' ? record.type : 'Workout',
      date: /^\d{4}-\d{2}-\d{2}$/.test(local) ? local : fallbackDate,
      movingSeconds: metric(record.moving_time) == null ? null : Math.round(metric(record.moving_time)!),
      kj: joules == null ? null : roundTo(joules / 1000, 0),
    }];
  });
}

export function blankCheckIn(date: string, now = new Date().toISOString()): CheckIn {
  return {
    date,
    restingHr: null,
    hrvRmssd: null,
    hrvSdnn: null,
    weightLb: null,
    sleepQuality: null,
    soreness: null,
    stress: null,
    mood: null,
    feeling: null,
    note: '',
    ctl: null,
    atl: null,
    sleepHours: null,
    updatedAt: now,
    intervals: { state: 'local', message: '' },
  };
}

/** Fill empty objective fields. Subjective scores already on the phone are left as they are. */
export function applyPrefill(existing: CheckIn | undefined, date: string, prefill: IntervalsPrefill, now: string): CheckIn | null {
  const hasObjective = prefill.restingHr != null || prefill.hrvRmssd != null || prefill.hrvSdnn != null || prefill.weightLb != null;
  if (!existing && !hasObjective) return null;
  const next = existing ? { ...existing, intervals: { ...existing.intervals } } : blankCheckIn(date, now);
  let changed = !existing;
  changed = fill(next, 'restingHr', prefill.restingHr) || changed;
  changed = fill(next, 'hrvRmssd', prefill.hrvRmssd) || changed;
  changed = fill(next, 'hrvSdnn', prefill.hrvSdnn) || changed;
  changed = fill(next, 'weightLb', prefill.weightLb) || changed;
  changed = fill(next, 'ctl', prefill.ctl) || changed;
  changed = fill(next, 'atl', prefill.atl) || changed;
  changed = fill(next, 'sleepHours', prefill.sleepHours) || changed;
  if (!changed) return existing ?? null;
  next.updatedAt = now;
  if (!existing) next.intervals = { state: 'local', message: 'Imported from intervals.icu.' };
  return next;
}

function fill<K extends 'restingHr' | 'hrvRmssd' | 'hrvSdnn' | 'weightLb' | 'ctl' | 'atl' | 'sleepHours'>(
  checkin: CheckIn,
  key: K,
  value: CheckIn[K],
): boolean {
  if (checkin[key] != null || value == null) return false;
  checkin[key] = value;
  return true;
}

export function weekKj(activities: ActivitySummary[], start: string, end: string): number | null {
  const inWeek = activities.filter((activity) => activity.date >= start && activity.date <= end && activity.kj != null);
  if (!inWeek.length) return null;
  return inWeek.reduce((sum, activity) => sum + (activity.kj ?? 0), 0);
}

export function basicAuthHeader(apiKey: string): string {
  const bytes = new TextEncoder().encode(`API_KEY:${apiKey}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function normalizeApiKey(raw: string): string {
  let key = raw.trim();
  if (key.toLowerCase().startsWith('api_key:')) key = key.slice('api_key:'.length).trim();
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function metric(value: unknown): number | null {
  const number = numberOrNull(value);
  if (number == null || number === 0) return null;
  return number;
}

function load(value: unknown): number | null {
  return numberOrNull(value);
}

function positiveInt(value: unknown): number | null {
  const number = metric(value);
  if (number == null) return null;
  return Math.round(number);
}

function isPositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}
