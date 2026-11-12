import { ancestors, KIN_DEPTH, kinPenalty, kinship, kinWeight, type Kinship } from './genealogy';
import { inherit } from './genome';
import { givenName } from './names';
import { clamp, gaussian, rand, shuffle } from './random';
import { SpatialHash } from './spatial';
import { hostility, recordKill, stepCultures } from './culture';
import { maybeOutbreak, progressInfection } from './disease';
import { activeEles, applyEles, createEle, eleEffects, pickEle, type EleEffects } from './ele';
import { MACHINE_SIZE, stepMachines, strikeMachine } from './machines';
import { mixAncestry, overlap, purity } from './tribes';
import type { Actor, AttackReason, Culture, Embryo, TickDeath, TickEvents, World } from './types';
import { capacityOf, hpFactor, isWater, maxHpOf, radiusOf } from './world';

export type ParentsOf = (id: number) => [number, number] | null | undefined;

/** Radius (world units) used to count allies and opponents around a fight. */
const SUPPORT_RADIUS = 50;
/** Nearest visible actors considered as attack targets per tick. */
const ATTACK_CANDIDATES = 4;
/** Fights an onlooker considers joining per tick. */
const JOIN_CANDIDATES = 3;
const FLASH_TICKS = 6;
/** Ticks a courtship outcome stays visible. */
const COURT_TICKS = 25;

/**
 * Empty cells get food with probability fertility × (spontaneous + spread × food neighbours).
 * Neighbour counts use the state at the start of the tick.
 */
/** Growth multiplier from the season: 1 + strength × sin(2π · tick / year). */
export const seasonFactor = (w: World): number => {
  const L = w.rules.seasonLength ?? 0;
  if (L <= 0) return 1;
  return Math.max(0, 1 + (w.rules.seasonStrength ?? 0) * Math.sin((2 * Math.PI * w.tick) / L));
};

/** Season name for the tick: spring, summer, autumn or winter. */
export const seasonName = (w: World): string | null => {
  const L = w.rules.seasonLength ?? 0;
  if (L <= 0) return null;
  const p = (((w.tick % L) + L) % L) / L;
  return p < 0.125 || p >= 0.875 ? 'vår' : p < 0.375 ? 'sommer' : p < 0.625 ? 'høst' : 'vinter';
};

/** Energy an actor gets from a food cell, by type and its diet gene (0 grass … 1 berries). */
export const foodGain = (type: number, a: Actor, r: World['rules']): number => {
  const diet = a.genome.diet ?? 0.5;
  // Mild trade-off: a middle diet (0.5) gets the full value of both; specialists gain ±30 %/±40 %.
  return type === 2 ? (r.berryEnergy ?? 0) * (0.6 + 0.8 * diet) : r.foodEnergy * (1.15 - 0.3 * diet);
};

const regrowFood = (w: World, fx: EleEffects): void => {
  const season = seasonFactor(w);
  const foodSpreadRate = w.rules.foodSpreadRate * fx.spread * fx.growth * season;
  const foodSpontaneous = w.rules.foodSpontaneous * fx.spontaneous * fx.growth * season;
  const berrySpread = (w.rules.berrySpread ?? 0) * fx.spread * fx.growth * season;
  const berrySpontaneous = (w.rules.berrySpontaneous ?? 0) * fx.spontaneous * fx.growth * season;
  const cf = fx.cellFactor;
  const { cols, rows, fertility } = w;
  const prev = w.food.slice();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const factor = cf ? cf((c + 0.5) * w.cellSize, (r + 0.5) * w.cellSize) : 1;
      // Cells under ice or in a fresh crater lose their food.
      if (factor < 0.05) w.food[i] = 0;
      if (prev[i]) continue;
      let n = 0;
      let nb = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (!(dr || dc) || cc < 0 || cc >= cols) continue;
          const v = prev[rr * cols + cc];
          if (v === 1) n++;
          else if (v === 2) nb++;
        }
      }
      // Berries only on fertile ground; otherwise grass.
      const f = fertility[i] * factor;
      if (fertility[i] > 0.6 && Math.random() < f * (berrySpontaneous + berrySpread * nb)) w.food[i] = 2;
      else if (Math.random() < f * (foodSpontaneous + foodSpreadRate * n)) w.food[i] = 1;
    }
  }
};

const cellIndex = (w: World, x: number, y: number): number => {
  const c = clamp(Math.floor(x / w.cellSize), 0, w.cols - 1);
  const r = clamp(Math.floor(y / w.cellSize), 0, w.rows - 1);
  return r * w.cols + c;
};

const readyToMate = (a: Actor, w: World): boolean =>
  a.cooldown <= 0 &&
  a.fleeing <= 0 &&
  a.target === null &&
  a.pregnancy === null &&
  a.caresFor === null &&
  a.energy >= a.genome.reproThreshold * capacityOf(a, w.rules);

/** Biological age: age divided by the longevity gene. */
const bioAge = (a: Actor) => a.age / (a.genome.longevity || 1);

/** 1 until senescence starts, then falling linearly to 1 − senescenceStrength. */
export const ageVigorOf = (a: Actor, r: World['rules']): number =>
  1 - r.senescenceStrength * clamp((bioAge(a) - r.senescenceOnset) / Math.max(1, r.senescenceSpan), 0, 1);

/** Overall vigor: ageing × illness. Scales speed, vision, strength and fertility. */
export const vigorOf = (a: Actor, r: World['rules']): number =>
  ageVigorOf(a, r) * (a.infection ? 1 - r.sicknessWeakness : 1);

