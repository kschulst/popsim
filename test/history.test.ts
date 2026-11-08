import { describe, expect, it } from 'vitest';
import { History } from '../src/history/history';
import { fromExport, toExport } from '../src/history/serialize';
import { createWorld, cloneWorld, DEFAULT_CONFIG } from '../src/sim/world';

const newHistory = () => {
  const h = new History({ snapshotInterval: 10, ringSize: 25 });
  const root = h.createRoot(createWorld(DEFAULT_CONFIG));
  for (let i = 0; i < 100; i++) h.advance(root.id);
  return { h, root };
};

describe('History', () => {
  it('keeps per-tick states in the ring and sparse snapshots before it', () => {
    const { h, root } = newHistory();
    expect(root.headTick).toBe(100);
    expect(h.has(root.id, 90)).toBe(true);
    expect(h.has(root.id, 76)).toBe(true);
    expect(h.has(root.id, 74)).toBe(false);
    expect(h.prevTick(root.id, 76)).toBe(70);
    expect(h.nextTick(root.id, 70)).toBe(76);
    expect(h.stateAt(root.id, 55).tick).toBe(50);
    expect(h.statsPath(root.id)).toHaveLength(100);
  });

  it('forks with edits and keeps the parent untouched', () => {
    const { h, root } = newHistory();
    const draft = cloneWorld(h.stateAt(root.id, 50));
    const removed = draft.actors.pop()!;
    draft.rules.foodCap = 1;
    const b = h.fork(root.id, 50, draft, ['test']);
    for (let i = 0; i < 20; i++) h.advance(b.id);
    expect(b.headTick).toBe(70);
    expect(b.registry.death(removed.id)?.cause).toBe('removed');
    expect(root.registry.death(removed.id)?.cause).not.toBe('removed');
    expect(h.stateAt(root.id, 50).rules.foodCap).not.toBe(1);
    expect(h.statsPath(b.id).map((s) => s.tick).slice(48, 52)).toEqual([49, 50, 51, 52]);
  });

  it('round-trips through export', () => {
    const { h, root } = newHistory();
    h.fork(root.id, 50, cloneWorld(h.stateAt(root.id, 50)), ['x']);
    const json = JSON.parse(JSON.stringify(toExport(h, 1)));
    const { history } = fromExport(json);
    expect(history.branches.size).toBe(2);
    const a = h.stateAt(root.id, 60);
    const b = history.stateAt(root.id, 60);
    expect(Array.from(b.food)).toEqual(Array.from(a.food));
    expect(b.actors.length).toBe(a.actors.length);
  });
});
