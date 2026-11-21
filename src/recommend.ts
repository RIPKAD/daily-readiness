import type { Band } from './score';
import { formatNumber } from './units';

export type Advice = {
  title: string;
  lede: string;
  points: string[];
};

export function recommend(input: {
  status: 'empty' | 'building' | 'no-weight' | 'ready';
  band?: Band | null;
  tsb?: number | null;
  weekKj?: number | null;
  weekTarget?: number | null;
}): Advice {
  const weekLine = weekSentence(input.weekKj, input.weekTarget);
  const nearCap =
    input.weekKj != null &&
    input.weekTarget != null &&
    input.weekTarget > 0 &&
    input.weekKj >= input.weekTarget * 0.9;

  if (input.status === 'no-weight') {
    return {
      title: 'Set a weight to score the morning',
      lede: 'The baseline is long enough, and every metric weight is zero.',
      points: [
        'Give HRV rMSSD and overall feeling a weight in Settings, then come back.',
        'Until then, keep the day aerobic and below LT1 and hold the weekly kilojoules steady.',
      ],
    };
  }

  if (input.status !== 'ready' || !input.band) {
    return {
      title: 'Building your baseline',
      lede: 'A metric needs about seven earlier days inside the window before it can move the score.',
      points: compact([
        'Keep the work aerobic and below LT1.',
        'Hold the weekly kilojoules steady while the baseline fills in.',
        'Log the same fields each morning so the comparison is yours, not a generic chart.',
        weekLine,
      ]),
    };
  }

  const formLine = formSentence(input.tsb, input.band, nearCap);

  if (input.band === 'green') {
    return {
      title: nearCap ? 'Ready, and the week is nearly full' : 'Room for a little more',
      lede: nearCap
        ? 'The morning is better than your baseline, and the weekly kilojoules are already close to the target.'
        : 'The morning is better than your own baseline. Stay aerobic, and the day can be a bit bigger.',
      points: compact([
        'Keep the work below LT1.',
        nearCap
          ? 'Leave the extra work for another week. Today stays inside the plan.'
          : 'Add a little duration, or one harder aerobic piece, if this week’s kilojoules still have room.',
        'Spread the week’s energy across the other days.',
        formLine,
        weekLine,
      ]),
    };
  }

  if (input.band === 'amber') {
    return {
      title: 'Steady aerobic day',
      lede: 'The morning is close to your baseline. Do the planned aerobic work and leave the intensity where it is.',
      points: compact([
        'Stay below LT1.',
        'If today gets shorter, add easy volume on another day so the weekly kilojoules stay on track.',
        formLine,
        weekLine,
      ]),
    };
  }

  return {
    title: 'Make today easier',
    lede: 'The morning is below your baseline. A shorter easy session, or rest, keeps the rest of the week intact.',
    points: compact([
      'Keep anything you do aerobic and below LT1.',
      'Leave the later days easy enough that the weekly kilojoules still get done.',
      'Save the longer or harder aerobic work for a greener morning.',
      formLine,
      weekLine,
    ]),
  };
}

function formSentence(tsb: number | null | undefined, band: Band, nearCap: boolean): string | null {
  if (tsb == null || !Number.isFinite(tsb)) return null;
  const shown = Math.round(tsb);
  const signed = shown > 0 ? `+${shown}` : String(shown);
  if (shown <= -15) {
    return `Form (CTL − ATL) is ${signed}. Fatigue is up, so bias toward the easier end of this advice.`;
  }
  if (shown >= 15 && band === 'green' && !nearCap) {
    return `Form (CTL − ATL) is ${signed}, which agrees with a little more aerobic work.`;
  }
  return null;
}

function weekSentence(weekKj: number | null | undefined, target: number | null | undefined): string | null {
  if (weekKj == null || !Number.isFinite(weekKj)) return null;
  const done = `${formatNumber(weekKj, 0)} kJ`;
  if (target != null && target > 0) {
    return `This week so far: ${done} of ${formatNumber(target, 0)} kJ. The week starts Monday, and the total is mechanical work from intervals.icu.`;
  }
  return `This week so far: ${done} of mechanical work from intervals.icu. The week starts Monday.`;
}

function compact(lines: Array<string | null>): string[] {
  return lines.filter((line): line is string => Boolean(line));
}
