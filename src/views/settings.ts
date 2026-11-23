import { addDays, todayIso } from '../dates';
import {
  detectImport,
  exportBackup,
  exportCheckinsCsv,
  exportFoodCsv,
  exportWorkoutsCsv,
  mergeBackup,
  mergeCheckins,
  type Backup,
} from '../exchange';
import { fetchAthleteName, fetchWellnessRange, IntervalsError } from '../intervals';
import { applyPrefill, normalizeApiKey, type IntervalsPrefill } from '../intervals-map';
import { applySuggestion, suggestWeights, type WeightSuggestion } from '../score';
import { METRICS } from '../scales';
import { state } from '../state';
import { exportStrengthCsv } from '../strength';
import { clearApiKey, persistDatabase, saveApiKey, saveSettings, storageWarning } from '../storage';
import type { Settings } from '../types';
import { button, download, el, field, showToast } from '../ui';
import { mountHrvImport } from './hrv-panel';

export function renderSettings(main: HTMLElement): void {
  const header = el('header', 'page-head');
  header.append(el('p', 'eyebrow', 'On this phone'));
  header.append(el('h1', 'title', 'Settings'));
  main.append(header);
  const stored = storageWarning();
  if (stored) main.append(el('p', 'banner', stored));

  main.append(el('h2', 'section-title', 'intervals.icu'));
  main.append(el('p', 'lede', 'The API key stays in this browser’s local storage. It is not in the backup file and it is not sent anywhere except intervals.icu.'));
  const keyInput = el('input');
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.placeholder = state.apiKey ? 'Paste a replacement key' : 'Paste API key';
  const keyStatus = el('p', 'hint', state.apiKey ? keyHint(state.apiKey) : 'No key saved.');
  const keyRow = el('div', 'row wrap');
  keyRow.append(button('Save key', 'secondary', () => {
    const next = normalizeApiKey(keyInput.value);
    if (!next) {
      keyStatus.textContent = 'Paste the key first. The username intervals expects is API_KEY, and you do not type that.';
      return;
    }
    state.apiKey = next;
    saveApiKey(next);
    keyInput.value = '';
    keyStatus.textContent = keyHint(next);
    showToast('API key saved on this phone.');
  }));
  keyRow.append(button('Check connection', 'secondary', () => {
    void checkKey(keyInput, keyStatus);
  }));
  if (state.apiKey) {
    keyRow.append(button('Remove key', 'text-button danger', () => {
      state.apiKey = '';
      clearApiKey();
      keyStatus.textContent = 'Key removed from this phone.';
      showToast('API key removed.');
    }));
  }
  main.append(field('API key', keyInput), keyRow, keyStatus);
  main.append(el('p', 'hint', 'Browser calls to https://intervals.icu/api/v1/ are allowed. A check from this environment received Access-Control-Allow-Origin for the page’s origin, plus GET and PUT with an Authorization header. Subjective scores are still kept on this phone because the scales do not match.'));

  const importBox = el('div', 'panel');
  const importStatus = el('p', 'hint', 'Fetch about 120 days. Empty heart-rate, HRV, and weight fields get filled. Numbers you already typed stay.');
  let pending: { date: string; prefill: IntervalsPrefill }[] = [];
  importBox.append(button('Fetch wellness history', 'secondary', () => {
    void (async () => {
      if (!state.apiKey) {
        importStatus.textContent = 'Save an API key first.';
        return;
      }
      importStatus.textContent = 'Fetching…';
      try {
        const newest = todayIso();
        const oldest = addDays(newest, -120);
        const rows = await fetchWellnessRange(state.apiKey, oldest, newest);
        pending = rows.filter((row) => row.prefill.restingHr != null || row.prefill.hrvRmssd != null || row.prefill.hrvSdnn != null || row.prefill.weightLb != null);
        importStatus.textContent = pending.length
          ? `Found ${pending.length} days with heart rate, HRV, or weight. Merge fills blanks on this phone.`
          : 'No heart rate, HRV, or weight came back for that window.';
      } catch (error) {
        importStatus.textContent = error instanceof IntervalsError ? error.message : 'Could not fetch wellness.';
      }
    })();
  }));
  importBox.append(button('Merge into this phone', 'primary', () => {
    void (async () => {
      if (!pending.length) {
        importStatus.textContent = 'Fetch history before merging.';
        return;
      }
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;
      for (const row of pending) {
        const existing = state.checkins.find((checkin) => checkin.date === row.date);
        const next = applyPrefill(existing, row.date, row.prefill, now);
        if (!next || next === existing) continue;
        if (!existing) created += 1;
        else updated += 1;
        const index = state.checkins.findIndex((checkin) => checkin.date === row.date);
        if (index >= 0) state.checkins[index] = next;
        else state.checkins.push(next);
      }
      state.checkins.sort((a, b) => a.date.localeCompare(b.date));
      await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
      showToast(`Merged wellness. ${created} new days, ${updated} updated.`);
      importStatus.textContent = `Merged. ${created} new days, ${updated} updated. Subjective scores were not copied.`;
      pending = [];
    })();
  }));
  importBox.append(importStatus);
  main.append(importBox);

  main.append(el('h2', 'section-title', 'Score'));
  main.append(el('p', 'lede', 'Each metric with at least seven values in the previous window gets a z-score against your own baseline. Resting HR, soreness, fatigue, and stress are flipped so a higher z means more ready. Score = 50 + 15 × the weighted mean z, held between 0 and 100.'));
  const baseline = el('input');
  baseline.type = 'number';
  baseline.min = '7';
  baseline.max = '365';
  baseline.step = '1';
  baseline.inputMode = 'numeric';
  baseline.value = String(state.settings.baselineDays);
  const target = el('input');
  target.type = 'number';
  target.min = '0';
  target.step = '1';
  target.inputMode = 'numeric';
  target.placeholder = 'Optional';
  target.value = state.settings.weeklyKjTarget == null ? '' : String(state.settings.weeklyKjTarget);
  const weightInputs = new Map<string, HTMLInputElement>();
  const weightStack = el('div', 'stack tight');
  for (const metric of METRICS) {
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.inputMode = 'decimal';
    input.value = String(state.settings.weights[metric.key] ?? metric.defaultWeight);
    weightInputs.set(metric.key, input);
    weightStack.append(field(`${metric.label} · ${metric.higherIsBetter ? 'higher is better' : 'higher is worse, score flips it'}`, input));
  }
  const scoreError = el('p', 'form-error');
  main.append(field('Baseline window (days)', baseline, 'Default 42. The morning being scored is not part of its own baseline.'));
  main.append(field('Weekly kJ target', target, 'Optional. Monday–Sunday mechanical work from intervals.icu. Leave blank if you do not want a target.'));
  main.append(weightStack);
  main.append(scoreError);
  main.append(button('Save score settings', 'primary', () => {
    const next = readSettings(baseline, target, weightInputs);
    if (!next) {
      scoreError.textContent = 'Baseline needs to be 7–365 days, and weights need to be zero or more.';
      return;
    }
    state.settings = next;
    saveSettings(next);
    scoreError.textContent = '';
    showToast('Score settings saved on this phone.');
  }));

  const suggestBox = el('div', 'panel');
  suggestBox.append(el('h2', 'section-title', 'Suggest weights'));
  suggestBox.append(el('p', 'lede', 'Once about 40 days have both a morning check-in and a main workout, each metric is correlated with that day’s quality. A second session is left out. Nothing changes until you apply the suggestion.'));
  const suggestOut = el('div');
  suggestBox.append(button('Check correlations', 'secondary', () => {
    const current = readSettings(baseline, target, weightInputs) ?? state.settings;
    const suggestion = suggestWeights(state.checkins, state.workouts, current);
    paintSuggestion(suggestOut, suggestion, () => {
      const base = readSettings(baseline, target, weightInputs);
      if (!base) return;
      state.settings = applySuggestion(base, suggestion);
      saveSettings(state.settings);
      document.dispatchEvent(new CustomEvent('dr-render'));
      showToast('Suggested weights are saved. You can still edit them.');
    });
  }));
  suggestBox.append(suggestOut);
  main.append(suggestBox);

  main.append(el('h2', 'section-title', 'Hidden foods'));
  const hiddenFoods = state.foods.filter((food) => food.hidden || state.hiddenFoodIds.includes(food.id));
  if (!hiddenFoods.length) main.append(el('p', 'hint', 'No hidden foods. Swipe a common food left, or hold it, to hide it.'));
  for (const food of hiddenFoods) {
    const row = el('article', 'log-row');
    row.append(el('p', 'log-title', food.name));
    row.append(button('Unhide', 'text-button', () => {
      state.hiddenFoodIds = state.hiddenFoodIds.filter((id) => id !== food.id);
      const index = state.foods.findIndex((item) => item.id === food.id);
      if (index >= 0) state.foods[index] = { ...state.foods[index], hidden: false };
      void persistDatabase({
        checkins: state.checkins,
        workouts: state.workouts,
        benchmarks: state.benchmarks,
        foods: state.foods,
        foodEntries: state.foodEntries,
        foodTargets: state.foodTargets,
        strengthSessions: state.strengthSessions,
        strengthTemplates: state.strengthTemplates,
        hiddenFoodIds: state.hiddenFoodIds,
      }).then(() => {
        showToast(`${food.name} is back in the list.`);
        document.dispatchEvent(new CustomEvent('dr-render'));
      });
    }));
    main.append(row);
  }

  main.append(el('h2', 'section-title', 'Backup'));
  const backupRow = el('div', 'row wrap');
  backupRow.append(button('Download JSON', 'secondary', () => {
    download(`daily-readiness-${todayIso()}.json`, exportBackup({
      settings: state.settings,
      checkins: state.checkins,
      workouts: state.workouts,
      benchmarks: state.benchmarks,
      foods: state.foods,
      foodEntries: state.foodEntries,
      foodTargets: state.foodTargets,
      strengthSessions: state.strengthSessions,
      strengthTemplates: state.strengthTemplates,
      hiddenFoodIds: state.hiddenFoodIds,
    }), 'application/json');
  }));
  backupRow.append(button('Download check-ins CSV', 'secondary', () => {
    download(`checkins-${todayIso()}.csv`, exportCheckinsCsv(state.checkins), 'text/csv');
  }));
  backupRow.append(button('Download workouts CSV', 'secondary', () => {
    download(`workouts-${todayIso()}.csv`, exportWorkoutsCsv(state.workouts), 'text/csv');
  }));
  backupRow.append(button('Download food totals CSV', 'secondary', () => {
    download(`food-${todayIso()}.csv`, exportFoodCsv(state.foodEntries, state.foodTargets), 'text/csv');
  }));
  backupRow.append(button('Download strength CSV', 'secondary', () => {
    download(`strength-${todayIso()}.csv`, exportStrengthCsv(state.strengthSessions), 'text/csv');
  }));
  main.append(backupRow);
  main.append(el('p', 'hint', 'JSON is the full log, food, strength, and the score settings. It does not include the API key. Food and lifting stay on this phone and are not sent to intervals.icu.'));

  const importPreview = el('div', 'preview');
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,.csv,text/csv,application/json,text/plain';
  file.hidden = true;
  file.id = 'backup-file';
  const fileLabel = el('label', 'secondary file-button', 'Choose a backup file');
  fileLabel.htmlFor = file.id;
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    void chosen.text().then((text) => showImport(text, importPreview));
  });
  main.append(fileLabel, file, importPreview);

  main.append(el('h2', 'section-title', 'HRV4Training CSV'));
  main.append(el('p', 'lede', 'The same importer as the Today page. Choose the file from Files or Dropbox. Preview comes before saving.'));
  mountHrvImport(main);

  main.append(el('h2', 'section-title', 'Erase this phone'));
  const erase = el('input');
  erase.type = 'text';
  erase.placeholder = 'Type delete';
  erase.autocomplete = 'off';
  main.append(field('Confirm', erase, 'Removes mornings, workouts, and benchmarks from this phone. The API key stays. intervals.icu is not changed.'));
  main.append(button('Erase local log', 'secondary danger-fill', () => {
    if (erase.value.trim().toLowerCase() !== 'delete') {
      showToast('Type delete to erase the log.');
      return;
    }
    void (async () => {
      state.checkins = [];
      state.workouts = [];
      state.benchmarks = [];
      state.preview = false;
      await persistDatabase({ checkins: [], workouts: [], benchmarks: [] });
      erase.value = '';
      document.dispatchEvent(new CustomEvent('dr-render'));
      showToast('Local log erased.');
    })();
  }));
}

