// Daily market update: fetches live indicators, rolls the NEM price year forward, re-optimises the recommended plan
// and appends a history snapshot. Run with `npx tsx scripts/update-market.ts` (add --offline to skip fetching).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abaresRow, dayMonthToIso, parseFaoCsv, parseInfolinkModule, parseLgc, parseNeo, parseRbaF11, parseUnitree, plain, vastGpuPrices } from './parsers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src', 'data');
const OFFLINE = process.argv.includes('--offline');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 clovernook-farm-updater' };
const readJson = <T>(f: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as T; } catch { return fallback; } };
const writeJson = (f: string, v: unknown, pretty = true) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, pretty ? 2 : 0) + (pretty ? '\n' : ''));
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Today's date in Sydney as YYYY-MM-DD. */
function sydneyDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function getText(url: string, ms = 45000): Promise<string> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

type Feed = Record<string, unknown> & { ok: boolean; date?: string; source?: string; url?: string; error?: string };
async function feed(name: string, prev: Feed | undefined, fn: () => Promise<Feed>): Promise<Feed> {
  if (OFFLINE) return prev ?? { ok: false, error: 'offline' };
  try {
    const f = await fn();
    console.log(`  ✓ ${name}`);
    return f;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ ${name}: ${msg}`);
    // Keep yesterday's value but flag it as stale.
    return prev ? { ...prev, ok: prev.ok, stale: true, error: msg } : { ok: false, error: msg };
  }
}

// ---------- Feeds ----------
async function fx(): Promise<Feed> {
  try {
    const { audUsd, date } = parseRbaF11(await getText('https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv'));
    return { ok: true, usdAud: round(1 / audUsd, 4), audUsd, date, source: 'RBA F11.1 (A$1 = US$)', url: 'https://www.rba.gov.au/statistics/tables/#exchange-rates' };
  } catch {
    const j = JSON.parse(await getText('https://api.frankfurter.app/latest?from=USD&to=AUD')) as { date: string; rates: { AUD: number } };
    return { ok: true, usdAud: round(j.rates.AUD, 4), date: j.date, source: 'Frankfurter (ECB reference rates)', url: 'https://www.frankfurter.app/' };
  }
}

const VAST_NAMES: Record<string, string[]> = { B300: ['B300'], B200: ['B200'], H200: ['H200', 'H200 NVL'], RTXPRO6000: ['RTX PRO 6000 S', 'RTX PRO 6000 WS'], L40S: ['L40S'] };
type GpuStat = { p25: number; median: number; n: number; p25s?: number; ratio?: number; anchorKey?: string; hist?: { date: string; p25: number }[] };
const MIN_OFFERS = 8; // thinner order books are too noisy to count as a day's reading
const MIN_DAYS = 3; // days of readings before the index starts to move prices
const RATIO_CAP: [number, number] = [0.75, 1.33];
const MAX_DAILY_MOVE = 0.05;
/**
 * Marketplace asks move with whichever offers happen to be unrented, so each model keeps two weeks of daily
 * lower-quartile readings (p25s = median of the last seven). The index (ratio) compares p25s with its level when the
 * researched price was set, is capped, and moves at most 5% a day.
 */
async function gpu(prev?: Feed, anchors?: Record<string, { usd?: number; p25?: number | null }>): Promise<Feed> {
  const today = sydneyDate();
  const prevModels = (prev?.models ?? {}) as Record<string, GpuStat>;
  const models: Record<string, GpuStat> = {};
  for (const [model, names] of Object.entries(VAST_NAMES)) {
    const prices: number[] = [];
    for (const name of names) {
      const q = encodeURIComponent(JSON.stringify({ gpu_name: { eq: name }, rentable: { eq: true }, type: 'on-demand', limit: 300 }));
      prices.push(...vastGpuPrices(JSON.parse(await getText(`https://console.vast.ai/api/v0/bundles/?q=${q}`))));
    }
    prices.sort((a, b) => a - b);
    const hist = [...(prevModels[model]?.hist ?? [])].filter((h) => h.date !== today);
    let stat: GpuStat | undefined = prevModels[model] ? { ...prevModels[model] } : undefined;
    if (prices.length >= MIN_OFFERS) {
      stat = { p25: round(prices[Math.floor(prices.length * 0.25)], 3), median: round(prices[Math.floor(prices.length / 2)], 3), n: prices.length };
      hist.push({ date: today, p25: stat.p25 });
    } else if (stat) {
      stat.n = prices.length;
    }
    if (!stat) continue;
    const recent = hist.slice(-7).map((h) => h.p25).sort((a, b) => a - b);
    stat.hist = hist.slice(-14);
    stat.p25s = recent.length ? round(recent[Math.floor(recent.length / 2)], 3) : stat.p25;
    const anchor = anchors?.[model]?.p25;
    // A re-researched level (new anchor) restarts the index at 1 instead of carrying the old multiplier.
    const anchorKey = `${anchors?.[model]?.usd ?? ''}|${anchor ?? ''}`;
    const prevRatio = prevModels[model]?.anchorKey === anchorKey ? (prevModels[model]?.ratio ?? 1) : 1;
    const target = anchor && hist.length >= MIN_DAYS ? Math.min(RATIO_CAP[1], Math.max(RATIO_CAP[0], stat.p25s / anchor)) : 1;
    stat.ratio = round(Math.min(prevRatio * (1 + MAX_DAILY_MOVE), Math.max(prevRatio * (1 - MAX_DAILY_MOVE), target)), 4);
    stat.anchorKey = anchorKey;
    models[model] = stat;
  }
  if (!Object.keys(models).length) throw new Error('no GPU offers');
  return { ok: true, models, date: today, source: `Vast.ai marketplace, rentable on-demand offers (US$/GPU-hr; 7-day median of the lower quartile, ≥${MIN_OFFERS} offers)`, url: 'https://vast.ai/pricing' };
}

