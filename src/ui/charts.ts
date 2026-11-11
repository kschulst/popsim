import * as d3 from 'd3';
import { GENE_LABELS, GENE_RANGES } from '../sim/genome';
import { GENE_KEYS, type TickStats, type Tribe } from '../sim/types';

interface Series {
  label: string;
  color: string;
  value: (s: TickStats) => number;
  /** With `rolling`: plot rolling sum of `value` / rolling sum of `den` × `scale` (gaps where den is 0). */
  den?: (s: TickStats) => number;
  scale?: number;
}

/** Chart tabs, in display order. */
export const CHART_GROUPS = ['Befolkning', 'Død', 'Stammer', 'Kamp og sykdom', 'Gener', 'Arv'] as const;
type ChartGroup = (typeof CHART_GROUPS)[number];

interface ChartDef {
  title: string;
  group: ChartGroup;
  series: Series[];
  /** Optional ±band around the first series. */
  band?: (s: TickStats) => [number, number];
  domain?: [number, number];
  /** Rolling window sum instead of raw value. */
  rolling?: number;
}

const buildDefs = (tribes: Tribe[]): ChartDef[] => [
  {
    title: 'Populasjon',
    group: 'Befolkning',
    series: [
      { label: 'totalt', color: '#d8dde4', value: (s) => s.females + s.males },
      { label: 'hunner', color: '#e8799b', value: (s) => s.females },
      { label: 'hanner', color: '#6fa8e8', value: (s) => s.males },
      { label: 'gravide', color: '#f2c94c', value: (s) => s.pregnant ?? 0 },
    ],
  },
  {
    title: 'Generasjon',
    group: 'Befolkning',
    series: [
      { label: 'snitt', color: '#c9b4ff', value: (s) => s.generationMean },
      { label: 'maks', color: '#7d6bb0', value: (s) => s.generationMax },
    ],
  },
  {
    title: 'Fødsler og dødsfall per 50 ticks',
    group: 'Befolkning',
    rolling: 50,
    series: [
      { label: 'fødsler', color: '#7ed69b', value: (s) => s.births },
      {
        label: 'døde',
        color: '#d8dde4',
        value: (s) =>
          s.deathsStarvation + (s.deathsThirst ?? 0) + s.deathsAge + (s.deathsKilled ?? 0) + (s.deathsChildbirth ?? 0) + (s.deathsInfant ?? 0) + (s.deathsDisease ?? 0) + (s.deathsCatastrophe ?? 0),
      },
    ],
  },
  {
    title: 'Dødsårsaker per 50 ticks',
    group: 'Død',
    rolling: 50,
    series: [
      { label: 'sult', color: '#e0a35a', value: (s) => s.deathsStarvation },
      { label: 'tørst', color: '#5fb0e8', value: (s) => s.deathsThirst ?? 0 },
      { label: 'alder', color: '#9aa0a8', value: (s) => s.deathsAge },
      { label: 'drept', color: '#ff5a4f', value: (s) => s.deathsKilled ?? 0 },
      { label: 'sykdom', color: '#c6e85a', value: (s) => s.deathsDisease ?? 0 },
    ],
  },
  {
    title: 'Andre dødsårsaker per 50 ticks',
    group: 'Død',
    rolling: 50,
    series: [
      { label: 'fødsel', color: '#f15bb5', value: (s) => s.deathsChildbirth ?? 0 },
      { label: 'spedbarn', color: '#5fd3c7', value: (s) => s.deathsInfant ?? 0 },
      { label: 'katastrofe', color: '#ff8a3a', value: (s) => s.deathsCatastrophe ?? 0 },
      { label: 'fostre tapt', color: '#c9b4ff', value: (s) => s.pregnancyLosses ?? 0 },
    ],
  },
  {
    title: 'Syke',
    group: 'Kamp og sykdom',
    series: [{ label: 'syke', color: '#c6e85a', value: (s) => s.infected ?? 0 }],
  },
  {
    title: 'Stammeandel (snitt avstamning)',
    group: 'Stammer',
    domain: [0, 1],
    series: tribes.map((t, i) => ({ label: t.name, color: t.color, value: (s: TickStats) => s.tribeShare?.[i] ?? 0 })),
  },
  {
    title: 'Renhet (snitt største stammeandel)',
    group: 'Stammer',
    domain: [0, 1],
    series: [{ label: 'renhet', color: '#f2c94c', value: (s) => s.purityMean ?? 0 }],
  },
  {
    title: 'Kamp per 50 ticks',
    group: 'Kamp og sykdom',
    rolling: 50,
    series: [
      { label: 'treff', color: '#e0a35a', value: (s) => s.hits ?? 0 },
      { label: 'drap', color: '#ff5a4f', value: (s) => s.deathsKilled ?? 0 },
    ],
  },
  {
    title: 'Snitt dødsalder (siste 100 ticks)',
    group: 'Død',
    rolling: 100,
    series: [
      {
        label: 'dødsalder',
        color: '#9aa0a8',
        value: (s) => s.deathAgeSum,
        den: (s) => s.deathsStarvation + s.deathsAge,
      },
    ],
  },
  {
    title: 'Andel døde av alderdom, % (siste 100 ticks)',
    group: 'Død',
    rolling: 100,
    domain: [0, 100],
    series: [
      {
        label: 'alderdom',
        color: '#c8ccd2',
        value: (s) => s.deathsAge,
        den: (s) => s.deathsStarvation + s.deathsAge,
        scale: 100,
      },
    ],
  },
  {
    title: 'Klaner (levende etternavn)',
    group: 'Stammer',
    series: [{ label: 'klaner', color: '#f2c94c', value: (s) => s.surnames }],
  },
  {
    title: 'Ruter med mat',
    group: 'Befolkning',
    series: [
      { label: 'gress', color: '#5fb36d', value: (s) => s.food - (s.berries ?? 0) },
      { label: 'bær', color: '#b0509c', value: (s) => s.berries ?? 0 },
    ],
  },
  {
    title: 'Arvestyrke (snitt per egenskap)',
    group: 'Arv',
    domain: [0, 1],
    series: GENE_KEYS.map((k, i) => ({
      label: GENE_LABELS[k].toLowerCase().slice(0, 5),
      color: ['#8fd3e0', '#f2c94c', '#7ed69b', '#e8799b', '#c9b4ff'][i],
      value: (s: TickStats) => s.dominanceMean[k],
    })),
  },
  ...GENE_KEYS.map(
    (k): ChartDef => ({
      title: `${GENE_LABELS[k]} (snitt ± sd)`,
      group: (['size', 'maxSpeed', 'vision', 'aggression'] as string[]).includes(k) ? 'Gener' : 'Arv',
      domain: GENE_RANGES[k],
      series: [{ label: 'snitt', color: '#8fd3e0', value: (s) => s.geneMean[k] }],
      band: (s) => [s.geneMean[k] - s.geneSd[k], s.geneMean[k] + s.geneSd[k]],
    }),
  ),
];

