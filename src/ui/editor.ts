import { clampGene, DOMINANCE_RANGE, GENE_LABELS } from '../sim/genome';
import { infect, newDisease } from '../sim/disease';
import { mainTribe } from '../sim/tribes';
import { clamp } from '../sim/random';
import { fullName, uniqueSurnames } from '../sim/names';
import {
  KIN_WEIGHT_LABELS,
  KIN_WEIGHTS_DESCRIPTION,
  RULE_FIELDS,
  SURNAME_RULE_DESCRIPTION,
  SURNAME_RULE_LABELS,
  TRIBE_BONUS_DESCRIPTION,
} from '../sim/rules';
import { GENE_KEYS, type GeneKey, type KinWeights, type Rules, type Tribe, type World } from '../sim/types';
import { assignHues, spawnSeed } from '../sim/world';

const fmt = (v: number) => String(Number(v.toFixed(4)));
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------------------------------------
// Rules form

export type RuleChange = (apply: (r: Rules) => void, description: string) => void;

export class RulesPanel {
  private current: Rules | null = null;
  private tribes: Tribe[] = [];
  private tribesKey = '';

  /** Whether every rule change outside the editor forks a new branch (persisted per browser). */
  get branchOnChange(): boolean {
    return this.root.querySelector<HTMLInputElement>('.branch-on-change')!.checked;
  }

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: RuleChange,
  ) {
    // Each field: label, a "?" toggle and the input on one row; the description below, hidden
    // until toggled. The description is also the row's hover tooltip.
    const field = (label: string, control: string, description: string) => `
      <div class="field" title="${escAttr(description)}">
        <div class="field-row">
          <span>${label}</span>
          <button type="button" class="info" aria-label="Vis beskrivelse av ${escAttr(label)}">?</button>
          ${control}
        </div>
        <p class="help" hidden>${description}</p>
      </div>`;
    const groups = RULE_FIELDS.map(
      (g) => `<fieldset><legend>${g.group}</legend>${g.fields
        .map((f) =>
          field(
            f.label,
            `<input type="number" aria-label="${escAttr(f.label)}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}">`,
            f.description,
          ),
        )
        .join('')}</fieldset>`,
    ).join('');
    const surname = field(
      'Etternavn arves fra',
      `<select aria-label="Etternavn arves fra" data-key="surnameRule">${Object.entries(SURNAME_RULE_LABELS)
        .map(([v, l]) => `<option value="${v}">${l}</option>`)
        .join('')}</select>`,
      SURNAME_RULE_DESCRIPTION,
    );
    const kin = Object.entries(KIN_WEIGHT_LABELS)
      .map(
        ([k, l]) =>
          `<div class="field-row"><span>${l}</span><input type="number" aria-label="Slektsvekt ${escAttr(l)}" step="0.05" min="0" max="3" data-kin="${k}"></div>`,
      )
      .join('');
    root.innerHTML = `<p class="muted">Ved enden av grenen endres reglene i samme gren fra og med tidspunktet som vises, og endringen merkes på tidslinjen. Ser du på et tidligere tidspunkt, lages en ny gren, siden tickene etter ellers ville blitt ugyldige. Når du redigerer en gren, endres utkastet. Hold musepekeren over en regel eller klikk ? for å se hva den gjør.</p>
      <label class="check"><input type="checkbox" class="branch-on-change"> Lag alltid ny gren ved regelendring</label>
      <label class="check"><input type="checkbox" class="show-all-help"> Vis alle beskrivelser</label>
      <fieldset class="tribe-bonus"><legend>Attraktivitet per avstamning</legend>
        <p class="help">${TRIBE_BONUS_DESCRIPTION}</p>
        <div class="bonus-rows"></div>
      </fieldset>
      ${groups}
      <fieldset><legend>Arv</legend>${surname}</fieldset>
      <fieldset><legend>Slektsvekter (tas i bruk i v3)</legend>
        <p class="help">${KIN_WEIGHTS_DESCRIPTION}</p>
        ${kin}
      </fieldset>`;

    const branchBox = root.querySelector<HTMLInputElement>('.branch-on-change')!;
    try {
      branchBox.checked = localStorage.getItem('popsim.branchOnRuleChange') === '1';
    } catch {
      /* storage unavailable: keep the default (off) */
    }
    branchBox.addEventListener('change', () => {
      try {
        localStorage.setItem('popsim.branchOnRuleChange', branchBox.checked ? '1' : '0');
      } catch {
        /* ignore */
      }
    });

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.info');
      if (!btn) return;
      const help = btn.closest('.field')!.querySelector<HTMLElement>('.help')!;
      help.hidden = !help.hidden;
      btn.classList.toggle('on', !help.hidden);
    });
    root.querySelector<HTMLInputElement>('.show-all-help')!.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      for (const f of root.querySelectorAll<HTMLElement>('.field')) {
        f.querySelector<HTMLElement>('.help')!.hidden = !on;
        f.querySelector('button.info')!.classList.toggle('on', on);
      }
    });

    root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.dataset.key === 'surnameRule') {
        const v = el.value as Rules['surnameRule'];
        this.onChange((r) => (r.surnameRule = v), `Regel: etternavn arves fra ${SURNAME_RULE_LABELS[v].toLowerCase()}`);
      } else if (el.dataset.key) {
        const key = el.dataset.key as keyof Rules;
        const field = RULE_FIELDS.flatMap((g) => g.fields).find((f) => f.key === key)!;
        const v = Number(el.value);
        if (!Number.isFinite(v)) return;
        this.onChange((r) => {
          (r[key] as number) = v;
        }, `Regel: ${field.label} ${this.current ? fmt(this.current[key] as number) : '?'} → ${fmt(v)}`);
      } else if (el.dataset.bonus !== undefined) {
        const i = Number(el.dataset.bonus);
        const v = Number(el.value);
        if (!Number.isFinite(v)) return;
        const old = fmt(this.current?.tribeBonus?.[i] ?? 0);
        const name = this.tribes[i]?.name ?? `stamme ${i + 1}`;
        this.onChange((r) => {
          const next = this.tribes.map((_, j) => r.tribeBonus?.[j] ?? 0);
          next[i] = v;
          r.tribeBonus = next;
        }, `Attraktivitet: ${name} ${old} → ${fmt(v)}`);
      } else if (el.dataset.kin) {
        const key = el.dataset.kin as keyof KinWeights;
        const v = Number(el.value);
        if (!Number.isFinite(v)) return;
        const old = this.current ? fmt(this.current.kinWeights[key]) : '?';
        this.onChange((r) => (r.kinWeights[key] = v), `Slektsvekt: ${KIN_WEIGHT_LABELS[key]} ${old} → ${fmt(v)}`);
      }
    });
  }

  /** Shows the given rules, leaving the focused input alone. */
  show(rules: Rules, tribes: Tribe[]): void {
    this.current = rules;
    const key = tribes.map((t) => t.name + t.color).join('|');
    if (key !== this.tribesKey) {
      this.tribes = tribes;
      this.tribesKey = key;
      this.root.querySelector('.bonus-rows')!.innerHTML = tribes
        .map(
          (t, i) =>
            `<div class="field-row"><span><span class="swatch" style="background:${t.color}"></span>${escAttr(t.name)}</span><input type="number" aria-label="Attraktivitet ${escAttr(t.name)}" step="0.1" min="-5" max="5" data-bonus="${i}"></div>`,
        )
        .join('');
    }
    const focused = document.activeElement;
    for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-bonus]')) {
      if (el === focused) continue;
      const s = fmt(rules.tribeBonus?.[Number(el.dataset.bonus)] ?? 0);
      if (el.value !== s) el.value = s;
    }
    for (const el of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key],[data-kin]')) {
      if (el === focused) continue;
      const v = el.dataset.key
        ? (rules as unknown as Record<string, number | string>)[el.dataset.key]
        : rules.kinWeights[el.dataset.kin as keyof KinWeights];
      const s = typeof v === 'number' ? fmt(v) : String(v);
      if (el.value !== s) el.value = s;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Branch editor

