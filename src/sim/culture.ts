import { similarity } from './genome';
import { clamp, gaussian, pick, rand } from './random';
import type { Actor, Culture, World } from './types';

/**
 * Cultures: explicit groups that form among actors who have lived close together and are alike
 * (not necessarily the same tribe), and spread to neighbours. Each culture has traits that drift
 * slowly: peace (restraint towards members), sharing (energy to members in need) and xenophobia
 * (aggression towards other cultures, scaled by their hostility). Kills across cultures raise
 * hostility between them; it fades over time.
 */

const PREFIXES = ['Elve', 'Dal', 'Stein', 'Skog', 'Fjell', 'Myr', 'Sjø', 'Eng', 'Høy', 'Lyng', 'Ask', 'Bjørk', 'Grå', 'Sol', 'Måne', 'Vind', 'Ild', 'Snø', 'Tåke', 'Kilde'];
const COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#aaffc3', '#808000', '#ffd8b1'];

const nameCulture = (w: World): string => {
  const taken = new Set(w.cultures.map((c) => c.name));
  for (let i = 0; i < 40; i++) {
    const n = `${pick(PREFIXES)}folket`;
    if (!taken.has(n)) return n;
  }
  return `Folk ${w.cultures.length + 1}`;
};

/** Hostility between two cultures (symmetric). */
export const hostility = (w: World, a: number | null, b: number | null): number => {
  if (a === null || b === null || a === b) return 0;
  return w.hostility?.[a < b ? `${a}-${b}` : `${b}-${a}`] ?? 0;
};

/** Called when `killer` kills `victim`: hostility between their cultures rises by 1. */
export const recordKill = (w: World, killer: Actor, victim: Actor): void => {
  const a = killer.culture;
  const b = victim.culture;
  if (a === null || b === null || a === b || a === undefined || b === undefined) return;
  w.hostility ??= {};
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  w.hostility[key] = (w.hostility[key] ?? 0) + 1;
};

const newCulture = (w: World, members: Actor[], parent?: Culture): Culture => {
  const drift = (v: number) => clamp(v + gaussian() * 0.15, 0, 1);
  const c: Culture = {
    id: w.cultures.length,
    name: nameCulture(w),
    color: COLORS[w.cultures.length % COLORS.length],
    founded: w.tick,
    parent: parent?.id ?? null,
    peace: parent ? drift(parent.peace) : rand(0.2, 0.9),
    sharing: parent ? drift(parent.sharing) : rand(0.1, 0.8),
    xenophobia: parent ? drift(parent.xenophobia) : rand(0.1, 0.8),
  };
  w.cultures.push(c);
  for (const m of members) m.culture = c.id;
  return c;
};

/**
 * Culture dynamics for one tick: founding, assimilation, trait drift and hostility decay.
 * `near(a, r)` yields actors within r of a. Runs on a sample of actors each tick to stay cheap.
 */
export const stepCultures = (w: World, near: (a: Actor, r: number) => Iterable<Actor>, isDead: (id: number) => boolean): void => {
  const r = w.rules;
  if (!(r.cultureRadius > 0)) return;
  w.cultures ??= [];
  const sampleRate = 0.1;
  // Centroid and size of each culture, for schisms.
  const centre = new Map<number, { x: number; y: number; n: number }>();
  for (const a of w.actors) {
    if (a.culture === null || a.culture === undefined || isDead(a.id)) continue;
    const e = centre.get(a.culture) ?? { x: 0, y: 0, n: 0 };
    e.x += a.x;
    e.y += a.y;
    e.n++;
    centre.set(a.culture, e);
  }
  for (const a of w.actors) {
    if (isDead(a.id) || Math.random() >= sampleRate) continue;
    const neighbours = [...near(a, r.cultureRadius)].filter(
      (b) => b !== a && !isDead(b.id) && (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= r.cultureRadius ** 2,
    );
    if (a.culture === null || a.culture === undefined) {
      // Founding: enough alike, culture-less neighbours form a new culture.
      const alike = neighbours.filter((b) => (b.culture === null || b.culture === undefined) && similarity(a.genome, b.genome) > 0.8);
      if (alike.length + 1 >= r.cultureMinGroup) {
        newCulture(w, [a, ...alike]);
        continue;
      }
    }
    // Schism: a local group far from the centre of a large culture breaks away as a daughter culture.
    if (a.culture !== null && a.culture !== undefined && Math.random() < r.schismRate / sampleRate) {
      const e = centre.get(a.culture);
      const same = neighbours.filter((b) => b.culture === a.culture);
      if (e && e.n > 3 * r.cultureMinGroup && same.length + 1 >= r.cultureMinGroup) {
        const far = Math.hypot(a.x - e.x / e.n, a.y - e.y / e.n);
        if (far > r.schismDistance) {
          newCulture(w, [a, ...same], w.cultures[a.culture]);
          continue;
        }
      }
    }
    // Assimilation: adopt the most common culture among neighbours, faster the more alike they are.
    const counts = new Map<number, { n: number; sim: number }>();
    for (const b of neighbours) {
      if (b.culture === null || b.culture === undefined || b.culture === a.culture) continue;
      const e = counts.get(b.culture) ?? { n: 0, sim: 0 };
      e.n++;
      e.sim += similarity(a.genome, b.genome);
      counts.set(b.culture, e);
    }
    let best: number | null = null;
    let bestN = 0;
    for (const [c, e] of counts) if (e.n > bestN) [best, bestN] = [c, e.n];
    if (best === null) continue;
    const own = a.culture === null || a.culture === undefined ? 0 : neighbours.filter((b) => b.culture === a.culture).length;
    if (bestN <= own) continue;
    const e = counts.get(best)!;
    const p = (r.assimilationRate / sampleRate) * (bestN / neighbours.length) * (e.sim / e.n);
    if (Math.random() < p) a.culture = best;
  }
  // Traits drift slowly; hostility fades.
  for (const c of w.cultures) {
    c.peace = clamp(c.peace + gaussian() * 0.002, 0, 1);
    c.sharing = clamp(c.sharing + gaussian() * 0.002, 0, 1);
    c.xenophobia = clamp(c.xenophobia + gaussian() * 0.002, 0, 1);
  }
  if (w.hostility) {
    for (const k of Object.keys(w.hostility)) {
      w.hostility[k] *= 1 - r.hostilityDecay;
      if (w.hostility[k] < 0.01) delete w.hostility[k];
    }
  }
};

/** Members per culture among the living. */
export const cultureSizes = (w: World): Map<number, number> => {
  const m = new Map<number, number>();
  for (const a of w.actors) if (a.culture !== null && a.culture !== undefined) m.set(a.culture, (m.get(a.culture) ?? 0) + 1);
  return m;
};
