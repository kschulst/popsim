import type { Actor, DeathCause, Dominance, Genome, KinWeights, Rules, Sex, Tally } from './types';

export interface LifeRecord {
  id: number;
  given: string;
  surname: string;
  sex: Sex;
  generation: number;
  parents: [number, number] | null;
  born: number;
  genome: Genome;
  dominance: Dominance;
  ancestry: number[];
}

export interface Death {
  tick: number;
  cause: DeathCause;
  /** Id of the actor that dealt the killing blow (cause 'killed'). */
  killer?: number;
  /** Disease id for cause 'disease'. */
  disease?: number;
  /** Lifetime counters at death (absent for removals and old files). */
  tally?: Tally;
}

export const recordOf = (a: Actor): LifeRecord => ({
  id: a.id,
  given: a.given,
  surname: a.surname,
  sex: a.sex,
  generation: a.generation,
  parents: a.parents,
  born: a.born,
  genome: { ...a.genome },
  dominance: { ...a.dominance },
  ancestry: [...a.ancestry],
});

/**
 * Append-only register of every actor that has lived in a branch.
 *
 * A branch's registry falls back to its parent branch's registry for actors that existed at the
 * fork point (id < forkNextId), and for deaths/children up to forkTick. Events in the parent
 * after the fork are not visible from the child branch.
 */
export class Registry {
  readonly records = new Map<number, LifeRecord>();
  readonly deaths = new Map<number, Death>();
  private readonly childIndex = new Map<number, number[]>();

  constructor(
    readonly parent: Registry | null,
    readonly forkTick: number,
    readonly forkNextId: number,
  ) {}

  add(r: LifeRecord): void {
    this.records.set(r.id, r);
    if (r.parents) {
      for (const p of r.parents) {
        const list = this.childIndex.get(p);
        if (list) list.push(r.id);
        else this.childIndex.set(p, [r.id]);
      }
    }
  }

  /** Replaces the visible record for an existing actor (edited at a fork) without re-indexing children. */
  override(r: LifeRecord): void {
    this.records.set(r.id, r);
  }

  die(id: number, d: Death): void {
    this.deaths.set(id, d);
  }

  get(id: number): LifeRecord | undefined {
    const own = this.records.get(id);
    if (own) return own;
    if (this.parent && id < this.forkNextId) return this.parent.get(id);
    return undefined;
  }

  /** Death as seen at `atTick` (undefined if alive then). */
  death(id: number, atTick = Infinity): Death | undefined {
    const own = this.deaths.get(id);
    if (own && own.tick <= atTick) return own;
    if (this.parent && id < this.forkNextId) return this.parent.death(id, Math.min(atTick, this.forkTick));
    return undefined;
  }

  /** Children born at or before `atTick`. */
  childrenOf(id: number, atTick = Infinity): number[] {
    const inherited = this.parent ? this.parent.childrenOf(id, Math.min(atTick, this.forkTick)) : [];
    const own = (this.childIndex.get(id) ?? []).filter((c) => this.records.get(c)!.born <= atTick);
    return inherited.length ? inherited.concat(own) : own;
  }

  /** Ids of every actor born at or before `atTick` that this branch can see. */
  allIds(atTick = Infinity): number[] {
    const out = new Set<number>();
    if (this.parent) {
      for (const id of this.parent.allIds(Math.min(atTick, this.forkTick))) if (id < this.forkNextId) out.add(id);
    }
    for (const r of this.records.values()) if (r.born <= atTick) out.add(r.id);
    return [...out];
  }

  siblingsOf(id: number, atTick = Infinity): number[] {
    const r = this.get(id);
    if (!r?.parents) return [];
    const set = new Set<number>();
    for (const p of r.parents) for (const c of this.childrenOf(p, atTick)) if (c !== id) set.add(c);
    return [...set];
  }
}

// ---------------------------------------------------------------------------------------------
// Kinship

export type Relation =
  | 'self'
  | 'parent'
  | 'grandparent'
  | 'greatGrandparent'
  | 'child'
  | 'grandchild'
  | 'greatGrandchild'
  | 'fullSibling'
  | 'halfSibling'
  | 'auntUncle'
  | 'nephewNiece'
  | 'cousin'
  | 'distant';