/** True if any cell within `reach` of (x, y) is water. */
const nearWater = (w: World, x: number, y: number, reach: number): boolean => {
  const { cellSize, cols, rows, fertility } = w;
  const r = Math.ceil(reach / cellSize);
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  for (let rr = Math.max(0, cy - r); rr <= Math.min(rows - 1, cy + r); rr++)
    for (let cc = Math.max(0, cx - r); cc <= Math.min(cols - 1, cx + r); cc++) if (fertility[rr * cols + cc] < 0) return true;
  return false;
};

/** Nearest water cell centre within `vision`, or null. */
const seekWater = (a: Actor, w: World, vision: number): { x: number; y: number } | null => {
  const { cellSize, cols, rows, fertility } = w;
  const r = Math.ceil(vision / cellSize);
  const acx = Math.floor(a.x / cellSize);
  const acy = Math.floor(a.y / cellSize);
  let best = vision * vision;
  let out: { x: number; y: number } | null = null;
  for (let cy = Math.max(0, acy - r); cy <= Math.min(rows - 1, acy + r); cy++) {
    for (let cx = Math.max(0, acx - r); cx <= Math.min(cols - 1, acx + r); cx++) {
      if (fertility[cy * cols + cx] >= 0) continue;
      const x = (cx + 0.5) * cellSize;
      const y = (cy + 0.5) * cellSize;
      const d = (x - a.x) ** 2 + (y - a.y) ** 2;
      if (d < best) {
        best = d;
        out = { x, y };
      }
    }
  }
  return out;
};

