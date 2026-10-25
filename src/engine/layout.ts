import type { Layout, LayoutRow, PvType } from './types';
import { collectorWidthM } from './solar';

export interface LocalFrame {
  originLon: number;
  originLat: number;
  mPerDegLon: number;
  mPerDegLat: number;
}

export type Ring = [number, number][];

export const toLocal = (f: LocalFrame, [lon, lat]: [number, number]): [number, number] => [(lon - f.originLon) * f.mPerDegLon, (lat - f.originLat) * f.mPerDegLat];
export const toLonLat = (f: LocalFrame, [x, y]: [number, number]): [number, number] => [f.originLon + x / f.mPerDegLon, f.originLat + y / f.mPerDegLat];

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

/** Area of polygons given as [outer, ...holes] rings in local metres. */
export function polygonsArea(polys: Ring[][]): number {
  let a = 0;
  for (const p of polys) p.forEach((r, k) => (a += k === 0 ? ringArea(r) : -ringArea(r)));
  return a;
}

/** Intervals where the line coord=c (y for EW rows, x for NS rows) is inside the polygons (even-odd rule). */
function scan(polys: Ring[][], c: number, horizontal: boolean): [number, number][] {
  const xs: number[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = horizontal ? ring[j] : [ring[j][1], ring[j][0]];
        const [bx, by] = horizontal ? ring[i] : [ring[i][1], ring[i][0]];
        if ((ay > c) !== (by > c)) xs.push(ax + ((c - ay) * (bx - ax)) / (by - ay));
      }
    }
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

export interface LayoutParams {
  type: PvType;
  gcr: number;
  fillPct: number;
  moduleWp: number;
  moduleLengthM: number;
  moduleWidthM: number;
  tiltDeg: number;
  /** Rows nearest this point (local metres) are used first, keeping cable runs to the equipment platform short. */
  anchor?: [number, number];
}

/**
 * Lays rows inside the array zone: east-west rows for north-facing fixed tilt, north-south rows for trackers and
 * vertical fences. Rows closest to the anchor (the equipment platform) are used first until fillPct of the total
 * row length is reached.
 */
export function layoutArray(zone: Ring[][], p: LayoutParams): Layout {
  const horizontal = p.type === 'fixed';
  const width = collectorWidthM(p.type, p.moduleLengthM, p.moduleWidthM);
  const pitch = width / Math.max(0.05, p.gcr);
  const footprint = p.type === 'fixed' ? width * Math.cos((p.tiltDeg * Math.PI) / 180) : p.type === 'tracker' ? width : 0.3;
  let lo = Infinity, hi = -Infinity;
  for (const poly of zone) for (const r of poly) for (const pt of r) {
    const v = horizontal ? pt[1] : pt[0];
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const endClear = 3; // access at row ends
  const all: LayoutRow[] = [];
  if (Number.isFinite(lo)) {
    // Fixed rows fill from the north edge; NS rows from the west edge.
    const positions: number[] = [];
    if (horizontal) for (let c = hi - pitch / 2; c > lo; c -= pitch) positions.push(c);
    else for (let c = lo + pitch / 2; c < hi; c += pitch) positions.push(c);
    for (const c of positions) {
      for (const [s, e] of scan(zone, c, horizontal)) {
        const s2 = s + endClear, e2 = e - endClear;
        if (e2 - s2 < 12) continue;
        const a: [number, number] = horizontal ? [s2, c] : [c, s2];
        const b: [number, number] = horizontal ? [e2, c] : [c, e2];
        all.push({ a, b, length: e2 - s2 });
      }
    }
  }
  const totalAll = all.reduce((s, r) => s + r.length, 0);
  const target = (totalAll * Math.max(0, Math.min(100, p.fillPct))) / 100;
  if (p.anchor) {
    const [ax, ay] = p.anchor;
    const dist = (r: LayoutRow) => {
      const mx = (r.a[0] + r.b[0]) / 2, my = (r.a[1] + r.b[1]) / 2;
      return horizontal ? Math.abs(my - ay) + 0.001 * Math.abs(mx - ax) : Math.abs(mx - ax) + 0.001 * Math.abs(my - ay);
    };
    all.sort((r1, r2) => dist(r1) - dist(r2));
  }
  const rows: LayoutRow[] = [];
  let used = 0;
  for (const r of all) {
    if (used >= target - 1e-6) break;
    const remaining = target - used;
    if (r.length <= remaining + 6) { rows.push(r); used += r.length; }
    else if (remaining >= 12) {
      const f = remaining / r.length;
      const b: [number, number] = [r.a[0] + (r.b[0] - r.a[0]) * f, r.a[1] + (r.b[1] - r.a[1]) * f];
      rows.push({ a: r.a, b, length: remaining });
      used += remaining;
    }
  }
  // Modules along the row: fixed 2 in portrait, tracker 1 in portrait, vertical 2 in landscape.
  const perMetre = p.type === 'fixed' ? 2 / (p.moduleWidthM + 0.02) : p.type === 'tracker' ? 1 / (p.moduleWidthM + 0.02) : 2 / (p.moduleLengthM + 0.02);
  const kwdc = (used * perMetre * p.moduleWp) / 1000;
  return {
    rows,
    pitchM: pitch,
    rowWidthM: footprint,
    totalRowM: used,
    kwdc,
    arrayAreaHa: (used * pitch) / 1e4,
    zoneAreaHa: polygonsArea(zone) / 1e4,
    orientation: horizontal ? 'EW' : 'NS',
  };
}
