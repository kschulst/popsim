import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/step';
import { mixAncestry, overlap, purity } from '../src/sim/tribes';
import { DEFAULT_CONFIG, createWorld, maxHpOf } from '../src/sim/world';

describe('ancestry', () => {
  it('mixes as the mean of the parents and measures overlap and purity', () => {
    const child = mixAncestry([1, 0, 0], [0, 0.5, 0.5], 0);
    expect(child).toEqual([0.5, 0.25, 0.25]);
    expect(purity(child)).toBe(0.5);
    expect(overlap([1, 0, 0], [1, 0, 0])).toBe(1);
    expect(overlap([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(overlap(child, [1, 0, 0])).toBe(0.5);
  });

  it('varies between siblings when inherited in segments, around the parental mean', () => {
    const kids = Array.from({ length: 4000 }, () => mixAncestry([1, 0], [0, 1], 16)[0]);
    const mean = kids.reduce((s, v) => s + v, 0) / kids.length;
    const sd = Math.sqrt(kids.reduce((s, v) => s + (v - mean) ** 2, 0) / kids.length);
    expect(mean).toBeCloseTo(0.5, 1);
    expect(sd).toBeGreaterThan(0.1); // Binomial(16, ½)/16 has sd 0.125
    expect(sd).toBeLessThan(0.15);
    for (const k of kids) expect(k).toBeGreaterThanOrEqual(0);
  });
});

describe('conflict', () => {
  it('a hungry aggressive actor attacks a weaker one of another tribe and damages or kills it', () => {
    const tribes = DEFAULT_CONFIG.tribes.slice(0, 2).map((t) => ({ ...t, seeds: 1 }));
    let damaged = 0;
    for (let trial = 0; trial < 20; trial++) {
      const w = createWorld({ ...DEFAULT_CONFIG, tribes });
      w.food.fill(0);
      w.rules.foodSpontaneous = 0;
      w.rules.foodSpreadRate = 0;
      const [a, b] = w.actors;
      Object.assign(a, { x: 400, y: 300, energy: 60, sex: 'M' });
      Object.assign(b, { x: 410, y: 300, energy: 60, sex: 'M' });
      a.genome.aggression = 1;
      b.genome.aggression = 0;
      // One food cell between them, closer to b, so a competes for it.
      w.food[Math.floor(300 / w.cellSize) * w.cols + Math.floor(408 / w.cellSize)] = 1;
      const bMax = maxHpOf(b, w.rules);
      for (let t = 0; t < 60; t++) step(w, () => null);
      const bNow = w.actors.find((x) => x.id === b.id);
      if (!bNow || bNow.hp < bMax) damaged++;
    }
    expect(damaged).toBeGreaterThan(10);
  });
});

describe('tribe attractiveness bonus', () => {
  it('makes a candidate with that ancestry preferred', () => {
    const tribes = DEFAULT_CONFIG.tribes.slice(0, 3).map((t) => ({ ...t, seeds: 1 }));
    let picked = 0;
    for (let trial = 0; trial < 20; trial++) {
      const w = createWorld({ ...DEFAULT_CONFIG, tribes });
      w.food.fill(0);
      w.rules.directionNoise = 0;
      const favour = trial % 2; // alternate which male's tribe gets the bonus
      w.rules.tribeBonus = favour ? [0, 2, 0] : [2, 0, 0];
      const [m0, m1, f] = w.actors;
      for (const a of w.actors) {
        a.genome.aggression = 0;
        a.genome.vision = 100;
        a.energy = 1000;
        a.genome.size = 1.5;
      }
      Object.assign(f, { sex: 'F', x: 400, y: 300 });
      Object.assign(m0, { sex: 'M', x: 340, y: 300 });
      Object.assign(m1, { sex: 'M', x: 460, y: 300 });
      step(w, () => null);
      if (f.mateTarget === (favour ? m1.id : m0.id)) picked++;
    }
    expect(picked).toBe(20);
  });
});