function paintSuggestion(out: HTMLElement, suggestion: WeightSuggestion, onApply: () => void): void {
  out.replaceChildren();
  if (!suggestion.ready) {
    out.append(el('p', 'lede', `${suggestion.pairedDays} paired days so far. About ${suggestion.needed} are needed. A pair is a check-in and the main workout’s quality for that date. A second session that day is left out.`));
    return;
  }
  const table = el('table', 'sheet');
  const head = el('tr');
  for (const name of ['Metric', 'Pairs', 'r', 'Now', 'Suggested']) head.append(el('th', '', name));
  table.append(head);
  for (const row of suggestion.rows) {
    const tr = el('tr');
    tr.append(el('td', '', row.label));
    tr.append(el('td', '', String(row.pairs)));
    tr.append(el('td', '', row.r == null ? '—' : row.r.toFixed(2)));
    tr.append(el('td', '', row.current.toFixed(1)));
    tr.append(el('td', '', row.proposed == null ? '—' : row.proposed.toFixed(1)));
    table.append(tr);
  }
  out.append(table);
  out.append(el('p', 'hint', 'Suggested weights follow positive correlations and are scaled to the current total of those metrics. A zero means that metric did not rise with better workouts. Apply is the only way they get saved.'));
  const applicable = suggestion.rows.some((row) => row.proposed != null);
  if (applicable) out.append(button('Apply suggested weights', 'primary', onApply));
}

