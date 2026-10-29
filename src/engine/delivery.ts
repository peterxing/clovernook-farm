import type { Result, Scenario } from './types';
import { fpl } from './model';
import planJson from '../data/delivery-plan.json';

/**
 * The delivery plan: the steps that take a plan from paper to income (approvals, the grid connection, procurement,
 * commitments and customer sign-ups). Steps live in src/data/delivery-plan.json, which the daily research keeps
 * current; this module filters them to the selected plan, fills in its quantities and schedules them.
 */

export type Stream = 'commitments' | 'approvals' | 'grid' | 'customers' | 'procurement' | 'build';
export type StepStatus = 'todo' | 'active' | 'done' | 'blocked';
export type Need =
  | 'land' | 'compute' | 'cabins' | 'newHomes' | 'homesteadLease' | 'greenhouse' | 'poultry' | 'livestock' | 'hives'
  | 'robots' | 'export' | 'gridSmall' | 'gridLarge' | 'lgc' | 'midScale';

export const STREAMS: { id: Stream; label: string; color: string }[] = [
  { id: 'commitments', label: 'Commitments', color: '#0f766e' },
  { id: 'approvals', label: 'Approvals', color: '#1d4ed8' },
  { id: 'grid', label: 'Grid connection', color: '#64748b' },
  { id: 'customers', label: 'Customers', color: '#db2777' },
  { id: 'procurement', label: 'Procurement', color: '#d97706' },
  { id: 'build', label: 'Build & open', color: '#65a30d' },
];
export const NEEDS: Need[] = ['land', 'compute', 'cabins', 'newHomes', 'homesteadLease', 'greenhouse', 'poultry', 'livestock', 'hives', 'robots', 'export', 'gridSmall', 'gridLarge', 'lgc', 'midScale'];
const STATUSES: StepStatus[] = ['todo', 'active', 'done', 'blocked'];

export interface Source { title: string; url: string; date?: string }
export interface Dep { id: string; lagWeeks?: number }
export interface Variant { needs: Need[]; weeks?: number; title?: string; detail?: string; who?: string }

export interface DeliveryStep {
  id: string;
  stream: Stream;
  title: string; // may contain {placeholders}, filled from the selected plan
  detail: string;
  who: string;
  weeks: number;
  after: (string | Dep)[]; // finish-to-start; a negative lag starts the step before its predecessor finishes
  needs?: Need[]; // the step only applies when the plan has all of these
  variants?: Variant[]; // the first variant whose needs are all met overrides weeks/title/detail/who
  status: StepStatus;
  milestone?: boolean;
  capex?: string[]; // capex lines (see model.ts) committed by this step
  commitAt?: 'start' | 'end'; // when the money is committed (default: end)
  done?: string | null; // completion date when status is done
  sources: Source[];
  checked: string; // date the step's facts were last verified
}

export interface Signup {
  id: string;
  label: string;
  unit: string;
  target: string; // a planNumbers() key
  signed: number;
  needs?: Need[];
  step: string;
  note?: string;
}

export interface DeliveryPlan {
  updated: string;
  note: string;
  startDate: string | null; // null: dates assume the work starts on the update date
  steps: DeliveryStep[];
  signups: Signup[];
}

export const DELIVERY_PLAN = planJson as unknown as DeliveryPlan;

export interface ScheduledStep {
  id: string;
  stream: Stream;
  title: string;
  detail: string;
  who: string;
  status: StepStatus;
  milestone: boolean;
  weeks: number;
  start: number; // weeks from the plan start
  end: number;
  startDate: string;
  endDate: string;
  deps: { id: string; lagWeeks: number }[];
  critical: boolean;
  slack: number;
  ready: boolean; // not done and every predecessor is done
  capexAud: number;
  commitDate: string;
  sources: Source[];
  checked: string;
}

export interface DeliverySchedule {
  start: string;
  steps: ScheduledStep[]; // in schedule order
  byId: Record<string, ScheduledStep>;
  endWeek: number;
  endDate: string;
}

