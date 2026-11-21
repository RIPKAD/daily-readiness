import { formatLong, todayIso, weekRange } from '../dates';
import { fetchActivities, fetchWellnessDay, IntervalsError, putWellness } from '../intervals';
import { applyPrefill, blankCheckIn, weekKj, type IntervalsPrefill } from '../intervals-map';
import { recommend } from '../recommend';
import { exampleLog } from '../sample';
import { SCALE_BY_METRIC } from '../scales';
import { bandLabel, scoreDay, type ScoreResult } from '../score';
import { state } from '../state';
import { persistDatabase } from '../storage';
import type { CheckIn, MetricKey } from '../types';
import { METRIC_KEYS } from '../types';
import { formatNumber, lbToKg, roundTo } from '../units';
import { append, button, el, field, showToast } from '../ui';
import { mountHrvImport } from './hrv-panel';

document.addEventListener('dr-hrv', () => refreshTodayFromStore());

let draft: CheckIn | null = null;
let draftDate = '';
let pulledFor = '';
let weekCache: { key: string; kj: number | null } | null = null;
let intervalsNote = '';

export function renderToday(main: HTMLElement): void {
  if (!draft || draftDate !== state.date) {
    draftDate = state.date;
    intervalsNote = '';
    const saved = state.checkins.find((checkin) => checkin.date === state.date);
    draft = saved ? structuredClone(saved) : blankCheckIn(state.date);
  }
  const current = draft;
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'Kaden'));
  header.append(el('h1', 'title', 'Daily readiness'));
  header.append(el('p', 'date-line', formatLong(state.date)));
  main.append(header);

  if (state.preview) {
    const banner = el('div', 'banner');
    banner.append(el('p', '', 'This score is an example from made-up mornings, so you can see the shape of it. Nothing here is saved.'));
    banner.append(button('Hide example', 'text-button', () => {
      state.preview = false;
      document.dispatchEvent(new CustomEvent('dr-render'));
    }));
    main.append(banner);
  }

  const scorePanel = el('section', 'score-card');
  scorePanel.id = 'score-panel';
  main.append(scorePanel);

  const form = el('form', 'stack');
  form.noValidate = true;
  const dateInput = el('input');
  dateInput.type = 'date';
  dateInput.value = state.date;
  dateInput.required = true;
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    draft = null;
    location.hash = `#today/${dateInput.value}`;
  });
  form.append(field('Morning', dateInput, state.date === todayIso() ? 'Today' : 'A previous morning'));

  const resting = numberInput(current.restingHr, '1', 'numeric');
  const rmssd = numberInput(current.hrvRmssd, '0.1', 'decimal');
  const sdnn = numberInput(current.hrvSdnn, '0.1', 'decimal');
  const weight = numberInput(current.weightLb, '0.1', 'decimal');
  const weightHint = el('span', 'hint', weightLine(current.weightLb));
  weight.addEventListener('input', () => {
    current.weightLb = readNumber(weight);
    weightHint.textContent = weightLine(current.weightLb);
    paintScore(scorePanel);
  });

  form.append(field('Resting HR', resting, 'bpm'));
  form.append(field('HRV rMSSD', rmssd, 'ms'));
  form.append(field('HRV SDNN', sdnn, 'ms'));
  const weightField = field('Weight', weight, 'pounds');
  weightField.append(weightHint);
  form.append(weightField);

  const selects: Record<'sleepQuality' | 'soreness' | 'stress' | 'mood' | 'feeling', HTMLSelectElement> = {
    sleepQuality: scaleSelect('sleepQuality', current.sleepQuality),
    soreness: scaleSelect('soreness', current.soreness),
    stress: scaleSelect('stress', current.stress),
    mood: scaleSelect('mood', current.mood),
    feeling: scaleSelect('feeling', current.feeling),
  };
  form.append(field('Sleep quality', selects.sleepQuality, 'Higher means better sleep.'));
  form.append(field('Soreness', selects.soreness, 'Higher means more sore. The score flips this.'));
  form.append(field('Stress', selects.stress, 'Higher means more stress. The score flips this.'));
  form.append(field('Mood', selects.mood, 'Higher means a better mood.'));
  form.append(field('Overall feeling', selects.feeling, 'Higher means you feel better.'));

  const note = el('textarea');
  note.rows = 3;
  note.maxLength = 2000;
  note.value = current.note;
  note.placeholder = 'Optional. Travel, a late meal, a niggle.';
  form.append(field('Note', note));

  const context = el('div', 'context');
  context.id = 'intervals-context';
  form.append(context);

  const error = el('p', 'form-error');
  error.id = 'form-error';
  form.append(error);

  const saveBar = el('div', 'savebar');
  const saveButton = el('button', 'primary', 'Save check-in');
  saveButton.type = 'submit';
  saveBar.append(saveButton);
  const sync = el('p', 'hint sync-line', current.intervals.message);
  saveBar.append(sync);
  form.append(saveBar);

  const pullRow = el('div', 'row');
  pullRow.append(button(state.apiKey ? 'Fill blanks from intervals.icu' : 'Add an intervals key to prefill', 'secondary', () => {
    if (!state.apiKey) {
      location.hash = '#settings';
      return;
    }
    void pullIntervals(context, true);
  }));
  form.append(pullRow);
  if (intervalsNote) form.append(el('p', 'hint', intervalsNote));

  const saved = state.checkins.some((checkin) => checkin.date === state.date);
  if (saved) {
    form.append(button('Delete this morning on this phone', 'text-button danger', () => {
      const ok = window.confirm(`Delete ${formatLong(state.date)} from this phone? The intervals.icu wellness record is left as it is.`);
      if (!ok) return;
      void deleteDay();
    }));
  }

  wire(current, [resting, rmssd, sdnn], ['restingHr', 'hrvRmssd', 'hrvSdnn'], scorePanel, error, saveButton);
  for (const key of ['sleepQuality', 'soreness', 'stress', 'mood', 'feeling'] as const) {
    selects[key].addEventListener('change', () => {
      current[key] = readSelect(selects[key]);
      refreshValidity(current, error, saveButton);
      paintScore(scorePanel);
    });
  }
  note.addEventListener('input', () => {
    current.note = note.value;
    refreshValidity(current, error, saveButton);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(current, error, saveButton, sync);
  });

  main.append(form);
  main.append(el('h2', 'section-title', 'HRV4Training'));
  main.append(el('p', 'lede', 'Choose the CSV from the Files app. If HRV4Training put it in Dropbox, pick it there. This page does not connect to Dropbox.'));
  mountHrvImport(main);

  paintScore(scorePanel);
  paintContext(context, current);
  refreshValidity(current, error, saveButton);

  if (state.apiKey && pulledFor !== state.date) {
    pulledFor = state.date;
    void pullIntervals(context, false);
    void pullWeek();
  }
}

