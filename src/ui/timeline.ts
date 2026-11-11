import * as d3 from 'd3';
import type { Branch, History } from '../history/history';

const LANE = 22;
const M = { top: 18, right: 16, bottom: 22, left: 110 };

/** Branch graph: one horizontal line per branch over ticks, with a connector at each fork point. */
export class Timeline {
  constructor(private readonly root: HTMLElement) {}

  render(h: History, activeId: number, cursorTick: number, onSelect: (branchId: number, tick: number) => void): void {
    const branches = [...h.branches.values()].sort((a, b) => a.id - b.id);
    const lane = new Map(branches.map((b, i) => [b.id, i]));
    const lineage = new Set(h.lineage(activeId));
    const width = Math.max(400, this.root.clientWidth);
    const height = M.top + M.bottom + branches.length * LANE;
    const maxTick = Math.max(10, ...branches.map((b) => b.headTick));
    const x = d3.scaleLinear([0, maxTick], [M.left, width - M.right]);
    const y = (b: Branch) => M.top + lane.get(b.id)! * LANE + LANE / 2;

    const svg = d3
      .select(this.root)
      .selectAll<SVGSVGElement, null>('svg')
      .data([null])
      .join((e) => {
        const s = e.append('svg');
        s.append('g').attr('class', 'x-axis');
        s.append('g').attr('class', 'links');
        s.append('g').attr('class', 'lanes');
        s.append('g').attr('class', 'marker');
        return s;
      })
      .attr('width', width)
      .attr('height', height);

    svg
      .select<SVGGElement>('.x-axis')
      .attr('transform', `translate(0,${height - M.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(width / 90))).tickSizeOuter(0));

    svg
      .select('.links')
      .selectAll('path')
      .data(branches.filter((b) => b.parentId !== null))
      .join('path')
      .attr('class', (b) => (lineage.has(b.id) ? 'link on' : 'link'))
      .attr('d', (b) => {
        const p = h.get(b.parentId!);
        const x0 = x(b.startTick);
        return `M${x0},${y(p)} C${x0 + 12},${y(p)} ${x0 - 4},${y(b)} ${x0 + 10},${y(b)}`;
      });

    const lanes = svg
      .select('.lanes')
      .selectAll<SVGGElement, Branch>('g.lane')
      .data(branches, (b) => String(b.id))
      .join((e) => {
        const g = e.append('g').attr('class', 'lane');
        g.append('rect').attr('class', 'hit');
        g.append('line').attr('class', 'track');
        g.append('circle').attr('class', 'start').attr('r', 3.5);
        g.append('text').attr('class', 'label').attr('text-anchor', 'end');
        g.append('title');
        g.append('g').attr('class', 'rule-marks');
        return g;
      })
      .attr('class', (b) => `lane${b.id === activeId ? ' active' : ''}${lineage.has(b.id) ? ' lineage' : ''}`);

    lanes
      .select('rect.hit')
      .attr('x', (b) => x(b.startTick) - 4)
      .attr('y', (b) => y(b) - LANE / 2)
      .attr('width', (b) => Math.max(8, x(b.headTick) - x(b.startTick) + 8))
      .attr('height', LANE);
    lanes
      .select('line.track')
      .attr('x1', (b) => x(b.startTick))
      .attr('x2', (b) => Math.max(x(b.startTick) + 2, x(b.headTick)))
      .attr('y1', y)
      .attr('y2', y);
    lanes.select('circle.start').attr('cx', (b) => x(b.startTick)).attr('cy', y);
    lanes
      .select('text.label')
      .attr('x', M.left - 8)
      .attr('y', (b) => y(b) + 4)
      .text((b) => (b.name.length > 14 ? b.name.slice(0, 13) + '…' : b.name));
    lanes
      .select('title')
      .text(
        (b) =>
          `${b.name}\nTick ${b.startTick}–${b.headTick}` +
          (b.changes.length ? `\n\nEndringer:\n• ${b.changes.join('\n• ')}` : '') +
          (b.ruleLog?.length ? `\n\nRegelendringer i grenen:\n• ${b.ruleLog.map((r) => `tick ${r.tick}: ${r.text}`).join('\n• ')}` : ''),
      );

    // Rule changes made in place: a small tick on the lane, with the change as tooltip.
    lanes.each(function (b) {
      d3.select(this)
        .select('g.rule-marks')
        .selectAll<SVGGElement, { tick: number; text: string }>('g')
        .data(b.ruleLog ?? [])
        .join((e) => {
          const g = e.append('g');
          g.append('rect').attr('class', 'rule-mark').attr('width', 3).attr('height', 12).attr('x', -1.5).attr('y', -6);
          g.append('title');
          return g;
        })
        .attr('transform', (r) => `translate(${x(r.tick)},${y(b)})`)
        .call((g) => g.select('title').text((r) => `Tick ${r.tick}: ${r.text}`));
    });

    lanes.on('click', function (event: MouseEvent, b) {
      const [px] = d3.pointer(event, svg.node());
      const t = Math.round(Math.max(b.startTick, Math.min(b.headTick, x.invert(px))));
      onSelect(b.id, t);
    });

    const active = h.get(activeId);
    svg
      .select('.marker')
      .selectAll('path')
      .data([null])
      .join('path')
      .attr('d', 'M0,-7 L5,0 L0,7 L-5,0 Z')
      .attr('transform', `translate(${x(cursorTick)},${y(active)})`);
  }
}
