import { activeEles, ELE_DEFS, eleEffects, iceCover } from '../sim/ele';
import type { Actor, AttackReason, World } from '../sim/types';
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
  /** Placed tribe homes while the user places tribes. */
  markers?: { x: number; y: number; color: string; label: string }[];
}

/** Zoom level from which every actor is drawn as an ancestry pie with a health bar. */
export const DETAIL_ZOOM = 3;
const MAX_ZOOM = 16;

/** Line colour per attack reason; also used by the map legend. */
export const ATTACK_COLORS: Record<AttackReason, string> = {
  food: '#ff4b3a',
  rival: '#ff5fd2',
  protect: '#4fa3ff',
  join: '#b77bff',
  defend: '#ffb23a',
};

export const ATTACK_LABELS: Record<AttackReason, string> = {
  food: 'angrep om mat',
  rival: 'rivaler om partner',
  protect: 'forsvarer gravid/partner',
  join: 'blander seg inn i kamp',
  defend: 'slår tilbake',
};

/** Colours of partner lines and status badges; also used by the map legend. */
export const MARK_COLORS = {
  seeking: '#f082aa',
  mated: '#6ee68c',
  rejected: '#aaaab4',
  rejectCross: '#ff5a46',
  guarding: '#78b4ff',
  attacking: '#ff6a5a',
  attacked: '#ff3b3b',
  fleeing: '#ffd27a',
  courting: '#f28fb6',
  pregnant: '#ffffff',
};

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

  /** Map overlays for active catastrophes, plus a label listing them with ticks left. */
  private drawEles(w: World): void {
    const active = activeEles(w);
    if (!active.length) return;
    const { ctx } = this;
    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const X = (x: number) => this.ox + x * s;
    const Y = (y: number) => this.oy + y * s;
    const fx = eleEffects(w);
    // Ash and dust: grey veil over the world, stronger the less food grows.
    if (fx.growth < 0.95) {
      ctx.fillStyle = `rgba(120, 115, 110, ${0.45 * (1 - fx.growth)})`;
      ctx.fillRect(X(0), Y(0), w.width * s, w.height * s);
    }
    for (const e of active) {
      const p = Math.min(1, (w.tick - e.tick) / Math.max(1, e.end - e.tick));
      switch (e.key) {
        case 'meteor': {
          const r = e.radius! * s;
          ctx.beginPath();
          ctx.arc(X(e.x!), Y(e.y!), r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(30, 18, 12, ${0.7 * (1 - p)})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(255, 120, 40, ${0.9 * (1 - p)})`;
          ctx.lineWidth = 3 * dpr;
          ctx.stroke();
          if (w.tick - e.tick < 30) {
            ctx.beginPath();
            ctx.arc(X(e.x!), Y(e.y!), r * (1 + (w.tick - e.tick) / 12), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 200, 120, ${1 - (w.tick - e.tick) / 30})`;
            ctx.stroke();
          }
          break;
        }
        case 'iceAge': {
          const c = iceCover(w, e);
          ctx.fillStyle = 'rgba(210, 235, 255, 0.45)';
          if (e.edge === 'N') ctx.fillRect(X(0), Y(0), w.width * s, c * w.height * s);
          else if (e.edge === 'S') ctx.fillRect(X(0), Y((1 - c) * w.height), w.width * s, c * w.height * s);
          else if (e.edge === 'W') ctx.fillRect(X(0), Y(0), c * w.width * s, w.height * s);
          else ctx.fillRect(X((1 - c) * w.width), Y(0), c * w.width * s, w.height * s);
          break;
        }
        case 'locusts': {
          const r = e.radius! * s;
          ctx.beginPath();
          ctx.arc(X(e.x!), Y(e.y!), r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(140, 110, 40, 0.3)';
          ctx.fill();
          ctx.fillStyle = 'rgba(90, 70, 20, 0.9)';
          for (let i = 0; i < 40; i++) {
            const a = (i * 2.399 + w.tick * 0.07) % (Math.PI * 2);
            const d = r * Math.sqrt(((i * 0.618 + w.tick * 0.013) % 1));
            ctx.fillRect(X(e.x!) + Math.cos(a) * d, Y(e.y!) + Math.sin(a) * d, 2 * dpr, 2 * dpr);
          }
          break;
        }
        case 'drought':
          ctx.fillStyle = 'rgba(230, 180, 60, 0.12)';
          ctx.fillRect(X(0), Y(0), w.width * s, w.height * s);
          break;
        case 'radiation':
          ctx.fillStyle = 'rgba(120, 255, 120, 0.08)';
          ctx.fillRect(X(0), Y(0), w.width * s, w.height * s);
          break;
        case 'rage':
          ctx.strokeStyle = 'rgba(255, 40, 30, 0.6)';
          ctx.lineWidth = 8 * dpr;
          ctx.strokeRect(X(0), Y(0), w.width * s, w.height * s);
          break;
        default:
          break;
      }
    }
    // Label in the top-left corner.
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    active.forEach((e, i) => {
      const text = `${ELE_DEFS[e.key].icon} ${e.name} · ${e.end - w.tick} ticks igjen`;
      const y = 8 * dpr + i * 18 * dpr;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(6 * dpr, y - 2 * dpr, tw + 10 * dpr, 17 * dpr);
      ctx.fillStyle = '#ffd7c2';
      ctx.fillText(text, 11 * dpr, y);
    });
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
    ctx.strokeStyle = MARK_COLORS.seeking;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (const a of w.actors) {
      const m = a.mateTarget === null ? undefined : byId.get(a.mateTarget);
      if (!m || a.court) continue;
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(m), sy(m));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Caring fathers: dotted blue line to the pregnant mother.
    ctx.setLineDash([1.5 * dpr, 3 * dpr]);
    ctx.strokeStyle = MARK_COLORS.guarding;
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
      ctx.globalAlpha = ok ? alpha : alpha * 0.8;
      ctx.strokeStyle = ok ? MARK_COLORS.mated : MARK_COLORS.rejected;
      ctx.lineWidth = (ok ? 3 : 2) * dpr;
      ctx.beginPath();
      ctx.moveTo(sx(a), sy(a));
      ctx.lineTo(sx(b), sy(b));
      ctx.stroke();
      const mx = (sx(a) + sx(b)) / 2;
      const my = (sy(a) + sy(b)) / 2;
      const mark = (glyph: string, color: string, x: number, y: number) => {
        ctx.font = `bold ${Math.round(16 * dpr)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillText(glyph, x + dpr, y + dpr);
        ctx.fillStyle = color;
        ctx.fillText(glyph, x, y);
        ctx.textAlign = 'start';
      };
      if (ok) {
        mark('♥', MARK_COLORS.mated, mx, my - 10 * dpr);
      } else {
        // Big cross near whoever said no (both ends if both did).
        const at = (from: Actor, to: Actor) => [sx(from) + (sx(to) - sx(from)) * 0.3, sy(from) + (sy(to) - sy(from)) * 0.3] as const;
        if (!c.selfAccepted) mark('✕', MARK_COLORS.rejectCross, ...at(a, b));
        if (!c.otherAccepted) mark('✕', MARK_COLORS.rejectCross, ...at(b, a));
      }
      ctx.globalAlpha = 1;
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
    this.drawEles(w);

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

    // Fight lines with an arrowhead at the target's edge: the arrow points the way the attack goes.
    // Colour by reason (see ATTACK_COLORS).
    ctx.lineWidth = 1.5 * dpr;
    for (const a of w.actors) {
      const t = a.target === null ? undefined : byId.get(a.target);
      if (!t) continue;
      const color = ATTACK_COLORS[a.targetReason ?? 'food'];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const x0 = sx(a);
      const y0 = sy(a);
      const x1 = sx(t);
      const y1 = sy(t);
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1) continue;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      const tipBack = radiusOf(t) * s + 1.5 * dpr;
      const tx = x1 - ux * tipBack;
      const ty = y1 - uy * tipBack;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const head = Math.max(5 * dpr, Math.min(10 * dpr, 2.5 * s));
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * head - uy * head * 0.5, ty - uy * head + ux * head * 0.5);
      ctx.lineTo(tx - ux * head + uy * head * 0.5, ty - uy * head - ux * head * 0.5);
      ctx.closePath();
      ctx.fill();
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

    // Status badges above actors when zoomed in (and always for the selected one):
    // ⚔ attacking, ! under attack, ♥ courting/being courted, ✿ pregnant, ↯ fleeing.
    const attacked = new Set<number>();
    const courted = new Set<number>();
    for (const a of w.actors) {
      if (a.target !== null) attacked.add(a.target);
      if (a.mateTarget !== null) courted.add(a.mateTarget);
    }
    const badgeZoom = this.zoom >= 2;
    ctx.font = `bold ${Math.round(13 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const a of w.actors) {
      if (!badgeZoom && a.id !== opt.selectedId) continue;
      const parts: [string, string][] = [];
      if (a.target !== null) parts.push(['⚔', MARK_COLORS.attacking]);
      if (attacked.has(a.id)) parts.push(['!', MARK_COLORS.attacked]);
      if (a.fleeing > 0) parts.push(['↯', MARK_COLORS.fleeing]);
      if (a.mateTarget !== null || courted.has(a.id)) parts.push(['♥', MARK_COLORS.courting]);
      if (a.pregnancy) parts.push(['✿', MARK_COLORS.pregnant]);
      if (!parts.length) continue;
      const r = radiusOf(a) * s;
      const y = sy(a) - r - (detail ? Math.max(2, r * 0.3) + 6 * dpr : 3 * dpr);
      const step = 12 * dpr;
      let x = sx(a) - ((parts.length - 1) * step) / 2;
      for (const [glyph, color] of parts) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(glyph, x + dpr, y + dpr);
        ctx.fillStyle = color;
        ctx.fillText(glyph, x, y);
        x += step;
      }
    }
    ctx.textAlign = 'start';

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
    }

    for (const m of opt.markers ?? []) {
      const x = sx(m);
      const y = sy(m);
      ctx.beginPath();
      ctx.arc(x, y, 40 * s, 0, Math.PI * 2);
      ctx.fillStyle = m.color + '55';
      ctx.fill();
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.font = `bold ${Math.round(13 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(m.label, x, y);
      ctx.textAlign = 'start';
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
