import { formatLong, isIsoDate } from '../dates';
import { fetchActivities, IntervalsError } from '../intervals';
import type { ActivitySummary } from '../intervals-map';
import { mainWorkoutByDate } from '../score';
import { WORKOUT_QUALITY } from '../scales';
import { state } from '../state';
import { persistDatabase } from '../storage';
import type { WorkoutLog } from '../types';
import { button, el, field, showToast, uid } from '../ui';

let draftId: string | null = null;

export function renderWorkout(main: HTMLElement): void {
  const saved = draftId ? state.workouts.find((workout) => workout.id === draftId) : null;
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'After the session'));
  header.append(el('h1', 'title', 'Workout quality'));
  main.append(header);
  main.append(el('p', 'lede', 'How strong was the session? Link it to an intervals.icu activity if you want the history tied to that ride or run. The quality stays on this phone. Weight suggestions use the main workout of the day.'));

  const form = el('form', 'stack');
  const date = el('input');
  date.type = 'date';
  date.value = saved?.date ?? state.date;
  form.append(field('Date', date));

  const quality = el('select');
  quality.append(option('', 'Choose'));
  for (const item of WORKOUT_QUALITY) quality.append(option(String(item.value), `${item.value} · ${item.label}`));
  quality.value = saved ? String(saved.quality) : '';
  form.append(field('Workout quality', quality, '1 Very weak · 3 Weak · 5 Normal · 7 Strong · 9 Very strong'));

  const activityBox = el('div', 'stack tight');
  const activityHint = el('p', 'hint', state.apiKey ? 'Load the day’s activities, then pick one. Leaving this blank is fine.' : 'Add an intervals key in Settings to attach an activity. You can still log the quality.');
  activityBox.append(activityHint);
  let chosen: ActivitySummary | null = saved?.activityId
    ? {
      id: saved.activityId,
      name: saved.activityName ?? 'Activity',
      type: '',
      date: saved.date,
      movingSeconds: saved.movingSeconds ?? null,
      kj: saved.kj ?? null,
    }
    : null;
  const list = el('div', 'choice-list');
  activityBox.append(list);
  if (state.apiKey) {
    activityBox.append(button('Load activities', 'secondary', () => {
      void loadActivities(date.value, list, (activity) => {
        chosen = activity;
      }, chosen?.id ?? null);
    }));
  }
  const activityField = el('div', 'field');
  activityField.append(el('span', 'field-label', 'intervals.icu activity'));
  activityField.append(activityBox);
  form.append(activityField);

  const mainWorkout = el('input');
  mainWorkout.type = 'checkbox';
  mainWorkout.checked = saved?.isMain === true;
  const mainRow = el('label', 'check-row');
  mainRow.append(mainWorkout, el('span', '', 'Main workout of the day'));
  form.append(mainRow);
  form.append(el('p', 'hint', 'Tick this when a shorter session should count instead of the one with more kilojoules. Otherwise the highest kilojoule log is the main workout.'));

  const note = el('textarea');
  note.rows = 3;
  note.maxLength = 2000;
  note.value = saved?.note ?? '';
  note.placeholder = 'Optional. Legs, heat, fueling.';
  form.append(field('Note', note));

  const error = el('p', 'form-error');
  const save = el('button', 'primary', saved ? 'Update workout' : 'Save workout');
  save.type = 'submit';
  form.append(error, save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isIsoDate(date.value)) {
      error.textContent = 'Choose a date.';
      return;
    }
    const value = Number(quality.value);
    const match = WORKOUT_QUALITY.find((item) => item.value === value);
    if (!match) {
      error.textContent = 'Choose a workout quality.';
      return;
    }
    void commit({
      id: saved?.id ?? uid(),
      date: date.value,
      quality: match.value,
      activityId: chosen?.id ?? null,
      activityName: chosen ? activityTitle(chosen) : null,
      note: note.value.trim(),
      updatedAt: new Date().toISOString(),
      kj: chosen?.kj ?? null,
      movingSeconds: chosen?.movingSeconds ?? null,
      ...(mainWorkout.checked ? { isMain: true } : {}),
    });
  });
  main.append(form);

  const recent = [...state.workouts].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
  const mains = mainWorkoutByDate(state.workouts);
  main.append(el('h2', 'section-title', 'Recent'));
  if (!recent.length) {
    main.append(el('p', 'lede', 'No workouts logged yet. Weight suggestions can use these once about 40 days have a check-in and a main workout.'));
  }
  for (const workout of recent) {
    const row = el('article', 'log-row');
    const label = WORKOUT_QUALITY.find((item) => item.value === workout.quality)?.label ?? String(workout.quality);
    const title = el('p', 'log-title', `${formatLong(workout.date)} · ${workout.quality} ${label}`);
    if (mains.get(workout.date)?.id === workout.id) {
      title.append(document.createTextNode(' '));
      title.append(el('span', 'tag', 'Main'));
    }
    row.append(title);
    if (workout.activityName) row.append(el('p', 'hint', workout.activityName));
    if (workout.note) row.append(el('p', 'hint', workout.note));
    const actions = el('div', 'row');
    actions.append(button('Edit', 'text-button', () => {
      draftId = workout.id;
      state.date = workout.date;
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
    actions.append(button('Delete', 'text-button danger', () => {
      if (!window.confirm('Delete this workout from this phone?')) return;
      void remove(workout.id);
    }));
    row.append(actions);
    main.append(row);
  }
}

async function commit(workout: WorkoutLog): Promise<void> {
  if (workout.isMain) {
    state.workouts = state.workouts.map((item) => {
      if (item.id === workout.id || item.date !== workout.date || item.isMain !== true) return item;
      const rest = { ...item };
      delete rest.isMain;
      return rest;
    });
  }
  const index = state.workouts.findIndex((item) => item.id === workout.id);
  if (index >= 0) state.workouts[index] = workout;
  else state.workouts.push(workout);
  draftId = null;
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast('Workout saved on this phone.');
}

async function remove(id: string): Promise<void> {
  state.workouts = state.workouts.filter((workout) => workout.id !== id);
  if (draftId === id) draftId = null;
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast('Workout removed from this phone.');
}

async function loadActivities(
  date: string,
  list: HTMLElement,
  onPick: (activity: ActivitySummary | null) => void,
  selectedId: string | null,
): Promise<void> {
  list.replaceChildren(el('p', 'hint', 'Loading activities…'));
  try {
    const activities = await fetchActivities(state.apiKey, date, date);
    list.replaceChildren();
    if (!activities.length) {
      list.append(el('p', 'hint', 'No activities on this date.'));
      return;
    }
    const pick = (activity: ActivitySummary | null, node: HTMLButtonElement) => {
      onPick(activity);
      for (const child of list.querySelectorAll('.choice')) child.classList.remove('selected');
      node.classList.add('selected');
    };
    const none = choice(selectedId == null, 'No activity', () => undefined);
    none.addEventListener('click', () => pick(null, none));
    list.append(none);
    for (const activity of activities) {
      const node = choice(activity.id === selectedId, activityTitle(activity), () => undefined);
      node.addEventListener('click', () => pick(activity, node));
      list.append(node);
    }
  } catch (error) {
    const message = error instanceof IntervalsError ? error.message : 'Activities could not be loaded.';
    list.replaceChildren(el('p', 'form-error', message));
  }
}

function choice(selected: boolean, label: string, onClick: () => void): HTMLButtonElement {
  const node = button(label, selected ? 'choice selected' : 'choice', onClick);
  return node;
}

function activityTitle(activity: ActivitySummary): string {
  const minutes = activity.movingSeconds == null ? '' : ` · ${formatMinutes(activity.movingSeconds)}`;
  const work = activity.kj == null ? '' : ` · ${activity.kj} kJ`;
  return `${activity.type ? `${activity.type} · ` : ''}${activity.name}${minutes}${work}`;
}

function formatMinutes(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function option(value: string, label: string): HTMLOptionElement {
  const node = el('option', '', label);
  node.value = value;
  return node;
}
