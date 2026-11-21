import { addDays } from './dates';
import { blankCheckIn } from './intervals-map';
import type { CheckIn, WorkoutLog, WorkoutQuality } from './types';

const QUALITIES: WorkoutQuality[] = [1, 3, 5, 7, 9];

/** Made-up mornings for the empty-state preview. Never written to storage. */
export function exampleLog(): { checkins: CheckIn[]; workouts: WorkoutLog[] } {
  const end = '2026-11-20';
  const checkins: CheckIn[] = [];
  const workouts: WorkoutLog[] = [];
  for (let i = 0; i < 48; i++) {
    const date = addDays(end, i - 47);
    const hrvWave = Math.sin(i / 4);
    const feelWave = Math.sin(i / 4 + 1.2);
    const soreWave = Math.sin(i / 5 + 2);
    const checkin = blankCheckIn(date, '2026-11-20T12:00:00.000Z');
    checkin.restingHr = Math.round(48 - 4 * hrvWave);
    checkin.hrvRmssd = Math.round(58 + 14 * hrvWave);
    checkin.hrvSdnn = Math.round(72 + 10 * hrvWave);
    checkin.sleepQuality = clamp(Math.round(4 + 2 * feelWave), 1, 7);
    checkin.soreness = clamp(Math.round(4 + 2 * soreWave), 1, 8);
    checkin.stress = clamp(Math.round(4 + soreWave), 1, 7);
    checkin.mood = clamp(Math.round(2 + feelWave), 1, 3);
    checkin.feeling = clamp(Math.round(5 + 2 * feelWave), 1, 8);
    checkin.weightLb = 165;
    checkin.ctl = 70;
    checkin.atl = 68 - 4 * hrvWave;
    checkins.push(checkin);
    workouts.push({
      id: `example-${date}`,
      date,
      quality: QUALITIES[clamp(Math.round(2 + 2 * feelWave), 0, 4)],
      activityId: null,
      activityName: null,
      note: '',
      updatedAt: checkin.updatedAt,
    });
  }
  return { checkins, workouts };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
