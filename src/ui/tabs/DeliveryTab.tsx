import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Ext, Grid, Kpi, Note, Pill, Progress } from '../components';
import { EChart } from '../EChart';
import { aud, monthYear, num } from '../format';
import { DELIVERY_PLAN, STREAMS, commitments, nextActions, schedulePlan, signupProgress, type ScheduledStep, type Stream } from '../../engine/delivery';

const STREAM = Object.fromEntries(STREAMS.map((x) => [x.id, x])) as Record<Stream, (typeof STREAMS)[number]>;
const ts = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fullDate = (iso: string) => new Date(ts(iso)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const when = (st: ScheduledStep) => (st.milestone || st.weeks === 0 ? monthYear(st.endDate) : `${monthYear(st.startDate)} → ${monthYear(st.endDate)}`);

const STATUS = { todo: ['neutral', 'To do'], active: ['info', 'Under way'], done: ['good', 'Done'], blocked: ['bad', 'Blocked'] } as const;
function StatusPill({ st }: { st: ScheduledStep }) {
  const [tone, label] = STATUS[st.status];
  return <Pill tone={tone}>{label}</Pill>;
}

interface GanttApi {
  value: (i: number) => number;
  coord: (v: number[]) => number[];
  size: (v: number[]) => number[];
  visual: (k: string) => string;
}

function ganttOption(rows: ScheduledStep[], startYear: number) {
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const st = rows[p.dataIndex];
        return `<b>${esc(st.title)}</b><br/>${esc(st.who)}<br/>${when(st)}${st.weeks ? ` · ${st.weeks} weeks` : ''}${st.critical ? '<br/><b>On the critical path</b>' : ''}`;
      },
    },
    grid: { left: 250, right: 24, top: 28, bottom: 16 },
    xAxis: { type: 'time', position: 'top', min: ts(rows.reduce((a, r) => (r.startDate < a ? r.startDate : a), rows[0]?.startDate ?? '2026-01-01')) - 20 * 86400e3, max: ts(rows.reduce((a, r) => (r.endDate > a ? r.endDate : a), rows[0]?.endDate ?? '2026-01-01')) + 45 * 86400e3, splitLine: { show: true, lineStyle: { color: '#eef0ea' } } },
    yAxis: { type: 'category', data: rows.map((r) => r.title), inverse: true, axisTick: { show: false }, axisLabel: { width: 238, overflow: 'truncate', fontSize: 11 } },
    series: [{
      type: 'custom',
      encode: { x: [1, 2], y: 0 },
      renderItem: (_: unknown, api: GanttApi) => {
        const y = api.value(0);
        const a = api.coord([api.value(1), y]), b = api.coord([api.value(2), y]);
        const h = api.size([0, 1])[1] * 0.62;
        const color = api.visual('color');
        const critical = api.value(4) === 1;
        if (api.value(3) === 1) {
          const r = h * 0.62;
          return { type: 'polygon', shape: { points: [[b[0], b[1] - r], [b[0] + r, b[1]], [b[0], b[1] + r], [b[0] - r, b[1]]] }, style: { fill: color, stroke: critical ? '#111827' : '#fff', lineWidth: 1.2 } };
        }
        return { type: 'rect', shape: { x: a[0], y: a[1] - h / 2, width: Math.max(3, b[0] - a[0]), height: h, r: 3 }, style: { fill: color, opacity: api.value(5) === 1 ? 0.4 : 1, stroke: critical ? '#111827' : 'transparent', lineWidth: critical ? 1.5 : 0 } };
      },
      data: rows.map((st, i) => ({ value: [i, ts(st.startDate), ts(st.endDate), st.milestone ? 1 : 0, st.critical ? 1 : 0, st.status === 'done' ? 1 : 0], itemStyle: { color: STREAM[st.stream].color } })),
      markLine: { symbol: 'none', silent: true, lineStyle: { color: '#b45309', type: 'dashed' }, label: { show: false }, data: [{ xAxis: ts(`${startYear}-01-01`) }] },
    }],
  };
}

