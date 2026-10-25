import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Toggle, Ext } from '../components';
import { EChart, PALETTE } from '../EChart';
import { climate } from '../data';
import { aud, kw, MONTHS, mwh, num, pct } from '../format';
import type { GpuModel } from '../../engine/types';
import { SOURCES } from '../../engine/params';

export function ComputeTab() {
  const { scenario: s, result: r, update } = useApp();
  const c = s.compute;
  const spec = c.catalog[c.model];
  const gpus = c.servers * spec.gpusPerServer;
  const e = r.energy;
  const audPerHr = spec.priceUsdPerGpuHr * s.finance.usdAud;
  const revY1 = r.year1.revenueByStream['GPU compute'] + r.year1.revenueByStream['Interruptible compute'];
  const energyCostPerGpuHr = (e.gpuLoadMwh + e.flexLoadMwh) > 0 ? ((e.importCost + e.demandCharges) * ((e.gpuLoadMwh + e.flexLoadMwh) / Math.max(1, e.gpuLoadMwh + e.flexLoadMwh + e.otherLoadMwh))) / Math.max(1, e.gpuHoursSold + e.flexGpuHours) : 0;
  const avgPue = useMemo(() => { let a = 0; for (const t of climate.tamb) a += c.pueBase + c.pueSlopePerC * Math.max(0, t - c.pueRefC); return a / climate.tamb.length; }, [c.pueBase, c.pueSlopePerC, c.pueRefC]);

  const catalogRows = (Object.keys(c.catalog) as GpuModel[]).map((m) => {
    const g = c.catalog[m];
    const util = c.utilisationPct / 100;
    const eff = util + (c.flexEnabled ? (1 - util) * (c.flexPricePct / 100) : 0);
    const rev = g.priceUsdPerGpuHr * s.finance.usdAud * g.gpusPerServer * 8760 * eff * (1 - c.marketplaceFeePct / 100);
    const capex = g.serverCapexUsd * s.finance.usdAud + g.serverKw * c.dcCapexPerKw;
    return { m, g, rev, capex, payback: capex / Math.max(1, rev), perKw: rev / g.serverKw };
  });

  const byYear = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => aud(v) },
    legend: { top: 0 },
    grid: { left: 70, right: 70, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: r.years.map((y) => y.calYear) },
    yAxis: [{ type: 'value', axisLabel: { formatter: (v: number) => aud(v) } }, { type: 'value', name: 'Refresh', axisLabel: { formatter: (v: number) => aud(v) }, splitLine: { show: false } }],
    series: [
      { name: 'GPU rental (full price)', type: 'bar', stack: 'r', data: r.years.map((y) => Math.round(y.revenue['GPU compute'])), itemStyle: { color: PALETTE.gpu } },
      { name: 'Interruptible jobs', type: 'bar', stack: 'r', data: r.years.map((y) => Math.round(y.revenue['Interruptible compute'])), itemStyle: { color: PALETTE.flex } },
      { name: 'Compute operating costs', type: 'line', data: r.years.map((y) => Math.round(y.opex['Compute operations'] + y.opex['Fibre & network'])), itemStyle: { color: '#334155' } },
      { name: 'Hardware refresh', type: 'scatter', yAxisIndex: 1, symbolSize: 12, data: r.years.map((y) => (c.servers > 0 && y.year % Math.round(c.refreshYears) === 0 && y.year < s.finance.years ? Math.round(y.capex) : null)), itemStyle: { color: '#7c3aed' } },
    ],
  }), [r, c.servers, c.refreshYears, s.finance.years]);

  const pueChart = useMemo(() => {
    const mT = Array(12).fill(0), mMax = Array(12).fill(-99), n = Array(12).fill(0);
    climate.tamb.forEach((t, i) => { const m = Math.min(11, Math.floor(Math.floor(i / 24) / 30.42)); mT[m] += t; n[m]++; mMax[m] = Math.max(mMax[m], t); });
    const mean = mT.map((v, i) => v / n[i]);
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 50, right: 50, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: MONTHS },
      yAxis: [{ type: 'value', name: '°C' }, { type: 'value', name: 'PUE', min: 1, max: 1.5, splitLine: { show: false } }],
      series: [
        { name: 'Mean air temperature', type: 'line', data: mean.map((v) => +v.toFixed(1)), itemStyle: { color: '#f59e0b' } },
        { name: 'Hottest hour', type: 'line', data: mMax.map((v) => +v.toFixed(1)), itemStyle: { color: '#dc2626' }, lineStyle: { type: 'dashed' } },
        { name: 'Average PUE', type: 'bar', yAxisIndex: 1, data: mean.map((t) => +(c.pueBase + c.pueSlopePerC * Math.max(0, t - c.pueRefC) + 0.01).toFixed(3)), itemStyle: { color: '#94a3b8' } },
      ],
    };
  }, [c.pueBase, c.pueSlopePerC, c.pueRefC]);

  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="GPUs" value={`${gpus} × ${c.model}`} sub={`${c.servers} servers · ${kw(r.itKw)} IT at full load`} tone="gpu" />
        <Kpi label="GPU-hours delivered" value={num(e.gpuHoursSold + e.flexGpuHours)} sub={`${num(e.gpuHoursSold)} at full price + ${num(e.flexGpuHours)} interruptible`} />
        <Kpi label="Compute revenue (year 1)" value={aud(revY1)} sub={`${aud(audPerHr, 2)} per GPU-hour list (US$${spec.priceUsdPerGpuHr.toFixed(2)})`} tone="good" />
        <Kpi label="Energy cost per GPU-hour" value={aud(energyCostPerGpuHr, 3)} sub={`Average PUE ${avgPue.toFixed(2)} · ${mwh(e.heatMwhTh)} waste heat`} />
      </Grid>
      <Grid cols={3}>
        <Card title="Fleet">
          <div className="gpu-cards">
            {(Object.keys(c.catalog) as GpuModel[]).map((m) => (
              <button key={m} type="button" className={`gpu-card ${m === c.model ? 'active' : ''}`} onClick={() => update((x) => { x.compute.model = m; })}>
                <b>{m}</b><span>{c.catalog[m].memoryGb} GB · {c.catalog[m].serverKw} kW/server</span><span>US${c.catalog[m].priceUsdPerGpuHr.toFixed(2)}/GPU-hr</span>
              </button>
            ))}
          </div>
          <Field label="Servers (8 GPUs each)" value={c.servers} min={0} max={96} step={1} onChange={(v) => update((x) => { x.compute.servers = v; })} />
          <Field label="Hours sold at full price" value={c.utilisationPct} min={0} max={100} step={1} unit="%" onChange={(v) => update((x) => { x.compute.utilisationPct = v; })} />
          <Toggle label="Sell idle hours as interruptible jobs" checked={c.flexEnabled} onChange={(v) => update((x) => { x.compute.flexEnabled = v; })} hint="Spot-style work that runs when energy is cheap or solar would be curtailed." />
          {c.flexEnabled && <Field label="Interruptible price" value={c.flexPricePct} min={0} max={100} step={1} unit="% of list" onChange={(v) => update((x) => { x.compute.flexPricePct = v; })} />}
        </Card>
        <Card title="Pricing & lifecycle">
          <Field label={`${c.model} rental price`} value={spec.priceUsdPerGpuHr} min={0.1} max={15} step={0.05} unit="US$/GPU-hr" onChange={(v) => update((x) => { x.compute.catalog[x.compute.model].priceUsdPerGpuHr = v; })}
            hint={<>Oct 2026 B200 market: US$7.99 on-demand, US$6.71 reserved, US$4.26 spot (<Ext href={SOURCES.bargo.url}>Bargo</Ext>)</>} />
          <Field label="Price decline within a hardware generation" value={c.priceDeclinePctYr} min={0} max={50} step={1} unit="%/yr" onChange={(v) => update((x) => { x.compute.priceDeclinePctYr = v; })} />
          <Field label="Refresh cycle" value={c.refreshYears} min={2} max={10} step={1} unit="yrs" onChange={(v) => update((x) => { x.compute.refreshYears = v; })} />
          <Field label="Server price" value={spec.serverCapexUsd} min={20000} max={1000000} step={5000} unit="US$" onChange={(v) => update((x) => { x.compute.catalog[x.compute.model].serverCapexUsd = v; })}
            hint={<>8-GPU HGX B200 servers quote US$400-500k (<Ext href={SOURCES.mercatus.url}>Mercatus</Ext>)</>} />
          <Field label="Marketplace fee" value={c.marketplaceFeePct} min={0} max={40} step={1} unit="%" onChange={(v) => update((x) => { x.compute.marketplaceFeePct = v; })} />
        </Card>
        <Card title="Facility">
          <Field label="PUE at ≤22 °C" value={c.pueBase} min={1.02} max={1.6} step={0.01} onChange={(v) => update((x) => { x.compute.pueBase = v; })} hint="Rises 0.01 per °C above 22 °C (fans and adiabatic cooling)." />
          <Field label="Data hall, cooling & power" value={c.dcCapexPerKw} min={1000} max={15000} step={100} unit="A$/kW IT" onChange={(v) => update((x) => { x.compute.dcCapexPerKw = v; })} />
          <Field label="Platform height above ground" value={c.padRaiseM} min={0} max={5} step={0.1} unit="m" onChange={(v) => update((x) => { x.compute.padRaiseM = v; })} hint={`Platform at ${(s.site.padGroundM + c.padRaiseM).toFixed(1)} m AHD`} />
          <Toggle label="Pipe waste heat to the greenhouse" checked={c.heatToGreenhouse} onChange={(v) => update((x) => { x.compute.heatToGreenhouse = v; })} hint={`${pct(r.ag.greenhouseHeatCoverPct / 100, 0)} of greenhouse heating covered`} />
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card title="Compute revenue over time" subtitle="Rental prices fall each year until the hardware is refreshed.">
          <EChart option={byYear} height={340} />
        </Card>
        <Card title="Cooling climate" subtitle="Taree typical year (PVGIS): mild winters keep PUE low; humid summer afternoons push it up.">
          <EChart option={pueChart} height={340} />
        </Card>
      </Grid>
      <Card title="Which GPU earns most per server?" subtitle="Year-1 revenue at today's utilisation settings, before energy and staff costs.">
        <table className="table">
          <thead><tr><th>GPU</th><th>Price</th><th>Server cost</th><th>kW</th><th>Revenue / server / yr</th><th>Revenue per kW</th><th>Simple payback</th></tr></thead>
          <tbody>
            {catalogRows.map((row) => (
              <tr key={row.m} className={row.m === c.model ? 'selected' : ''}>
                <td><b>{row.m}</b> <span className="muted small">{row.g.label}</span></td>
                <td>US${row.g.priceUsdPerGpuHr.toFixed(2)}/hr</td>
                <td>US${num(row.g.serverCapexUsd / 1000)}k</td>
                <td>{row.g.serverKw}</td>
                <td>{aud(row.rev)}</td>
                <td>{aud(row.perKw)}</td>
                <td>{row.payback.toFixed(1)} yrs</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note tone="warn">GPU hosting dominates both upside and risk: rental prices have swung by more than half within two years before. See the Risk tab for the spread of outcomes, and treat allocation of new Blackwell servers to small buyers as uncertain.</Note>
      </Card>
    </div>
  );
}
