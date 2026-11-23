import { isIsoDate } from './dates';
import type { StrengthExercise, StrengthKind, StrengthSession, StrengthSet, StrengthTemplate } from './types';

export const KCAL_PER_MIN = 4.5;
export const DEFAULT_DURATION_MIN = 45;
export const WEIGHT_STEP_LB = 5;

export function estimatedKcal(durationMin: number): number {
  return durationMin * KCAL_PER_MIN;
}

export function liftMarker(sessions: StrengthSession[], date: string): string {
  const kinds = new Set(sessions.filter((session) => session.date === date).map((session) => session.kind));
  const labels: string[] = [];
  if (kinds.has('lower')) labels.push('Lift: Lower');
  if (kinds.has('upper')) labels.push('Lift: Upper');
  return labels.join(' · ');
}

export function defaultTemplates(): StrengthTemplate[] {
  return [
    {
      kind: 'lower',
      updatedAt: '2026-01-01T00:00:00.000Z',
      exercises: [
        {
          id: 'tpl-deadlift',
          name: 'Deadlift',
          sets: [
            ...[45, 75, 95, 115].map((weight, index) => setDef(`tpl-deadlift-wu-${index + 1}`, true, weight, 5)),
            ...[1, 2, 3].map((index) => setDef(`tpl-deadlift-work-${index}`, false, 165, 3)),
          ],
        },
      ],
    },
    {
      kind: 'upper',
      updatedAt: '2026-01-01T00:00:00.000Z',
      exercises: [
        exerciseDef('tpl-incline', 'Incline bench press', 5, 95, 6),
        exerciseDef('tpl-face-pull', 'Cable face-pull', 5, 25, 10),
        exerciseDef('tpl-fly', 'Chest fly machine', 5, 100, 10),
        exerciseDef('tpl-pulldown', 'Lat pulldown', 5, 100, 10),
      ],
    },
  ];
}

export function templatesOrSeed(saved: StrengthTemplate[]): StrengthTemplate[] {
  const seeds = defaultTemplates();
  return seeds.map((seed) => saved.find((template) => template.kind === seed.kind) ?? seed);
}

export function startSession(
  kind: StrengthKind,
  sessions: StrengthSession[],
  templates: StrengthTemplate[],
  date: string,
  now: string,
  id: () => string,
): StrengthSession {
  const last = lastSession(sessions, kind);
  const plan = last?.exercises ?? templatesOrSeed(templates).find((template) => template.kind === kind)?.exercises ?? [];
  return {
    id: id(),
    date,
    kind,
    exercises: plan.map((exercise) => ({
      id: id(),
      name: exercise.name,
      sets: exercise.sets.map((set) => ({
        id: id(),
        warmup: set.warmup,
        weightLb: set.weightLb,
        reps: set.reps,
        prescribedReps: set.reps,
        completed: false,
        missed: false,
      })),
    })),
    rpe: null,
    durationMin: DEFAULT_DURATION_MIN,
    notes: '',
    estKcal: estimatedKcal(DEFAULT_DURATION_MIN),
    updatedAt: now,
  };
}

