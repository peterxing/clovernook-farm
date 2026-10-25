import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Grid, Note, Pill, Ext } from '../components';
import { EChart, PALETTE } from '../EChart';
import { aud, num, pct } from '../format';
import { CURATED_MARKET, LIVE_MARKET, marketApplied } from '../../engine/defaults';
import { RECOMMENDED } from '../presets';
import historyJson from '../../data/market-history.json';
import type { GpuModel } from '../../engine/types';

interface Snap {
  date: string;
  usdAud: number | null;
  gpuAsk: Partial<Record<GpuModel, number>>;
  gpuPrice: Partial<Record<GpuModel, number>>;
  nem30: number | null;
  lgc: number | null;
  moduleUsdPerW: number | null;
  eyci: number | null;
  ntli: number | null;
  fpi: number | null;
  robotUsd: number | null;
  unitreeH2: number | null;
  recNpv: number | null;
  recIrr: number | null;
  recCapex: number | null;
  recRobots: number | null;
}
const HISTORY = historyJson as unknown as Snap[];

function spark(values: (number | null)[], color: string) {
  return {
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: { type: 'category', show: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { trigger: 'axis', formatter: (p: { dataIndex: number; value: number }[]) => `${HISTORY[p[0].dataIndex]?.date ?? ''}: ${p[0].value}` },
    series: [{ type: 'line', data: values, symbol: values.length < 3 ? 'circle' : 'none', smooth: true, lineStyle: { color, width: 2 }, itemStyle: { color }, areaStyle: { color, opacity: 0.08 } }],
  };
}

function Indicator({ label, value, sub, series, color, status }: { label: string; value: string; sub?: string; series: (number | null)[]; color: string; status?: { ok: boolean; stale?: boolean; error?: string } }) {
  const opt = useMemo(() => spark(series, color), [series, color]);
  return (
    <div className="kpi indicator">
      <div className="kpi-label">{label} {status && (status.ok && !status.stale ? null : <Pill tone="warn">{status.ok ? 'stale' : 'unavailable'}</Pill>)}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      <EChart option={opt} height={46} />
    </div>
  );
}

const chg = (now?: number | null, before?: number | null) => (now && before ? `${now >= before ? '+' : ''}${(((now - before) / before) * 100).toFixed(1)}%` : '');

export function MarketsTab() {
  const { go } = useApp();
  const L = LIVE_MARKET as typeof LIVE_MARKET & Record<string, any>;
  const applied = useMemo(() => marketApplied(), []);
  const updated = L.updated ? new Date(L.updated).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }) : 'not yet';
  const H = HISTORY;
  const col = <K extends keyof Snap>(k: K) => H.map((h) => (h[k] as number | null) ?? null);
  const gpuCol = (g: GpuModel, kind: 'gpuAsk' | 'gpuPrice') => H.map((h) => h[kind]?.[g] ?? null);
  const feeds: [string, { ok: boolean; stale?: boolean; error?: string; date?: string; source?: string; url?: string } | undefined][] = [
    ['Exchange rate', L.fx], ['GPU marketplace', L.gpu], ['NEM prices', L.nem], ['LGCs', L.lgc], ['Solar modules', L.solarModule], ['Livestock', L.livestock], ['Food prices', L.fpi], ['Humanoid robots', L.humanoids],
  ];

  const planChart = useMemo(() => ({
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 70, right: 60, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: H.map((h) => h.date) },
    yAxis: [{ type: 'value', name: 'NPV', axisLabel: { formatter: (v: number) => aud(v) } }, { type: 'value', name: 'IRR', axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, splitLine: { show: false } }],
    series: [
      { name: 'Recommended plan NPV', type: 'line', data: H.map((h) => h.recNpv), itemStyle: { color: PALETTE.pos }, symbol: 'circle', tooltip: { valueFormatter: (v: number) => aud(v) } },
      { name: 'IRR', type: 'line', yAxisIndex: 1, data: H.map((h) => h.recIrr), itemStyle: { color: '#1d4ed8' }, lineStyle: { type: 'dashed' }, tooltip: { valueFormatter: (v: number) => pct(v) } },
    ],
  }), [H]);

  const gm = L.gpu?.models ?? {};
  const h2 = L.humanoids?.unitree?.find((u: { name: string }) => /^Unitree H2$/i.test(u.name))?.fromUsd;
  const cheapest = (L.humanoids?.unitree ?? []).reduce((m: number, u: { fromUsd: number }) => Math.min(m, u.fromUsd), Infinity);
  const today = H[H.length - 1], before = H.length > 1 ? H[H.length - 2] : undefined;
  const moves: string[] = [];
  if (today && before) {
    const pctMove = (a: number | null | undefined, b: number | null | undefined) => (a && b && Math.abs(a / b - 1) >= 0.005 ? `${a > b ? 'up' : 'down'} ${(Math.abs(a / b - 1) * 100).toFixed(1)}%` : null);
    const add = (label: string, a: number | null | undefined, b: number | null | undefined) => { const m = pctMove(a, b); if (m) moves.push(`${label} ${m}`); };
    if (today.recNpv !== null && before.recNpv !== null && today.recNpv !== before.recNpv) moves.push(`Recommended NPV ${aud(today.recNpv)} (${today.recNpv >= before.recNpv ? '+' : '−'}${aud(Math.abs(today.recNpv - before.recNpv))})`);
    for (const g of Object.keys(today.gpuPrice ?? {}) as GpuModel[]) add(`${g} rent`, today.gpuPrice[g], before.gpuPrice?.[g]);
    add('NSW 30-day power price', today.nem30, before.nem30);
    add('LGC', today.lgc, before.lgc);
    add('Module price', today.moduleUsdPerW, before.moduleUsdPerW);
    add('Young cattle', today.eyci, before.eyci);
    add('Trade lambs', today.ntli, before.ntli);
    add('Food price index', today.fpi, before.fpi);
    add('Humanoid price', today.robotUsd, before.robotUsd);
    add('AUD/USD', today.usdAud ? 1 / today.usdAud : null, before.usdAud ? 1 / before.usdAud : null);
    if ((today.recRobots ?? 0) !== (before.recRobots ?? 0)) moves.push(`Robots in the plan: ${before.recRobots ?? 0} → ${today.recRobots ?? 0}`);
  }
  return (
    <div className="stack">
      <Card title="Market watch" subtitle={<>Live feeds refresh every morning (about 3 am Sydney time) and the recommended plan is re-optimised on the new numbers. Research on robots, build costs and server prices is refreshed daily as well. Last data update: <b>{updated}</b>.</>}
        actions={<button type="button" className="btn small" onClick={() => go('overview')}>See today's plan</button>}>
        <div className="chips">{feeds.map(([name, f]) => <span key={name} className={`chip ${f?.ok && !f.stale ? 'on' : ''}`} title={f?.error ?? f?.source ?? ''}>{name}{f?.date ? ` · ${f.date}` : ''}</span>)}</div>
      </Card>

      <Grid cols={2}>
        <Card title={before ? `What changed since ${before.date}` : 'What changed'}>
          {moves.length ? <ul className="facts">{moves.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="muted">{before ? 'Nothing moved by more than half a percent.' : `History starts on ${today?.date ?? 'the first update'}; day-on-day changes appear from tomorrow.`}</p>}
        </Card>
        <Card title={`Today's research (${CURATED_MARKET.updated})`}>
          <p>{CURATED_MARKET.note}</p>
          {CURATED_MARKET.humanoids.outlook && <p className="small muted"><b>Robots:</b> {CURATED_MARKET.humanoids.outlook}</p>}
        </Card>
      </Grid>

      <Grid cols={4}>
        <Indicator label="AUD/USD" value={L.fx ? `US$${(1 / L.fx.usdAud).toFixed(4)}` : 'n/a'} sub={L.fx ? `A$${L.fx.usdAud.toFixed(4)} per US$ · ${L.fx.date}` : ''} series={col('usdAud').map((v) => (v ? +(1 / v).toFixed(4) : null))} color="#0f766e" status={L.fx} />
        <Indicator label="NSW wholesale power" value={L.nem ? `${aud(L.nem.mean30)}/MWh` : 'n/a'} sub={L.nem ? `30-day mean; 12-month ${aud(L.nem.mean365)}, ${pct(L.nem.negShare365, 1)} negative` : ''} series={col('nem30')} color={PALETTE.export} status={L.nem} />
        <Indicator label="LGC spot" value={L.lgc ? `A$${L.lgc.price.toFixed(2)}` : `A$${CURATED_MARKET.lgc.price}`} sub={L.lgc?.week ? `week of ${L.lgc.week}` : 'Ecovantage weekly update'} series={col('lgc')} color="#ca8a04" status={L.lgc} />
        <Indicator label="Solar modules (TOPCon)" value={L.solarModule ? `US$${L.solarModule.usdPerW.toFixed(3)}/W` : 'n/a'} sub="InfoLink spot average; moves PV build cost" series={col('moduleUsdPerW')} color={PALETTE.solar} status={L.solarModule} />
        {(['B300', 'B200', 'H200', 'RTXPRO6000'] as GpuModel[]).map((g) => (
          <Indicator key={g} label={`${g} rental`} value={gm[g] ? `US$${(gm[g].p25s ?? gm[g].p25).toFixed(2)}/hr ask` : 'n/a'} sub={gm[g] ? `${gm[g].n} offers on Vast.ai; model uses US$${CURATED_MARKET.gpu[g].anchorUsdPerHr} × index ${(gm[g].ratio ?? 1).toFixed(2)}` : ''} series={gpuCol(g, 'gpuAsk')} color={PALETTE.gpu} status={L.gpu} />
        ))}
        <Indicator label="Young cattle (EYCI)" value={L.livestock?.eyci ? `${num(L.livestock.eyci.value)}¢/kg` : 'n/a'} sub={L.livestock?.eyci ? `${chg(L.livestock.eyci.value, L.livestock.eyci.prev)} week · ${chg(L.livestock.eyci.value, L.livestock.eyci.yearAgo)} year · ${L.livestock.eyci.date}` : ''} series={col('eyci')} color={PALETTE.land} status={L.livestock} />
        <Indicator label="Trade lambs (NTLI)" value={L.livestock?.ntli ? `${num(L.livestock.ntli.value)}¢/kg` : 'n/a'} sub={L.livestock?.ntli ? `${chg(L.livestock.ntli.value, L.livestock.ntli.prev)} week · ${chg(L.livestock.ntli.value, L.livestock.ntli.yearAgo)} year` : ''} series={col('ntli')} color={PALETTE.farm} status={L.livestock} />
        <Indicator label="FAO Food Price Index" value={L.fpi ? `${L.fpi.value.toFixed(1)}` : 'n/a'} sub={L.fpi ? `${L.fpi.month} (2014-16 = 100); scales greenhouse & hay margins` : ''} series={col('fpi')} color="#16a34a" status={L.fpi} />
        <Indicator label="Humanoid robots" value={h2 ? `US$${num(h2)} full-size` : 'n/a'} sub={Number.isFinite(cheapest) ? `Unitree H2 list; entry models from US$${num(cheapest)}${L.humanoids?.neo?.priceUsd ? `; 1X NEO US$${num(L.humanoids.neo.priceUsd)}` : ''}` : ''} series={col('unitreeH2')} color="#7c3aed" status={L.humanoids} />
      </Grid>

      <Grid cols={2}>
        <Card title="How the market moves the plan" subtitle={RECOMMENDED.date ? `Recommended plan re-optimised on ${RECOMMENDED.date}: NPV ${aud(RECOMMENDED.metrics?.npv ?? 0)}, IRR ${pct(RECOMMENDED.metrics?.irr ?? null)}.` : 'Runs after each data update.'}>
          <EChart option={planChart} height={300} />
          {H.length < 3 && <Note tone="info">History starts on {H[0]?.date ?? 'the first update'}; the trend fills in day by day.</Note>}
        </Card>
        <Card title="Assumptions set by market data today">
          <div className="table-scroll" style={{ maxHeight: 340 }}>
            <table className="table compact">
              <thead><tr><th>Assumption</th><th className="num">Value</th><th>Basis</th></tr></thead>
              <tbody>
                {applied.filter((a) => !a.path.startsWith('robots.priceRefYear')).map((a) => (
                  <tr key={a.path}><td className="small">{a.path}</td><td className="num">{a.value >= 1000 ? num(a.value) : a.value}</td><td className="small">{a.url ? <Ext href={a.url}>{a.basis}</Ext> : a.basis}{a.date ? ` (${a.date})` : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>
      <Card title="Sources and method">
        <ul className="facts">
          <li><b>Researched levels, live direction.</b> Each price starts from a researched level (cited on the Assumptions tab) and moves with its live indicator relative to the day it was researched. Noisy feeds can shift the model but can't replace it.</li>
          <li><b>GPUs.</b> Vast.ai's rentable on-demand offers. A day counts only with at least 8 offers; the lower quartile of the ask, smoothed as a 7-day median, indexes the researched rental price once there are 3 days of readings. The index is capped at ×0.75 to ×1.33 and moves at most 5% a day, so thin order books can't swing the plan.</li>
          <li><b>Farm.</b> ABARES weekly indicators (Eastern Young Cattle, National Trade Lamb) scale NSW DPI gross margins with an elasticity of {CURATED_MARKET.livestock.elasticity}; the FAO Food Price Index scales greenhouse and hay margins.</li>
          <li><b>Energy.</b> AEMO's NSW1 prices roll forward to the latest 365 days; InfoLink TOPCon module prices adjust solar build cost; Ecovantage's weekly LGC close sets certificate income to 2030; the RBA's daily rate converts US$ prices.</li>
          <li><b>Robots.</b> Unitree's store and 1X's order page give live list prices; capability readiness curves and the work-capable price are revised by the daily research update.</li>
        </ul>
      </Card>
    </div>
  );
}