async function solarModule(): Promise<Feed> {
  const avg = parseInfolinkModule(await getText('https://www.infolink-group.com/spot-price/en/'));
  return { ok: true, usdPerW: avg, date: sydneyDate(), source: 'InfoLink spot price, TOPCon module (USD/W, average)', url: 'https://www.infolink-group.com/spot-price/en/' };
}

async function livestock(): Promise<Feed> {
  const html = await getText('https://www.agriculture.gov.au/abares/data/weekly-commodity-price-update');
  const eyci = abaresRow(html, /Eastern Young Cattle Indicator/i);
  const ntli = abaresRow(html, /National Trade Lamb Indicator/i);
  const mutton = abaresRow(html, /National Mutton Indicator/i);
  const wheat = abaresRow(html, /Wheat/i);
  if (!eyci || !ntli) throw new Error('livestock rows not found');
  const pack = (r: NonNullable<ReturnType<typeof abaresRow>>) => ({ value: r.value, prev: r.prev, yearAgo: r.yearAgo, date: dayMonthToIso(r.date), unit: r.unit });
  return { ok: true, eyci: pack(eyci), ntli: pack(ntli), mutton: mutton ? pack(mutton) : undefined, wheat: wheat ? pack(wheat) : undefined, date: dayMonthToIso(eyci.date), source: 'ABARES weekly commodity price update', url: 'https://www.agriculture.gov.au/abares/data/weekly-commodity-price-update' };
}

async function fpi(): Promise<Feed> {
  // The CSV link carries a version token, so discover it from the index page.
  const page = await getText('https://www.fao.org/worldfoodsituation/foodpricesindex/en/');
  const link = page.match(/href="([^"]*food_price_indices_data\.csv[^"]*)"/i)?.[1]?.replace(/&amp;/g, '&')
    ?? 'https://www.fao.org/media/docs/worldfoodsituationlibraries/wfs-library/food_price_indices_data.csv';
  const csv = await getText(link.startsWith('http') ? link : `https://www.fao.org${link}`);
  const { value, meat, month } = parseFaoCsv(csv);
  return { ok: true, value, meat, month, date: month, source: 'FAO Food Price Index (2014-2016 = 100)', url: 'https://www.fao.org/worldfoodsituation/foodpricesindex/en/' };
}

async function humanoids(): Promise<Feed> {
  const unitree = parseUnitree(JSON.parse(await getText('https://shop.unitree.com/collections/humanoid-robot/products.json?limit=50')));
  if (!unitree.length) throw new Error('no Unitree humanoids');
  let neo: { priceUsd?: number; monthlyUsd?: number } | undefined;
  try { neo = parseNeo(plain(await getText('https://www.1x.tech/order'))); } catch { /* optional */ }
  return { ok: true, unitree, neo, date: sydneyDate(), source: 'Unitree store and 1X order page (list prices, US$)', url: 'https://shop.unitree.com/collections/humanoid-robot' };
}

async function lgc(): Promise<Feed> {
  const { price, week } = parseLgc(plain(await getText('https://www.ecovantage.com.au/energy-certificate-market-update/')));
  return { ok: true, price, week, date: sydneyDate(), source: 'Ecovantage weekly certificate market update (LGC spot)', url: 'https://www.ecovantage.com.au/energy-certificate-market-update/' };
}

