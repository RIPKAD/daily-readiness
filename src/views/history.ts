import { lineChart } from '../chart';
import { addDays, formatLong, formatShort, todayIso } from '../dates';
import { scoreDay } from '../score';
import { METRICS } from '../scales';
import { state } from '../state';
import { liftMarker } from '../strength';
import { persistDatabase } from '../storage';
import type { Benchmark, MetricKey } from '../types';
import { button, el, field, showToast, uid } from '../ui';

type SeriesKey = 'score' | MetricKey | 'weightLb' | 'workout';

let range: 90 | 365 | 'all' = 90;
let series: SeriesKey = 'score';

export function renderHistory(main: HTMLElement): void {
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'Over time'));
  header.append(el('h1', 'title', 'History'));
  main.append(header);

  if (!state.checkins.length && !state.workouts.length && !state.strengthSessions.length) {
    main.append(el('p', 'lede', 'Mornings you save will show up here as a score line and the raw metrics.'));
    if (!state.preview) {
      main.append(button('Preview with example data', 'secondary', () => {
        state.preview = true;
        location.hash = '#today';
      }));
    }
  }

  const controls = el('div', 'row wrap');
  for (const item of [
    { id: 90 as const, label: '90 days' },
    { id: 365 as const, label: '1 year' },
    { id: 'all' as const, label: 'All' },
  ]) {
    controls.append(button(item.label, range === item.id ? 'chip selected' : 'chip', () => {
      range = item.id;
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
  }
  main.append(controls);

  const select = el('select');
  select.append(option('score', 'Readiness score'));
  for (const metric of METRICS) select.append(option(metric.key, metric.label));
  select.append(option('weightLb', 'Weight (lb)'));
  select.append(option('workout', 'Workout quality'));
  select.value = series;
  select.addEventListener('change', () => {
    series = select.value as SeriesKey;
    document.dispatchEvent(new CustomEvent('dr-render'));
  });
  main.append(field('Chart', select));

  const points = buildSeries(series);
  if (!points.length) {
    main.append(el('p', 'lede', 'Nothing to plot in this window yet.'));
  } else {
    const chartOptions = series === 'score' ? { min: 0, max: 100, zones: true } : {};
    const chart = lineChart(points, chartOptions);
    const latest = points[points.length - 1];
    const first = points[0];
    chart.setAttribute('aria-label', `${selectLabel(series)} from ${first.label} to ${latest.label}. Latest ${latest.value}.`);
    main.append(chart);
    main.append(el('p', 'hint', `${first.label} to ${latest.label} · latest ${latest.value}`));
  }

  const recentDates = [...new Set([
    ...state.checkins.map((checkin) => checkin.date),
    ...state.strengthSessions.map((session) => session.date),
  ])].sort((a, b) => b.localeCompare(a)).slice(0, 14);
  if (recentDates.length) {
    main.append(el('h2', 'section-title', 'Recent mornings'));
    for (const date of recentDates) {
      const checkin = state.checkins.find((item) => item.date === date);
      const marker = liftMarker(state.strengthSessions, date);
      const score = checkin
        ? (scoreDay(state.checkins, date, state.settings).score == null
          ? 'Building baseline'
          : scoreDay(state.checkins, date, state.settings).score!.toFixed(1))
        : '';
      const label = [formatLong(date), score, marker].filter(Boolean).join(' · ');
      const row = button(label, 'log-link', () => {
        location.hash = checkin ? `#today/${date}` : `#strength/${date}`;
      });
      main.append(row);
    }
  }

  main.append(el('h2', 'section-title', 'Benchmark tests'));
  main.append(el('p', 'lede', 'Test definitions aren’t set yet. Log a date, a name, a result, and a note so the history is here when you decide what to test.'));
  const form = el('form', 'stack');
  const date = el('input');
  date.type = 'date';
  date.value = todayIso();
  const name = el('input');
  name.type = 'text';
  name.maxLength = 120;
  name.placeholder = 'Test name';
  const result = el('input');
  result.type = 'text';
  result.maxLength = 120;
  result.placeholder = 'Result';
  const notes = el('textarea');
  notes.rows = 2;
  notes.maxLength = 2000;
  notes.placeholder = 'Notes';
  const error = el('p', 'form-error');
  const save = el('button', 'primary', 'Save benchmark');
  save.type = 'submit';
  form.append(field('Date', date), field('Test name', name), field('Result', result), field('Notes', notes), error, save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!name.value.trim() || !result.value.trim()) {
      error.textContent = 'Add a test name and a result.';
      return;
    }
    void saveBenchmark({
      id: uid(),
      date: date.value || todayIso(),
      name: name.value.trim(),
      result: result.value.trim(),
      notes: notes.value.trim(),
      updatedAt: new Date().toISOString(),
    });
  });
  main.append(form);

  const benchmarks = [...state.benchmarks].sort((a, b) => b.date.localeCompare(a.date));
  if (!benchmarks.length) main.append(el('p', 'hint', 'No tests logged.'));
  for (const benchmark of benchmarks) {
    const card = el('article', 'log-row');
    card.append(el('p', 'log-title', `${formatLong(benchmark.date)} · ${benchmark.name}`));
    card.append(el('p', '', benchmark.result));
    if (benchmark.notes) card.append(el('p', 'hint', benchmark.notes));
    card.append(button('Delete', 'text-button danger', () => {
      if (!window.confirm('Delete this benchmark from this phone?')) return;
      void deleteBenchmark(benchmark.id);
    }));
    main.append(card);
  }
}

function buildSeries(key: SeriesKey): { label: string; value: number }[] {
  const start = range === 'all' ? '0000-01-01' : addDays(todayIso(), -range);
  if (key === 'score') {
    return state.checkins
      .filter((checkin) => checkin.date >= start)
      .map((checkin) => ({ checkin, result: scoreDay(state.checkins, checkin.date, state.settings) }))
      .filter((item) => item.result.score != null)
      .map((item) => ({ label: formatShort(item.checkin.date), value: Number(item.result.score!.toFixed(1)) }));
  }
  if (key === 'workout') {
    const byDate = new Map<string, number[]>();
    for (const workout of state.workouts) {
      if (workout.date < start) continue;
      const list = byDate.get(workout.date) ?? [];
      list.push(workout.quality);
      byDate.set(workout.date, list);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({
        label: formatShort(date),
        value: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
      }));
  }
  return state.checkins
    .filter((checkin) => checkin.date >= start)
    .map((checkin) => ({ date: checkin.date, value: key === 'weightLb' ? checkin.weightLb : checkin[key] }))
    .filter((item): item is { date: string; value: number } => item.value != null && Number.isFinite(item.value))
    .map((item) => ({ label: formatShort(item.date), value: item.value }));
}

function selectLabel(key: SeriesKey): string {
  if (key === 'score') return 'Readiness score';
  if (key === 'weightLb') return 'Weight';
  if (key === 'workout') return 'Workout quality';
  return METRICS.find((metric) => metric.key === key)?.label ?? key;
}

function option(value: string, label: string): HTMLOptionElement {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

async function saveBenchmark(benchmark: Benchmark): Promise<void> {
  state.benchmarks.push(benchmark);
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast('Benchmark saved on this phone.');
}

async function deleteBenchmark(id: string): Promise<void> {
  state.benchmarks = state.benchmarks.filter((benchmark) => benchmark.id !== id);
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast('Benchmark removed.');
}