/** Which kinds of steps the plan needs. */
export function conditions(s: Scenario, r: Result): Record<Need, boolean> {
  const nameplateKw = r.pvKwac + s.bess.powerKw;
  const kwdc = r.layout.kwdc;
  return {
    land: s.finance.includeLand,
    compute: s.compute.servers > 0,
    cabins: s.homes.cabins > 0,
    newHomes: s.homes.cabins > 0 || s.homes.grannyFlat,
    homesteadLease: s.homes.houseMode === 'rent',
    greenhouse: s.ag.greenhouseM2 > 0,
    poultry: r.ag.hens > 0,
    livestock: r.ag.dse > 0 || r.ag.hens >= 100,
    hives: s.ag.hives > 0,
    robots: s.robots.fleet > 0,
    export: s.grid.exportLimitKw > 0,
    gridSmall: nameplateKw < 5000,
    gridLarge: nameplateKw >= 5000,
    lgc: kwdc > 1000,
    midScale: kwdc > 100 && kwdc <= 1000,
  };
}

const EGGS_PER_HEN_DAY = 0.8;

/** Quantities the steps and sign-up targets refer to. */
export function planNumbers(s: Scenario, r: Result): Record<string, number> {
  const spec = s.compute.catalog[s.compute.model];
  const gpus = s.compute.servers * spec.gpusPerServer;
  return {
    gpus,
    gpusHalf: Math.ceil(gpus / 2),
    servers: s.compute.servers,
    gpuPrice: spec.priceUsdPerGpuHr,
    gpuHours: r.energy.gpuHoursSold,
    gpuHoursHalf: r.energy.gpuHoursSold / 2,
    kwdc: r.layout.kwdc,
    kwac: r.pvKwac,
    bessKw: s.bess.powerKw,
    bessKwh: r.bessKwh,
    importKw: s.grid.importLimitKw,
    exportKw: s.grid.exportLimitKw,
    itKw: r.itKw,
    modules: Math.round((r.layout.kwdc * 1000) / s.pv.moduleWp),
    clearance: s.pv.clearanceM,
    padRaise: s.compute.padRaiseM,
    fpl: fpl(s),
    cabins: s.homes.cabins,
    cabinAdr: s.homes.cabinAdr,
    cabinOcc: s.homes.cabinOccupancyPct,
    guestNights: r.homes.guestNights,
    homestead: 1,
    homesteadRent: s.homes.houseWeeklyRent,
    hens: r.ag.hens,
    eggsDozenWk: (r.ag.hens * EGGS_PER_HEN_DAY * 7) / 12,
    dse: r.ag.dse,
    greenhouseM2: s.ag.greenhouseM2,
    hives: s.ag.hives,
    robots: s.robots.fleet,
    robotYear: s.robots.deployYear,
    leaseUsd: s.robots.leaseUsdPerMonth,
    exportMwh: r.energy.exportMwh,
    capexTotal: r.capexTotal,
    landPrice: s.finance.landPrice,
    startYear: s.finance.startYear,
  };
}

const int = (v: number) => Math.round(v).toLocaleString('en-AU');
const near = (v: number, step: number) => int(Math.round(v / step) * step);
export const audShort = (v: number) =>
  v >= 1e6 ? `A$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M` : v >= 1e3 ? `A$${Math.round(v / 1e3)}k` : `A$${Math.round(v)}`;
