import { describe, expect, it } from 'vitest';
import { parseHrvCsv } from './hrv';

describe('HRV4Training CSV', () => {
  it('reads rMSSD and SDNN with messy headers', () => {
    const csv = '\uFEFFdate,rMSSD (ms),SDNN ms,lnrMSSD,note\n2024-02-01,44.5,70,3.8,"fine, slept late"\n';
    const result = parseHrvCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ date: '2024-02-01', rmssd: 44.5, sdnn: 70 }]);
    expect(result.columns.rmssd).toBe('rMSSD (ms)');
  });

  it('converts Android year-day-month dates when a day is past 12', () => {
    const csv = 'date,rMSSD,SDNN\n2023-14-07,40,60\n2023-05-07,42,61\n';
    const result = parseHrvCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.date)).toEqual(['2023-07-05', '2023-07-14']);
    expect(result.warnings.some((warning) => warning.includes('year-day-month'))).toBe(true);
  });

  it('keeps ISO dates and warns when day and month are ambiguous', () => {
    const csv = 'date,rMSSD\n2023-05-07,40\n2023-06-08,41\n';
    const result = parseHrvCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.date)).toEqual(['2023-05-07', '2023-06-08']);
    expect(result.warnings.some((warning) => warning.includes('year-month-day'))).toBe(true);
  });

  it('accepts semicolon files, lying columns, and a plain HRV header', () => {
    const csv = 'local;rMSSD_lying;SDNN_lying\n2024-03-01;33;55\n';
    const result = parseHrvCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ date: '2024-03-01', rmssd: 33, sdnn: 55 });

    const hrv = parseHrvCsv('Date,HRV,SDNN\n2024-04-02,61,88\n');
    expect(hrv.ok).toBe(true);
    if (!hrv.ok) return;
    expect(hrv.rows[0].rmssd).toBe(61);
  });

  it('treats zero as missing and ignores an lnRMSSD-only file', () => {
    const csv = 'date,rMSSD,SDNN\n2024-01-01,0,0\n2024-01-02,0,40\n';
    const result = parseHrvCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ date: '2024-01-02', rmssd: null, sdnn: 40 }]);

    const lnOnly = parseHrvCsv('date,lnrMSSD\n2024-01-01,4.1\n');
    expect(lnOnly.ok).toBe(false);
  });

  it('prefers rMSSD over lnRMSSD when both exist', () => {
    const result = parseHrvCsv('date,lnrMSSD,rMSSD\n2024-01-02,4,50\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].rmssd).toBe(50);
  });
});
