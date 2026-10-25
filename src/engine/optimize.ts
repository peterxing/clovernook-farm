import type { GpuModel, Objective, PvType, Result, Scenario, UnderArrayUse, OpenLandUse } from './types';
import { evaluate, fpl, type Context } from './model';

export interface OptimizeOptions {
  objective: Objective;
  capexBudget: number; // A$, 0 = unconstrained
  maxImportKw: number;
  maxExportKw: number;
  minAgSharePct: number; // share of the lot still grazed or farmed
  maxCabins: number;
  allowedPv: PvType[];
  allowedGpu: GpuModel[];
  maxServers: number;
  floodSafe: boolean; // modules and equipment at or above the flood planning level
  minPvKwdc: number; // keep every element of the brief in the design
  minBessKwh: number;
  minServers: number;
  minNewDwellings: number;
}

export const defaultOptimizeOptions = (): OptimizeOptions => ({
  objective: 'npv',
  capexBudget: 25_000_000,
  maxImportKw: 1500,
  maxExportKw: 5000,
  minAgSharePct: 70,
  maxCabins: 6,
  allowedPv: ['fixed', 'tracker', 'vertical'],
  allowedGpu: ['B300', 'B200', 'H200', 'RTXPRO6000', 'L40S'],
  maxServers: 64,
  floodSafe: true,
  minPvKwdc: 1000,
  minBessKwh: 1000,
  minServers: 2,
  minNewDwellings: 2,
});

export interface Evaluated {
  key: string;
  score: number;
  feasible: boolean;
  violation: number;
  npv: number;
  irr: number | null;
  capex: number;
  kwdc: number;
  bessKwh: number;
  servers: number;
  gpu: GpuModel;
  pvType: PvType;
  cabins: number;
}

export interface OptimizeProgress {
  done: number;
  total: number;
  best: Evaluated | null;
  phase: string;
}

export interface OptimizeResult {
  best: Scenario;
  bestResult: Result;
  evaluated: Evaluated[];
  top: { scenario: Scenario; summary: Evaluated }[];
  evaluations: number;
  ms: number;
}

interface Variable {
  name: string;
  values: (s: Scenario) => (number | string | boolean)[];
  get: (s: Scenario) => number | string | boolean;
  set: (s: Scenario, v: number | string | boolean) => void;
}

const GCR: Record<PvType, number[]> = { fixed: [0.25, 0.3, 0.35, 0.4, 0.45], tracker: [0.25, 0.3, 0.35, 0.4], vertical: [0.15, 0.2, 0.25, 0.3] };

function variables(o: OptimizeOptions): Variable[] {
  const imp = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000].filter((v) => v <= o.maxImportKw);
  const exp = [100, 500, 1000, 2000, 3000, 5000].filter((v) => v <= o.maxExportKw);
  const servers = [0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96].filter((v) => v <= o.maxServers);
  return [
    { name: 'pv.type', values: () => o.allowedPv, get: (s) => s.pv.type, set: (s, v) => { s.pv.type = v as PvType; if (!GCR[s.pv.type].includes(s.pv.gcr)) s.pv.gcr = GCR[s.pv.type][2]; } },
    { name: 'pv.fillPct', values: () => [0, 20, 40, 60, 80, 100], get: (s) => s.pv.fillPct, set: (s, v) => { s.pv.fillPct = v as number; } },
    { name: 'pv.gcr', values: (s) => GCR[s.pv.type], get: (s) => s.pv.gcr, set: (s, v) => { s.pv.gcr = v as number; } },
    { name: 'pv.tiltDeg', values: (s) => (s.pv.type === 'fixed' ? [10, 20, 30] : [s.pv.tiltDeg]), get: (s) => s.pv.tiltDeg, set: (s, v) => { s.pv.tiltDeg = v as number; } },
    { name: 'pv.dcAcRatio', values: () => [1.1, 1.2, 1.3, 1.4, 1.5], get: (s) => s.pv.dcAcRatio, set: (s, v) => { s.pv.dcAcRatio = v as number; } },
    { name: 'grid.exportLimitKw', values: () => exp, get: (s) => s.grid.exportLimitKw, set: (s, v) => { s.grid.exportLimitKw = v as number; } },
    { name: 'grid.importLimitKw', values: () => imp, get: (s) => s.grid.importLimitKw, set: (s, v) => { s.grid.importLimitKw = v as number; } },
    { name: 'bess.powerKw', values: () => [0, 250, 500, 1000, 1500, 2000, 3000], get: (s) => s.bess.powerKw, set: (s, v) => { s.bess.powerKw = v as number; } },
    { name: 'bess.hours', values: () => [1, 2, 4], get: (s) => s.bess.hours, set: (s, v) => { s.bess.hours = v as number; } },
    { name: 'compute.model', values: () => o.allowedGpu, get: (s) => s.compute.model, set: (s, v) => { s.compute.model = v as GpuModel; } },
    { name: 'compute.servers', values: () => servers, get: (s) => s.compute.servers, set: (s, v) => { s.compute.servers = v as number; } },
    { name: 'homes.cabins', values: () => Array.from({ length: o.maxCabins + 1 }, (_, i) => i), get: (s) => s.homes.cabins, set: (s, v) => { s.homes.cabins = v as number; } },
    { name: 'homes.grannyFlat', values: () => [false, true], get: (s) => s.homes.grannyFlat, set: (s, v) => { s.homes.grannyFlat = v as boolean; } },
    { name: 'ag.underArray', values: (s) => (s.pv.type !== 'vertical' && s.pv.clearanceM >= 3.5 ? ['sheep', 'cattle', 'poultry'] : ['sheep', 'poultry']), get: (s) => s.ag.underArray, set: (s, v) => { s.ag.underArray = v as UnderArrayUse; } },
    { name: 'ag.openLand', values: () => ['sheep', 'cattle', 'hay'], get: (s) => s.ag.openLand, set: (s, v) => { s.ag.openLand = v as OpenLandUse; } },
    { name: 'ag.greenhouseM2', values: () => [0, 250, 500, 1000, 2000], get: (s) => s.ag.greenhouseM2, set: (s, v) => { s.ag.greenhouseM2 = v as number; } },
    { name: 'ag.hives', values: () => [0, 10, 20, 40], get: (s) => s.ag.hives, set: (s, v) => { s.ag.hives = v as number; } },
  ];
}