export const RELATION_LABELS: Record<Relation, string> = {
  self: 'seg selv',
  parent: 'forelder',
  grandparent: 'besteforelder',
  greatGrandparent: 'oldeforelder',
  child: 'barn',
  grandchild: 'barnebarn',
  greatGrandchild: 'oldebarn',
  fullSibling: 'helsøsken',
  halfSibling: 'halvsøsken',
  auntUncle: 'tante/onkel',
  nephewNiece: 'nevø/niese',
  cousin: 'fetter/kusine',
  distant: 'fjern slekt',
};

type ParentsOf = (id: number) => [number, number] | null | undefined;

/** Ancestor id → shortest number of generations up, including self at 0. */
export const ancestors = (id: number, depth: number, parentsOf: ParentsOf): Map<number, number> => {
  const out = new Map<number, number>([[id, 0]]);
  let frontier = [id];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: number[] = [];
    for (const x of frontier) {
      const ps = parentsOf(x);
      if (!ps) continue;
      for (const p of ps) {
        if (!out.has(p)) {
          out.set(p, d);
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return out;
};

export interface Kinship {
  relation: Relation;
  /** Generations from a and from b up to the closest common ancestor. */
  da: number;
  db: number;
}

/** How b is related to a, looking `depth` generations up. Undefined if unrelated within depth. */
export const kinship = (
  a: number,
  b: number,
  parentsOf: ParentsOf,
  depth = 3,
  ancestorsOfA?: Map<number, number>,
): Kinship | undefined => {
  if (a === b) return { relation: 'self', da: 0, db: 0 };
  const A = ancestorsOfA ?? ancestors(a, depth, parentsOf);
  const B = ancestors(b, depth, parentsOf);
  let best: [number, number] | null = null;
  let sharedAtSiblingLevel = 0;
  for (const [id, db] of B) {
    const da = A.get(id);
    if (da === undefined) continue;
    if (da === 1 && db === 1) sharedAtSiblingLevel++;
    if (!best || da + db < best[0] + best[1]) best = [da, db];
  }
  if (!best) return undefined;
  const [da, db] = best;
  return { relation: classify(da, db, sharedAtSiblingLevel), da, db };
};

const classify = (da: number, db: number, sharedParents: number): Relation => {
  if (db === 0) return da === 1 ? 'parent' : da === 2 ? 'grandparent' : 'greatGrandparent';
  if (da === 0) return db === 1 ? 'child' : db === 2 ? 'grandchild' : 'greatGrandchild';
  if (da === 1 && db === 1) return sharedParents >= 2 ? 'fullSibling' : 'halfSibling';
  if (da === 2 && db === 1) return 'auntUncle';
  if (da === 1 && db === 2) return 'nephewNiece';
  if (da === 2 && db === 2) return 'cousin';
  return 'distant';
};

export const kinWeight = (rel: Relation, w: KinWeights): number => {
  switch (rel) {
    case 'self': return w.self;
    case 'child': return w.child;
    case 'grandchild': return w.grandchild;
    case 'greatGrandchild': return w.grandchild / 2;
    case 'parent': return w.parent;
    case 'grandparent': return w.grandparent;
    case 'greatGrandparent': return w.grandparent / 2;
    case 'fullSibling': return w.fullSibling;
    case 'halfSibling': return w.halfSibling;
    case 'auntUncle':
    case 'nephewNiece': return w.auntUncle;
    case 'cousin': return w.cousin;
    case 'distant': return w.cousin / 2;
  }
};

/** Generations searched for kinship in mate choice and conflict (reaches cousins). */
export const KIN_DEPTH = 2;

/** Mate score penalty for a relation. Unrelated (undefined) and distant kin cost nothing. */
export const kinPenalty = (k: Kinship | undefined, r: Rules): number => {
  switch (k?.relation) {
    case 'self':
    case 'parent':
    case 'child':
    case 'fullSibling':
      return r.kinPenaltyClose;
    case 'halfSibling':
      return r.kinPenaltyHalf;
    case 'grandparent':
    case 'grandchild':
    case 'auntUncle':
    case 'nephewNiece':
      return r.kinPenaltySecond;
    case 'cousin':
      return r.kinPenaltyCousin;
    default:
      return 0;
  }
};
