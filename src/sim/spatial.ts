import type { Actor } from './types';

/** Uniform-grid spatial hash, rebuilt once per tick. */
export class SpatialHash {
  private readonly buckets = new Map<number, Actor[]>();
  private readonly cols: number;

  constructor(
    private readonly cell: number,
    width: number,
  ) {
    this.cols = Math.ceil(width / cell) + 1;
  }

  private key(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  insert(a: Actor): void {
    const k = this.key(Math.floor(a.x / this.cell), Math.floor(a.y / this.cell));
    const b = this.buckets.get(k);
    if (b) b.push(a);
    else this.buckets.set(k, [a]);
  }

  /** Actors whose stored position is within the bounding square of radius r around (x, y). */
  *near(x: number, y: number, r: number): Generator<Actor> {
    const x0 = Math.floor((x - r) / this.cell);
    const x1 = Math.floor((x + r) / this.cell);
    const y0 = Math.floor((y - r) / this.cell);
    const y1 = Math.floor((y + r) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (b) yield* b;
      }
    }
  }
}