const power = (kw: number, unit = 'W') => (kw >= 1000 ? `${(kw / 1000).toFixed(kw >= 10000 ? 0 : 1).replace(/\.0$/, '')} M${unit}` : `${int(kw)} k${unit}`);
const PV_TYPE = { fixed: 'elevated fixed-tilt', tracker: 'single-axis tracker', vertical: 'vertical bifacial' } as const;
const STOCK = { sheep: 'sheep', cattle: 'cattle', poultry: 'free-range hens', hay: 'hay', none: '' } as const;
const CAPEX_KEYS = ['pv', 'pvRaise', 'bess', 'grid', 'servers', 'dc', 'fibre', 'pad', 'fence', 'mound', 'greenhouse', 'hives', 'poultry', 'homes', 'robots', 'dev', 'contingency', 'land'];

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** Text values for the {placeholders} in step titles and details. */
export function planVars(s: Scenario, r: Result): Record<string, string> {
  const n = planNumbers(s, r);
  const spec = s.compute.catalog[s.compute.model];
  const kwp = `${(n.kwdc / 1000).toFixed(2)} MWp`;
  const elements = [
    `a ${kwp} ${PV_TYPE[s.pv.type]} array`,
    `a ${power(n.bessKw)} / ${power(n.bessKwh, 'Wh')} battery`,
    ...(n.servers > 0 ? [`${n.servers} × ${s.compute.model} servers (${int(n.gpus)} GPUs) on a raised platform`] : []),
    ...(n.cabins > 0 ? [`${n.cabins} farm-stay cabin${n.cabins === 1 ? '' : 's'}`] : []),
    ...(s.homes.grannyFlat ? ['a granny flat'] : []),
    ...(n.greenhouseM2 > 0 ? [`a ${int(n.greenhouseM2)} m² greenhouse`] : []),
  ];
  const stock = [
    ...(n.hens > 0 ? [`${near(n.hens, 10)} free-range hens under the array`] : []),
    ...(s.ag.underArray === 'sheep' || s.ag.underArray === 'cattle' ? [`${STOCK[s.ag.underArray]} under the array`] : []),
    ...(s.ag.openLand === 'sheep' || s.ag.openLand === 'cattle' ? [`${STOCK[s.ag.openLand]} on the open paddock`] : []),
    ...(n.hives > 0 ? [`${n.hives} hives`] : []),
  ];
  const vars: Record<string, string> = {
    gpus: int(n.gpus),
    gpusHalf: int(n.gpusHalf),
    servers: int(n.servers),
    gpuModel: s.compute.model,
    gpuLabel: spec.label,
    gpuPrice: n.gpuPrice.toFixed(2),
    gpuHours: near(n.gpuHours, 1000),
    gpuHoursHalf: near(n.gpuHoursHalf, 1000),
    kwdc: kwp,
    kwac: power(n.kwac),
    bessKw: power(n.bessKw),
    bessKwh: power(n.bessKwh, 'Wh'),
    importKw: power(n.importKw),
    exportKw: power(n.exportKw),
    itKw: `${int(n.itKw)} kW`,
    pvType: PV_TYPE[s.pv.type],
    modules: near(n.modules, 10),
    clearance: n.clearance.toFixed(1),
    padRaise: n.padRaise.toFixed(1),
    fpl: n.fpl.toFixed(1),
    cabins: int(n.cabins),
    cabinAdr: `A$${int(n.cabinAdr)}`,
    cabinOcc: int(n.cabinOcc),
    guestNights: near(n.guestNights, 10),
    homesteadRent: `A$${int(n.homesteadRent)} a week`,
    hens: near(n.hens, 10),
    eggsDozenWk: near(n.eggsDozenWk, 10),
    dse: int(n.dse),
    greenhouseM2: int(n.greenhouseM2),
    hives: int(n.hives),
    robots: int(n.robots),
    robotYear: String(n.robotYear),
    robotMode: s.robots.acquisition === 'lease' ? 'lease' : 'purchase',
    leaseUsd: int(n.leaseUsd),
    exportMwh: `${near(n.exportMwh, 10)} MWh`,
    capexTotal: audShort(n.capexTotal),
    landPrice: audShort(n.landPrice),
    startYear: String(n.startYear),
    summary: list(elements),
    stock: list(stock) || 'the stock',
  };
  for (const k of CAPEX_KEYS) vars[`capex.${k}`] = 'A$0';
  for (const l of r.capex) vars[`capex.${l.key}`] = audShort(l.amount);
  return vars;
}

