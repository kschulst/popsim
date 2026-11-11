import { clamp, gaussian, rand } from './random';
import type { Actor, EleEvent, Machine, World } from './types';

/**
 * Machine awakening (ELE): grey machines that harvest food, build more machines from the energy,
 * and attack actors in their way. Actors strike back; the more of them around a machine, the
 * faster it breaks. Machines are not actors: no kin, tribe or genealogy.
 */

const SPEED = 1.4;
const VISION = 90;
const REACH = 7;
const BUILD_ENERGY = 120;
/** Machines per unit of severity. */
const MAX_MACHINES = 60;
const ATTACK_EVERY = 15;
/** Energy a machine burns per tick; out of energy, it stops for good. */
const UPKEEP = 0.25;
export const MACHINE_SIZE = 4;

/** Spawns the first machines of an awakening around a random point. */
export const spawnMachines = (w: World, e: EleEvent): void => {
  if (!w.machines) w.machines = [];
  const x = rand(0.15, 0.85) * w.width;
  const y = rand(0.15, 0.85) * w.height;
  e.x = x;
  e.y = y;
  const n = Math.max(1, Math.round(3 * e.severity));
  for (let i = 0; i < n; i++) addMachine(w, e, x + gaussian() * 15, y + gaussian() * 15, 60);
};

const addMachine = (w: World, e: EleEvent, x: number, y: number, energy: number): void => {
  w.machines.push({
    id: w.machineSeq = (w.machineSeq ?? 0) + 1,
    event: e.id,
    x: clamp(x, 4, w.width - 4),
    y: clamp(y, 4, w.height - 4),
    heading: rand(0, Math.PI * 2),
    energy,
    hp: 80 * e.severity,
    cd: 0,
  });
};

const nearestFood = (w: World, m: Machine): { x: number; y: number } | null => {
  const { cellSize, cols, rows, food } = w;
  const r = Math.ceil(VISION / cellSize);
  const cx0 = Math.floor(m.x / cellSize);
  const cy0 = Math.floor(m.y / cellSize);
  let best = Infinity;
  let out: { x: number; y: number } | null = null;
  for (let cy = Math.max(0, cy0 - r); cy <= Math.min(rows - 1, cy0 + r); cy++) {
    for (let cx = Math.max(0, cx0 - r); cx <= Math.min(cols - 1, cx0 + r); cx++) {
      if (!food[cy * cols + cx]) continue;
      const x = (cx + 0.5) * cellSize;
      const y = (cy + 0.5) * cellSize;
      const d = (x - m.x) ** 2 + (y - m.y) ** 2;
      if (d < best) {
        best = d;
        out = { x, y };
      }
    }
  }
  return out;
};

/**
 * One tick for all machines: move to food (or wander), eat, build, and strike the nearest actor
 * within reach. `actors` are the living actors; `hurt` applies damage through step()'s bookkeeping.
 */
export const stepMachines = (w: World, actors: Actor[], hurt: (a: Actor, damage: number) => void): void => {
  if (!w.machines?.length) return;
  const events = new Map((w.events ?? []).map((e) => [e.id, e]));
  // Shut down machines whose awakening has run out.
  w.machines = w.machines.filter((m) => {
    const e = events.get(m.event);
    return m.hp > 0 && m.energy > 0 && e !== undefined && w.tick < e.end;
  });
  // An awakening ends early once all its machines are destroyed.
  for (const e of events.values()) {
    if (e.key === 'machines' && e.applied && w.tick < e.end && !w.machines.some((m) => m.event === e.id)) e.end = w.tick;
  }
  const born: [EleEvent, number, number][] = [];
  for (const m of w.machines) {
    const e = events.get(m.event)!;
    m.cd--;
    m.energy -= UPKEEP;
    // Strike the nearest actor in reach.
    let victim: Actor | null = null;
    let vd = REACH * REACH;
    for (const a of actors) {
      const d = (a.x - m.x) ** 2 + (a.y - m.y) ** 2;
      if (d < vd) {
        vd = d;
        victim = a;
      }
    }
    if (victim && m.cd <= 0) {
      m.cd = ATTACK_EVERY;
      hurt(victim, 8 * e.severity * Math.exp(gaussian() * 0.4));
    }
    // Move towards food, or wander.
    const food = nearestFood(w, m);
    if (food) m.heading = Math.atan2(food.y - m.y, food.x - m.x);
    else m.heading += gaussian() * 0.3;
    m.x = clamp(m.x + Math.cos(m.heading) * SPEED, 4, w.width - 4);
    m.y = clamp(m.y + Math.sin(m.heading) * SPEED, 4, w.height - 4);
    const ci = clamp(Math.floor(m.y / w.cellSize), 0, w.rows - 1) * w.cols + clamp(Math.floor(m.x / w.cellSize), 0, w.cols - 1);
    if (w.food[ci]) {
      w.food[ci] = 0;
      m.energy += w.rules.foodEnergy;
    }
    // Build a new machine from surplus energy.
    if (m.energy >= BUILD_ENERGY && w.machines.length + born.length < MAX_MACHINES * e.severity) {
      m.energy -= BUILD_ENERGY / 2;
      born.push([e, m.x + gaussian() * 6, m.y + gaussian() * 6]);
    }
  }
  for (const [e, x, y] of born) addMachine(w, e, x, y, BUILD_ENERGY / 2);
};

/**
 * Actors strike machines next to them: those that were hit recently fight back, and aggressive ones
 * attack on their own. Uses the actor's normal attack cooldown. Returns true if it struck.
 */
export const strikeMachine = (w: World, a: Actor, strength: number, reach: number): boolean => {
  if (!w.machines?.length || a.attackCd > 0) return false;
  for (const m of w.machines) {
    if (m.hp <= 0) continue;
    if ((m.x - a.x) ** 2 + (m.y - a.y) ** 2 > reach * reach) continue;
    if (a.genome.aggression < 0.3 && a.flash <= 0) continue;
    m.hp -= w.rules.damageScale * strength * Math.exp(gaussian() * 0.5);
    a.attackCd = w.rules.attackCooldown;
    return true;
  }
  return false;
};
