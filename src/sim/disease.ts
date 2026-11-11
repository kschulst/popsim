import { clamp, gaussian, pick, rand } from './random';
import type { Actor, Disease, World } from './types';

/**
 * Diseases: named strains that break out spontaneously, spread to neighbours, weaken and sometimes
 * kill, and leave temporary immunity. A transmission can mutate the strain into a named variant.
 */

/** Compounded with the noun: "Myrfeber", "Skjelvesyke". */
const PREFIXES = ['Myr', 'Fjell', 'Skjelve', 'Vinter', 'Mage', 'Dal', 'Sump', 'Tåke', 'Brenne', 'Natt', 'Skog', 'Is', 'Stein', 'Svette', 'Kverke'];
/** Separate adjective: "Grå pest", "Røde hoste". */
const ADJECTIVES = ['Grå', 'Svarte', 'Røde', 'Hvite', 'Gule', 'Kalde', 'Stille'];
const NOUNS = ['feber', 'pest', 'hoste', 'syke', 'farsott', 'utslett', 'kramme', 'sott', 'flekk', 'verk', 'blemme'];
const COLORS = ['#c6e85a', '#e8a35a', '#b45ae8', '#5ae8d1', '#e85a8f', '#e8e05a', '#5a8fe8', '#9be85a'];

const makeName = (taken: Set<string>): string => {
  for (let i = 0; i < 50; i++) {
    const n = pick(NOUNS);
    const name = Math.random() < 0.3 ? `${pick(ADJECTIVES)} ${n}` : `${pick(PREFIXES)}${n}`;
    if (!taken.has(name)) return name;
  }
  return `Sykdom ${taken.size + 1}`;
};

const LETTERS = 'BCDEFGHJKLMNPQRSTUVWXYZ';

/** A new strain with random properties within plausible ranges. */
export const newDisease = (w: World, origin: string): Disease => {
  const taken = new Set(w.diseases.map((d) => d.name));
  const d: Disease = {
    id: w.diseases.length,
    name: makeName(taken),
    color: COLORS[w.diseases.length % COLORS.length],
    contagion: rand(0.03, 0.15),
    lethality: rand(0.0005, 0.005),
    duration: Math.round(rand(60, 300)),
    immunity: Math.round(rand(200, 2000)),
    tick: w.tick,
    parent: null,
    origin,
    cases: 0,
    deaths: 0,
    variants: 0,
  };
  w.diseases.push(d);
  return d;
};

/** A mutated variant of `parent`: properties shifted by ~20 %, named after the parent. */
/** The original strain a variant descends from. */
const rootOf = (w: World, d: Disease): Disease => {
  let r = d;
  while (r.parent !== null && w.diseases[r.parent]) r = w.diseases[r.parent];
  return r;
};

const variantOf = (w: World, parent: Disease): Disease => {
  const shift = (v: number, lo: number, hi: number) => clamp(v * Math.exp(gaussian() * 0.2), lo, hi);
  // Variants are lettered per family (B, C, …) so names stay unique however deep the lineage.
  const root = rootOf(w, parent);
  root.variants++;
  const k = root.variants - 1;
  const d: Disease = {
    id: w.diseases.length,
    name: `${root.name} ${LETTERS[k % LETTERS.length]}${k >= LETTERS.length ? Math.floor(k / LETTERS.length) + 1 : ''}`,
    color: COLORS[w.diseases.length % COLORS.length],
    contagion: shift(parent.contagion, 0.001, 0.3),
    lethality: shift(parent.lethality, 0.00005, 0.05),
    duration: Math.round(shift(parent.duration, 10, 2000)),
    immunity: Math.round(shift(parent.immunity, 0, 10000)),
    tick: w.tick,
    parent: parent.id,
    origin: `variant av ${parent.name}`,
    cases: 0,
    deaths: 0,
    variants: 0,
  };
  w.diseases.push(d);
  return d;
};

export const isImmune = (a: Actor, d: Disease, tick: number): boolean => (a.immunity[d.id] ?? -1) > tick;

export const infect = (a: Actor, d: Disease): void => {
  a.infection = { disease: d.id, left: d.duration };
  d.cases++;
};

/** Spontaneous outbreak: a random actor gets a brand-new disease. */
export const maybeOutbreak = (w: World): Disease | null => {
  if (!w.actors.length || Math.random() >= w.rules.outbreakRate) return null;
  const d = newDisease(w, `brøt ut tick ${w.tick}`);
  infect(pick(w.actors), d);
  return d;
};

/**
 * One tick of illness for an infected actor: infect neighbours (`near`), count down, recover with
 * immunity. Returns the disease if the actor is still ill (for the caller's death roll).
 */
export const progressInfection = (a: Actor, near: Iterable<Actor>, w: World, isDead: (id: number) => boolean): Disease | null => {
  const inf = a.infection;
  if (!inf) return null;
  const d = w.diseases[inf.disease];
  if (!d) {
    a.infection = null;
    return null;
  }
  const r2 = w.rules.contagionRadius ** 2;
  for (const b of near) {
    if (b === a || b.infection || isDead(b.id)) continue;
    if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > r2) continue;
    if (isImmune(b, d, w.tick) || Math.random() >= d.contagion) continue;
    infect(b, Math.random() < w.rules.diseaseMutation ? variantOf(w, d) : d);
  }
  if (--inf.left <= 0) {
    a.infection = null;
    a.immunity[d.id] = w.tick + d.immunity;
    // Variants of the same family share some protection: half as long against the family root.
    const root = rootOf(w, d).id;
    if (root !== d.id) a.immunity[root] = Math.max(a.immunity[root] ?? 0, w.tick + d.immunity / 2);
    return null;
  }
  return d;
};
