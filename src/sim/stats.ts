import { GENE_KEYS, type Genome, type TickEvents, type TickStats, type World } from './types';

export const computeStats = (w: World, ev: TickEvents): TickStats => {
  const n = w.actors.length;
  const mean = {} as Genome;
  const sd = {} as Genome;
  for (const k of GENE_KEYS) {
    let s = 0;
    for (const a of w.actors) s += a.genome[k];
    const m = n ? s / n : 0;
    let v = 0;
    for (const a of w.actors) v += (a.genome[k] - m) ** 2;
    mean[k] = m;
    sd[k] = n ? Math.sqrt(v / n) : 0;
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
  let food = 0;
  for (let i = 0; i < w.food.length; i++) food += w.food[i];
  return {
    tick: w.tick,
    females,
    males: n - females,
    geneMean: mean,
    geneSd: sd,
    generationMean: n ? genSum / n : 0,
    generationMax: genMax,
    births: ev.births.length,
    deathsStarvation: ev.deaths.filter((d) => d.cause === 'starvation').length,
    deathsAge: ev.deaths.filter((d) => d.cause === 'age').length,
    surnames: surnames.size,
    food,
  };
};
