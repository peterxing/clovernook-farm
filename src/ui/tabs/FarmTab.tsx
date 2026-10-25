import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Select, Toggle, Ext } from '../components';
import { EChart, PALETTE } from '../EChart';
import { site } from '../data';
import { aud, num, pct, USE_LABEL } from '../format';
import { floodAep } from '../../engine/solar';
import { fpl } from '../../engine/model';
import { SOURCES } from '../../engine/params';
import type { OpenLandUse, UnderArrayUse } from '../../engine/types';

export function FarmTab() {
  const { scenario: s, result: r, update } = useApp();
  const a = s.ag;
  const ag = r.ag;
  const paddockAep = floodAep(s.site.groundLevelM + 0.3, s.site.floodOffsetM);
  const cattleOk = s.pv.type !== 'vertical' && s.pv.clearanceM >= 3.5;

  const land = useMemo(() => {
    const house = Math.max(0, site.areaHa - site.zones.RU1.areaHa);
    const under = ag.underArrayHa, open = Math.max(0, ag.openHa - Math.max(0, site.areaHa - site.zones.RU1.areaHa - 0.75));
    const infra = Math.max(0, site.zones.RU1.areaHa - under - open);
    const data = [
      { name: 'Grazed under panels', value: +under.toFixed(2), itemStyle: { color: '#2563eb' } },
      { name: 'Open paddock', value: +open.toFixed(2), itemStyle: { color: PALETTE.farm } },
      { name: 'Buffers, trees, dam, tracks & infrastructure', value: +infra.toFixed(2), itemStyle: { color: '#a3a3a3' } },
      { name: 'House block (R5)', value: +house.toFixed(2), itemStyle: { color: PALETTE.homes } },
    ];
    return {
      tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${p.value} ha</b> (${p.percent}%)` },
      legend: { bottom: 0 },
      series: [{ type: 'pie', radius: ['40%', '70%'], center: ['50%', '42%'], label: { formatter: '{b}\n{c} ha', fontSize: 11 }, data }],
    };
  }, [ag]);

  const gm = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => aud(v) },
    grid: { left: 280, right: 30, top: 10, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => aud(v) } },
    yAxis: { type: 'category', data: ag.lines.map((l) => l.label), inverse: true, axisLabel: { width: 270, overflow: 'truncate' } },
    series: [{ type: 'bar', data: ag.lines.map((l) => ({ value: Math.round(l.value), itemStyle: { color: l.value >= 0 ? PALETTE.farm : PALETTE.neg } })) }],
  }), [ag]);

  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="Livestock" value={`${num(ag.dse)} DSE`} sub={`≈ ${num(ag.dse / 10)} cattle or ${num(ag.dse / 1.5)} ewes with lambs`} tone="farm" />
        <Kpi label="Pasture under panels" value={pct(ag.pastureFactor, 0)} sub={`of open-paddock growth at ground cover ${s.pv.gcr}`} />
        <Kpi label="Farm gross margin" value={aud(ag.grossMargin)} sub="year 1, before land and overheads" tone="good" />
        <Kpi label="Land equivalent ratio" value={ag.ler.toFixed(2)} sub={`${ag.lerSolar.toFixed(2)} solar + ${ag.lerAg.toFixed(2)} farm output from the same land`} tone="farm" />
      </Grid>
      <Grid cols={3}>
        <Card title="Grazing">
          <Select<UnderArrayUse> label="Under the panels" value={a.underArray} onChange={(v) => update((x) => { x.ag.underArray = v; })}
            options={[{ value: 'sheep', label: 'Sheep (solar grazing)' }, { value: 'cattle', label: cattleOk ? 'Cattle (clearance allows)' : 'Cattle (needs ≥3.5 m clearance)' }, { value: 'poultry', label: 'Free-range laying hens' }, { value: 'none', label: 'Not grazed (slashed)' }]} />
          <Select<OpenLandUse> label="Open paddocks" value={a.openLand} onChange={(v) => update((x) => { x.ag.openLand = v; })}
            options={[{ value: 'cattle', label: 'Cattle (coastal weaners)' }, { value: 'sheep', label: 'Sheep (prime lambs)' }, { value: 'hay', label: 'Hay / silage' }, { value: 'none', label: 'Not farmed' }]} />
          <Field label="Carrying capacity" value={a.dsePerHa} min={2} max={25} step={0.5} unit="DSE/ha" onChange={(v) => update((x) => { x.ag.dsePerHa = v; })} hint="Improved kikuyu, ryegrass and clover on the Manning floodplain." />
          <Toggle label="Build a livestock flood refuge mound" checked={a.refugeMound} onChange={(v) => update((x) => { x.ag.refugeMound = v; })} hint={`The paddock floods in roughly ${pct(Math.min(1, paddockAep), 0)} of years; the mound top sits at ${fpl(s).toFixed(1)} m AHD.`} />
        </Card>
        <Card title="Heat-recovery greenhouse & bees">
          <Field label="Greenhouse area" value={a.greenhouseM2} min={0} max={5000} step={50} unit="m²" onChange={(v) => update((x) => { x.ag.greenhouseM2 = v; })} />
          <Field label="Gross margin when heated" value={a.greenhouseGmPerM2} min={0} max={200} step={1} unit="A$/m²/yr" onChange={(v) => update((x) => { x.ag.greenhouseGmPerM2 = v; })} hint="Hydroponic tomatoes, cucumbers or herbs; unheated houses earn about 60% of this." />
          <Field label="Beehives" value={a.hives} min={0} max={80} step={1} onChange={(v) => update((x) => { x.ag.hives = v; })} hint="Pollinator forage can be sown between rows." />
          <p className="small muted">GPU waste heat covers <b>{pct(ag.greenhouseHeatCoverPct / 100, 0)}</b> of the greenhouse's winter heating need ({num(a.greenhouseM2 * a.greenhouseHeatKwhPerM2Yr / 1000)} MWh/yr).</p>
        </Card>
        <Card title="Land use">
          <EChart option={land} height={300} />
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card title="Gross margin by enterprise (year 1)">
          <EChart option={gm} height={Math.max(180, 50 * ag.lines.length + 40)} />
          <p className="small muted">Sheep {aud(a.sheepGmPerDse)}/DSE (<Ext href={SOURCES.dpiSheep.url}>NSW DPIRD 2025 prime lamb budget</Ext>); cattle {aud(a.cattleGmPerDse)}/DSE (<Ext href={SOURCES.dpiBeef.url}>NSW DPI 2025 coastal weaners</Ext>).</p>
        </Card>
        <Card title="Farming on a floodplain under panels">
          <ul className="facts">
            <li><b>{USE_LABEL[a.underArray]} under the array.</b> Panels {s.pv.type === 'vertical' ? 'stand as fences between wide alleys' : `start ${s.pv.clearanceM.toFixed(1)} m above ground`}, so stock shelter from heat and rain while pasture keeps about {pct(ag.pastureFactor, 0)} of its open-paddock growth.</li>
            <li><b>No mowing contract.</b> Grazing replaces about A${num(s.pv.vegMgmtPerHaYr)}/ha/yr of slashing a conventional solar farm pays.</li>
            <li><b>Flood routine.</b> Floodwater over 0.3 m reaches the paddock in roughly {pct(Math.min(1, paddockAep), 0)} of years. BoM flood warnings give a day or more to move stock onto the refuge mound or off-site.</li>
            <li><b>Acid sulfate soils.</b> Keep drains as they are and avoid deep cultivation; piles go in under an ASS management plan.</li>
          </ul>
          <Note tone="info">Blueberries and avocados, the Mid North Coast's high-value crops, don't tolerate waterlogging, so this plan keeps the low paddock in pasture and puts intensive cropping in the greenhouse.</Note>
        </Card>
      </Grid>
    </div>
  );
}
