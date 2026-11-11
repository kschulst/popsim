import { clamp, gaussian, rand } from './random';
import { GENE_KEYS, type Dominance, type GeneKey, type Genome } from './types';

export const GENE_RANGES: Record<GeneKey, [number, number]> = {
  size: [0.5, 3],
  maxSpeed: [0.3, 3],
  vision: [10, 120],
  aggression: [0, 1],
  longevity: [0.5, 2],
  diet: [0, 1],
  fidelity: [0, 1],
  reproThreshold: [0.4, 0.95],
  mutationRate: [0.01, 0.3],
};

export const GENE_LABELS: Record<GeneKey, string> = {
  size: 'Størrelse',
  maxSpeed: 'Maks fart',
  vision: 'Syn',
  aggression: 'Aggresjon',
  longevity: 'Levealder',
  diet: 'Kosthold (bær)',
  fidelity: 'Troskap',
  reproThreshold: 'Paringsterskel',
  mutationRate: 'Mutasjonsrate',
};

export const clampGene = (key: GeneKey, value: number): number => {
  const [min, max] = GENE_RANGES[key];
  return clamp(value, min, max);
};

export const randomGenome = (): Genome => {
  const g = {} as Genome;
  for (const k of GENE_KEYS) {
    const [min, max] = GENE_RANGES[k];
    // Start seeds in the middle half of each range so evolution has room both ways.
    g[k] = rand(min + (max - min) * 0.25, max - (max - min) * 0.25);
  }
  return g;
};

/** Seed genome around a tribe's values: each gene ±10 % (uniform), clamped to its range. */
export const tribeGenome = (base: Genome): Genome => {
  const g = {} as Genome;
  for (const k of GENE_KEYS) g[k] = clampGene(k, base[k] * rand(0.9, 1.1));
  return g;
};

/** Gaussian mutation; sd = mutationRate × gene range × scale. mutationRate mutates itself first. */
export const mutate = (g: Genome, scale: number): Genome => {
  const out = { ...g };
  const step = (k: GeneKey, rate: number) => {
    const [min, max] = GENE_RANGES[k];
    out[k] = clampGene(k, out[k] + gaussian() * rate * (max - min) * scale);
  };
  step('mutationRate', g.mutationRate);
  for (const k of GENE_KEYS) if (k !== 'mutationRate') step(k, out.mutationRate);
  return out;
};

export const DOMINANCE_RANGE: [number, number] = [0.05, 1];

const clampDominance = (v: number) => clamp(v, DOMINANCE_RANGE[0], DOMINANCE_RANGE[1]);

/**
 * Inheritance strength for a new seed. `base` is the tribe's heritability (random 0.15–0.85 if not
 * given); genes vary a little around that level.
 */
export const randomDominance = (base = rand(0.15, 0.85)): Dominance => {
  const d = {} as Dominance;
  for (const k of GENE_KEYS) d[k] = clampDominance(base + gaussian() * 0.1);
  return d;
};

export interface Heritable {
  genome: Genome;
  dominance: Dominance;
}

/**
 * Child genome as a weighted blend of the parents. For each gene the mother's weight is her share
 * of the parents' combined inheritance strength, plus Gaussian noise (sd = `noise`), clamped to
 * 0–1. The child's inheritance strength for each gene is taken from one parent at random (blending
 * it would bias it upward over generations). Both are then mutated.
 */
export const inherit = (mother: Heritable, father: Heritable, noise: number, mutationScale: number): Heritable => {
  const blended = {} as Genome;
  const dominance = {} as Dominance;
  for (const k of GENE_KEYS) {
    const dm = mother.dominance[k];
    const df = father.dominance[k];
    const w = clamp(dm / (dm + df) + gaussian() * noise, 0, 1);
    blended[k] = w * mother.genome[k] + (1 - w) * father.genome[k];
    dominance[k] = Math.random() < 0.5 ? dm : df;
  }
  const genome = mutate(blended, mutationScale);
  const [min, max] = DOMINANCE_RANGE;
  for (const k of GENE_KEYS) {
    dominance[k] = clampDominance(dominance[k] + gaussian() * genome.mutationRate * (max - min) * mutationScale);
  }
  return { genome, dominance };
};

/** 1 for identical genomes, 0 for maximally different (normalised Euclidean distance). */
export const similarity = (a: Genome, b: Genome): number => {
  let sum = 0;
  for (const k of GENE_KEYS) {
    const [min, max] = GENE_RANGES[k];
    const d = (a[k] - b[k]) / (max - min);
    sum += d * d;
  }
  return 1 - Math.sqrt(sum / GENE_KEYS.length);
};

/** Gene value mapped to 0–1 within its range. */
export const normGene = (k: GeneKey, v: number): number => {
  const [min, max] = GENE_RANGES[k];
  return (v - min) / (max - min);
};
