import { randomDominance, tribeGenome } from './genome';
import { givenName, uniqueSurnames } from './names';
import { clamp, gaussian, rand } from './random';
import { DEFAULT_RULES } from './rules';
import { DEFAULT_TRIBES, hexHue, pureAncestry } from './tribes';
import type { Actor, Dominance, Genome, Rules, Sex, Tribe, World } from './types';

export interface WorldConfig {
  width: number;
  height: number;
  cols: number;
  rows: number;
  tribes: Tribe[];
  rules: Rules;
}

export const DEFAULT_CONFIG: WorldConfig = {
  width: 800,
  height: 600,
  cols: 64,
  rows: 48,
  tribes: DEFAULT_TRIBES,
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

export const maxHpOf = (a: { genome: Genome }, rules: Rules): number => rules.hpPerSize * a.genome.size;

/** Multiplier (0–1) on speed, vision and strength from remaining health: √(hp / max hp). */
export const hpFactor = (a: Actor, rules: Rules): number => Math.sqrt(Math.max(0, a.hp) / maxHpOf(a, rules));

export interface NewActor {
  given?: string;
  surname: string;
  /** Index into world.tribes. */
  tribe: number;
  sex?: Sex;
  genome?: Genome;
  dominance?: Dominance;
  x?: number;
  y?: number;
  energyFraction?: number;
}

export const spawnSeed = (world: World, opts: NewActor): Actor => {
  const tribe = world.tribes[opts.tribe];
  const genome = opts.genome ?? tribeGenome(tribe.genome);
  const sex = opts.sex ?? (Math.random() < 0.5 ? 'F' : 'M');
  const a: Actor = {
    id: world.nextId++,
    given: opts.given ?? givenName(sex),
    surname: opts.surname,
    sex,
    generation: 0,
    parents: null,
    genome,
    dominance: opts.dominance ?? randomDominance(tribe.heritability),
    ancestry: pureAncestry(opts.tribe, world.tribes.length),
    x: opts.x ?? rand(0, world.width),
    y: opts.y ?? rand(0, world.height),
    vx: 0,
    vy: 0,
    wander: rand(0, Math.PI * 2),
    energy: 0,
    age: 0,
    cooldown: 0,
    born: world.tick,
    hp: 0,
    target: null,
    targetReason: null,
    fleeing: 0,
    fleeFrom: null,
    attackCd: 0,
    mateTarget: null,
    snub: null,
    snubTtl: 0,
    court: null,
    pregnancy: null,
    caresFor: null,
    infection: null,
    immunity: {},
    lastHitBy: null,
    flash: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    hitsTaken: 0,
    foodEaten: 0,
    distance: 0,
  };
  a.hp = maxHpOf(a, world.rules);
  a.energy = capacityOf(a, world.rules) * (opts.energyFraction ?? 0.8);
  world.actors.push(a);
  return a;
};

/**
 * Gives new surnames hues within ±30° of their tribe's hue, so clans of one tribe have related
 * colours. Spreads them evenly across that band, offset by how many the tribe already has.
 */
export const assignHues = (world: World, surnames: string[], tribe: number): void => {
  const base = hexHue(world.tribes[tribe].color);
  const existing = Object.keys(world.surnameHues).length;
  surnames.forEach((s, i) => {
    const t = surnames.length > 1 ? i / (surnames.length - 1) : 0.5;
    const jitter = ((existing * 7) % 5) - 2;
    world.surnameHues[s] = (base - 30 + 60 * t + jitter + 360) % 360;
  });
};

/** Standard deviation (world units) of seed positions around their tribe's home. */
const HOME_SPREAD = 40;

/**
 * Home area of tribe `i` of `n`: evenly spaced on an ellipse around the centre (random rotation),
 * so tribes start apart and meet at the borders between their areas.
 */
const tribeHome = (() => {
  let rotation = 0;
  return (i: number, n: number, width: number, height: number) => {
    if (i === 0) rotation = rand(0, Math.PI * 2);
    if (n === 1) return { x: width / 2, y: height / 2 };
    const a = rotation + (2 * Math.PI * i) / n;
    return { x: width / 2 + Math.cos(a) * width * 0.3, y: height / 2 + Math.sin(a) * height * 0.3 };
  };
})();

/** A world with terrain and food but no actors (used while the user places tribes). */
export const createEmptyWorld = (config: WorldConfig = DEFAULT_CONFIG): World => {
  const { width, height, cols, rows, rules, tribes } = config;
  const fertility = fertilityMap(cols, rows);
  const food = new Uint8Array(cols * rows);
  for (let i = 0; i < food.length; i++) food[i] = Math.random() < fertility[i] * 0.6 ? 1 : 0;
  return {
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
    tribes: structuredClone(tribes),
    diseases: [],
    events: [],
  };
};

/**
 * Adds each tribe's seeds around its home: `homes[i]` if given (placed by the user), otherwise an
 * automatic home on an ellipse around the centre.
 */
export const populateWorld = (world: World, homes: ({ x: number; y: number } | undefined)[] = []): World => {
  const { width, height, tribes } = world;
  const taken: string[] = [];
  tribes.forEach((t, ti) => {
    const surnames = uniqueSurnames(t.seeds, taken);
    taken.push(...surnames);
    assignHues(world, surnames, ti);
    const home = homes[ti] ?? tribeHome(ti, tribes.length, width, height);
    for (const surname of surnames) {
      spawnSeed(world, {
        surname,
        tribe: ti,
        x: clamp(home.x + gaussian() * HOME_SPREAD, 5, width - 5),
        y: clamp(home.y + gaussian() * HOME_SPREAD, 5, height - 5),
      });
    }
  });
  return world;
};

export const createWorld = (config: WorldConfig = DEFAULT_CONFIG): World => populateWorld(createEmptyWorld(config));

export const cloneWorld = (w: World): World => structuredClone(w);
