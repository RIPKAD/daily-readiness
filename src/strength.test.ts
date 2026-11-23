import { describe, expect, it } from 'vitest';
import { detectImport } from './exchange';
import {
  applyPlusFive,
  defaultTemplates,
  estimatedKcal,
  exerciseSummary,
  exportStrengthCsv,
  KCAL_PER_MIN,
  liftMarker,
  progressionReady,
  startSession,
  topSet,
} from './strength';
import type { StrengthExercise, StrengthSession, StrengthSet } from './types';

function ids(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

function working(name: string, sets: Array<Partial<StrengthSet> & Pick<StrengthSet, 'weightLb' | 'reps'>>): StrengthExercise {
  return {
    id: name,
    name,
    sets: sets.map((set, index) => ({
      id: `${name}-${index}`,
      warmup: false,
      prescribedReps: set.prescribedReps ?? set.reps,
      completed: set.completed ?? false,
      missed: set.missed ?? false,
      weightLb: set.weightLb,
      reps: set.reps,
    })),
  };
}

function session(partial: Partial<StrengthSession> & Pick<StrengthSession, 'id' | 'date' | 'exercises'>): StrengthSession {
  return {
    kind: 'lower',
    rpe: null,
    durationMin: 45,
    notes: '',
    estKcal: estimatedKcal(45),
    updatedAt: `${partial.date}T12:00:00.000Z`,
    ...partial,
  };
}

describe('strength sessions', () => {
  it('prefills from the template, then from the last logged session of that type', () => {
    const templates = defaultTemplates();
    const first = startSession('lower', [], templates, '2026-11-23', '2026-11-23T08:00:00.000Z', ids());
    const deadlift = first.exercises[0];
    expect(exerciseSummary(deadlift)).toBe('Deadlift 3 x 3 @ 165 lb');
    expect(deadlift.sets.filter((set) => set.warmup).map((set) => set.weightLb)).toEqual([45, 75, 95, 115]);
    expect(deadlift.sets.every((set) => !set.completed && !set.missed)).toBe(true);
    expect(first.durationMin).toBe(45);
    expect(first.estKcal).toBe(45 * KCAL_PER_MIN);
    expect(first).not.toHaveProperty('quality');

    const logged = session({
      id: 'logged',
      date: '2026-11-23',
      exercises: [working('Deadlift', [
        { weightLb: 45, reps: 5, warmup: true },
        { weightLb: 170, reps: 3, completed: true },
        { weightLb: 170, reps: 3, completed: true },
        { weightLb: 170, reps: 3, completed: true },
      ])],
    });
    logged.exercises[0].sets[0].warmup = true;
    const next = startSession('lower', [logged], templates, '2026-11-24', '2026-11-24T08:00:00.000Z', ids());
    expect(exerciseSummary(next.exercises[0])).toBe('Deadlift 3 x 3 @ 170 lb');
    expect(next.exercises[0].sets.every((set) => !set.completed)).toBe(true);
    expect(startSession('upper', [logged], templates, '2026-11-24', '2026-11-24T08:00:00.000Z', ids()).exercises.map((exercise) => exercise.name)).toEqual([
      'Incline bench press',
      'Cable face-pull',
      'Chest fly machine',
      'Lat pulldown',
    ]);
  });

  it('suggests +5 lb only after two completed sessions at the prescribed reps', () => {
    const done = (date: string, reps = 3) => session({
      id: date,
      date,
      exercises: [working('Deadlift', [
        { weightLb: 165, reps, prescribedReps: 3, completed: true },
        { weightLb: 165, reps, prescribedReps: 3, completed: true },
        { weightLb: 165, reps, prescribedReps: 3, completed: true },
      ])],
    });
    const pair = [done('2026-11-01'), done('2026-11-04')];
    expect(progressionReady(pair, 'Deadlift')).toBe(true);
    expect(progressionReady([done('2026-11-04')], 'Deadlift')).toBe(false);
    const missed = done('2026-11-04');
    missed.exercises[0].sets[2].missed = true;
    missed.exercises[0].sets[2].completed = false;
    expect(progressionReady([done('2026-11-01'), missed], 'Deadlift')).toBe(false);
    expect(progressionReady([done('2026-11-01'), done('2026-11-04', 2)], 'Deadlift')).toBe(false);

    const bumped = applyPlusFive(pair[1].exercises[0]);
    expect(bumped.sets.map((set) => set.weightLb)).toEqual([170, 170, 170]);
    const withWarmup = working('Deadlift', [
      { weightLb: 95, reps: 5, completed: true },
      { weightLb: 165, reps: 3, completed: true },
    ]);
    withWarmup.sets[0].warmup = true;
    expect(applyPlusFive(withWarmup).sets.map((set) => set.weightLb)).toEqual([95, 170]);
    expect(topSet(pair[1].exercises[0])).toEqual({ weightLb: 165, reps: 3 });
  });

  it('exports one csv row per set with estimated kcal', () => {
    const lower = session({
      id: 's1',
      date: '2026-11-23',
      rpe: 7,
      durationMin: 45,
      estKcal: estimatedKcal(45),
      exercises: [working('Deadlift', [
        { weightLb: 45, reps: 5 },
        { weightLb: 165, reps: 3, completed: true },
      ])],
    });
    lower.exercises[0].sets[0].warmup = true;
    const csv = exportStrengthCsv([lower]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('date,session_type,exercise,set_number,warmup,weight_lb,reps,completed,rpe,duration_min,est_kcal');
    expect(lines[1]).toBe('2026-11-23,lower,Deadlift,1,true,45,5,false,7,45,202.5');
    expect(lines[2]).toBe('2026-11-23,lower,Deadlift,2,false,165,3,true,7,45,202.5');
    expect(liftMarker([lower], '2026-11-23')).toBe('Lift: Lower');
    expect(estimatedKcal(45)).toBe(202.5);
  });

  it('imports an older backup that has no strength log', () => {
    const detected = detectImport(JSON.stringify({
      kind: 'daily-readiness',
      checkins: [{ date: '2026-11-01', restingHr: 44 }],
    }));
    expect(detected.kind).toBe('json');
    if (detected.kind !== 'json') return;
    expect(detected.backup.strengthSessions).toEqual([]);
    expect(detected.backup.strengthTemplates).toEqual([]);
    expect(detected.backup.checkins[0].restingHr).toBe(44);
  });
});
