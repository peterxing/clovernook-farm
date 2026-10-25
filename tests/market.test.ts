import { describe, expect, it } from 'vitest';
import siteJson from '../src/data/site.json';
import climateJson from '../src/data/climate.json';
import pricesJson from '../src/data/prices.json';
import recommendedJson from '../src/data/recommended.json';
import curatedJson from '../src/data/market-curated.json';
import type { SiteData } from '../src/engine/site';
import type { Climate, Scenario } from '../src/engine/types';
import { createContext, evaluate } from '../src/engine/model';
import { baseScenario, defaultScenario } from '../src/engine/defaults';
import { applyMarket, type CuratedMarket, type LiveMarket } from '../src/engine/market';
import { ROBOT_TASKS, readiness, robotPriceUsd, robotYears, taskHours } from '../src/engine/robots';
import { PRESETS } from '../src/ui/presets';

const ctx = createContext(siteJson as unknown as SiteData, climateJson as unknown as Climate, pricesJson.price);
const curated = curatedJson as unknown as CuratedMarket;

describe('market data', () => {
  it('moves researched levels with live indicators and caps noisy feeds', () => {
    const cur: CuratedMarket = structuredClone(curated);
    cur.gpu.B200.vastAnchorP25 = 8;
    cur.ag.fpiAnchor = 100;
    const live: LiveMarket = {
      updated: '2026-10-26T00:00:00Z',
      fx: { ok: true, usdAud: 1.5, date: '2026-10-24' },
      gpu: { ok: true, models: { B200: { p25: 40, median: 40, n: 20, p25s: 40, ratio: 2 } } },
      solarModule: { ok: true, usdPerW: cur.solar.moduleAnchorUsdPerW + 0.02 },
      livestock: { ok: true, eyci: { value: cur.livestock.eyciAnchor * 1.1 }, ntli: { value: cur.livestock.ntliAnchor * 0.9 } },
      fpi: { ok: true, value: 110, month: '2026-09' },
      humanoids: { ok: true, unitree: [{ name: 'Unitree H2', fromUsd: cur.humanoids.unitreeH2Anchor / 2 }] },
    };
    const { scenario: s } = applyMarket(baseScenario(), live, cur);
    expect(s.finance.usdAud).toBe(1.5);
    expect(s.compute.catalog.B200.priceUsdPerGpuHr).toBeCloseTo(cur.gpu.B200.anchorUsdPerHr * 1.33, 2); // capped at ×1.33
    expect(s.pv.capexPerWdc.fixed).toBeCloseTo(cur.solar.capexPerWdc.fixed + 0.02 * 1.5, 3);
    expect(s.ag.cattleGmPerDse).toBeCloseTo(cur.livestock.cattleGmPerDse * 1.15, 1);
    expect(s.ag.sheepGmPerDse).toBeCloseTo(cur.livestock.sheepGmPerDse * 0.85, 1);
    expect(s.ag.greenhouseGmPerM2).toBeCloseTo(cur.ag.greenhouseGmPerM2 * 1.15, 1);
    expect(s.robots.priceUsd).toBe(Math.round(cur.humanoids.workCapablePriceUsd / 2));
  });

  it('falls back to researched values when feeds are down', () => {
    const { scenario: s } = applyMarket(baseScenario(), { updated: null, gpu: { ok: false, models: {} } }, curated);
    expect(s.compute.catalog.H200.priceUsdPerGpuHr).toBe(curated.gpu.H200.anchorUsdPerHr);
    expect(s.pv.lgcPrice).toBe(curated.lgc.price);
  });

  it('ignores a GPU index computed against an older researched level', () => {
    const cur: CuratedMarket = structuredClone(curated);
    cur.gpu.H200.vastAnchorP25 = 4;
    const stale: LiveMarket = { updated: null, gpu: { ok: true, models: { H200: { p25: 5, median: 5, n: 30, p25s: 5, ratio: 1.2, anchorKey: `3.1|4` } } } };
    expect(applyMarket(baseScenario(), stale, cur).scenario.compute.catalog.H200.priceUsdPerGpuHr).toBe(cur.gpu.H200.anchorUsdPerHr);
    const fresh: LiveMarket = { updated: null, gpu: { ok: true, models: { H200: { p25: 5, median: 5, n: 30, p25s: 5, ratio: 1.2, anchorKey: `${cur.gpu.H200.anchorUsdPerHr}|4` } } } };
    expect(applyMarket(baseScenario(), fresh, cur).scenario.compute.catalog.H200.priceUsdPerGpuHr).toBeCloseTo(cur.gpu.H200.anchorUsdPerHr * 1.2, 2);
  });

  it('the daily recommended plan is a valid, feasible design', () => {
    const rec = recommendedJson as { decisions?: Record<string, unknown> };
    const s = PRESETS[0].build();
    if (rec.decisions) for (const [k, v] of Object.entries(rec.decisions)) expect(k.split('.').reduce((o: any, p) => o?.[p], s), k).toEqual(v);
    const r = evaluate(s, ctx);
    expect(Number.isFinite(r.npv)).toBe(true);
    expect(r.layout.kwdc).toBeGreaterThanOrEqual(1000);
    expect(r.bessKwh).toBeGreaterThanOrEqual(1000);
  });
});

