import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Progress, Select, Toggle } from '../components';
import { EChart } from '../EChart';
import { runJob } from '../jobs';
import { defaultOptimizeOptions, type Evaluated, type OptimizeOptions } from '../../engine/optimize';
import type { GpuModel, Objective, PvType, Scenario } from '../../engine/types';
import { evaluate } from '../../engine/model';
import { getContext } from '../data';
import { aud, kwp, num, pct, PV_LABEL, USE_LABEL } from '../format';

interface OptOut { best: Scenario; evaluated: Evaluated[]; top: { scenario: Scenario; summary: Evaluated }[]; evaluations: number; ms: number }

const GPU_COLORS: Record<string, string> = { B300: '#7f1d1d', B200: '#dc2626', H200: '#f97316', RTXPRO6000: '#eab308', L40S: '#84cc16' };

function describe(s: Scenario) {
  const g = s.compute.catalog[s.compute.model].gpusPerServer * s.compute.servers;
  return [
    ['Solar', `${PV_LABEL[s.pv.type]}, ${s.pv.fillPct}% of zone, GCR ${s.pv.gcr}${s.pv.type === 'fixed' ? `, ${s.pv.tiltDeg}° tilt` : ''}, DC/AC ${s.pv.dcAcRatio}`],
    ['Grid', `${num(s.grid.importLimitKw)} kW import / ${num(s.grid.exportLimitKw)} kW export`],
    ['Battery', s.bess.powerKw > 0 ? `${num(s.bess.powerKw)} kW × ${s.bess.hours} h` : 'none'],
    ['Compute', s.compute.servers > 0 ? `${s.compute.servers} × ${s.compute.model} (${g} GPUs)` : 'none'],
    ['Homes', `${s.homes.cabins} cabins${s.homes.grannyFlat ? ' + granny flat' : ''}`],
    ['Farm', `${USE_LABEL[s.ag.underArray]} under panels, ${USE_LABEL[s.ag.openLand].toLowerCase()} on open paddocks, ${num(s.ag.greenhouseM2)} m² greenhouse, ${s.ag.hives} hives`],
  ];
}

