import { clamp, gaussian, rand } from './random';
import { GENE_KEYS, type GeneKey, type Genome } from './types';

export const GENE_RANGES: Record<GeneKey, [number, number]> = {
  size: [0.5, 3],
  maxSpeed: [0.3, 3],
  vision: [10, 120],
  reproThreshold: [0.4, 0.95],
  mutationRate: [0.01, 0.3],
};

export const GENE_LABELS: Record<GeneKey, string> = {
  size: 'Størrelse',
  maxSpeed: 'Maks fart',
  vision: 'Syn',
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

/** Uniform crossover: each gene is taken from a randomly chosen parent. */
export const crossover = (a: Genome, b: Genome): Genome => {
  const g = {} as Genome;
  for (const k of GENE_KEYS) g[k] = Math.random() < 0.5 ? a[k] : b[k];
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
