import { describe, expect, it } from 'vitest';
import siteJson from '../src/data/site.json';
import climateJson from '../src/data/climate.json';
import pricesJson from '../src/data/prices.json';
import type { SiteData } from '../src/engine/site';
import type { Climate } from '../src/engine/types';
import { createContext, evaluate, fpl } from '../src/engine/model';
import { defaultScenario } from '../src/engine/defaults';
import { optimize, defaultOptimizeOptions, agSharePct } from '../src/engine/optimize';
import { contributions, monteCarlo, tornado } from '../src/engine/risk';
import { PARAMS, getParam, setParam } from '../src/engine/params';
import { PRESETS, decodeScenario, encodeScenario } from '../src/ui/presets';

const site = siteJson as unknown as SiteData;
const ctx = createContext(site, climateJson as unknown as Climate, pricesJson.price);

describe('optimiser', () => {
  const opts = { ...defaultOptimizeOptions(), maxServers: 24 };
  const res = optimize(defaultScenario(), ctx, opts);
  const r = evaluate(res.best, ctx);

  it('beats the starting assumptions', () => {
    expect(r.npv).toBeGreaterThan(evaluate(defaultScenario(), ctx).npv);
    expect(res.evaluations).toBeGreaterThan(100);
  });

  it('respects every constraint', () => {
    expect(r.capexTotal).toBeLessThanOrEqual(opts.capexBudget + 1);
    expect(r.layout.kwdc).toBeGreaterThanOrEqual(opts.minPvKwdc);
    expect(r.bessKwh).toBeGreaterThanOrEqual(opts.minBessKwh);
    expect(res.best.compute.servers).toBeGreaterThanOrEqual(opts.minServers);
    expect(res.best.compute.servers).toBeLessThanOrEqual(opts.maxServers);
    expect(res.best.homes.cabins + (res.best.homes.grannyFlat ? 1 : 0)).toBeGreaterThanOrEqual(opts.minNewDwellings);
    expect(res.best.homes.cabins).toBeLessThanOrEqual(opts.maxCabins);
    expect(res.best.grid.importLimitKw).toBeLessThanOrEqual(opts.maxImportKw);
    expect(agSharePct(r, site.areaHa)).toBeGreaterThanOrEqual(opts.minAgSharePct);
  });

  it('keeps flood-safe designs above the flood planning level', () => {
    const level = fpl(res.best);
    if (res.best.pv.type !== 'vertical') expect(res.best.site.groundLevelM + res.best.pv.clearanceM).toBeGreaterThanOrEqual(level - 0.05);
    expect(res.best.site.padGroundM + res.best.compute.padRaiseM).toBeGreaterThanOrEqual(level - 0.05);
  });
});

describe('risk tools', () => {
  const s = PRESETS[0].build();
  it('tornado bars are sorted by swing and bracket the base', () => {
    const t = tornado(s, ctx);
    expect(t.bars.length).toBeGreaterThan(5);
    for (let i = 1; i < t.bars.length; i++) expect(t.bars[i - 1].swing).toBeGreaterThanOrEqual(t.bars[i].swing);
  });
  it('Monte Carlo is reproducible and ordered', () => {
    const a = monteCarlo(s, ctx, 60, 7), b = monteCarlo(s, ctx, 60, 7);
    expect(a.npv).toEqual(b.npv);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
  });
  it('contributions explain each element', () => {
    const c = contributions(s, ctx);
    expect(c.items.map((i) => i.key)).toEqual(expect.arrayContaining(['compute', 'solar', 'battery', 'cabins', 'greenhouse', 'grazing']));
    expect(Number.isFinite(c.total)).toBe(true);
  });
});

describe('assumption register', () => {
  it('every parameter path resolves to a number within its bounds', () => {
    const s = defaultScenario();
    for (const p of PARAMS) {
      const v = getParam(s, p.path);
      expect(typeof v, p.path).toBe('number');
      expect(v, p.path).toBeGreaterThanOrEqual(p.min);
      expect(v, p.path).toBeLessThanOrEqual(p.max);
    }
  });
  it('setParam writes through $model', () => {
    const s = defaultScenario();
    setParam(s, 'compute.catalog.$model.priceUsdPerGpuHr', 9.99);
    expect(s.compute.catalog[s.compute.model].priceUsdPerGpuHr).toBe(9.99);
  });
});

describe('share links', () => {
  it('round-trip every preset', () => {
    for (const p of PRESETS) {
      const s = p.build();
      const back = decodeScenario(encodeScenario(s));
      expect(back).toEqual(s);
    }
  });
  it('reject garbage', () => {
    expect(decodeScenario('not-base64!!')).toBeNull();
  });
});
