import type { World } from '../sim/types';
import { capacityOf, radiusOf } from '../sim/world';
import { actorColor, type ColorMode } from './colors';

export interface RenderOptions {
  colorMode: ColorMode;
  selectedId: number | null;
  /** Actor id → kin weight relative to the selected actor (excluding self). */
  kin: Map<number, number>;
  showFertility: boolean;
  brush: { x: number; y: number; r: number } | null;
}

/** Canvas 2D renderer. World coordinates are scaled to fit the canvas, preserving aspect ratio. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fieldCanvas = document.createElement('canvas');
  private scale = 1;
  private ox = 0;
  private oy = 0;

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
        img.data[o] = 46;
        img.data[o + 1] = 122;
        img.data[o + 2] = 62;
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

  render(w: World, opt: RenderOptions): void {
    const { ctx, canvas } = this;
    this.scale = Math.min(canvas.width / w.width, canvas.height / w.height);
    this.ox = (canvas.width - w.width * this.scale) / 2;
    this.oy = (canvas.height - w.height * this.scale) / 2;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawField(w, opt.showFertility);

    const s = this.scale;
    const maxGen = w.actors.reduce((m, a) => Math.max(m, a.generation), 0);

    // Kin rings below the actors.
    if (opt.kin.size) {
      for (const a of w.actors) {
        const k = opt.kin.get(a.id);
        if (k === undefined) continue;
        ctx.beginPath();
        ctx.arc(this.ox + a.x * s, this.oy + a.y * s, (radiusOf(a) + 4) * s, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 210, 90, ${0.25 + 0.75 * Math.min(1, k / 1.2)})`;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
      }
    }

    for (const a of w.actors) {
      const x = this.ox + a.x * s;
      const y = this.oy + a.y * s;
      const r = radiusOf(a) * s;
      ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, a.energy / capacityOf(a, w.rules));
      ctx.fillStyle = actorColor(a, w, opt.colorMode, maxGen);
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
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const sel = opt.selectedId === null ? undefined : w.actors.find((a) => a.id === opt.selectedId);
    if (sel) {
      ctx.beginPath();
      ctx.arc(this.ox + sel.x * s, this.oy + sel.y * s, (radiusOf(sel) + 6) * s, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.ox + sel.x * s, this.oy + sel.y * s, sel.genome.vision * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (opt.brush) {
      ctx.beginPath();
      ctx.arc(this.ox + opt.brush.x * s, this.oy + opt.brush.y * s, opt.brush.r * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
