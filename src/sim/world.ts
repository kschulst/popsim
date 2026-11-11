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

/** True if the cell at (x, y) is water. */
export const isWater = (w: { fertility: Float32Array; cols: number; rows: number; cellSize: number }, x: number, y: number): boolean => {
  const c = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.cellSize)));
  const r = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.cellSize)));
  return w.fertility[r * w.cols + c] < 0;
};

/**
 * Carves lakes (noisy discs) and rivers (wandering lines from one edge until they leave the map
 * or reach water) into the fertility map as negative values, then makes the banks more fertile.
 */
const carveWater = (fert: Float32Array, cols: number, rows: number, lakes: number, rivers: number, bonus: number): void => {
  const set = (c: number, r: number) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) fert[r * cols + c] = -1;
  };
  for (let i = 0; i < lakes; i++) {
    const cx = rand(0.15, 0.85) * cols;
    const cy = rand(0.15, 0.85) * rows;
    const rad = rand(2, 4.5);
    for (let r = Math.floor(cy - rad - 2); r <= cy + rad + 2; r++) {
      for (let c = Math.floor(cx - rad - 2); c <= cx + rad + 2; c++) {
        const a = Math.atan2(r - cy, c - cx);
        const edge = rad * (1 + 0.25 * Math.sin(3 * a + i) + 0.15 * Math.cos(5 * a));
        if (Math.hypot(c - cx, r - cy) <= edge) set(c, r);
      }
    }
  }
  for (let i = 0; i < rivers; i++) {
    const side = Math.floor(rand(0, 4));
    let x = side === 0 ? 0 : side === 1 ? cols - 1 : rand(0.1, 0.9) * cols;
    let y = side === 2 ? 0 : side === 3 ? rows - 1 : rand(0.1, 0.9) * rows;
    let dir = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
    for (let step = 0; step < (cols + rows) * 2; step++) {
      set(Math.floor(x), Math.floor(y));
      if (step % 3 === 0) set(Math.floor(x + 1), Math.floor(y));
      dir += gaussian() * 0.25;
      x += Math.cos(dir) * 0.7;
      y += Math.sin(dir) * 0.7;
      if (x < 0 || x >= cols || y < 0 || y >= rows) break;
    }
  }
  // Banks: land next to water grows more.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (fert[i] < 0) continue;
      let wet = false;
      for (let dr = -1; dr <= 1 && !wet; dr++)
        for (let dc = -1; dc <= 1 && !wet; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && fert[rr * cols + cc] < 0) wet = true;
        }
      if (wet) fert[i] = Math.min(1.5, fert[i] + bonus);
    }
  }
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
    hydration: 1,
    lonely: 0,
    spouse: null,
    widowOf: null,
    marriedAt: 0,
    lastConception: 0,
    affairs: 0,
    courtships: 0,
    acceptedBy: 0,
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
  carveWater(fertility, cols, rows, rules.waterLakes ?? 0, rules.waterRivers ?? 0, rules.riverbankBonus ?? 0);
  // Caves on land, away from the edges.
  const shelters: { x: number; y: number; r: number }[] = [];
  for (let i = 0, tries = 0; i < (rules.shelterCount ?? 0) && tries < 200; tries++) {
    const x = rand(0.08, 0.92) * width;
    const y = rand(0.08, 0.92) * height;
    if (isWater({ fertility, cols, rows, cellSize: width / cols }, x, y)) continue;
    shelters.push({ x, y, r: rules.shelterRadius ?? 22 });
    i++;
  }
  const food = new Uint8Array(cols * rows);
  for (let i = 0; i < food.length; i++) food[i] = fertility[i] > 0 && Math.random() < fertility[i] * 0.6 ? 1 : 0;
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
    carcasses: [],
    shelters,
    machines: [],
  };
};

/**
 * Adds each tribe's seeds around its home: `homes[i]` if given (placed by the user), otherwise an
 * automatic home on an ellipse around the centre.
 */
export const populateWorld = (world: World, homes: ({ x: number; y: number } | undefined)[] = []): World => {
  world.tribes.forEach((t, ti) =>
    seedTribe(world, ti, t.seeds, homes[ti] ?? nearBank(world, tribeHome(ti, world.tribes.length, world.width, world.height))),
  );
  return world;
};

/**
 * Moves an automatic home to the nearest land cell next to water within 200 units, so tribes start
 * where they can drink. Unchanged when the map has no water nearby.
 */
const nearBank = (w: World, p: { x: number; y: number }): { x: number; y: number } => {
  const { cols, rows, cellSize, fertility } = w;
  let best: { x: number; y: number } | null = null;
  let bestD = 200 * 200;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (fertility[r * cols + c] < 0) continue;
      let wet = false;
      for (let dr = -1; dr <= 1 && !wet; dr++)
        for (let dc = -1; dc <= 1 && !wet; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && fertility[rr * cols + cc] < 0) wet = true;
        }
      if (!wet) continue;
      const x = (c + 0.5) * cellSize;
      const y = (r + 0.5) * cellSize;
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best ?? p;
};

/**
 * Adds `count` seeds of tribe `tribe`, each with its own new surname (hue near the tribe's).
 * With `home` they are scattered around it (sd HOME_SPREAD); without, placed at random.
 */
export const seedTribe = (world: World, tribe: number, count: number, home?: { x: number; y: number }): Actor[] => {
  const surnames = uniqueSurnames(count, Object.keys(world.surnameHues));
  assignHues(world, surnames, tribe);
  // A position on land: scattered around home (or anywhere), retrying if it lands in water.
  const landPoint = () => {
    for (let tries = 0; tries < 50; tries++) {
      const x = home ? clamp(home.x + gaussian() * HOME_SPREAD * (1 + tries / 10), 5, world.width - 5) : rand(5, world.width - 5);
      const y = home ? clamp(home.y + gaussian() * HOME_SPREAD * (1 + tries / 10), 5, world.height - 5) : rand(5, world.height - 5);
      if (!isWater(world, x, y)) return { x, y };
    }
    return { x: rand(5, world.width - 5), y: rand(5, world.height - 5) };
  };
  return surnames.map((surname) => spawnSeed(world, { surname, tribe, ...landPoint() }));
};

export const createWorld = (config: WorldConfig = DEFAULT_CONFIG): World => populateWorld(createEmptyWorld(config));

export const cloneWorld = (w: World): World => structuredClone(w);