export function agSharePct(r: Result, lotHa: number): number {
  const s = r.scenario;
  const under = s.ag.underArray !== 'none' ? r.ag.underArrayHa : 0;
  const open = s.ag.openLand !== 'none' ? r.ag.openHa : 0;
  return (100 * (under + open + s.ag.greenhouseM2 / 1e4)) / lotHa;
}

export function scoreOf(r: Result, objective: Objective): number {
  switch (objective) {
    case 'irr': return r.irr ?? -1;
    case 'ebitdaPerHa': return r.ebitdaPerHa;
    case 'profitIndex': return r.profitIndex;
    default: return r.npv;
  }
}

/** Applies the flood-safe rule: modules and the equipment platform sit at the flood planning level. */
export function applyFloodSafe(s: Scenario): void {
  const level = fpl(s);
  s.pv.clearanceM = Math.max(s.pv.clearanceM, Math.round((level - s.site.groundLevelM) * 10) / 10);
  s.compute.padRaiseM = Math.max(s.compute.padRaiseM, Math.round((level - s.site.padGroundM) * 10) / 10);
}

const keyOf = (s: Scenario, vars: Variable[]) => vars.map((v) => String(v.get(s))).join('|');

/**
 * Coordinate-descent search with several starting designs. Each pass tries every value of every decision variable
 * while holding the others fixed and keeps the best feasible design; it stops when a full pass finds no improvement.
 */
