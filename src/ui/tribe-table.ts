import { clampGene, DOMINANCE_RANGE, GENE_LABELS } from '../sim/genome';
import { clamp } from '../sim/random';
import type { GeneKey, Tribe } from '../sim/types';

/** Genes set per tribe in the dialog; the rest are copied from the first default tribe. */
const COLUMNS: GeneKey[] = ['size', 'maxSpeed', 'vision', 'aggression', 'longevity'];
const PALETTE = ['#c77dff', '#ff9f43', '#2ec4b6', '#f15bb5', '#9aa0a8'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Editable table of starting tribes in the "Ny kjøring" dialog. */
export class TribeTable {
  private tribes: Tribe[] = [];

  constructor(
    private readonly root: HTMLElement,
    initial: Tribe[],
  ) {
    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
      if (!btn) return;
      this.tribes = this.read();
      this.tribes.splice(Number(btn.dataset.remove), 1);
      this.render();
    });
    this.set(initial);
  }

  set(tribes: Tribe[]): void {
    this.tribes = structuredClone(tribes);
    this.render();
  }

  add(): void {
    this.tribes = this.read();
    const template = this.tribes[0];
    const n = this.tribes.length;
    this.tribes.push({
      name: `Stamme ${n + 1}`,
      color: PALETTE.find((c) => !this.tribes.some((t) => t.color === c)) ?? PALETTE[n % PALETTE.length],
      genome: template ? { ...template.genome } : { size: 1.5, maxSpeed: 1.6, vision: 70, aggression: 0.4, longevity: 1, diet: 0.5, fidelity: 0.6, reproThreshold: 0.65, mutationRate: 0.1 },
      heritability: 0.5,
      seeds: 5,
    });
    this.render();
  }

  /** Current table values, clamped to valid ranges. */
  read(): Tribe[] {
    return this.tribes.map((t, i) => {
      const row = this.root.querySelector<HTMLElement>(`tr[data-i="${i}"]`);
      if (!row) return t;
      const v = (k: string) => row.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!.value;
      const genome = { ...t.genome };
      for (const k of COLUMNS) {
        const x = Number(v(k));
        if (Number.isFinite(x)) genome[k] = clampGene(k, x);
      }
      const her = Number(v('heritability'));
      const seeds = Number(v('seeds'));
      return {
        name: v('name').trim() || t.name,
        color: v('color'),
        genome,
        heritability: Number.isFinite(her) ? clamp(her, DOMINANCE_RANGE[0], DOMINANCE_RANGE[1]) : t.heritability,
        seeds: Number.isFinite(seeds) ? clamp(Math.round(seeds), 0, 200) : t.seeds,
      };
    });
  }

  private render(): void {
    const head = ['Navn', 'Farge', 'Seeds', ...COLUMNS.map((k) => GENE_LABELS[k]), 'Arvelighet', ''];
    this.root.innerHTML = `<table>
      <tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>
      ${this.tribes
        .map(
          (t, i) => `<tr data-i="${i}">
        <td><input data-k="name" type="text" value="${esc(t.name)}" size="8"></td>
        <td><input data-k="color" type="color" value="${t.color}"></td>
        <td><input data-k="seeds" type="number" min="0" max="200" step="1" value="${t.seeds}"></td>
        ${COLUMNS.map((k) => `<td><input data-k="${k}" type="number" step="${k === 'vision' ? 5 : 0.1}" value="${t.genome[k]}"></td>`).join('')}
        <td><input data-k="heritability" type="number" min="0.05" max="1" step="0.05" value="${t.heritability}"></td>
        <td><button type="button" data-remove="${i}" title="Fjern stammen">✕</button></td>
      </tr>`,
        )
        .join('')}
    </table>`;
  }
}
