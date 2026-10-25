import type { AgResult, Climate, HomesResult, Scenario } from './types';

/** Normalised household load shape (sums to 1) by hour of day. */
const HOME_SHAPE = (() => {
  const raw = [0.55, 0.45, 0.4, 0.4, 0.42, 0.55, 0.95, 1.35, 1.2, 0.9, 0.8, 0.8, 0.8, 0.78, 0.8, 0.95, 1.25, 1.75, 2.0, 1.9, 1.6, 1.3, 1.0, 0.75];
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / s);
})();
const MONTH_FACTOR = [1.1, 1.1, 0.95, 0.9, 1.0, 1.2, 1.25, 1.2, 1.0, 0.9, 0.95, 1.1];

/** Existing house (owner-occupied or leased) plus any new dwellings. */
export function dwellingsCount(s: Scenario): number {
  return 1 + (s.homes.grannyFlat ? 1 : 0) + s.homes.cabins;
}

/** Hourly kW for dwellings + farm + greenhouse auxiliaries. */
export function otherLoad(s: Scenario, monthOf: (i: number) => number, out: Float64Array): Float64Array {
  const dwellings = dwellingsCount(s);
  // Short-stay cabins use about 60% of a household's energy, scaled by occupancy.
  const cabinEq = s.homes.cabins * 0.6 * (s.homes.cabinOccupancyPct / 100);
  const homesKwhDay = (dwellings - s.homes.cabins + cabinEq) * s.homes.dwellingKwhPerDay;
  const ghKw = s.ag.greenhouseM2 * 0.004;
  for (let i = 0; i < out.length; i++) {
    const h = i % 24;
    out[i] = homesKwhDay * HOME_SHAPE[h] * MONTH_FACTOR[monthOf(i)] + s.site.farmBaseKw + ghKw;
  }
  return out;
}

export function homesKwhPerYear(s: Scenario): number {
  const cabinEq = s.homes.cabins * 0.6 * (s.homes.cabinOccupancyPct / 100);
  const dwellings = dwellingsCount(s) - s.homes.cabins + cabinEq;
  return dwellings * s.homes.dwellingKwhPerDay * 365 * 1.06;
}

/** Monthly greenhouse heating demand weights (southern-hemisphere winter peak). */
const HEAT_WEIGHT = [0.01, 0.01, 0.03, 0.08, 0.13, 0.18, 0.2, 0.17, 0.11, 0.05, 0.02, 0.01];