describe('humanoid robots', () => {
  const s: Scenario = defaultScenario();
  it('readiness rises over time and later forecasts lag', () => {
    for (const t of ROBOT_TASKS) {
      expect(readiness(s, t, 2026)).toBeLessThan(readiness(s, t, 2030));
      expect(readiness(s, t, 2030)).toBeLessThan(readiness(s, t, 2040));
    }
    const slow = { ...s, robots: { ...s.robots, readinessShiftYears: 3 } };
    expect(readiness(slow, 'greenhouse', 2030)).toBeLessThan(readiness(s, 'greenhouse', 2030));
  });

  it('prices fall at the forecast rate', () => {
    expect(robotPriceUsd(s, s.robots.priceRefYear)).toBe(s.robots.priceUsd);
    expect(robotPriceUsd(s, s.robots.priceRefYear + 1)).toBeCloseTo(s.robots.priceUsd * (1 - s.robots.priceDeclinePctYr / 100), 6);
  });

  it('robots never do more than the fleet can, and nothing before they arrive', () => {
    const fleet = { ...s, robots: { ...s.robots, fleet: 2, deployYear: 2030 } };
    const hours = taskHours(fleet, { guestNights: 1200, greenhouseM2: 2000, kwdc: 1500, dse: 130, dwellings: 7 });
    const res = robotYears(fleet, hours, 2027, 25, 2.5);
    const cap = 2 * fleet.robots.hoursPerDay * 365 * (fleet.robots.uptimePct / 100) * fleet.robots.productivity;
    for (const y of res.years) {
      const done = ROBOT_TASKS.reduce((a, t) => a + y.automatedHours[t], 0);
      expect(done).toBeLessThanOrEqual(cap + 1e-6);
      for (const t of ROBOT_TASKS) expect(y.automatedHours[t]).toBeLessThanOrEqual(hours[t] + 1e-6);
      if (y.calYear < 2030) { expect(done).toBe(0); expect(y.cashSavings).toBe(0); }
    }
    expect(res.years.find((y) => y.calYear === 2040)!.cashSavings).toBeGreaterThan(0);
  });

  it('adds fleet costs and savings to the cash flow only once deployed', () => {
    const base = PRESETS[0].build();
    const withRobots = { ...base, robots: { ...base.robots, fleet: 3, deployYear: 2030, acquisition: 'buy' as const } };
    const r = evaluate(withRobots, ctx);
    for (const y of r.years) {
      if (y.calYear < 2030) { expect(y.opex['Robot fleet']).toBe(0); expect(y.revenue['Robot labour savings']).toBe(0); }
    }
    expect(r.years.find((y) => y.calYear === 2030)!.capex).toBeGreaterThan(0);
    expect(r.years.find((y) => y.calYear === 2032)!.revenue['Robot labour savings']).toBeGreaterThan(0);
  });
});
