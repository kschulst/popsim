import { randomDominance, randomGenome } from './genome';
import { givenName, uniqueSurnames } from './names';
import { rand } from './random';
import { DEFAULT_RULES } from './rules';
import type { Actor, Dominance, Genome, Rules, Sex, World } from './types';

export interface WorldConfig {
  width: number;
  height: number;
  cols: number;
  rows: number;
  seeds: number;
  rules: Rules;
}

export const DEFAULT_CONFIG: WorldConfig = {
  width: 800,
  height: 600,
  cols: 64,
  rows: 48,
  seeds: 20,
  rules: DEFAULT_RULES,
};

/** Smooth random fertility map in 0.2–1 from a sum of a few random sinusoids. */
const fertilityMap = (cols: number, rows: number): Float32Array => {
  const waves = Array.from({ length: 5 }, () => ({
    fx: rand(0.5, 3) / cols,
    fy: rand(0.5, 3) / rows,
    phase: rand(0, Math.PI * 2),
    amp: rand(0.5, 1),
  }));
  const out = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(2 * Math.PI * (w.fx * c + w.fy * r) + w.phase);
      out[r * cols + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = 0.2 + (0.8 * (out[i] - min)) / (max - min || 1);
  return out;
};

export const capacityOf = (a: { genome: Genome }, rules: Rules): number =>
  rules.energyPerSize * a.genome.size;

export const radiusOf = (a: { genome: Genome }): number => 1.5 + a.genome.size * 2;

export interface NewActor {
  given?: string;
  surname: string;
  sex?: Sex;
  genome?: Genome;
  dominance?: Dominance;
  x?: number;
  y?: number;
  energyFraction?: number;
}

export const spawnSeed = (world: World, opts: NewActor): Actor => {
  const genome = opts.genome ?? randomGenome();
  const sex = opts.sex ?? (Math.random() < 0.5 ? 'F' : 'M');
  const a: Actor = {
    id: world.nextId++,
    given: opts.given ?? givenName(sex),
    surname: opts.surname,
    sex,
    generation: 0,
    parents: null,
    genome,
    dominance: opts.dominance ?? randomDominance(),
    x: opts.x ?? rand(0, world.width),
    y: opts.y ?? rand(0, world.height),
    vx: 0,
    vy: 0,
    wander: rand(0, Math.PI * 2),
    energy: 0,
    age: 0,
    cooldown: 0,
    born: world.tick,
  };
  a.energy = capacityOf(a, world.rules) * (opts.energyFraction ?? 0.8);
  world.actors.push(a);
  return a;
};

/** Spreads hues evenly around the colour wheel, offset to avoid clashing with existing ones. */
export const assignHues = (world: World, surnames: string[]): void => {
  const offset = Object.keys(world.surnameHues).length * 137.5;
  surnames.forEach((s, i) => {
    world.surnameHues[s] = (offset + (360 * i) / surnames.length) % 360;
  });
};

export const createWorld = (config: WorldConfig = DEFAULT_CONFIG): World => {
  const { width, height, cols, rows, rules } = config;
  const fertility = fertilityMap(cols, rows);
  const food = new Uint8Array(cols * rows);
  for (let i = 0; i < food.length; i++) food[i] = Math.random() < fertility[i] * 0.6 ? 1 : 0;
  const world: World = {
    tick: 0,
    width,
    height,
    cols,
    rows,
    cellSize: width / cols,
    food,
    fertility,
    actors: [],
    nextId: 1,
    rules: structuredClone(rules),
    surnameHues: {},
  };
  const surnames = uniqueSurnames(config.seeds);
  assignHues(world, surnames);
  for (const surname of surnames) spawnSeed(world, { surname });
  return world;
};

export const cloneWorld = (w: World): World => structuredClone(w);
