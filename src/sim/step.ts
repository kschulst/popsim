import { ancestors, KIN_DEPTH, kinPenalty, kinship, kinWeight, type Kinship } from './genealogy';
import { inherit } from './genome';
import { givenName } from './names';
import { clamp, gaussian, rand, shuffle } from './random';
import { SpatialHash } from './spatial';
import { mixAncestry, overlap, purity } from './tribes';
import type { Actor, TickDeath, TickEvents, World } from './types';
import { capacityOf, hpFactor, maxHpOf, radiusOf } from './world';

export type ParentsOf = (id: number) => [number, number] | null | undefined;

/** Radius (world units) used to count allies and opponents around a fight. */
const SUPPORT_RADIUS = 50;
/** Nearest visible actors considered as attack targets per tick. */
const ATTACK_CANDIDATES = 4;
/** Fights an onlooker considers joining per tick. */
const JOIN_CANDIDATES = 3;
const FLASH_TICKS = 6;

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
  a.cooldown <= 0 && a.fleeing <= 0 && a.target === null && a.energy >= a.genome.reproThreshold * capacityOf(a, w.rules);

/** Effective vision and top speed after injury. */
const visionOf = (a: Actor, w: World) => a.genome.vision * hpFactor(a, w.rules);
const speedOf = (a: Actor, w: World) => a.genome.maxSpeed * hpFactor(a, w.rules);

/** Fighting strength: size × (0.5 + 0.5 × energy share) × √(hp share). */
export const strengthOf = (a: Actor, w: World): number =>
  a.genome.size * (0.5 + 0.5 * Math.min(1, a.energy / capacityOf(a, w.rules))) * hpFactor(a, w.rules);

/** Nearest food cell within `vision`, or null if none is visible. */
const seekFood = (a: Actor, w: World, vision: number): { x: number; y: number } | null => {
  const { cellSize, cols, rows, food } = w;
  const r = Math.ceil(vision / cellSize);
  const acx = Math.floor(a.x / cellSize);
  const acy = Math.floor(a.y / cellSize);
  const v2 = vision * vision;
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

/**
 * Per-tick context: lookups shared by all actors in one tick. Ancestor maps are cached per actor
 * because kinship is evaluated many times per tick.
 */
class TickContext {
  readonly byId = new Map<number, Actor>();
  readonly dead = new Set<number>();
  readonly deaths: TickDeath[] = [];
  readonly hash: SpatialHash;
  hits = 0;
  private readonly ancestorCache = new Map<number, Map<number, number>>();

  constructor(
    readonly w: World,
    readonly parentsOf: ParentsOf,
  ) {
    this.hash = new SpatialHash(40, w.width);
    for (const a of w.actors) {
      this.hash.insert(a);
      this.byId.set(a.id, a);
    }
  }

  alive(id: number | null): Actor | undefined {
    if (id === null || this.dead.has(id)) return undefined;
    return this.byId.get(id);
  }

  kin(a: Actor, b: Actor): Kinship | undefined {
    let anc = this.ancestorCache.get(a.id);
    if (!anc) {
      anc = ancestors(a.id, KIN_DEPTH, this.parentsOf);
      this.ancestorCache.set(a.id, anc);
    }
    return kinship(a.id, b.id, this.parentsOf, KIN_DEPTH, anc);
  }

  /** How much `a` sides with `b`: tribe loyalty × shared ancestry + kin loyalty × kin weight. */
  loyalty(a: Actor, b: Actor): number {
    const r = this.w.rules;
    const k = this.kin(a, b);
    return r.tribeLoyalty * overlap(a.ancestry, b.ancestry) + (k ? r.kinLoyalty * kinWeight(k.relation, r.kinWeights) : 0);
  }

  kill(victim: Actor, killer: Actor): void {
    if (this.dead.has(victim.id)) return;
    this.dead.add(victim.id);
    this.deaths.push({ id: victim.id, cause: 'killed', age: victim.age, killer: killer.id });
    killer.kills++;
  }
}

/** Symmetric mate score; see the 'Partnervalg' rule descriptions. */
const mateScore = (ctx: TickContext, a: Actor, b: Actor, dist: number): number => {
  const r = ctx.w.rules;
  const tribe = r.tribePreference * overlap(a.ancestry, b.ancestry) * (purity(a.ancestry) * purity(b.ancestry)) ** r.purityWeight;
  const meanVision = (a.genome.vision + b.genome.vision) / 2;
  return 1 + tribe - kinPenalty(ctx.kin(a, b), r) - (r.mateDistanceWeight * dist) / meanVision;
};

/** Best-scoring ready partner in sight whose score both accept, or null. */
const findMate = (ctx: TickContext, a: Actor, vision: number): Actor | null => {
  const { w } = ctx;
  let best: Actor | null = null;
  let bestScore = w.rules.minMateScore;
  for (const b of ctx.hash.near(a.x, a.y, vision)) {
    if (b.sex === a.sex || ctx.dead.has(b.id) || !readyToMate(b, w)) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > vision) continue;
    const s = mateScore(ctx, a, b, d);
    if (s >= bestScore) {
      best = b;
      bestScore = s;
    }
  }
  return best;
};

