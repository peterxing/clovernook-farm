import { describe, expect, it } from 'vitest';
import siteJson from '../src/data/site.json';
import climateJson from '../src/data/climate.json';
import pricesJson from '../src/data/prices.json';
import type { SiteData } from '../src/engine/site';
import type { Climate } from '../src/engine/types';
import { createContext, evaluate } from '../src/engine/model';
import { defaultScenario } from '../src/engine/defaults';
import { sunGeometry, floodAep } from '../src/engine/solar';
import { irr, npv, payback, annuity } from '../src/engine/finance';
import { layoutArray, polygonsArea, type Ring } from '../src/engine/layout';

const site = siteJson as unknown as SiteData;
const climate = climateJson as unknown as Climate;
const ctx = createContext(site, climate, pricesJson.price);

describe('sun geometry', () => {
  const sun = sunGeometry(-31.8684, 152.5161, 0.5);
  const noonIdx = (doy: number) => {
    // find the hour with the highest sun on that day
    let best = 0, bi = 0;
    for (let h = 0; h < 24; h++) { const i = (doy - 1) * 24 + h; if (sun.cosZen[i] > best) { best = sun.cosZen[i]; bi = i; } }
    return bi;
  };
  it('summer solstice noon sun is near zenith, to the north', () => {
    const i = noonIdx(355);
    const zen = (Math.acos(sun.cosZen[i]) * 180) / Math.PI;
    expect(zen).toBeLessThan(15);
  });
  it('winter solstice noon sun is ~55 deg from zenith and due north', () => {
    const i = noonIdx(172);
    const zen = (Math.acos(sun.cosZen[i]) * 180) / Math.PI;
    expect(zen).toBeGreaterThan(52);
    expect(zen).toBeLessThan(60);
    const az = (sun.azimuth[i] * 180) / Math.PI;
    expect(Math.min(az, 360 - az)).toBeLessThan(15);
  });
  it('morning sun is in the east', () => {
    const i = 100 * 24 + 8; // 8:30 AEST in April
    const az = (sun.azimuth[i] * 180) / Math.PI;
    expect(az).toBeGreaterThan(45);
    expect(az).toBeLessThan(135);
  });
});

describe('finance helpers', () => {
  it('irr/npv/payback/annuity', () => {
    expect(irr([-100, 110])!).toBeCloseTo(0.1, 6);
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 6);
    expect(payback([-100, 50, 50, 50])).toBeCloseTo(2, 6);
    expect(payback([-100, 10])).toBeNull();
    expect(annuity(1000, 0, 10)).toBeCloseTo(100, 6);
    expect(annuity(1000, 10, 1)).toBeCloseTo(1100, 6);
  });
  it('flood AEP follows the Manning FRMS&P design levels at Cundletown', () => {
    expect(floodAep(2.0)).toBeCloseTo(0.2, 6);
    expect(floodAep(3.1)).toBeCloseTo(0.05, 6);
    expect(floodAep(4.1)).toBeCloseTo(0.01, 6);
    expect(floodAep(5.1)).toBeLessThan(0.002);
    expect(floodAep(1.4)).toBeGreaterThan(0.2);
    expect(floodAep(1.4)).toBeLessThanOrEqual(1);
    expect(floodAep(4.6, 0.5)).toBeCloseTo(0.01, 6); // offset shifts the whole curve
    let prev = 1;
    for (let l = 0; l < 8; l += 0.1) { const a = floodAep(l); expect(a).toBeLessThanOrEqual(prev + 1e-12); prev = a; }
  });
});

