import { describe, expect, it } from 'vitest';
import { recommend } from './recommend';

describe('recommendation', () => {
  it('keeps green days aerobic and protects a nearly full week', () => {
    const green = recommend({ status: 'ready', band: 'green', weekKj: 2000, weekTarget: 8000 });
    const text = `${green.title} ${green.lede} ${green.points.join(' ')}`;
    expect(text).toMatch(/LT1/);
    expect(text).toMatch(/kilojoules/i);
    expect(text.toLowerCase()).toMatch(/add a little|harder aerobic/);

    const full = recommend({ status: 'ready', band: 'green', weekKj: 7600, weekTarget: 8000 });
    const fullText = `${full.title} ${full.points.join(' ')}`;
    expect(fullText.toLowerCase()).toMatch(/near/);
    expect(fullText).not.toMatch(/Add a little duration/);
  });

  it('makes a red morning easier and withholds a score while the baseline is short', () => {
    const red = recommend({ status: 'ready', band: 'red', tsb: -20 });
    const text = `${red.title} ${red.lede} ${red.points.join(' ')}`;
    expect(text.toLowerCase()).toMatch(/easier|shorter/);
    expect(text).toMatch(/LT1/);
    expect(text).toMatch(/kilojoules/i);
    expect(text).toMatch(/Form/);

    const building = recommend({ status: 'building' });
    expect(building.title.toLowerCase()).toMatch(/baseline/);
    expect(`${building.lede} ${building.points.join(' ')}`).toMatch(/seven/i);
  });
});
