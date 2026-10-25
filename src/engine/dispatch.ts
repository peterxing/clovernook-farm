import type { EnergyTotals, HourlySeries } from './types';
import { HOURS } from './solar';

export interface DispatchInput {
  pvAc: Float64Array; // kW
  pvDc: Float64Array; // kW (for reporting)
  gpuLoad: Float64Array; // kW facility load for sold GPU hours (incl. PUE)
  flexCap: Float64Array; // kW extra facility load available for interruptible work
  flexKwhPerGpuHr: Float64Array; // facility kWh per flexible GPU-hour (incl. PUE)
  otherLoad: Float64Array; // homes, farm, greenhouse auxiliaries (kW)
  price: ArrayLike<number>; // spot A$/MWh
  gpusSoldPerHour: number;
  importLimitKw: number;
  exportLimitKw: number;
  bessKwh: number;
  bessKw: number;
  rte: number; // 0-1
  minSoc: number; // 0-1
  networkAdderPerMwh: number;
  exportLossFactor: number;
  exportFeePerMwh: number;
  demandChargePerKvaMonth: number;
  flexValuePerGpuHr: number; // A$ received per flexible GPU-hour (net of fees)
  cycleCostPerMwh: number;
  pue: Float64Array;
  keepSeries: boolean;
  pvKwp: number;
}

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
const MONTH = (() => {
  const m = new Uint8Array(HOURS);
  for (let i = 0; i < HOURS; i++) {
    const d = Math.floor(i / 24);
    let k = 0;
    while (d >= MONTH_START[k + 1]) k++;
    m[i] = k;
  }
  return m;
})();
export const monthOfHour = (i: number) => MONTH[i];

let scratch: HourlySeries | null = null;
function makeSeries(): HourlySeries {
  const f = () => new Float64Array(HOURS);
  return { pvAc: f(), pvDc: f(), gpuLoad: f(), flexLoad: f(), otherLoad: f(), pvToLoad: f(), battCharge: f(), battDischarge: f(), soc: f(), gridImport: f(), gridExport: f(), curtailed: f(), unserved: f(), price: f() };
}
const W = {
  net: new Float64Array(HOURS), flexPv: new Float64Array(HOURS), reserve: new Float64Array(HOURS + 1),
  disTh: new Float64Array(365), chTh: new Float64Array(365),
  dv: new Float64Array(48), dq: new Float64Array(48), cv: new Float64Array(48), cq: new Float64Array(48),
};

/** Sort (value, qty) pairs in place by value: ascending or descending. */
function sortPairs(v: Float64Array, q: Float64Array, n: number, desc: boolean) {
  for (let i = 1; i < n; i++) {
    const a = v[i], b = q[i];
    let j = i - 1;
    while (j >= 0 && (desc ? v[j] < a : v[j] > a)) { v[j + 1] = v[j]; q[j + 1] = q[j]; j--; }
    v[j + 1] = a; q[j + 1] = b;
  }
}

/** Value of the marginal tranche once `need` units have been allocated (tranches pre-sorted). */
function marginal(v: Float64Array, q: Float64Array, n: number, need: number, fallback: number): number {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (q[i] <= 0) continue;
    acc += q[i];
    if (acc >= need) return v[i];
  }
  for (let i = n - 1; i >= 0; i--) if (q[i] > 0) return v[i];
  return fallback;
}

/**
 * Hourly energy balance. Solar serves load first; interruptible GPU work soaks up surplus (and grid energy) whenever
 * it earns more than the energy is worth. The battery uses daily thresholds with perfect day-ahead foresight: it charges
 * in the day's cheapest hours (free when solar would otherwise be curtailed) and discharges in the most valuable hours,
 * either to avoid imports or to export at peak prices. It always holds back enough energy for later hours where load
 * would exceed solar plus the import limit. Exports never happen at negative prices.
 */
