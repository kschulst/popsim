import { newDisease, infect } from './disease';
import { clamp, gaussian, pick, rand } from './random';
import type { EleEvent, EleKey, World } from './types';

/**
 * Extinction level events (ELEs): very rare catastrophes, or released by hand. An event is created
 * with `applied: false`; its immediate effects (meteor impact, pandemic) run at the start of the
 * next tick inside step(), so deaths go through the normal death bookkeeping. Ongoing effects are
 * read each tick through `eleEffects`.
 */

export interface EleDef {
  name: string;
  icon: string;
  description: string;
  /** Duration range in ticks at severity 1. */
  duration: [number, number];
}

export const ELE_KEYS: EleKey[] = ['meteor', 'volcano', 'plague', 'iceAge', 'locusts', 'drought', 'infertility', 'radiation', 'rage'];

export const ELE_DEFS: Record<EleKey, EleDef> = {
  meteor: {
    name: 'Meteornedslag',
    icon: '☄',
    description: 'Alle innenfor krateret dør, sjokkbølgen skader dem rundt. Krateret blir goldt og gror sakte igjen. Støvvinter: all matvekst faller 70 % og hentes gradvis inn.',
    duration: [300, 800],
  },
  volcano: {
    name: 'Supervulkan',
    icon: '🌋',
    description: 'Askesky over hele verden: matveksten faller 90 % og hentes gradvis inn igjen.',
    duration: [1000, 2000],
  },
  plague: {
    name: 'Den store pesten',
    icon: '☠',
    description: 'En pandemi med svært høy smitte og dødelighet bryter ut i flere aktører samtidig.',
    duration: [600, 1200],
  },
  iceAge: {
    name: 'Istid',
    icon: '❄',
    description: 'Isen brer seg fra én kant over opptil 60 % av verden. Under isen gror nesten ingenting og kulden koster tre ganger så mye energi. Så trekker isen seg tilbake.',
    duration: [2000, 5000],
  },
  locusts: {
    name: 'Gresshoppesverm',
    icon: '🦗',
    description: 'En sverm vandrer over kartet og spiser all mat der den går.',
    duration: [200, 500],
  },
  drought: {
    name: 'Megatørke',
    icon: '☀',
    description: 'Mat sprer seg ikke fra naboruter, og spontan vekst halveres.',
    duration: [500, 1500],
  },
  infertility: {
    name: 'Ufruktbarhetsplage',
    icon: '⚘',
    description: 'Sjansen for unnfangelse faller 95 %.',
    duration: [300, 800],
  },
  radiation: {
    name: 'Strålingsstorm',
    icon: '☢',
    description: 'Mutasjonsstyrken ganges med 10: rask og kaotisk evolusjon.',
    duration: [200, 400],
  },
  rage: {
    name: 'Raseri',
    icon: '🔥',
    description: 'Alle oppfører seg som om de har maks aggresjon, og lojalitet mot stamme og slekt halveres.',
    duration: [100, 300],
  },
};

const PLAGUE_NAMES = ['Svartedauden', 'Den grå død', 'Blodpesten', 'Den store farsotten', 'Røde død', 'Kvelersyken'];

/** Picks an ELE key by the configured weights, or null if all weights are 0. */
export const pickEle = (weights: Partial<Record<EleKey, number>>): EleKey | null => {
  const entries = ELE_KEYS.map((k) => [k, Math.max(0, weights[k] ?? 1)] as const).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    if ((r -= v) <= 0) return k;
  }
  return entries[entries.length - 1][0];
};

/**
 * Creates an event (effects start next tick). `at` places a meteor; otherwise random.
 * Severity scales durations, radii and strength.
 */
