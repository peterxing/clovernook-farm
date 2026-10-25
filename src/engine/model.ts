import type { CapexLine, Climate, FloodItem, Layout, Result, Scenario, YearRow } from './types';
import type { SiteData } from './site';
import { HOURS, floodAep, pvProfile, sunGeometry, type PvProfile, type PvProfileConfig, type SunGeometry } from './solar';
import { layoutArray, toLocal, type LocalFrame, type Ring } from './layout';
import { dispatch, monthOfHour } from './dispatch';
import { agriculture, homes, homesKwhPerYear, otherLoad } from './landuse';
import { annuity, irr, npv, payback } from './finance';
import { robotLeaseUsdPerMonth, robotPriceUsd, robotYears, taskHours } from './robots';

export interface Context {
  site: SiteData;
  climate: Climate;
  prices: number[];
  sun: SunGeometry;
  frame: LocalFrame;
  zoneKeep: Ring[][];
  zoneAll: Ring[][];
  pvCache: Map<string, PvProfile>;
  layoutCache: Map<string, Layout>;
  refYield: number; // kWh/kWp/yr of a conventional fixed-tilt farm here
  buf: { pvAc: Float64Array; pvDc: Float64Array; gpu: Float64Array; flex: Float64Array; flexKwh: Float64Array; other: Float64Array; pue: Float64Array; price: Float64Array };
}

const CONVENTIONAL_KWDC_PER_HA = 1000;

export function createContext(site: SiteData, climate: Climate, prices: number[]): Context {
  const frame = site.layout.localFrame;
  const conv = (polys: SiteData['layout']['arrayZoneKeepTrees']): Ring[][] => polys.map((p) => p.map((r) => r.map((pt) => toLocal(frame, pt))));
  const f = () => new Float64Array(HOURS);
  const ctx: Context = {
    site, climate, prices,
    sun: sunGeometry(climate.lat, climate.lon, climate.irradianceTimeOffsetH ?? 0.5),
    frame,
    zoneKeep: conv(site.layout.arrayZoneKeepTrees),
    zoneAll: conv(site.layout.arrayZoneNoTrees),
    pvCache: new Map(), layoutCache: new Map(), refYield: 0,
    buf: { pvAc: f(), pvDc: f(), gpu: f(), flex: f(), flexKwh: f(), other: f(), pue: f(), price: f() },
  };
  const ref = getProfile(ctx, { type: 'fixed', tiltDeg: 25, gcr: 0.45, albedo: 0.2, bifaciality: 0, clearanceM: 0.8, trackerMaxAngleDeg: 55, tempCoeffPctPerC: -0.35, systemLossPct: 9, moduleLengthM: 2.382, moduleWidthM: 1.134 });
  ctx.refYield = ref.annualDcPerKwp * 0.98 * 0.99;
  return ctx;
}

function getProfile(ctx: Context, cfg: PvProfileConfig): PvProfile {
  const key = JSON.stringify(cfg);
  let p = ctx.pvCache.get(key);
  if (!p) {
    p = pvProfile(cfg, ctx.sun, ctx.climate);
    if (ctx.pvCache.size > 200) ctx.pvCache.clear();
    ctx.pvCache.set(key, p);
  }
  return p;
}

export function getLayout(ctx: Context, s: Scenario): Layout {
  const pv = s.pv;
  const key = [pv.type, pv.gcr, pv.fillPct, pv.keepTrees, pv.moduleWp, pv.moduleLengthM, pv.moduleWidthM, pv.tiltDeg].join('|');
  let l = ctx.layoutCache.get(key);
  if (!l) {
    l = layoutArray(pv.keepTrees ? ctx.zoneKeep : ctx.zoneAll, { type: pv.type, gcr: pv.gcr, fillPct: pv.fillPct, moduleWp: pv.moduleWp, moduleLengthM: pv.moduleLengthM, moduleWidthM: pv.moduleWidthM, tiltDeg: pv.tiltDeg, anchor: toLocal(ctx.frame, ctx.site.layout.pad.centre) });
    if (ctx.layoutCache.size > 500) ctx.layoutCache.clear();
    ctx.layoutCache.set(key, l);
  }
  return l;
}

