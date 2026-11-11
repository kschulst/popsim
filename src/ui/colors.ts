import { interpolateViridis } from 'd3';
import { normGene } from '../sim/genome';
import { hexHue, mainTribe } from '../sim/tribes';
import type { Actor, Tribe, World } from '../sim/types';

export type ColorMode = 'tribe' | 'lineage' | 'generation' | 'genome' | 'aggression';

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  tribe: 'Stamme (største andel, metning = renhet)',
  lineage: 'Klan (etternavn)',
  generation: 'Generasjon',
  genome: 'Genom (fart → fargetone, syn → metning)',
  aggression: 'Aggresjon',
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

const rgbCache = new WeakMap<Tribe[], [number, number, number][]>();
const tribeRgb = (tribes: Tribe[]): [number, number, number][] => {
  let c = rgbCache.get(tribes);
  if (!c) {
    c = tribes.map((t) => {
      const n = parseInt(t.color.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    rgbCache.set(tribes, c);
  }
  return c;
};

/** Tribe colours mixed by ancestry share. */
export const ancestryColor = (anc: number[], tribes: Tribe[]): string => {
  const rgb = tribeRgb(tribes);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < rgb.length; i++) {
    const s = anc[i] ?? 0;
    r += rgb[i][0] * s;
    g += rgb[i][1] * s;
    b += rgb[i][2] * s;
  }
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
};

export const actorColor = (a: Actor, w: World, mode: ColorMode, maxGen: number): string => {
  switch (mode) {
    case 'tribe': {
      const i = mainTribe(a.ancestry);
      const p = a.ancestry[i] ?? 0;
      return `hsl(${hexHue(w.tribes[i].color)}, ${15 + 80 * p}%, ${50 + 12 * p}%)`;
    }
    case 'lineage':
      // Small per-individual lightness offset so members of one clan are distinguishable.
      return surnameColor(w, a.surname, 52 + ((a.id * 37) % 13));
    case 'generation':
      return interpolateViridis(maxGen > 0 ? 0.15 + (0.85 * a.generation) / maxGen : 0.5);
    case 'genome':
      return `hsl(${normGene('maxSpeed', a.genome.maxSpeed) * 300}, ${25 + normGene('vision', a.genome.vision) * 70}%, 58%)`;
    case 'aggression':
      return `hsl(${(1 - a.genome.aggression) * 220}, 75%, 58%)`;
  }
};