function wire(
  current: CheckIn,
  inputs: HTMLInputElement[],
  keys: Array<'restingHr' | 'hrvRmssd' | 'hrvSdnn'>,
  scorePanel: HTMLElement,
  error: HTMLElement,
  saveButton: HTMLButtonElement,
) {
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      current[keys[index]] = readNumber(input);
      refreshValidity(current, error, saveButton);
      paintScore(scorePanel);
    });
  });
}

function paintScore(panel: HTMLElement): void {
  panel.className = 'score-card';
  panel.replaceChildren();
  if (!draft) return;
  const example = state.preview ? exampleLog() : null;
  const entries = example ? example.checkins : withDraft(state.checkins, draft);
  const date = example ? example.checkins.at(-1)!.date : draft.date;
  const result = scoreDay(entries, date, state.settings);
  const week = weekCache?.kj ?? null;
  const advice = recommend({
    status: result.status === 'ready' || result.status === 'building' || result.status === 'no-weight' ? result.status : 'building',
    band: result.band,
    tsb: tsbOf(example ? example.checkins.at(-1)! : draft),
    weekKj: example ? null : week,
    weekTarget: state.settings.weeklyKjTarget,
  });

  if (result.status === 'empty' && !example) {
    panel.append(el('p', 'score-kicker', 'No score yet'));
    panel.append(el('p', 'lede', 'Log this morning. A metric starts counting after about seven earlier days in the baseline window.'));
    if (state.checkins.length < 7) {
      panel.append(button('Show an example score', 'secondary', () => {
        state.preview = true;
        document.dispatchEvent(new CustomEvent('dr-render'));
      }));
    }
  } else if (result.status === 'ready' && result.score != null && result.band) {
    panel.classList.add(result.band);
    const kicker = el('p', 'score-kicker', example ? 'Example' : bandLabel(result.band));
    panel.append(kicker);
    panel.append(el('p', 'score-number', result.score.toFixed(1)));
    panel.append(el('p', 'score-band', 'Green from 65 · amber from 40 · red below 40'));
  } else {
    panel.append(el('p', 'score-kicker', result.status === 'no-weight' ? 'Weights' : 'Building baseline'));
    panel.append(el('p', 'lede', result.status === 'no-weight'
      ? 'These metrics have a baseline, and their weights are zero.'
      : 'Keep logging. A metric joins the score after about seven earlier days.'));
  }

  if (!(result.status === 'empty' && !example)) {
    panel.append(el('h2', 'advice-title', advice.title));
    panel.append(el('p', 'lede', advice.lede));
    const list = el('ul', 'advice');
    for (const point of advice.points) list.append(el('li', '', point));
    panel.append(list);
  }

  if (result.contributions.length || result.waiting.length) {
    panel.append(el('h2', 'section-title', 'Why this score'));
    const maxAbs = Math.max(1, ...result.contributions.map((item) => Math.abs(item.points)));
    for (const item of [...result.contributions].sort((a, b) => Math.abs(b.points) - Math.abs(a.points))) {
      panel.append(contributionRow(item.label, item.points, maxAbs, `${item.baselineN}-day mean ${formatStat(item)}`));
    }
    for (const item of result.waiting) {
      const text = item.reason === 'baseline'
        ? `Building baseline · ${item.have} of ${item.need} days`
        : 'Weight is 0';
      panel.append(contributionRow(item.label, null, maxAbs, text));
    }
  }
}

