import { recordOf, Registry } from '../sim/genealogy';
import { computeStats } from '../sim/stats';
import { step } from '../sim/step';
import type { TickStats, World } from '../sim/types';
import { cloneWorld } from '../sim/world';

export interface HistoryConfig {
  /** A full snapshot is kept every N ticks for the whole branch. */
  snapshotInterval: number;
  /** Number of most recent ticks kept at full per-tick resolution. */
  ringSize: number;
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = { snapshotInterval: 10, ringSize: 300 };

export interface Branch {
  id: number;
  name: string;
  parentId: number | null;
  /** Tick in the parent branch the branch starts from (0 for the root). */
  startTick: number;
  changes: string[];
  /** Rule changes made in place at the head of the branch (without forking). */
  ruleLog: { tick: number; text: string }[];
  createdAt: number;
  headTick: number;
  /** Live state at headTick. Simulation only advances from here. */
  head: World;
  snapshots: Map<number, World>;
  /** Per-tick states for the most recent ticks, ascending and contiguous. */
  ring: World[];
  registry: Registry;
  /** One row per tick from startTick + 1 to headTick. */
  stats: TickStats[];
}

/**
 * Copy of a world for storage. The fertility map is shared by reference: the simulation never
 * mutates it, and edits happen on a cloned draft that starts a new branch.
 */
const storedCopy = (w: World): World => {
  const { fertility, ...rest } = w;
  return { ...structuredClone(rest), fertility } as World;
};

export class History {
  readonly branches = new Map<number, Branch>();
  private nextBranchId = 0;

  constructor(readonly config: HistoryConfig = DEFAULT_HISTORY_CONFIG) {}

  createRoot(world: World, name = 'Hovedlinje'): Branch {
    const registry = new Registry(null, 0, 0);
    for (const a of world.actors) registry.add(recordOf(a));
    return this.addBranch({ name, parentId: null, startTick: world.tick, changes: [], world, registry });
  }

  /**
   * Starts a new branch from `fromTick` of branch `fromId`. `draft` is the (possibly edited)
   * state to start from; actors added in the draft are registered, removed ones are marked dead.
   */
  fork(fromId: number, fromTick: number, draft: World, changes: string[], name?: string): Branch {
    const parent = this.get(fromId);
    const original = this.stateAt(fromId, fromTick);
    const registry = new Registry(parent.registry, fromTick, original.nextId);
    const draftIds = new Set(draft.actors.map((a) => a.id));
    for (const a of draft.actors) {
      const existing = registry.get(a.id);
      if (!existing) registry.add(recordOf(a));
      else if (
        existing.sex !== a.sex ||
        JSON.stringify(existing.genome) !== JSON.stringify(a.genome) ||
        JSON.stringify(existing.dominance) !== JSON.stringify(a.dominance) ||
        JSON.stringify(existing.ancestry) !== JSON.stringify(a.ancestry)
      ) {
        registry.override({ ...recordOf(a), born: existing.born });
      }
    }
    for (const a of original.actors) {
      if (!draftIds.has(a.id)) registry.die(a.id, { tick: fromTick, cause: 'removed' });
    }
    return this.addBranch({
      name: name ?? `Gren ${this.nextBranchId}`,
      parentId: fromId,
      startTick: fromTick,
      changes,
      world: draft,
      registry,
    });
  }

  private addBranch(o: {
    name: string;
    parentId: number | null;
    startTick: number;
    changes: string[];
    world: World;
    registry: Registry;
  }): Branch {
    const head = cloneWorld(o.world);
    const b: Branch = {
      id: this.nextBranchId++,
      name: o.name,
      parentId: o.parentId,
      startTick: o.startTick,
      changes: o.changes,
      createdAt: Date.now(),
      headTick: head.tick,
      head,
      snapshots: new Map([[head.tick, storedCopy(head)]]),
      ring: [storedCopy(head)],
      registry: o.registry,
      stats: [],
      ruleLog: [],
    };
    this.branches.set(b.id, b);
    return b;
  }

  /**
   * Changes the rules at the head of a branch without forking. The stored states for the head
   * tick are updated too, so the change shows immediately; earlier states keep their old rules.
   */
  amendRules(id: number, apply: (r: World['rules']) => void, text: string): void {
    const b = this.get(id);
    apply(b.head.rules);
    const last = b.ring[b.ring.length - 1];
    if (last?.tick === b.headTick) apply(last.rules);
    const snap = b.snapshots.get(b.headTick);
    if (snap && snap !== last) apply(snap.rules);
    b.ruleLog.push({ tick: b.headTick, text });
  }