/** Replaces {name} placeholders; unknown names are left as they are so tests can catch them. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([A-Za-z0-9.]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

const DAY = 86400e3;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addWeeks = (iso: string, weeks: number) => new Date(toUtc(iso) + Math.round(weeks * 7) * DAY).toISOString().slice(0, 10);

const depOf = (d: string | Dep): Dep => (typeof d === 'string' ? { id: d } : d);

/** Filters the steps to the plan, fills in its quantities and computes start/end dates and the critical path. */
export function schedulePlan(plan: DeliveryPlan, s: Scenario, r: Result): DeliverySchedule {
  const cond = conditions(s, r);
  const vars = planVars(s, r);
  const met = (needs?: Need[]) => (needs ?? []).every((n) => cond[n]);
  const all = new Map(plan.steps.map((st) => [st.id, st]));
  const applies = (id: string) => { const st = all.get(id); return !!st && met(st.needs); };

  // Predecessors among the applicable steps: a step that doesn't apply passes its own predecessors on (lags add up).
  const memo = new Map<string, { id: string; lagWeeks: number }[]>();
  const resolving = new Set<string>();
  const effectiveDeps = (id: string): { id: string; lagWeeks: number }[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    if (resolving.has(id)) throw new Error(`Delivery plan has a dependency cycle at "${id}"`);
    resolving.add(id);
    const out: { id: string; lagWeeks: number }[] = [];
    for (const raw of all.get(id)?.after ?? []) {
      const d = depOf(raw);
      const lag = d.lagWeeks ?? 0;
      if (!all.has(d.id)) continue;
      if (applies(d.id)) out.push({ id: d.id, lagWeeks: lag });
      else for (const e of effectiveDeps(d.id)) out.push({ id: e.id, lagWeeks: e.lagWeeks + lag });
    }
    resolving.delete(id);
    memo.set(id, out);
    return out;
  };

  const steps = plan.steps.filter((st) => met(st.needs));
  const deps = new Map(steps.map((st) => [st.id, effectiveDeps(st.id)]));

  // Topological order (Kahn), keeping the file's order among ready steps.
  const indeg = new Map(steps.map((st) => [st.id, deps.get(st.id)!.length]));
  const succ = new Map<string, { id: string; lagWeeks: number }[]>(steps.map((st) => [st.id, []]));
  for (const st of steps) for (const d of deps.get(st.id)!) succ.get(d.id)!.push({ id: st.id, lagWeeks: d.lagWeeks });
  const order: string[] = [];
  const queue = steps.filter((st) => indeg.get(st.id) === 0).map((st) => st.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nx of succ.get(id)!) {
      indeg.set(nx.id, indeg.get(nx.id)! - 1);
      if (indeg.get(nx.id) === 0) queue.push(nx.id);
    }
  }
  if (order.length !== steps.length) throw new Error('Delivery plan has a dependency cycle');

  const byIdStep = new Map(steps.map((st) => [st.id, st]));
  const resolved = new Map(steps.map((st) => {
    const v = st.variants?.find((x) => met(x.needs));
    return [st.id, { weeks: v?.weeks ?? st.weeks, title: v?.title ?? st.title, detail: v?.detail ?? st.detail, who: v?.who ?? st.who }];
  }));
  const dur = (id: string) => (byIdStep.get(id)!.status === 'done' ? 0 : resolved.get(id)!.weeks);

  const es = new Map<string, number>(), ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    for (const d of deps.get(id)!) start = Math.max(start, ef.get(d.id)! + d.lagWeeks);
    es.set(id, start);
    ef.set(id, start + dur(id));
  }
  const endWeek = Math.max(0, ...order.map((id) => ef.get(id)!));
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    let finish = endWeek;
    for (const nx of succ.get(id)!) finish = Math.min(finish, lf.get(nx.id)! - dur(nx.id) - nx.lagWeeks);
    lf.set(id, finish);
  }

  const startIso = plan.startDate ?? plan.updated;
  const capexByKey = new Map(r.capex.map((l) => [l.key, l.amount]));
  const out: ScheduledStep[] = order.map((id) => {
    const st = byIdStep.get(id)!;
    const rs = resolved.get(id)!;
    const start = es.get(id)!, end = ef.get(id)!;
    const slack = lf.get(id)! - end;
    const d = deps.get(id)!;
    const commitWeek = st.commitAt === 'start' ? start : end;
    return {
      id,
      stream: st.stream,
      title: fill(rs.title, vars),
      detail: fill(rs.detail, vars),
      who: fill(rs.who, vars),
      status: st.status,
      milestone: !!st.milestone,
      weeks: dur(id),
      start,
      end,
      startDate: addWeeks(startIso, start),
      endDate: addWeeks(startIso, end),
      deps: d,
      critical: slack < 1e-6,
      slack,
      ready: st.status !== 'done' && d.every((x) => byIdStep.get(x.id)!.status === 'done'),
      capexAud: (st.capex ?? []).reduce((a, k) => a + (capexByKey.get(k) ?? 0), 0),
      commitDate: addWeeks(startIso, commitWeek),
      sources: st.sources,
      checked: st.checked,
    };
  });
  return { start: startIso, steps: out, byId: Object.fromEntries(out.map((x) => [x.id, x])), endWeek, endDate: addWeeks(startIso, endWeek) };
}

