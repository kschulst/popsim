import type { TickStats } from './types';

export interface Mortality {
  /** Children born in the window. */
  births: number;
  /** All deaths except removals in the branch editor. */
  deaths: number;
  ageDeaths: number;
  killed: number;
  /** Share of deaths caused by killing, 0–1; NaN when there are no deaths. */
  killedShare: number;
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
  let births = 0;
  let deaths = 0;
  let ageDeaths = 0;
  let killed = 0;
  let agedDeaths = 0;
  let ageSum = 0;
  for (const r of rows) {
    if (r.tick <= from || r.tick > to) continue;
    births += r.births;
    const k = r.deathsKilled ?? 0;
    const n = r.deathsStarvation + r.deathsAge + k + (r.deathsChildbirth ?? 0) + (r.deathsInfant ?? 0) + (r.deathsDisease ?? 0) + (r.deathsCatastrophe ?? 0);
    deaths += n;
    ageDeaths += r.deathsAge;
    killed += k;
    if (Number.isFinite(r.deathAgeSum)) {
      agedDeaths += n;
      ageSum += r.deathAgeSum;
    }
  }
  return {
    births,
    deaths,
    ageDeaths,
    killed,
    ageShare: deaths ? ageDeaths / deaths : NaN,
    killedShare: deaths ? killed / deaths : NaN,
    meanAge: agedDeaths ? ageSum / agedDeaths : NaN,
  };
};
