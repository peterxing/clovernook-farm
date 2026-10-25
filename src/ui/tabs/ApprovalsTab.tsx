import { useApp } from '../state';
import { Card, Grid, Note, Pill, Ext } from '../components';
import { site } from '../data';
import { fpl } from '../../engine/model';

type Status = 'consent' | 'without' | 'confirm' | 'limited';
const pill = (st: Status, text?: string) => {
  const map = { consent: ['good', 'Permitted with consent'], without: ['good', 'Permitted without consent'], confirm: ['warn', 'Confirm with Council'], limited: ['info', 'Permitted, with limits'] } as const;
  return <Pill tone={map[st][0]}>{text ?? map[st][1]}</Pill>;
};

export function ApprovalsTab() {
  const { scenario: s } = useApp();
  const level = fpl(s);
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
    ['Grid connection', 'Essential Energy connection enquiry, then detailed studies for import and export capacity on the local 11 kV feeder.'],
    ['Traffic & access', 'Construction traffic on Clovernook Drive; all-weather access to the platform; flood evacuation route.'],
    ['Visual & landscape', 'Screen planting along boundaries; the Coastal Environment Area applies to part of the land.'],
  ];
  const phases = [
    ['Now - 3 months', 'Due diligence: flood certificate, survey, geotech/ASS sampling, Essential Energy enquiry, pre-DA meeting, GPU offtake conversations.'],
    ['3 - 9 months', 'Specialist studies, concept design, DA lodgement (the regional planning panel may determine it, depending on capital investment value), connection studies.'],
    ['9 - 15 months', 'Determination, connection offer, procurement of modules, battery, platform and servers; farm-stay complying development certificates.'],
    ['15 - 24 months', 'Build the platform and array in dry seasons, energise, commission compute, open cabins, restock paddocks.'],
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
        <Card title="Indicative programme">
          <ol className="timeline">{phases.map(([t, d]) => <li key={t}><span className="when">{t}</span><span>{d}</span></li>)}</ol>
          <Note tone="info">Build on the floodplain in the drier months (late winter to spring) and order long-lead items early: HV switchgear, the battery and Blackwell servers.</Note>
        </Card>
      </Grid>
      <Note tone="warn">The strongest planning story is a primary-production site that keeps grazing under elevated panels, keeps the paddock trees and floodplain storage, and adds homes only at a scale MidCoast Council and the SES can support.</Note>
    </div>
  );
}
