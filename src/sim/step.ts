import { ancestors, kinship, tooClose } from './genealogy';
import { inherit } from './genome';
import { givenName } from './names';
import { clamp, gaussian, rand, shuffle } from './random';
import { SpatialHash } from './spatial';
import type { Actor, DeathCause, TickEvents, World } from './types';
import { capacityOf, radiusOf } from './world';

export type ParentsOf = (id: number) => [number, number] | null | undefined;

/**
 * Empty cells get food with probability fertility × (spontaneous + spread × food neighbours).
 * Neighbour counts use the state at the start of the tick.
 */
const regrowFood = (w: World): void => {
  const { foodSpreadRate, foodSpontaneous } = w.rules;
  const { cols, rows, fertility } = w;
  const prev = w.food.slice();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (prev[i]) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if ((dr || dc) && cc >= 0 && cc < cols) n += prev[rr * cols + cc];
        }
      }
      if (Math.random() < fertility[i] * (foodSpontaneous + foodSpreadRate * n)) w.food[i] = 1;
    }
  }
};

const cellIndex = (w: World, x: number, y: number): number => {
  const c = clamp(Math.floor(x / w.cellSize), 0, w.cols - 1);
  const r = clamp(Math.floor(y / w.cellSize), 0, w.rows - 1);
  return r * w.cols + c;
};

const readyToMate = (a: Actor, w: World): boolean =>
  a.cooldown <= 0 && a.energy >= a.genome.reproThreshold * capacityOf(a, w.rules);

/** Nearest food cell within vision, or null if none is visible. */
const seekFood = (a: Actor, w: World): { x: number; y: number } | null => {
  const { cellSize, cols, rows, food } = w;
  const r = Math.ceil(a.genome.vision / cellSize);
  const acx = Math.floor(a.x / cellSize);
  const acy = Math.floor(a.y / cellSize);
  const v2 = a.genome.vision * a.genome.vision;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let found = false;
  for (let cy = Math.max(0, acy - r); cy <= Math.min(rows - 1, acy + r); cy++) {
    for (let cx = Math.max(0, acx - r); cx <= Math.min(cols - 1, acx + r); cx++) {
      const tx = (cx + 0.5) * cellSize;
      const ty = (cy + 0.5) * cellSize;
      const d2 = (tx - a.x) ** 2 + (ty - a.y) ** 2;
      if (d2 > v2 || !food[cy * cols + cx]) continue;
      // Random jitter breaks ties between equally distant cells.
      const score = d2 + Math.random();
      if (score < best) {
        best = score;
        bx = tx;
        by = ty;
        found = true;
      }
    }
  }
  return found ? { x: bx, y: by } : null;
};

const findMate = (a: Actor, w: World, hash: SpatialHash, dead: Set<number>, parentsOf: ParentsOf): Actor | null => {
  const depth = w.rules.incestDepth;
  const ancA = depth > 0 ? ancestors(a.id, depth, parentsOf) : undefined;
  const v2 = a.genome.vision ** 2;
  let best: Actor | null = null;
  let bestD2 = Infinity;
  for (const b of hash.near(a.x, a.y, a.genome.vision)) {
    if (b.sex === a.sex || dead.has(b.id) || !readyToMate(b, w)) continue;
    const d2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (d2 > v2 || d2 >= bestD2) continue;
    if (depth > 0 && tooClose(kinship(a.id, b.id, parentsOf, depth, ancA), depth)) continue;
    best = b;
    bestD2 = d2;
  }
  return best;
};

const breed = (a: Actor, b: Actor, w: World): Actor | null => {
  const mother = a.sex === 'F' ? a : b;
  const father = a.sex === 'F' ? b : a;
  const { genome, dominance } = inherit(mother, father, w.rules.inheritanceNoise, w.rules.mutationScale);
  const cost = w.rules.offspringEnergy * w.rules.energyPerSize * genome.size;
  const motherShare = cost * w.rules.parentalCostSplit;
  const fatherShare = cost - motherShare;
  if (mother.energy <= motherShare || father.energy <= fatherShare) return null;
  mother.energy -= motherShare;
  father.energy -= fatherShare;
  mother.cooldown = father.cooldown = w.rules.mateCooldown;

  let surname: string;
  switch (w.rules.surnameRule) {
    case 'mother': surname = mother.surname; break;
    case 'father': surname = father.surname; break;
    case 'stronger': surname = mother.energy >= father.energy ? mother.surname : father.surname; break;
    default: surname = Math.random() < 0.5 ? mother.surname : father.surname;
  }

  const angle = rand(0, Math.PI * 2);
  const sex = Math.random() < 0.5 ? 'F' : 'M';
  return {
    id: w.nextId++,
    given: givenName(sex),
    surname,
    sex,
    generation: Math.max(mother.generation, father.generation) + 1,
    parents: [mother.id, father.id],
    genome,
    dominance,
    x: clamp((mother.x + father.x) / 2 + Math.cos(angle) * 3, 0, w.width),
    y: clamp((mother.y + father.y) / 2 + Math.sin(angle) * 3, 0, w.height),
    vx: 0,
    vy: 0,
    wander: angle,
    energy: cost,
    age: 0,
    cooldown: w.rules.mateCooldown,
    born: w.tick,
  };
};