/**
 * Strength on each side if `a` attacks `b`: own strength plus nearby actors that lean towards
 * one side by shared ancestry, weighted by their aggression (how likely they are to join).
 */
const odds = (ctx: TickContext, a: Actor, b: Actor): number => {
  const { w } = ctx;
  let mine = strengthOf(a, w);
  let theirs = strengthOf(b, w);
  for (const n of ctx.hash.near(a.x, a.y, SUPPORT_RADIUS)) {
    if (n === a || n === b || ctx.dead.has(n.id)) continue;
    const oa = overlap(n.ancestry, a.ancestry);
    const ob = overlap(n.ancestry, b.ancestry);
    if (oa > ob + 0.25) mine += strengthOf(n, w) * n.genome.aggression;
    else if (ob > oa + 0.25) theirs += strengthOf(n, w) * n.genome.aggression;
  }
  return mine / (mine + theirs);
};

/** Share of the local strength that is against `a` (0–1), counting who targets whom. */
const threatTo = (ctx: TickContext, a: Actor, opponent: Actor): number => {
  const { w } = ctx;
  const enemies = new Set<number>([opponent.id]);
  const near = [...ctx.hash.near(a.x, a.y, SUPPORT_RADIUS)].filter((n) => !ctx.dead.has(n.id));
  for (const n of near) if (n.target === a.id) enemies.add(n.id);
  let mine = strengthOf(a, w);
  let theirs = 0;
  for (const n of near) {
    if (enemies.has(n.id)) theirs += strengthOf(n, w);
    else if (n !== a && n.target !== null && enemies.has(n.target)) mine += strengthOf(n, w);
  }
  if (!near.includes(opponent)) theirs += strengthOf(opponent, w);
  return theirs / (mine + theirs);
};

const startFleeing = (a: Actor, from: Actor | null, w: World): void => {
  a.fleeing = w.rules.fleeDuration;
  a.fleeFrom = from?.id ?? null;
  a.target = null;
  a.mateTarget = null;
};

/** Onlooker picks a side in a visible fight if its loyalty difference × aggression is large enough. */
const considerJoining = (ctx: TickContext, a: Actor, vision: number): boolean => {
  const r = ctx.w.rules;
  let seen = 0;
  for (const x of ctx.hash.near(a.x, a.y, vision)) {
    if (x === a || x.target === null || x.target === a.id || ctx.dead.has(x.id)) continue;
    const y = ctx.alive(x.target);
    if (!y || y === a) continue;
    if (Math.hypot(x.x - a.x, x.y - a.y) > vision) continue;
    const diff = ctx.loyalty(a, x) - ctx.loyalty(a, y);
    if (a.genome.aggression * diff > r.joinThreshold) {
      a.target = y.id;
      return true;
    }
    if (a.genome.aggression * -diff > r.joinThreshold) {
      a.target = x.id;
      return true;
    }
    if (++seen >= JOIN_CANDIDATES) break;
  }
  return false;
};