export const fpl = (s: Scenario) => s.site.dfeM + s.site.floodOffsetM + s.site.freeboardM;
export const padAreaM2 = (itKw: number, bessKwh: number, hasGrid: boolean) =>
  (hasGrid ? 60 : 0) + 75 * Math.ceil(itKw / 300) + 40 * Math.ceil(bessKwh / 5000);
const VERTICAL_LOWEST_EDGE_M = 0.8;

export function evaluate(s: Scenario, ctx: Context, opts: { series?: boolean } = {}): Result {
  const warnings: string[] = [];
  const site = ctx.site;
  const fin = s.finance;
  const usd = fin.usdAud;

  // ---- Solar ----
  const layout = getLayout(ctx, s);
  const kwdc = layout.kwdc;
  const kwac = kwdc > 0 ? kwdc / Math.max(0.5, s.pv.dcAcRatio) : 0;
  const clearance = s.pv.type === 'vertical' ? VERTICAL_LOWEST_EDGE_M : s.pv.clearanceM;
  const profile = getProfile(ctx, {
    type: s.pv.type, tiltDeg: s.pv.tiltDeg, gcr: s.pv.gcr, albedo: s.pv.albedo, bifaciality: s.pv.bifaciality,
    clearanceM: clearance, trackerMaxAngleDeg: s.pv.trackerMaxAngleDeg, tempCoeffPctPerC: s.pv.tempCoeffPctPerC,
    systemLossPct: s.pv.systemLossPct, moduleLengthM: s.pv.moduleLengthM, moduleWidthM: s.pv.moduleWidthM,
  });
  const { pvAc, pvDc, gpu, flex, flexKwh, other, pue, price } = ctx.buf;
  const invEff = (s.pv.inverterEffPct / 100) * 0.99; // 1% AC/transformer losses
  for (let t = 0; t < HOURS; t++) {
    const dc = profile.dcPerKwp[t] * kwdc;
    pvDc[t] = dc;
    pvAc[t] = Math.min(dc * invEff, kwac);
    price[t] = ctx.prices[t] * s.grid.priceScale;
  }

  // ---- Compute ----
  const c = s.compute;
  const spec = c.catalog[c.model];
  const servers = Math.max(0, Math.round(c.servers));
  const itKw = servers * spec.serverKw;
  const u = Math.max(0, Math.min(1, c.utilisationPct / 100));
  const busy = c.busyPowerPct / 100, idle = c.idlePowerPct / 100;
  const baseIt = itKw * (u * busy + (1 - u) * idle);
  const gpuPriceAud = spec.priceUsdPerGpuHr * usd;
  const perGpuKw = spec.serverKw / spec.gpusPerServer;
  for (let t = 0; t < HOURS; t++) {
    const p = c.pueBase + c.pueSlopePerC * Math.max(0, ctx.climate.tamb[t] - c.pueRefC);
    pue[t] = p;
    gpu[t] = baseIt * p;
    flex[t] = c.flexEnabled ? itKw * (1 - u) * Math.max(0, busy - idle) * p : 0;
    flexKwh[t] = perGpuKw * Math.max(0.05, busy - idle) * p;
  }
  otherLoad(s, monthOfHour, other);

  // ---- Battery & grid ----
  const bessKw = Math.max(0, s.bess.powerKw);
  const bessKwh = bessKw * Math.max(0, s.bess.hours);
  const disp = dispatch({
    pvAc, pvDc, gpuLoad: gpu, flexCap: flex, flexKwhPerGpuHr: flexKwh, otherLoad: other, price,
    gpusSoldPerHour: servers * spec.gpusPerServer * u,
    importLimitKw: s.grid.importLimitKw, exportLimitKw: s.grid.exportLimitKw,
    bessKwh, bessKw, rte: s.bess.rtePct / 100, minSoc: s.bess.minSocPct / 100,
    networkAdderPerMwh: s.grid.networkAdderPerMwh, exportLossFactor: s.grid.exportLossFactor, exportFeePerMwh: s.grid.exportFeePerMwh,
    demandChargePerKvaMonth: s.grid.demandChargePerKvaMonth,
    flexValuePerGpuHr: gpuPriceAud * (c.flexPricePct / 100) * (1 - c.marketplaceFeePct / 100),
    cycleCostPerMwh: s.bess.cycleCostPerMwh, pue, keepSeries: !!opts.series, pvKwp: kwdc,
  });
  const E = disp.totals;

  // ---- Land use ----
  const hasGridUpgrade = Math.max(s.grid.importLimitKw, s.grid.exportLimitKw) > 100;
  const padM2 = itKw > 0 || bessKwh > 0 ? padAreaM2(itKw, bessKwh, hasGridUpgrade) : 0;
  const infraHa = padM2 / 1e4 + (s.ag.refugeMound ? 0.2 : 0) + (s.ag.greenhouseM2 * 1.3) / 1e4 + s.homes.cabins * 0.04 + 0.25;
  const ru1Ha = site.zones.RU1.areaHa;
  const ag = agriculture(
    s,
    { lotHa: site.areaHa, ru1Ha, underArrayHa: layout.arrayAreaHa, infraHa, kwdc, kwdcFullSolar: layout.arrayAreaHa * CONVENTIONAL_KWDC_PER_HA },
    E.monthly.heat,
    ctx.climate,
  );
  // LER on energy: this array's output vs a conventional fixed-tilt farm on the same land.
  const convMwh = (layout.arrayAreaHa * CONVENTIONAL_KWDC_PER_HA * ctx.refYield) / 1000;
  ag.lerSolar = convMwh > 0 ? E.pvAcMwh / convMwh : 0;
  ag.ler = ag.lerSolar + ag.lerAg;
  const hm = homes(s);
  const tenantKwh = homesKwhPerYear(s) - (s.homes.houseMode === 'owner' ? s.homes.dwellingKwhPerDay * 365 : 0);

  // ---- Humanoid robots ----
  const N = Math.max(1, Math.round(fin.years));
  const rb = s.robots;
  const fleet = Math.max(0, Math.round(rb.fleet));
  const hoursByTask = taskHours(s, { guestNights: hm.guestNights, greenhouseM2: s.ag.greenhouseM2, kwdc, dse: ag.dse, dwellings: hm.dwellings });
  const robo = robotYears({ ...s, robots: { ...rb, fleet } }, hoursByTask, fin.startYear, N, fin.inflationPct);
  const robotBuyAud = (year: number) => fleet * robotPriceUsd(s, year) * usd * 1.1; // incl. freight and import costs
  const dY = Math.max(rb.deployYear, fin.startYear); // robots arriving in the first year are bought up front
  const deployIdx = dY - fin.startYear + 1; // project year the robots arrive (1-based)
  robo.capexFirst = fleet > 0 && rb.acquisition === 'buy' ? robotBuyAud(dY) : 0;

  // ---- Capex ----
  const capex: CapexLine[] = [];
  const add = (key: string, label: string, group: CapexLine['group'], amount: number) => { if (amount > 0.5) capex.push({ key, label, group, amount }); };
  const pvBase = kwdc * 1000 * s.pv.capexPerWdc[s.pv.type];
  const raiseM = s.pv.type === 'vertical' ? 0 : Math.max(0, s.pv.clearanceM - s.pv.standardClearanceM[s.pv.type]);
  const pvRaise = kwdc * 1000 * s.pv.raisePremiumPerWdcPerM * raiseM;
  add('pv', `Solar array ${fmtKw(kwdc)}p (${s.pv.type === 'fixed' ? 'fixed tilt' : s.pv.type === 'tracker' ? 'single-axis tracker' : 'vertical bifacial'})`, 'Solar', pvBase);
  add('pvRaise', `High-clearance structure (+${raiseM.toFixed(1)} m for flood & grazing)`, 'Solar', pvRaise);
  const bessCapex = bessKwh * s.bess.capexPerKwh + bessKw * s.bess.capexPerKw;
  add('bess', `Battery ${fmtKw(bessKw)} / ${fmtKwh(bessKwh)}`, 'Battery', bessCapex);
  const maxKva = Math.max(s.grid.importLimitKw, s.grid.exportLimitKw) / 0.95;
  add('grid', `Grid connection ${Math.round(maxKva).toLocaleString()} kVA`, 'Grid', hasGridUpgrade ? s.grid.connectionFixed + s.grid.connectionPerKva * maxKva : 0);
  const serverCapex = servers * spec.serverCapexUsd * usd;
  add('servers', `${servers} × ${spec.label} servers (${servers * spec.gpusPerServer} GPUs)`, 'Compute', serverCapex);
  const dcCapex = itKw * c.dcCapexPerKw;
  add('dc', `Modular data hall, cooling & power (${Math.round(itKw)} kW IT)`, 'Compute', dcCapex);
  add('fibre', 'Fibre build & network equipment', 'Compute', servers > 0 ? 60000 : 0);
  const padCost = padM2 * c.padRaiseM * c.padCostPerM2PerM;
  add('pad', `Flood-raised equipment platform (${Math.round(padM2)} m², +${c.padRaiseM} m)`, 'Site', padCost);
  add('fence', 'Stock fencing, water & yards upgrade', 'Agriculture', s.ag.fencingWaterCapex);
  add('mound', 'Livestock flood refuge mound', 'Agriculture', s.ag.refugeMound ? s.ag.refugeMoundCapex : 0);
  add('greenhouse', `Greenhouse ${s.ag.greenhouseM2.toLocaleString()} m²${s.compute.heatToGreenhouse && servers > 0 ? ' with heat recovery' : ''}`, 'Agriculture', s.ag.greenhouseM2 * s.ag.greenhouseCapexPerM2 + (s.compute.heatToGreenhouse && servers > 0 && s.ag.greenhouseM2 > 0 ? 40000 : 0));
  add('hives', `Beehives (${s.ag.hives})`, 'Agriculture', s.ag.hives * 600);
  add('poultry', 'Mobile hen houses', 'Agriculture', ag.hens * 45);
  add('homes', `New dwellings (${(s.homes.grannyFlat ? 1 : 0) + s.homes.cabins}) incl. raised floors & services`, 'Homes', hm.capex);
  if (deployIdx === 1 && rb.acquisition === 'buy') add('robots', `${fleet} humanoid robot${fleet === 1 ? '' : 's'} (bought at the start)`, 'Robots', robo.capexFirst);
  const devCost = fin.developmentFixed + (servers > 0 ? 50000 : 0) + (bessKwh > 0 ? 30000 : 0);
  add('dev', 'Approvals & studies (DA, flood, ASS, glare, bushfire, ecology, acoustic)', 'Site', devCost);
  const subtotal = capex.filter((l) => l.key !== 'servers' && l.key !== 'robots').reduce((a, l) => a + l.amount, 0);
  add('contingency', `Contingency (${fin.contingencyPct}% of construction; excludes servers)`, 'Site', (subtotal * fin.contingencyPct) / 100);
  if (fin.includeLand) add('land', 'Land purchase (incl. ~4.5% stamp duty & costs)', 'Land', fin.landPrice * 1.045);
  const capexTotal = capex.reduce((a, l) => a + l.amount, 0);

  // ---- Flood exposure ----
  const off = s.site.floodOffsetM;
  const flood: FloodItem[] = [];
  const level = fpl(s);
  const addFlood = (label: string, lvl: number, value: number) => {
    if (value <= 0) return;
    const aep = floodAep(lvl, off);
    flood.push({ label, levelM: lvl, aep, value, expectedLoss: aep * (s.site.floodDamagePct / 100) * value, safe: lvl >= level - 1e-9 });
  };
  addFlood('Solar modules (lowest edge)', s.site.groundLevelM + clearance, (pvBase + pvRaise) * 0.6);
  addFlood('Equipment platform (inverters, battery, GPUs)', s.site.padGroundM + c.padRaiseM, bessCapex + serverCapex + dcCapex);
  addFlood('New dwellings (floor level at flood planning level)', hm.capex > 0 ? level : 0, hm.capex);
  const herdValue = ag.dse * 140;
  if (herdValue > 0) {
    const aep = floodAep(s.site.groundLevelM + 0.6, off);
    const lossShare = s.ag.refugeMound ? 0.02 : 0.25;
    flood.push({ label: s.ag.refugeMound ? 'Livestock on the paddock (moved to the refuge mound)' : 'Livestock on the paddock (no refuge mound)', levelM: s.site.groundLevelM + 0.6, aep, value: herdValue, expectedLoss: aep * lossShare * herdValue, safe: s.ag.refugeMound });
  }
  const floodProvision = flood.reduce((a, f) => a + f.expectedLoss, 0);

  // ---- Annual cash flows ----
  const years: YearRow[] = [];
  const infl = fin.inflationPct / 100, esc = s.grid.priceEscalationPctYr / 100, rentG = s.homes.rentGrowthPctYr / 100;
  const fee = c.marketplaceFeePct / 100;
  const avgImport = E.importMwh > 0 ? (E.importCost / E.importMwh) : (ctx.prices.reduce((a, b) => a + b, 0) / HOURS) * s.grid.priceScale + s.grid.networkAdderPerMwh;
  const selfUsedMwh = E.pvToLoadMwh + E.pvToFlexMwh + E.pvToBattMwh * (s.bess.rtePct / 100);
  const debt = (capexTotal * fin.debtPct) / 100;
  const pmt = annuity(debt, fin.interestPct, fin.loanYears);
  const flows: number[] = [-capexTotal];
  const eqFlows: number[] = [-(capexTotal - debt)];
  let cumulative = -capexTotal;
  const pvOpexForLcoe: number[] = [];
  const pvEnergy: number[] = [];
  for (let y = 1; y <= N; y++) {
    const calYear = fin.startYear + y - 1;
    const fi = Math.pow(1 + infl, y - 1), fe = Math.pow(1 + esc, y - 1), fr = Math.pow(1 + rentG, y - 1);
    const degr = Math.pow(1 - s.pv.degradationPctYr / 100, y - 1);
    const age = servers > 0 ? (y - 1) % Math.max(1, Math.round(c.refreshYears)) : 0;
    const gpuF = Math.pow(1 - c.priceDeclinePctYr / 100, age);
    const revenue: Record<string, number> = {
      'GPU compute': E.gpuHoursSold * gpuPriceAud * gpuF * (1 - fee),
      'Interruptible compute': E.flexGpuHours * gpuPriceAud * (c.flexPricePct / 100) * gpuF * (1 - fee),
      'Energy exports': (E.exportRevenue) * degr * fe,
      'Battery services': bessKw * s.bess.ancillaryPerKwYr * fi,
      LGCs: calYear <= s.pv.lgcEndYear ? E.pvAcMwh * degr * s.pv.lgcPrice : 0,
      'Tenant energy': (tenantKwh * s.homes.tenantEnergyPricePerKwh) * fi,
      'Rent & stays': hm.revenue * fr,
      Agriculture: ag.grossMargin * fi,
      'Robot labour savings': robo.years[y - 1]?.cashSavings ?? 0,
      'Robot task data': (robo.years[y - 1]?.robotHoursWorked ?? 0) * rb.dataRevenuePerHour * fi,
    };
    const lostSelf = selfUsedMwh * (1 - degr);
    const opex: Record<string, number> = {
      'Grid energy': (E.importCost + lostSelf * avgImport) * fe,
      'Demand charges': E.demandCharges * fi,
      'Solar O&M & insurance': (kwdc * s.pv.omPerKwYr + (s.ag.underArray === 'none' ? layout.arrayAreaHa * s.pv.vegMgmtPerHaYr : 0)) * fi,
      'Battery O&M': bessCapex * (s.bess.omPctYr / 100) * fi,
      'Compute operations': servers > 0 ? (serverCapex * (c.maintenancePctYr + c.insurancePctYr) / 100 + dcCapex * (c.dcOmPctYr / 100) + c.staffPerYr) * fi : 0,
      'Fibre & network': servers > 0 ? c.networkPerMonth * 12 * fi : 0,
      'Homes operating costs': hm.opex * fr,
      'Rates & land tax': (s.site.councilRatesPerYr + s.site.landTaxPerYr) * fi,
      'Flood risk provision': floodProvision * fi,
      'Robot fleet': 0,
    };
    if (fleet > 0 && calYear >= dY) {
      const ry = robo.years[y - 1];
      const energy = (ry?.robotHoursWorked ?? 0) * rb.kwhPerHour * 0.12;
      const life = Math.max(1, Math.round(rb.lifeYears));
      const lastBuyYear = dY + Math.floor((calYear - dY) / life) * life;
      const ownership = rb.acquisition === 'buy'
        ? robotBuyAud(lastBuyYear) * ((rb.maintenancePctYr + 1) / 100) // maintenance + insurance
        : fleet * robotLeaseUsdPerMonth(s, calYear) * 12 * usd;
      opex['Robot fleet'] = ownership + (fleet * rb.softwarePerYr + energy) * fi;
    }
    let capexY = 0;
    if (y === Math.round(s.pv.inverterReplaceYear) && kwac > 0) capexY += kwac * 1000 * s.pv.inverterReplacePerWac * fi;
    if (y === Math.round(s.bess.augmentYear) && bessKwh > 0) capexY += bessCapex * (s.bess.augmentPctOfCapex / 100);
    if (servers > 0 && y % Math.max(1, Math.round(c.refreshYears)) === 0 && y < N) capexY += serverCapex;
    if (fleet > 0 && rb.acquisition === 'buy' && calYear >= dY) {
      const since = calYear - dY;
      const boughtUpFront = deployIdx === 1 && since === 0;
      if (since % Math.max(1, Math.round(rb.lifeYears)) === 0 && !boughtUpFront && y < N) capexY += robotBuyAud(calYear);
    }
    const rev = Object.values(revenue).reduce((a, b) => a + b, 0);
    const ox = Object.values(opex).reduce((a, b) => a + b, 0);
    const ebitda = rev - ox;
    let net = ebitda - capexY;
    if (y === N && fin.includeLand) net += fin.landPrice * Math.pow(1 + fin.landGrowthPctYr / 100, N);
    cumulative += net;
    const ds = y <= fin.loanYears ? pmt : 0;
    years.push({ year: y, calYear, revenue, opex, capex: capexY, ebitda, netCash: net, cumulative, debtService: ds, equityCash: net - ds });
    flows.push(net);
    eqFlows.push(net - ds);
    pvOpexForLcoe.push((kwdc * s.pv.omPerKwYr) * fi + (y === Math.round(s.pv.inverterReplaceYear) ? kwac * 1000 * s.pv.inverterReplacePerWac * fi : 0));
    pvEnergy.push(E.pvAcMwh * degr);
  }
  const r = fin.discountRatePct / 100;
  const npvV = npv(r, flows);
  const irrV = irr(flows);
  const eqIrr = fin.debtPct > 0 ? irr(eqFlows) : irrV;
  const pb = payback(flows);
  const pvCap = pvBase + pvRaise + (hasGridUpgrade ? s.grid.connectionFixed * 0.5 : 0);
  let lcoeNum = pvCap, lcoeDen = 0;
  for (let y = 1; y <= N; y++) { lcoeNum += pvOpexForLcoe[y - 1] / Math.pow(1 + r, y); lcoeDen += pvEnergy[y - 1] / Math.pow(1 + r, y); }
  const y1 = years[0];
  const y1Rev = Object.values(y1.revenue).reduce((a, b) => a + b, 0);
  const y1Opex = Object.values(y1.opex).reduce((a, b) => a + b, 0);

  // ---- Warnings ----
  if (s.pv.type !== 'vertical' && kwdc > 0 && s.site.groundLevelM + s.pv.clearanceM < level) warnings.push(`Lowest module edge (${(s.site.groundLevelM + s.pv.clearanceM).toFixed(1)} m AHD) is below the flood planning level (${level.toFixed(1)} m AHD).`);
  if (s.pv.type === 'vertical' && kwdc > 0) warnings.push('Vertical fences sit low across the floodplain: they would be inundated in frequent floods and can trap debris. Needs a hydraulic assessment.');
  if (servers > 0 && s.site.padGroundM + c.padRaiseM < level) warnings.push(`Equipment platform (${(s.site.padGroundM + c.padRaiseM).toFixed(1)} m AHD) is below the flood planning level.`);
  if (E.gpuHoursLost > 0.005 * (E.gpuHoursSold + E.gpuHoursLost)) warnings.push(`${Math.round(E.gpuHoursLost).toLocaleString()} GPU-hours a year can't be powered: raise the import limit or add battery.`);
  if (s.ag.underArray === 'cattle' && (s.pv.type === 'vertical' || s.pv.clearanceM < 3.5)) warnings.push('Cattle need at least 3.5 m clearance under the array; modelled as sheep.');
  if (s.homes.cabins > 6) warnings.push('More than 6 farm-stay cabins exceeds the agritourism complying-development limit; a full DA is needed.');
  if (kwac > 5000) warnings.push('Above 5 MW AC: Essential Energy treats this as a large embedded generator and AEMO registration may apply.');
  if (E.pvAcMwh > 0 && E.curtailedMwh / E.pvAcMwh > 0.1) warnings.push(`${Math.round((100 * E.curtailedMwh) / E.pvAcMwh)}% of solar is curtailed: add battery, flexible compute or export capacity.`);

  return {
    scenario: s, layout, pvKwac: kwac, bessKwh, itKw, energy: E, series: disp.series, ag, homes: hm, robots: robo, capex, capexTotal, years,
    npv: npvV, irr: irrV, equityIrr: eqIrr, paybackYears: pb, lcoe: lcoeDen > 0 ? lcoeNum / lcoeDen : 0,
    year1: { revenue: y1Rev, opex: y1Opex, ebitda: y1Rev - y1Opex, revenueByStream: y1.revenue },
    ebitdaPerHa: (y1Rev - y1Opex) / site.areaHa,
    profitIndex: capexTotal > 0 ? 1 + npvV / capexTotal : 0,
    flood,
    co2AvoidedT: E.pvAcMwh * s.grid.gridEmissionsKgPerKwh,
    warnings,
  };
}

function fmtKw(kw: number) { return kw >= 1000 ? `${(kw / 1000).toFixed(2)} MW` : `${Math.round(kw)} kW`; }
function fmtKwh(kwh: number) { return kwh >= 1000 ? `${(kwh / 1000).toFixed(1)} MWh` : `${Math.round(kwh)} kWh`; }
