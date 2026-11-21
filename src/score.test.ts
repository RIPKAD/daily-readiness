import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  applySuggestion,
  bandFor,
  defaultWeights,
  MIN_BASELINE_DAYS,
  sampleStd,
  scoreDay,
  suggestWeights,
  type MetricReading,
} from './score';
import { metricMeta } from './scales';
import type { MetricKey, Settings } from './types';

function settings(weights = defaultWeights()): Settings {
  return { baselineDays: 42, weights, weeklyKjTarget: null };
}

function series(key: MetricKey, dates: string[], values: number[], today: { date: string; value: number }): MetricReading[] {
  return [
    ...dates.map((date, index) => ({ date, [key]: values[index] })),
    { date: today.date, [key]: today.value },
  ];
}

describe('score math', () => {
  it('starts with rMSSD and overall feeling weighted highest', () => {
    const weights = defaultWeights();
    const highest = Math.max(...Object.values(weights));
    expect(weights.hrvRmssd).toBe(highest);
    expect(weights.feeling).toBe(highest);
    expect(weights.hrvRmssd).toBeGreaterThan(weights.restingHr);
  });

  it('computes a hand-checked z-score and maps it to 50 + 15z', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'];
    const values = [40, 50, 60, 70, 80, 90, 100];
    const entries = series('hrvRmssd', dates, values, { date: '2026-01-08', value: 100 });
    const sd = Math.sqrt(2800 / 6);
    expect(sampleStd(values)).toBeCloseTo(sd, 8);
    const z = 30 / sd;
    const result = scoreDay(entries, '2026-01-08', settings());
    expect(result.status).toBe('ready');
    expect(result.weightedMeanZ).toBeCloseTo(z, 8);
    expect(result.score).toBeCloseTo(50 + 15 * z, 8);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0].points).toBeCloseTo(15 * z, 8);
    expect(result.contributions[0].points).toBeCloseTo((result.score ?? 0) - 50, 8);
    expect(result.band).toBe('green');
  });

  it('inverts soreness and resting HR so worse values lower the score', () => {
    const dates = Array.from({ length: 7 }, (_, index) => addDays('2026-02-01', index));
    const sore = scoreDay(
      series('soreness', dates, [1, 2, 1, 2, 1, 2, 1], { date: '2026-02-08', value: 8 }),
      '2026-02-08',
      settings(),
    );
    expect(sore.status).toBe('ready');
    expect(sore.contributions[0].z).toBeLessThan(0);
    expect(sore.contributions[0].points).toBeLessThan(0);
    expect(sore.score).toBeLessThan(50);

    const hr = scoreDay(
      series('restingHr', dates, [45, 46, 44, 45, 46, 45, 44], { date: '2026-02-08', value: 60 }),
      '2026-02-08',
      settings(),
    );
    expect(hr.contributions[0].points).toBeLessThan(0);
    expect(metricMeta('soreness').higherIsBetter).toBe(false);
    expect(metricMeta('stress').higherIsBetter).toBe(false);
    expect(metricMeta('hrvRmssd').higherIsBetter).toBe(true);
  });

  it('uses only the previous window and ignores the morning being scored', () => {
    const entries: MetricReading[] = [
      { date: '2026-01-17', hrvRmssd: 999 },
      ...Array.from({ length: 7 }, (_, index) => ({ date: addDays('2026-01-18', index), hrvRmssd: 50 })),
      { date: '2026-03-01', hrvRmssd: 50 },
    ];
    const result = scoreDay(entries, '2026-03-01', settings());
    expect(result.status).toBe('ready');
    expect(result.score).toBe(50);
    expect(result.contributions[0].baselineN).toBe(7);
    expect(result.contributions[0].mean).toBe(50);
  });

  it('says building baseline before seven prior days', () => {
    const dates = Array.from({ length: MIN_BASELINE_DAYS - 1 }, (_, index) => addDays('2026-04-01', index));
    const result = scoreDay(
      series('feeling', dates, dates.map(() => 6), { date: addDays(dates.at(-1)!, 1), value: 8 }),
      addDays(dates.at(-1)!, 1),
      settings(),
    );
    expect(result.status).toBe('building');
    expect(result.score).toBeNull();
    expect(result.waiting[0].have).toBe(6);
    expect(result.waiting[0].reason).toBe('baseline');
  });

  it('splits points across weights and clamps the ends', () => {
    const dates = Array.from({ length: 7 }, (_, index) => addDays('2026-05-01', index));
    const entries: MetricReading[] = dates.map((date, index) => ({
      date,
      hrvRmssd: 47 + index,
      feeling: index % 2 === 0 ? 5 : 3,
    }));
    entries.push({ date: '2026-05-08', hrvRmssd: 80, feeling: 1 });
    const weights = defaultWeights();
    weights.hrvRmssd = 3;
    weights.feeling = 1;
    for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
      if (key !== 'hrvRmssd' && key !== 'feeling') weights[key] = 0;
    }
    const result = scoreDay(entries, '2026-05-08', settings(weights));
    expect(result.status).toBe('ready');
    const points = result.contributions.reduce((sum, item) => sum + item.points, 0);
    const raw = 50 + points;
    expect(result.score).toBeCloseTo(Math.min(100, Math.max(0, raw)), 8);
    expect(result.contributions.find((item) => item.key === 'hrvRmssd')!.points).toBeGreaterThan(0);
    expect(result.contributions.find((item) => item.key === 'feeling')!.points).toBeLessThan(0);

    const extreme = scoreDay(
      series('hrvRmssd', dates, [40, 42, 38, 41, 39, 40, 43], { date: '2026-05-08', value: 400 }),
      '2026-05-08',
      settings(),
    );
    expect(extreme.score).toBe(100);
    const floor = scoreDay(
      series('hrvRmssd', dates, [80, 82, 78, 81, 79, 80, 83], { date: '2026-05-08', value: 5 }),
      '2026-05-08',
      settings(),
    );
    expect(floor.score).toBe(0);
    expect(bandFor(0)).toBe('red');
    expect(bandFor(39.9)).toBe('red');
    expect(bandFor(40)).toBe('amber');
    expect(bandFor(64.9)).toBe('amber');
    expect(bandFor(65)).toBe('green');
  });

  it('suggests weights from 40 paired days and does not apply them', () => {
    const entries: MetricReading[] = [];
    const workouts: { date: string; quality: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const date = addDays('2026-01-01', i);
      const feeling = (i % 8) + 1;
      entries.push({ date, feeling, soreness: 9 - feeling });
      workouts.push({ date, quality: feeling });
    }
    const current = settings();
    const snapshot = structuredClone(current);
    const suggestion = suggestWeights(entries, workouts, current);
    expect(current).toEqual(snapshot);
    expect(suggestion.ready).toBe(true);
    expect(suggestion.pairedDays).toBe(40);
    const feeling = suggestion.rows.find((row) => row.key === 'feeling')!;
    const soreness = suggestion.rows.find((row) => row.key === 'soreness')!;
    expect(feeling.r).toBeGreaterThan(0.9);
    expect(feeling.proposed).toBeGreaterThan(0);
    expect(soreness.r).toBeGreaterThan(0.9);
    expect(soreness.proposed).toBeGreaterThan(0);

    const tooSoon = suggestWeights(entries.slice(0, 39), workouts.slice(0, 39), current);
    expect(tooSoon.ready).toBe(false);
    expect(tooSoon.rows.every((row) => row.proposed == null)).toBe(true);

    const applied = applySuggestion(current, suggestion);
    expect(applied).not.toBe(current);
    expect(applied.weights.feeling).toBe(feeling.proposed);
    expect(current.weights.feeling).toBe(snapshot.weights.feeling);
  });

  it('gives a negative correlation a proposed weight of zero', () => {
    const entries: MetricReading[] = [];
    const workouts: { date: string; quality: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const date = addDays('2026-06-01', i);
      const feeling = (i % 8) + 1;
      entries.push({ date, feeling });
      workouts.push({ date, quality: 10 - feeling });
    }
    const suggestion = suggestWeights(entries, workouts, settings());
    const feeling = suggestion.rows.find((row) => row.key === 'feeling')!;
    expect(feeling.r).toBeLessThan(0);
    expect(feeling.proposed).toBe(0);
  });
});