/** Attack desire towards each of the nearest visible actors; sets a.target to the best above the threshold. */
const considerAttack = (ctx: TickContext, a: Actor, vision: number, food: { x: number; y: number } | null): void => {
  const { w } = ctx;
  const r = w.rules;
  const aggr = a.genome.aggression;
  if (aggr <= 0) return;
  const hunger = 1 - Math.min(1, a.energy / capacityOf(a, r));
  const near: [Actor, number][] = [];
  for (const b of ctx.hash.near(a.x, a.y, vision)) {
    if (b === a || ctx.dead.has(b.id)) continue;
    const d2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (d2 <= vision * vision) near.push([b, d2]);
  }
  near.sort((p, q) => p[1] - q[1]);
  const foodD2 = food ? (food.x - a.x) ** 2 + (food.y - a.y) ** 2 : Infinity;
  let best: Actor | null = null;
  let bestDesire = r.attackThreshold;
  for (const [b] of near.slice(0, ATTACK_CANDIDATES)) {
    const rival = a.mateTarget !== null && b.sex === a.sex && b.mateTarget === a.mateTarget ? 1 : 0;
    const foodComp = food && (food.x - b.x) ** 2 + (food.y - b.y) ** 2 < foodD2 ? 1 : 0;
    const motive = r.hungerWeight * hunger + r.foodCompetitionWeight * foodComp + r.rivalryWeight * rival;
    // Upper bound with odds = 1, before loyalty: skip the costly part when it cannot pass.
    if (aggr * motive * 2 <= bestDesire) continue;
    const k = ctx.kin(a, b);
    const restraint = r.tribeLoyalty * overlap(a.ancestry, b.ancestry) + (k ? r.kinLoyalty * kinWeight(k.relation, r.kinWeights) : 0);
    if (aggr * motive * 2 - restraint <= bestDesire) continue;
    const desire = aggr * motive * 2 * odds(ctx, a, b) - restraint;
    if (desire > bestDesire) {
      best = b;
      bestDesire = desire;
    }
  }
  if (best) a.target = best.id;
};

/** One attack from a on t. Applies damage, the defender's reaction and a possible kill. */
const strike = (ctx: TickContext, a: Actor, t: Actor): void => {
  const { w } = ctx;
  const r = w.rules;
  a.attackCd = r.attackCooldown;
  a.energy -= r.attackCost;
  const sa = speedOf(a, w);
  const st = speedOf(t, w);
  const pHit = clamp(0.6 + (0.3 * (sa - st)) / (sa + st || 1), 0.2, 0.95);
  if (Math.random() >= pHit) return;
  const dmg = r.damageScale * strengthOf(a, w) * Math.exp(gaussian() * 0.5);
  t.hp -= dmg;
  t.flash = FLASH_TICKS;
  t.lastHitBy = a.id;
  a.damageDealt += dmg;
  t.damageTaken += dmg;
  ctx.hits++;
  if (t.hp <= 0) {
    ctx.kill(t, a);
    a.target = null;
    return;
  }
  // Defender not already engaged: fight back or flee.
  if (t.target === null && t.fleeing <= 0) {
    const hpShare = t.hp / maxHpOf(t, r);
    const pFlee = 0.5 * (1 - t.genome.aggression) + 0.5 * (1 - hpShare);
    if (Math.random() < pFlee) startFleeing(t, a, w);
    else t.target = a.id;
  }
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
  mother.mateTarget = father.mateTarget = null;

  let surname: string;
  switch (w.rules.surnameRule) {
    case 'mother': surname = mother.surname; break;
    case 'father': surname = father.surname; break;
    case 'stronger': surname = mother.energy >= father.energy ? mother.surname : father.surname; break;
    default: surname = Math.random() < 0.5 ? mother.surname : father.surname;
  }

  const angle = rand(0, Math.PI * 2);
  const sex = Math.random() < 0.5 ? 'F' : 'M';
  const child: Actor = {
    id: w.nextId++,
    given: givenName(sex),
    surname,
    sex,
    generation: Math.max(mother.generation, father.generation) + 1,
    parents: [mother.id, father.id],
    genome,
    dominance,
    ancestry: mixAncestry(mother.ancestry, father.ancestry),
    x: clamp((mother.x + father.x) / 2 + Math.cos(angle) * 3, 0, w.width),
    y: clamp((mother.y + father.y) / 2 + Math.sin(angle) * 3, 0, w.height),
    vx: 0,
    vy: 0,
    wander: angle,
    energy: cost,
    age: 0,
    cooldown: w.rules.mateCooldown,
    born: w.tick,
    hp: 0,
    target: null,
    fleeing: 0,
    fleeFrom: null,
    attackCd: 0,
    mateTarget: null,
    lastHitBy: null,
    flash: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
  };
  child.hp = maxHpOf(child, w.rules);
  return child;
};

