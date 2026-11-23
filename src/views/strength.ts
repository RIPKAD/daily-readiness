import { isIsoDate, todayIso } from '../dates';
import { state } from '../state';
import { persistDatabase } from '../storage';
import {
  applyPlusFive,
  DEFAULT_DURATION_MIN,
  estimatedKcal,
  exerciseSummary,
  progressionReady,
  setReferences,
  startSession,
  WEIGHT_STEP_LB,
} from '../strength';
import type { StrengthExercise, StrengthKind, StrengthSession, StrengthSet, StrengthTemplate } from '../types';
import { button, el, field, showToast, uid } from '../ui';

let draft: StrengthSession | null = null;
let openSetId: string | null = null;
const applied = new Set<string>();

export function renderStrength(main: HTMLElement): void {
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'Lifting'));
  header.append(el('h1', 'title', 'Strength'));
  main.append(header);
  main.append(el('p', 'lede', 'Pounds only. A lift is not the main workout for the readiness score.'));

  if (!draft) {
    const launches = el('div', 'lift-launch');
    launches.append(launch('lower', 'Lower'));
    launches.append(launch('upper', 'Upper'));
    main.append(launches);
    main.append(sessionList());
    main.append(templateSection());
    return;
  }

  const current = draft;
  const date = el('input');
  date.type = 'date';
  date.value = current.date;
  date.addEventListener('change', () => {
    if (!isIsoDate(date.value)) return;
    current.date = date.value;
  });
  main.append(field('Date', date, current.date === todayIso() ? 'Today' : 'Another day'));
  main.append(el('p', 'section-title', current.kind === 'lower' ? 'Lower' : 'Upper'));

  for (const exercise of current.exercises) main.append(exerciseBlock(current, exercise));

  const addName = el('input');
  addName.type = 'text';
  addName.placeholder = 'Exercise name';
  addName.setAttribute('aria-label', 'New exercise name');
  const addRow = el('div', 'food-open');
  addRow.append(addName);
  addRow.append(button('Add exercise', 'primary', () => {
    const name = addName.value.trim();
    if (!name) {
      showToast('Name the exercise.');
      return;
    }
    current.exercises.push({
      id: uid(),
      name,
      sets: [{ id: uid(), warmup: false, weightLb: 45, reps: 5, prescribedReps: 5, completed: false, missed: false }],
    });
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  main.append(addRow);

  const rpe = el('select');
  rpe.append(option('', 'RPE'));
  for (let value = 1; value <= 10; value += 1) rpe.append(option(String(value), String(value)));
  rpe.value = current.rpe == null ? '' : String(current.rpe);
  rpe.addEventListener('change', () => {
    current.rpe = rpe.value ? Number(rpe.value) : null;
  });
  const duration = el('input');
  duration.type = 'number';
  duration.min = '0';
  duration.step = '1';
  duration.inputMode = 'numeric';
  duration.value = String(current.durationMin);
  duration.addEventListener('change', () => {
    const value = Number(duration.value);
    if (!Number.isFinite(value) || value < 0) {
      duration.value = String(current.durationMin);
      return;
    }
    current.durationMin = value;
    current.estKcal = estimatedKcal(value);
  });
  const notes = el('textarea');
  notes.rows = 2;
  notes.maxLength = 2000;
  notes.value = current.notes;
  notes.placeholder = 'Optional note';
  notes.addEventListener('input', () => {
    current.notes = notes.value;
  });
  main.append(field('RPE', rpe, 'Optional, 1–10'));
  main.append(field('Minutes', duration, `About ${Math.round(estimatedKcal(current.durationMin))} kcal at 4.5 per minute.`));
  main.append(field('Notes', notes));

  main.append(button('Save session', 'primary lift-save', () => {
    void saveDraft();
  }));
  const existing = state.strengthSessions.some((session) => session.id === current.id);
  if (existing) {
    main.append(button('Delete session', 'text-button danger', () => {
      if (!window.confirm('Delete this lifting session from this phone?')) return;
      state.strengthSessions = state.strengthSessions.filter((session) => session.id !== current.id);
      draft = null;
      void persist().then(() => {
        showToast('Session removed.');
        document.dispatchEvent(new CustomEvent('dr-render'));
      });
    }));
  }
  main.append(button('Close', 'text-button', () => {
    draft = null;
    openSetId = null;
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
}

function launch(kind: StrengthKind, label: string): HTMLElement {
  return button(label, 'primary lift-go', () => {
    draft = startSession(kind, state.strengthSessions, state.strengthTemplates, state.date, new Date().toISOString(), uid);
    openSetId = null;
    applied.clear();
    document.dispatchEvent(new CustomEvent('dr-render'));
  });
}

function sessionList(): HTMLElement {
  const wrap = el('div');
  const sessions = [...state.strengthSessions].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  wrap.append(el('h2', 'section-title', 'Sessions'));
  if (!sessions.length) wrap.append(el('p', 'hint', 'No sessions yet. Lower and Upper start from the template.'));
  for (const session of sessions.slice(0, 20)) {
    const row = el('article', 'log-row');
    const marker = session.kind === 'lower' ? 'Lift: Lower' : 'Lift: Upper';
    row.append(el('p', 'log-title', `${session.date} · ${marker}`));
    row.append(el('p', 'hint', `${session.durationMin} min · ${Math.round(session.estKcal)} kcal`));
    const actions = el('div', 'row wrap');
    actions.append(button('Edit', 'text-button', () => {
      draft = structuredClone(session);
      openSetId = null;
      applied.clear();
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
    actions.append(button('Delete', 'text-button danger', () => {
      if (!window.confirm('Delete this lifting session from this phone?')) return;
      state.strengthSessions = state.strengthSessions.filter((item) => item.id !== session.id);
      void persist().then(() => document.dispatchEvent(new CustomEvent('dr-render')));
    }));
    row.append(actions);
    wrap.append(row);
  }
  return wrap;
}

function exerciseBlock(session: StrengthSession, exercise: StrengthExercise): HTMLElement {
  const card = el('article', 'log-row');
  card.append(el('p', 'log-title', exerciseSummary(exercise)));
  const warmups = exercise.sets.filter((set) => set.warmup);
  const working = exercise.sets.filter((set) => !set.warmup);
  if (warmups.length) {
    const details = el('details', 'warmup');
    const summary = el('summary', '', `Warm-up · ${warmups.length} sets`);
    details.append(summary);
    for (const set of warmups) details.append(setRow(set));
    card.append(details);
  }
  for (const set of working) card.append(setRow(set));
  const refs = setReferences(state.strengthSessions, exercise.name, session.id);
  const last = refs.last ? `${refs.last.weightLb}×${refs.last.reps}` : '—';
  const best = refs.best ? `${refs.best.weightLb}×${refs.best.reps}` : '—';
  card.append(el('p', 'hint', `Last ${last} · Best ${best}`));
  if (progressionReady(state.strengthSessions, exercise.name, session.id) && !applied.has(exercise.id)) {
    const hint = el('div', 'row wrap');
    hint.append(el('p', 'hint', 'Try +5 lb'));
    hint.append(button('+5 lb', 'secondary', () => {
      const index = session.exercises.findIndex((item) => item.id === exercise.id);
      if (index < 0) return;
      session.exercises[index] = applyPlusFive(exercise);
      applied.add(exercise.id);
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
    card.append(hint);
  }
  card.append(button('Remove exercise', 'text-button danger', () => {
    session.exercises = session.exercises.filter((item) => item.id !== exercise.id);
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  return card;
}

function setRow(set: StrengthSet): HTMLElement {
  const wrap = el('div', set.missed ? 'set-block missed' : 'set-block');
  const row = el('div', 'set-row');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = set.completed && !set.missed;
  check.setAttribute('aria-label', `${set.weightLb} pounds, ${set.reps} reps`);
  check.addEventListener('change', () => {
    set.completed = check.checked;
    if (check.checked) set.missed = false;
    document.dispatchEvent(new CustomEvent('dr-render'));
  });
  row.append(check);
  row.append(button(`${set.weightLb} lb`, 'set-tap', () => toggleSet(set.id)));
  row.append(button(String(set.reps), 'set-tap', () => toggleSet(set.id)));
  row.append(button(set.missed ? 'Missed' : 'Miss', set.missed ? 'text-button danger' : 'text-button', () => {
    set.missed = !set.missed;
    if (set.missed) set.completed = false;
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  wrap.append(row);
  if (openSetId === set.id) {
    const steppers = el('div', 'steppers');
    steppers.append(stepper('Weight', set.weightLb, WEIGHT_STEP_LB, (next) => {
      set.weightLb = next;
    }));
    steppers.append(stepper('Reps', set.reps, 1, (next) => {
      set.reps = next;
    }));
    wrap.append(steppers);
  }
  return wrap;
}

function stepper(label: string, value: number, step: number, commit: (next: number) => void): HTMLElement {
  const row = el('div', 'stepper');
  row.append(el('span', '', label));
  row.append(button('−', 'step', () => {
    commit(Math.max(0, value - step));
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  row.append(el('strong', '', String(value)));
  row.append(button('+', 'step', () => {
    commit(value + step);
    document.dispatchEvent(new CustomEvent('dr-render'));
  }));
  return row;
}

function toggleSet(id: string): void {
  openSetId = openSetId === id ? null : id;
  document.dispatchEvent(new CustomEvent('dr-render'));
}

function templateSection(): HTMLElement {
  const details = el('details', 'warmup');
  details.append(el('summary', '', 'Templates'));
  details.append(el('p', 'hint', 'New sessions copy the last log of that day type, or these templates when there isn’t one yet.'));
  for (const template of state.strengthTemplates) details.append(templateEditor(template));
  return details;
}

function templateEditor(template: StrengthTemplate): HTMLElement {
  const card = el('article', 'log-row');
  card.append(el('p', 'log-title', template.kind === 'lower' ? 'Lower template' : 'Upper template'));
  for (const exercise of template.exercises) {
    const block = el('div', 'stack tight');
    const name = el('input');
    name.type = 'text';
    name.value = exercise.name;
    name.setAttribute('aria-label', 'Template exercise name');
    name.addEventListener('change', () => {
      exercise.name = name.value.trim() || exercise.name;
      void saveTemplates();
    });
    block.append(name);
    for (const set of exercise.sets) {
      const row = el('div', 'stepper');
      const warmup = el('input');
      warmup.type = 'checkbox';
      warmup.checked = set.warmup;
      warmup.setAttribute('aria-label', 'Warm-up set');
      warmup.addEventListener('change', () => {
        set.warmup = warmup.checked;
        void saveTemplates();
      });
      const weight = el('input');
      weight.type = 'number';
      weight.min = '0';
      weight.step = '5';
      weight.value = String(set.weightLb);
      weight.setAttribute('aria-label', 'Template weight');
      weight.addEventListener('change', () => {
        const value = Number(weight.value);
        if (!Number.isFinite(value) || value < 0) return;
        set.weightLb = value;
        void saveTemplates();
      });
      const reps = el('input');
      reps.type = 'number';
      reps.min = '0';
      reps.step = '1';
      reps.value = String(set.reps);
      reps.setAttribute('aria-label', 'Template reps');
      reps.addEventListener('change', () => {
        const value = Number(reps.value);
        if (!Number.isFinite(value) || value < 0) return;
        set.reps = value;
        set.prescribedReps = value;
        void saveTemplates();
      });
      row.append(warmup, weight, reps);
      row.append(button('Remove set', 'text-button danger', () => {
        exercise.sets = exercise.sets.filter((item) => item.id !== set.id);
        void saveTemplates();
      }));
      block.append(row);
    }
    block.append(button('Add set', 'secondary', () => {
      exercise.sets.push({ id: uid(), warmup: false, weightLb: 45, reps: 5, prescribedReps: 5, completed: false, missed: false });
      void saveTemplates();
    }));
    block.append(button('Remove exercise', 'text-button danger', () => {
      template.exercises = template.exercises.filter((item) => item.id !== exercise.id);
      void saveTemplates();
    }));
    card.append(block);
  }
  const name = el('input');
  name.type = 'text';
  name.placeholder = 'Add an exercise';
  name.setAttribute('aria-label', `Add a ${template.kind} exercise`);
  const row = el('div', 'food-open');
  row.append(name);
  row.append(button('Add', 'primary', () => {
    const next = name.value.trim();
    if (!next) return;
    template.exercises.push({
      id: uid(),
      name: next,
      sets: [{ id: uid(), warmup: false, weightLb: 45, reps: 5, prescribedReps: 5, completed: false, missed: false }],
    });
    void saveTemplates();
  }));
  card.append(row);
  return card;
}

async function saveDraft(): Promise<void> {
  if (!draft) return;
  if (!isIsoDate(draft.date)) {
    showToast('Choose a date.');
    return;
  }
  draft.estKcal = estimatedKcal(draft.durationMin || DEFAULT_DURATION_MIN);
  draft.updatedAt = new Date().toISOString();
  const index = state.strengthSessions.findIndex((session) => session.id === draft?.id);
  if (index >= 0) state.strengthSessions[index] = structuredClone(draft);
  else state.strengthSessions.push(structuredClone(draft));
  await persist();
  draft = null;
  openSetId = null;
  showToast('Session saved on this phone.');
  document.dispatchEvent(new CustomEvent('dr-render'));
}

async function saveTemplates(): Promise<void> {
  const now = new Date().toISOString();
  for (const template of state.strengthTemplates) template.updatedAt = now;
  await persist();
  document.dispatchEvent(new CustomEvent('dr-render'));
}

async function persist(): Promise<void> {
  await persistDatabase({
    checkins: state.checkins,
    workouts: state.workouts,
    benchmarks: state.benchmarks,
    foods: state.foods,
    foodEntries: state.foodEntries,
    foodTargets: state.foodTargets,
    strengthSessions: state.strengthSessions,
    strengthTemplates: state.strengthTemplates,
  });
}

function option(value: string, label: string): HTMLOptionElement {
  const node = el('option', '', label);
  node.value = value;
  return node;
}
