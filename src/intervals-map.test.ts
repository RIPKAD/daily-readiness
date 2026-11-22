import { describe, expect, it } from 'vitest';
import { blankCheckIn, mapWellness, wellnessPayload, applyPrefill, basicAuthHeader } from './intervals-map';
import { LB_PER_KG, lbToKg } from './units';

describe('intervals mapping', () => {
  it('converts pounds to kilograms and writes only clean fields', () => {
    expect(LB_PER_KG).toBe(2.20462);
    expect(lbToKg(220.462)).toBeCloseTo(100, 8);
    const checkin = blankCheckIn('2026-11-21');
    checkin.restingHr = 48;
    checkin.hrvRmssd = 60.126;
    checkin.hrvSdnn = 80;
    checkin.weightLb = 220.462;
    checkin.sleepQuality = 7;
    checkin.soreness = 8;
    checkin.fatigue = 5;
    checkin.stress = 6;
    checkin.mood = 3;
    checkin.feeling = 8;
    const body = wellnessPayload(checkin);
    expect(body).toEqual({ restingHR: 48, hrv: 60.13, hrvSDNN: 80, weight: 100 });
    expect(Object.keys(body).sort()).toEqual(['hrv', 'hrvSDNN', 'restingHR', 'weight']);
    expect(body).not.toHaveProperty('soreness');
    expect(body).not.toHaveProperty('fatigue');
    expect(body).not.toHaveProperty('stress');
    expect(body).not.toHaveProperty('mood');
    expect(body).not.toHaveProperty('sleepQuality');
    expect(body).not.toHaveProperty('fatigue');
  });

  it('prefills objective fields and keeps the intervals sleep scale separate', () => {
    const prefill = mapWellness({
      restingHR: -1,
      hrv: 0,
      hrvSDNN: '72.5',
      weight: 80,
      ctl: 0,
      atl: 55.2,
      sleepSecs: 27000,
      sleepQuality: 1,
      soreness: 4,
      fatigue: 3,
    });
    expect(prefill.restingHr).toBeNull();
    expect(prefill.hrvRmssd).toBeNull();
    expect(prefill.hrvSdnn).toBe(72.5);
    expect(prefill.weightLb).toBe(176.4);
    expect(prefill.ctl).toBe(0);
    expect(prefill.atl).toBe(55.2);
    expect(prefill.sleepHours).toBe(7.5);
    expect(prefill.intervalsSleepQuality).toBe(1);
    expect(prefill.intervalsSleepLabel).toBe('Excellent');
    expect(prefill).not.toHaveProperty('sleepQuality');
    expect(prefill).not.toHaveProperty('soreness');
    expect(prefill).not.toHaveProperty('fatigue');
  });

  it('fills blanks without replacing a value already on the phone', () => {
    const existing = blankCheckIn('2026-11-21');
    existing.restingHr = 46;
    existing.feeling = 6;
    const merged = applyPrefill(existing, '2026-11-21', mapWellness({
      restingHR: 50,
      hrv: 61,
      weight: 75,
      ctl: 70,
    }), '2026-11-21T12:00:00.000Z');
    expect(merged?.restingHr).toBe(46);
    expect(merged?.feeling).toBe(6);
    expect(merged?.hrvRmssd).toBe(61);
    expect(merged?.weightLb).toBeCloseTo(75 * 2.20462, 1);
    expect(merged?.ctl).toBe(70);
  });

  it('builds a basic header for the API_KEY username', () => {
    const header = basicAuthHeader('secret-key');
    expect(header.startsWith('Basic ')).toBe(true);
    expect(atob(header.slice(6))).toBe('API_KEY:secret-key');
  });
});
