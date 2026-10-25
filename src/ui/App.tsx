import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Scenario } from '../engine/types';
import { evaluate } from '../engine/model';
import { getContext, site } from './data';
import { AppCtx } from './state';
import { PRESETS, encodeScenario, scenarioFromHash, tabFromHash } from './presets';
import { aud, kwp, pct } from './format';
import { Overview } from './tabs/Overview';
import { SiteTab } from './tabs/SiteTab';
import { EnergyTab } from './tabs/EnergyTab';
import { ComputeTab } from './tabs/ComputeTab';
import { FarmTab } from './tabs/FarmTab';
import { HomesTab } from './tabs/HomesTab';
import { FinanceTab } from './tabs/FinanceTab';
import { OptimiseTab } from './tabs/OptimiseTab';
import { RiskTab } from './tabs/RiskTab';
import { ApprovalsTab } from './tabs/ApprovalsTab';
import { AssumptionsTab } from './tabs/AssumptionsTab';
import { AboutTab } from './tabs/AboutTab';
import { RoboticsTab } from './tabs/RoboticsTab';
import { MarketsTab } from './tabs/MarketsTab';

const TABS = [
  { id: 'overview', label: 'Overview', C: Overview },
  { id: 'site', label: 'Site & layout', C: SiteTab },
  { id: 'energy', label: 'Solar & battery', C: EnergyTab },
  { id: 'compute', label: 'GPU compute', C: ComputeTab },
  { id: 'farm', label: 'Farm', C: FarmTab },
  { id: 'homes', label: 'Homes', C: HomesTab },
  { id: 'robots', label: 'Robots', C: RoboticsTab },
  { id: 'finance', label: 'Finance', C: FinanceTab },
  { id: 'optimise', label: 'Optimise', C: OptimiseTab },
  { id: 'risk', label: 'Risk', C: RiskTab },
  { id: 'markets', label: 'Markets', C: MarketsTab },
  { id: 'approvals', label: 'Approvals', C: ApprovalsTab },
  { id: 'assumptions', label: 'Assumptions', C: AssumptionsTab },
  { id: 'about', label: 'About', C: AboutTab },
] as const;

function initialScenario(): Scenario {
  return scenarioFromHash() ?? PRESETS[0].build();
}

export function App() {
  const [scenario, setScenarioRaw] = useState<Scenario>(initialScenario);
  const [tab, setTab] = useState<string>(() => tabFromHash() ?? 'overview');
  const [presetId, setPresetId] = useState<string>(() => {
    const p = location.hash.match(/[#&]preset=([a-z]+)/);
    if (p && PRESETS.some((x) => x.id === p[1])) return p[1];
    return /[#&]s=/.test(location.hash) ? 'custom' : PRESETS[0].id;
  });
  const [copied, setCopied] = useState(false);
  const deferred = useDeferredValue(scenario);
  const ctx = getContext();
  const result = useMemo(() => evaluate(deferred, ctx, { series: true }), [deferred, ctx]);

  const setScenario = useCallback((s: Scenario) => { setScenarioRaw(s); }, []);
  const update = useCallback((mutate: (s: Scenario) => void) => {
    setScenarioRaw((prev) => { const next = structuredClone(prev); mutate(next); if (!next.name.endsWith('(edited)') && next.name !== 'Custom') next.name = `${next.name} (edited)`; return next; });
    setPresetId('custom');
  }, []);
  const go = useCallback((t: string) => { setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      if (t) setTab(t);
      const sc = scenarioFromHash();
      if (sc) {
        setScenarioRaw(sc);
        const p = location.hash.match(/[#&]preset=([a-z]+)/);
        setPresetId(p ? p[1] : 'custom');
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      const preset = PRESETS.find((p) => p.id === presetId);
      const hash = preset ? `#tab=${tab}&preset=${preset.id}` : `#tab=${tab}&s=${encodeScenario(scenario)}`;
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }, 250);
    return () => clearTimeout(id);
  }, [scenario, tab, presetId]);

  const share = async () => {
    const url = `${location.origin}${location.pathname}#tab=${tab}&s=${encodeScenario(scenario)}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { prompt('Copy this link', url); }
  };

  const Active = TABS.find((t) => t.id === tab)?.C ?? Overview;
  const r = result;
  const stale = deferred !== scenario;

  return (
    <AppCtx.Provider value={{ scenario, result, setScenario, update, go }}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="34" height="34"><rect width="64" height="64" rx="14" fill="#143d2b" /><path d="M10 46h44" stroke="#84cc16" strokeWidth="5" strokeLinecap="round" /><path d="M15 38l8-15h18l8 15z" fill="#fbbf24" /><path d="M23 23l-8 15M32 23v15M41 23l8 15" stroke="#143d2b" strokeWidth="1.6" /><circle cx="47" cy="14" r="6" fill="#fde68a" /></svg>
          </div>
          <div>
            <h1>Clovernook Farm</h1>
            <p>{site.address} · {site.lotPlan} · {site.areaHa.toFixed(1)} ha</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="preset">
            <span>Plan</span>
            <select value={presetId} onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) { setScenarioRaw(p.build()); setPresetId(p.id); } }}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {presetId === 'custom' && <option value="custom">Custom: {scenario.name}</option>}
            </select>
          </label>
          <button type="button" className="btn" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>
        </div>
      </header>
      <div className={`summary ${stale ? 'stale' : ''}`}>
        <span><b>{aud(r.npv)}</b> NPV</span>
        <span><b>{pct(r.irr)}</b> IRR</span>
        <span><b>{aud(r.capexTotal)}</b> capex</span>
        <span><b>{aud(r.year1.ebitda)}</b> EBITDA yr 1</span>
        <span className="sep" />
        <span><b>{kwp(r.layout.kwdc)}</b> solar</span>
        <span><b>{(r.bessKwh / 1000).toFixed(1)} MWh</b> battery</span>
        <span>{scenario.compute.servers > 0 ? <><b>{scenario.compute.servers * scenario.compute.catalog[scenario.compute.model].gpusPerServer}</b> {scenario.compute.model} GPUs</> : <b>No GPUs</b>}</span>
        <span><b>{Math.round(r.ag.dse)}</b> DSE stock</span>
        <span><b>{r.homes.dwellings}</b> homes</span>
        {scenario.robots.fleet > 0 && <span><b>{scenario.robots.fleet}</b> humanoid{scenario.robots.fleet === 1 ? '' : 's'} from {scenario.robots.deployYear}</span>}
      </div>
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={t.id === tab ? 'active' : ''} aria-current={t.id === tab ? 'page' : undefined} onClick={() => go(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main className="content">
        <Active />
      </main>
      <footer className="footer">
        <p>
          Concept study only, not financial, engineering or planning advice. Site data © Spatial Services NSW and NSW Department of Planning (CC BY 4.0);
          flood levels from the Manning River Floodplain Risk Management Study and Plan (MidCoast Council, CC BY 4.0); weather from PVGIS (EC JRC); prices from AEMO.
          Not affiliated with the owner, vendor or agent. <a href="https://github.com/peterxing/clovernook-farm" target="_blank" rel="noreferrer">Source on GitHub</a>.
        </p>
      </footer>
    </AppCtx.Provider>
  );
}