function contributionRow(label: string, points: number | null, maxAbs: number, detail: string): HTMLElement {
  const row = el('div', 'contrib');
  row.append(el('span', 'contrib-label', label));
  const track = el('span', 'track');
  track.append(el('i', 'axis'));
  if (points != null && points !== 0) {
    const bar = el('i', points > 0 ? 'pos' : 'neg');
    bar.style.width = `${Math.min(50, (Math.abs(points) / maxAbs) * 50)}%`;
    track.append(bar);
  }
  row.append(track);
  row.append(el('span', 'contrib-points', points == null ? '—' : `${points > 0 ? '+' : ''}${points.toFixed(1)}`));
  row.append(el('span', 'contrib-detail', detail));
  return row;
}

function formatStat(item: { key: MetricKey; mean: number }): string {
  const digits = item.key === 'restingHr' || item.key === 'sleepQuality' || item.key === 'soreness' || item.key === 'stress' || item.key === 'mood' || item.key === 'feeling' ? 1 : 1;
  return formatNumber(item.mean, digits);
}

function paintContext(context: HTMLElement, current: CheckIn): void {
  context.replaceChildren();
  const bits: string[] = [];
  if (current.ctl != null && current.atl != null) {
    const form = current.ctl - current.atl;
    bits.push(`CTL ${formatNumber(current.ctl, 0)} · ATL ${formatNumber(current.atl, 0)} · form ${form > 0 ? '+' : ''}${formatNumber(form, 0)}`);
  }
  if (current.sleepHours != null) bits.push(`Intervals sleep ${formatNumber(current.sleepHours, 1)} h`);
  if (!bits.length) return;
  context.append(el('p', 'hint', bits.join(' · ')));
}

