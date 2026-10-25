import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Grid, Kpi, Note } from '../components';
import { SiteMap } from '../SiteMap';
import { EChart, PALETTE } from '../EChart';
import { contributions } from '../../engine/risk';
import { getContext, site } from '../data';
import { aud, kwp, mwh, num, pct, PV_LABEL, USE_LABEL, years } from '../format';
import { fpl } from '../../engine/model';

const STREAM_COLORS: Record<string, string> = {
  'GPU compute': PALETTE.gpu, 'Interruptible compute': PALETTE.flex, 'Energy exports': PALETTE.export, 'Battery services': PALETTE.battery,
  LGCs: '#facc15', 'Tenant energy': '#06b6d4', 'Rent & stays': PALETTE.homes, Agriculture: PALETTE.farm,
};

export function Overview() {
  const { scenario: s, result: r, go } = useApp();
  const contrib = useMemo(() => contributions(r.scenario, getContext()), [r.scenario]);
  const gpus = s.compute.servers * s.compute.catalog[s.compute.model].gpusPerServer;

  const waterfall = useMemo(() => {
    const items = [...contrib.items].sort((a, b) => b.npv - a.npv);
    const shared = contrib.total - items.reduce((a, i) => a + i.npv, 0);
    const all = [...items, { key: 'shared', label: 'Shared costs (approvals, connection, platform, contingency, rates)', npv: shared }];
    let run = 0;
    const base: number[] = [], pos: number[] = [], neg: number[] = [];
    for (const it of all) {
      const start = run, end = run + it.npv;
      base.push(Math.min(start, end)); pos.push(it.npv >= 0 ? it.npv : 0); neg.push(it.npv < 0 ? -it.npv : 0);
      run = end;
    }
    const labels = [...all.map((i) => i.label), 'Project NPV'];
    base.push(Math.min(0, contrib.total)); pos.push(contrib.total >= 0 ? contrib.total : 0); neg.push(contrib.total < 0 ? -contrib.total : 0);
    return {
      grid: { left: 250, right: 30, top: 10, bottom: 30 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { name: string; dataIndex: number }[]) => { const i = p[0].dataIndex; const v = i < all.length ? all[i].npv : contrib.total; return `${p[0].name}<br/><b>${aud(v)}</b>`; } },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => aud(v) } },
      yAxis: { type: 'category', data: labels, inverse: true, axisLabel: { width: 235, overflow: 'truncate' } },
      series: [
        { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, silent: true },
        { type: 'bar', stack: 'w', data: pos.map((v, i) => ({ value: v, itemStyle: { color: i === labels.length - 1 ? '#0f766e' : PALETTE.pos } })) },
        { type: 'bar', stack: 'w', data: neg.map((v, i) => ({ value: v, itemStyle: { color: i === labels.length - 1 ? '#7f1d1d' : PALETTE.neg } })) },
      ],
    };
  }, [contrib]);

  const mix = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${aud(p.value)}</b> (${p.percent}%)` },
    legend: { bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie', radius: ['45%', '72%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { formatter: '{b}\n{d}%', fontSize: 11 },
      data: Object.entries(r.year1.revenueByStream).filter(([, v]) => v > 1).map(([name, value]) => ({ name, value: Math.round(value), itemStyle: { color: STREAM_COLORS[name] } })),
    }],
  }), [r]);

  const sorted = [...contrib.items].sort((a, b) => b.npv - a.npv);
  const top2 = sorted.slice(0, 2).filter((i) => i.npv > 0);
  const losers = sorted.filter((i) => i.npv < 0 && i.key !== 'land');

  return (
    <div className="stack">
      <div className="hero">
        <div className="hero-text">
          <p className="eyebrow">Integrated land-use plan · {site.areaHa.toFixed(1)} ha · Manning River floodplain</p>
          <h2>One paddock, five harvests: sun, compute, food, heat and homes.</h2>
          <p className="lead">
            Panels on high-clearance frames lift the solar array above the flood planning level ({fpl(s).toFixed(1)} m AHD) so {USE_LABEL[s.ag.underArray].toLowerCase()} can graze
            underneath. A flood-raised platform carries the battery and {gpus > 0 ? `${gpus} ${s.compute.model} GPUs` : 'electrical gear'}, whose waste heat warms a greenhouse.
            Farm-stay cabins and the existing homestead sit on the edges of the paddock.
          </p>
          <ul className="layers">
            <li><span className="dot" style={{ background: PALETTE.solar }} /><b>{kwp(r.layout.kwdc)}</b> {PV_LABEL[s.pv.type].toLowerCase()}, {mwh(r.energy.pvAcMwh)}/yr</li>
            <li><span className="dot" style={{ background: PALETTE.battery }} /><b>{(r.bessKwh / 1000).toFixed(1)} MWh</b> battery, {num(r.energy.batteryCycles)} cycles/yr</li>
            <li><span className="dot" style={{ background: PALETTE.gpu }} /><b>{gpus} GPUs</b> ({s.compute.servers} × {s.compute.model}), {num(r.energy.gpuHoursSold + r.energy.flexGpuHours)} GPU-hours/yr</li>
            <li><span className="dot" style={{ background: PALETTE.farm }} /><b>{num(r.ag.dse)} DSE</b> of livestock{s.ag.greenhouseM2 > 0 ? ` + ${num(s.ag.greenhouseM2)} m² greenhouse` : ''}{s.ag.hives ? ` + ${s.ag.hives} hives` : ''}</li>
            <li><span className="dot" style={{ background: PALETTE.homes }} /><b>{r.homes.dwellings} homes</b>: the homestead{s.homes.grannyFlat ? ', a granny flat' : ''}{s.homes.cabins ? ` and ${s.homes.cabins} farm-stay cabins` : ''}</li>
          </ul>
          <div className="hero-actions">
            <button type="button" className="btn primary" onClick={() => go('optimise')}>Optimise for maximum yield</button>
            <button type="button" className="btn" onClick={() => go('site')}>Explore the site</button>
          </div>
        </div>
        <div className="hero-map">
          <SiteMap result={r} height={430} showControls={false} />
        </div>
      </div>

      <Grid cols={4}>
        <Kpi label="Net present value" value={aud(r.npv)} sub={`${s.finance.discountRatePct}% discount, ${s.finance.years} yrs${s.finance.includeLand ? ', incl. land' : ''}`} tone={r.npv >= 0 ? 'good' : 'bad'} />
        <Kpi label="Project IRR" value={pct(r.irr)} sub={`Payback ${years(r.paybackYears)}`} tone={(r.irr ?? -1) * 100 >= s.finance.discountRatePct ? 'good' : 'warn'} />
        <Kpi label="Capital cost" value={aud(r.capexTotal)} sub={`${aud(r.capexTotal / site.areaHa)} per hectare`} />
        <Kpi label="Year-1 EBITDA" value={aud(r.year1.ebitda)} sub={`${aud(r.ebitdaPerHa)}/ha on revenue of ${aud(r.year1.revenue)}`} tone="good" />
        <Kpi label="Solar" value={kwp(r.layout.kwdc)} sub={`${num(r.energy.specificYield)} kWh/kWp · ${pct(r.energy.selfSufficiencyPct / 100, 0)} of site load`} tone="solar" />
        <Kpi label="GPU compute" value={`${gpus} GPUs`} sub={`${aud(r.year1.revenueByStream['GPU compute'] + r.year1.revenueByStream['Interruptible compute'])} revenue in year 1`} tone="gpu" />
        <Kpi label="Land equivalent ratio" value={r.ag.ler.toFixed(2)} sub={`Solar ${r.ag.lerSolar.toFixed(2)} + farming ${r.ag.lerAg.toFixed(2)} on the same land`} tone="farm" />
        <Kpi label="CO₂ avoided" value={`${num(r.co2AvoidedT)} t/yr`} sub={`${mwh(r.energy.pvAcMwh)} solar vs NSW grid`} tone="farm" />
      </Grid>

      <Grid cols={2}>
        <Card title="Where the value comes from" subtitle="Each bar is the NPV of the plan minus the NPV without that element.">
          <EChart option={waterfall} height={360} />
          <p className="small muted">
            {top2.length > 0 && <>Most value comes from <b>{top2.map((t) => t.label.toLowerCase()).join(' and ')}</b>. </>}
            {losers.length > 0 && <>{losers.map((t) => t.label).join(', ')} {losers.length > 1 ? 'reduce' : 'reduces'} NPV under current assumptions. </>}
            The optimiser balances these within your budget and planning limits.
          </p>
        </Card>
        <Card title="Year-1 revenue mix" subtitle={`${aud(r.year1.revenue)} gross revenue, ${aud(r.year1.opex)} operating costs`}>
          <EChart option={mix} height={360} />
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card title="Site realities that shape the design">
          <ul className="facts">
            <li><b>Floodplain.</b> LiDAR puts 90% of the lot below {site.elevation.p90M.toFixed(1)} m AHD; the 20% AEP flood at Cundletown reaches 2.0 m and the 1% AEP 4.1 m. Everything valuable sits at or above {fpl(s).toFixed(1)} m AHD. <button type="button" className="link" onClick={() => go('risk')}>Flood exposure</button></li>
            <li><b>Zoning.</b> {site.planning.zoning.RU1?.pct}% RU1 Primary Production, {site.planning.zoning.R5?.pct}% R5 Large Lot Residential (house block). <button type="button" className="link" onClick={() => go('approvals')}>Approvals pathway</button></li>
            <li><b>Acid sulfate soils</b> class 2a/2b over 95% of the lot: piles and trenches need an ASS management plan.</li>
            <li><b>Bush fire prone</b> grassland (category 3) and <b>2.3 km from Taree Airport</b>: needs asset protection zones and a glint and glare study.</li>
          </ul>
        </Card>
        <Card title="Checks on this plan">
          {r.warnings.length === 0 ? <Note tone="good">No design warnings for this plan.</Note> : r.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
          <p className="small muted">The plan keeps {pct((r.ag.underArrayHa + r.ag.openHa) / site.areaHa, 0)} of the lot in grazing ({num(r.ag.underArrayHa, 1)} ha under panels, {num(r.ag.openHa, 1)} ha open).</p>
        </Card>
      </Grid>
    </div>
  );
}
