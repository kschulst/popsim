import { kinPenalty, kinship } from './genealogy';
import { acceptance, tribeBonusOf } from './step';
import { overlap, purity } from './tribes';
import type { Actor, World } from './types';

type ParentsOf = (id: number) => [number, number] | null | undefined;

/** Opposite-sex actors sampled when estimating attractiveness. */
const SAMPLE = 40;

/**
 * How attractive `a` is to the population: the mean probability that an opposite-sex adult would
 * accept a (partner score with a's tribe bonus, through the choosiness curve), ignoring distance.
 * Close kin count as potential partners who say no. Uses a deterministic sample of up to 40.
 * Returns NaN when there is nobody to ask.
 */
export const attractiveness = (a: Actor, w: World, parentsOf: ParentsOf): number => {
  const r = w.rules;
  const pool = w.actors.filter((b) => b.sex !== a.sex && b.age >= r.mateCooldown);
  if (!pool.length) return NaN;
  const step = Math.max(1, Math.floor(pool.length / SAMPLE));
  const bonusA = tribeBonusOf(a, r.tribeBonus ?? []);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pool.length && n < SAMPLE; i += step, n++) {
    const b = pool[i];
    const tribe = r.tribePreference * overlap(a.ancestry, b.ancestry) * (purity(a.ancestry) * purity(b.ancestry)) ** r.purityWeight;
    const score = 1 + tribe - kinPenalty(kinship(b.id, a.id, parentsOf, 2), r) + bonusA;
    sum += acceptance(score, r);
  }
  return sum / n;
};
