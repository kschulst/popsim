import type { Actor, World } from '../sim/types';
import { capacityOf, maxHpOf, radiusOf } from '../sim/world';
import { actorColor, type ColorMode } from './colors';

export interface RenderOptions {
  colorMode: ColorMode;
  selectedId: number | null;
  /** Actor id → kin weight relative to the selected actor (excluding self). */
  kin: Map<number, number>;
  showFertility: boolean;
  /** Draw partner search and courtship lines. */
  showCourtship: boolean;
  brush: { x: number; y: number; r: number } | null;
}

/** Zoom level from which every actor is drawn as an ancestry pie with a health bar. */
export const DETAIL_ZOOM = 3;
const MAX_ZOOM = 16;

/**
 * Canvas 2D renderer. The world is fitted to the canvas (preserving aspect ratio) and then zoomed
 * by `zoom` around the world point (cx, cy).
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fieldCanvas = document.createElement('canvas');
  private scale = 1;
  private ox = 0;
  private oy = 0;
  zoom = 1;
  private cx: number | null = null;
  private cy: number | null = null;
  private worldW = 800;
  private worldH = 600;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
  }

  /** Screen (CSS px, relative to canvas) → world coordinates. */
  toWorld(px: number, py: number): { x: number; y: number } {
    const dpr = window.devicePixelRatio || 1;
    return { x: (px * dpr - this.ox) / this.scale, y: (py * dpr - this.oy) / this.scale };
  }

  /** Zooms by `factor` keeping the world point under (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    const before = this.toWorld(px, py);
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, this.zoom * factor));
    this.updateTransform();
    const after = this.toWorld(px, py);
    this.cx = this.cx! + before.x - after.x;
    this.cy = this.cy! + before.y - after.y;
    this.updateTransform();
  }

  /** Pans by a screen distance in CSS px. */
  panBy(dx: number, dy: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cx = this.cx! - (dx * dpr) / this.scale;
    this.cy = this.cy! - (dy * dpr) / this.scale;
    this.updateTransform();
  }

  /** Time (ms) of the last navigation to an actor; drives a short highlight pulse. */
  private pulseAt = 0;

  /** Centres the view on a world point, zooming in to at least `minZoom`, and pulses the selection. */
  centerOn(x: number, y: number, minZoom = 2): void {
    this.zoom = Math.max(this.zoom, minZoom);
    this.cx = x;
    this.cy = y;
    this.updateTransform();
    this.pulseAt = performance.now();
  }

  resetView(): void {
    this.zoom = 1;
    this.cx = this.cy = null;
    this.updateTransform();
  }

  private updateTransform(): void {
    const { canvas, worldW, worldH } = this;
    const fit = Math.min(canvas.width / worldW, canvas.height / worldH);
    this.scale = fit * this.zoom;
    // Keep the view inside the world: clamp the centre so no more than the fitted margin shows.
    const halfW = canvas.width / 2 / this.scale;
    const halfH = canvas.height / 2 / this.scale;
    const clampC = (c: number | null, half: number, size: number) =>
      half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, c ?? size / 2));
    this.cx = clampC(this.cx, halfW, worldW);
    this.cy = clampC(this.cy, halfH, worldH);
    this.ox = canvas.width / 2 - this.cx * this.scale;
    this.oy = canvas.height / 2 - this.cy * this.scale;
  }

  private drawField(w: World, showFertility: boolean): void {
    const fc = this.fieldCanvas;
    if (fc.width !== w.cols || fc.height !== w.rows) {
      fc.width = w.cols;
      fc.height = w.rows;
    }
    const fctx = fc.getContext('2d')!;
    const img = fctx.createImageData(w.cols, w.rows);
    for (let i = 0; i < w.food.length; i++) {
      const fert = w.fertility[i];
      const o = i * 4;
      if (showFertility) {
        // Fertility overlay: dark purple (barren) to blue (fertile); food cells stay marked.
        img.data[o] = w.food[i] ? 70 : 40 + 60 * (1 - fert);
        img.data[o + 1] = w.food[i] ? 150 : 30 + 40 * fert;
        img.data[o + 2] = w.food[i] ? 90 : 60 + 120 * fert;
      } else if (w.food[i]) {
        img.data[o] = 38;
        img.data[o + 1] = 92;
        img.data[o + 2] = 52;
      } else {
        img.data[o] = 18;
        img.data[o + 1] = 22;
        img.data[o + 2] = 26;
      }
      img.data[o + 3] = 255;
    }
    fctx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(fc, this.ox, this.oy, w.width * this.scale, w.height * this.scale);
  }

  /** Female circle or male diamond path, in screen coordinates. */
  private shapePath(a: Actor, x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    if (a.sex === 'F') {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else {
      const d = r * 1.15;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    }
  }

  /** Ancestry pie of radius r at (x, y). */
  private pie(w: World, anc: number[], x: number, y: number, r: number): void {
    const { ctx } = this;
    let start = -Math.PI / 2;
    for (let i = 0; i < w.tribes.length; i++) {
      const share = anc[i] ?? 0;
      if (share <= 0.001) continue;
      const end = start + share * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, start, end);
      ctx.closePath();
      ctx.fillStyle = w.tribes[i].color;
      ctx.fill();
      start = end;
    }
  }

  private hpBar(a: Actor, w: World, x: number, y: number, r: number): void {
    const { ctx } = this;
    const share = Math.max(0, Math.min(1, a.hp / maxHpOf(a, w.rules)));
    const bw = Math.max(10, r * 2.4);
    const bh = Math.max(2, r * 0.3);
    const by = y - r * 1.15 - bh - 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - bw / 2, by, bw, bh);
    ctx.fillStyle = `hsl(${share * 120}, 70%, 50%)`;
    ctx.fillRect(x - bw / 2, by, bw * share, bh);
  }

  /**
   * Partner search: dashed pink line to the partner an actor is heading for. Courtship outcome,
   * fading over its ttl: green when both accepted (mated), grey with a cross at the end of the
   * side that said no.
   */
  private drawCourtship(
    w: World,
    byId: Map<number, Actor>,
    sx: (a: { x: number }) => number,
    sy: (a: { y: number }) => number,
    dpr: number,
  ): void {
    const { ctx } = this;
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.strokeStyle = 'rgba(240, 130, 170, 0.55)';
    ctx.beginPath();
    for (const a of w.actors) {
      const m = a.mateTarget === null ? undefined : byId.get(a.mateTarget);
      if (!m || a.court) continue;
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(m), sy(m));
    }
    ctx.stroke();
    // Caring fathers: dotted blue line to the pregnant mother.
    ctx.setLineDash([1.5 * dpr, 3 * dpr]);
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.7)';
    ctx.beginPath();
    for (const a of w.actors) {
      const m = a.caresFor === null ? undefined : byId.get(a.caresFor);
      if (!m) continue;
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(m), sy(m));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const a of w.actors) {
      const c = a.court;
      const b = c ? byId.get(c.with) : undefined;
      if (!c || !b) continue;
      const alpha = Math.min(1, c.ttl / 12);
      const ok = c.selfAccepted && c.otherAccepted;
      ctx.strokeStyle = ok ? `rgba(110, 230, 140, ${alpha})` : `rgba(170, 170, 180, ${alpha * 0.8})`;
      ctx.lineWidth = (ok ? 2.5 : 1.5) * dpr;
      ctx.beginPath();
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(b), sy(b));
      ctx.stroke();
      // Cross near whoever rejected: at a's end if a said no, at b's end if b said no.
      const cross = (from: Actor, to: Actor) => {
        const t = 0.25;
        const x = sx(from) + (sx(to) - sx(from)) * t;
        const y = sy(from) + (sy(to) - sy(from)) * t;
        const r = 3.5 * dpr;
        ctx.strokeStyle = `rgba(255, 110, 90, ${alpha})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r);
        ctx.lineTo(x - r, y + r);
        ctx.stroke();
      };
      if (!c.selfAccepted) cross(a, b);
      if (!c.otherAccepted) cross(b, a);
    }
  }

  render(w: World, opt: RenderOptions): void {
    const { ctx, canvas } = this;
    this.worldW = w.width;
    this.worldH = w.height;
    this.updateTransform();
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawField(w, opt.showFertility);

    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const detail = this.zoom >= DETAIL_ZOOM;
    const maxGen = w.actors.reduce((m, a) => Math.max(m, a.generation), 0);
    const byId = new Map(w.actors.map((a) => [a.id, a]));
    const sx = (a: { x: number }) => this.ox + a.x * s;
    const sy = (a: { y: number }) => this.oy + a.y * s;

    // Kin rings below the actors.
    if (opt.kin.size) {
      for (const a of w.actors) {
        const k = opt.kin.get(a.id);
        if (k === undefined) continue;
        ctx.beginPath();
        ctx.arc(sx(a), sy(a), (radiusOf(a) + 4) * s, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 210, 90, ${0.25 + 0.75 * Math.min(1, k / 1.2)})`;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
      }
    }

    if (opt.showCourtship) this.drawCourtship(w, byId, sx, sy, dpr);

    // Fight lines from attacker to target.
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(255, 70, 60, 0.75)';
    for (const a of w.actors) {
      const t = a.target === null ? undefined : byId.get(a.target);
      if (!t) continue;
      ctx.beginPath();
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(t), sy(t));
      ctx.stroke();
    }

    for (const a of w.actors) {
      const x = sx(a);
      const y = sy(a);
      const r = radiusOf(a) * s;
      ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, a.energy / capacityOf(a, w.rules));
      if (detail) {
        ctx.save();
        this.shapePath(a, x, y, r);
        ctx.clip();
        this.pie(w, a.ancestry, x, y, r * 1.2);
        ctx.restore();
      } else {
        this.shapePath(a, x, y, r);
        ctx.fillStyle = actorColor(a, w, opt.colorMode, maxGen);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.shapePath(a, x, y, r);
      if (a.flash > 0) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${a.flash / 6})`;
        ctx.lineWidth = 2 * dpr;
      } else {
        ctx.strokeStyle = a.fleeing > 0 ? 'rgba(255, 220, 120, 0.8)' : 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = dpr;
      }
      ctx.stroke();
      if (a.infection) {
        const d = w.diseases?.[a.infection.disease];
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5 * dpr, 0, Math.PI * 2);
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.strokeStyle = d?.color ?? '#c6e85a';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (a.pregnancy) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5 * dpr, r * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();
      }
      if (detail) this.hpBar(a, w, x, y, r);
    }

    const sel = opt.selectedId === null ? undefined : byId.get(opt.selectedId);
    if (sel) {
      const x = sx(sel);
      const y = sy(sel);
      const r = radiusOf(sel) * s;
      ctx.beginPath();
      ctx.arc(x, y, (radiusOf(sel) + 6) * s, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, sel.genome.vision * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!detail) this.hpBar(sel, w, x, y, r);
      // Navigation pulse: expanding ring for one second.
      const age = (performance.now() - this.pulseAt) / 1000;
      if (age < 1) {
        ctx.beginPath();
        ctx.arc(x, y, r + (8 + 40 * age) * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(242, 201, 76, ${1 - age})`;
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();
      }
      // Ancestry badge next to the selected actor, readable at any zoom.
      const br = 14 * dpr;
      const bx = Math.min(canvas.width - br - 4, x + r + br + 8 * dpr);
      const by = Math.max(br + 4, y - r - br);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = dpr;
      ctx.stroke();
      this.pie(w, sel.ancestry, bx, by, br);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    if (opt.brush) {
      ctx.beginPath();
      ctx.arc(sx(opt.brush), sy(opt.brush), opt.brush.r * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