describe('layout', () => {
  const square: Ring[][] = [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]];
  it('rows stay inside the zone and capacity scales with fill', () => {
    expect(polygonsArea(square)).toBeCloseTo(10000, 3);
    const p = { type: 'fixed' as const, gcr: 0.4, fillPct: 100, moduleWp: 620, moduleLengthM: 2.382, moduleWidthM: 1.134, tiltDeg: 20 };
    const full = layoutArray(square, p);
    const half = layoutArray(square, { ...p, fillPct: 50 });
    for (const r of full.rows) for (const pt of [r.a, r.b]) { expect(pt[0]).toBeGreaterThanOrEqual(0); expect(pt[0]).toBeLessThanOrEqual(100); }
    expect(half.kwdc).toBeGreaterThan(full.kwdc * 0.45);
    expect(half.kwdc).toBeLessThan(full.kwdc * 0.55);
    // ~1 ha at GCR 0.4 with 2P 620 W modules: roughly 0.7-0.9 MWdc after end clearances
    expect(full.kwdc).toBeGreaterThan(650);
    expect(full.kwdc).toBeLessThan(950);
  });
});

describe('site model', () => {
  it('site data is consistent', () => {
    expect(site.areaHa).toBeGreaterThan(13);
    expect(site.areaHa).toBeLessThan(13.5);
    expect(site.zones.RU1.areaHa + site.zones.R5.areaHa).toBeCloseTo(site.areaHa, 1);
    expect(climate.ghi).toHaveLength(8760);
    expect(pricesJson.price).toHaveLength(8760);
  });

  it('specific yields are plausible and ordered tracker > fixed > vertical', () => {
    const base = defaultScenario();
    const y = (type: 'fixed' | 'tracker' | 'vertical', gcr: number) => evaluate({ ...base, pv: { ...base.pv, type, gcr } }, ctx).energy.specificYield;
    const fixed = y('fixed', 0.35), tracker = y('tracker', 0.35), vertical = y('vertical', 0.25);
    expect(fixed).toBeGreaterThan(1350);
    expect(fixed).toBeLessThan(1900);
    expect(tracker).toBeGreaterThan(fixed);
    expect(vertical).toBeLessThan(fixed);
    expect(vertical).toBeGreaterThan(900);
  });

  it('energy balance closes', () => {
    const r = evaluate(defaultScenario(), ctx, { series: true });
    const e = r.energy;
    const pvUses = e.pvToLoadMwh + e.pvToBattMwh + e.pvToFlexMwh + e.exportMwh - e.battToGridMwh + e.curtailedMwh;
    expect(pvUses).toBeCloseTo(e.pvAcMwh, 3);
    const loads = e.gpuLoadMwh + e.flexLoadMwh + e.otherLoadMwh - e.unservedMwh;
    const supply = e.pvToLoadMwh + e.pvToFlexMwh + e.battToLoadMwh + (e.importMwh - e.gridToBattMwh);
    expect(supply).toBeCloseTo(loads, 3);
    // battery can't create energy
    const into = e.pvToBattMwh + e.gridToBattMwh, out = e.battToLoadMwh + e.battToGridMwh;
    expect(out).toBeLessThanOrEqual(into * 0.89 + r.bessKwh / 1000);
    const soc = r.series!.soc;
    for (let i = 0; i < soc.length; i++) { expect(soc[i]).toBeGreaterThanOrEqual(0.05 - 1e-9); expect(soc[i]).toBeLessThanOrEqual(1 + 1e-9); }
  });

  it('import and export never exceed the connection limits', () => {
    const s = defaultScenario();
    const r = evaluate(s, ctx, { series: true });
    const ser = r.series!;
    for (let i = 0; i < 8760; i++) {
      expect(ser.gridImport[i]).toBeLessThanOrEqual(s.grid.importLimitKw + 1e-6);
      expect(ser.gridExport[i]).toBeLessThanOrEqual(s.grid.exportLimitKw + 1e-6);
      if (ser.price[i] * s.grid.exportLossFactor - s.grid.exportFeePerMwh <= 0) expect(ser.gridExport[i]).toBe(0);
    }
  });

  it('produces finite financials', () => {
    const r = evaluate(defaultScenario(), ctx);
    expect(Number.isFinite(r.npv)).toBe(true);
    expect(r.capexTotal).toBeGreaterThan(1e6);
    expect(r.years).toHaveLength(25);
    expect(r.ag.dse).toBeGreaterThan(0);
    expect(r.layout.kwdc).toBeGreaterThan(1000);
  });
});
