import * as d3 from 'd3';
import {
  ancestors,
  kinship,
  kinWeight,
  RELATION_LABELS,
  type LifeRecord,
  type Registry,
  type Relation,
} from '../sim/genealogy';
import { GENE_LABELS, normGene } from '../sim/genome';
import { fullName } from '../sim/names';
import { GENE_KEYS, type DeathCause, type World } from '../sim/types';
import { vigorOf } from '../sim/step';
import { purity } from '../sim/tribes';
import { capacityOf, maxHpOf } from '../sim/world';
import { surnameColor } from './colors';
import { DETAIL_ZOOM } from './renderer';

export const CAUSE_LABELS: Record<DeathCause, string> = {
  starvation: 'sult',
  age: 'alderdom',
  killed: 'drept',
  childbirth: 'døde i fødsel',
  infant: 'spedbarnsdød',
  disease: 'sykdom',
  catastrophe: 'katastrofe',
  removed: 'fjernet ved forgreining',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Kin weight of every living actor relative to `id` (excluding itself), depth 3. */
export const kinMap = (w: World, reg: Registry, id: number): Map<number, number> => {
  const parentsOf = (x: number) => reg.get(x)?.parents;
  const anc = ancestors(id, 3, parentsOf);
  const out = new Map<number, number>();
  for (const a of w.actors) {
    if (a.id === id) continue;
    const k = kinship(id, a.id, parentsOf, 3, anc);
    if (k) out.set(a.id, kinWeight(k.relation, w.rules.kinWeights));
  }
  return out;
};

/** SVG path slices for a pie of radius 1 centred at the origin. */
/** Mean ancestry share per tribe over the living population. */
export const meanAncestry = (w: World): number[] => {
  const sum = w.tribes.map(() => 0);
  for (const a of w.actors) for (let i = 0; i < sum.length; i++) sum[i] += a.ancestry[i] ?? 0;
  return sum.map((v) => (w.actors.length ? v / w.actors.length : 0));
};

/** Pie plus legend of the population's mean ancestry. */
export const ancestryBreakdown = (w: World, size: number): string => {
  const mean = meanAncestry(w);
  const rows = w.tribes
    .map((t, i) => ({ t, v: mean[i] }))
    .sort((a, b) => b.v - a.v)
    .map(({ t, v }) => `<span class="anc-item"><span class="swatch" style="background:${t.color}"></span>${esc(t.name)} <b>${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0).replace('.', ',')} %</b></span>`)
    .join('');
  return `<svg viewBox="-1 -1 2 2" width="${size}" height="${size}" class="pie">${pieSlices(mean, w.tribes.map((t) => t.color))}</svg>${rows}`;
};

export const pieSlices = (anc: number[], colors: string[]): string => {
  const parts: string[] = [];
  let a0 = -Math.PI / 2;
  anc.forEach((v, i) => {
    if (v <= 0.0005) return;
    if (v >= 0.9995) {
      parts.push(`<circle r="1" fill="${colors[i]}"/>`);
      return;
    }
    const a1 = a0 + v * Math.PI * 2;
    const large = v > 0.5 ? 1 : 0;
    parts.push(
      `<path d="M0,0 L${Math.cos(a0)},${Math.sin(a0)} A1,1 0 ${large} 1 ${Math.cos(a1)},${Math.sin(a1)} Z" fill="${colors[i]}"/>`,
    );
    a0 = a1;
  });
  return parts.join('');
};

/** "(f 120 – d 980)", or "(f 120)" while alive at `atTick`. */
export const lifeSpanText = (reg: Registry, id: number, atTick: number): string => {
  const r = reg.get(id);
  if (!r) return '';
  const d = reg.death(id, atTick);
  return d ? `(f ${r.born} – d ${d.tick})` : `(f ${r.born})`;
};

export interface InspectorHooks {
  /** Navigate to another actor (from a link). */
  select: (id: number) => void;
  /** Back to the previously shown actor. */
  back: () => void;
  /** Pause and seek to a tick where the actor is alive. */
  goToLife: (id: number) => void;
}

export class Inspector {
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: InspectorHooks,
  ) {
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]');
      if (act?.dataset.act === 'back') return this.hooks.back();
      if (act?.dataset.act === 'life') return this.hooks.goToLife(Number(act.dataset.target));
      const el = t.closest<HTMLElement>('[data-id]');
      if (el) this.hooks.select(Number(el.dataset.id));
    });
  }

  render(w: World, reg: Registry, id: number | null, canGoBack = false): void {
    const backBtn = canGoBack ? `<button data-act="back" class="nav-back" title="Tilbake til forrige aktør">← Tilbake</button>` : '';
    if (id === null) {
      this.root.innerHTML = `${backBtn}<h3>Avstamning i bestanden</h3>
        <p class="muted">Gjennomsnittlig andel fra hver stamme blant de ${w.actors.length} levende.</p>
        <div class="ancestry-overall">${ancestryBreakdown(w, 72)}</div>
        <p class="muted">Klikk på en aktør i verdenen for å se detaljer og slektskap.</p>
        <p class="muted">● hunn &nbsp; ◆ hann. Gjennomsiktighet viser energinivå. Rød strek: angriper → mål. Gul kant: flykter. Hvitt blink: treff. Stiplet rosa strek: søker partner. Grønn: paret seg. Grå med kryss: avvist, krysset står ved den som sa nei. Hvit prikk: gravid. Symboler over aktørene (fra 2× zoom, alltid for valgt aktør): ⚔ angriper, ! blir angrepet, ↯ flykter, ♥ kurtiserer eller kurtiseres, ✿ gravid. Pilen på den røde streken peker mot den som blir angrepet. Blå prikket strek: far som passer på den gravide. Farget stiplet ring: syk (fargen viser sykdommen).</p>
        <p class="muted">Rull for å zoome, dra for å flytte, dobbeltklikk for å vise hele verdenen. Fra ${DETAIL_ZOOM}× zoom vises avstamning som kakediagram og helse som en bar.</p>`;
      return;
    }
    const rec = reg.get(id);
    if (!rec || rec.born > w.tick) {
      this.root.innerHTML = `${backBtn}<p class="muted">${rec ? `${esc(fullName(rec))} ${lifeSpanText(reg, id, Infinity)} er ikke født på tick ${w.tick}.` : `Aktør #${id} finnes ikke i denne grenen.`}</p>
        ${rec ? `<button data-act="life" data-target="${id}" class="primary">Spol til levetiden</button>` : ''}`;
      return;
    }
    const live = w.actors.find((a) => a.id === id);
    const death = reg.death(id, w.tick);
    const link = (x: number) => {
      const r = reg.get(x);
      if (!r) return `#${x}`;
      const dead = !w.actors.some((a) => a.id === x);
      return `<a data-id="${x}" class="${dead ? 'dead' : ''}" style="--c:${surnameColor(w, r.surname)}">${esc(fullName(r))} <span class="life">${lifeSpanText(reg, x, w.tick)}</span></a>`;
    };
    const list = (ids: number[]) => (ids.length ? ids.map(link).join(' ') : '<span class="muted">ingen</span>');

    const children = reg.childrenOf(id, w.tick);
    const siblings = reg.siblingsOf(id, w.tick);
    const parentsOf = (x: number) => reg.get(x)?.parents;
    const sibLabel = (s: number) => {
      const k = kinship(id, s, parentsOf, 1);
      return k?.relation === 'fullSibling';
    };
    const full = siblings.filter(sibLabel);
    const half = siblings.filter((s) => !sibLabel(s));

    const genome = live?.genome ?? rec.genome;
    const dominance = live?.dominance ?? rec.dominance;
    const genes =
      `<tr class="head"><td></td><td class="num">verdi</td><td></td><td class="num" title="Arvestyrke: hvor sterkt egenskapen slår igjennom hos barna (0,05–1)">arv</td></tr>` +
      GENE_KEYS.map(
        (k) => `<tr><td>${GENE_LABELS[k]}</td><td class="num">${genome[k].toFixed(2)}</td>
        <td><div class="bar"><span style="width:${(normGene(k, genome[k]) * 100).toFixed(0)}%"></span></div></td>
        <td class="num dom" title="Arvestyrke">${dominance[k].toFixed(2)}</td></tr>`,
      ).join('');

    const counts = new Map<Relation, number>();
    const anc = ancestors(id, 3, parentsOf);
    for (const a of w.actors) {
      if (a.id === id) continue;
      const k = kinship(id, a.id, parentsOf, 3, anc);
      if (k) counts.set(k.relation, (counts.get(k.relation) ?? 0) + 1);
    }
    const kinSummary = [...counts.entries()].map(([r, n]) => `${n} ${RELATION_LABELS[r]}`).join(', ');

    const status = live
      ? `lever · alder ${live.age}${vigorOf(live, w.rules) < 0.995 ? ` (svekket ${Math.round((1 - vigorOf(live, w.rules)) * 100)} %)` : ''} · energi ${live.energy.toFixed(0)}/${capacityOf(live, w.rules).toFixed(0)} · helse ${Math.max(0, live.hp).toFixed(0)}/${maxHpOf(live, w.rules).toFixed(0)}`
      : death
        ? `død tick ${death.tick} (${CAUSE_LABELS[death.cause]}${death.killer !== undefined ? ` av ${link(death.killer)}` : ''}${death.disease !== undefined && w.diseases?.[death.disease] ? `: ${esc(w.diseases[death.disease].name)}` : ''})`
        : 'ikke i live';

    const ancestry = live?.ancestry ?? rec.ancestry;
    const ancRows = w.tribes
      .map((t, i) => ({ t, v: ancestry[i] ?? 0 }))
      .filter((x) => x.v > 0.0005)
      .sort((a, b) => b.v - a.v)
      .map(({ t, v }) => `<li><span class="swatch" style="background:${t.color}"></span>${esc(t.name)} ${(v * 100).toFixed(v < 0.1 ? 1 : 0).replace('.', ',')} %</li>`)
      .join('');

    let conflict = '';
    if (live) {
      const parts = [
        `skade gitt ${live.damageDealt.toFixed(0)}`,
        `tatt ${live.damageTaken.toFixed(0)}`,
        `drap ${live.kills}`,
      ];
      const attackers = w.actors.filter((x) => x.target === live.id).map((x) => x.id);
      if (attackers.length) parts.unshift(`<strong>angripes av</strong> ${attackers.map(link).join(', ')}`);
      if (live.target !== null) parts.unshift(`<strong>angriper</strong> ${link(live.target)} →`);
      else if (live.fleeing > 0) parts.unshift(`<strong>flykter</strong>${live.fleeFrom !== null ? ` fra ${link(live.fleeFrom)}` : ''}`);
      conflict = `<dt>Kamp</dt><dd>${parts.join(' · ')}</dd>`;
      const court = live.court;
      let courtText = '';
      if (court && court.selfAccepted && court.otherAccepted) courtText = `paret seg med ${link(court.with)}`;
      else if (court) {
        const parts: string[] = [];
        if (!court.selfAccepted) parts.push(`avviste ${link(court.with)}`);
        if (!court.otherAccepted) parts.push(`ble avvist av ${link(court.with)}`);
        courtText = parts.join(' og ');
      } else if (live.mateTarget !== null) courtText = `kurtiserer ${link(live.mateTarget)}`;
      const suitors = w.actors.filter((x) => x.mateTarget === live.id).map((x) => x.id);
      if (suitors.length) courtText += `${courtText ? ' · ' : ''}kurtiseres av ${suitors.map(link).join(', ')}`;
      if (courtText) conflict += `<dt>Partner</dt><dd>${courtText}</dd>`;
      if (live.pregnancy) {
        const p = live.pregnancy;
        const n = p.embryos.length;
        conflict += `<dt>Gravid</dt><dd>${n === 1 ? 'ett barn' : n === 2 ? 'tvillinger' : n === 3 ? 'trillinger' : `${n} barn`} med ${link(p.father)} · termin tick ${p.due} · betalt ${p.motherPaid.toFixed(0)}/${p.motherNeed.toFixed(0)} energi</dd>`;
      }
      if (live.caresFor !== null) conflict += `<dt>Omsorg</dt><dd>passer på ${link(live.caresFor)} til fødselen</dd>`;
      const dz = w.diseases ?? [];
      if (live.infection && dz[live.infection.disease]) {
        const d = dz[live.infection.disease];
        conflict += `<dt>Syk</dt><dd><span style="color:${d.color}">${esc(d.name)}</span> · ${live.infection.left} ticks igjen</dd>`;
      }
      const immune = Object.entries(live.immunity ?? {})
        .filter(([, until]) => until > w.tick)
        .map(([id, until]) => (dz[Number(id)] ? `${esc(dz[Number(id)].name)} (til tick ${Math.round(until)})` : ''))
        .filter(Boolean);
      if (immune.length) conflict += `<dt>Immun mot</dt><dd>${immune.join(', ')}</dd>`;
    }

    this.root.innerHTML = `${backBtn}
      <h2 style="--c:${surnameColor(w, rec.surname)}"><span class="sex">${rec.sex === 'F' ? '♀' : '♂'}</span> ${esc(fullName(rec))} <span class="life">${lifeSpanText(reg, id, w.tick)}</span></h2>
      ${live ? '' : `<button data-act="life" data-target="${id}" class="primary" title="Pause og spol tilbake til et tidspunkt der aktøren lever">Spol til levetiden</button>`}
      <p class="muted">Generasjon ${rec.generation} · født tick ${rec.born} · ${status}</p>
      <div class="ancestry">
        <svg viewBox="-1 -1 2 2" class="pie">${pieSlices(ancestry, w.tribes.map((t) => t.color))}</svg>
        <div><strong>Avstamning</strong> <span class="muted">renhet ${(purity(ancestry) * 100).toFixed(0)} %</span><ul>${ancRows}</ul></div>
      </div>
      <table class="genes">${genes}</table>
      <dl>
        ${conflict}
        <dt>Foreldre</dt><dd>${rec.parents ? list(rec.parents) : '<span class="muted">seed</span>'}</dd>
        <dt>Helsøsken</dt><dd>${list(full)}</dd>
        <dt>Halvsøsken</dt><dd>${list(half)}</dd>
        <dt>Barn (${children.length})</dt><dd>${list(children)}</dd>
        <dt>Levende slekt</dt><dd>${kinSummary || '<span class="muted">ingen innen 3 ledd</span>'}</dd>
      </dl>
      <h3>Stamtre</h3>
      <div class="tree"></div>`;
    this.renderTree(this.root.querySelector('.tree')!, w, reg, rec, children);
  }

  private renderTree(el: HTMLElement, w: World, reg: Registry, rec: LifeRecord, children: number[]): void {
    const parents = rec.parents ?? [];
    const grand = parents.flatMap((p) => reg.get(p)?.parents ?? []);
    const levels: number[][] = [grand, parents, [rec.id], children.slice(0, 10)].filter((l) => l.length);
    const W = 320;
    const rowH = 46;
    const H = levels.length * rowH;
    const pos = new Map<number, { x: number; y: number }>();
    levels.forEach((ids, li) => ids.forEach((id, i) => pos.set(id, { x: ((i + 0.5) * W) / ids.length, y: li * rowH + 20 })));

    const edges: [number, number][] = [];
    for (const id of pos.keys()) for (const p of reg.get(id)?.parents ?? []) if (pos.has(p)) edges.push([p, id]);

    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
    svg
      .selectAll('path')
      .data(edges)
      .join('path')
      .attr('class', 'edge')
      .attr('d', ([a, b]) => {
        const p = pos.get(a)!;
        const c = pos.get(b)!;
        return `M${p.x},${p.y + 8} C${p.x},${(p.y + c.y) / 2} ${c.x},${(p.y + c.y) / 2} ${c.x},${c.y - 8}`;
      });
    const nodes = svg
      .selectAll('g.node')
      .data([...pos.keys()])
      .join('g')
      .attr('class', (id) => `node${id === rec.id ? ' self' : ''}${w.actors.some((a) => a.id === id) ? '' : ' dead'}`)
      .attr('data-id', (id) => id)
      .attr('transform', (id) => `translate(${pos.get(id)!.x},${pos.get(id)!.y})`);
    nodes
      .append('rect')
      .attr('x', -38)
      .attr('y', -9)
      .attr('width', 76)
      .attr('height', 18)
      .attr('rx', 4)
      .attr('fill', (id) => surnameColor(w, reg.get(id)!.surname, 35));
    nodes
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 4)
      .text((id) => {
        const r = reg.get(id)!;
        return `${r.sex === 'F' ? '♀' : '♂'} ${r.given.slice(0, 7)} #${r.id}`;
      });
  }
}