export function lastSession(sessions: StrengthSession[], kind: StrengthKind): StrengthSession | null {
  return [...sessions]
    .filter((session) => session.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export type TopSet = { weightLb: number; reps: number };

export function topSet(exercise: StrengthExercise): TopSet | null {
  const done = exercise.sets.filter((set) => !set.warmup && set.completed && !set.missed);
  if (!done.length) return null;
  return done.reduce((best, set) => {
    if (set.weightLb > best.weightLb) return { weightLb: set.weightLb, reps: set.reps };
    if (set.weightLb === best.weightLb && set.reps > best.reps) return { weightLb: set.weightLb, reps: set.reps };
    return best;
  }, { weightLb: done[0].weightLb, reps: done[0].reps });
}

export function setReferences(sessions: StrengthSession[], exerciseName: string, excludeId?: string): { last: TopSet | null; best: TopSet | null } {
  const name = exerciseName.trim().toLowerCase();
  const matching = [...sessions]
    .filter((session) => session.id !== excludeId)
    .filter((session) => session.exercises.some((exercise) => exercise.name.trim().toLowerCase() === name))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const tops = matching
    .map((session) => session.exercises.find((exercise) => exercise.name.trim().toLowerCase() === name))
    .map((exercise) => (exercise ? topSet(exercise) : null))
    .filter((set): set is TopSet => set != null);
  const best = tops.reduce<TopSet | null>((current, set) => {
    if (!current) return set;
    if (set.weightLb > current.weightLb) return set;
    if (set.weightLb === current.weightLb && set.reps > current.reps) return set;
    return current;
  }, null);
  return { last: tops[0] ?? null, best };
}

/** Every working set in each of the last two sessions was finished at the prescribed reps. */
export function progressionReady(sessions: StrengthSession[], exerciseName: string, excludeId?: string): boolean {
  const name = exerciseName.trim().toLowerCase();
  const recent = [...sessions]
    .filter((session) => session.id !== excludeId)
    .filter((session) => session.exercises.some((exercise) => exercise.name.trim().toLowerCase() === name))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2);
  if (recent.length < 2) return false;
  return recent.every((session) => {
    const exercise = session.exercises.find((item) => item.name.trim().toLowerCase() === name);
    const working = exercise?.sets.filter((set) => !set.warmup) ?? [];
    return working.length > 0 && working.every((set) => set.completed && !set.missed && set.reps >= set.prescribedReps);
  });
}

export function applyPlusFive(exercise: StrengthExercise): StrengthExercise {
  return {
    ...exercise,
    sets: exercise.sets.map((set) => set.warmup ? set : { ...set, weightLb: set.weightLb + WEIGHT_STEP_LB }),
  };
}

export function exerciseSummary(exercise: StrengthExercise): string {
  const working = exercise.sets.filter((set) => !set.warmup);
  const sets = working.length ? working : exercise.sets;
  if (!sets.length) return exercise.name;
  const first = sets[0];
  const same = sets.every((set) => set.weightLb === first.weightLb && set.reps === first.reps);
  if (same) return `${exercise.name} ${sets.length} x ${first.reps} @ ${first.weightLb} lb`;
  return `${exercise.name} ${sets.map((set) => `${set.reps} @ ${set.weightLb}`).join(', ')} lb`;
}

export function exportStrengthCsv(sessions: StrengthSession[]): string {
  const lines = ['date,session_type,exercise,set_number,warmup,weight_lb,reps,completed,rpe,duration_min,est_kcal'];
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  for (const session of ordered) {
    const kcal = Number.isFinite(session.estKcal) ? session.estKcal : estimatedKcal(session.durationMin);
    for (const exercise of session.exercises) {
      exercise.sets.forEach((set, index) => {
        lines.push([
          session.date,
          session.kind,
          csvCell(exercise.name),
          String(index + 1),
          set.warmup ? 'true' : 'false',
          String(set.weightLb),
          String(set.reps),
          set.completed ? 'true' : 'false',
          session.rpe == null ? '' : String(session.rpe),
          String(session.durationMin),
          String(kcal),
        ].join(','));
      });
    }
  }
  return `${lines.join('\n')}\n`;
}

export function cleanStrengthSession(raw: unknown): StrengthSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<StrengthSession>;
  if (row.kind !== 'lower' && row.kind !== 'upper') return null;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.date !== 'string' || !isIsoDate(row.date)) return null;
  const exercises = cleanExercises(row.exercises);
  if (!exercises) return null;
  const durationMin = typeof row.durationMin === 'number' && Number.isFinite(row.durationMin) && row.durationMin >= 0
    ? row.durationMin
    : DEFAULT_DURATION_MIN;
  const rpe = typeof row.rpe === 'number' && Number.isInteger(row.rpe) && row.rpe >= 1 && row.rpe <= 10 ? row.rpe : null;
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    exercises,
    rpe,
    durationMin,
    notes: typeof row.notes === 'string' ? row.notes.slice(0, 2000) : '',
    estKcal: estimatedKcal(durationMin),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function cleanStrengthTemplate(raw: unknown): StrengthTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<StrengthTemplate>;
  if (row.kind !== 'lower' && row.kind !== 'upper') return null;
  const exercises = cleanExercises(row.exercises);
  if (!exercises) return null;
  return {
    kind: row.kind,
    exercises,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

function exerciseDef(id: string, name: string, count: number, weight: number, reps: number): StrengthExercise {
  return {
    id,
    name,
    sets: Array.from({ length: count }, (_, index) => setDef(`${id}-${index + 1}`, false, weight, reps)),
  };
}

function setDef(id: string, warmup: boolean, weightLb: number, reps: number): StrengthSet {
  return { id, warmup, weightLb, reps, prescribedReps: reps, completed: false, missed: false };
}

function cleanExercises(raw: unknown): StrengthExercise[] | null {
  if (!Array.isArray(raw)) return null;
  const exercises: StrengthExercise[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Partial<StrengthExercise>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !row.name.trim()) return null;
    if (!Array.isArray(row.sets)) return null;
    const sets: StrengthSet[] = [];
    for (const setRaw of row.sets) {
      const set = cleanSet(setRaw);
      if (!set) return null;
      sets.push(set);
    }
    exercises.push({ id: row.id, name: row.name.trim(), sets });
  }
  return exercises;
}

function cleanSet(raw: unknown): StrengthSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<StrengthSet>;
  if (typeof row.id !== 'string') return null;
  if (typeof row.weightLb !== 'number' || !Number.isFinite(row.weightLb) || row.weightLb < 0) return null;
  if (typeof row.reps !== 'number' || !Number.isFinite(row.reps) || row.reps < 0) return null;
  const prescribed = typeof row.prescribedReps === 'number' && Number.isFinite(row.prescribedReps) && row.prescribedReps >= 0
    ? row.prescribedReps
    : row.reps;
  return {
    id: row.id,
    warmup: row.warmup === true,
    weightLb: row.weightLb,
    reps: row.reps,
    prescribedReps: prescribed,
    completed: row.completed === true,
    missed: row.missed === true,
  };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