/** Pushes overlapping actors apart so bodies do not share space. */
const separate = (ctx: TickContext, a: Actor, radius: number): void => {
  const { w } = ctx;
  for (const b of ctx.hash.near(a.x, a.y, radius + 8)) {
    if (b === a || ctx.dead.has(b.id)) continue;
    const rb = radiusOf(b);
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = radius + rb;
    if (d >= min) continue;
    if (d < 1e-6) {
      const ang = rand(0, Math.PI * 2);
      dx = Math.cos(ang);
      dy = Math.sin(ang);
      d = 1;
    } else {
      dx /= d;
      dy /= d;
    }
    const push = (min - Math.min(d, min)) / 2;
    a.x = clamp(a.x - dx * push, radius, w.width - radius);
    a.y = clamp(a.y - dy * push, radius, w.height - radius);
    b.x = clamp(b.x + dx * push, rb, w.width - rb);
    b.y = clamp(b.y + dy * push, rb, w.height - rb);
  }
};

/** Advances the world by one tick in place. */
export const step = (w: World, parentsOf: ParentsOf): TickEvents => {
  const rules = w.rules;
  w.tick++;
  regrowFood(w);

  const ctx = new TickContext(w, parentsOf);
  const births: Actor[] = [];

  for (const a of shuffle([...w.actors])) {
    if (ctx.dead.has(a.id)) continue;
    a.age++;
    a.cooldown--;
    a.attackCd--;
    if (a.flash > 0) a.flash--;
    const cap = capacityOf(a, rules);
    const radius = radiusOf(a);
    const vision = visionOf(a, w);
    const maxSpeed = speedOf(a, w);

    // 1. Conflict state: drop lost targets, count down fleeing, decide whether to flee.
    let target = ctx.alive(a.target);
    if (target) {
      const d = Math.hypot(target.x - a.x, target.y - a.y);
      if (d > vision * 1.5 || (target.fleeing > 0 && Math.random() < rules.pursuitGiveUp)) target = undefined;
    }
    a.target = target?.id ?? null;
    if (a.fleeing > 0 && --a.fleeing === 0) a.fleeFrom = null;
    if (target && a.fleeing <= 0) {
      const hpShare = a.hp / maxHpOf(a, rules);
      const threat = threatTo(ctx, a, target);
      const pFlee = rules.fleeRate * (2 * (1 - hpShare) + Math.max(0, threat - 0.5)) * (1 - 0.7 * a.genome.aggression);
      if (Math.random() < pFlee) {
        startFleeing(a, target, w);
        target = undefined;
      }
    }

    // 2. Choose what to do: flee > fight > join a fight > attack > mate > eat > wander.
    const food = a.fleeing > 0 ? null : seekFood(a, w, vision);
    if (!target && a.fleeing <= 0) {
      if (considerJoining(ctx, a, vision) || (considerAttack(ctx, a, vision, food), a.target !== null)) {
        target = ctx.alive(a.target);
      }
    }
    let mate: Actor | null = null;
    let goal: { x: number; y: number } | null = null;
    let speed = 0;
    let dx = 0;
    let dy = 0;
    const fleeFrom = a.fleeing > 0 ? ctx.alive(a.fleeFrom) : undefined;
    if (a.fleeing > 0) {
      if (fleeFrom) {
        dx = a.x - fleeFrom.x;
        dy = a.y - fleeFrom.y;
        const n = Math.hypot(dx, dy) || 1;
        dx /= n;
        dy /= n;
      } else {
        a.wander += gaussian() * 0.3;
        dx = Math.cos(a.wander);
        dy = Math.sin(a.wander);
      }
      speed = maxSpeed;
    } else if (target) {
      goal = target;
      speed = maxSpeed;
    } else {
      const ready = readyToMate(a, w);
      if (ready) mate = findMate(ctx, a, vision);
      a.mateTarget = mate?.id ?? null;
      // Ready but no partner in sight: explore instead of staying on food.
      goal = mate ?? (ready ? null : food);
      if (!goal) {
        a.wander += gaussian() * Math.max(0.2, rules.directionNoise);
        dx = Math.cos(a.wander);
        dy = Math.sin(a.wander);
        speed = maxSpeed * (ready ? 1 : 0.6);
      }
    }
    if (goal) {
      dx = goal.x - a.x;
      dy = goal.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (!target) speed = maxSpeed * Math.min(1, dist / w.cellSize);
      const angle = Math.atan2(dy, dx) + gaussian() * rules.directionNoise;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }

    // 3. Physics: steer toward desired velocity, friction, speed limit, walls, no overlap.
    a.vx += (dx * speed - a.vx) * rules.steerStrength;
    a.vy += (dy * speed - a.vy) * rules.steerStrength;
    a.vx *= 1 - rules.friction;
    a.vy *= 1 - rules.friction;
    const v = Math.hypot(a.vx, a.vy);
    if (v > maxSpeed) {
      a.vx *= maxSpeed / v;
      a.vy *= maxSpeed / v;
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
    separate(ctx, a, radius);

    // 4. Energy cost and healing.
    const sp2 = a.vx * a.vx + a.vy * a.vy;
    a.energy -=
      rules.baseCost * a.genome.size * (1 + (rules.agingFactor * a.age) / rules.maxAge) +
      rules.moveCost * a.genome.size * sp2;
    const maxHp = maxHpOf(a, rules);
    if (a.hp < maxHp && a.energy > cap / 2) {
      const h = Math.min(maxHp - a.hp, rules.healRate * maxHp);
      a.hp += h;
      a.energy -= h * rules.healCost;
    }

    // 5. Eat from the current cell.
    const ci = cellIndex(w, a.x, a.y);
    if (w.food[ci] && a.energy < cap) {
      w.food[ci] = 0;
      a.energy = Math.min(cap, a.energy + rules.foodEnergy);
    }

    // 6. Strike the target, or mate on contact.
    if (target && !ctx.dead.has(target.id) && a.attackCd <= 0 && Math.hypot(target.x - a.x, target.y - a.y) <= radius + radiusOf(target) + rules.attackReach) {
      strike(ctx, a, target);
    } else if (mate && Math.hypot(mate.x - a.x, mate.y - a.y) <= radius + radiusOf(mate) + 1 && readyToMate(a, w) && readyToMate(mate, w)) {
      const child = breed(a, mate, w);
      if (child) births.push(child);
    }

    // 7. Death from starvation or age.
    if (a.energy <= 0) {
      ctx.dead.add(a.id);
      ctx.deaths.push({ id: a.id, cause: 'starvation', age: a.age });
    } else if (a.age >= rules.maxAge) {
      ctx.dead.add(a.id);
      ctx.deaths.push({ id: a.id, cause: 'age', age: a.age });
    }
  }

  if (ctx.dead.size) w.actors = w.actors.filter((a) => !ctx.dead.has(a.id));
  if (births.length) w.actors.push(...births);
  return { births, deaths: ctx.deaths, hits: ctx.hits };
};
