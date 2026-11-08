// Non-deterministic randomness by design (see DESIGN.md).

export const rand = (min = 0, max = 1): number => min + Math.random() * (max - min);

export const randInt = (min: number, maxExclusive: number): number =>
  Math.floor(rand(min, maxExclusive));

export const pick = <T>(items: readonly T[]): T => items[randInt(0, items.length)];

/** Standard normal sample (Box–Muller). */
export const gaussian = (): number => {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

export const shuffle = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;
