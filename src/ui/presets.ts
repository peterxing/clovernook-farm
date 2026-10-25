import type { Scenario } from '../engine/types';
import { defaultScenario } from '../engine/defaults';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  build: () => Scenario;
}

/** Output of the optimiser with every element of the brief required (see Optimise tab), rounded for robustness. */
function recommended(): Scenario {
  const s = defaultScenario();
  s.name = 'Recommended: full brief, optimised';
  s.pv.type = 'tracker'; s.pv.fillPct = 20; s.pv.gcr = 0.35; s.pv.dcAcRatio = 1.1;
  s.grid.importLimitKw = 1000; s.grid.exportLimitKw = 1000;
  s.bess.powerKw = 1500; s.bess.hours = 1;
  s.compute.model = 'B300'; s.compute.servers = 16;
  s.homes.cabins = 6; s.homes.grannyFlat = false;
  s.ag.underArray = 'cattle'; s.ag.openLand = 'cattle'; s.ag.greenhouseM2 = 2000; s.ag.hives = 40;
  return s;
}

function agrivoltaic(): Scenario {
  const s = recommended();
  s.name = 'Agrivoltaic farm & homes (no GPUs)';
  s.compute.servers = 0;
  s.pv.type = 'fixed'; s.pv.fillPct = 40; s.pv.gcr = 0.35; s.pv.dcAcRatio = 1.3;
  s.grid.importLimitKw = 250; s.grid.exportLimitKw = 2000;
  s.bess.powerKw = 1000; s.bess.hours = 2;
  s.ag.underArray = 'sheep'; s.ag.greenhouseM2 = 500;
  return s;
}

function solarExport(): Scenario {
  const s = recommended();
  s.name = 'Maximum solar (export-led)';
  s.pv.type = 'fixed'; s.pv.fillPct = 100; s.pv.gcr = 0.4; s.pv.dcAcRatio = 1.3; s.pv.keepTrees = false;
  s.grid.importLimitKw = 500; s.grid.exportLimitKw = 5000;
  s.bess.powerKw = 2000; s.bess.hours = 2;
  s.compute.servers = 4; s.compute.model = 'RTXPRO6000';
  s.ag.underArray = 'sheep';
  return s;
}

function computeHeavy(): Scenario {
  const s = recommended();
  s.name = 'Compute campus (GPU-heavy)';
  s.compute.model = 'B200'; s.compute.servers = 40;
  s.grid.importLimitKw = 1000; s.grid.exportLimitKw = 1000;
  s.bess.powerKw = 1000; s.bess.hours = 2;
  s.pv.fillPct = 40;
  s.finance.capexBudget = 0;
  return s;
}

function baseCase(): Scenario {
  return defaultScenario();
}

export const PRESETS: Preset[] = [
  { id: 'recommended', name: 'Recommended plan', blurb: 'Optimised for NPV with every element of the brief: solar, battery, GPUs, grazing and homes.', build: recommended },
  { id: 'agrivoltaic', name: 'Agrivoltaic farm & homes', blurb: 'No compute: solar over grazing, a battery, a greenhouse and rentals.', build: agrivoltaic },
  { id: 'solar', name: 'Maximum solar', blurb: 'Fills the paddock with panels and exports to the grid.', build: solarExport },
  { id: 'compute', name: 'Compute campus', blurb: '40 B200 servers on a 1 MVA connection, with the farm around it.', build: computeHeavy },
  { id: 'base', name: 'Starting assumptions', blurb: 'The unoptimised starting point used before running the optimiser.', build: baseCase },
];

type Flat = Record<string, unknown>;
function flatten(o: unknown, prefix = '', out: Flat = {}): Flat {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = o;
  return out;
}
function setDeep(o: Record<string, unknown>, path: string, v: unknown) {
  const keys = path.split('.');
  let cur = o;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) return;
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  if (keys[keys.length - 1] in cur) cur[keys[keys.length - 1]] = v;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Encodes only the differences from the starting assumptions so links stay short. */
export function encodeScenario(s: Scenario): string {
  const base = flatten(defaultScenario());
  const cur = flatten(s);
  const diff: Flat = {};
  for (const [k, v] of Object.entries(cur)) if (base[k] !== v) diff[k] = v;
  return b64(JSON.stringify(diff));
}

export function decodeScenario(code: string): Scenario | null {
  try {
    const diff = JSON.parse(unb64(code)) as Flat;
    const s = defaultScenario() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(diff)) setDeep(s, k, v);
    return s as unknown as Scenario;
  } catch {
    return null;
  }
}

export function scenarioFromHash(): Scenario | null {
  const m = location.hash.match(/[#&]s=([^&]+)/);
  if (m) return decodeScenario(m[1]);
  const p = location.hash.match(/[#&]preset=([a-z]+)/);
  if (p) return PRESETS.find((x) => x.id === p[1])?.build() ?? null;
  return null;
}

export function tabFromHash(): string | null {
  const m = location.hash.match(/[#&]tab=([a-z]+)/);
  return m ? m[1] : null;
}
