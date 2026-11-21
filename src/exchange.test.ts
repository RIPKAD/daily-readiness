import { describe, expect, it } from 'vitest';
import { blankCheckIn } from './intervals-map';
import { detectImport, exportBackup, exportCheckinsCsv, mergeHrvRows } from './exchange';
import { defaultSettings } from './storage';

describe('backup exchange', () => {
  it('round-trips a check-in without writing an API key', () => {
    const checkin = blankCheckIn('2026-11-21');
    checkin.restingHr = 47;
    checkin.weightLb = 165;
    checkin.note = 'easy, slept well';
    checkin.feeling = 6;
    const settings = defaultSettings();
    const json = exportBackup({ settings, checkins: [checkin], workouts: [], benchmarks: [] });
    expect(json).not.toMatch(/apiKey/i);
    const detected = detectImport(json);
    expect(detected.kind).toBe('json');
    if (detected.kind !== 'json') return;
    expect(detected.backup.checkins[0].restingHr).toBe(47);
    expect(detected.backup.checkins[0].feeling).toBe(6);
    expect(detected.backup.checkins[0].note).toBe('easy, slept well');

    const csv = exportCheckinsCsv([checkin]);
    const fromCsv = detectImport(csv);
    expect(fromCsv.kind).toBe('checkins');
    if (fromCsv.kind !== 'checkins') return;
    expect(fromCsv.checkins[0].weightLb).toBe(165);
    expect(fromCsv.checkins[0].note).toBe('easy, slept well');
  });

  it('ignores a key stuffed into a backup and merges HRV rows', () => {
    const detected = detectImport(JSON.stringify({
      kind: 'daily-readiness',
      version: 1,
      apiKey: 'do-not-keep',
      checkins: [{ date: '2026-11-01', restingHr: 44 }],
    }));
    expect(detected.kind).toBe('json');
    if (detected.kind !== 'json') return;
    expect(JSON.stringify(detected.backup)).not.toContain('do-not-keep');
    expect(detected.backup.warnings.join(' ')).toMatch(/ignored/i);

    const merged = mergeHrvRows(detected.backup.checkins, [
      { date: '2026-11-01', rmssd: 70, sdnn: 90 },
      { date: '2026-11-02', rmssd: 68, sdnn: null },
    ], '2026-11-21T00:00:00.000Z');
    expect(merged.updated).toBe(1);
    expect(merged.created).toBe(1);
    expect(merged.checkins[0].restingHr).toBe(44);
    expect(merged.checkins[0].hrvRmssd).toBe(70);
    expect(merged.checkins[1].hrvSdnn).toBeNull();
  });
});
