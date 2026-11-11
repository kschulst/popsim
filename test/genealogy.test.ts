import { describe, expect, it } from 'vitest';
import { kinPenalty, kinship, Registry, type LifeRecord } from '../src/sim/genealogy';
import { DEFAULT_RULES } from '../src/sim/rules';

// Family: 1×2 → 3,4 (full siblings). 1×5 → 6 (half sibling of 3).
// 3×7 → 8. 4×9 → 10. 8 and 10 are cousins; 4 is aunt/uncle of 8.
const parents: Record<number, [number, number] | null> = {
  1: null, 2: null, 5: null, 7: null, 9: null,
  3: [2, 1], 4: [2, 1], 6: [5, 1], 8: [3, 7], 10: [4, 9],
};
const parentsOf = (id: number) => parents[id];
const rel = (a: number, b: number) => kinship(a, b, parentsOf)?.relation;

describe('kinship', () => {
  it('classifies relations', () => {
    expect(rel(3, 3)).toBe('self');
    expect(rel(3, 1)).toBe('parent');
    expect(rel(1, 3)).toBe('child');
    expect(rel(8, 1)).toBe('grandparent');
    expect(rel(1, 8)).toBe('grandchild');
    expect(rel(3, 4)).toBe('fullSibling');
    expect(rel(3, 6)).toBe('halfSibling');
    expect(rel(8, 4)).toBe('auntUncle');
    expect(rel(4, 8)).toBe('nephewNiece');
    expect(rel(8, 10)).toBe('cousin');
    expect(rel(1, 2)).toBeUndefined();
  });

  it('penalises close kin most in mate choice', () => {
    const p = (a: number, b: number) => kinPenalty(kinship(a, b, parentsOf), DEFAULT_RULES);
    expect(p(3, 4)).toBe(DEFAULT_RULES.kinPenaltyClose);
    expect(p(3, 1)).toBe(DEFAULT_RULES.kinPenaltyClose);
    expect(p(3, 6)).toBe(DEFAULT_RULES.kinPenaltyHalf);
    expect(p(8, 4)).toBe(DEFAULT_RULES.kinPenaltySecond);
    expect(p(8, 10)).toBe(DEFAULT_RULES.kinPenaltyCousin);
    expect(p(1, 2)).toBe(0);
  });
});

const rec = (id: number, born: number, ps: [number, number] | null = null): LifeRecord => ({
  id, born, parents: ps, given: 'A', surname: 'B', sex: 'F', generation: 0,
  genome: { size: 1, maxSpeed: 1, vision: 50, aggression: 0.5, longevity: 1, reproThreshold: 0.5, mutationRate: 0.1 },
  dominance: { size: 0.5, maxSpeed: 0.5, vision: 0.5, aggression: 0.5, longevity: 0.5, reproThreshold: 0.5, mutationRate: 0.5 },
  ancestry: [1],
});

describe('Registry forks', () => {
  it('sees parent records and events only up to the fork point', () => {
    const root = new Registry(null, 0, 0);
    root.add(rec(1, 0));
    root.add(rec(2, 0));
    root.add(rec(3, 5, [1, 2]));
    root.add(rec(4, 20, [1, 2])); // born after fork
    root.die(1, { tick: 30, cause: 'age' }); // dies after fork
    root.die(2, { tick: 8, cause: 'starvation' }); // dies before fork

    const child = new Registry(root, 10, 4); // fork at tick 10, ids < 4 existed
    child.add(rec(5, 12, [1, 2]));

    expect(child.get(3)?.id).toBe(3);
    expect(child.get(4)).toBeUndefined();
    expect(child.death(1)).toBeUndefined();
    expect(child.death(2)?.tick).toBe(8);
    expect(child.childrenOf(1).sort()).toEqual([3, 5]);
    expect(child.childrenOf(1, 11)).toEqual([3]);
    expect(root.childrenOf(1).sort()).toEqual([3, 4]);
  });
});
