import type { Scenario } from './types';
import { evaluate, type Context } from './model';
import { PARAMS, getParam, rangeFor, setParam, type ParamMeta } from './params';

export interface TornadoBar {
  path: string;
  label: string;
  unit: string;
  lowValue: number;
  highValue: number;
  npvLow: number;
  npvHigh: number;
  swing: number;
}

export function tornado(base: Scenario, ctx: Context, onProgress?: (done: number, total: number) => void): { baseNpv: number; bars: TornadoBar[] } {
  const baseNpv = evaluate(base, ctx).npv;
  const params = PARAMS.filter((p) => rangeFor(p, base) && relevant(p, base));
  const bars: TornadoBar[] = [];
  params.forEach((p, i) => {
    const [lo, hi] = rangeFor(p, base)!;
    const run = (v: number) => { const s = structuredClone(base); setParam(s, p.path, v); return evaluate(s, ctx).npv; };
    const npvLow = run(lo), npvHigh = run(hi);
    bars.push({ path: p.path, label: p.label, unit: p.unit, lowValue: lo, highValue: hi, npvLow, npvHigh, swing: Math.abs(npvHigh - npvLow) });
    onProgress?.(i + 1, params.length);
  });
  bars.sort((a, b) => b.swing - a.swing);
  return { baseNpv, bars };
}

/** Skip parameters that cannot move the result for this design (e.g. GPU prices with no servers). */
function relevant(p: ParamMeta, s: Scenario): boolean {
  if (p.group === 'Compute' && s.compute.servers === 0) return false;
  if (p.group === 'Battery' && s.bess.powerKw === 0) return false;
  if (p.path === 'finance.landPrice' && !s.finance.includeLand) return false;
  if (p.path.startsWith('homes.cabin') && s.homes.cabins === 0) return false;
  if (p.path.startsWith('homes.granny') && !s.homes.grannyFlat) return false;
  if (p.path === 'ag.greenhouseGmPerM2' && s.ag.greenhouseM2 === 0) return false;
  if (p.path.startsWith('pv.capexPerWdc.')) return p.path.endsWith(s.pv.type) && s.pv.fillPct > 0;
  return true;
}

export interface Contribution {
  key: string;
  label: string;
  npv: number; // NPV of the full design minus NPV without this element
}

/** Marginal NPV of each element: the full design compared with the same design without that element. */
export function contributions(s: Scenario, ctx: Context): { total: number; items: Contribution[] } {
  const total = evaluate(s, ctx).npv;
  const without = (label: string, key: string, f: (x: Scenario) => void): Contribution => {
    const x = structuredClone(s);
    f(x);
    return { key, label, npv: total - evaluate(x, ctx).npv };
  };
  const items: Contribution[] = [];
  if (s.compute.servers > 0) items.push(without('GPU compute', 'compute', (x) => { x.compute.servers = 0; x.grid.importLimitKw = Math.min(x.grid.importLimitKw, 100); }));
  if (s.pv.fillPct > 0) items.push(without('Agrivoltaic solar', 'solar', (x) => { x.pv.fillPct = 0; x.grid.exportLimitKw = 100; }));
  if (s.bess.powerKw > 0) items.push(without('Battery', 'battery', (x) => { x.bess.powerKw = 0; }));
  if (s.homes.cabins > 0) items.push(without('Farm-stay cabins', 'cabins', (x) => { x.homes.cabins = 0; }));
  if (s.homes.grannyFlat) items.push(without('Granny flat', 'granny', (x) => { x.homes.grannyFlat = false; }));
  if (s.homes.houseMode === 'rent') items.push(without('Leasing the existing house', 'house', (x) => { x.homes.houseMode = 'owner'; }));
  if (s.ag.greenhouseM2 > 0) items.push(without('Heat-recovery greenhouse', 'greenhouse', (x) => { x.ag.greenhouseM2 = 0; }));
  if (s.ag.underArray !== 'none' || s.ag.openLand !== 'none') items.push(without('Grazing', 'grazing', (x) => { x.ag.underArray = 'none'; x.ag.openLand = 'none'; }));
  if (s.ag.hives > 0) items.push(without('Beehives', 'hives', (x) => { x.ag.hives = 0; }));
  if (s.finance.includeLand) items.push(without('Land purchase & resale value', 'land', (x) => { x.finance.includeLand = false; }));
  return { total, items };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function triangular(u: number, a: number, c: number, b: number): number {
  if (b <= a) return c;
  const m = Math.min(Math.max(c, a), b);
  const f = (m - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}

export interface MonteCarloResult {
  runs: number;
  npv: number[];
  irr: (number | null)[];
  p10: number;
  p50: number;
  p90: number;
  probPositive: number;
  mean: number;
}

/** Samples every ranged assumption from a triangular distribution (low, base, high) at once. */
export function monteCarlo(base: Scenario, ctx: Context, runs = 300, seed = 42, onProgress?: (done: number, total: number) => void): MonteCarloResult {
  const rnd = mulberry32(seed);
  const params = PARAMS.filter((p) => rangeFor(p, base) && relevant(p, base));
  const npv: number[] = [], irr: (number | null)[] = [];
  for (let i = 0; i < runs; i++) {
    const s = structuredClone(base);
    for (const p of params) {
      const [lo, hi] = rangeFor(p, base)!;
      setParam(s, p.path, triangular(rnd(), lo, getParam(base, p.path), hi));
    }
    const r = evaluate(s, ctx);
    npv.push(r.npv); irr.push(r.irr);
    if (onProgress && (i + 1) % 10 === 0) onProgress(i + 1, runs);
  }
  const sorted = [...npv].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];
  return { runs, npv, irr, p10: q(0.1), p50: q(0.5), p90: q(0.9), probPositive: npv.filter((v) => v > 0).length / runs, mean: npv.reduce((a, b) => a + b, 0) / runs };
}
