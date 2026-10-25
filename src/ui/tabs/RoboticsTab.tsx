import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Segmented, Ext } from '../components';
import { EChart } from '../EChart';
import { getContext } from '../data';
import { aud, num, pct } from '../format';
import { ROBOT_TASKS, readiness, robotPriceUsd } from '../../engine/robots';
import { evaluate } from '../../engine/model';
import { CURATED_MARKET, LIVE_MARKET } from '../../engine/defaults';
import type { RobotTask } from '../../engine/types';

const TASK_COLORS: Record<RobotTask, string> = { cabinTurnover: '#14b8a6', greenhouse: '#65a30d', dcHands: '#ef4444', solarOps: '#f59e0b', livestock: '#a16207', maintenance: '#64748b' };
const THIS_YEAR = new Date().getFullYear();

export function RoboticsTab() {
  const { scenario: s, result: r, update } = useApp();
  const rb = s.robots;
  const usd = s.finance.usdAud;
  const R = r.robots;
  const H = CURATED_MARKET.humanoids;
  const totalHours = ROBOT_TASKS.reduce((a, t) => a + R.taskHours[t], 0);
  const at = (y: number) => R.years.find((x) => x.calYear === y);
  const deploy = at(Math.max(rb.deployYear, s.finance.startYear));
  const mature = R.years.find((y) => y.calYear >= rb.deployYear && ROBOT_TASKS.every((t) => y.readiness[t] > 0.8 || R.taskHours[t] === 0)) ?? R.years[R.years.length - 1];
  const automatedMature = mature ? ROBOT_TASKS.reduce((a, t) => a + mature.automatedHours[t], 0) : 0;
  const weightedReadiness = (y: number) => (totalHours > 0 ? ROBOT_TASKS.reduce((a, t) => a + R.taskHours[t] * readiness(s, t, y), 0) / totalHours : 0);
  const withoutNpv = useMemo(() => evaluate({ ...r.scenario, robots: { ...r.scenario.robots, fleet: 0 } }, getContext()).npv, [r.scenario]);

  const curves = useMemo(() => {
    const yrs = Array.from({ length: 16 }, (_, i) => 2025 + i);
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 50, right: 20, top: 50, bottom: 30 },
      xAxis: { type: 'category', data: yrs },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: ROBOT_TASKS.map((t, i) => ({
        name: rb.tasks[t].label.split(' (')[0], type: 'line', smooth: true, symbol: 'none', itemStyle: { color: TASK_COLORS[t] }, lineStyle: { width: 2.5 },
        data: yrs.map((y) => Math.round(readiness(s, t, y) * 100)),
        ...(i === 0 ? { markLine: { silent: true, symbol: 'none', label: { formatter: '{b}' }, data: [{ name: 'Today', xAxis: String(THIS_YEAR) }, ...(rb.fleet > 0 ? [{ name: 'Robots arrive', xAxis: String(Math.max(rb.deployYear, s.finance.startYear)), lineStyle: { color: '#7c3aed' } }] : [])] } } : {}),
      })),
    };
  }, [s, rb]);

  const prices = useMemo(() => {
    const yrs = Array.from({ length: 12 }, (_, i) => 2024 + i);
    const unitree = (LIVE_MARKET.humanoids?.unitree ?? []).map((u) => ({ name: u.name, priceUsd: u.fromUsd }));
    const curated = H.models.filter((m) => m.priceUsd).map((m) => ({ name: m.name, priceUsd: m.priceUsd as number }));
    const seen = new Set<string>();
    const pts = [...unitree, ...curated].filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
    return {
      tooltip: { trigger: 'item', formatter: (p: { seriesName: string; name: string; value: [string, number] | number; data: { name?: string } }) => (Array.isArray(p.value) ? `${p.data.name}<br/><b>${aud(p.value[1])}</b>` : `${p.seriesName} ${p.name}<br/><b>${aud(p.value as number)}</b>`) },
      legend: { top: 0 },
      grid: { left: 70, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: yrs.map(String) },
      yAxis: { type: 'log', min: 2000, axisLabel: { formatter: (v: number) => aud(v) } },
      series: [
        { name: 'Work-capable humanoid (forecast, A$)', type: 'line', symbol: 'circle', data: yrs.map((y) => Math.round(robotPriceUsd(s, y) * usd)), itemStyle: { color: '#7c3aed' }, lineStyle: { width: 3 } },
        { name: 'Robot-as-a-service per year (A$)', type: 'line', symbol: 'none', lineStyle: { type: 'dashed' }, data: yrs.map((y) => Math.round(rb.leaseUsdPerMonth * Math.pow(1 - rb.priceDeclinePctYr / 100, y - rb.priceRefYear) * 12 * usd)), itemStyle: { color: '#a78bfa' } },
        { name: 'Models on sale today', type: 'scatter', symbolSize: 11, itemStyle: { color: '#0f766e' }, label: { show: true, position: 'right', formatter: (p: { data: { name: string } }) => p.data.name, fontSize: 10 }, data: pts.map((p) => ({ name: p.name, value: [String(THIS_YEAR), Math.round(p.priceUsd * usd)] })) },
      ],
    };
  }, [s, rb, usd, H.models]);

  const labour = useMemo(() => {
    const ys = R.years.filter((y) => y.calYear <= 2045);
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${num(v)} h` },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 60, right: 20, top: 50, bottom: 30 },
      xAxis: { type: 'category', data: ys.map((y) => y.calYear) },
      yAxis: { type: 'value', name: 'hours / yr' },
      series: [
        ...ROBOT_TASKS.map((t) => ({ name: rb.tasks[t].label.split(' (')[0], type: 'bar', stack: 'auto', data: ys.map((y) => Math.round(y.automatedHours[t])), itemStyle: { color: TASK_COLORS[t] } })),
        { name: 'Site labour needed', type: 'line', symbol: 'none', data: ys.map(() => Math.round(totalHours)), itemStyle: { color: '#111827' }, lineStyle: { type: 'dashed' } },
      ],
    };
  }, [R, rb, totalHours]);

  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="Humanoid fleet" value={rb.fleet > 0 ? `${rb.fleet} from ${Math.max(rb.deployYear, s.finance.startYear)}` : 'None yet'} sub={rb.fleet > 0 ? (rb.acquisition === 'buy' ? `bought; replaced every ${rb.lifeYears} yrs` : 'leased as robot-as-a-service') : 'Set a fleet below or let the optimiser decide'} tone="gpu" />
        <Kpi label="Work-capable humanoid price" value={aud(robotPriceUsd(s, THIS_YEAR) * usd)} sub={`today → ${aud(robotPriceUsd(s, Math.max(rb.deployYear, THIS_YEAR)) * usd)} in ${Math.max(rb.deployYear, THIS_YEAR)} (−${rb.priceDeclinePctYr}%/yr)`} />
        <Kpi label="Readiness for this site's work" value={pct(weightedReadiness(THIS_YEAR), 0)} sub={`${pct(weightedReadiness(Math.max(rb.deployYear, THIS_YEAR)), 0)} at deployment, ${pct(weightedReadiness(2035), 0)} by 2035`} tone="farm" />
        <Kpi label="Value of the robots" value={aud(r.npv - withoutNpv)} sub={rb.fleet > 0 ? `NPV with vs without; ${aud(mature?.cashSavings ?? 0)}/yr labour saved at maturity` : 'Add robots to see their value'} tone={r.npv - withoutNpv >= 0 ? 'good' : 'bad'} />
      </Grid>
      <Grid cols={3}>
        <Card title="Fleet">
          <Field label="Humanoid robots" value={rb.fleet} min={0} max={10} step={1} onChange={(v) => update((x) => { x.robots.fleet = v; })} />
          <Field label="First year on site" value={rb.deployYear} min={2027} max={2040} step={1} onChange={(v) => update((x) => { x.robots.deployYear = v; })} />
          <Segmented label="Acquire by" value={rb.acquisition} onChange={(v) => update((x) => { x.robots.acquisition = v; })} options={[{ value: 'buy', label: 'Buying' }, { value: 'lease', label: 'Robot-as-a-service' }]} />
          <p className="small muted">Each robot works {rb.hoursPerDay} h a day at {rb.uptimePct}% uptime, about {num(rb.hoursPerDay * 365 * rb.uptimePct / 100)} hours a year, charging from the farm's solar.</p>
        </Card>
        <Card title="Forecast settings">
          <Field label="Capability timing vs forecast" value={rb.readinessShiftYears} min={-4} max={6} step={0.5} unit="years" onChange={(v) => update((x) => { x.robots.readinessShiftYears = v; })} hint="Positive = slower progress than the forecast curves." />
          <Field label="Price decline" value={rb.priceDeclinePctYr} min={0} max={40} step={1} unit="%/yr" onChange={(v) => update((x) => { x.robots.priceDeclinePctYr = v; })} />
          <Field label="Output vs a person (mature task)" value={rb.productivity} min={0.2} max={1.5} step={0.05} unit="×" onChange={(v) => update((x) => { x.robots.productivity = v; })} />
          <Field label="Sell task-demonstration data" value={rb.dataRevenuePerHour} min={0} max={50} step={0.5} unit="A$/robot-h" onChange={(v) => update((x) => { x.robots.dataRevenuePerHour = v; })} hint="Optional: robot labs pay for real-world farm and hospitality task data." />
        </Card>
        <Card title="Labour on this site">
          <table className="table compact">
            <thead><tr><th>Task</th><th className="num">Hours/yr</th><th className="num">Ready {THIS_YEAR}</th><th className="num">Ready 2030</th></tr></thead>
            <tbody>
              {ROBOT_TASKS.map((t) => (
                <tr key={t}><td><span className="dot" style={{ background: TASK_COLORS[t] }} />{rb.tasks[t].label}{!rb.tasks[t].costed && <span className="muted small"> (owner time)</span>}</td><td className="num">{num(R.taskHours[t])}</td><td className="num">{pct(readiness(s, t, THIS_YEAR), 0)}</td><td className="num">{pct(readiness(s, t, 2030), 0)}</td></tr>
              ))}
              <tr className="total"><td>Total</td><td className="num">{num(totalHours)}</td><td /><td /></tr>
            </tbody>
          </table>
          {rb.fleet > 0 && <p className="small muted">At maturity the fleet covers {num(automatedMature)} h a year ({pct(automatedMature / Math.max(1, totalHours), 0)} of site labour), saving {aud(mature?.cashSavings ?? 0)} and freeing {num(mature?.ownerHoursFreed ?? 0)} h of owner time.</p>}
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card title="Capability readiness forecast" subtitle="Share of each task's human hours a humanoid can take on, by year. Curves are revised by the daily research update.">
          <EChart option={curves} height={360} />
        </Card>
        <Card title="Price accessibility" subtitle={`Forecast price of a work-capable humanoid with hands (log scale), and robots on sale today at live list prices${deploy ? '' : ''}.`}>
          <EChart option={prices} height={360} />
        </Card>
      </Grid>
      <Card title="Who does the work" subtitle="Human-equivalent hours handled by robots each year, against the site's total labour need.">
        <EChart option={labour} height={320} />
      </Card>
      <Grid cols={2}>
        <Card title="Humanoids on the market" subtitle={`Researched ${CURATED_MARKET.updated}; Unitree and 1X prices checked daily${LIVE_MARKET.humanoids?.date ? ` (last ${LIVE_MARKET.humanoids.date})` : ''}.`}>
          <table className="table compact">
            <thead><tr><th>Robot</th><th className="num">Price</th><th>Availability</th></tr></thead>
            <tbody>
              {H.models.map((m) => {
                const live = LIVE_MARKET.humanoids?.unitree?.find((u) => u.name === m.name)?.fromUsd ?? (m.name === '1X NEO' ? LIVE_MARKET.humanoids?.neo?.priceUsd : undefined);
                const p = live ?? m.priceUsd;
                return <tr key={m.name}><td><b>{m.name}</b><div className="muted small">{m.class}</div></td><td className="num">{p ? `US$${num(p)}` : 'n/a'}<div className="muted small">{p ? aud(p * usd) : ''}</div></td><td className="small"><Ext href={m.source}>{m.availability}</Ext></td></tr>;
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Outlook">
          <p>{H.outlook}</p>
          <p className="small muted">{H.basis}</p>
          <Note tone="info">Robots here substitute for labour the model already pays for (cabin turnover, greenhouse work, data-centre hands, solar O&M). Owner time freed on livestock and maintenance is shown but not counted as cash.</Note>
          <p className="small muted">Fleet costs: {rb.acquisition === 'buy' ? `${aud(robotPriceUsd(s, Math.max(rb.deployYear, s.finance.startYear)) * usd * 1.1)} per robot landed, ${rb.maintenancePctYr + 1}% a year upkeep and insurance` : `${aud(rb.leaseUsdPerMonth * usd)}/month per robot today, falling with prices`}, plus {aud(rb.softwarePerYr)}/yr software each and solar charging.</p>
        </Card>
      </Grid>
    </div>
  );
}
