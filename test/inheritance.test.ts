import { describe, expect, it } from 'vitest';
import { inherit } from '../src/sim/genome';
import type { Dominance, Genome } from '../src/sim/types';

const g = (size: number): Genome => ({ size, maxSpeed: 1, vision: 50, aggression: 0.5, reproThreshold: 0.6, mutationRate: 0.01 });
const d = (v: number): Dominance => ({ size: v, maxSpeed: v, vision: v, aggression: v, reproThreshold: v, mutationRate: v });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('inherit', () => {
  it('blends parents equally when inheritance strength is equal', () => {
    const kids = Array.from({ length: 2000 }, () => inherit({ genome: g(1), dominance: d(0.5) }, { genome: g(3), dominance: d(0.5) }, 0, 0));
    for (const k of kids) expect(k.genome.size).toBeCloseTo(2, 5);
  });

  it('pulls toward the parent with stronger inheritance', () => {
    const kids = Array.from({ length: 2000 }, () => inherit({ genome: g(1), dominance: d(0.9) }, { genome: g(3), dominance: d(0.1) }, 0.15, 0));
    const m = mean(kids.map((k) => k.genome.size));
    expect(m).toBeGreaterThan(1.1);
    expect(m).toBeLessThan(1.4);
    // Noise makes some children differ noticeably from the expected blend.
    expect(kids.some((k) => k.genome.size > 1.6)).toBe(true);
  });

  it('passes inheritance strength from one parent without drift', () => {
    const kids = Array.from({ length: 4000 }, () => inherit({ genome: g(1), dominance: d(0.9) }, { genome: g(3), dominance: d(0.1) }, 0.15, 0));
    expect(mean(kids.map((k) => k.dominance.size))).toBeCloseTo(0.5, 1);
  });
});