async function pullIntervals(context: HTMLElement, announce: boolean): Promise<void> {
  if (!draft || !state.apiKey) return;
  const date = state.date;
  try {
    const prefill = await fetchWellnessDay(state.apiKey, date);
    if (!draft || state.date !== date || draft.date !== date) return;
    if (!prefill) {
      intervalsNote = announce ? 'intervals.icu has no wellness record for this date.' : '';
    } else {
      const before = snapshot(draft);
      const merged = applyPrefill(draft, state.date, prefill, new Date().toISOString());
      if (merged) Object.assign(draft, merged);
      const filled = describeFill(before, draft, prefill);
      intervalsNote = filled || (announce ? 'Nothing empty to fill. Numbers already on this phone were left alone.' : '');
      syncInputs(draft);
    }
  } catch (error) {
    intervalsNote = error instanceof IntervalsError ? error.message : 'intervals.icu could not be read.';
  }
  if (state.date !== date || !draft) return;
  const liveContext = document.getElementById('intervals-context') ?? context;
  const line = document.getElementById('intervals-note');
  if (line) line.textContent = intervalsNote;
  else if (intervalsNote) {
    const node = el('p', 'hint');
    node.id = 'intervals-note';
    node.textContent = intervalsNote;
    liveContext.parentElement?.insertBefore(node, liveContext.nextSibling);
  }
  paintContext(liveContext, draft);
  const panel = document.getElementById('score-panel');
  if (panel) paintScore(panel);
}

function syncInputs(current: CheckIn): void {
  const form = document.querySelector('form');
  if (!form) return;
  const byHint = (hint: string) => {
    const label = [...form.querySelectorAll('.field')].find((node) => node.querySelector('.field-label')?.textContent === hint);
    return label?.querySelector('input, select, textarea') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  };
  setNumber(byHint('Resting HR'), current.restingHr);
  setNumber(byHint('HRV rMSSD'), current.hrvRmssd);
  setNumber(byHint('HRV SDNN'), current.hrvSdnn);
  setNumber(byHint('Weight'), current.weightLb);
  setSelect(byHint('Sleep quality'), current.sleepQuality);
  setSelect(byHint('Soreness'), current.soreness);
  setSelect(byHint('Stress'), current.stress);
  setSelect(byHint('Mood'), current.mood);
  setSelect(byHint('Overall feeling'), current.feeling);
}