/** True if the straight line from a to b crosses water (sampled every half cell). */
const waterBetween = (w: World, a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / (w.cellSize / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isWater(w, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return true;
  }
  return false;
};

/** The shelter an actor is in, or undefined. */
export const shelterAt = (w: World, x: number, y: number) =>
  (w.shelters ?? []).find((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r);

/** Nearest shelter within `range`, or null. */
const seekShelter = (a: Actor, w: World, range: number): { x: number; y: number } | null => {
  let best = range * range;
  let out: { x: number; y: number } | null = null;
  for (const s of w.shelters ?? []) {
    const d = (s.x - a.x) ** 2 + (s.y - a.y) ** 2;
    if (d < best) {
      best = d;
      out = s;
    }
  }
  return out;
};

/** Hydration below which an actor goes looking for water before anything but fighting. */
const THIRSTY = 0.35;

/** Effective vision and top speed after injury and ageing. */
const visionOf = (a: Actor, w: World) => a.genome.vision * hpFactor(a, w.rules) * vigorOf(a, w.rules);
const speedOf = (a: Actor, w: World) => a.genome.maxSpeed * hpFactor(a, w.rules) * vigorOf(a, w.rules);

/** Fighting strength: size × (0.5 + 0.5 × energy share) × √(hp share). */
export const strengthOf = (a: Actor, w: World): number =>
  a.genome.size * (0.5 + 0.5 * Math.min(1, a.energy / capacityOf(a, w.rules))) * hpFactor(a, w.rules) * vigorOf(a, w.rules);

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
      const type = food[cy * cols + cx];
      if (d2 > v2 || !type) continue;
      // Best value for the walk: distance per energy gained (random jitter breaks ties).
      const score = (Math.sqrt(d2) + cellSize) / Math.max(0.1, foodGain(type, a, w.rules)) + Math.random() * 1e-3;
      if (score < best) {
        best = score;
        bx = tx;
        by = ty;
        found = true;
      }
    }
  }
  // Carcasses count like food worth one bite.
  for (const c of w.carcasses ?? []) {
    const d2 = (c.x - a.x) ** 2 + (c.y - a.y) ** 2;
    const score = (Math.sqrt(d2) + cellSize) / Math.max(0.1, Math.min(c.energy, w.rules.carrionBite ?? 0));
    if (d2 <= v2 && score < best) {
      best = score;
      bx = c.x;
      by = c.y;
      found = true;
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
  /** Effects of active extinction level events this tick. */
  fx: EleEffects;
  /** Whether the map has any water (thirst only applies if it does). */
  hasWater: boolean;
  /** Season growth factor this tick (1 = no seasons, below 1 = winter). */
  season: number;
  private readonly ancestorCache = new Map<number, Map<number, number>>();

  constructor(
    readonly w: World,
    readonly parentsOf: ParentsOf,
  ) {
    this.fx = eleEffects(w);
    this.hasWater = w.fertility.some((f) => f < 0);
    this.season = seasonFactor(w);
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
    return (
      r.tribeLoyalty * overlap(a.ancestry, b.ancestry) +
      (k ? r.kinLoyalty * kinWeight(k.relation, r.kinWeights) : 0) +
      this.cultureBond(a, b)
    );
  }

  private protecteeCache = new Map<number, { p: Actor; weight: number } | null>();

  /**
   * The pregnant female `a` helps most, and how much (0–1+): the mother a caring father guards
   * has weight 1; a pregnant relative in sight has kinCare × kin weight. Cached per tick.
   */
  protectee(a: Actor, vision: number): { p: Actor; weight: number } | null {
    if (this.protecteeCache.has(a.id)) return this.protecteeCache.get(a.id)!;
    const r = this.w.rules;
    let best: { p: Actor; weight: number } | null = null;
    const partner = this.alive(a.caresFor);
    if (partner?.pregnancy) best = { p: partner, weight: 1 };
    if (r.kinCare > 0) {
      for (const p of this.hash.near(a.x, a.y, vision)) {
        if (p === a || !p.pregnancy || this.dead.has(p.id)) continue;
        const k = this.kin(a, p);
        if (!k) continue;
        const weight = r.kinCare * kinWeight(k.relation, r.kinWeights);
        if (weight > 0.01 && (!best || weight > best.weight)) best = { p, weight };
      }
    }
    this.protecteeCache.set(a.id, best);
    return best;
  }

  /** Pregnancies lost this tick (mother died, or stillbirth). */
  losses = 0;

  die(a: Actor, cause: TickDeath['cause'], killer?: Actor, disease?: number): void {
    if (this.dead.has(a.id)) return;
    this.dead.add(a.id);
    const meat = (this.w.rules.carrionPerSize ?? 0) * a.genome.size;
    if (meat > 0) (this.w.carcasses ??= []).push({ x: a.x, y: a.y, energy: meat });
    if (killer) killer.kills++;
    this.deaths.push({
      id: a.id,
      cause,
      age: a.age,
      killer: killer?.id,
      disease,
      tally: {
        kills: a.kills,
        damageDealt: a.damageDealt,
        damageTaken: a.damageTaken,
        hitsTaken: a.hitsTaken,
        foodEaten: a.foodEaten,
        distance: a.distance,
        courtships: a.courtships ?? 0,
        acceptedBy: a.acceptedBy ?? 0,
        affairs: a.affairs ?? 0,
      },
    });
  }

  kill(victim: Actor, killer: Actor): void {
    this.die(victim, 'killed', killer);
    recordKill(this.w, killer, victim);
  }

  /** Culture of an actor's culture id, or undefined. */
  culture(a: Actor): Culture | undefined {
    return a.culture === null || a.culture === undefined ? undefined : this.w.cultures?.[a.culture];
  }

  /** Bond from a shared culture: cultureLoyalty × (0.5 + peace), or 0. */
  cultureBond(a: Actor, b: Actor): number {
    const c = this.culture(a);
    return c && a.culture === b.culture ? (this.w.rules.cultureLoyalty ?? 0) * (0.5 + c.peace) : 0;
  }
}

/** Symmetric mate score; see the 'Partnervalg' rule descriptions. */
const mateScore = (ctx: TickContext, a: Actor, b: Actor, dist: number): number => {
  const r = ctx.w.rules;
  const tribe = r.tribePreference * overlap(a.ancestry, b.ancestry) * (purity(a.ancestry) * purity(b.ancestry)) ** r.purityWeight;
  const meanVision = (a.genome.vision + b.genome.vision) / 2;
  return 1 + tribe - kinPenalty(ctx.kin(a, b), r) - (r.mateDistanceWeight * dist) / meanVision;
};

/** Probability that an actor accepts a partner it scores `score` (see the Kresenhet rule). */
export const acceptance = (score: number, r: World['rules'], min = r.minMateScore): number => {
  if (score < min) return 0;
  if (r.choosiness <= 0) return 1;
  return 1 - Math.exp(-(score - min) / r.choosiness);
};

/** An actor's lowest acceptable partner score: minMateScore lowered by how long it has waited. */
export const minScoreOf = (a: Actor, r: World['rules']): number =>
  r.minMateScore - Math.min(4, ((r.desperation ?? 0) * (a.lonely ?? 0)) / 300);

/**
 * Both sides decide on contact. A rejected actor waits `rejectionCooldown` ticks; the one who
 * rejected skips that candidate next time. Returns true if both accept.
 */
const courtship = (ctx: TickContext, a: Actor, b: Actor): boolean => {
  const r = ctx.w.rules;
  const bonus = r.tribeBonus ?? [];
  const base = mateScore(ctx, a, b, Math.hypot(b.x - a.x, b.y - a.y));
  // Spouses get a bonus; a married actor accepts anyone else only with probability 1 − fidelity.
  const loyal = (x: Actor, y: Actor) => (x.spouse === null || x.spouse === y.id ? 1 : 1 - (x.genome.fidelity ?? 0.6));
  const sb = (x: Actor, y: Actor) => (x.spouse === y.id ? (r.spouseBonus ?? 0) : 0);
  const aAccepts = Math.random() < acceptance(base + tribeBonusOf(b, bonus) + sb(a, b), r, minScoreOf(a, r)) * loyal(a, b);
  const bAccepts = Math.random() < acceptance(base + tribeBonusOf(a, bonus) + sb(b, a), r, minScoreOf(b, r)) * loyal(b, a);
  if (!aAccepts) {
    a.snub = b.id;
    a.snubTtl = 4 * r.rejectionCooldown;
    b.cooldown = Math.max(b.cooldown, r.rejectionCooldown);
  }
  if (!bAccepts) {
    b.snub = a.id;
    b.snubTtl = 4 * r.rejectionCooldown;
    a.cooldown = Math.max(a.cooldown, r.rejectionCooldown);
  }
  if (!aAccepts || !bAccepts) a.mateTarget = b.mateTarget = null;
  a.courtships = (a.courtships ?? 0) + 1;
  b.courtships = (b.courtships ?? 0) + 1;
  if (bAccepts) a.acceptedBy = (a.acceptedBy ?? 0) + 1;
  if (aAccepts) b.acceptedBy = (b.acceptedBy ?? 0) + 1;
  a.court = { with: b.id, selfAccepted: aAccepts, otherAccepted: bAccepts, ttl: COURT_TICKS };
  return aAccepts && bAccepts;
};

/** Attractiveness bonus of an actor: Σ tribeBonus[i] × ancestry share from tribe i. */
export const tribeBonusOf = (a: Actor, bonus: number[]): number => {
  let s = 0;
  for (let i = 0; i < bonus.length; i++) s += (bonus[i] ?? 0) * (a.ancestry[i] ?? 0);
  return s;
};

/** Prospects must be able to mate within this many ticks to be worth approaching. */
const PROSPECT_WAIT = 20;

/**
 * One scan of the neighbourhood for partners.
 * - mate: best-scoring ready partner; a's score for b adds b's tribe bonus and vice versa, and
 *   both must reach minMateScore.
 * - prospect: when no mate is ready, the best acceptable opposite-sex adult (score ≥ minMateScore,
 *   so not close kin) that can mate soon: not pregnant, not guarding a mother, not nursing or in a
 *   long cooldown, and not one that just rejected a. Approaching it finds partners in small,
 *   closely related groups instead of wandering at random.
 */
const findPartner = (ctx: TickContext, a: Actor, vision: number): { mate: Actor | null; prospect: Actor | null } => {
  const { w } = ctx;
  const r = w.rules;
  const bonus = r.tribeBonus ?? [];
  const min = minScoreOf(a, r);
  const bonusA = tribeBonusOf(a, bonus);
  let mate: Actor | null = null;
  let mateScoreBest = -Infinity;
  let prospect: Actor | null = null;
  let prospectScore = min;
  for (const b of ctx.hash.near(a.x, a.y, vision)) {
    if (b.sex === a.sex || b.id === a.snub || b.snub === a.id || ctx.dead.has(b.id)) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > vision) continue;
    const ready = readyToMate(b, w);
    const soon =
      !ready &&
      b.pregnancy === null &&
      b.caresFor === null &&
      b.age >= r.mateCooldown &&
      b.cooldown <= PROSPECT_WAIT;
    if (!ready && !soon) continue;
    // Partners across water cannot be reached directly.
    if (ctx.hasWater && waterBetween(w, a, b)) continue;
    const base = mateScore(ctx, a, b, d);
    if (ready) {
      const score = base + tribeBonusOf(b, bonus) + (a.spouse === b.id ? (r.spouseBonus ?? 0) : 0);
      if (score >= min && base + bonusA >= minScoreOf(b, r) && score > mateScoreBest) {
        mate = b;
        mateScoreBest = score;
      }
    } else if (base > prospectScore) {
      prospect = b;
      prospectScore = base;
    }
  }
  return { mate, prospect: mate ? null : prospect };
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
  // A caring father attacks anyone attacking the mother he guards; spouses defend each other.
  if (a.caresFor !== null || a.spouse !== null) {
    for (const x of ctx.hash.near(a.x, a.y, vision)) {
      if ((x.target === a.caresFor || x.target === a.spouse) && x.target !== null && x !== a && !ctx.dead.has(x.id)) {
        a.target = x.id;
        a.targetReason = 'protect';
        return true;
      }
    }
  }
  let seen = 0;
  for (const x of ctx.hash.near(a.x, a.y, vision)) {
    if (x === a || x.target === null || x.target === a.id || ctx.dead.has(x.id)) continue;
    const y = ctx.alive(x.target);
    if (!y || y === a) continue;
    if (Math.hypot(x.x - a.x, x.y - a.y) > vision) continue;
    // Defending a pregnant female one helps counts on top of ordinary loyalty.
    const prot = ctx.protectee(a, vision);
    const extra = (p: Actor) => (prot && prot.p === p ? 2 * prot.weight : 0);
    const diff = ctx.loyalty(a, x) + extra(x) - ctx.loyalty(a, y) - extra(y);
    const aggr = ctx.fx.rage ? 1 : a.genome.aggression;
    const d2 = ctx.fx.rage ? diff * 0.5 : diff;
    if (aggr * d2 > r.joinThreshold) {
      a.target = y.id;
      a.targetReason = prot && prot.p === x ? 'protect' : 'join';
      return true;
    }
    if (aggr * -d2 > r.joinThreshold) {
      a.target = x.id;
      a.targetReason = prot && prot.p === y ? 'protect' : 'join';
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
  // Rage (ELE): everyone acts with full aggression and half the usual restraint.
  const aggr = ctx.fx.rage ? 1 : a.genome.aggression;
  const restraintFactor = ctx.fx.rage ? 0.5 : 1;
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
  // Helping a hungry pregnant female: competitors close to her are a reason to attack.
  const prot = ctx.protectee(a, vision);
  const protHunger = prot ? 1 - Math.min(1, prot.p.energy / capacityOf(prot.p, r)) : 0;
  let best: Actor | null = null;
  let bestReason: AttackReason = 'food';
  let bestDesire = r.attackThreshold;
  for (const [b] of near.slice(0, ATTACK_CANDIDATES)) {
    const rival = a.mateTarget !== null && b.sex === a.sex && b.mateTarget === a.mateTarget ? 1 : 0;
    const foodComp = food && (food.x - b.x) ** 2 + (food.y - b.y) ** 2 < foodD2 ? 1 : 0;
    const nearProtectee =
      prot && b !== prot.p && Math.hypot(b.x - prot.p.x, b.y - prot.p.y) <= r.guardDistance ? 1 : 0;
    // Feud: hostility between the cultures, scaled by a's culture's xenophobia.
    const feud = Math.min(2, hostility(w, a.culture ?? null, b.culture ?? null) * (ctx.culture(a)?.xenophobia ?? 0));
    const motive =
      r.hungerWeight * hunger +
      r.foodCompetitionWeight * foodComp +
      r.rivalryWeight * rival +
      nearProtectee * r.hungerWeight * protHunger * (prot?.weight ?? 0) +
      feud;
    // Upper bound with odds = 1, before loyalty: skip the costly part when it cannot pass.
    if (aggr * motive * 2 <= bestDesire) continue;
    const k = ctx.kin(a, b);
    const restraint =
      restraintFactor *
      (r.tribeLoyalty * overlap(a.ancestry, b.ancestry) + (k ? r.kinLoyalty * kinWeight(k.relation, r.kinWeights) : 0) + ctx.cultureBond(a, b));
    if (aggr * motive * 2 - restraint <= bestDesire) continue;
    const desire = aggr * motive * 2 * odds(ctx, a, b) - restraint;
    if (desire > bestDesire) {
      best = b;
      bestDesire = desire;
      // The reason is the largest candidate-specific motive. General hunger applies to every
      // candidate equally, so it only names the reason when nothing else does ('food').
      const foodTerm = r.foodCompetitionWeight * foodComp;
      const rivalTerm = r.rivalryWeight * rival;
      const protectTerm = nearProtectee * r.hungerWeight * protHunger * (prot?.weight ?? 0);
      const top = Math.max(foodTerm, rivalTerm, protectTerm, feud);
      bestReason = top === 0 || top === foodTerm ? 'food' : top === feud ? 'feud' : top === rivalTerm ? 'rival' : 'protect';
    }
  }
  if (best) {
    a.target = best.id;
    a.targetReason = bestReason;
  }
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
  t.hitsTaken++;
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
    else {
      t.target = a.id;
      t.targetReason = 'defend';
    }
  }
};

/**
 * Conception. Genes are fixed now; each embryo inherits separately. The father pays his share of
 * the children's starting energy now (fewer embryos if he cannot afford them all); the mother pays
 * hers over the pregnancy. Returns false if not even one embryo is affordable.
 */
const conceive = (a: Actor, b: Actor, w: World, fx: EleEffects): boolean => {
  const r = w.rules;
  const mother = a.sex === 'F' ? a : b;
  const father = a.sex === 'F' ? b : a;
  // Ageing lowers fertility: conception fails with probability 1 − vigor(mother) × vigor(father).
  if (Math.random() > vigorOf(mother, r) * vigorOf(father, r) * fx.conception) {
    mother.cooldown = Math.max(mother.cooldown, r.rejectionCooldown);
    father.cooldown = Math.max(father.cooldown, r.rejectionCooldown);
    return false;
  }
  let n = 1;
  while (n < 4 && Math.random() < r.multipleBirthRate) n++;

  let surname: string;
  switch (r.surnameRule) {
    case 'mother': surname = mother.surname; break;
    case 'father': surname = father.surname; break;
    case 'stronger': surname = mother.energy >= father.energy ? mother.surname : father.surname; break;
    default: surname = Math.random() < 0.5 ? mother.surname : father.surname;
  }

  const embryos: Embryo[] = [];
  for (let i = 0; i < n; i++) {
    const { genome, dominance } = inherit(mother, father, r.inheritanceNoise, r.mutationScale * fx.mutation);
    embryos.push({
      genome,
      dominance,
      ancestry: mixAncestry(mother.ancestry, father.ancestry, r.ancestrySegments ?? 0),
      sex: Math.random() < 0.5 ? 'F' : 'M',
      surname,
      energy: r.offspringEnergy * r.energyPerSize * genome.size,
    });
  }
  const fatherShare = (list: Embryo[]) => list.reduce((s, e) => s + e.energy, 0) * (1 - r.parentalCostSplit);
  while (embryos.length && father.energy <= fatherShare(embryos)) embryos.pop();
  if (!embryos.length) return false;

  const total = embryos.reduce((s, e) => s + e.energy, 0);
  father.energy -= fatherShare(embryos);
  mother.lonely = father.lonely = 0;
  mother.pregnancy = {
    father: father.id,
    due: w.tick + r.gestationTicks,
    generation: Math.max(mother.generation, father.generation) + 1,
    embryos,
    fatherPaid: fatherShare(embryos),
    motherNeed: total * r.parentalCostSplit,
    motherPaid: 0,
  };
  // The female cooldown counts from mating and includes the pregnancy.
  mother.cooldown = Math.max(r.gestationTicks, r.mateCooldown);
  father.cooldown = r.maleMateCooldown ?? r.mateCooldown;
  mother.mateTarget = father.mateTarget = null;
  // Marriage: a couple without spouses may marry; a husband always guards his pregnant wife.
  if (mother.spouse === null && father.spouse === null && Math.random() < (r.marriageRate ?? 0)) {
    mother.spouse = father.id;
    father.spouse = mother.id;
    mother.marriedAt = father.marriedAt = w.tick;
    mother.widowOf = father.widowOf = null;
  }
  for (const [x, y] of [[mother, father], [father, mother]] as const) if (x.spouse !== null && x.spouse !== y.id) x.affairs = (x.affairs ?? 0) + 1;
  mother.lastConception = father.lastConception = w.tick;
  if (father.spouse === mother.id || Math.random() < r.paternalCare) father.caresFor = mother.id;
  return true;
};

/** Births at the end of a pregnancy. The energy paid by both parents is split by each child's need. */
const deliver = (ctx: TickContext, mother: Actor): Actor[] => {
  const w = ctx.w;
  const p = mother.pregnancy!;
  mother.pregnancy = null;
  const r = w.rules;
  const need = p.embryos.reduce((s, e) => s + e.energy, 0);
  const paid = p.fatherPaid + p.motherPaid;
  const n = p.embryos.length;
  // Childbirth risks grow with the number of children and with too little energy.
  const motherShare = Math.min(1, mother.energy / capacityOf(mother, r));
  const paidShare = need > 0 ? Math.min(1, paid / need) : 1;
  const motherRisk = r.birthRisk * n * (1 + 2 * (1 - motherShare));
  const childRisk = r.birthRisk * n * (1 + 2 * (1 - paidShare));
  const born = p.embryos.filter(() => Math.random() >= childRisk);
  // Lactational infertility: no new pregnancy until the nursing period is over.
  mother.cooldown = Math.max(mother.cooldown, r.nursingTicks ?? 0);
  ctx.losses += n - born.length;
  if (Math.random() < motherRisk) ctx.die(mother, 'childbirth');
  return born.map((e) => {
    const angle = rand(0, Math.PI * 2);
    const child: Actor = {
      id: w.nextId++,
      given: givenName(e.sex),
      surname: e.surname,
      sex: e.sex,
      generation: p.generation,
      parents: [mother.id, p.father],
      genome: e.genome,
      dominance: e.dominance,
      ancestry: e.ancestry,
      culture: mother.culture ?? null,
      x: clamp(mother.x + Math.cos(angle) * 4, 0, w.width),
      y: clamp(mother.y + Math.sin(angle) * 4, 0, w.height),
      vx: 0,
      vy: 0,
      wander: angle,
      energy: need > 0 ? (paid * e.energy) / need : 0,
      age: 0,
      cooldown: e.sex === 'F' ? r.mateCooldown : (r.maleMateCooldown ?? r.mateCooldown),
      born: w.tick,
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
    child.hp = maxHpOf(child, r);
    return child;
  });
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

  if (!w.diseases) w.diseases = [];
  if (!w.events) w.events = [];
  maybeOutbreak(w);
  if (Math.random() < (rules.eleRate ?? 0)) {
    const key = pickEle(rules.eleWeights ?? {});
    if (key) createEle(w, key, false);
  }
  const ctx = new TickContext(w, parentsOf);
  applyEles(
    w,
    (id) => {
      const a = ctx.byId.get(id);
      if (a) ctx.die(a, 'catastrophe');
    },
    (id, dmg) => {
      const a = ctx.byId.get(id);
      if (!a || ctx.dead.has(a.id)) return;
      a.hp -= dmg;
      a.flash = FLASH_TICKS;
      if (a.hp <= 0) ctx.die(a, 'catastrophe');
    },
  );
  ctx.fx = eleEffects(w);
  regrowFood(w, ctx.fx);
  stepCultures(w, (a, r) => ctx.hash.near(a.x, a.y, r), (id) => ctx.dead.has(id));
  if (w.carcasses?.length) {
    const decay = rules.carrionDecay ?? 0;
    w.carcasses = w.carcasses.filter((c) => (c.energy -= decay) > 0);
  }
  stepMachines(
    w,
    w.actors.filter((a) => !ctx.dead.has(a.id)),
    (a, dmg) => {
      a.hp -= dmg;
      a.flash = FLASH_TICKS;
      a.damageTaken += dmg;
      a.hitsTaken++;
      if (a.hp <= 0) ctx.die(a, 'catastrophe');
    },
  );
  const births: Actor[] = [];

  for (const a of shuffle([...w.actors])) {
    if (ctx.dead.has(a.id)) continue;
    a.age++;
    a.cooldown--;
    a.attackCd--;
    if (a.flash > 0) a.flash--;
    if (a.court && --a.court.ttl <= 0) a.court = null;
    if (a.snub !== null && --a.snubTtl <= 0) a.snub = null;
    const cap = capacityOf(a, rules);
    const radius = radiusOf(a);
    const illness = progressInfection(a, ctx.hash.near(a.x, a.y, rules.contagionRadius), w, (id) => ctx.dead.has(id));
    const vision = visionOf(a, w);
    const maxSpeed = speedOf(a, w);

    // 1. Conflict state: drop lost targets, count down fleeing, decide whether to flee.
    let target = ctx.alive(a.target);
    if (target) {
      const d = Math.hypot(target.x - a.x, target.y - a.y);
      if (d > vision * 1.5 || (target.fleeing > 0 && Math.random() < rules.pursuitGiveUp)) target = undefined;
    }
    a.target = target?.id ?? null;
    if (a.target === null) a.targetReason = null;
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

    // A caring father stops caring when the mother is gone or no longer carries his children.
    let care = ctx.alive(a.caresFor);
    if (a.caresFor !== null && (!care || care.pregnancy?.father !== a.id)) {
      a.caresFor = null;
      care = undefined;
    }

    // A nursing child stays with its mother.
    const nursingMother = a.age < (rules.nursingTicks ?? 0) && a.parents ? ctx.alive(a.parents[0]) : undefined;

    // Marriage: widowhood when the spouse is gone; rare divorce after a long time without children.
    let spouse = ctx.alive(a.spouse);
    if (a.spouse !== null && !spouse) {
      a.widowOf = a.spouse;
      a.spouse = null;
    } else if (spouse && rules.divorceAfter > 0 && w.tick - Math.max(a.marriedAt ?? 0, a.lastConception ?? 0) > rules.divorceAfter && Math.random() < 0.001) {
      spouse.spouse = null;
      a.spouse = null;
      spouse = undefined;
    }

    // 2. Choose what to do: flee > fight > join a fight > attack > guard > nurse > mate > eat > wander.
    const food = a.fleeing > 0 ? null : seekFood(a, w, vision);
    // Thirst: drink when next to water; go looking for water when running low.
    if (a.hydration === undefined) a.hydration = 1;
    const thirstGoal = ctx.hasWater && a.hydration < THIRSTY && !nursingMother ? seekWater(a, w, vision) : null;
    // Shelter: in harsh cold (deep winter or ice nearby) weak actors head for the nearest cave they know of (2 × vision).
    const inShelter = shelterAt(w, a.x, a.y) !== undefined;
    const harsh = ctx.season < 0.75 || ctx.fx.costFactor(a.x, a.y) > 1;
    const shelterGoal =
      !thirstGoal && !inShelter && harsh && !nursingMother && a.energy < 0.6 * cap ? seekShelter(a, w, vision * 2) : null;
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
    } else if (thirstGoal) {
      goal = thirstGoal;
      speed = maxSpeed;
    } else if (shelterGoal) {
      goal = shelterGoal;
      speed = maxSpeed;
    } else if (care && Math.hypot(care.x - a.x, care.y - a.y) > rules.guardDistance) {
      goal = care;
      speed = maxSpeed;
    } else if (spouse && Math.hypot(spouse.x - a.x, spouse.y - a.y) > 2 * rules.guardDistance && a.energy > 0.4 * cap && !food) {
      // Spouses keep together when there is nothing more pressing.
      goal = spouse;
    } else if (nursingMother) {
      // A nursing child eats only food close to its mother; otherwise it stays with her.
      const nearFood = food && Math.hypot(food.x - nursingMother.x, food.y - nursingMother.y) <= 25 ? food : null;
      goal = nearFood ?? nursingMother;
      if (goal === nursingMother && Math.hypot(nursingMother.x - a.x, nursingMother.y - a.y) > 15) speed = maxSpeed;
    } else {
      const ready = readyToMate(a, w);
      const found = ready ? findPartner(ctx, a, vision) : { mate: null, prospect: null };
      mate = found.mate;
      a.lonely = ready && !mate ? (a.lonely ?? 0) + 1 : ready ? (a.lonely ?? 0) : 0;
      // Ready but no partner ready in sight: approach an acceptable prospect, else explore.
      // Both count as courting (shown as the dashed partner line, and used to detect rivals).
      a.mateTarget = (mate ?? found.prospect)?.id ?? null;
      goal = mate ?? found.prospect ?? (ready ? null : food);
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
      if (!target && goal !== care && !(goal === nursingMother && speed > 0)) speed = maxSpeed * Math.min(1, dist / w.cellSize);
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
    const px = a.x;
    const py = a.y;
    a.x += a.vx;
    a.y += a.vy;
    // Water cannot be walked on: slide along the shore (keep the dry axis), else stop and turn.
    if (ctx.hasWater && isWater(w, a.x, a.y)) {
      if (!isWater(w, px + a.vx, py)) {
        a.y = py;
        a.vy = 0;
      } else if (!isWater(w, px, py + a.vy)) {
        a.x = px;
        a.vx = 0;
      } else {
        a.x = px;
        a.y = py;
        a.vx = a.vy = 0;
        a.wander += Math.PI / 2 + gaussian() * 0.5;
      }
    }
    a.distance += Math.hypot(a.x - px, a.y - py);
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
    if (ctx.hasWater && isWater(w, a.x, a.y)) {
      a.x = px;
      a.y = py;
    }
    if (ctx.hasWater) {
      if (nursingMother) a.hydration = 1;
      else if (nearWater(w, a.x, a.y, radius + w.cellSize * 0.75)) a.hydration = Math.min(1, a.hydration + 0.1);
      else a.hydration -= rules.thirstRate ?? 0;
    }

    // 4. Energy cost and healing.
    const sp2 = a.vx * a.vx + a.vy * a.vy;
    a.energy -=
      rules.baseCost *
        a.genome.size *
        (1 + (rules.agingFactor * bioAge(a)) / 1000) *
        // Cold (ice, winter) costs extra outside shelter.
        (shelterAt(w, a.x, a.y) ? 1 : ctx.fx.costFactor(a.x, a.y) * (1 + (rules.coldCost ?? 0) * Math.max(0, 1 - ctx.season))) +
      rules.moveCost * a.genome.size * sp2 +
      (illness ? rules.sicknessCost * a.genome.size : 0);
    const maxHp = maxHpOf(a, rules);
    if (a.hp < maxHp && a.energy > cap / 2) {
      const h = Math.min(maxHp - a.hp, rules.healRate * maxHp);
      a.hp += h;
      a.energy -= h * rules.healCost;
    }

    // 5. Eat from the current cell, and from a carcass within reach.
    const ci = cellIndex(w, a.x, a.y);
    if (w.food[ci] && a.energy < cap) {
      a.energy = Math.min(cap, a.energy + foodGain(w.food[ci], a, rules));
      w.food[ci] = 0;
      a.foodEaten++;
    }
    if (a.energy < cap && w.carcasses?.length) {
      for (const c of w.carcasses) {
        if (c.energy <= 0 || (c.x - a.x) ** 2 + (c.y - a.y) ** 2 > (radius + 3) ** 2) continue;
        const bite = Math.min(rules.carrionBite ?? 0, c.energy, cap - a.energy);
        c.energy -= bite;
        a.energy += bite;
        if (bite > 0) a.foodEaten++;
        break;
      }
    }

    // Nursing: the child draws energy from its mother when close, not full, and she can spare it.
    if (nursingMother && Math.hypot(nursingMother.x - a.x, nursingMother.y - a.y) <= 30) {
      const mCap = capacityOf(nursingMother, rules);
      const take = Math.min(rules.nursingRate ?? 0, cap - a.energy, nursingMother.energy - 0.2 * mCap);
      if (take > 0) {
        nursingMother.energy -= take;
        a.energy += take * 0.8;
      }
    }

    // Pregnancy: the mother pays her share evenly over the remaining ticks, then gives birth.
    const preg = a.pregnancy;
    if (preg) {
      const remaining = preg.motherNeed - preg.motherPaid;
      const pay = remaining / Math.max(1, preg.due - w.tick + 1);
      a.energy -= pay;
      preg.motherPaid += pay;
      if (w.tick >= preg.due && a.energy > 0) births.push(...deliver(ctx, a));
    }

    // Culture members share with members in need nearby, as much as the culture's sharing trait says.
    const myCulture = ctx.culture(a);
    if (myCulture && myCulture.sharing > 0 && a.energy > 0.7 * cap) {
      for (const b of ctx.hash.near(a.x, a.y, 15)) {
        if (b === a || b.culture !== a.culture || ctx.dead.has(b.id)) continue;
        const bCap = capacityOf(b, rules);
        if (b.energy >= 0.3 * bCap) continue;
        const give = Math.min(rules.provisionRate * myCulture.sharing, a.energy - 0.7 * cap, 0.3 * bCap - b.energy);
        if (give > 0) {
          a.energy -= give;
          b.energy += give * 0.9;
        }
        break;
      }
    }

    // Spouses share energy when one is low and the other can spare it.
    if (spouse && Math.hypot(spouse.x - a.x, spouse.y - a.y) <= rules.guardDistance) {
      const sCap = capacityOf(spouse, rules);
      if (spouse.energy < 0.4 * sCap && a.energy > 0.6 * cap) {
        const give = Math.min(rules.provisionRate, a.energy - 0.6 * cap, 0.4 * sCap - spouse.energy);
        if (give > 0) {
          a.energy -= give;
          spouse.energy += give * 0.9;
        }
      }
    }

    // The caring father, and relatives in proportion to kin weight, share energy with a pregnant
    // female within guard distance when she needs it and they can spare it.
    const helped = ctx.protectee(a, vision);
    if (helped && Math.hypot(helped.p.x - a.x, helped.p.y - a.y) <= rules.guardDistance) {
      const hp = helped.p;
      const give = Math.min(rules.provisionRate * helped.weight, a.energy - cap / 2, capacityOf(hp, rules) * 0.8 - hp.energy);
      if (give > 0) {
        a.energy -= give;
        hp.energy += give * 0.9;
      }
    }

    // 6. Strike the target, or mate on contact.
    if (target && !ctx.dead.has(target.id) && a.attackCd <= 0 && Math.hypot(target.x - a.x, target.y - a.y) <= radius + radiusOf(target) + rules.attackReach) {
      strike(ctx, a, target);
    } else if (mate && Math.hypot(mate.x - a.x, mate.y - a.y) <= radius + radiusOf(mate) + 1 && readyToMate(a, w) && readyToMate(mate, w)) {
      if (courtship(ctx, a, mate)) conceive(a, mate, w, ctx.fx);
    }

    // Machines (ELE) next to the actor: strike them when free to.
    if (!target && w.machines?.length) strikeMachine(w, a, strengthOf(a, w), radius + MACHINE_SIZE + rules.attackReach);

    // 7. Death: starvation, ageing (rising risk), frailty from low energy, infancy.
    if (!ctx.dead.has(a.id)) {
      const ageRisk = rules.agingHazard * 2 ** (bioAge(a) / Math.max(1, rules.agingDoubling));
      const share = a.energy / cap;
      const frailRisk =
        share < rules.frailtyThreshold ? rules.frailtyHazard * (1 - share / Math.max(1e-9, rules.frailtyThreshold)) : 0;
      let infantRisk = 0;
      if (a.age < rules.infancyTicks) {
        infantRisk = rules.infantHazard * (1 - a.age / rules.infancyTicks);
        const parentNear = (a.parents ?? []).some((pid) => {
          const p = ctx.alive(pid);
          return p !== undefined && Math.hypot(p.x - a.x, p.y - a.y) <= 40;
        });
        if (parentNear) infantRisk *= 0.3;
      }
      const diseaseRisk = illness
        ? (shelterAt(w, a.x, a.y) ? 0.5 : 1) *
          illness.lethality *
          (1 + 2 * (1 - ageVigorOf(a, rules)) + (1 - Math.max(0, a.hp) / maxHpOf(a, rules)) + (1 - Math.min(1, Math.max(0, share))))
        : 0;
      if (a.energy <= 0) ctx.die(a, 'starvation');
      else if (ctx.hasWater && a.hydration <= 0) ctx.die(a, 'thirst');
      else if (illness && Math.random() < diseaseRisk) {
        illness.deaths++;
        ctx.die(a, 'disease', undefined, illness.id);
      }
      else if (a.age >= rules.maxAge || Math.random() < ageRisk) ctx.die(a, 'age');
      else if (Math.random() < frailRisk) ctx.die(a, 'starvation');
      else if (Math.random() < infantRisk) ctx.die(a, 'infant');
    }
  }

  // Deaths while a catastrophe is active count towards it.
  const counted = ctx.deaths.filter((d) => d.cause !== 'removed').length;
  if (counted) for (const e of activeEles(w)) e.deaths += counted;
  let pregnancyLosses = ctx.losses;
  if (ctx.dead.size) {
    for (const a of w.actors) if (ctx.dead.has(a.id) && a.pregnancy) pregnancyLosses += a.pregnancy.embryos.length;
    w.actors = w.actors.filter((a) => !ctx.dead.has(a.id));
  }
  if (births.length) w.actors.push(...births);
  return { births, deaths: ctx.deaths, hits: ctx.hits, pregnancyLosses };
};
