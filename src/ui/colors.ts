import { interpolateViridis } from 'd3';
import { normGene } from '../sim/genome';
import type { Actor, World } from '../sim/types';

export type ColorMode = 'lineage' | 'generation' | 'genome';

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  lineage: 'Avstamning (etternavn)',
  generation: 'Generasjon',
  genome: 'Genom (fart → fargetone, syn → metning)',
};

const hueOf = (w: World, surname: string): number => {
  const h = w.surnameHues[surname];
  if (h !== undefined) return h;
  let x = 0;
  for (const ch of surname) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return x;
};

export const surnameColor = (w: World, surname: string, lightness = 58): string =>
  `hsl(${hueOf(w, surname)}, 70%, ${lightness}%)`;

export const actorColor = (a: Actor, w: World, mode: ColorMode, maxGen: number): string => {
  switch (mode) {
    case 'lineage':
      // Small per-individual lightness offset so members of one clan are distinguishable.
      return surnameColor(w, a.surname, 52 + ((a.id * 37) % 13));
    case 'generation':
      return interpolateViridis(maxGen > 0 ? 0.15 + (0.85 * a.generation) / maxGen : 0.5);
    case 'genome':
      return `hsl(${normGene('maxSpeed', a.genome.maxSpeed) * 300}, ${25 + normGene('vision', a.genome.vision) * 70}%, 58%)`;
  }
};