function showImport(text: string, preview: HTMLElement): void {
  preview.replaceChildren();
  const detected = detectImport(text);
  if (detected.kind === 'error') {
    preview.append(el('p', 'form-error', detected.error));
    return;
  }
  if (detected.kind === 'hrv') {
    preview.append(el('p', 'lede', 'This is an HRV file. Use the HRV section below so you can preview the rows before saving.'));
    return;
  }
  if (detected.kind === 'checkins') {
    preview.append(el('p', 'lede', `${detected.checkins.length} check-ins in this CSV. Merging replaces those dates on this phone.`));
    for (const warning of detected.warnings) preview.append(el('p', 'hint', warning));
    preview.append(button('Merge check-ins', 'primary', () => {
      void (async () => {
        state.checkins = mergeCheckins(state.checkins, detected.checkins);
        await persistDatabase({
          checkins: state.checkins,
          workouts: state.workouts,
          benchmarks: state.benchmarks,
          foods: state.foods,
          foodEntries: state.foodEntries,
          foodTargets: state.foodTargets,
        });
        showToast('Check-ins merged.');
        preview.replaceChildren(el('p', 'lede', 'Check-ins merged.'));
      })();
    }));
    return;
  }
  preview.append(el('p', 'lede', `${detected.backup.checkins.length} check-ins, ${detected.backup.workouts.length} workouts, ${detected.backup.benchmarks.length} benchmarks, ${detected.backup.foods.length} foods, ${detected.backup.foodEntries.length} food entries, ${detected.backup.strengthSessions.length} strength sessions.`));
  for (const warning of detected.backup.warnings) preview.append(el('p', 'hint', warning));
  if (detected.backup.settings) preview.append(el('p', 'hint', 'Score settings in the file will replace the ones on this phone.'));
  preview.append(button('Merge backup', 'primary', () => {
    void mergeJson(detected.backup, preview);
  }));
}

