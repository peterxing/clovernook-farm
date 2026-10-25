import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Segmented } from '../components';
import { EChart, PALETTE } from '../EChart';
import { prices } from '../data';
import { aud, kw, kwh, kwp, MONTHS, mwh, num, pct, PV_LABEL } from '../format';

const DAY_PRESETS = [
  { label: 'Summer solstice', day: 354 },
  { label: 'Winter solstice', day: 171 },
  { label: 'Spring', day: 280 },
] as const;

export function EnergyTab() {
  const { scenario: s, result: r, update } = useApp();
  const e = r.energy;
  const ser = r.series!;
  const [day, setDay] = useState(354);
  const [heat, setHeat] = useState<'pv' | 'soc' | 'imp' | 'price'>('soc');

  const extremes = useMemo(() => {
    let worst = 0, worstV = Infinity, spike = 0, spikeV = -Infinity;
    for (let d = 0; d < 365; d++) {
      let pv = 0, mx = -Infinity;
      for (let h = 0; h < 24; h++) { pv += ser.pvAc[d * 24 + h]; mx = Math.max(mx, ser.price[d * 24 + h]); }
      if (pv < worstV) { worstV = pv; worst = d; }
      if (mx > spikeV) { spikeV = mx; spike = d; }
    }
    return { worst, spike };
  }, [ser]);

  const sankey = useMemo(() => {
    const flexGrid = Math.max(0, e.flexLoadMwh - e.pvToFlexMwh);
    const gridToLoad = Math.max(0, e.importMwh - e.gridToBattMwh - flexGrid);
    const battLoss = Math.max(0, e.pvToBattMwh + e.gridToBattMwh - e.battToLoadMwh - e.battToGridMwh);
    const served = e.gpuLoadMwh + e.otherLoadMwh - e.unservedMwh;
    const gpuShare = served > 0 ? (e.gpuLoadMwh - e.unservedMwh) / served : 0;
    const links = [
      ['Solar', 'Site load', e.pvToLoadMwh], ['Solar', 'Interruptible GPU jobs', e.pvToFlexMwh], ['Solar', 'Battery', e.pvToBattMwh],
      ['Solar', 'Grid export', Math.max(0, e.exportMwh - e.battToGridMwh)], ['Solar', 'Curtailed', e.curtailedMwh],
      ['Grid import', 'Site load', gridToLoad], ['Grid import', 'Battery', e.gridToBattMwh], ['Grid import', 'Interruptible GPU jobs', flexGrid],
      ['Battery', 'Site load', e.battToLoadMwh], ['Battery', 'Grid export', e.battToGridMwh], ['Battery', 'Losses', battLoss],
      ['Site load', 'GPU compute (sold)', served * gpuShare], ['Site load', 'Homes, farm & greenhouse', served * (1 - gpuShare)],
    ].filter((l) => (l[2] as number) > 0.5);
    const names = [...new Set(links.flatMap((l) => [l[0] as string, l[1] as string]))];
    const color: Record<string, string> = { Solar: PALETTE.solar, 'Grid import': PALETTE.grid, Battery: PALETTE.battery, 'Site load': '#334155', 'Interruptible GPU jobs': PALETTE.flex, 'Grid export': PALETTE.export, Curtailed: PALETTE.curtail, Losses: '#e5e7eb', 'GPU compute (sold)': PALETTE.gpu, 'Homes, farm & greenhouse': PALETTE.homes };
    return {
      tooltip: { trigger: 'item', formatter: (p: { data: { source?: string; target?: string; value?: number }; name: string }) => p.data.source ? `${p.data.source} → ${p.data.target}<br/><b>${mwh(p.data.value ?? 0)}</b>/yr` : p.name },
      series: [{ type: 'sankey', left: 10, right: 150, top: 10, bottom: 10, nodeGap: 14, emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', opacity: 0.45 },
        label: { fontSize: 12 },
        data: names.map((n) => ({ name: n, itemStyle: { color: color[n] ?? '#94a3b8' } })),
        links: links.map((l) => ({ source: l[0], target: l[1], value: Math.round(l[2] as number) })) }],
    };
  }, [e]);

  const monthly = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => mwh(v) },
    legend: { top: 0 },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'MWh', axisLabel: { formatter: (v: number) => num(v) } },
    series: [
      { name: 'Solar', type: 'bar', data: e.monthly.pv.map((v) => Math.round(v)), itemStyle: { color: PALETTE.solar } },
      { name: 'Site load', type: 'line', smooth: true, data: e.monthly.load.map((v) => Math.round(v)), itemStyle: { color: '#334155' } },
      { name: 'Grid import', type: 'bar', data: e.monthly.imp.map((v) => Math.round(v)), itemStyle: { color: PALETTE.grid } },
      { name: 'Export', type: 'bar', data: e.monthly.exp.map((v) => Math.round(v)), itemStyle: { color: PALETTE.export } },
      { name: 'Curtailed', type: 'bar', data: e.monthly.curtail.map((v) => Math.round(v)), itemStyle: { color: PALETTE.curtail } },
    ],
  }), [e]);

  const dayChart = useMemo(() => {
    const hrs = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
    const at = (a: Float64Array, sign = 1) => hrs.map((_, h) => Math.round(a[day * 24 + h] * sign));
    const load = hrs.map((_, h) => { const t = day * 24 + h; return Math.round(ser.gpuLoad[t] + ser.flexLoad[t] + ser.otherLoad[t] - ser.unserved[t]); });
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (Math.abs(v) > 2000 ? `${num(v)}` : `${num(v)}`) },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 60, right: 60, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: hrs },
      yAxis: [{ type: 'value', name: 'kW' }, { type: 'value', name: 'A$/MWh', splitLine: { show: false } }],
      series: [
        { name: 'Solar', type: 'bar', stack: 'src', data: at(ser.pvAc), itemStyle: { color: PALETTE.solar } },
        { name: 'Battery discharge', type: 'bar', stack: 'src', data: at(ser.battDischarge), itemStyle: { color: PALETTE.battery } },
        { name: 'Grid import', type: 'bar', stack: 'src', data: at(ser.gridImport), itemStyle: { color: PALETTE.grid } },
        { name: 'Battery charge', type: 'bar', stack: 'sink', data: at(ser.battCharge, -1), itemStyle: { color: '#c4b5fd' } },
        { name: 'Export', type: 'bar', stack: 'sink', data: at(ser.gridExport, -1), itemStyle: { color: PALETTE.export } },
        { name: 'Curtailed', type: 'bar', stack: 'sink', data: at(ser.curtailed, -1), itemStyle: { color: PALETTE.curtail } },
        { name: 'Site load', type: 'line', data: load, itemStyle: { color: '#111827' }, lineStyle: { width: 2 }, symbol: 'none' },
        { name: 'Spot price', type: 'line', yAxisIndex: 1, data: hrs.map((_, h) => Math.round(ser.price[day * 24 + h])), itemStyle: { color: '#dc2626' }, lineStyle: { type: 'dashed' }, symbol: 'circle', symbolSize: 4 },
      ],
    };
  }, [ser, day]);

  const heatmap = useMemo(() => {
    const data: [number, number, number][] = [];
    let max = 0, min = 0;
    for (let d = 0; d < 365; d++) for (let h = 0; h < 24; h++) {
      const t = d * 24 + h;
      const v = heat === 'pv' ? ser.pvAc[t] : heat === 'soc' ? ser.soc[t] * 100 : heat === 'imp' ? ser.gridImport[t] : ser.price[t];
      data.push([d, h, Math.round(v)]);
      max = Math.max(max, v); min = Math.min(min, v);
    }
    const cap = heat === 'price' ? 300 : heat === 'soc' ? 100 : max;
    return {
      tooltip: { formatter: (p: { value: [number, number, number] }) => `Day ${p.value[0] + 1}, ${p.value[1]}:00<br/><b>${num(p.value[2])}</b> ${heat === 'soc' ? '%' : heat === 'price' ? 'A$/MWh' : 'kW'}` },
      grid: { left: 50, right: 80, top: 10, bottom: 40 },
      xAxis: { type: 'category', data: Array.from({ length: 365 }, (_, i) => i + 1), axisLabel: { interval: 30 }, name: 'Day of year', nameLocation: 'middle', nameGap: 26 },
      yAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}:00`), axisLabel: { interval: 3 } },
      visualMap: { min: heat === 'price' ? Math.max(-100, min) : 0, max: cap, calculable: true, orient: 'vertical', right: 0, top: 'middle', itemHeight: 200,
        inRange: { color: heat === 'price' ? ['#1d4ed8', '#e0f2fe', '#fde68a', '#dc2626'] : heat === 'soc' ? ['#f5f3ff', '#7c3aed'] : heat === 'imp' ? ['#f8fafc', '#334155'] : ['#fffbeb', '#f59e0b', '#b45309'] } },
      series: [{ type: 'heatmap', data, progressive: 0 }],
    };
  }, [ser, heat]);

  const duck = useMemo(() => {
    const avg = Array.from({ length: 24 }, (_, h) => { let a = 0; for (let d = 0; d < 365; d++) a += prices.price[d * 24 + h]; return Math.round((a / 365) * s.grid.priceScale); });
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `A$${v}/MWh` },
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}:00`) },
      yAxis: { type: 'value', name: 'A$/MWh' },
      series: [{ type: 'line', data: avg, smooth: true, areaStyle: { color: 'rgba(14,165,233,0.15)' }, itemStyle: { color: PALETTE.export } }],
    };
  }, [s.grid.priceScale]);

  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="Solar output" value={mwh(e.pvAcMwh)} sub={`${num(e.specificYield)} kWh/kWp · ${kwp(r.layout.kwdc)} / ${kw(r.pvKwac)} AC`} tone="solar" />
        <Kpi label="Site load met by solar" value={pct(e.selfSufficiencyPct / 100, 0)} sub={`${pct(e.solarSelfUsePct / 100, 0)} of solar used on site`} tone="good" />
        <Kpi label="Battery" value={`${num(e.batteryCycles)} cycles/yr`} sub={`${kwh(r.bessKwh)} · arbitrage ${aud(e.arbitrageRevenue)}`} tone="battery" />
        <Kpi label="Grid" value={`${mwh(e.importMwh)} in / ${mwh(e.exportMwh)} out`} sub={`Peak import ${kw(e.peakImportKw)} · curtailed ${pct(e.curtailedMwh / Math.max(1, e.pvAcMwh), 0)}`} />
      </Grid>
      <Grid cols={3}>
        <Card title="Solar">
          <Segmented label="Mounting" value={s.pv.type} onChange={(v) => update((x) => { x.pv.type = v; })} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'tracker', label: 'Tracker' }, { value: 'vertical', label: 'Vertical' }]} />
          <Field label="Share of zone used" value={s.pv.fillPct} min={0} max={100} step={5} unit="%" onChange={(v) => update((x) => { x.pv.fillPct = v; })} />
          <Field label="DC/AC ratio" value={s.pv.dcAcRatio} min={1} max={1.6} step={0.05} onChange={(v) => update((x) => { x.pv.dcAcRatio = v; })} />
          <Field label="Bifaciality" value={s.pv.bifaciality} min={0} max={0.95} step={0.05} onChange={(v) => update((x) => { x.pv.bifaciality = v; })} />
          <p className="small muted">{PV_LABEL[s.pv.type]} · lowest edge {(s.site.groundLevelM + (s.pv.type === 'vertical' ? 0.8 : s.pv.clearanceM)).toFixed(1)} m AHD · LCOE {aud(r.lcoe)}/MWh</p>
        </Card>
        <Card title="Battery">
          <Field label="Power" value={s.bess.powerKw} min={0} max={5000} step={50} unit="kW" onChange={(v) => update((x) => { x.bess.powerKw = v; })} />
          <Field label="Duration" value={s.bess.hours} min={0.5} max={8} step={0.5} unit="h" onChange={(v) => update((x) => { x.bess.hours = v; })} />
          <Field label="Round-trip efficiency" value={s.bess.rtePct} min={70} max={95} step={1} unit="%" onChange={(v) => update((x) => { x.bess.rtePct = v; })} />
          <p className="small muted">Dispatch uses day-ahead price foresight: charge from otherwise-curtailed solar or the cheapest hours, discharge in the most valuable hours, and always hold enough to cover hours where the GPUs would exceed the import limit.</p>
        </Card>
        <Card title="Grid connection (Essential Energy)">
          <Field label="Import limit" value={s.grid.importLimitKw} min={0} max={5000} step={50} unit="kW" onChange={(v) => update((x) => { x.grid.importLimitKw = v; })} />
          <Field label="Export limit" value={s.grid.exportLimitKw} min={0} max={8000} step={100} unit="kW" onChange={(v) => update((x) => { x.grid.exportLimitKw = v; })} />
          <Field label="Wholesale price level" value={s.grid.priceScale} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => update((x) => { x.grid.priceScale = v; })} hint={`Historic NSW1 mean ${aud(prices.intervalMean)}/MWh, ${pct(prices.negativeIntervalShare)} of intervals negative (Oct 2025-Sep 2026)`} />
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card title="Annual energy flows" subtitle="Where every MWh comes from and goes to in year 1">
          <EChart option={sankey} height={380} />
        </Card>
        <Card title="Monthly balance">
          <EChart option={monthly} height={380} />
        </Card>
      </Grid>
      <Card title="A day in the life" subtitle="Sources above zero, sinks below; site load and the NSW1 spot price overlaid."
        actions={<div className="btn-row">{DAY_PRESETS.map((d) => <button key={d.label} type="button" className={`btn small ${day === d.day ? 'primary' : ''}`} onClick={() => setDay(d.day)}>{d.label}</button>)}
          <button type="button" className={`btn small ${day === extremes.worst ? 'primary' : ''}`} onClick={() => setDay(extremes.worst)}>Dullest day</button>
          <button type="button" className={`btn small ${day === extremes.spike ? 'primary' : ''}`} onClick={() => setDay(extremes.spike)}>Price spike</button></div>}>
        <Field label={`Day of year: ${new Date(Date.UTC(2027, 0, day + 1)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`} value={day} min={0} max={364} step={1} onChange={setDay} />
        <EChart option={dayChart} height={360} />
      </Card>
      <Grid cols={2}>
        <Card title="The whole year, hour by hour" actions={<Segmented value={heat} onChange={setHeat} options={[{ value: 'soc', label: 'Battery charge' }, { value: 'pv', label: 'Solar' }, { value: 'imp', label: 'Grid import' }, { value: 'price', label: 'Spot price' }]} />}>
          <EChart option={heatmap} height={340} />
        </Card>
        <Card title="NSW1 average price by hour" subtitle="AEMO 5-minute prices, Oct 2025-Sep 2026: the midday solar trough and the evening peak are what the battery trades.">
          <EChart option={duck} height={340} />
          <Note tone="info">Exporting midday solar earns little in NSW now; the array pays mainly by feeding the GPUs and homes and charging the battery for the evening.</Note>
        </Card>
      </Grid>
    </div>
  );
}
