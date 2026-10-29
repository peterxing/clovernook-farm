import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Grid, Note, Pill, Ext } from '../components';
import { site } from '../data';
import { fpl } from '../../engine/model';
import { DELIVERY_PLAN, schedulePlan } from '../../engine/delivery';
import { monthYear } from '../format';

type Status = 'consent' | 'without' | 'confirm' | 'limited';
const pill = (st: Status, text?: string) => {
  const map = { consent: ['good', 'Permitted with consent'], without: ['good', 'Permitted without consent'], confirm: ['warn', 'Confirm with Council'], limited: ['info', 'Permitted, with limits'] } as const;
  return <Pill tone={map[st][0]}>{text ?? map[st][1]}</Pill>;
};

export function ApprovalsTab() {
  const { scenario: s, result: r, go } = useApp();
  const level = fpl(s);
  const sched = useMemo(() => schedulePlan(DELIVERY_PLAN, s, r), [s, r]);
  const milestones = ['pre-da', 'da-lodge', 'da-determined', 'connection-offer', 'fid', 'energise', 'gpus-live', 'cabins-open', 'operating']
    .map((id) => sched.byId[id])
    .filter((x) => x !== undefined)
    .sort((a, b) => a.end - b.end);
  const rows: { use: string; ru1: Status; r5: Status; basis: string }[] = [
    { use: 'Solar array (electricity generating works)', ru1: 'consent', r5: 'confirm', basis: 'SEPP (Transport and Infrastructure) 2021 allows electricity generating works with consent in prescribed rural zones such as RU1. Keep the array on the RU1 land.' },
    { use: 'Battery storage', ru1: 'consent', r5: 'confirm', basis: 'Assessed with the solar works or as ancillary development; hazard screening under SEPP (Resilience and Hazards) 2021.' },
    { use: 'GPU compute containers', ru1: 'confirm', r5: 'confirm', basis: 'Characterisation is the key question: data centre, high technology industry or ancillary to the energy facility. RU1 allows "any other development" not listed as prohibited. Raise it at a pre-DA meeting.' },
    { use: 'Grazing & beekeeping (extensive agriculture)', ru1: 'without', r5: 'confirm', basis: 'Normal rural use of RU1 land.' },
    { use: 'Greenhouse (intensive plant agriculture)', ru1: 'consent', r5: 'confirm', basis: 'Listed as permitted with consent in the RU1 zone.' },
    { use: 'Farm-stay cabins', ru1: 'consent', r5: 'confirm', basis: 'Farm stay accommodation is permitted with consent in RU1; the Codes SEPP agritourism provisions may allow complying development within set limits.' },
    { use: 'Secondary dwelling (granny flat)', ru1: 'consent', r5: 'consent', basis: 'Permitted with consent; floor at the flood planning level.' },
    { use: 'Dual occupancy', ru1: 'consent', r5: 'confirm', basis: 'Listed as permitted with consent in RU1.' },
    { use: 'Subdivision', ru1: 'limited', r5: 'limited', basis: 'Not possible: minimum lot sizes are 40 ha (RU1) and 1.5 ha (R5).' },
    { use: 'Livestock refuge mound & raised pads', ru1: 'consent', r5: 'consent', basis: 'Earthworks need consent and a flood impact assessment showing no loss of floodplain storage.' },
  ];
  const studies = [
    ['Flood impact & risk assessment', `Confirm site design flood levels with MidCoast Council; show modules, platform and floors at or above ${level.toFixed(1)} m AHD; no net loss of floodplain storage; flood emergency response plan for residents and guests.`],
    ['Acid sulfate soils management plan', `Class 2a/2b over ~95% of the lot (Greater Taree LEP 2010 acid sulfate soils map): piling, trenching and the refuge mound need a preliminary ASS investigation.`],
    ['Bush fire assessment (PBP 2019)', 'Category 3 grassland: asset protection zones around the array, platform and dwellings; access for fire tankers.'],
    ['Glint & glare', `${site.airport.name} is about 2.3 km south; airport obstacle surface ${site.planning.obstacleLimitationSurfaceM} m.`],
    ['Biodiversity & koala', 'Koala Management Area: retain paddock trees, check clearing against the Biodiversity Offsets Scheme thresholds.'],
    ['Acoustic assessment', 'GPU cooling and inverter noise at the homestead, cabins and neighbours, day and night.'],
    ['Grid connection', 'Essential Energy preliminary enquiry, then the connection application and network studies for import and export on the local 11 kV feeder (Chapter 5A under 5 MW, 2-3 years end to end).'],
    ['Traffic & access', 'Construction traffic on Clovernook Drive; all-weather access to the platform; flood evacuation route.'],
    ['Visual & landscape', 'Screen planting along boundaries; the Coastal Environment Area applies to part of the land.'],
  ];
  return (
    <div className="stack">
      <Card title="Approvals pathway by use" subtitle={<>Greater Taree LEP 2010 as amended (Map Amendment No 6, Oct 2025). Zoning from the <Ext href={site.sources[1].url}>NSW Planning Portal</Ext>. This is a screening view, not legal advice.</>}>
        <table className="table">
          <thead><tr><th>Use</th><th>RU1 Primary Production ({site.zones.RU1.areaHa.toFixed(1)} ha)</th><th>R5 Large Lot Residential ({site.zones.R5.areaHa.toFixed(1)} ha)</th><th>Basis</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.use}><td><b>{r.use}</b></td><td>{pill(r.ru1)}</td><td>{pill(r.r5)}</td><td className="small">{r.basis}</td></tr>)}
          </tbody>
        </table>
      </Card>
      <Grid cols={2}>
        <Card title="Studies the development application will need">
          <ul className="facts">{studies.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}</ul>
        </Card>
        <Card title="Programme" subtitle={`Key dates from the delivery plan, updated daily; work starting ${monthYear(sched.start)}.`} actions={<button type="button" className="btn small" onClick={() => go('delivery')}>Full delivery plan</button>}>
          <ol className="timeline">{milestones.map((m) => <li key={m.id}><span className="when">{monthYear(m.endDate)}</span><span><b>{m.title}.</b> <span className="small muted">{m.who}</span></span></li>)}</ol>
          <Note tone="info">The grid connection, not the DA, sets the pace. Build on the floodplain in the drier months (late winter to spring) and order long-lead items early: the HV transformer and switchgear, the battery and the Blackwell servers.</Note>
        </Card>
      </Grid>
      <Note tone="warn">The strongest planning story is a primary-production site that keeps grazing under elevated panels, keeps the paddock trees and floodplain storage, and adds homes only at a scale MidCoast Council and the SES can support.</Note>
    </div>
  );
}
