import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Segmented, Toggle, Ext } from '../components';
import { SiteMap } from '../SiteMap';
import { site } from '../data';
import { num, kwp, PV_LABEL } from '../format';
import { fpl } from '../../engine/model';
import type { PvType } from '../../engine/types';

const GCR_RANGE: Record<PvType, [number, number]> = { fixed: [0.2, 0.5], tracker: [0.2, 0.45], vertical: [0.1, 0.35] };

export function SiteTab() {
  const { scenario: s, result: r, update } = useApp();
  const e = site.elevation;
  const p = site.planning;
  return (
    <div className="stack">
      <Card title="Site and proposed layout" subtitle="NSW aerial imagery (2021, 15 cm) with the cadastral boundary, LiDAR ground levels and the generated array layout. Toggle layers on the right.">
        <SiteMap result={r} height={640} initialLayers={{ layout: true, labels: true }} />
      </Card>
      <Grid cols={3}>
        <Card title="Array layout">
          <Segmented label="Mounting" value={s.pv.type} onChange={(v) => update((x) => { x.pv.type = v; const [lo, hi] = GCR_RANGE[v]; x.pv.gcr = Math.min(hi, Math.max(lo, x.pv.gcr)); })}
            options={[{ value: 'fixed', label: 'Fixed tilt' }, { value: 'tracker', label: 'Tracker' }, { value: 'vertical', label: 'Vertical' }]} />
          <Field label="Share of available zone used" value={s.pv.fillPct} min={0} max={100} step={5} unit="%" onChange={(v) => update((x) => { x.pv.fillPct = v; })} />
          <Field label="Ground coverage ratio" value={s.pv.gcr} min={GCR_RANGE[s.pv.type][0]} max={GCR_RANGE[s.pv.type][1]} step={0.01} onChange={(v) => update((x) => { x.pv.gcr = v; })}
            hint={`Row pitch ${num(r.layout.pitchM, 1)} m. Lower ratios leave more light for pasture.`} />
          {s.pv.type !== 'vertical' && <Field label="Lowest module edge above ground" value={s.pv.clearanceM} min={0.8} max={6} step={0.1} unit="m" onChange={(v) => update((x) => { x.pv.clearanceM = v; })}
            hint={`${(s.site.groundLevelM + s.pv.clearanceM).toFixed(1)} m AHD vs flood planning level ${fpl(s).toFixed(1)} m AHD`} />}
          {s.pv.type === 'fixed' && <Field label="Tilt (north)" value={s.pv.tiltDeg} min={0} max={40} step={1} unit="°" onChange={(v) => update((x) => { x.pv.tiltDeg = v; })} />}
          <Toggle label="Keep the paddock trees" checked={s.pv.keepTrees} onChange={(v) => update((x) => { x.pv.keepTrees = v; })} hint="Shade for stock and koala habitat; costs about 1.2 ha of array area." />
        </Card>
        <Card title="What fits">
          <Grid cols={2}>
            <Kpi label="Rows" value={num(r.layout.rows.length)} sub={`${num(r.layout.totalRowM)} m of row`} />
            <Kpi label="Capacity" value={kwp(r.layout.kwdc)} sub={`${(r.layout.kwdc / Math.max(0.01, r.layout.arrayAreaHa)).toFixed(0)} kWp per ha of array`} tone="solar" />
            <Kpi label="Array area" value={`${r.layout.arrayAreaHa.toFixed(2)} ha`} sub={`of ${r.layout.zoneAreaHa.toFixed(2)} ha available`} />
            <Kpi label="Grazed under panels" value={`${r.ag.underArrayHa.toFixed(2)} ha`} sub={`pasture at ${(r.ag.pastureFactor * 100).toFixed(0)}% of open paddock`} tone="farm" />
          </Grid>
          <p className="small muted">{PV_LABEL[s.pv.type]}: {s.pv.type === 'fixed' ? 'east-west rows of two portrait modules facing north' : s.pv.type === 'tracker' ? 'north-south rows of one portrait module that follow the sun with backtracking' : 'north-south fences of two landscape bifacial modules facing east and west'}.
            The available zone keeps 10 m inside the boundary for a fire break and track, 40 m off the northern tree line (winter shading) and 32 m clear of the house block and cabins.</p>
        </Card>
        <Card title="Lot facts" subtitle={<>Sources: <Ext href={site.sources[0].url}>NSW cadastre</Ext>, <Ext href={site.sources[1].url}>Planning Portal</Ext>, <Ext href={site.sources[4].url}>5 m LiDAR</Ext></>}>
          <table className="table compact">
            <tbody>
              <tr><th>Title</th><td>{site.lotPlan}</td></tr>
              <tr><th>Area</th><td>{site.areaHa.toFixed(2)} ha ({(site.areaHa * 2.471).toFixed(1)} acres), perimeter {num(site.perimeterM)} m</td></tr>
              <tr><th>Zoning</th><td>RU1 {site.zones.RU1.areaHa.toFixed(2)} ha ({p.zoning.RU1?.pct}%) · R5 {site.zones.R5.areaHa.toFixed(2)} ha ({p.zoning.R5?.pct}%) under the {p.lep}</td></tr>
              <tr><th>Minimum lot size</th><td>40 ha (RU1), 1.5 ha (R5): no subdivision potential</td></tr>
              <tr><th>Building height</th><td>{p.maxBuildingHeightM} m maximum</td></tr>
              <tr><th>Ground level</th><td>{e.minM.toFixed(2)}-{e.maxM.toFixed(2)} m AHD, median {e.medianM.toFixed(2)}; {e.haAbove['3']?.toFixed(2)} ha above 3 m (the house block)</td></tr>
              <tr><th>Design floods</th><td>20% AEP 2.0 · 5% 3.1 · 1% 4.1 · PMF 7.3 m AHD (Cundletown); flood planning level {fpl(s).toFixed(1)} m AHD</td></tr>
              <tr><th>Acid sulfate soils</th><td>{site.acidSulfate.map((a) => `${a.cls} ${a.areaHa.toFixed(1)} ha`).join(' · ')}</td></tr>
              <tr><th>Bush fire</th><td>{p.bushfire}</td></tr>
              <tr><th>Other overlays</th><td>Koala Management Area; Coastal Environment Area; airport obstacle surface {p.obstacleLimitationSurfaceM} m; no heritage item</td></tr>
            </tbody>
          </table>
        </Card>
      </Grid>
      <Note tone="info">The layout is generated from the cadastral boundary and indicative setbacks. Tree, dam, track and building positions are digitised from aerial imagery and need a detail survey before design.</Note>
    </div>
  );
}
