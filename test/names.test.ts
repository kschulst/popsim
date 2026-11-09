import { describe, expect, it } from 'vitest';
import ssb from '../src/sim/data/ssb-names.json';
import { givenName, uniqueSurnames } from '../src/sim/names';

const female = new Set((ssb.female as [string, number][]).map((p) => p[0]));
const male = new Set((ssb.male as [string, number][]).map((p) => p[0]));

describe('SSB names', () => {
  it('draws first names by sex, sometimes double', () => {
    const fs = Array.from({ length: 2000 }, () => givenName('F'));
    const ms = Array.from({ length: 2000 }, () => givenName('M'));
    for (const n of fs) for (const part of n.split(' ')) expect(female.has(part)).toBe(true);
    for (const n of ms) for (const part of n.split(' ')) expect(male.has(part)).toBe(true);
    const doubles = fs.filter((n) => n.includes(' ')).length / fs.length;
    expect(doubles).toBeGreaterThan(0.08);
    expect(doubles).toBeLessThan(0.22);
  });

  it('gives distinct surnames', () => {
    const s = uniqueSurnames(200, ['Hansen']);
    expect(new Set(s).size).toBe(200);
    expect(s).not.toContain('Hansen');
  });
});
