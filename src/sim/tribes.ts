import type { Tribe } from './types';

/** Starting tribes for a new run (editable in the "Ny kjøring" dialog). */
export const DEFAULT_TRIBES: Tribe[] = [
  {
    name: 'Røde',
    color: '#e0574f',
    genome: { size: 2.2, maxSpeed: 1.2, vision: 60, aggression: 0.7, longevity: 1, diet: 0.5, reproThreshold: 0.65, mutationRate: 0.1 },
    heritability: 0.7,
    seeds: 5,
  },
  {
    name: 'Blå',
    color: '#4f8fe8',
    genome: { size: 1.0, maxSpeed: 2.4, vision: 60, aggression: 0.3, longevity: 1, diet: 0.5, reproThreshold: 0.65, mutationRate: 0.1 },
    heritability: 0.5,
    seeds: 5,
  },
  {
    name: 'Gule',
    color: '#e8c547',
    genome: { size: 1.4, maxSpeed: 1.6, vision: 100, aggression: 0.4, longevity: 1, diet: 0.5, reproThreshold: 0.65, mutationRate: 0.1 },
    heritability: 0.3,
    seeds: 5,
  },
  {
    name: 'Grønne',
    color: '#8fe07a',
    genome: { size: 1.5, maxSpeed: 1.7, vision: 70, aggression: 0.2, longevity: 1, diet: 0.5, reproThreshold: 0.65, mutationRate: 0.1 },
    heritability: 0.5,
    seeds: 5,
  },
];

/** Hue (0–360) of a #rrggbb colour. */
export const hexHue = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

/** One-hot ancestry for a seed of tribe `index`. */
export const pureAncestry = (index: number, tribes: number): number[] =>
  Array.from({ length: tribes }, (_, i) => (i === index ? 1 : 0));

/**
 * Child's ancestry. The genome is treated as `segments` equal pieces, each inherited from the
 * mother or the father at random, so the mother's share is Binomial(segments, ½) / segments.
 * Siblings therefore differ, and admixed populations keep variation for selection to act on.
 * `segments` ≤ 0 gives the exact mean of the parents.
 */
export const mixAncestry = (a: number[], b: number[], segments = 0): number[] => {
  let w = 0.5;
  if (segments > 0) {
    let k = 0;
    for (let i = 0; i < segments; i++) if (Math.random() < 0.5) k++;
    w = k / segments;
  }
  return a.map((v, i) => w * v + (1 - w) * (b[i] ?? 0));
};

/** Largest single-tribe share, 0–1. */
export const purity = (anc: number[]): number => Math.max(0, ...anc);

/** Shared ancestry, Σ min(aᵢ, bᵢ), 0–1. */
export const overlap = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i] ?? 0);
  return s;
};

/** Index of the tribe with the largest share. */
export const mainTribe = (anc: number[]): number => {
  let best = 0;
  for (let i = 1; i < anc.length; i++) if (anc[i] > anc[best]) best = i;
  return best;
};