/** Advances the world by one tick in place. */
export const step = (w: World, parentsOf: ParentsOf): TickEvents => {
  const rules = w.rules;
  w.tick++;
  regrowFood(w);

  const hash = new SpatialHash(40, w.width);
  for (const a of w.actors) hash.insert(a);

  const births: Actor[] = [];
  const deaths: { id: number; cause: DeathCause; age: number }[] = [];
  const dead = new Set<number>();

  for (const a of shuffle([...w.actors])) {
    if (dead.has(a.id)) continue;
    a.age++;
    a.cooldown--;
    const cap = capacityOf(a, rules);
    const radius = radiusOf(a);

    // 1. Decide desired velocity.
    let dx = 0;
    let dy = 0;
    let speed = 0;
    let mate: Actor | null = null;
    const ready = readyToMate(a, w);
    if (ready) mate = findMate(a, w, hash, dead, parentsOf);
    // Ready but no partner in sight: explore instead of staying on food.
    const target = mate ?? (ready ? null : seekFood(a, w));
    if (target) {
      dx = target.x - a.x;
      dy = target.y - a.y;
      const dist = Math.hypot(dx, dy);
      speed = a.genome.maxSpeed * Math.min(1, dist / w.cellSize);
      const angle = Math.atan2(dy, dx) + gaussian() * rules.directionNoise;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    } else {
      a.wander += gaussian() * Math.max(0.2, rules.directionNoise);
      dx = Math.cos(a.wander);
      dy = Math.sin(a.wander);
      speed = a.genome.maxSpeed * (ready ? 1 : 0.6);
    }

    // 2. Physics: steer toward desired velocity, friction, speed limit, walls.
    a.vx += (dx * speed - a.vx) * rules.steerStrength;
    a.vy += (dy * speed - a.vy) * rules.steerStrength;
    a.vx *= 1 - rules.friction;
    a.vy *= 1 - rules.friction;
    const v = Math.hypot(a.vx, a.vy);
    if (v > a.genome.maxSpeed) {
      a.vx *= a.genome.maxSpeed / v;
      a.vy *= a.genome.maxSpeed / v;
    }
    a.x += a.vx;
    a.y += a.vy;
    if (a.x < radius || a.x > w.width - radius) {
      a.x = clamp(a.x, radius, w.width - radius);
      a.vx = 0;
      a.wander = Math.PI - a.wander;
    }
    if (a.y < radius || a.y > w.height - radius) {
      a.y = clamp(a.y, radius, w.height - radius);
      a.vy = 0;
      a.wander = -a.wander;
    }

    // 3. Energy cost.
    const sp2 = a.vx * a.vx + a.vy * a.vy;
    a.energy -=
      rules.baseCost * a.genome.size * (1 + (rules.agingFactor * a.age) / rules.maxAge) +
      rules.moveCost * a.genome.size * sp2;

    // 4. Eat from the current cell.
    const ci = cellIndex(w, a.x, a.y);
    if (w.food[ci] && a.energy < cap) {
      w.food[ci] = 0;
      a.energy = Math.min(cap, a.energy + rules.foodEnergy);
    }

    // 5. Mate on contact.
    if (mate && Math.hypot(mate.x - a.x, mate.y - a.y) <= radius + radiusOf(mate) + 1 && readyToMate(a, w)) {
      const child = breed(a, mate, w);
      if (child) births.push(child);
    }

    // 6. Death.
    if (a.energy <= 0) {
      dead.add(a.id);
      deaths.push({ id: a.id, cause: 'starvation', age: a.age });
    } else if (a.age >= rules.maxAge) {
      dead.add(a.id);
      deaths.push({ id: a.id, cause: 'age', age: a.age });
    }
  }

  if (dead.size) w.actors = w.actors.filter((a) => !dead.has(a.id));
  if (births.length) w.actors.push(...births);
  return { births, deaths };
};
