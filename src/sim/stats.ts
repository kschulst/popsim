import { GENE_KEYS, type Dominance, type Genome, type TickEvents, type TickStats, type World } from './types';

export const computeStats = (w: World, ev: TickEvents): TickStats => {
  const n = w.actors.length;
  const mean = {} as Genome;
  const sd = {} as Genome;
  const dominanceMean = {} as Dominance;
  for (const k of GENE_KEYS) {
    let s = 0;
    for (const a of w.actors) s += a.genome[k];
    const m = n ? s / n : 0;
    let v = 0;
    for (const a of w.actors) v += (a.genome[k] - m) ** 2;
    mean[k] = m;
    sd[k] = n ? Math.sqrt(v / n) : 0;
    let d = 0;
    for (const a of w.actors) d += a.dominance[k];
    dominanceMean[k] = n ? d / n : 0;
  }
  let females = 0;
  let genSum = 0;
  let genMax = 0;
  const surnames = new Set<string>();
  for (const a of w.actors) {
    if (a.sex === 'F') females++;
    genSum += a.generation;
    if (a.generation > genMax) genMax = a.generation;
    surnames.add(a.surname);
  }
  const tribeShare = w.tribes.map(() => 0);
  let puritySum = 0;
  for (const a of w.actors) {
    let max = 0;
    for (let i = 0; i < tribeShare.length; i++) {
      tribeShare[i] += a.ancestry[i] ?? 0;
      if (a.ancestry[i] > max) max = a.ancestry[i];
    }
    puritySum += max;
  }
  let food = 0;
  for (let i = 0; i < w.food.length; i++) food += w.food[i];
  return {
    tick: w.tick,
    females,
    males: n - females,
    geneMean: mean,
    geneSd: sd,
    dominanceMean,
    generationMean: n ? genSum / n : 0,
    generationMax: genMax,
    births: ev.births.length,
    deathsStarvation: ev.deaths.filter((d) => d.cause === 'starvation').length,
    deathsAge: ev.deaths.filter((d) => d.cause === 'age').length,
    deathsKilled: ev.deaths.filter((d) => d.cause === 'killed').length,
    deathsChildbirth: ev.deaths.filter((d) => d.cause === 'childbirth').length,
    deathsInfant: ev.deaths.filter((d) => d.cause === 'infant').length,
    deathsDisease: ev.deaths.filter((d) => d.cause === 'disease').length,
    deathsCatastrophe: ev.deaths.filter((d) => d.cause === 'catastrophe').length,
    deathsThirst: ev.deaths.filter((d) => d.cause === 'thirst').length,
    infected: w.actors.filter((a) => a.infection).length,
    hits: ev.hits,
    pregnancyLosses: ev.pregnancyLosses,
    pregnant: w.actors.filter((a) => a.pregnancy).length,
    tribeShare: tribeShare.map((s) => (n ? s / n : 0)),
    purityMean: n ? puritySum / n : 0,
    deathAgeSum: ev.deaths.reduce((sum, d) => (d.cause === 'removed' ? sum : sum + d.age), 0),
    surnames: surnames.size,
    food,
  };
};
