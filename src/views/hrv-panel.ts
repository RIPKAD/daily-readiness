import { mergeHrvRows, detectImport } from '../exchange';
import type { HrvParseOk } from '../hrv';
import { state } from '../state';
import { persistDatabase } from '../storage';
import { button, el, showToast } from '../ui';

export function mountHrvImport(parent: HTMLElement): void {
  const box = el('section', 'panel');
  const file = el('input');
  file.type = 'file';
  file.accept = '.csv,text/csv,text/plain';
  file.id = `hrv-file-${Math.random().toString(16).slice(2)}`;
  const fileLabel = el('label', 'secondary file-button', 'Choose CSV');
  fileLabel.htmlFor = file.id;
  const paste = el('textarea');
  paste.rows = 4;
  paste.placeholder = 'Or paste the CSV here.';
  const preview = el('div', 'preview');
  const actions = el('div', 'row');
  box.append(el('p', 'hint', 'You will see a preview before anything is saved.'));
  box.append(fileLabel, file, paste, preview, actions);
  file.hidden = true;
  parent.append(box);

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    void chosen.text().then((text) => show(text, preview, actions));
  });
  paste.addEventListener('change', () => {
    if (paste.value.trim()) show(paste.value, preview, actions);
  });
}

function show(text: string, preview: HTMLElement, actions: HTMLElement): void {
  preview.replaceChildren();
  actions.replaceChildren();
  const detected = detectImport(text);
  if (detected.kind === 'error') {
    preview.append(el('p', 'form-error', detected.error));
    return;
  }
  if (detected.kind !== 'hrv') {
    preview.append(el('p', 'form-error', 'That file looks like a backup, not an HRV4Training export. Import backups from Settings.'));
    return;
  }
  const result = detected.result;
  const counts = count(result);
  preview.append(el('p', 'lede', `${result.rows.length} days · ${counts.rmssd} with rMSSD · ${counts.sdnn} with SDNN. Columns: ${[result.columns.date, result.columns.rmssd, result.columns.sdnn].filter(Boolean).join(', ')}.`));
  for (const warning of result.warnings) preview.append(el('p', 'hint', warning));
  const table = el('table', 'sheet');
  const head = el('tr');
  for (const name of ['Date', 'rMSSD', 'SDNN', 'On this phone']) head.append(el('th', '', name));
  table.append(head);
  const shown = result.rows.length > 8 ? [...result.rows.slice(0, 6), ...result.rows.slice(-1)] : result.rows;
  for (const row of shown) {
    const existing = state.checkins.find((checkin) => checkin.date === row.date);
    const status = !existing ? 'New' : 'Updates HRV';
    const tr = el('tr');
    tr.append(el('td', '', row.date));
    tr.append(el('td', '', row.rmssd == null ? '—' : String(row.rmssd)));
    tr.append(el('td', '', row.sdnn == null ? '—' : String(row.sdnn)));
    tr.append(el('td', '', status));
    table.append(tr);
  }
  preview.append(table);
  if (result.rows.length > 8) preview.append(el('p', 'hint', `${result.rows.length - 7} more days are hidden in this preview and will still be saved.`));
  actions.append(button('Save HRV on this phone', 'primary', () => {
    void commit(result, preview);
  }));
}

async function commit(result: HrvParseOk, preview: HTMLElement): Promise<void> {
  const merged = mergeHrvRows(state.checkins, result.rows, new Date().toISOString());
  state.checkins = merged.checkins;
  await persistDatabase({ checkins: state.checkins, workouts: state.workouts, benchmarks: state.benchmarks });
  preview.replaceChildren(el('p', 'lede', `Saved ${merged.created} new days and updated ${merged.updated}. HRV was not sent to intervals.icu.`));
  document.dispatchEvent(new CustomEvent('dr-hrv'));
  showToast(`HRV saved on this phone. ${merged.created} new days, ${merged.updated} updated.`);
}

function count(result: HrvParseOk): { rmssd: number; sdnn: number } {
  return {
    rmssd: result.rows.filter((row) => row.rmssd != null).length,
    sdnn: result.rows.filter((row) => row.sdnn != null).length,
  };
}