async function mergeJson(backup: Backup, preview: HTMLElement): Promise<void> {
  const merged = mergeBackup(state, backup);
  state.checkins = merged.checkins;
  state.workouts = merged.workouts;
  state.benchmarks = merged.benchmarks;
  state.foods = merged.foods;
  state.foodEntries = merged.foodEntries;
  state.foodTargets = merged.foodTargets;
  state.strengthSessions = merged.strengthSessions;
  state.strengthTemplates = merged.strengthTemplates;
  state.hiddenFoodIds = merged.hiddenFoodIds;
  if (backup.settings) {
    state.settings = backup.settings;
    saveSettings(backup.settings);
  }
  await persistDatabase({
    checkins: state.checkins,
    workouts: state.workouts,
    benchmarks: state.benchmarks,
    foods: state.foods,
    foodEntries: state.foodEntries,
    foodTargets: state.foodTargets,
    strengthSessions: state.strengthSessions,
    strengthTemplates: state.strengthTemplates,
    hiddenFoodIds: state.hiddenFoodIds,
  });
  showToast('Backup merged.');
  preview.replaceChildren(el('p', 'lede', 'Backup merged onto this phone.'));
}

async function checkKey(input: HTMLInputElement, status: HTMLElement): Promise<void> {
  const typed = normalizeApiKey(input.value);
  const key = typed || state.apiKey;
  if (!key) {
    status.textContent = 'Paste a key first.';
    return;
  }
  status.textContent = 'Checking…';
  try {
    const name = await fetchAthleteName(key);
    if (typed) {
      state.apiKey = typed;
      saveApiKey(typed);
      input.value = '';
    }
    status.textContent = `Connected as ${name}. ${keyHint(key)}`;
    showToast(`Connected as ${name}.`);
  } catch (error) {
    status.textContent = error instanceof IntervalsError ? error.message : 'Could not reach intervals.icu.';
  }
}

function readSettings(baseline: HTMLInputElement, target: HTMLInputElement, weights: Map<string, HTMLInputElement>): Settings | null {
  const days = Number(baseline.value);
  if (!Number.isFinite(days) || days < 7 || days > 365) return null;
  const next = {
    baselineDays: Math.round(days),
    weights: { ...state.settings.weights },
    weeklyKjTarget: target.value.trim() ? Number(target.value) : null,
  };
  if (next.weeklyKjTarget != null && (!Number.isFinite(next.weeklyKjTarget) || next.weeklyKjTarget <= 0)) return null;
  for (const metric of METRICS) {
    const value = Number(weights.get(metric.key)?.value);
    if (!Number.isFinite(value) || value < 0) return null;
    next.weights[metric.key] = value;
  }
  return next;
}

function keyHint(key: string): string {
  if (key.length < 8) return 'A key is saved on this phone.';
  return `A key is saved on this phone, ending in ${key.slice(-4)}.`;
}
