import { useRef, useState } from 'react';
import { useApp } from '../state';
import { Card, Note, Ext } from '../components';
import { PARAMS, getParam, setParam, type ParamGroup } from '../../engine/params';
import { defaultScenario } from '../../engine/defaults';
import type { GpuModel, Scenario } from '../../engine/types';
import { num } from '../format';

const GROUPS: ParamGroup[] = ['Solar', 'Battery', 'Grid & market', 'Compute', 'Agriculture', 'Homes', 'Site & flood', 'Finance'];

function ParamInput({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input className="param-input" type="number" value={text ?? String(value)} min={min} max={max} step={step}
      onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v); }}
      onBlur={() => setText(null)} />
  );
}

export function AssumptionsTab() {
  const { scenario, update, setScenario } = useApp();
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const defaults = defaultScenario();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clovernook-plan-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    try {
      const s = JSON.parse(await f.text()) as Scenario;
      if (!s.pv || !s.compute || !s.finance) throw new Error('Not a plan file');
      setScenario({ ...defaultScenario(), ...s, name: s.name || 'Imported plan' });
    } catch (e) { alert(`Couldn't read that file: ${e instanceof Error ? e.message : e}`); }
  };

  const q = filter.trim().toLowerCase();
  return (
    <div className="stack">
      <Card title="Assumptions" subtitle="Every input the model uses, with its source. Ranges (low-high) drive the Risk tab. Changes apply instantly and are saved in the share link."
        actions={<div className="btn-row">
          <input className="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter assumptions" />
          <button type="button" className="btn small" onClick={exportJson}>Download plan (JSON)</button>
          <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Load plan</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>}>
        <Note tone="info">Prices are in Australian dollars (2026) unless marked US$. Hardware priced in US$ converts at the A$/US$ rate under Finance.</Note>
      </Card>
      {GROUPS.map((g) => {
        const items = PARAMS.filter((p) => p.group === g && (!q || p.label.toLowerCase().includes(q) || (p.note ?? '').toLowerCase().includes(q)));
        if (!items.length) return null;
        return (
          <Card key={g} title={g}>
            <table className="table params">
              <thead><tr><th>Assumption</th><th>Value</th><th>Unit</th><th>Range</th><th>Source / note</th></tr></thead>
              <tbody>
                {items.map((p) => {
                  const v = getParam(scenario, p.path);
                  const d = getParam(defaults, p.path.replace('$model', scenario.compute.model));
                  const rel = p.path.includes('$model');
                  return (
                    <tr key={p.path} className={Math.abs(v - d) > 1e-9 ? 'changed' : ''}>
                      <td>{p.label}{rel ? ` (${scenario.compute.model})` : ''}</td>
                      <td><ParamInput value={v} min={p.min} max={p.max} step={p.step} onChange={(x) => update((s) => setParam(s, p.path, x))} /></td>
                      <td className="muted small">{p.unit}</td>
                      <td className="muted small">{p.low !== undefined ? (rel ? `${Math.round(p.low * 100)}%-${Math.round((p.high ?? 1) * 100)}% of base` : `${num(p.low, p.step < 1 ? 2 : 0)}-${num(p.high ?? 0, p.step < 1 ? 2 : 0)}`) : ''}</td>
                      <td className="small">{p.source && <Ext href={p.source.url}>{p.source.title}</Ext>}{p.source?.date ? ` (${p.source.date})` : ''}{p.note && <div className="muted">{p.note}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })}
      <Card title="GPU catalogue" subtitle="Achievable rental prices for a small Australian host sit between October 2026 spot and reserved rates. Server prices are for complete 8-GPU systems.">
        <table className="table params">
          <thead><tr><th>GPU</th><th>Rental US$/GPU-hr</th><th>Server US$</th><th>Server kW</th><th>Memory</th></tr></thead>
          <tbody>
            {(Object.keys(scenario.compute.catalog) as GpuModel[]).map((m) => {
              const g = scenario.compute.catalog[m];
              return (
                <tr key={m}>
                  <td><b>{m}</b> <span className="muted small">{g.label}</span></td>
                  <td><ParamInput value={g.priceUsdPerGpuHr} min={0.1} max={30} step={0.05} onChange={(v) => update((s) => { s.compute.catalog[m].priceUsdPerGpuHr = v; })} /></td>
                  <td><ParamInput value={g.serverCapexUsd} min={10000} max={2000000} step={5000} onChange={(v) => update((s) => { s.compute.catalog[m].serverCapexUsd = v; })} /></td>
                  <td><ParamInput value={g.serverKw} min={1} max={40} step={0.1} onChange={(v) => update((s) => { s.compute.catalog[m].serverKw = v; })} /></td>
                  <td className="muted">{g.memoryGb} GB</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