export const createEle = (w: World, key: EleKey, manual: boolean, at?: { x: number; y: number }): EleEvent => {
  const sev = clamp(w.rules.eleSeverity ?? 1, 0.1, 5);
  const def = ELE_DEFS[key];
  const duration = Math.round(rand(def.duration[0], def.duration[1]) * Math.sqrt(sev));
  const ev: EleEvent = {
    id: w.events.length,
    key,
    name: key === 'plague' ? pick(PLAGUE_NAMES) : def.name,
    tick: w.tick + 1,
    end: w.tick + 1 + duration,
    manual,
    severity: sev,
    applied: false,
    popBefore: w.actors.length,
    popAfter: null,
    deaths: 0,
  };
  if (key === 'meteor') {
    ev.x = at?.x ?? rand(0.1, 0.9) * w.width;
    ev.y = at?.y ?? rand(0.1, 0.9) * w.height;
    ev.radius = 45 * Math.sqrt(sev);
  }
  if (key === 'iceAge') ev.edge = pick(['N', 'S', 'E', 'W'] as const);
  if (key === 'locusts') {
    ev.x = rand(0, w.width);
    ev.y = rand(0, w.height);
    ev.radius = 50 * Math.sqrt(sev);
    const a = rand(0, Math.PI * 2);
    ev.vx = Math.cos(a) * 1.5;
    ev.vy = Math.sin(a) * 1.5;
  }
  w.events.push(ev);
  return ev;
};

export const activeEles = (w: World): EleEvent[] => (w.events ?? []).filter((e) => e.applied && w.tick < e.end);

/** 0 → 1 progress through the event. */
const progress = (w: World, e: EleEvent) => clamp((w.tick - e.tick) / Math.max(1, e.end - e.tick), 0, 1);

/** Ice coverage of the map (0–0.6 × severity factor): advances over the first 40 %, holds, retreats over the last 30 %. */
export const iceCover = (w: World, e: EleEvent): number => {
  const p = progress(w, e);
  const max = clamp(0.6 * Math.sqrt(e.severity), 0, 0.9);
  if (p < 0.4) return (max * p) / 0.4;
  if (p < 0.7) return max;
  return (max * (1 - p)) / 0.3;
};

/** True if (x, y) is under the ice of event e. */
export const underIce = (w: World, e: EleEvent, x: number, y: number): boolean => {
  const c = iceCover(w, e);
  switch (e.edge) {
    case 'N': return y < c * w.height;
    case 'S': return y > (1 - c) * w.height;
    case 'W': return x < c * w.width;
    default: return x > (1 - c) * w.width;
  }
};

/** Global modifiers from all active events, read by step(). */
export interface EleEffects {
  /** Multiplier on all food growth. */
  growth: number;
  /** Multiplier on spread from neighbours. */
  spread: number;
  /** Multiplier on spontaneous growth. */
  spontaneous: number;
  conception: number;
  mutation: number;
  rage: boolean;
  /** Per-cell fertility multiplier, or null when no spatial event is active. */
  cellFactor: ((x: number, y: number) => number) | null;
  /** Energy cost multiplier at a position (ice). */
  costFactor: (x: number, y: number) => number;
}

export const eleEffects = (w: World): EleEffects => {
  const fx: EleEffects = {
    growth: 1,
    spread: 1,
    spontaneous: 1,
    conception: 1,
    mutation: 1,
    rage: false,
    cellFactor: null,
    costFactor: () => 1,
  };
  const spatial: ((x: number, y: number) => number)[] = [];
  const ices: EleEvent[] = [];
  for (const e of activeEles(w)) {
    const p = progress(w, e);
    const s = e.severity;
    switch (e.key) {
      case 'meteor': {
        // Dust winter: growth −70 % (× severity), recovering linearly; crater barren, recovering.
        fx.growth *= 1 - clamp(0.7 * s, 0, 0.98) * (1 - p);
        const r = e.radius!;
        spatial.push((x, y) => ((x - e.x!) ** 2 + (y - e.y!) ** 2 < r * r ? p * p : 1));
        break;
      }
      case 'volcano':
        fx.growth *= 1 - clamp(0.9 * s, 0, 0.99) * (1 - p) ** 0.5;
        break;
      case 'drought':
        fx.spread = 0;
        fx.spontaneous *= 0.5;
        break;
      case 'infertility':
        fx.conception *= 1 - clamp(0.95 * s, 0, 1);
        break;
      case 'radiation':
        fx.mutation *= 1 + 9 * s;
        break;
      case 'rage':
        fx.rage = true;
        break;
      case 'iceAge':
        ices.push(e);
        spatial.push((x, y) => (underIce(w, e, x, y) ? 0.02 : 1));
        break;
      default:
        break;
    }
  }
  if (spatial.length) fx.cellFactor = (x, y) => spatial.reduce((m, f) => m * f(x, y), 1);
  if (ices.length) fx.costFactor = (x, y) => (ices.some((e) => underIce(w, e, x, y)) ? 3 : 1);
  return fx;
};

