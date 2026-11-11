import { describe, expect, it } from 'vitest';
import { createEle, ELE_KEYS } from '../src/sim/ele';
import { step } from '../src/sim/step';
import { createWorld } from '../src/sim/world';

describe('extinction level events', () => {
  it('a meteor kills everyone inside the crater on the next tick', () => {
    const w = createWorld();
      w.fertility.fill(0.5); // no water in these tests
    for (const a of w.actors.slice(0, 5)) Object.assign(a, { x: 400 + Math.random() * 10, y: 300 });
    const inside = w.actors.slice(0, 5).map((a) => a.id);
    w.rules.eleSeverity = 1;
    createEle(w, 'meteor', true, { x: 405, y: 300 });
    const ev = step(w, () => null);
    const killed = ev.deaths.filter((d) => d.cause === 'catastrophe').map((d) => d.id);
    for (const id of inside) expect(killed).toContain(id);
    expect(w.events[0].applied).toBe(true);
  });

  it('every event runs to its end without errors and records population after', () => {
    for (const key of ELE_KEYS) {
      const w = createWorld();
      w.fertility.fill(0.5); // no water in these tests
      w.rules.eleSeverity = 0.3; // shorter
      const e = createEle(w, key, true);
      e.end = e.tick + 30;
      for (let t = 0; t < 40; t++) step(w, () => null);
      expect(e.applied, key).toBe(true);
      expect(e.popAfter, key).not.toBeNull();
    }
  });
});
