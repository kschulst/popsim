import { kinship, type Death, type LifeRecord, type Registry } from '../sim/genealogy';
import { fullName } from '../sim/names';
import { mainTribe, purity } from '../sim/tribes';
import type { Actor, DeathCause, GeneKey, Tally, World } from '../sim/types';
import { surnameColor } from './colors';
import { CAUSE_LABELS, lifeSpanText } from './inspector';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const TOP = 10;

/** Everything the boards need, computed once per render for the displayed tick. */
interface Ctx {
  w: World;
  reg: Registry;
  tick: number;
  ids: number[];
  rec: Map<number, LifeRecord>;
  death: Map<number, Death>;
  live: Map<number, Actor>;
  /** Kills: [killer, victim, tick]. */
  kills: [number, number, number][];
  children: Map<number, number[]>;
  parentsOf: (id: number) => [number, number] | null | undefined;
}

interface Row {
  id?: number;
  label?: string;
  color?: string;
  value: number;
  text?: string;
}

interface Board {
  key: string;
  group: string;
  title: string;
  description: string;
  /** Whether "bare levende" applies. */
  livingFilter?: boolean;
  /** Ascending order (smallest first). */
  ascending?: boolean;
  rows?: (c: Ctx) => Row[];
  /** Custom HTML (tables). */
  html?: (c: Ctx) => string;
}

const tallyOf = (c: Ctx, id: number): Tally | undefined => {
  const a = c.live.get(id);
  if (a) return a;
  return c.death.get(id)?.tally;
};

const tallyBoard = (key: keyof Tally, title: string, description: string): Board => ({
  key,
  group: 'Individer',
  title,
  description,
  livingFilter: true,
  rows: (c) => c.ids.map((id) => ({ id, value: tallyOf(c, id)?.[key] ?? 0 })).filter((r) => r.value > 0),
});

const geneBoard = (key: GeneKey, title: string, ascending = false): Board => ({
  key: `gene-${key}${ascending ? '-min' : ''}`,
  group: 'Egenskaper (levende)',
  title,
  description: `Levende aktører sortert etter genet ${title.toLowerCase()}.`,
  ascending,
  rows: (c) => [...c.live.values()].map((a) => ({ id: a.id, value: a.genome[key] })),
});

const lifespan = (c: Ctx, id: number): number | undefined => {
  const d = c.death.get(id);
  const r = c.rec.get(id);
  if (!d || !r || d.cause === 'removed') return undefined;
  return d.tick - r.born;
};

const tribeOf = (c: Ctx, id: number): number => {
  const a = c.live.get(id);
  return mainTribe(a?.ancestry ?? c.rec.get(id)?.ancestry ?? [1]);
};