/**
 * Immediate effects of events that start this tick. `kill` and `hurt` go through step()'s death
 * bookkeeping. Locust swarms move and eat every tick here as well.
 */
export const applyEles = (
  w: World,
  kill: (id: number) => void,
  hurt: (id: number, damage: number) => void,
): void => {
  for (const e of w.events ?? []) {
    if (!e.applied && w.tick >= e.tick) {
      e.applied = true;
      e.popBefore = w.actors.length;
      if (e.key === 'meteor') {
        const r = e.radius!;
        for (const a of w.actors) {
          const d = Math.hypot(a.x - e.x!, a.y - e.y!);
          if (d < r) kill(a.id);
          else if (d < 2.5 * r) hurt(a.id, 150 * e.severity * (1 - (d - r) / (1.5 * r)));
        }
        clearFood(w, e.x!, e.y!, r);
      }
      if (e.key === 'plague') {
        const d = newDisease(w, `${ELE_DEFS.plague.name} (katastrofe)`);
        d.name = e.name;
        d.contagion = clamp(0.25 * e.severity, 0.05, 0.6);
        d.lethality = clamp(0.02 * e.severity, 0.002, 0.2);
        d.duration = 200;
        d.immunity = 5000;
        d.color = '#ff3b3b';
        e.disease = d.id;
        const n = Math.min(w.actors.length, Math.max(1, Math.round(5 * e.severity)));
        for (let i = 0; i < n; i++) infect(pick(w.actors), d);
      }
    }
    if (e.key === 'locusts' && e.applied && w.tick < e.end) {
      // Random walk that turns back at the walls; eats all food under the swarm.
      const a = Math.atan2(e.vy!, e.vx!) + gaussian() * 0.15;
      e.vx = Math.cos(a) * 1.5;
      e.vy = Math.sin(a) * 1.5;
      e.x = e.x! + e.vx;
      e.y = e.y! + e.vy;
      if (e.x < 0 || e.x > w.width) e.vx = -e.vx;
      if (e.y < 0 || e.y > w.height) e.vy = -e.vy;
      e.x = clamp(e.x, 0, w.width);
      e.y = clamp(e.y, 0, w.height);
      clearFood(w, e.x, e.y, e.radius!);
    }
    if (e.applied && e.popAfter === null && w.tick >= e.end) e.popAfter = w.actors.length;
  }
};

const clearFood = (w: World, x: number, y: number, r: number): void => {
  const c0 = Math.max(0, Math.floor((x - r) / w.cellSize));
  const c1 = Math.min(w.cols - 1, Math.floor((x + r) / w.cellSize));
  const r0 = Math.max(0, Math.floor((y - r) / w.cellSize));
  const r1 = Math.min(w.rows - 1, Math.floor((y + r) / w.cellSize));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cx = (col + 0.5) * w.cellSize;
      const cy = (row + 0.5) * w.cellSize;
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) w.food[row * w.cols + col] = 0;
    }
  }
};
