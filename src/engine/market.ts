import type { GpuModel, PvType, RobotTask, RobotTaskDef, Scenario } from './types';

export interface Src { title: string; url: string; date?: string }

/** Values researched by hand or by the daily research automation (src/data/market-curated.json). */
export interface CuratedMarket {
  updated: string;
  note?: string;
  gpu: Record<GpuModel, { anchorUsdPerHr: number; serverUsd: number; reference?: string; vastAnchorP25?: number | null; source?: Src }>;
  solar: { capexPerWdc: Record<PvType, number>; moduleAnchorUsdPerW: number; source?: Src };
  battery: { capexPerKwh: number; capexPerKw: number; source?: Src };
  lgc: { price: number; date?: string; source?: Src };
  livestock: { sheepGmPerDse: number; cattleGmPerDse: number; eyciAnchor: number; ntliAnchor: number; elasticity: number; source?: Src };
  ag: { greenhouseGmPerM2: number; hayGmPerHa: number; fpiAnchor: number | null; elasticity: number; source?: Src };
  humanoids: {
    workCapablePriceUsd: number;
    priceRefYear: number;
    priceDeclinePctYr: number;
    leaseUsdPerMonth: number;
    unitreeH2Anchor: number;
    basis?: string;
    outlook?: string;
    models: { name: string; maker: string; priceUsd: number | null; availability: string; class: string; source: string; date: string }[];
    tasks: Record<RobotTask, RobotTaskDef>;
    sources?: Src[];
  };
}

interface Feed { ok: boolean; date?: string; source?: string; url?: string; error?: string }

/** Values fetched by scripts/update-market.ts (src/data/market.json). */
export interface LiveMarket {
  updated: string | null;
  fx?: Feed & { usdAud: number };
  gpu?: Feed & { models: Partial<Record<GpuModel, { p25: number; median: number; n: number; p25s?: number; ratio?: number; anchorKey?: string }>> };
  nem?: Feed & { mean30: number; mean365: number; negShare365: number; through: string };
  lgc?: Feed & { price: number; week?: string };
  solarModule?: Feed & { usdPerW: number };
  livestock?: Feed & { eyci?: { value: number; prev?: number; yearAgo?: number; date?: string }; ntli?: { value: number; prev?: number; yearAgo?: number; date?: string }; mutton?: { value: number; date?: string } };
  fpi?: Feed & { value: number; month: string; meat?: number };
  humanoids?: Feed & { unitree?: { name: string; fromUsd: number }[]; neo?: { priceUsd?: number; monthlyUsd?: number } };
}