export function dispatch(inp: DispatchInput): { totals: EnergyTotals; series: HourlySeries | null } {
  const s = inp.keepSeries ? makeSeries() : (scratch ??= makeSeries());
  const N = HOURS;
  const eMax = Math.max(0, inp.bessKwh), eMin = eMax * inp.minSoc, pMax = Math.max(0, inp.bessKw);
  const hasBatt = eMax > 0 && pMax > 0;
  const eta = Math.sqrt(Math.max(0.01, inp.rte));
  const rte = inp.rte;
  const impLim = Math.max(0, inp.importLimitKw), expLim = Math.max(0, inp.exportLimitKw);
  const adder = inp.networkAdderPerMwh, lf = inp.exportLossFactor, fee = inp.exportFeePerMwh;
  const { net, flexPv, reserve, disTh, chTh, dv, dq, cv, cq } = W;
  const price = inp.price;

  // Pass 1: interruptible compute on solar surplus, net position after it.
  for (let t = 0; t < N; t++) {
    const n0 = inp.pvAc[t] - inp.gpuLoad[t] - inp.otherLoad[t];
    const fk = inp.flexKwhPerGpuHr[t];
    const flexVal = fk > 0 ? (inp.flexValuePerGpuHr / fk) * 1000 : 0;
    const expP = price[t] * lf - fee;
    const f = n0 > 0 && inp.flexCap[t] > 0 && flexVal > Math.max(0, expP) ? Math.min(inp.flexCap[t], n0) : 0;
    flexPv[t] = f;
    net[t] = n0 - f;
  }
  // Pass 2: energy the battery must hold for later hours where load exceeds solar plus the import limit.
  reserve[N] = 0;
  for (let t = N - 1; t >= 0; t--) reserve[t] = net[t] >= 0 ? 0 : reserve[t + 1] + Math.max(0, -net[t] - impLim);
  // Monthly import peak the site would set anyway; grid charging stays under it so it never adds demand charges.
  const basePeak = new Array(12).fill(0);
  for (let t = 0; t < N; t++) if (net[t] < 0) basePeak[MONTH[t]] = Math.max(basePeak[MONTH[t]], Math.min(-net[t], impLim));
  // Pass 3: daily thresholds. Each hour offers discharge "tranches" (avoid an import, or export) and charge tranches
  // (otherwise-curtailed solar, solar that could be exported, or grid energy). The battery's usable energy is matched
  // against the most valuable discharge tranches and the cheapest charge tranches; the marginal tranche sets the price
  // threshold for that day.
  const usable = eMax - eMin;
  for (let d = 0; d < 365 && hasBatt; d++) {
    let nd = 0, nc = 0;
    for (let h = 0; h < 24; h++) {
      const t = d * 24 + h, n = net[t];
      const impP = price[t] + adder, expP = price[t] * lf - fee;
      if (n < 0) {
        const q1 = Math.min(-n, pMax);
        dv[nd] = impP; dq[nd++] = q1;
        if (expP > 0) { dv[nd] = expP; dq[nd++] = Math.min(expLim, pMax - q1); }
        const room = impLim + n;
        if (room > 0) { cv[nc] = impP; cq[nc++] = Math.min(room, pMax); }
      } else {
        const curtailQ = expP <= 0 ? n : Math.max(0, n - expLim);
        const exportQ = expP > 0 ? Math.min(n, expLim) : 0;
        if (curtailQ > 0) { cv[nc] = 0; cq[nc++] = Math.min(curtailQ, pMax); }
        if (exportQ > 0) { cv[nc] = expP; cq[nc++] = Math.max(0, Math.min(exportQ, pMax - curtailQ)); }
        if (expP > 0 && expLim - exportQ > 0) { dv[nd] = expP; dq[nd++] = Math.min(expLim - exportQ, pMax); }
        if (n === 0 && impLim > 0) { cv[nc] = impP; cq[nc++] = Math.min(impLim, pMax); }
      }
    }
    sortPairs(dv, dq, nd, true);
    sortPairs(cv, cq, nc, false);
    disTh[d] = marginal(dv, dq, nd, usable * eta, -1e9);
    chTh[d] = marginal(cv, cq, nc, usable / eta, 1e9);
  }

  let soc = hasBatt ? eMin + (eMax - eMin) * 0.5 : 0;
  let tPvDc = 0, tPvAc = 0, tToLoad = 0, tToBatt = 0, tToFlex = 0, tGridToBatt = 0, tBattToLoad = 0, tBattToGrid = 0;
  let tExp = 0, tImp = 0, tCurt = 0, tUns = 0, tGpu = 0, tFlex = 0, tOther = 0, tImpCost = 0, tExpRev = 0, tArb = 0;
  let tGpuSold = 0, tGpuLost = 0, tFlexHrs = 0, tHeat = 0, tThroughput = 0;
  const mPv = new Array(12).fill(0), mLoad = new Array(12).fill(0), mImp = new Array(12).fill(0), mExp = new Array(12).fill(0), mCurt = new Array(12).fill(0), mHeat = new Array(12).fill(0), mPeak = new Array(12).fill(0);

  for (let t = 0; t < N; t++) {
    const d = (t / 24) | 0;
    const m = MONTH[t];
    const spot = price[t];
    const impP = spot + adder, expP = spot * lf - fee;
    const pv = inp.pvAc[t], gpu = inp.gpuLoad[t], other = inp.otherLoad[t];
    const load = gpu + other;
    const fPv = flexPv[t];
    const n = net[t];
    const profitable = disTh[d] * rte - chTh[d] - inp.cycleCostPerMwh > 0;
    let pRoom = pMax, impRoom = impLim, expRoom = expLim;
    let ch = 0, dis = 0, imp = 0, exp = 0, curt = 0, uns = 0, gridCh = 0, disGrid = 0, toLoad: number;
    const avail = hasBatt ? Math.max(0, (soc - eMin) * eta) : 0;
    const room = hasBatt ? Math.max(0, (eMax - soc) / eta) : 0;

    if (n >= 0) {
      toLoad = load;
      let surplus = n;
      if (hasBatt && room > 0) {
        // Solar that can't be exported is free to store; exportable solar is stored only when exporting it now is
        // worth less than the day's charge threshold.
        const curtailQ = expP <= 0 ? surplus : Math.max(0, surplus - expRoom);
        let c = Math.min(curtailQ, pRoom, room);
        if (expP <= chTh[d] && profitable) c = Math.min(surplus, pRoom, room);
        if (c > 0) { soc += c * eta; ch = c; surplus -= c; pRoom -= c; tToBatt += c; }
      }
      if (expP > 0) { exp = Math.min(surplus, expRoom); expRoom -= exp; surplus -= exp; }
      curt = surplus;
      // Peak-price export from the battery while solar is still running (late afternoon).
      if (hasBatt && ch === 0 && profitable && expP > 0 && expP >= disTh[d] && expRoom > 0) {
        const x = Math.min(pRoom, expRoom, Math.max(0, avail - reserve[t + 1]));
        if (x > 0) { soc -= x / eta; disGrid = x; exp += x; expRoom -= x; pRoom -= x; tBattToGrid += x; tArb += (x * expP) / 1000; }
      }
    } else {
      const deficit = -n;
      toLoad = pv - fPv;
      const forced = Math.max(0, deficit - impRoom);
      const dForced = Math.min(forced, avail, pRoom);
      let dDisc = 0;
      if (hasBatt && profitable && impP >= disTh[d]) dDisc = Math.max(0, Math.min(deficit - dForced, avail - dForced - reserve[t + 1], pRoom - dForced));
      dis = dForced + dDisc;
      if (dis > 0) { soc -= dis / eta; pRoom -= dis; tBattToLoad += dis; }
      const rest = deficit - dis;
      imp = Math.min(rest, impRoom); impRoom -= imp;
      uns = rest - imp;
      if (hasBatt && profitable && pRoom > 0) {
        if (dis === 0 && impP <= chTh[d] && impRoom > 0) {
          const g = Math.min(pRoom, Math.max(0, (eMax - soc) / eta), impRoom, Math.max(0, basePeak[m] - imp));
          if (g > 0) { soc += g * eta; gridCh = g; imp += g; impRoom -= g; pRoom -= g; tGridToBatt += g; }
        } else if (expP > 0 && expP >= disTh[d] && expRoom > 0) {
          const left = Math.max(0, (soc - eMin) * eta - reserve[t + 1]);
          const x = Math.min(pRoom, expRoom, left);
          if (x > 0) { soc -= x / eta; disGrid = x; exp += x; expRoom -= x; pRoom -= x; tBattToGrid += x; tArb += (x * expP) / 1000; }
        }
      }
    }

    // Interruptible compute: solar share decided in pass 1, then grid energy when it pays.
    let flex = fPv;
    const fk = inp.flexKwhPerGpuHr[t];
    const flexVal = fk > 0 ? (inp.flexValuePerGpuHr / fk) * 1000 : 0;
    const flexLeft = inp.flexCap[t] - fPv;
    if (flexLeft > 0 && impRoom > 0 && flexVal > impP) {
      const f = Math.min(flexLeft, impRoom);
      flex += f; imp += f; impRoom -= f;
    }

    const lostFrac = gpu > 0 ? Math.min(1, uns / gpu) : 0;
    tGpuSold += inp.gpusSoldPerHour * (1 - lostFrac);
    tGpuLost += inp.gpusSoldPerHour * lostFrac;
    if (flex > 0 && fk > 0) tFlexHrs += flex / fk;
    const heat = (gpu * (1 - lostFrac) + flex) / Math.max(1, inp.pue[t]);
    tHeat += heat; mHeat[m] += heat;
    tPvDc += inp.pvDc[t]; tPvAc += pv; tToLoad += toLoad; tToFlex += fPv; tExp += exp; tImp += imp; tCurt += curt; tUns += uns;
    tGpu += gpu; tFlex += flex; tOther += other;
    tImpCost += (imp * impP) / 1000;
    tExpRev += (exp * expP) / 1000;
    tThroughput += dis + disGrid;
    if (imp > mPeak[m]) mPeak[m] = imp;
    mPv[m] += pv; mLoad[m] += load + flex; mImp[m] += imp; mExp[m] += exp; mCurt[m] += curt;

    if (inp.keepSeries) {
      s.pvAc[t] = pv; s.pvDc[t] = inp.pvDc[t]; s.gpuLoad[t] = gpu; s.flexLoad[t] = flex; s.otherLoad[t] = other; s.pvToLoad[t] = toLoad + fPv;
      s.battCharge[t] = ch + gridCh; s.battDischarge[t] = dis + disGrid; s.soc[t] = eMax > 0 ? soc / eMax : 0;
      s.gridImport[t] = imp; s.gridExport[t] = exp; s.curtailed[t] = curt; s.unserved[t] = uns; s.price[t] = spot;
    }
  }

  const demandCharges = mPeak.reduce((a, kw) => a + (kw / 0.95) * inp.demandChargePerKvaMonth, 0);
  const totalLoad = tGpu + tFlex + tOther - tUns;
  const pvShareOfBatt = tToBatt / Math.max(1e-9, tToBatt + tGridToBatt);
  const solarServed = tToLoad + tToFlex + tBattToLoad * pvShareOfBatt;
  const M = (v: number) => v / 1000;
  const totals: EnergyTotals = {
    pvDcMwh: M(tPvDc), pvAcMwh: M(tPvAc), pvToLoadMwh: M(tToLoad), pvToBattMwh: M(tToBatt), pvToFlexMwh: M(tToFlex),
    gridToBattMwh: M(tGridToBatt), battToLoadMwh: M(tBattToLoad), battToGridMwh: M(tBattToGrid),
    exportMwh: M(tExp), importMwh: M(tImp), curtailedMwh: M(tCurt), unservedMwh: M(tUns),
    gpuLoadMwh: M(tGpu), flexLoadMwh: M(tFlex), otherLoadMwh: M(tOther),
    importCost: tImpCost, demandCharges, exportRevenue: tExpRev, arbitrageRevenue: tArb,
    specificYield: inp.pvKwp > 0 ? tPvAc / inp.pvKwp : 0,
    selfSufficiencyPct: totalLoad > 0 ? (100 * solarServed) / totalLoad : 0,
    solarSelfUsePct: tPvAc > 0 ? (100 * (tToLoad + tToFlex + tToBatt)) / tPvAc : 0,
    peakImportKw: Math.max(...mPeak),
    batteryCycles: eMax > 0 ? tThroughput / eMax : 0,
    gpuHoursSold: tGpuSold, gpuHoursLost: tGpuLost, flexGpuHours: tFlexHrs,
    heatMwhTh: M(tHeat),
    monthly: { pv: mPv.map(M), load: mLoad.map(M), imp: mImp.map(M), exp: mExp.map(M), curtail: mCurt.map(M), heat: mHeat.map(M) },
  };
  return { totals, series: inp.keepSeries ? s : null };
}
