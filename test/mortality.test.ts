import { describe, expect, it } from 'vitest';
import { mortality } from '../src/sim/mortality';
import type { TickStats } from '../src/sim/types';

const row = (tick: number, starv: number, age: number, ageSum: number): TickStats =>
  ({ tick, deathsStarvation: starv, deathsAge: age, deathAgeSum: ageSum }) as TickStats;

describe('mortality', () => {
  it('computes age share and mean age at death within the window', () => {
    const rows = [row(1, 2, 0, 100), row(2, 1, 1, 1100), row(3, 0, 2, 2000)];
    const all = mortality(rows, 0, 3);
    expect(all.deaths).toBe(6);
    expect(all.ageShare).toBeCloseTo(3 / 6);
    expect(all.meanAge).toBeCloseTo(3200 / 6);
    const last = mortality(rows, 1, 2);
    expect(last.deaths).toBe(2);
    expect(last.meanAge).toBe(550);
  });

  it('returns NaN without deaths and skips rows without recorded ages for the mean', () => {
    expect(mortality([row(1, 0, 0, 0)], 0, 1).ageShare).toBeNaN();
    const m = mortality([row(1, 1, 1, NaN), row(2, 1, 0, 40)], 0, 2);
    expect(m.ageShare).toBeCloseTo(1 / 3);
    expect(m.meanAge).toBe(40);
  });
});
