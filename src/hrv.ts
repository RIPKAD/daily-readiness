import { isIsoDate } from './dates';

export type HrvRow = {
  date: string;
  rmssd: number | null;
  sdnn: number | null;
};

export type HrvParseOk = {
  ok: true;
  rows: HrvRow[];
  warnings: string[];
  skipped: number;
  columns: { date: string; rmssd: string | null; sdnn: string | null };
};

export type HrvParseResult = HrvParseOk | { ok: false; error: string };

const DATE_PRIORITY = ['date', 'localdate', 'datetime', 'timestamp', 'measurementdate', 'day', 'local'];

export function parseHrvCsv(text: string): HrvParseResult {
  const table = parseDelimited(text);
  if (!table.length) return { ok: false, error: 'The file is empty.' };
  const header = table[0].map(normalizeHeader);
  const dateIndex = findDateColumn(header);
  if (dateIndex < 0) {
    return { ok: false, error: 'No date column found. Expected a header like date, local, or timestamp.' };
  }
  const rmssdIndex = findHrvColumn(header, 'rmssd');
  const sdnnIndex = findHrvColumn(header, 'sdnn');
  if (rmssdIndex < 0 && sdnnIndex < 0) {
    return {
      ok: false,
      error: 'No rMSSD or SDNN column found. Headers such as rMSSD, RMSSD, rMSSD_lying, HRV, SDNN, and hrvSDNN are accepted. lnRMSSD is skipped because it is a different number.',
    };
  }

  const rawDates = table.slice(1).map((row) => (row[dateIndex] ?? '').trim()).filter(Boolean);
  const order = detectYmdOrder(rawDates);
  const warnings: string[] = [];
  if (order.ambiguous) {
    warnings.push('Every date could be read as year-month-day or year-day-month. They were read as year-month-day. If the mornings land on the wrong days, this file is the Android HRV4Training order (year-day-month) and you should say so before saving.');
  }
  if (order.mode === 'ydm') {
    warnings.push('Dates look like the Android HRV4Training export (year-day-month). They were converted to year-month-day.');
  }

  const byDate = new Map<string, HrvRow>();
  let skipped = 0;
  let duplicates = 0;
  for (const row of table.slice(1)) {
    const rawDate = (row[dateIndex] ?? '').trim();
    if (!rawDate) {
      skipped += 1;
      continue;
    }
    const date = parseDateCell(rawDate, order.mode);
    if (!date) {
      skipped += 1;
      warnings.push(`Skipped a row with an unreadable date “${rawDate.slice(0, 32)}”.`);
      continue;
    }
    const rmssd = rmssdIndex >= 0 ? parseMeasure(row[rmssdIndex]) : null;
    const sdnn = sdnnIndex >= 0 ? parseMeasure(row[sdnnIndex]) : null;
    if (rmssd == null && sdnn == null) {
      skipped += 1;
      continue;
    }
    if (byDate.has(date)) duplicates += 1;
    const previous = byDate.get(date);
    byDate.set(date, {
      date,
      rmssd: rmssd ?? previous?.rmssd ?? null,
      sdnn: sdnn ?? previous?.sdnn ?? null,
    });
  }

  if (duplicates) warnings.push(`${duplicates} repeated date${duplicates === 1 ? '' : 's'} in the file. The last reading with a number was kept.`);
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) {
    return { ok: false, error: 'No rows had a date plus an rMSSD or SDNN value. Zeros were treated as missing.' };
  }
  return {
    ok: true,
    rows,
    warnings: unique(warnings).slice(0, 8),
    skipped,
    columns: {
      date: table[0][dateIndex] ?? 'date',
      rmssd: rmssdIndex >= 0 ? table[0][rmssdIndex] ?? null : null,
      sdnn: sdnnIndex >= 0 ? table[0][sdnnIndex] ?? null : null,
    },
  };
}

export function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findDateColumn(headers: string[]): number {
  for (const name of DATE_PRIORITY) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return headers.findIndex((header) => header.includes('date') && !header.includes('update'));
}

function findHrvColumn(headers: string[], kind: 'rmssd' | 'sdnn'): number {
  const matches = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes(kind) && !header.includes('ln'));
  if (matches.length) return matches[0].index;
  if (kind === 'rmssd') {
    const hrv = headers.indexOf('hrv');
    if (hrv >= 0) return hrv;
  }
  return -1;
}

function parseMeasure(value: string | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(',', '.');
  if (!cleaned) return null;
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

type DateMode = 'ymd' | 'ydm' | 'mdy' | 'dmy';

function detectYmdOrder(samples: string[]): { mode: DateMode; ambiguous: boolean } {
  const parts = samples
    .map(splitDate)
    .filter((part): part is [number, number, number] => part != null);
  if (!parts.length) return { mode: 'ymd', ambiguous: false };
  const yearFirst = parts.every(([a]) => a > 31);
  if (yearFirst) {
    const middleOver = parts.some(([, b]) => b > 12);
    const lastOver = parts.some(([, , c]) => c > 12);
    if (middleOver && !lastOver) return { mode: 'ydm', ambiguous: false };
    if (lastOver && !middleOver) return { mode: 'ymd', ambiguous: false };
    if (middleOver && lastOver) return { mode: 'ymd', ambiguous: false };
    return { mode: 'ymd', ambiguous: true };
  }
  const firstOver = parts.some(([a]) => a > 12);
  const middleOver = parts.some(([, b]) => b > 12);
  if (firstOver && !middleOver) return { mode: 'dmy', ambiguous: false };
  if (middleOver && !firstOver) return { mode: 'mdy', ambiguous: false };
  return { mode: 'mdy', ambiguous: true };
}

function splitDate(raw: string): [number, number, number] | null {
  const datePart = raw.trim().split(/[T\s]/)[0] ?? '';
  if (/^\d{5}$/.test(datePart)) {
    const iso = excelSerial(Number(datePart));
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return [y, m, d];
  }
  const match = datePart.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseDateCell(raw: string, mode: DateMode): string | null {
  const serial = raw.trim().match(/^\d{5}$/);
  if (serial) return excelSerial(Number(raw.trim()));
  const parts = splitDate(raw);
  if (!parts) return null;
  let year: number;
  let month: number;
  let day: number;
  if (parts[0] > 31) {
    year = parts[0];
    if (mode === 'ydm' && parts[1] > 12 && parts[2] <= 12) {
      day = parts[1];
      month = parts[2];
    } else if (mode === 'ydm' && parts[1] <= 12 && parts[2] <= 12) {
      day = parts[1];
      month = parts[2];
    } else if (parts[1] > 12 && parts[2] <= 12) {
      day = parts[1];
      month = parts[2];
    } else {
      month = parts[1];
      day = parts[2];
    }
  } else if (mode === 'dmy') {
    day = parts[0];
    month = parts[1];
    year = parts[2];
  } else {
    month = parts[0];
    day = parts[1];
    year = parts[2];
  }
  if (year < 100) year += 2000;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

function excelSerial(serial: number): string | null {
  if (serial < 20_000 || serial > 80_000) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  const iso = date.toISOString().slice(0, 10);
  return isIsoDate(iso) ? iso : null;
}

export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const line = text.split('\n')[0] ?? '';
  const scores: Record<',' | ';' | '\t', number> = {
    ',': countChar(line, ','),
    ';': countChar(line, ';'),
    '\t': countChar(line, '\t'),
  };
  return (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] as ',' | ';' | '\t') || ',';
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