  /**
   * Changes the head state of a branch in place (e.g. starting a catastrophe). The stored copies
   * of the head tick are replaced so the change shows immediately.
   */
  amendHead(id: number, apply: (w: World) => void): void {
    const b = this.get(id);
    apply(b.head);
    const copy = storedCopy(b.head);
    const last = b.ring[b.ring.length - 1];
    if (last?.tick === b.headTick) b.ring[b.ring.length - 1] = copy;
    if (b.snapshots.has(b.headTick)) b.snapshots.set(b.headTick, copy);
  }

  /** Inserts a fully built branch (used by import). */
  restore(b: Branch): void {
    this.branches.set(b.id, b);
    this.nextBranchId = Math.max(this.nextBranchId, b.id + 1);
  }

  get(id: number): Branch {
    const b = this.branches.get(id);
    if (!b) throw new Error(`Unknown branch ${id}`);
    return b;
  }

  /** Simulates one tick at the head of the branch. */
  advance(id: number): void {
    const b = this.get(id);
    const reg = b.registry;
    const ev = step(b.head, (aid) => reg.get(aid)?.parents);
    for (const c of ev.births) reg.add(recordOf(c));
    for (const d of ev.deaths) reg.die(d.id, { tick: b.head.tick, cause: d.cause, killer: d.killer, disease: d.disease, tally: d.tally });
    b.headTick = b.head.tick;
    b.stats.push(computeStats(b.head, ev));
    const copy = storedCopy(b.head);
    b.ring.push(copy);
    if (b.ring.length > this.config.ringSize) b.ring.shift();
    if (b.headTick % this.config.snapshotInterval === 0) b.snapshots.set(b.headTick, copy);
  }

  /** Frees per-tick memory for every branch except `keepId`. Snapshots and heads are kept. */
  trimRings(keepId: number): void {
    for (const b of this.branches.values()) {
      if (b.id !== keepId && b.ring.length > 1) b.ring = [b.ring[b.ring.length - 1]];
    }
  }

  private ringAt(b: Branch, tick: number): World | undefined {
    if (!b.ring.length) return undefined;
    const i = tick - b.ring[0].tick;
    return i >= 0 && i < b.ring.length ? b.ring[i] : undefined;
  }

  /** True if the exact state at `tick` is stored. */
  has(id: number, tick: number): boolean {
    const b = this.get(id);
    return !!this.ringAt(b, tick) || b.snapshots.has(tick);
  }

  /**
   * Stored state at `tick`, or the closest stored state before it. The returned object is shared;
   * clone it before mutating.
   */
  stateAt(id: number, tick: number): World {
    const b = this.get(id);
    const t = Math.max(b.startTick, Math.min(tick, b.headTick));
    const exact = this.ringAt(b, t) ?? b.snapshots.get(t);
    if (exact) return exact;
    let bestTick = b.startTick;
    for (const st of b.snapshots.keys()) if (st <= t && st > bestTick) bestTick = st;
    return b.snapshots.get(bestTick)!;
  }

  /** Closest stored tick before `tick`, or undefined at the start of the branch. */
  prevTick(id: number, tick: number): number | undefined {
    const b = this.get(id);
    if (tick <= b.startTick) return undefined;
    if (this.ringAt(b, tick - 1)) return tick - 1;
    let best: number | undefined;
    for (const st of b.snapshots.keys()) if (st < tick && (best === undefined || st > best)) best = st;
    return best;
  }

  /** Closest stored tick after `tick`, or undefined at the head. */
  nextTick(id: number, tick: number): number | undefined {
    const b = this.get(id);
    if (tick >= b.headTick) return undefined;
    if (this.ringAt(b, tick + 1)) return tick + 1;
    let best: number | undefined;
    for (const st of b.snapshots.keys()) if (st > tick && (best === undefined || st < best)) best = st;
    if (b.ring.length && b.ring[0].tick > tick && (best === undefined || b.ring[0].tick < best)) best = b.ring[0].tick;
    return best;
  }

  /** Stats from the root up to the branch head, following fork points. */
  statsPath(id: number): TickStats[] {
    const b = this.get(id);
    const own = b.stats;
    if (b.parentId === null) return own;
    const inherited = this.statsPath(b.parentId).filter((s) => s.tick <= b.startTick);
    return inherited.concat(own);
  }

  /** Branch ids from the root to `id`. */
  lineage(id: number): number[] {
    const out: number[] = [];
    for (let b: Branch | undefined = this.get(id); b; b = b.parentId === null ? undefined : this.get(b.parentId)) {
      out.unshift(b.id);
    }
    return out;
  }
}
