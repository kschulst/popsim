import type { TickStats } from './types';

export interface Mortality {
  /** Deaths from starvation or age (removals in the branch editor are excluded). */
  deaths: number;
  ageDeaths: number;
  /** Share of deaths caused by age, 0–1; NaN when there are no deaths. */
  ageShare: number;
  /** Mean age at death in ticks; NaN when unknown. */
  meanAge: number;
}

/**
 * Mortality over the stats rows with `from < tick <= to`. Rows imported from files written before
 * age at death was recorded have `deathAgeSum` NaN; they count toward the shares but not the mean age.
 */
export const mortality = (rows: TickStats[], from: number, to: number): Mortality => {
  let deaths = 0;
  let ageDeaths = 0;
  let agedDeaths = 0;
  let ageSum = 0;
  for (const r of rows) {
    if (r.tick <= from || r.tick > to) continue;
    const n = r.deathsStarvation + r.deathsAge;
    deaths += n;
    ageDeaths += r.deathsAge;
    if (Number.isFinite(r.deathAgeSum)) {
      agedDeaths += n;
      ageSum += r.deathAgeSum;
    }
  }
  return {
    deaths,
    ageDeaths,
    ageShare: deaths ? ageDeaths / deaths : NaN,
    meanAge: agedDeaths ? ageSum / agedDeaths : NaN,
  };
};
