import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Toggle } from '../components';
import { EChart, PALETTE } from '../EChart';
import { aud, audFull, pct, years } from '../format';

const GROUP_COLORS: Record<string, string> = { Solar: PALETTE.solar, Battery: PALETTE.battery, Grid: PALETTE.grid, Compute: PALETTE.gpu, Agriculture: PALETTE.farm, Homes: PALETTE.homes, Site: PALETTE.site, Land: PALETTE.land };
const REV_COLORS: Record<string, string> = { 'GPU compute': PALETTE.gpu, 'Interruptible compute': PALETTE.flex, 'Energy exports': PALETTE.export, 'Battery services': PALETTE.battery, LGCs: '#facc15', 'Tenant energy': '#06b6d4', 'Rent & stays': PALETTE.homes, Agriculture: PALETTE.farm };

export function FinanceTab() {
  const { scenario: s, result: r, update } = useApp();
  const f = s.finance;
  const [showTable, setShowTable] = useState(false);

  const capexChart = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const l of r.capex) groups[l.group] = (groups[l.group] ?? 0) + l.amount;
    return {
      tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${aud(p.value)}</b> (${p.percent}%)` },
      legend: { bottom: 0 },
      series: [{ type: 'pie', radius: ['42%', '70%'], center: ['50%', '44%'], label: { formatter: '{b}\n{d}%' }, itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: Object.entries(groups).map(([name, value]) => ({ name, value: Math.round(value), itemStyle: { color: GROUP_COLORS[name] } })) }],
    };
  }, [r]);

  const cashflow = useMemo(() => {
    const streams = Object.keys(r.years[0].revenue);
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => aud(v) },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 80, right: 80, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: ['Build', ...r.years.map((y) => String(y.calYear))] },
      yAxis: [{ type: 'value', axisLabel: { formatter: (v: number) => aud(v) } }, { type: 'value', axisLabel: { formatter: (v: number) => aud(v) }, splitLine: { show: false } }],
      series: [
        ...streams.map((k) => ({ name: k, type: 'bar', stack: 'rev', data: [0, ...r.years.map((y) => Math.round(y.revenue[k]))], itemStyle: { color: REV_COLORS[k] } })),
        { name: 'Operating costs', type: 'bar', stack: 'cost', data: [0, ...r.years.map((y) => -Math.round(Object.values(y.opex).reduce((a, b) => a + b, 0)))], itemStyle: { color: '#94a3b8' } },
        { name: 'Capital spend', type: 'bar', stack: 'cost', data: [-Math.round(r.capexTotal), ...r.years.map((y) => -Math.round(y.capex))], itemStyle: { color: '#475569' } },
        { name: 'Cumulative cash', type: 'line', yAxisIndex: 1, data: [-Math.round(r.capexTotal), ...r.years.map((y) => Math.round(y.cumulative))], itemStyle: { color: '#111827' }, lineStyle: { width: 2.5 } },
      ],
    };
  }, [r]);

  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="NPV" value={aud(r.npv)} sub={`at ${f.discountRatePct}% over ${f.years} years`} tone={r.npv >= 0 ? 'good' : 'bad'} />
        <Kpi label="Project IRR" value={pct(r.irr)} sub={f.debtPct > 0 ? `Equity IRR ${pct(r.equityIrr)} with ${f.debtPct}% debt` : 'Unlevered, pre-tax'} />
        <Kpi label="Payback" value={years(r.paybackYears)} sub={`Profitability index ${r.profitIndex.toFixed(2)}`} />
        <Kpi label="Solar LCOE" value={`${aud(r.lcoe)}/MWh`} sub="Elevated agrivoltaic structure incl. O&M" tone="solar" />
      </Grid>
      <Grid cols={3}>
        <Card title="Capital cost" subtitle={audFull(r.capexTotal)}>
          <EChart option={capexChart} height={300} />
        </Card>
        <Card title="Capital items" className="span-2">
          <table className="table compact">
            <thead><tr><th>Item</th><th>Group</th><th className="num">A$</th></tr></thead>
            <tbody>
              {r.capex.map((l) => <tr key={l.key}><td>{l.label}</td><td><span className="dot" style={{ background: GROUP_COLORS[l.group] }} />{l.group}</td><td className="num">{audFull(l.amount)}</td></tr>)}
              <tr className="total"><td>Total</td><td /><td className="num">{audFull(r.capexTotal)}</td></tr>
            </tbody>
          </table>
        </Card>
      </Grid>
      <Card title="Cash flow by year" subtitle="Nominal A$, pre-tax. Revenue streams stacked above zero; operating costs and capital (including GPU refreshes) below." actions={<button type="button" className="btn small" onClick={() => setShowTable(!showTable)}>{showTable ? 'Hide' : 'Show'} table</button>}>
        <EChart option={cashflow} height={420} />
        {showTable && (
          <div className="table-scroll">
            <table className="table compact">
              <thead><tr><th>Year</th><th className="num">Revenue</th><th className="num">Operating</th><th className="num">EBITDA</th><th className="num">Capital</th><th className="num">Net cash</th><th className="num">Cumulative</th></tr></thead>
              <tbody>
                {r.years.map((y) => {
                  const rev = Object.values(y.revenue).reduce((a, b) => a + b, 0), ox = Object.values(y.opex).reduce((a, b) => a + b, 0);
                  return <tr key={y.year}><td>{y.calYear}</td><td className="num">{audFull(rev)}</td><td className="num">{audFull(-ox)}</td><td className="num">{audFull(y.ebitda)}</td><td className="num">{audFull(-y.capex)}</td><td className="num">{audFull(y.netCash)}</td><td className="num">{audFull(y.cumulative)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Grid cols={3}>
        <Card title="Discounting">
          <Field label="Discount rate" value={f.discountRatePct} min={0} max={20} step={0.25} unit="%" onChange={(v) => update((x) => { x.finance.discountRatePct = v; })} />
          <Field label="Inflation" value={f.inflationPct} min={0} max={8} step={0.1} unit="%" onChange={(v) => update((x) => { x.finance.inflationPct = v; })} />
          <Field label="Project life" value={f.years} min={10} max={40} step={1} unit="yrs" onChange={(v) => update((x) => { x.finance.years = v; })} />
        </Card>
        <Card title="Land">
          <Toggle label="Include buying the land" checked={f.includeLand} onChange={(v) => update((x) => { x.finance.includeLand = v; })} hint="Adds the purchase (plus ~4.5% stamp duty and costs) up front and the land's value back at the end." />
          <Field label="Purchase price" value={f.landPrice} min={500000} max={3000000} step={10000} unit="A$" onChange={(v) => update((x) => { x.finance.landPrice = v; })} hint="Listed in 2026 with a guide of about A$1.25M." />
          <Field label="Land value growth" value={f.landGrowthPctYr} min={-2} max={10} step={0.1} unit="%/yr" onChange={(v) => update((x) => { x.finance.landGrowthPctYr = v; })} />
        </Card>
        <Card title="Funding">
          <Field label="Debt share" value={f.debtPct} min={0} max={80} step={5} unit="%" onChange={(v) => update((x) => { x.finance.debtPct = v; })} />
          <Field label="Interest rate" value={f.interestPct} min={2} max={12} step={0.1} unit="%" onChange={(v) => update((x) => { x.finance.interestPct = v; })} />
          <Field label="Loan term" value={f.loanYears} min={3} max={25} step={1} unit="yrs" onChange={(v) => update((x) => { x.finance.loanYears = v; })} />
          <Field label="Contingency" value={f.contingencyPct} min={0} max={30} step={1} unit="%" onChange={(v) => update((x) => { x.finance.contingencyPct = v; })} />
        </Card>
      </Grid>
    </div>
  );
}