export type BrushMode = 'clearFood' | 'fillFood' | 'lessFertile' | 'moreFertile';

const BRUSH_LABELS: Record<BrushMode, string> = {
  clearFood: 'tøm mat',
  fillFood: 'fyll mat',
  lessFertile: 'mindre fruktbar',
  moreFertile: 'mer fruktbar',
};

export interface EditorHooks {
  commit: (name: string) => void;
  cancel: () => void;
  changed: () => void;
}

export class BranchEditor {
  draft: World | null = null;
  changes: string[] = [];
  brushOn = false;
  brushMode: BrushMode = 'clearFood';
  brushRadius = 40;
  private strokes: Partial<Record<BrushMode, number>> = {};
  private selectedId: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: EditorHooks,
  ) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'brushOn') this.brushOn = el.checked;
      if (el.name === 'brushMode') this.brushMode = el.value as BrushMode;
      if (el.name === 'brushRadius') this.brushRadius = Number(el.value);
    });
  }

  get active(): boolean {
    return this.draft !== null;
  }

  start(draft: World): void {
    this.draft = draft;
    this.changes = [];
    this.strokes = {};
    this.brushOn = false;
    this.renderAll();
  }

  stop(): void {
    this.draft = null;
    this.root.innerHTML = '';
  }

  log(change: string): void {
    this.changes.push(change);
    this.renderChanges();
    this.hooks.changed();
  }

  /** Final list of changes including summarised brush strokes. */
  allChanges(): string[] {
    const brush = Object.entries(this.strokes).map(
      ([m, n]) => `Miljø: ${BRUSH_LABELS[m as BrushMode]} (${n} strøk)`,
    );
    return [...this.changes, ...brush];
  }

  setSelected(id: number | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    if (this.draft) this.renderActor();
  }

  paint(x: number, y: number): void {
    const w = this.draft;
    if (!w) return;
    const r2 = this.brushRadius ** 2;
    for (let row = 0; row < w.rows; row++) {
      for (let col = 0; col < w.cols; col++) {
        const cx = (col + 0.5) * w.cellSize;
        const cy = (row + 0.5) * w.cellSize;
        if ((cx - x) ** 2 + (cy - y) ** 2 > r2) continue;
        const i = row * w.cols + col;
        switch (this.brushMode) {
          case 'clearFood': w.food[i] = 0; break;
          case 'fillFood': w.food[i] = 1; break;
          case 'lessFertile': w.fertility[i] = Math.max(0, w.fertility[i] - 0.1); break;
          case 'moreFertile': w.fertility[i] = Math.min(1.5, w.fertility[i] + 0.1); break;
        }
      }
    }
  }

  endStroke(): void {
    this.strokes[this.brushMode] = (this.strokes[this.brushMode] ?? 0) + 1;
    this.renderChanges();
  }

  private renderAll(): void {
    const geneOptions =
      GENE_KEYS.map((k) => `<option value="${k}">${GENE_LABELS[k]}</option>`).join('') +
      GENE_KEYS.map((k) => `<option value="dom:${k}">Arvestyrke: ${GENE_LABELS[k].toLowerCase()}</option>`).join('');
    const brushOptions = Object.entries(BRUSH_LABELS)
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join('');
    this.root.innerHTML = `
      <div class="editor-head">
        <strong>Ny gren fra tick ${this.draft!.tick}</strong>
        <p class="muted">Endre regler (fanen Regler), populasjon, én aktør eller miljøet. Start grenen når du er ferdig.</p>
      </div>
      <fieldset><legend>Populasjon</legend>
        <div class="row">
          <select name="popGene">${geneOptions}</select>
          <select name="popOp"><option value="set">sett til</option><option value="mul">gang med</option><option value="add">legg til</option></select>
          <input name="popValue" type="number" step="0.05" value="1">
        </div>
        <div class="row">
          <select name="popClan"></select>
          <button data-act="pop">Bruk</button>
        </div>
        <div class="row">
          <input name="seedCount" type="number" min="1" max="200" value="5">
          <select name="seedTribe">${this.draft!.tribes.map((t, i) => `<option value="${i}">${t.name}</option>`).join('')}</select>
          <button data-act="seeds">Legg til seeds</button>
        </div>
      </fieldset>
      <fieldset class="actor-edit"><legend>Valgt aktør</legend><div class="actor-body"></div></fieldset>
      <fieldset><legend>Miljø</legend>
        <label class="check"><input type="checkbox" name="brushOn"> Pensel aktiv (dra i verdenen)</label>
        <div class="row">
          <select name="brushMode">${brushOptions}</select>
          <input name="brushRadius" type="range" min="10" max="150" value="${this.brushRadius}">
        </div>
      </fieldset>
      <fieldset><legend>Endringer</legend><ul class="changes"></ul></fieldset>
      <div class="row">
        <input name="branchName" type="text" placeholder="Navn på gren (valgfritt)">
      </div>
      <div class="row">
        <button data-act="commit" class="primary">Start gren</button>
        <button data-act="cancel">Avbryt</button>
      </div>`;
    this.renderClans();
    this.renderActor();
    this.renderChanges();
  }

  private renderClans(): void {
    const sel = this.root.querySelector<HTMLSelectElement>('[name=popClan]')!;
    const clans = [...new Set(this.draft!.actors.map((a) => a.surname))].sort();
    sel.innerHTML =
      `<option value="">alle</option>` +
      this.draft!.tribes.map((t, i) => `<option value="tribe:${i}">stamme: ${t.name} (største andel)</option>`).join('') +
      clans.map((c) => `<option value="${c}">klan: ${c}</option>`).join('');
  }

  private renderActor(): void {
    const body = this.root.querySelector('.actor-body');
    if (!body) return;
    const a = this.draft?.actors.find((x) => x.id === this.selectedId);
    if (!a) {
      body.innerHTML = '<p class="muted">Klikk på en levende aktør for å endre den.</p>';
      return;
    }
    body.innerHTML = `<p>${fullName(a)}</p>
      ${GENE_KEYS.map(
        (k) => `<label><span>${GENE_LABELS[k]}</span><input type="number" step="0.01" data-gene="${k}" value="${fmt(a.genome[k])}"></label>`,
      ).join('')}
      ${GENE_KEYS.map(
        (k) => `<label><span>Arvestyrke: ${GENE_LABELS[k].toLowerCase()}</span><input type="number" step="0.05" min="${DOMINANCE_RANGE[0]}" max="${DOMINANCE_RANGE[1]}" data-dom="${k}" value="${fmt(a.dominance[k])}"></label>`,
      ).join('')}
      <label><span>Energi</span><input type="number" step="1" data-field="energy" value="${a.energy.toFixed(0)}"></label>
      <label><span>Kjønn</span><select data-field="sex"><option value="F"${a.sex === 'F' ? ' selected' : ''}>hunn</option><option value="M"${a.sex === 'M' ? ' selected' : ''}>hann</option></select></label>
      <div class="row"><button data-act="actor">Bruk</button><button data-act="remove">Fjern aktør</button></div>
      <div class="row"><button data-act="outbreak" title="Smitter aktøren med en ny, tilfeldig sykdom">Start sykdomsutbrudd her</button></div>`;
  }

  private renderChanges(): void {
    const ul = this.root.querySelector('.changes');
    if (!ul) return;
    const all = this.allChanges();
    ul.innerHTML = all.length ? all.map((c) => `<li>${c}</li>`).join('') : '<li class="muted">ingen ennå</li>';
  }

  private val(name: string): string {
    return this.root.querySelector<HTMLInputElement>(`[name=${name}]`)!.value;
  }

  private onClick(e: Event): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const w = this.draft;
    if (!act || !w) return;
    switch (act) {
      case 'pop': {
        const target = this.val('popGene');
        const isDom = target.startsWith('dom:');
        const gene = (isDom ? target.slice(4) : target) as GeneKey;
        const op = this.val('popOp');
        const v = Number(this.val('popValue'));
        const clan = this.val('popClan');
        if (!Number.isFinite(v)) return;
        const tribeIdx = clan.startsWith('tribe:') ? Number(clan.slice(6)) : -1;
        const matches = (a: World['actors'][number]) =>
          !clan || (tribeIdx >= 0 ? mainTribe(a.ancestry) === tribeIdx : a.surname === clan);
        const scope = !clan ? 'alle' : tribeIdx >= 0 ? `stamme ${w.tribes[tribeIdx].name}` : `klan ${clan}`;
        const applyOp = (cur: number) => (op === 'set' ? v : op === 'mul' ? cur * v : cur + v);
        let n = 0;
        for (const a of w.actors) {
          if (!matches(a)) continue;
          if (isDom) a.dominance[gene] = clamp(applyOp(a.dominance[gene]), DOMINANCE_RANGE[0], DOMINANCE_RANGE[1]);
          else a.genome[gene] = clampGene(gene, applyOp(a.genome[gene]));
          n++;
        }
        const opText = op === 'set' ? 'satt til' : op === 'mul' ? 'ganget med' : 'lagt til';
        const label = isDom ? `Arvestyrke for ${GENE_LABELS[gene].toLowerCase()}` : GENE_LABELS[gene];
        this.log(`Populasjon: ${label} ${opText} ${fmt(v)} (${scope}, ${n} aktører)`);
        this.renderActor();
        break;
      }
      case 'seeds': {
        const n = Math.max(1, Math.min(200, Number(this.val('seedCount')) || 0));
        const tribe = Number(this.val('seedTribe'));
        const names = uniqueSurnames(n, Object.keys(w.surnameHues));
        assignHues(w, names, tribe);
        for (const surname of names) spawnSeed(w, { surname, tribe });
        this.log(`La til ${n} nye seeds fra stammen ${w.tribes[tribe].name}`);
        this.renderClans();
        break;
      }
      case 'actor': {
        const a = w.actors.find((x) => x.id === this.selectedId);
        if (!a) return;
        const diffs: string[] = [];
        for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-gene]')) {
          const k = el.dataset.gene as GeneKey;
          const v = clampGene(k, Number(el.value));
          if (Number.isFinite(v) && Math.abs(v - a.genome[k]) > 1e-9) {
            diffs.push(`${GENE_LABELS[k]} ${fmt(a.genome[k])} → ${fmt(v)}`);
            a.genome[k] = v;
          }
        }
        for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-dom]')) {
          const k = el.dataset.dom as GeneKey;
          const v = clamp(Number(el.value), DOMINANCE_RANGE[0], DOMINANCE_RANGE[1]);
          if (Number.isFinite(v) && Math.abs(v - a.dominance[k]) > 1e-9) {
            diffs.push(`arvestyrke ${GENE_LABELS[k].toLowerCase()} ${fmt(a.dominance[k])} → ${fmt(v)}`);
            a.dominance[k] = v;
          }
        }
        const energy = Number(this.root.querySelector<HTMLInputElement>('[data-field=energy]')!.value);
        if (Number.isFinite(energy) && Math.abs(energy - a.energy) >= 0.5) {
          diffs.push(`energi ${a.energy.toFixed(0)} → ${energy.toFixed(0)}`);
          a.energy = energy;
        }
        const sex = this.root.querySelector<HTMLSelectElement>('[data-field=sex]')!.value as 'F' | 'M';
        if (sex !== a.sex) {
          diffs.push(`kjønn → ${sex === 'F' ? 'hunn' : 'hann'}`);
          a.sex = sex;
        }
        if (diffs.length) this.log(`Aktør ${fullName(a)}: ${diffs.join(', ')}`);
        this.renderActor();
        break;
      }
      case 'outbreak': {
        const a = w.actors.find((x) => x.id === this.selectedId);
        if (!a) return;
        if (!w.diseases) w.diseases = [];
        const d = newDisease(w, `startet i grenredigering hos ${fullName(a)}`);
        infect(a, d);
        this.log(`Sykdomsutbrudd: ${d.name} hos ${fullName(a)}`);
        break;
      }
      case 'remove': {
        const a = w.actors.find((x) => x.id === this.selectedId);
        if (!a) return;
        w.actors = w.actors.filter((x) => x !== a);
        this.log(`Fjernet aktør ${fullName(a)}`);
        this.renderActor();
        break;
      }
      case 'commit':
        this.hooks.commit(this.val('branchName').trim());
        break;
      case 'cancel':
        this.hooks.cancel();
        break;
    }
  }
}
