import { pick, randInt } from './random';

const ONSETS = ['b', 'br', 'd', 'f', 'g', 'h', 'k', 'kj', 'l', 'm', 'n', 'p', 'r', 's', 'sk', 'st', 't', 'v', 'tr', 'fj'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'y', 'æ', 'ø', 'å'];
const CODAS = ['', '', 'n', 'r', 'l', 'k', 's', 'm', 't', 'nd', 'rk', 'st'];

const syllable = () => pick(ONSETS) + pick(VOWELS) + pick(CODAS);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const givenName = (): string => capitalize(syllable() + (Math.random() < 0.4 ? syllable() : ''));

export const surnameName = (): string => capitalize(syllable() + syllable());

/** Unique surnames for the initial seeds. */
export const uniqueSurnames = (count: number, taken: Iterable<string> = []): string[] => {
  const used = new Set(taken);
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 100) {
    const s = surnameName();
    if (s.length < 4 || used.has(s)) continue;
    used.add(s);
    out.push(s);
  }
  while (out.length < count) out.push(`Klan${randInt(1000, 9999)}`);
  return out;
};

export const fullName = (a: { given: string; surname: string; id: number }): string =>
  `${a.given} ${a.surname} #${a.id}`;