/** Steps that can start now, critical ones first. */
export function nextActions(sched: DeliverySchedule): ScheduledStep[] {
  return sched.steps.filter((x) => x.ready).sort((a, b) => Number(b.critical) - Number(a.critical) || a.start - b.start);
}

/** Money committed step by step, in date order, with the running total. */
export function commitments(sched: DeliverySchedule): (ScheduledStep & { cumulative: number })[] {
  let run = 0;
  return sched.steps
    .filter((x) => x.capexAud > 0.5)
    .sort((a, b) => a.commitDate.localeCompare(b.commitDate))
    .map((x) => ({ ...x, cumulative: (run += x.capexAud) }));
}

export interface SignupView { id: string; label: string; unit: string; target: number; signed: number; step?: ScheduledStep; note?: string }

/** Customer sign-ups the plan needs, with targets from the plan and the count signed so far. */
export function signupProgress(plan: DeliveryPlan, s: Scenario, r: Result, sched: DeliverySchedule): SignupView[] {
  const cond = conditions(s, r);
  const n = planNumbers(s, r);
  return plan.signups
    .filter((x) => (x.needs ?? []).every((k) => cond[k]))
    .map((x) => ({ id: x.id, label: x.label, unit: x.unit, target: Math.max(1, Math.round(n[x.target] ?? 0)), signed: x.signed, step: sched.byId[x.step], note: x.note }));
}

/** Structural checks on the plan file (used by the tests and the daily research). */
export function validatePlan(plan: DeliveryPlan): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(plan.updated)) errors.push('updated must be YYYY-MM-DD');
  if (plan.startDate !== null && !iso.test(plan.startDate)) errors.push('startDate must be null or YYYY-MM-DD');
  for (const st of plan.steps) {
    if (ids.has(st.id)) errors.push(`duplicate step id ${st.id}`);
    ids.add(st.id);
  }
  for (const st of plan.steps) {
    const where = `step ${st.id}`;
    if (!STREAMS.some((x) => x.id === st.stream)) errors.push(`${where}: unknown stream ${st.stream}`);
    if (!STATUSES.includes(st.status)) errors.push(`${where}: unknown status ${st.status}`);
    if (!(st.weeks >= 0)) errors.push(`${where}: weeks must be >= 0`);
    if (!st.title || !st.detail || !st.who) errors.push(`${where}: title, detail and who are required`);
    if (!iso.test(st.checked)) errors.push(`${where}: checked must be YYYY-MM-DD`);
    if (st.status === 'done' && !st.done) errors.push(`${where}: a done step needs its completion date`);
    if (!st.sources?.length || st.sources.some((x) => !/^https:\/\//.test(x.url) || !x.title)) errors.push(`${where}: every step needs sources with a title and an https URL`);
    for (const raw of st.after) if (!ids.has(depOf(raw).id)) errors.push(`${where}: unknown predecessor ${depOf(raw).id}`);
    for (const n of [...(st.needs ?? []), ...(st.variants ?? []).flatMap((v) => v.needs)]) if (!NEEDS.includes(n)) errors.push(`${where}: unknown need ${n}`);
    if (st.commitAt && st.commitAt !== 'start' && st.commitAt !== 'end') errors.push(`${where}: commitAt must be start or end`);
  }
  for (const x of plan.signups) {
    if (!ids.has(x.step)) errors.push(`signup ${x.id}: unknown step ${x.step}`);
    if (!(x.signed >= 0)) errors.push(`signup ${x.id}: signed must be >= 0`);
  }
  // Cycles over the full graph, regardless of which steps a plan needs.
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    for (const raw of plan.steps.find((x) => x.id === id)?.after ?? []) if (ids.has(depOf(raw).id) && !visit(depOf(raw).id)) return false;
    state.set(id, 2);
    return true;
  };
  for (const st of plan.steps) if (!visit(st.id)) { errors.push(`dependency cycle through ${st.id}`); break; }
  return errors;
}