export function agriculture(
  s: Scenario,
  areas: { lotHa: number; ru1Ha: number; underArrayHa: number; infraHa: number; kwdc: number; kwdcFullSolar: number },
  heatMwhThByMonth: number[] | null,
  climate: Climate,
): AgResult {
  void climate;
  const a = s.ag;
  const lines: { label: string; value: number }[] = [];
  const pastureFactor = Math.max(0, Math.min(1.1, a.underArrayFactorAtGcr0 + a.underArrayFactorSlope * s.pv.gcr));
  // Cattle need high clearance; vertical fences allow cattle between rows if fenced off (assume not).
  const underUse = a.underArray === 'cattle' && (s.pv.type === 'vertical' || s.pv.clearanceM < 3.5) ? 'sheep' : a.underArray;
  const underHa = Math.max(0, areas.underArrayHa);
  const openHa = Math.max(0, areas.ru1Ha - underHa - areas.infraHa) + Math.max(0, areas.lotHa - areas.ru1Ha - 0.75); // R5 paddock beyond house curtilage
  let dse = 0, gm = 0, hens = 0;
  const grazeGm = (use: string) => (use === 'cattle' ? a.cattleGmPerDse : a.sheepGmPerDse);
  if (underUse === 'sheep' || underUse === 'cattle') {
    const d = underHa * a.dsePerHa * pastureFactor;
    dse += d;
    const v = d * grazeGm(underUse);
    gm += v;
    lines.push({ label: `${underUse === 'sheep' ? 'Sheep' : 'Cattle'} under the array (${d.toFixed(0)} DSE)`, value: v });
  } else if (underUse === 'poultry') {
    hens = Math.round(underHa * a.henPerHa);
    const v = hens * a.henGm - (hens > 0 ? a.poultryFixedPerYr : 0);
    gm += v;
    lines.push({ label: `Free-range hens under the array (${hens.toLocaleString()} birds)`, value: v });
  }
  if (a.openLand === 'sheep' || a.openLand === 'cattle') {
    const d = openHa * a.dsePerHa;
    dse += d;
    const v = d * grazeGm(a.openLand);
    gm += v;
    lines.push({ label: `${a.openLand === 'sheep' ? 'Sheep' : 'Cattle'} on open paddocks (${d.toFixed(0)} DSE)`, value: v });
  } else if (a.openLand === 'hay') {
    const v = openHa * a.hayGmPerHa;
    gm += v;
    lines.push({ label: `Hay/silage on open paddocks (${openHa.toFixed(1)} ha)`, value: v });
  }
  if (a.hives > 0) {
    const v = a.hives * a.hiveGm;
    gm += v;
    lines.push({ label: `Beehives (${a.hives})`, value: v });
  }
  let heatCover = 0;
  if (a.greenhouseM2 > 0) {
    const demand = (a.greenhouseM2 * a.greenhouseHeatKwhPerM2Yr) / 1000; // MWh_th
    if (s.compute.heatToGreenhouse && heatMwhThByMonth && demand > 0) {
      let met = 0;
      for (let m = 0; m < 12; m++) met += Math.min(demand * HEAT_WEIGHT[m], heatMwhThByMonth[m] * 0.6); // 60% recoverable at useful temperature
      heatCover = Math.min(1, met / demand);
    }
    const factor = a.greenhouseUnheatedFactor + (1 - a.greenhouseUnheatedFactor) * heatCover;
    const v = a.greenhouseM2 * a.greenhouseGmPerM2 * factor;
    gm += v;
    lines.push({ label: `Greenhouse ${a.greenhouseM2.toLocaleString()} m² (${Math.round(heatCover * 100)}% heated by GPU waste heat)`, value: v });
  }
  // Land equivalent ratio: solar output relative to a conventional solar farm on the same land plus farm output
  // relative to the same land fully farmed.
  const potentialDse = (underHa + openHa) * a.dsePerHa;
  const lerAg = potentialDse > 0 ? (dse + hens / Math.max(1, a.henPerHa) * a.dsePerHa) / potentialDse : 0;
  const lerSolar = areas.kwdcFullSolar > 0 ? areas.kwdc / areas.kwdcFullSolar : 0;
  return {
    underArrayHa: underHa, openHa, dse, pastureFactor, hens, grossMargin: gm, lines, greenhouseHeatCoverPct: heatCover * 100,
    lerSolar, lerAg: Math.min(1.2, lerAg), ler: lerSolar + Math.min(1.2, lerAg),
  };
}

export function homes(s: Scenario): HomesResult {
  const h = s.homes;
  const lines: HomesResult['lines'] = [];
  let revenue = 0, opex = 0, capex = 0, guestNights = 0;
  const ltr = (label: string, weekly: number, units: number) => {
    const rev = weekly * 52 * (1 - h.vacancyPct / 100) * units;
    const ox = rev * (h.ltrManagementPct / 100) + 1800 * units; // management + repairs/insurance
    revenue += rev; opex += ox;
    lines.push({ label, units, revenue: rev, opex: ox });
  };
  if (h.houseMode === 'rent') ltr('Existing 4-bed house (long-term lease)', h.houseWeeklyRent, 1);
  if (h.grannyFlat) {
    ltr('New secondary dwelling (granny flat)', h.grannyWeeklyRent, 1);
    capex += h.grannyCapex + h.raisedFloorPremium;
  }
  if (h.cabins > 0) {
    const nights = 365 * (h.cabinOccupancyPct / 100) * h.cabins;
    const gross = nights * h.cabinAdr;
    const rev = gross * (1 - h.platformFeePct / 100);
    const ox = gross * (h.cabinOpexPctRevenue / 100);
    revenue += rev; opex += ox; guestNights += nights;
    capex += h.cabins * (h.cabinCapex + h.raisedFloorPremium);
    lines.push({ label: 'Farm-stay cabins (short stay)', units: h.cabins, revenue: rev, opex: ox });
  }
  return { dwellings: dwellingsCount(s), revenue, opex, capex, lines, guestNights };
}