/** Rolls the hourly NSW1 price year forward to the last 365 complete days and returns summary statistics. */
async function nem(): Promise<Feed> {
  const now = new Date();
  const aestNow = new Date(now.getTime() + 10 * 3600e3);
  const end = Date.UTC(aestNow.getUTCFullYear(), aestNow.getUTCMonth(), aestNow.getUTCDate()); // start of today (AEST) as UTC-ms of AEST clock
  const start = end - 365 * 86400e3;
  const months: string[] = [];
  for (let k = 13; k >= 0; k--) {
    const d = new Date(Date.UTC(aestNow.getUTCFullYear(), aestNow.getUTCMonth() - k, 1));
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const hourly = new Map<number, [number, number]>();
  let n = 0, sum = 0, neg = 0, n30 = 0, sum30 = 0, latest = 0;
  for (const ym of months) {
    let csv: string;
    try { csv = await getText(`https://aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_${ym}_NSW1.csv`); } catch { continue; }
    for (const ln of csv.split(/\r?\n/).slice(1)) {
      const parts = ln.split(',');
      if (parts.length < 4) continue;
      const [d, t] = parts[1].split(' ');
      if (!t) continue;
      const [Y, M, D] = d.split('/').map(Number);
      const [hh, mm] = t.split(':').map(Number);
      const ts = Date.UTC(Y, M - 1, D, hh, mm) - 5 * 60e3; // interval start, AEST clock
      if (ts < start || ts >= end) continue;
      const p = parseFloat(parts[3]);
      if (!Number.isFinite(p)) continue;
      const hourKey = Math.floor(ts / 3600e3);
      const a = hourly.get(hourKey) ?? [0, 0];
      a[0] += p; a[1]++; hourly.set(hourKey, a);
      n++; sum += p; if (p < 0) neg++;
      if (ts >= end - 30 * 86400e3) { n30++; sum30 += p; }
      latest = Math.max(latest, ts);
    }
  }
  if (n < 365 * 288 * 0.9) throw new Error(`only ${n} intervals`);
  const prev = readJson<{ price: number[] }>('prices.json', { price: [] });
  const price = new Array<number>(8760).fill(NaN);
  for (const [hourKey, [s, c]] of hourly) {
    const dt = new Date(hourKey * 3600e3);
    const y = dt.getUTCFullYear();
    let doy = Math.floor((Date.UTC(y, dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400e3);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (leap && doy === 59) continue;
    if (leap && doy > 59) doy -= 1;
    price[doy * 24 + dt.getUTCHours()] = Math.round((s / c) * 10) / 10;
  }
  for (let i = 0; i < 8760; i++) if (!Number.isFinite(price[i])) price[i] = prev.price[i] ?? price[(i + 8736) % 8760] ?? 80;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const through = fmt(latest);
  writeJson('prices.json', {
    source: 'AEMO aggregated price and demand data, NSW1 regional reference price (5-minute RRP averaged to hourly)',
    url: 'https://aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_YYYYMM_NSW1.csv',
    period: `${fmt(start)} to ${through} (rolling 365 days, mapped onto a 365-day calendar, AEST hour-beginning)`,
    intervalMean: round(sum / n, 2),
    negativeIntervalShare: round(neg / n, 4),
    price,
  }, false);
  return { ok: true, mean30: round(sum30 / Math.max(1, n30), 2), mean365: round(sum / n, 2), negShare365: round(neg / n, 4), through, date: through, source: 'AEMO NSW1 5-minute prices', url: 'https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/aggregated-data' };
}

// ---------- Main ----------
async function main() {
  const today = sydneyDate();
  console.log(`Clovernook market update for ${today}${OFFLINE ? ' (offline)' : ''}`);
  const prev = readJson<Record<string, Feed>>('market.json', {});
  const live: Record<string, unknown> = { updated: OFFLINE ? (prev.updated ?? null) : new Date().toISOString() };
  live.fx = await feed('FX', prev.fx, fx);
  const curatedAtStart = readJson<Record<string, any>>('market-curated.json', {});
  const gpuAnchors = Object.fromEntries(Object.entries(curatedAtStart.gpu ?? {}).map(([k, v]: [string, any]) => [k, { usd: v.anchorUsdPerHr, p25: v.vastAnchorP25 }]));
  live.gpu = await feed('GPU marketplace', prev.gpu, () => gpu(prev.gpu, gpuAnchors));
  live.solarModule = await feed('Solar modules', prev.solarModule, solarModule);
  live.livestock = await feed('Livestock (ABARES)', prev.livestock, livestock);
  live.fpi = await feed('FAO food prices', prev.fpi, fpi);
  live.humanoids = await feed('Humanoid robots', prev.humanoids, humanoids);
  live.lgc = await feed('LGCs', prev.lgc, lgc);
  live.nem = await feed('NEM prices', prev.nem, nem);

  // Anchors: once a model has MIN_DAYS of readings, tie its researched level to the smoothed ask from then on.
  const curated = readJson<Record<string, any>>('market-curated.json', {});
  let curatedChanged = false;
  const g = live.gpu as Feed & { models?: Record<string, GpuStat> };
  for (const [model, c] of Object.entries(curated.gpu ?? {}) as [string, any][]) {
    const m = g?.models?.[model];
    if (!c.vastAnchorP25 && g?.ok && m && (m.hist?.length ?? 0) >= MIN_DAYS) { c.vastAnchorP25 = m.p25s ?? m.p25; curatedChanged = true; }
  }
  const f = live.fpi as Feed & { value?: number };
  if (curated.ag && !curated.ag.fpiAnchor && f?.ok && f.value) { curated.ag.fpiAnchor = f.value; curatedChanged = true; }
  if (curatedChanged) writeJson('market-curated.json', curated);
  writeJson('market.json', live);

  // Re-optimise with the fresh data (modules are imported only now so they read the updated JSON).
  const { defaultScenario } = await import('../src/engine/defaults.ts');
  const { createContext, evaluate } = await import('../src/engine/model.ts');
  const { optimize, defaultOptimizeOptions } = await import('../src/engine/optimize.ts');
  const site = readJson('site.json', {});
  const climate = readJson('climate.json', {});
  const prices = readJson<{ price: number[] }>('prices.json', { price: [] });
  const ctx = createContext(site as never, climate as never, prices.price);
  const base = defaultScenario();
  const options = defaultOptimizeOptions();
  const t0 = Date.now();
  const res = optimize(base, ctx, options);
  const best = res.best;
  const r = evaluate(best, ctx);
  const DECISIONS = ['pv.type', 'pv.fillPct', 'pv.gcr', 'pv.tiltDeg', 'pv.dcAcRatio', 'pv.clearanceM', 'grid.importLimitKw', 'grid.exportLimitKw', 'bess.powerKw', 'bess.hours',
    'compute.model', 'compute.servers', 'compute.padRaiseM', 'homes.cabins', 'homes.grannyFlat', 'ag.underArray', 'ag.openLand', 'ag.greenhouseM2', 'ag.hives', 'robots.fleet', 'robots.deployYear', 'robots.acquisition'];
  const get = (o: any, p: string) => p.split('.').reduce((a, k) => a?.[k], o);
  const decisions = Object.fromEntries(DECISIONS.map((p) => [p, get(best, p)]));
  const gpus = best.compute.servers * best.compute.catalog[best.compute.model].gpusPerServer;
  const metrics = { npv: Math.round(r.npv), irr: r.irr === null ? null : round(r.irr, 4), capex: Math.round(r.capexTotal), ebitda1: Math.round(r.year1.ebitda), kwdc: Math.round(r.layout.kwdc), bessKwh: Math.round(r.bessKwh), gpus, gpuModel: best.compute.model, robots: best.robots.fleet, robotYear: best.robots.deployYear };
  writeJson('recommended.json', { date: today, generatedAt: new Date().toISOString(), evaluations: res.evaluations, ms: Date.now() - t0, options, decisions, metrics });
  console.log(`Recommended: ${JSON.stringify(metrics)}`);

  // History snapshot (one per Sydney date).
  const history = readJson<any[]>('market-history.json', []);
  const L = live as any;
  const snap = {
    date: today,
    usdAud: L.fx?.usdAud ?? null,
    gpuAsk: Object.fromEntries(Object.entries(L.gpu?.models ?? {}).map(([k, v]: [string, any]) => [k, v.p25s ?? v.p25])),
    gpuPrice: Object.fromEntries(Object.entries(best.compute.catalog).map(([k, v]: [string, any]) => [k, v.priceUsdPerGpuHr])),
    nem30: L.nem?.mean30 ?? null,
    lgc: L.lgc?.price ?? null,
    moduleUsdPerW: L.solarModule?.usdPerW ?? null,
    eyci: L.livestock?.eyci?.value ?? null,
    ntli: L.livestock?.ntli?.value ?? null,
    fpi: L.fpi?.value ?? null,
    robotUsd: base.robots.priceUsd,
    unitreeH2: L.humanoids?.unitree?.find((u: any) => /^Unitree H2$/i.test(u.name))?.fromUsd ?? null,
    recNpv: metrics.npv,
    recIrr: metrics.irr,
    recCapex: metrics.capex,
    recRobots: metrics.robots,
  };
  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) history[idx] = snap; else history.push(snap);
  history.sort((a, b) => a.date.localeCompare(b.date));
  writeJson('market-history.json', history.slice(-730));
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
