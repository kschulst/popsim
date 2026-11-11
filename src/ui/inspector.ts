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
import { GENE_KEYS, type World } from '../sim/types';
import { purity } from '../sim/tribes';
import { capacityOf, maxHpOf } from '../sim/world';
import { surnameColor } from './colors';
import { DETAIL_ZOOM } from './renderer';

const CAUSE_LABELS = { starvation: 'sult', age: 'alder', killed: 'drept', removed: 'fjernet ved forgreining' };

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
const pieSlices = (anc: number[], colors: string[]): string => {
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

export class Inspector {
  constructor(
    private readonly root: HTMLElement,
    private readonly onSelect: (id: number) => void,
  ) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (el) this.onSelect(Number(el.dataset.id));
    });
  }

  render(w: World, reg: Registry, id: number | null): void {
    if (id === null) {
      this.root.innerHTML = `<p class="muted">Klikk på en aktør i verdenen for å se detaljer og slektskap.</p>
        <p class="muted">● hunn &nbsp; ◆ hann. Gjennomsiktighet viser energinivå. Rød strek: angriper → mål. Gul kant: flykter. Hvitt blink: treff. Stiplet rosa strek: søker partner. Grønn: paret seg. Grå med kryss: avvist, krysset står ved den som sa nei. Hvit prikk: gravid. Blå prikket strek: far som passer på den gravide.</p>
        <p class="muted">Rull for å zoome, dra for å flytte, dobbeltklikk for å vise hele verdenen. Fra ${DETAIL_ZOOM}× zoom vises avstamning som kakediagram og helse som en bar.</p>`;
      return;
    }
    const rec = reg.get(id);
    if (!rec || rec.born > w.tick) {
      this.root.innerHTML = `<p class="muted">Aktør #${id} finnes ikke på dette tidspunktet.</p>`;
      return;
    }
    const live = w.actors.find((a) => a.id === id);
    const death = reg.death(id, w.tick);
    const link = (x: number) => {
      const r = reg.get(x);
      if (!r) return `#${x}`;
      const dead = !w.actors.some((a) => a.id === x);
      return `<a data-id="${x}" class="${dead ? 'dead' : ''}" style="--c:${surnameColor(w, r.surname)}">${esc(fullName(r))}</a>`;
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
      ? `lever · alder ${live.age} · energi ${live.energy.toFixed(0)}/${capacityOf(live, w.rules).toFixed(0)} · helse ${Math.max(0, live.hp).toFixed(0)}/${maxHpOf(live, w.rules).toFixed(0)}`
      : death
        ? `død tick ${death.tick} (${CAUSE_LABELS[death.cause]}${death.killer !== undefined ? ` av ${link(death.killer)}` : ''})`
        : 'ikke i live';

    const ancestry = live?.ancestry ?? rec.ancestry;
    const ancRows = w.tribes
      .map((t, i) => ({ t, v: ancestry[i] ?? 0 }))
      .filter((x) => x.v > 0.0005)
      .sort((a, b) => b.v - a.v)
      .map(({ t, v }) => `<li><span class="swatch" style="background:${t.color}"></span>${esc(t.name)} ${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %</li>`)
      .join('');

    let conflict = '';
    if (live) {
      const parts = [
        `skade gitt ${live.damageDealt.toFixed(0)}`,
        `tatt ${live.damageTaken.toFixed(0)}`,
        `drap ${live.kills}`,
      ];
      if (live.target !== null) parts.unshift(`<strong>slåss med</strong> ${link(live.target)}`);
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
      } else if (live.mateTarget !== null) courtText = `søker ${link(live.mateTarget)}`;
      if (courtText) conflict += `<dt>Partner</dt><dd>${courtText}</dd>`;
      if (live.pregnancy) {
        const p = live.pregnancy;
        const n = p.embryos.length;
        conflict += `<dt>Gravid</dt><dd>${n === 1 ? 'ett barn' : n === 2 ? 'tvillinger' : n === 3 ? 'trillinger' : `${n} barn`} med ${link(p.father)} · termin tick ${p.due} · betalt ${p.motherPaid.toFixed(0)}/${p.motherNeed.toFixed(0)} energi</dd>`;
      }
      if (live.caresFor !== null) conflict += `<dt>Omsorg</dt><dd>passer på ${link(live.caresFor)} til fødselen</dd>`;
    }

    this.root.innerHTML = `
      <h2 style="--c:${surnameColor(w, rec.surname)}"><span class="sex">${rec.sex === 'F' ? '♀' : '♂'}</span> ${esc(fullName(rec))}</h2>
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