export function optimize(base: Scenario, ctx: Context, o: OptimizeOptions, onProgress?: (p: OptimizeProgress) => void): OptimizeResult {
  const t0 = Date.now();
  const vars = variables(o);
  const cache = new Map<string, Evaluated>();
  const lotHa = ctx.site.areaHa;
  let evaluations = 0;
  let bestGlobal: { s: Scenario; e: Evaluated } | null = null;
  const estTotal = 1200;

  const prep = (s: Scenario) => {
    s.finance.capexBudget = o.capexBudget;
    if (o.floodSafe) applyFloodSafe(s);
    if (s.pv.type === 'vertical' && o.floodSafe && !o.allowedPv.includes('vertical')) s.pv.type = 'fixed';
  };

  const evalS = (s: Scenario): Evaluated => {
    const key = keyOf(s, vars);
    const hit = cache.get(key);
    if (hit) return hit;
    const r = evaluate(s, ctx);
    evaluations++;
    const lostShare = r.energy.gpuHoursLost / Math.max(1, r.energy.gpuHoursSold + r.energy.gpuHoursLost);
    const newDwellings = s.homes.cabins + (s.homes.grannyFlat ? 1 : 0);
    const violation =
      (o.capexBudget > 0 ? Math.max(0, r.capexTotal - o.capexBudget) / o.capexBudget : 0)
      + Math.max(0, o.minAgSharePct - agSharePct(r, lotHa)) / 100
      + Math.max(0, lostShare - 0.01)
      + (o.minPvKwdc > 0 ? Math.max(0, o.minPvKwdc - r.layout.kwdc) / o.minPvKwdc : 0)
      + (o.minBessKwh > 0 ? Math.max(0, o.minBessKwh - r.bessKwh) / o.minBessKwh : 0)
      + (o.minServers > 0 ? Math.max(0, o.minServers - s.compute.servers) / o.minServers : 0)
      + (o.minNewDwellings > 0 ? Math.max(0, o.minNewDwellings - newDwellings) / o.minNewDwellings : 0);
    const feasible = violation <= 1e-9;
    const e: Evaluated = {
      key, score: scoreOf(r, o.objective), feasible, violation, npv: r.npv, irr: r.irr, capex: r.capexTotal, kwdc: r.layout.kwdc,
      bessKwh: r.bessKwh, servers: s.compute.servers, gpu: s.compute.model, pvType: s.pv.type, cabins: s.homes.cabins,
    };
    cache.set(key, e);
    if (feasible && (!bestGlobal || e.score > bestGlobal.e.score)) bestGlobal = { s: structuredClone(s), e };
    if (onProgress && evaluations % 25 === 0) onProgress({ done: evaluations, total: Math.max(estTotal, evaluations + 50), best: bestGlobal?.e ?? null, phase: 'Searching' });
    return e;
  };

  const better = (a: Evaluated, b: Evaluated) => (a.feasible && !b.feasible) || (a.feasible === b.feasible && (a.feasible ? a.score > b.score : a.violation < b.violation));

  const starts: Scenario[] = [];
  const s0 = structuredClone(base); prep(s0); starts.push(s0);
  for (const type of o.allowedPv) {
    const s = structuredClone(base);
    s.pv.type = type; s.pv.gcr = GCR[type][2]; s.pv.fillPct = 60; s.compute.servers = Math.min(8, o.maxServers);
    s.compute.model = o.allowedGpu.includes(s.compute.model) ? s.compute.model : o.allowedGpu[0];
    s.bess.powerKw = 1000; s.bess.hours = 2; s.grid.importLimitKw = Math.min(1000, o.maxImportKw); s.grid.exportLimitKw = Math.min(2000, o.maxExportKw);
    prep(s); starts.push(s);
  }
  // A lean start: no compute, small array.
  const lean = structuredClone(base);
  lean.compute.servers = 0; lean.pv.fillPct = 20; lean.bess.powerKw = 0; lean.grid.importLimitKw = Math.min(100, o.maxImportKw); lean.grid.exportLimitKw = Math.min(500, o.maxExportKw);
  if (!o.allowedPv.includes(lean.pv.type)) lean.pv.type = o.allowedPv[0];
  prep(lean); starts.push(lean);

  for (const start of starts) {
    let cur = structuredClone(start);
    if (!o.allowedPv.includes(cur.pv.type)) cur.pv.type = o.allowedPv[0];
    if (!o.allowedGpu.includes(cur.compute.model)) cur.compute.model = o.allowedGpu[0];
    let curE = evalS(cur);
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      for (const v of vars) {
        let bestS = cur, bestE = curE;
        for (const val of v.values(cur)) {
          if (val === v.get(cur)) continue;
          const cand = structuredClone(cur);
          v.set(cand, val);
          prep(cand);
          const e = evalS(cand);
          if (better(e, bestE)) { bestS = cand; bestE = e; }
        }
        if (bestS !== cur) { cur = bestS; curE = bestE; improved = true; }
      }
      if (!improved) break;
    }
  }

  const best = bestGlobal as { s: Scenario; e: Evaluated } | null;
  const bestScenario = best ? best.s : structuredClone(base);
  bestScenario.name = 'Optimised';
  const bestResult = evaluate(bestScenario, ctx, { series: true });
  const evaluated = [...cache.values()];
  // Top distinct designs by score (feasible only), re-materialised for display.
  const topKeys = evaluated.filter((e) => e.feasible).sort((a, b) => b.score - a.score).slice(0, 8);
  const top = topKeys.map((summary) => ({ scenario: rebuild(bestScenario, summary.key, vars), summary }));
  onProgress?.({ done: evaluations, total: evaluations, best: best?.e ?? null, phase: 'Done' });
  return { best: bestScenario, bestResult, evaluated, top, evaluations, ms: Date.now() - t0 };
}

function rebuild(template: Scenario, key: string, vars: Variable[]): Scenario {
  const s = structuredClone(template);
  const parts = key.split('|');
  vars.forEach((v, i) => {
    const raw = parts[i];
    const cur = v.get(s);
    const val = typeof cur === 'number' ? Number(raw) : typeof cur === 'boolean' ? raw === 'true' : raw;
    v.set(s, val);
  });
  return s;
}