const BOARDS: Board[] = [
  {
    key: 'kills',
    group: 'Individer',
    title: 'Flest drap',
    description: 'Antall aktører drept (siste slag).',
    livingFilter: true,
    rows: (c) => {
      const n = new Map<number, number>();
      for (const [k] of c.kills) n.set(k, (n.get(k) ?? 0) + 1);
      return [...n].map(([id, value]) => ({ id, value }));
    },
  },
  {
    key: 'longest',
    group: 'Individer',
    title: 'Lengst levetid (døde)',
    description: 'Alder ved død i ticks. Fjernede aktører er ikke med.',
    rows: (c) => c.ids.flatMap((id) => {
      const v = lifespan(c, id);
      return v === undefined ? [] : [{ id, value: v }];
    }),
  },
  {
    key: 'shortest',
    group: 'Individer',
    title: 'Kortest levetid (døde)',
    description: 'Alder ved død i ticks, korteste først. Fjernede aktører er ikke med.',
    ascending: true,
    rows: (c) => c.ids.flatMap((id) => {
      const v = lifespan(c, id);
      return v === undefined ? [] : [{ id, value: v, text: `${v} ticks (${CAUSE_LABELS[c.death.get(id)!.cause]})` }];
    }),
  },
  {
    key: 'oldest',
    group: 'Individer',
    title: 'Eldste levende',
    description: 'Alder i ticks blant de levende.',
    rows: (c) => [...c.live.values()].map((a) => ({ id: a.id, value: a.age })),
  },
  {
    key: 'children',
    group: 'Individer',
    title: 'Flest barn',
    description: 'Antall barn født (også barn som senere døde).',
    livingFilter: true,
    rows: (c) => [...c.children].map(([id, kids]) => ({ id, value: kids.length })),
  },
  {
    key: 'descendants',
    group: 'Individer',
    title: 'Flest etterkommere',
    description: 'Barn, barnebarn og videre. Ved innavl kan samme etterkommer telles via flere linjer.',
    livingFilter: true,
    rows: (c) => {
      const memo = new Map<number, number>();
      const sorted = [...c.ids].sort((a, b) => (c.rec.get(b)!.born - c.rec.get(a)!.born));
      for (const id of sorted) {
        let n = 0;
        for (const k of c.children.get(id) ?? []) n += 1 + (memo.get(k) ?? 0);
        memo.set(id, n);
      }
      return [...memo].filter(([, v]) => v > 0).map(([id, value]) => ({ id, value }));
    },
  },
  {
    key: 'generation',
    group: 'Individer',
    title: 'Høyest generasjon',
    description: 'Antall ledd fra en seed.',
    livingFilter: true,
    rows: (c) => c.ids.map((id) => ({ id, value: c.rec.get(id)!.generation })),
  },
  tallyBoard('damageDealt', 'Mest skade gitt', 'Sum skade påført andre.'),
  tallyBoard('damageTaken', 'Mest skade tatt', 'Sum skade mottatt.'),
  {
    key: 'hitsSurvived',
    group: 'Individer',
    title: 'Overlevde flest treff',
    description: 'Antall ganger truffet, blant dem som ikke ble drept.',
    livingFilter: true,
    rows: (c) =>
      c.ids
        .filter((id) => c.death.get(id)?.cause !== 'killed')
        .map((id) => ({ id, value: tallyOf(c, id)?.hitsTaken ?? 0 }))
        .filter((r) => r.value > 0),
  },
  tallyBoard('foodEaten', 'Mest mat spist', 'Antall matruter spist.'),
  tallyBoard('distance', 'Lengst tilbakelagt', 'Distanse i verdensenheter.'),
  {
    key: 'killedOwnTribe',
    group: 'Individer',
    title: 'Drepte egen stamme',
    description: 'Drap der drapsmann og offer har samme største stamme.',
    livingFilter: true,
    rows: (c) => {
      const n = new Map<number, number>();
      for (const [k, v] of c.kills) if (tribeOf(c, k) === tribeOf(c, v)) n.set(k, (n.get(k) ?? 0) + 1);
      return [...n].map(([id, value]) => ({ id, value }));
    },
  },
  {
    key: 'killedKin',
    group: 'Individer',
    title: 'Drepte egen slekt',
    description: 'Drap av slektninger innen to ledd (til og med fettere/kusiner).',
    livingFilter: true,
    rows: (c) => {
      const n = new Map<number, number>();
      for (const [k, v] of c.kills) if (kinship(k, v, c.parentsOf, 2)) n.set(k, (n.get(k) ?? 0) + 1);
      return [...n].map(([id, value]) => ({ id, value }));
    },
  },
  {
    key: 'avengers',
    group: 'Individer',
    title: 'Hevnere',
    description: 'Drepte en som tidligere hadde drept en slektning av dem (innen to ledd).',
    livingFilter: true,
    rows: (c) => {
      const killsBy = new Map<number, [number, number][]>();
      for (const [k, v, t] of c.kills) {
        const l = killsBy.get(k);
        if (l) l.push([v, t]);
        else killsBy.set(k, [[v, t]]);
      }
      const n = new Map<number, number>();
      for (const [k, x, t] of c.kills) {
        const earlier = killsBy.get(x) ?? [];
        if (earlier.some(([y, t0]) => t0 < t && kinship(k, y, c.parentsOf, 2))) n.set(k, (n.get(k) ?? 0) + 1);
      }
      return [...n].map(([id, value]) => ({ id, value }));
    },
  },
  {
    key: 'purest',
    group: 'Egenskaper (levende)',
    title: 'Renest avstamning',
    description: 'Største andel fra én stamme.',
    rows: (c) => [...c.live.values()].map((a) => ({ id: a.id, value: purity(a.ancestry), text: `${Math.round(purity(a.ancestry) * 100)} % ${c.w.tribes[mainTribe(a.ancestry)]?.name ?? ''}` })),
  },
  {
    key: 'mixed',
    group: 'Egenskaper (levende)',
    title: 'Mest blandet',
    description: 'Flest stammer med minst 5 % andel; ved likhet lavest renhet.',
    rows: (c) =>
      [...c.live.values()].map((a) => {
        const n = a.ancestry.filter((v) => v >= 0.05).length;
        return { id: a.id, value: n + (1 - purity(a.ancestry)), text: `${n} stammer, renhet ${Math.round(purity(a.ancestry) * 100)} %` };
      }),
  },
  geneBoard('size', 'Størst'),
  geneBoard('maxSpeed', 'Raskest'),
  geneBoard('vision', 'Best syn'),
  geneBoard('aggression', 'Mest aggressiv'),
  geneBoard('aggression', 'Minst aggressiv', true),
  geneBoard('longevity', 'Høyest levealder (gen)'),
  {
    key: 'heritability',
    group: 'Egenskaper (levende)',
    title: 'Sterkest arv',
    description: 'Gjennomsnittlig arvestyrke over alle egenskaper.',
    rows: (c) =>
      [...c.live.values()].map((a) => {
        const v = Object.values(a.dominance);
        return { id: a.id, value: v.reduce((s, x) => s + x, 0) / v.length };
      }),
  },
  {
    key: 'clanSize',
    group: 'Grupper',
    title: 'Klaner: flest levende',
    description: 'Levende medlemmer per etternavn.',
    rows: (c) => {
      const n = new Map<string, number>();
      for (const a of c.live.values()) n.set(a.surname, (n.get(a.surname) ?? 0) + 1);
      return [...n].map(([label, value]) => ({ label, value, color: surnameColor(c.w, label) }));
    },
  },
  {
    key: 'clanKills',
    group: 'Grupper',
    title: 'Klaner: flest drap',
    description: 'Drap utført av medlemmer av klanen (drapsmannens etternavn).',
    rows: (c) => {
      const n = new Map<string, number>();
      for (const [k] of c.kills) {
        const s = c.rec.get(k)?.surname;
        if (s) n.set(s, (n.get(s) ?? 0) + 1);
      }
      return [...n].map(([label, value]) => ({ label, value, color: surnameColor(c.w, label) }));
    },
  },
  {
    key: 'clanGenerations',
    group: 'Grupper',
    title: 'Klaner: flest generasjoner',
    description: 'Høyeste generasjon nådd av et medlem av klanen.',
    rows: (c) => {
      const n = new Map<string, number>();
      for (const id of c.ids) {
        const r = c.rec.get(id)!;
        n.set(r.surname, Math.max(n.get(r.surname) ?? 0, r.generation));
      }
      return [...n].map(([label, value]) => ({ label, value, color: surnameColor(c.w, label) }));
    },
  },
  {
    key: 'extinctClans',
    group: 'Grupper',
    title: 'Utdødde klaner',
    description: 'Klaner uten levende medlemmer, etter hvor lenge de fantes (første fødsel til siste død).',
    rows: (c) => {
      const span = new Map<string, [number, number]>();
      for (const id of c.ids) {
        const r = c.rec.get(id)!;
        const end = c.death.get(id)?.tick ?? Infinity;
        const cur = span.get(r.surname);
        span.set(r.surname, cur ? [Math.min(cur[0], r.born), Math.max(cur[1], end)] : [r.born, end]);
      }
      return [...span]
        .filter(([, [, end]]) => end !== Infinity)
        .map(([label, [start, end]]) => ({ label, value: end - start, text: `${end - start} ticks (${start}–${end})`, color: surnameColor(c.w, label) }));
    },
  },
  {
    key: 'tribeKills',
    group: 'Grupper',
    title: 'Drap mellom stammer',
    description: 'Rader: drapsmannens største stamme. Kolonner: offerets.',
    html: (c) => {
      const T = c.w.tribes;
      const m = T.map(() => T.map(() => 0));
      for (const [k, v] of c.kills) m[tribeOf(c, k)][tribeOf(c, v)]++;
      const head = `<tr><th>drapsmann ↓ / offer →</th>${T.map((t) => `<th style="color:${t.color}">${esc(t.name)}</th>`).join('')}</tr>`;
      const body = T.map((t, i) => `<tr><th style="color:${t.color}">${esc(t.name)}</th>${m[i].map((v) => `<td class="num">${v || ''}</td>`).join('')}</tr>`).join('');
      return `<table class="matrix">${head}${body}</table>`;
    },
  },
  {
    key: 'tribeCauses',
    group: 'Grupper',
    title: 'Dødsårsaker per stamme',
    description: 'Antall døde per største stamme og dødsårsak. Fjernede aktører er ikke med.',
    html: (c) => {
      const causes: DeathCause[] = ['starvation', 'age', 'killed', 'childbirth', 'infant'];
      const T = c.w.tribes;
      const m = T.map(() => causes.map(() => 0));
      for (const [id, d] of c.death) {
        const ci = causes.indexOf(d.cause);
        if (ci >= 0) m[tribeOf(c, id)][ci]++;
      }
      const head = `<tr><th></th>${causes.map((k) => `<th>${CAUSE_LABELS[k]}</th>`).join('')}</tr>`;
      const body = T.map((t, i) => `<tr><th style="color:${t.color}">${esc(t.name)}</th>${m[i].map((v) => `<td class="num">${v || ''}</td>`).join('')}</tr>`).join('');
      return `<table class="matrix">${head}${body}</table>`;
    },
  },
];

const fmtValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));

export class Leaderboards {
  private board = BOARDS[0].key;
  private livingOnly = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly onSelect: (id: number) => void,
  ) {
    const groups = [...new Set(BOARDS.map((b) => b.group))];
    root.innerHTML = `
      <div class="lb-controls">
        <select class="lb-select">${groups
          .map((g) => `<optgroup label="${g}">${BOARDS.filter((b) => b.group === g).map((b) => `<option value="${b.key}">${b.title}</option>`).join('')}</optgroup>`)
          .join('')}</select>
        <label class="check"><input type="checkbox" class="lb-living"> Bare levende</label>
      </div>
      <p class="muted lb-desc"></p>
      <div class="lb-body"></div>`;
    root.querySelector<HTMLSelectElement>('.lb-select')!.addEventListener('change', (e) => {
      this.board = (e.target as HTMLSelectElement).value;
      this.dirty = true;
    });
    root.querySelector<HTMLInputElement>('.lb-living')!.addEventListener('change', (e) => {
      this.livingOnly = (e.target as HTMLInputElement).checked;
      this.dirty = true;
    });
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (el) this.onSelect(Number(el.dataset.id));
    });
  }

  /** Set when the choice changes so the next render runs even if throttled. */
  dirty = true;

  render(w: World, reg: Registry, tick: number): void {
    this.dirty = false;
    const board = BOARDS.find((b) => b.key === this.board)!;
    this.root.querySelector('.lb-desc')!.textContent = board.description;
    this.root.querySelector<HTMLElement>('.check')!.hidden = !board.livingFilter;

    const ids = reg.allIds(tick);
    const rec = new Map<number, LifeRecord>();
    for (const id of ids) rec.set(id, reg.get(id)!);
    const death = new Map<number, Death>();
    for (const id of ids) {
      const d = reg.death(id, tick);
      if (d) death.set(id, d);
    }
    const kills: [number, number, number][] = [];
    for (const [id, d] of death) if (d.cause === 'killed' && d.killer !== undefined) kills.push([d.killer, id, d.tick]);
    const children = new Map<number, number[]>();
    for (const id of ids) {
      for (const p of rec.get(id)!.parents ?? []) {
        const l = children.get(p);
        if (l) l.push(id);
        else children.set(p, [id]);
      }
    }
    const c: Ctx = {
      w,
      reg,
      tick,
      ids,
      rec,
      death,
      live: new Map(w.actors.map((a) => [a.id, a])),
      kills,
      children,
      parentsOf: (id) => reg.get(id)?.parents,
    };

    const body = this.root.querySelector('.lb-body')!;
    if (board.html) {
      body.innerHTML = board.html(c);
      return;
    }
    let rows = board.rows!(c);
    if (board.livingFilter && this.livingOnly) rows = rows.filter((r) => r.id !== undefined && c.live.has(r.id));
    rows.sort((a, b) => (board.ascending ? a.value - b.value : b.value - a.value));
    rows = rows.slice(0, TOP);
    if (!rows.length) {
      body.innerHTML = '<p class="muted">Ingen ennå.</p>';
      return;
    }
    body.innerHTML = `<table class="lb">${rows
      .map((r, i) => {
        let name: string;
        if (r.id !== undefined) {
          const rr = rec.get(r.id);
          const dead = !c.live.has(r.id);
          name = rr
            ? `<a data-id="${r.id}" class="${dead ? 'dead' : ''}" style="--c:${surnameColor(w, rr.surname)}">${esc(fullName(rr))} <span class="life">${lifeSpanText(reg, r.id, tick)}</span></a>`
            : `#${r.id}`;
        } else {
          name = `<span style="color:${r.color ?? 'inherit'}">${esc(r.label ?? '')}</span>`;
        }
        return `<tr><td class="num rank">${i + 1}</td><td>${name}</td><td class="num">${r.text ?? fmtValue(r.value)}</td></tr>`;
      })
      .join('')}</table>`;
  }
}
