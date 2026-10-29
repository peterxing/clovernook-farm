import { describe, expect, it } from 'vitest';
import siteJson from '../src/data/site.json';
import climateJson from '../src/data/climate.json';
import pricesJson from '../src/data/prices.json';
import planRaw from '../src/data/delivery-plan.json?raw';
import type { SiteData } from '../src/engine/site';
import type { Climate } from '../src/engine/types';
import { createContext, evaluate } from '../src/engine/model';
import { DELIVERY_PLAN, commitments, nextActions, planNumbers, schedulePlan, signupProgress, validatePlan, type DeliveryPlan } from '../src/engine/delivery';
import { PRESETS } from '../src/ui/presets';

const ctx = createContext(siteJson as unknown as SiteData, climateJson as unknown as Climate, pricesJson.price);

describe('delivery plan file', () => {
  it('is well formed', () => {
    expect(validatePlan(DELIVERY_PLAN)).toEqual([]);
  });
  it('keeps the formatting the daily research writes', () => {
    expect(JSON.stringify(JSON.parse(planRaw), null, 2) + '\n').toBe(planRaw);
  });
  it('reports cycles and unknown predecessors', () => {
    const bad: DeliveryPlan = structuredClone(DELIVERY_PLAN);
    bad.steps[0].after = [bad.steps[bad.steps.length - 1].id];
    bad.steps[1].after = ['no-such-step'];
    const errors = validatePlan(bad);
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
    expect(errors.some((e) => e.includes('no-such-step'))).toBe(true);
  });
});

describe('delivery schedule', () => {
  for (const p of PRESETS) {
    const s = p.build();
    const r = evaluate(s, ctx);
    const sched = schedulePlan(DELIVERY_PLAN, s, r);

    it(`${p.id}: respects every dependency`, () => {
      for (const st of sched.steps) {
        for (const d of st.deps) expect(st.start, `${st.id} after ${d.id}`).toBeGreaterThanOrEqual(sched.byId[d.id].end + d.lagWeeks - 1e-9);
        expect(st.end).toBeGreaterThanOrEqual(st.start);
      }
      expect(sched.steps.some((x) => x.critical)).toBe(true);
      expect(sched.endWeek).toBeGreaterThan(52);
    });

    it(`${p.id}: fills every placeholder`, () => {
      for (const st of sched.steps) expect(`${st.title} ${st.detail} ${st.who}`, st.id).not.toMatch(/\{[A-Za-z0-9.]+\}/);
    });

    it(`${p.id}: commits the whole capital cost`, () => {
      const com = commitments(sched);
      expect(com[com.length - 1].cumulative).toBeCloseTo(r.capexTotal, 0);
    });

    it(`${p.id}: only includes the steps the plan needs`, () => {
      const has = (id: string) => id in sched.byId;
      expect(has('servers-order')).toBe(s.compute.servers > 0);
      expect(has('cabin-bookings')).toBe(s.homes.cabins > 0);
      expect(has('egg-licence')).toBe(r.ag.hens > 0);
      expect(has('robot-lease')).toBe(s.robots.fleet > 0);
      for (const x of signupProgress(DELIVERY_PLAN, s, r, sched)) {
        expect(x.step, x.id).toBeDefined();
        expect(x.target).toBeGreaterThan(0);
      }
    });
  }

  it('drops steps a plan does not need without breaking the chain', () => {
    const s = PRESETS[0].build();
    s.compute.servers = 0;
    s.homes.cabins = 0;
    s.homes.grannyFlat = false;
    s.robots.fleet = 0;
    const r = evaluate(s, ctx);
    const sched = schedulePlan(DELIVERY_PLAN, s, r);
    for (const id of ['gpu-loi', 'servers-order', 'gpus-live', 'cabins-build', 'cabin-bookings', 'robot-lease']) expect(sched.byId[id]).toBeUndefined();
    expect(sched.byId.fid.deps.map((d) => d.id)).toEqual(expect.arrayContaining(['da-determined', 'connection-offer', 'finance']));
    expect(sched.byId.operating.start).toBeGreaterThanOrEqual(sched.byId.energise.end);
  });

  it('switches to the longer Chapter 5 grid process at 5 MW and above', () => {
    const small = PRESETS[0].build();
    const big = PRESETS[0].build();
    big.pv.fillPct = 100; big.pv.gcr = 0.4; big.pv.type = 'fixed'; big.bess.powerKw = 3000;
    const rs = evaluate(small, ctx), rb = evaluate(big, ctx);
    expect(rb.pvKwac + big.bess.powerKw).toBeGreaterThanOrEqual(5000);
    const a = schedulePlan(DELIVERY_PLAN, small, rs), b = schedulePlan(DELIVERY_PLAN, big, rb);
    expect(b.byId['ee-studies'].weeks).toBeGreaterThan(a.byId['ee-studies'].weeks);
    expect(b.byId.energise.end).toBeGreaterThan(a.byId.energise.end);
  });

  it('done steps take no time, pull the plan forward and unlock the next ones', () => {
    const s = PRESETS[0].build();
    const r = evaluate(s, ctx);
    const plan: DeliveryPlan = structuredClone(DELIVERY_PLAN);
    const before = schedulePlan(plan, s, r);
    for (const st of plan.steps) if (st.id === 'site-option' || st.id === 'ee-register') { st.status = 'done'; st.done = '2026-10-30'; }
    const after = schedulePlan(plan, s, r);
    expect(after.byId['site-option'].weeks).toBe(0);
    expect(after.endWeek).toBeLessThanOrEqual(before.endWeek);
    expect(nextActions(after).map((x) => x.id)).toEqual(expect.arrayContaining(['survey', 'ee-prelim']));
  });

  it('sizes sign-up targets from the plan', () => {
    const s = PRESETS[0].build();
    const r = evaluate(s, ctx);
    const n = planNumbers(s, r);
    const view = signupProgress(DELIVERY_PLAN, s, r, schedulePlan(DELIVERY_PLAN, s, r));
    const gpu = view.find((x) => x.id === 'gpu');
    if (s.compute.servers > 0) expect(gpu?.target).toBe(Math.ceil(n.gpus / 2));
    for (const x of view) expect(x.signed).toBeLessThanOrEqual(x.target);
  });
});