export interface Applied {
  path: string;
  value: number;
  basis: string; // human-readable explanation of where the number came from
  date?: string;
  url?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ok = <T extends { ok: boolean }>(f: T | undefined): f is T => !!f && f.ok;

/**
 * Daily index of marketplace asks against their level when the researched price was set. The update script computes
 * it (≥3 days of readings, capped, at most 5% a day); this just guards the range.
 */
export function gpuRatio(live: LiveMarket, cur: CuratedMarket, g: GpuModel): number {
  const m = live.gpu?.models?.[g];
  const c = cur.gpu[g];
  if (!ok(live.gpu) || !m?.ratio || !c?.vastAnchorP25) return 1;
  // The index only applies to the researched level it was computed against.
  if (m.anchorKey !== undefined && m.anchorKey !== `${c.anchorUsdPerHr}|${c.vastAnchorP25}`) return 1;
  return clamp(m.ratio, 0.75, 1.33);
}

/**
 * Overlays the latest market data on a scenario's assumptions. Researched levels (curated) are moved by live
 * indicators relative to the day each level was researched, so noisy feeds shift values without replacing them.
 */
export function applyMarket(s: Scenario, live: LiveMarket, cur: CuratedMarket): { scenario: Scenario; applied: Applied[] } {
  const applied: Applied[] = [];
  const set = (path: string, value: number, basis: string, date?: string, url?: string) => {
    const keys = path.split('.');
    let o = s as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
    o[keys[keys.length - 1]] = value;
    applied.push({ path, value, basis, date, url });
  };
  const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  if (ok(live.fx) && live.fx.usdAud > 0.8 && live.fx.usdAud < 2.5) set('finance.usdAud', r2(live.fx.usdAud, 4), `${live.fx.source ?? 'FX feed'} on ${live.fx.date}`, live.fx.date, live.fx.url);
  const usd = s.finance.usdAud;

  for (const g of Object.keys(cur.gpu) as GpuModel[]) {
    const c = cur.gpu[g];
    if (!s.compute.catalog[g]) continue;
    const ratio = gpuRatio(live, cur, g);
    const n = live.gpu?.models?.[g]?.n;
    set(`compute.catalog.${g}.priceUsdPerGpuHr`, r2(c.anchorUsdPerHr * ratio, 2), ratio === 1 ? `Researched level (${c.reference ?? 'see source'})` : `Researched US$${c.anchorUsdPerHr} × ${ratio.toFixed(2)} Vast.ai marketplace move (lower-quartile ask, ${n} offers)`, live.gpu?.date, c.source?.url);
    set(`compute.catalog.${g}.serverCapexUsd`, c.serverUsd, c.source?.title ?? 'Researched', c.source?.date, c.source?.url);
  }

  const moduleDelta = ok(live.solarModule) && live.solarModule.usdPerW > 0.03 && live.solarModule.usdPerW < 0.6 ? live.solarModule.usdPerW - cur.solar.moduleAnchorUsdPerW : 0;
  for (const t of ['fixed', 'tracker', 'vertical'] as PvType[]) {
    set(`pv.capexPerWdc.${t}`, r2(cur.solar.capexPerWdc[t] + moduleDelta * usd, 3), moduleDelta === 0 ? 'Researched installed cost' : `Researched cost ${moduleDelta >= 0 ? '+' : '−'} module price move (${(Math.abs(moduleDelta) * 100).toFixed(1)} US¢/W, InfoLink TOPCon)`, live.solarModule?.date ?? cur.solar.source?.date, cur.solar.source?.url);
  }
  set('bess.capexPerKwh', cur.battery.capexPerKwh, cur.battery.source?.title ?? 'Researched', cur.battery.source?.date, cur.battery.source?.url);
  set('bess.capexPerKw', cur.battery.capexPerKw, cur.battery.source?.title ?? 'Researched', cur.battery.source?.date, cur.battery.source?.url);

  const lgc = ok(live.lgc) && live.lgc.price > 0 && live.lgc.price < 100 ? live.lgc : null;
  set('pv.lgcPrice', lgc ? lgc.price : cur.lgc.price, lgc ? `Ecovantage weekly LGC spot` : 'Researched LGC spot', lgc?.date ?? cur.lgc.date, cur.lgc.source?.url);

  const L = cur.livestock;
  const ntli = ok(live.livestock) ? live.livestock.ntli?.value : undefined;
  const eyci = ok(live.livestock) ? live.livestock.eyci?.value : undefined;
  const gm = (base: number, now: number | undefined, anchor: number, el: number) => (now && anchor ? base * clamp(1 + el * (now / anchor - 1), 0.4, 1.8) : base);
  set('ag.sheepGmPerDse', r2(gm(L.sheepGmPerDse, ntli, L.ntliAnchor, L.elasticity), 1), ntli ? `NSW DPI A$${L.sheepGmPerDse}/DSE scaled by trade lamb indicator ${ntli}c vs ${L.ntliAnchor}c` : 'NSW DPI 2025 budget', live.livestock?.ntli?.date, L.source?.url);
  set('ag.cattleGmPerDse', r2(gm(L.cattleGmPerDse, eyci, L.eyciAnchor, L.elasticity), 1), eyci ? `NSW DPI A$${L.cattleGmPerDse}/DSE scaled by EYCI ${eyci}c vs ${L.eyciAnchor}c` : 'NSW DPI 2025 budget', live.livestock?.eyci?.date, L.source?.url);
  const fpi = ok(live.fpi) ? live.fpi.value : undefined;
  const A = cur.ag;
  set('ag.greenhouseGmPerM2', r2(gm(A.greenhouseGmPerM2, fpi, A.fpiAnchor ?? fpi ?? 0, A.elasticity), 1), fpi && A.fpiAnchor ? `A$${A.greenhouseGmPerM2}/m² scaled by FAO Food Price Index ${fpi} vs ${A.fpiAnchor}` : 'Researched', live.fpi?.month, A.source?.url);
  set('ag.hayGmPerHa', r2(gm(A.hayGmPerHa, fpi, A.fpiAnchor ?? fpi ?? 0, A.elasticity), 0), fpi && A.fpiAnchor ? `A$${A.hayGmPerHa}/ha scaled by FAO Food Price Index` : 'Researched', live.fpi?.month, A.source?.url);

  const H = cur.humanoids;
  const h2 = ok(live.humanoids) ? live.humanoids.unitree?.find((u) => /^Unitree H2$/i.test(u.name.trim()))?.fromUsd : undefined;
  const robotRatio = h2 && H.unitreeH2Anchor ? clamp(h2 / H.unitreeH2Anchor, 0.3, 2) : 1;
  set('robots.priceUsd', Math.round(H.workCapablePriceUsd * robotRatio), robotRatio === 1 ? H.basis ?? 'Researched' : `Researched US$${H.workCapablePriceUsd} × Unitree H2 price move (US$${h2} vs US$${H.unitreeH2Anchor})`, live.humanoids?.date, 'https://shop.unitree.com/collections/humanoid-robot');
  set('robots.priceRefYear', H.priceRefYear, 'Year of the robot price');
  set('robots.priceDeclinePctYr', H.priceDeclinePctYr, 'Forecast price decline for work-capable humanoids');
  set('robots.leaseUsdPerMonth', H.leaseUsdPerMonth, 'Estimated robot-as-a-service fee');
  for (const t of Object.keys(H.tasks) as RobotTask[]) {
    if (!s.robots.tasks[t]) continue;
    s.robots.tasks[t] = { ...H.tasks[t] };
  }
  return { scenario: s, applied };
}
