import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Grid, Kpi, Note, Progress, Pill } from '../components';
import { EChart, PALETTE } from '../EChart';
import { runJob } from '../jobs';
import type { TornadoBar, MonteCarloResult } from '../../engine/risk';
import type { Scenario } from '../../engine/types';
import { aud, num, pct } from '../format';
import { fpl } from '../../engine/model';
import { FLOOD_CURVE } from '../../engine/solar';

export function RiskTab() {
  const { scenario, result: r } = useApp();
  const [tor, setTor] = useState<{ baseNpv: number; bars: TornadoBar[]; for: Scenario } | null>(null);
  const [mc, setMc] = useState<(MonteCarloResult & { for: Scenario }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState(0);

  const run = useCallback(async (s: Scenario) => {
    setBusy('Sensitivity'); setProg(0);
    const t = await runJob<{ baseNpv: number; bars: TornadoBar[] }>('tornado', { scenario: s }, setProg);
    setTor({ ...t, for: s });
    setBusy('Monte Carlo'); setProg(0);
    const m = await runJob<MonteCarloResult>('montecarlo', { scenario: s, runs: 400 }, setProg);
    setMc({ ...m, for: s });
    setBusy(null);
  }, []);

  useEffect(() => { if (!tor) run(scenario); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stale = tor && tor.for !== scenario;

  const tornadoChart = useMemo(() => {
    if (!tor) return null;
    const bars = tor.bars.slice(0, 14);
    const fmt = (b: TornadoBar, v: number) => (Math.abs(v) >= 1000 ? num(v) : Math.abs(v) < 10 ? v.toFixed(2) : num(v, 1)) + (b.unit ? ` ${b.unit}` : '');
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { dataIndex: number }[]) => { const b = bars[p[0].dataIndex]; return `<b>${b.label}</b><br/>${fmt(b, b.lowValue)} → NPV ${aud(b.npvLow)}<br/>${fmt(b, b.highValue)} → NPV ${aud(b.npvHigh)}`; } },
      legend: { top: 0, data: ['Low end of range', 'High end of range'] },
      grid: { left: 300, right: 40, top: 34, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => aud(v) } },
      yAxis: { type: 'category', data: bars.map((b) => b.label), inverse: true, axisLabel: { width: 290, overflow: 'truncate' } },
      series: [
        { name: 'Low end of range', type: 'bar', stack: 't', data: bars.map((b) => Math.round(b.npvLow - tor.baseNpv)), itemStyle: { color: '#93c5fd' } },
        { name: 'High end of range', type: 'bar', stack: 't', data: bars.map((b) => Math.round(b.npvHigh - tor.baseNpv)), itemStyle: { color: '#1d4ed8' } },
      ],
    };
  }, [tor]);

  const histogram = useMemo(() => {
    if (!mc) return null;
    const v = mc.npv, lo = Math.min(...v), hi = Math.max(...v), n = 30, w = (hi - lo) / n || 1;
    const bins = Array(n).fill(0);
    for (const x of v) bins[Math.min(n - 1, Math.floor((x - lo) / w))]++;
    return {
      tooltip: { trigger: 'axis', formatter: (p: { dataIndex: number; value: number }[]) => `NPV ${aud(lo + p[0].dataIndex * w)} to ${aud(lo + (p[0].dataIndex + 1) * w)}<br/><b>${p[0].value}</b> runs` },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: bins.map((_, i) => aud(lo + (i + 0.5) * w)), axisLabel: { interval: 5 } },
      yAxis: { type: 'value', name: 'Runs' },
      series: [{ type: 'bar', barCategoryGap: '5%', data: bins.map((c, i) => ({ value: c, itemStyle: { color: lo + (i + 0.5) * w >= 0 ? PALETTE.pos : PALETTE.neg } })) }],
    };
  }, [mc]);

  const level = fpl(scenario);
  return (
    <div className="stack">
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => run(scenario)}>{busy ? `Running ${busy}…` : stale ? 'Plan changed: re-run risk analysis' : 'Re-run risk analysis'}</button>
        {busy && <Progress value={prog} label={busy} />}
      </div>
      {mc && (
        <Grid cols={4}>
          <Kpi label="Chance NPV is positive" value={pct(mc.probPositive, 0)} sub={`${mc.runs} runs varying every assumption at once`} tone={mc.probPositive >= 0.5 ? 'good' : 'warn'} />
          <Kpi label="P10 NPV (downside)" value={aud(mc.p10)} tone="bad" />
          <Kpi label="P50 NPV (median)" value={aud(mc.p50)} />
          <Kpi label="P90 NPV (upside)" value={aud(mc.p90)} tone="good" />
        </Grid>
      )}
      <Grid cols={2}>
        <Card title="What moves the answer most" subtitle={tor ? `NPV swing from each assumption's low to high value, around ${aud(tor.baseNpv)}.` : 'Running…'}>
          {tornadoChart ? <EChart option={tornadoChart} height={480} /> : <p className="muted">Calculating…</p>}
        </Card>
        <Card title="Spread of outcomes" subtitle="Monte Carlo: each assumption with a range is drawn from a triangular distribution (low, base, high).">
          {histogram ? <EChart option={histogram} height={420} /> : <p className="muted">Calculating…</p>}
          <p className="small muted">Ranges are set on the Assumptions tab. GPU rental price and its yearly decline usually dominate, so test the plan against GPU prices you could actually contract.</p>
        </Card>
      </Grid>
      <Card title="Flood exposure" subtitle={`Design flood levels at Cundletown (Manning River FRMS&P 2020): ${FLOOD_CURVE.slice(0, 7).map(([l, a]) => `${a * 100}% AEP ${l} m`).join(' · ')} · PMF 7.3 m AHD. Flood planning level ${level.toFixed(1)} m AHD.`}>
        <table className="table">
          <thead><tr><th>Asset</th><th className="num">Critical level</th><th className="num">Chance per year</th><th className="num">Exposed value</th><th className="num">Expected loss / yr</th><th>Status</th></tr></thead>
          <tbody>
            {r.flood.map((f) => (
              <tr key={f.label}>
                <td>{f.label}</td>
                <td className="num">{f.levelM.toFixed(2)} m AHD</td>
                <td className="num">{f.aep >= 0.01 ? pct(f.aep, 0) : `1 in ${num(1 / f.aep)}`}</td>
                <td className="num">{aud(f.value)}</td>
                <td className="num">{aud(f.expectedLoss)}</td>
                <td>{f.safe ? <Pill tone="good">{f.label.startsWith('Livestock') ? 'refuge above FPL' : 'at or above FPL'}</Pill> : <Pill tone="bad">below FPL</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note tone="warn">Site flood levels are taken from the nearest published reporting location and assume the lot behaves like the surrounding Cundletown floodplain. Get a flood certificate from MidCoast Council and a site flood study before committing; any fill must not reduce floodplain storage.</Note>
      </Card>
      <Card title="Other key risks">
        <table className="table">
          <thead><tr><th>Risk</th><th>Why it matters here</th><th>Mitigation</th></tr></thead>
          <tbody>
            <tr><td>GPU market</td><td>Rental prices can fall fast once supply catches up; small buyers may wait for Blackwell allocation.</td><td>Sign reserved contracts before buying; start with fewer servers; choose GPUs with broad demand (inference).</td></tr>
            <tr><td>Grid connection</td><td>Rural 11 kV feeders have limited hosting capacity; studies take 6-18 months.</td><td>Lodge an Essential Energy connection enquiry early; size the battery to firm the load if import capacity is capped.</td></tr>
            <tr><td>Planning</td><td>A data centre on RU1 floodplain land is novel; cabins add people to a flood-prone area.</td><td>Pre-DA meeting with MidCoast Council; frame compute as ancillary to the energy facility; flood emergency response plan.</td></tr>
            <tr><td>Aviation glare</td><td>2.3 km north of Taree Airport.</td><td>Glint and glare assessment; anti-reflective modules; trackers stow away from approach paths.</td></tr>
            <tr><td>Acid sulfate soils</td><td>Class 2a/2b soils under almost the whole paddock.</td><td>Driven or screw piles, minimal trenching, ASS management plan, no new drainage.</td></tr>
            <tr><td>Bush fire</td><td>Mapped grassland (category 3) around batteries and GPUs.</td><td>Asset protection zones, grazed or mown fuel, fire-safety separation for battery containers and early consultation with Fire and Rescue NSW.</td></tr>
            <tr><td>Noise</td><td>GPU cooling fans near the homestead and neighbours.</td><td>Liquid cooling with low-speed dry coolers, acoustic screens, platform 100 m+ from dwellings.</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
