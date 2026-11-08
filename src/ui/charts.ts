import * as d3 from 'd3';
import { GENE_LABELS, GENE_RANGES } from '../sim/genome';
import { GENE_KEYS, type TickStats } from '../sim/types';

interface Series {
  label: string;
  color: string;
  value: (s: TickStats) => number;
}

interface ChartDef {
  title: string;
  series: Series[];
  /** Optional ±band around the first series. */
  band?: (s: TickStats) => [number, number];
  domain?: [number, number];
  /** Rolling window sum instead of raw value. */
  rolling?: number;
}

const DEFS: ChartDef[] = [
  {
    title: 'Populasjon',
    series: [
      { label: 'hunner', color: '#e8799b', value: (s) => s.females },
      { label: 'hanner', color: '#6fa8e8', value: (s) => s.males },
    ],
  },
  {
    title: 'Generasjon',
    series: [
      { label: 'snitt', color: '#c9b4ff', value: (s) => s.generationMean },
      { label: 'maks', color: '#7d6bb0', value: (s) => s.generationMax },
    ],
  },
  {
    title: 'Fødsler og dødsfall per 50 ticks',
    rolling: 50,
    series: [
      { label: 'fødsler', color: '#7ed69b', value: (s) => s.births },
      { label: 'sult', color: '#e0a35a', value: (s) => s.deathsStarvation },
      { label: 'alder', color: '#9aa0a8', value: (s) => s.deathsAge },
    ],
  },
  {
    title: 'Klaner (levende etternavn)',
    series: [{ label: 'klaner', color: '#f2c94c', value: (s) => s.surnames }],
  },
  {
    title: 'Ruter med mat',
    series: [{ label: 'mat', color: '#5fb36d', value: (s) => s.food }],
  },
  ...GENE_KEYS.map(
    (k): ChartDef => ({
      title: `${GENE_LABELS[k]} (snitt ± sd)`,
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
  constructor(private readonly root: HTMLElement) {}

  render(rows: TickStats[], cursorTick: number, onSeek: (tick: number) => void): void {
    const root = d3.select(this.root);
    const maxTick = Math.max(1, rows.length ? rows[rows.length - 1].tick : 1);
    const x = d3.scaleLinear([0, maxTick], [M.left, W - M.right]);

    const charts = root
      .selectAll<SVGSVGElement, ChartDef>('svg.chart')
      .data(DEFS)
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
      const values = def.series.map((s) => (def.rolling ? rollingSum(rows, s.value, def.rolling) : null));
      const pts = downsample(rows);
      const val = (si: number, r: TickStats) => values[si]?.get(r) ?? def.series[si].value(r);
      let domain = def.domain;
      if (!domain) {
        let max = 1;
        for (const r of pts) for (let si = 0; si < def.series.length; si++) max = Math.max(max, val(si, r));
        domain = [0, max * 1.05];
      }
      const y = d3.scaleLinear(domain, [H - M.bottom, M.top]);

      svg.select('.chart-title').text(def.title);
      svg
        .select('.legend')
        .selectAll('text')
        .data(def.series.length > 1 ? def.series : [])
        .join('text')
        .attr('x', (_, i) => M.left + i * 56)
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