export function DeliveryTab() {
  const { scenario: s, result: r, go } = useApp();
  const sched = useMemo(() => schedulePlan(DELIVERY_PLAN, s, r), [s, r]);
  const [filter, setFilter] = useState<Stream | 'all'>('all');
  const next = useMemo(() => nextActions(sched).slice(0, 6), [sched]);
  const signups = useMemo(() => signupProgress(DELIVERY_PLAN, s, r, sched), [s, r, sched]);
  const com = useMemo(() => commitments(sched), [sched]);
  const rows = useMemo(() => [...sched.steps].sort((a, b) => STREAMS.findIndex((x) => x.id === a.stream) - STREAMS.findIndex((x) => x.id === b.stream) || a.start - b.start || a.end - b.end), [sched]);
  const gantt = useMemo(() => ganttOption(rows, s.finance.startYear), [rows, s.finance.startYear]);
  const commitChart = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => aud(v) },
    grid: { left: 70, right: 20, top: 16, bottom: 28 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => aud(v) } },
    series: [{ name: 'Committed', type: 'line', step: 'end', symbol: 'circle', symbolSize: 6, itemStyle: { color: STREAM.commitments.color }, areaStyle: { opacity: 0.08 }, data: [[ts(sched.start), 0], ...com.map((c) => [ts(c.commitDate), c.cumulative])] }],
  }), [com, sched.start]);

  const b = sched.byId;
  const energise = b.energise, fid = b.fid, gpusLive = b['gpus-live'], cabinsOpen = b['cabins-open'];
  const done = sched.steps.filter((x) => x.status === 'done').length;
  const active = sched.steps.filter((x) => x.status === 'active').length;
  const ready = sched.steps.filter((x) => x.ready).length;
  const total = com.length ? com[com.length - 1].cumulative : 0;
  const atRisk = fid ? com.filter((c) => c.id !== 'fid' && c.commitDate < fid.endDate).reduce((a, c) => a + c.capexAud, 0) : 0;
  const lagYears = energise ? (ts(energise.endDate) - ts(`${s.finance.startYear}-01-01`)) / (365.25 * 86400e3) : 0;
  const gpus = s.compute.servers * s.compute.catalog[s.compute.model].gpusPerServer;
  const shown = filter === 'all' ? rows : rows.filter((x) => x.stream === filter);

  return (
    <div className="stack">
      <Card title="Delivery plan" subtitle={<>The steps that take this plan from paper to income: approvals, the grid connection, procurement, commitments and customer sign-ups, in order and with their lead times. They follow the plan you're viewing and are re-checked every morning with the market research. Dates assume the work starts on <b>{fullDate(sched.start)}</b>.</>}
        actions={<><button type="button" className="btn small" onClick={() => go('approvals')}>Approvals detail</button><button type="button" className="btn small" onClick={() => go('finance')}>Finance</button></>}>
        <Grid cols={4}>
          {fid && <Kpi label="Investment decision" value={monthYear(fid.endDate)} sub="Consent, connection offer, offtake and finance in place" tone="warn" />}
          {energise && <Kpi label="Power on" value={monthYear(energise.endDate)} sub={`${Math.round(energise.end)} weeks; the grid connection sets the pace`} tone="solar" />}
          {gpusLive ? <Kpi label="GPUs earning" value={monthYear(gpusLive.endDate)} sub={`${num(gpus)} ${s.compute.model} GPUs`} tone="gpu" />
            : cabinsOpen && <Kpi label="Cabins open" value={monthYear(cabinsOpen.endDate)} sub={`${s.homes.cabins} farm-stay cabins`} tone="homes" />}
          <Kpi label="Fully operating" value={monthYear(sched.endDate)} sub={`${done} of ${sched.steps.length} steps done · ${active} under way · ${ready} ready to start`} tone="good" />
        </Grid>
        {energise && lagYears >= 0.5 && (
          <Note tone="warn">The cash-flow model starts operations in <b>{s.finance.startYear}</b>, but at today's lead times the site is energised in <b>{monthYear(energise.endDate)}</b>, so the cash flows on the Finance tab arrive about {lagYears.toFixed(1)} years later than shown.</Note>
        )}
      </Card>

      <Grid cols={2}>
        <Card title={`Today's update (${fullDate(DELIVERY_PLAN.updated)})`}>
          <p>{DELIVERY_PLAN.note}</p>
          <div className="chips">{STREAMS.map((x) => <span key={x.id} className="chip legend-chip"><span className="dot" style={{ background: x.color }} />{x.label}</span>)}</div>
        </Card>
        <Card title="Next actions" subtitle="Steps that can start now; critical-path steps first.">
          {next.length ? (
            <ul className="steps-list">
              {next.map((st) => (
                <li key={st.id} className={st.critical ? 'critical' : ''}>
                  <b>{st.title}</b> {st.critical && <Pill tone="warn">Critical path</Pill>}
                  <div className="small muted">{st.who} · {when(st)}</div>
                  <div className="small">{st.detail}</div>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Every step that can start has started.</p>}
        </Card>
      </Grid>

      <Card title="Programme" subtitle={`Bars are coloured by workstream; outlined bars and diamonds are on the critical path, which sets the earliest finish. The dashed line marks the start of the cash-flow model (January ${s.finance.startYear}).`}>
        <EChart option={gantt} height={rows.length * 19 + 50} />
      </Card>

      <Grid cols={2}>
        <Card title="Customer sign-ups" subtitle="Targets come from the plan; counts are updated as agreements are signed.">
          <div className="signups">
            {signups.map((x) => (
              <div key={x.id} className="signup">
                <span><b>{x.label}</b></span>
                <Progress value={x.signed / x.target} label={`${num(x.signed)} of ${num(x.target)} ${x.unit}`} />
                <span className="small muted">{x.step ? `Due by ${monthYear(x.step.endDate)}` : ''}{x.note ? ` · ${x.note}` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Commitments" subtitle={<>{aud(total)} in all; {aud(atRisk)} is spent before the investment decision{fid ? ` (${monthYear(fid.endDate)})` : ''} and is at risk if the project stops.</>}>
          <EChart option={commitChart} height={200} />
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="table compact">
              <thead><tr><th>Step</th><th>Committed</th><th className="num">Amount</th><th className="num">Running total</th></tr></thead>
              <tbody>
                {com.map((c) => <tr key={c.id}><td className="small">{c.title}</td><td className="small">{monthYear(c.commitDate)}</td><td className="num">{aud(c.capexAud)}</td><td className="num">{aud(c.cumulative)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </Grid>

      <Card title="All steps" subtitle={`${shown.length} steps${filter === 'all' ? '' : ` in ${STREAM[filter].label.toLowerCase()}`}; each one cites its source and the date it was last checked.`}
        actions={<div className="chips">{[{ id: 'all' as const, label: 'All' }, ...STREAMS].map((x) => <button key={x.id} type="button" className={`chip ${filter === x.id ? 'on' : ''}`} onClick={() => setFilter(x.id)}>{x.label}</button>)}</div>}>
        <div className="table-scroll" style={{ maxHeight: 560 }}>
          <table className="table compact">
            <thead><tr><th>Step</th><th>Who</th><th>When</th><th>Status</th><th>Sources</th></tr></thead>
            <tbody>
              {shown.map((st) => (
                <tr key={st.id}>
                  <td><span className="dot" style={{ background: STREAM[st.stream].color }} /><b>{st.title}</b>{st.critical && <> <Pill tone="warn">Critical</Pill></>}<div className="small muted">{st.detail}</div></td>
                  <td className="small">{st.who}</td>
                  <td className="small">{when(st)}{st.weeks ? <div className="muted">{st.weeks} weeks</div> : null}{st.capexAud > 0 ? <div className="muted">{aud(st.capexAud)}</div> : null}</td>
                  <td><StatusPill st={st} /></td>
                  <td className="small">{st.sources.map((x) => <div key={x.url + x.title}><Ext href={x.url}>{x.title}</Ext>{x.date ? ` (${x.date})` : ''}</div>)}<div className="muted">Checked {fullDate(st.checked)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How this plan stays current">
        <ul className="facts">
          <li><b>Daily.</b> The morning research run re-checks the facts behind each step (Council and Essential Energy processes, fees and lead times, equipment supply, buyer requirements and public records such as DA applications for the lot) and updates the steps, sources and today's note.</li>
          <li><b>Fitted to the plan.</b> Steps appear only when the plan needs them (no GPUs, no server steps; no cabins, no bookings), and their quantities come from the plan you're viewing. Over 5 MW of generation switches the grid steps to Essential Energy's longer Chapter 5 process.</li>
          <li><b>Progress.</b> A step only moves to under way or done, and a sign-up count only rises, on evidence. Until work starts, the dates roll forward from each day's update.</li>
        </ul>
      </Card>
    </div>
  );
}