const W = 280;
const H = 130;
const M = { top: 30, right: 8, bottom: 18, left: 36 };
const MAX_POINTS = 400;

const downsample = (rows: TickStats[]): TickStats[] => {
  if (rows.length <= MAX_POINTS) return rows;
  const stride = rows.length / MAX_POINTS;
  const out: TickStats[] = [];
  for (let i = 0; i < MAX_POINTS; i++) out.push(rows[Math.floor(i * stride)]);
  out.push(rows[rows.length - 1]);
  return out;
};

const rollingSum = (rows: TickStats[], f: (s: TickStats) => number, window: number): Map<TickStats, number> => {
  const out = new Map<TickStats, number>();
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += f(rows[i]);
    if (i >= window) sum -= f(rows[i - window]);
    out.set(rows[i], sum);
  }
  return out;
};

export class Charts {
  private defs: ChartDef[] = [];
  private defsKey = '';

  private group: ChartGroup = 'Befolkning';
  private readonly grid: HTMLElement;
  private readonly tabs: HTMLElement;

  constructor(root: HTMLElement) {
    try {
      const saved = localStorage.getItem('popsim.chartGroup') as ChartGroup | null;
      if (saved && (CHART_GROUPS as readonly string[]).includes(saved)) this.group = saved;
    } catch {
      /* storage unavailable */
    }
    root.innerHTML = '<nav class="chart-tabs"></nav><div class="chart-grid"></div>';
    this.tabs = root.querySelector('.chart-tabs')!;
    this.grid = root.querySelector('.chart-grid')!;
    this.tabs.innerHTML = CHART_GROUPS.map((g) => `<button data-group="${g}">${g}</button>`).join('');
    this.tabs.addEventListener('click', (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-group]')?.dataset.group as ChartGroup | undefined;
      if (!g) return;
      this.group = g;
      try {
        localStorage.setItem('popsim.chartGroup', g);
      } catch {
        /* ignore */
      }
      this.markTabs();
      this.onTab?.();
    });
    this.markTabs();
  }

  /** Called when the user switches tab, so the owner can re-render. */
  onTab?: () => void;

  private markTabs(): void {
    for (const b of this.tabs.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.group === this.group);
  }

  render(rows: TickStats[], cursorTick: number, tribes: Tribe[], onSeek: (tick: number) => void): void {
    const key = tribes.map((t) => t.name + t.color).join('|');
    if (key !== this.defsKey) {
      this.defs = buildDefs(tribes);
      this.defsKey = key;
    }
    const DEFS = this.defs.filter((d) => d.group === this.group);
    const root = d3.select(this.grid);
    const maxTick = Math.max(1, rows.length ? rows[rows.length - 1].tick : 1);
    const x = d3.scaleLinear([0, maxTick], [M.left, W - M.right]);

    const charts = root
      .selectAll<SVGSVGElement, ChartDef>('svg.chart')
      .data(DEFS, (d) => d.title)
      .join((enter) => {
        const svg = enter.append('svg').attr('class', 'chart').attr('viewBox', `0 0 ${W} ${H}`);
        svg.append('text').attr('class', 'chart-title').attr('x', M.left).attr('y', 13);
        svg.append('g').attr('class', 'legend');
        svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${H - M.bottom})`);
        svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${M.left},0)`);
        svg.append('path').attr('class', 'band');
        svg.append('g').attr('class', 'lines');
        svg.append('line').attr('class', 'cursor');
        return svg;
      });

    charts.on('click', function (event: MouseEvent) {
      const [px] = d3.pointer(event, this);
      onSeek(Math.round(x.invert(px)));
    });

    charts.each(function (def) {
      const svg = d3.select(this);
      const values = def.series.map((s) => {
        if (!def.rolling) return null;
        const num = rollingSum(rows, s.value, def.rolling);
        if (!s.den) return num;
        const den = rollingSum(rows, s.den, def.rolling);
        const out = new Map<TickStats, number>();
        for (const r of rows) {
          const d = den.get(r)!;
          out.set(r, d ? (num.get(r)! / d) * (s.scale ?? 1) : NaN);
        }
        return out;
      });
      const pts = downsample(rows);
      const val = (si: number, r: TickStats) => values[si]?.get(r) ?? def.series[si].value(r);
      let domain = def.domain;
      if (!domain) {
        let max = 1;
        for (const r of pts) {
          for (let si = 0; si < def.series.length; si++) {
            const v = val(si, r);
            if (Number.isFinite(v)) max = Math.max(max, v);
          }
        }
        domain = [0, max * 1.05];
      }
      const y = d3.scaleLinear(domain, [H - M.bottom, M.top]);

      svg.select('.chart-title').text(def.title);
      svg
        .select('.legend')
        .selectAll('text')
        .data(def.series.length > 1 ? def.series : [])
        .join('text')
        .attr('x', (_, i) => M.left + i * (def.series.length > 5 ? 36 : 54))
        .attr('y', 25)
        .attr('fill', (s) => s.color)
        .text((s) => s.label);
      svg.select<SVGGElement>('.x-axis').call(d3.axisBottom(x).ticks(4).tickSizeOuter(0));
      svg.select<SVGGElement>('.y-axis').call(d3.axisLeft(y).ticks(3).tickSizeOuter(0));

      svg
        .select('.band')
        .attr(
          'd',
          def.band
            ? d3
                .area<TickStats>()
                .x((r) => x(r.tick))
                .y0((r) => y(Math.max(domain![0], def.band!(r)[0])))
                .y1((r) => y(Math.min(domain![1], def.band!(r)[1])))(pts)
            : null,
        );

      svg
        .select('.lines')
        .selectAll('path')
        .data(def.series)
        .join('path')
        .attr('fill', 'none')
        .attr('stroke', (s) => s.color)
        .attr('stroke-width', 1.5)
        .attr('d', (_, si) =>
          d3
            .line<TickStats>()
            .defined((r) => Number.isFinite(val(si, r)))
            .x((r) => x(r.tick))
            .y((r) => y(val(si, r)))(pts),
        );

      svg
        .select('.cursor')
        .attr('x1', x(cursorTick))
        .attr('x2', x(cursorTick))
        .attr('y1', M.top)
        .attr('y2', H - M.bottom);
    });
  }
}