export function OptimiseTab() {
  const { scenario, result, setScenario } = useApp();
  const [o, setO] = useState<OptimizeOptions>(defaultOptimizeOptions);
  const [keepAll, setKeepAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState<OptOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setProgress(0);
    const options: OptimizeOptions = keepAll ? o : { ...o, minPvKwdc: 0, minBessKwh: 0, minServers: 0, minNewDwellings: 0 };
    try {
      const res = await runJob<OptOut>('optimize', { scenario, options }, (p) => setProgress(p));
      setOut(res);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const bestR = useMemo(() => (out ? evaluate(out.best, getContext()) : null), [out]);

  const scatter = useMemo(() => {
    if (!out) return null;
    const pts = out.evaluated.filter((e) => Number.isFinite(e.npv));
    const byGpu: Record<string, [number, number, number, string][]> = {};
    for (const e of pts) (byGpu[e.servers > 0 ? e.gpu : 'No GPUs'] ??= []).push([e.capex, e.npv, e.feasible ? 1 : 0, e.key]);
    return {
      tooltip: { trigger: 'item', formatter: (p: { seriesName: string; value: [number, number, number] }) => `${p.seriesName}${p.value[2] ? '' : ' (breaks a constraint)'}<br/>Capex ${aud(p.value[0])}<br/>NPV <b>${aud(p.value[1])}</b>` },
      legend: { top: 0 },
      grid: { left: 80, right: 20, top: 40, bottom: 50 },
      xAxis: { type: 'value', name: 'Capital cost', nameLocation: 'middle', nameGap: 30, axisLabel: { formatter: (v: number) => aud(v) } },
      yAxis: { type: 'value', name: 'NPV', axisLabel: { formatter: (v: number) => aud(v) } },
      series: Object.entries(byGpu).map(([k, data]) => ({ name: k, type: 'scatter', data, symbolSize: (v: number[]) => (v[2] ? 7 : 4), itemStyle: { color: GPU_COLORS[k] ?? '#64748b', opacity: 0.7 } })),
    };
  }, [out]);

  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="stack">
      <Card title="Search for the highest-yield plan" subtitle="The optimiser runs the full hourly model for every candidate and walks each decision (array size and type, battery, grid limits, GPU type and count, cabins, farm enterprises) until no single change improves the objective, starting from several different designs.">
        <Grid cols={3}>
          <div>
            <Select<Objective> label="Maximise" value={o.objective} onChange={(v) => setO({ ...o, objective: v })} options={[
              { value: 'npv', label: 'Net present value (A$)' }, { value: 'irr', label: 'Internal rate of return' }, { value: 'profitIndex', label: 'NPV per dollar invested' }, { value: 'ebitdaPerHa', label: 'Year-1 EBITDA per hectare' }]} />
            <Field label="Capital budget (incl. land if bought)" value={o.capexBudget / 1e6} min={0} max={80} step={0.5} unit="A$M" onChange={(v) => setO({ ...o, capexBudget: v * 1e6 })} hint="0 means no limit." />
            <Field label="Keep at least this share of the lot farmed" value={o.minAgSharePct} min={0} max={95} step={5} unit="%" onChange={(v) => setO({ ...o, minAgSharePct: v })} />
          </div>
          <div>
            <Field label="Largest import connection" value={o.maxImportKw} min={100} max={5000} step={50} unit="kW" onChange={(v) => setO({ ...o, maxImportKw: v })} hint="What the local 11 kV feeder can likely take without major works." />
            <Field label="Largest export connection" value={o.maxExportKw} min={100} max={5000} step={100} unit="kW" onChange={(v) => setO({ ...o, maxExportKw: v })} />
            <Field label="Most farm-stay cabins" value={o.maxCabins} min={0} max={12} step={1} onChange={(v) => setO({ ...o, maxCabins: v })} />
            <Field label="Most GPU servers" value={o.maxServers} min={0} max={96} step={1} onChange={(v) => setO({ ...o, maxServers: v })} />
          </div>
          <div>
            <Toggle label="Keep every element of the brief" checked={keepAll} onChange={setKeepAll} hint="At least 1 MWp solar, 1 MWh battery, 2 GPU servers and 2 new homes." />
            <Toggle label="Flood-safe equipment and modules" checked={o.floodSafe} onChange={(v) => setO({ ...o, floodSafe: v })} hint="Modules and the equipment platform at or above the flood planning level." />
            <div className="field"><span className="field-label">Mounting types to consider</span>
              <div className="chips">{(['fixed', 'tracker', 'vertical'] as PvType[]).map((t) => <button key={t} type="button" className={`chip ${o.allowedPv.includes(t) ? 'on' : ''}`} onClick={() => setO({ ...o, allowedPv: toggleIn(o.allowedPv, t).length ? toggleIn(o.allowedPv, t) : o.allowedPv })}>{t}</button>)}</div>
            </div>
            <div className="field"><span className="field-label">GPUs to consider</span>
              <div className="chips">{(['B300', 'B200', 'H200', 'RTXPRO6000', 'L40S'] as GpuModel[]).map((g) => <button key={g} type="button" className={`chip ${o.allowedGpu.includes(g) ? 'on' : ''}`} onClick={() => setO({ ...o, allowedGpu: toggleIn(o.allowedGpu, g).length ? toggleIn(o.allowedGpu, g) : o.allowedGpu })}>{g}</button>)}</div>
            </div>
          </div>
        </Grid>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={run} disabled={busy}>{busy ? 'Optimising…' : 'Run optimiser'}</button>
          {busy && <Progress value={progress} label={`${Math.round(progress * 100)}%`} />}
        </div>
        {error && <Note tone="bad">{error}</Note>}
      </Card>

      {out && bestR && (
        <>
          <Grid cols={4}>
            <Kpi label="Best NPV" value={aud(bestR.npv)} sub={`vs ${aud(result.npv)} for the current plan`} tone={bestR.npv >= result.npv ? 'good' : 'warn'} />
            <Kpi label="IRR" value={pct(bestR.irr)} sub={`vs ${pct(result.irr)}`} />
            <Kpi label="Capital cost" value={aud(bestR.capexTotal)} sub={`vs ${aud(result.capexTotal)}`} />
            <Kpi label="Designs evaluated" value={num(out.evaluations)} sub={`full-year simulations in ${(out.ms / 1000).toFixed(1)} s`} />
          </Grid>
          <Grid cols={2}>
            <Card title="Best plan found" actions={<button type="button" className="btn primary small" onClick={() => setScenario({ ...out.best, name: 'Optimised' })}>Use this plan</button>}>
              <table className="table compact">
                <thead><tr><th /><th>Optimised</th><th>Current</th></tr></thead>
                <tbody>
                  {describe(out.best).map(([k, v], i) => { const cur = describe(scenario)[i][1]; return <tr key={k} className={cur !== v ? 'changed' : ''}><th>{k}</th><td>{v}</td><td className="muted">{cur}</td></tr>; })}
                  <tr><th>Solar size</th><td>{kwp(bestR.layout.kwdc)}</td><td className="muted">{kwp(result.layout.kwdc)}</td></tr>
                </tbody>
              </table>
            </Card>
            <Card title="Every design tried" subtitle="Larger dots meet all constraints. Up and to the left is better.">
              {scatter && <EChart option={scatter} height={340} />}
            </Card>
          </Grid>
          <Card title="Runner-up plans">
            <table className="table compact">
              <thead><tr><th>#</th><th>Solar</th><th>Battery</th><th>Compute</th><th>Cabins</th><th className="num">Capex</th><th className="num">NPV</th><th className="num">IRR</th><th /></tr></thead>
              <tbody>
                {out.top.map((t, i) => (
                  <tr key={t.summary.key}>
                    <td>{i + 1}</td>
                    <td>{t.summary.pvType}, {kwp(t.summary.kwdc)}</td>
                    <td>{(t.summary.bessKwh / 1000).toFixed(1)} MWh</td>
                    <td>{t.summary.servers} × {t.summary.gpu}</td>
                    <td>{t.summary.cabins}</td>
                    <td className="num">{aud(t.summary.capex)}</td>
                    <td className="num">{aud(t.summary.npv)}</td>
                    <td className="num">{pct(t.summary.irr)}</td>
                    <td><button type="button" className="btn small" onClick={() => setScenario({ ...t.scenario, name: `Optimiser option ${i + 1}` })}>Use</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {!out && <Note tone="info">The current plan was produced by this optimiser with the default settings (NPV objective, A$25M budget, 1.5 MW import cap, every element kept). Change the settings and run it to see how the best design shifts.</Note>}
    </div>
  );
}