function setNumber(control: Element | null, value: number | null): void {
  if (!(control instanceof HTMLInputElement)) return;
  if (control.value !== '' && readNumber(control) != null) return;
  control.value = value == null ? '' : String(value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(control: Element | null, value: number | null): void {
  if (!(control instanceof HTMLSelectElement)) return;
  if (control.value !== '') return;
  control.value = value == null ? '' : String(value);
}

async function pullWeek(): Promise<void> {
  if (!state.apiKey) return;
  const date = state.date;
  const range = weekRange(date);
  const key = `${range.start}:${range.end}`;
  if (weekCache?.key === key) return;
  try {
    const activities = await fetchActivities(state.apiKey, range.start, range.end);
    weekCache = { key, kj: weekKj(activities, range.start, range.end) };
    if (weekRange(state.date).start !== range.start) return;
    const panel = document.getElementById('score-panel');
    if (panel) paintScore(panel);
  } catch {
    if (state.date === date) weekCache = { key, kj: null };
  }
}

export function refreshTodayFromStore(): void {
  if (!draft) return;
  const saved = state.checkins.find((checkin) => checkin.date === draft?.date);
  if (!saved) return;
  draft.hrvRmssd = saved.hrvRmssd;
  draft.hrvSdnn = saved.hrvSdnn;
  draft.updatedAt = saved.updatedAt;
  const form = document.querySelector('form');
  if (form) {
    forceNumber(form, 'HRV rMSSD', saved.hrvRmssd);
    forceNumber(form, 'HRV SDNN', saved.hrvSdnn);
  }
  const panel = document.getElementById('score-panel');
  if (panel) paintScore(panel);
}

function forceNumber(form: Element, label: string, value: number | null): void {
  const fieldNode = [...form.querySelectorAll('.field')].find((node) => node.querySelector('.field-label')?.textContent === label);
  const input = fieldNode?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value == null ? '' : String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function save(current: CheckIn, error: HTMLElement, saveButton: HTMLButtonElement, sync: HTMLElement): Promise<void> {
  const problems = validate(current);
  if (problems.length) {
    error.textContent = problems[0];
    return;
  }
  saveButton.disabled = true;
  current.updatedAt = new Date().toISOString();
  current.intervals = { state: 'local', message: 'Saved on this phone.', at: current.updatedAt };
  if (state.apiKey) {
    try {
      const written = await putWellness(state.apiKey, current.date, current);
      current.intervals = written.length
        ? { state: 'synced', message: `Saved on this phone. intervals.icu updated ${written.join(', ')}. Sleep, soreness, stress, mood, and feeling stay here because those scales differ.`, at: current.updatedAt }
        : { state: 'local', message: 'Saved on this phone. Nothing objective was filled in, so intervals.icu was left alone.', at: current.updatedAt };
    } catch (err) {
      const message = err instanceof IntervalsError ? err.message : 'intervals.icu could not be updated.';
      current.intervals = { state: 'failed', message: `Saved on this phone. ${message}`, at: current.updatedAt };
    }
  }
  upsert(current);
  state.preview = false;
  try {
    await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  } catch {
    current.intervals = { state: 'failed', message: 'The check-in is in memory, and this phone refused to store it.', at: current.updatedAt };
  }
  sync.textContent = current.intervals.message;
  saveButton.disabled = false;
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast(current.intervals.state === 'failed' ? 'Saved on this phone. intervals.icu was not updated.' : 'Morning saved.');
}

async function deleteDay(): Promise<void> {
  state.checkins = state.checkins.filter((checkin) => checkin.date !== state.date);
  draft = blankCheckIn(state.date);
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  document.dispatchEvent(new CustomEvent('dr-render'));
  showToast('Morning removed from this phone.');
}

function upsert(current: CheckIn): void {
  const index = state.checkins.findIndex((checkin) => checkin.date === current.date);
  if (index >= 0) state.checkins[index] = structuredClone(current);
  else state.checkins.push(structuredClone(current));
  state.checkins.sort((a, b) => a.date.localeCompare(b.date));
}

function validate(current: CheckIn): string[] {
  const problems: string[] = [];
  if (badNumber(current.restingHr) || badNumber(current.hrvRmssd) || badNumber(current.hrvSdnn) || badNumber(current.weightLb)) {
    problems.push('Use numbers for heart rate, HRV, and weight.');
  }
  if (current.restingHr != null && Number.isFinite(current.restingHr) && (current.restingHr < 25 || current.restingHr > 230)) problems.push('Resting HR should be between 25 and 230.');
  if (current.hrvRmssd != null && Number.isFinite(current.hrvRmssd) && (current.hrvRmssd < 1 || current.hrvRmssd > 400)) problems.push('rMSSD should be between 1 and 400 ms.');
  if (current.hrvSdnn != null && Number.isFinite(current.hrvSdnn) && (current.hrvSdnn < 1 || current.hrvSdnn > 400)) problems.push('SDNN should be between 1 and 400 ms.');
  if (current.weightLb != null && Number.isFinite(current.weightLb) && (current.weightLb < 50 || current.weightLb > 500)) problems.push('Weight should be between 50 and 500 lb.');
  const any = METRIC_KEYS.some((key) => finiteMetric(current[key])) || current.note.trim() || finiteMetric(current.weightLb);
  if (!any) problems.push('Enter at least one field.');
  return problems;
}

function refreshValidity(current: CheckIn, error: HTMLElement, saveButton: HTMLButtonElement): void {
  const problems = validate(current);
  const empty = problems.length === 1 && problems[0].startsWith('Enter at least');
  error.textContent = empty ? '' : problems[0] ?? '';
  saveButton.disabled = problems.length > 0;
}

function badNumber(value: number | null): boolean {
  return value != null && !Number.isFinite(value);
}

function finiteMetric(value: number | null): boolean {
  return value != null && Number.isFinite(value);
}

function withDraft(checkins: CheckIn[], current: CheckIn): CheckIn[] {
  return [...checkins.filter((checkin) => checkin.date !== current.date), current];
}

function tsbOf(checkin: CheckIn): number | null {
  if (checkin.ctl == null || checkin.atl == null) return null;
  return checkin.ctl - checkin.atl;
}

function numberInput(value: number | null, step: string, mode: 'numeric' | 'decimal'): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.inputMode = mode;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  input.dataset.step = step;
  input.value = value == null ? '' : String(value);
  return input;
}

function readNumber(input: HTMLInputElement): number | null {
  const text = input.value.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

function readSelect(select: HTMLSelectElement): number | null {
  if (!select.value) return null;
  const value = Number(select.value);
  return Number.isFinite(value) ? value : null;
}

function scaleSelect(key: keyof typeof SCALE_BY_METRIC, value: number | null): HTMLSelectElement {
  const select = el('select');
  const blank = el('option', '', 'Choose');
  blank.value = '';
  select.append(blank);
  for (const option of SCALE_BY_METRIC[key]) {
    const node = el('option', '', `${option.value} · ${option.label}`);
    node.value = String(option.value);
    select.append(node);
  }
  select.value = value == null ? '' : String(value);
  return select;
}

function weightLine(pounds: number | null): string {
  if (pounds == null || !Number.isFinite(pounds)) return 'Shown in pounds. intervals.icu stores kilograms.';
  if (pounds < 50 || pounds > 500) return 'Shown in pounds. intervals.icu stores kilograms.';
  return `${formatNumber(roundTo(lbToKg(pounds), 2), 2)} kg on intervals.icu`;
}

function snapshot(checkin: CheckIn): Pick<CheckIn, 'restingHr' | 'hrvRmssd' | 'hrvSdnn' | 'weightLb'> {
  return {
    restingHr: checkin.restingHr,
    hrvRmssd: checkin.hrvRmssd,
    hrvSdnn: checkin.hrvSdnn,
    weightLb: checkin.weightLb,
  };
}

function describeFill(
  before: Pick<CheckIn, 'restingHr' | 'hrvRmssd' | 'hrvSdnn' | 'weightLb'>,
  after: CheckIn,
  prefill: IntervalsPrefill,
): string {
  const filled: string[] = [];
  if (before.restingHr == null && after.restingHr != null) filled.push('resting HR');
  if (before.hrvRmssd == null && after.hrvRmssd != null) filled.push('rMSSD');
  if (before.hrvSdnn == null && after.hrvSdnn != null) filled.push('SDNN');
  if (before.weightLb == null && after.weightLb != null) filled.push('weight');
  const sleep = prefill.intervalsSleepLabel
    ? `Intervals sleep quality is ${prefill.intervalsSleepLabel} on their 1–4 scale, so it was not copied into your 1–7 field.`
    : '';
  const lead = filled.length ? `Filled ${filled.join(', ')} from intervals.icu.` : '';
  return [lead, sleep].filter(Boolean).join(' ');
}
