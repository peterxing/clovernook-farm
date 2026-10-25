import { useApp } from '../state';
import { Card, Field, Grid, Kpi, Note, Segmented, Toggle, Ext } from '../components';
import { aud, num, pct } from '../format';
import { fpl } from '../../engine/model';
import { SOURCES } from '../../engine/params';

export function HomesTab() {
  const { scenario: s, result: r, update } = useApp();
  const h = s.homes;
  const hm = r.homes;
  const net = hm.revenue - hm.opex;
  return (
    <div className="stack">
      <Grid cols={4}>
        <Kpi label="Homes on the lot" value={num(hm.dwellings)} sub={`${h.cabins} cabins${h.grannyFlat ? ' + granny flat' : ''} + homestead`} tone="homes" />
        <Kpi label="Rent & stays (year 1)" value={aud(hm.revenue)} sub={`${aud(net)} after operating costs`} tone="good" />
        <Kpi label="Guest nights" value={num(hm.guestNights)} sub={`${pct(h.cabinOccupancyPct / 100, 0)} occupancy at ${aud(h.cabinAdr)}/night`} />
        <Kpi label="Yield on new-build cost" value={hm.capex > 0 ? pct((net - (h.houseMode === 'rent' ? (hm.lines[0]?.revenue ?? 0) - (hm.lines[0]?.opex ?? 0) : 0)) / hm.capex) : 'n/a'} sub={`${aud(hm.capex)} for new dwellings`} />
      </Grid>
      <Grid cols={3}>
        <Card title="Existing homestead">
          <Segmented label="Use" value={h.houseMode} onChange={(v) => update((x) => { x.homes.houseMode = v; })} options={[{ value: 'rent', label: 'Lease it' }, { value: 'owner', label: 'Live in it' }]} />
          {h.houseMode === 'rent' && <Field label="Weekly rent" value={h.houseWeeklyRent} min={300} max={1500} step={10} unit="A$/wk" onChange={(v) => update((x) => { x.homes.houseWeeklyRent = v; })}
            hint={<>Four oversized bedrooms, three living areas and a self-contained wing on 32 acres. Taree vacancy is 1.32% (<Ext href={SOURCES.rent.url}>HtAG, Oct 2026</Ext>).</>} />}
          <p className="small muted">The house block sits on the highest ground (about 4-5 m AHD), close to the 0.2% AEP flood level and just under the {fpl(s).toFixed(1)} m AHD flood planning level.</p>
        </Card>
        <Card title="Granny flat">
          <Toggle label="Build a 60 m² secondary dwelling" checked={h.grannyFlat} onChange={(v) => update((x) => { x.homes.grannyFlat = v; })} hint="Permitted with consent in RU1 and R5; sited on the house block." />
          <Field label="Weekly rent" value={h.grannyWeeklyRent} min={150} max={800} step={10} unit="A$/wk" onChange={(v) => update((x) => { x.homes.grannyWeeklyRent = v; })} />
          <Field label="Build cost" value={h.grannyCapex} min={80000} max={450000} step={5000} unit="A$" onChange={(v) => update((x) => { x.homes.grannyCapex = v; })} />
        </Card>
        <Card title="Farm-stay cabins">
          <Field label="Cabins" value={h.cabins} min={0} max={12} step={1} onChange={(v) => update((x) => { x.homes.cabins = v; })} hint="NSW agritourism rules allow farm stays as complying development within limits; more needs a full DA." />
          <Field label="Nightly rate" value={h.cabinAdr} min={60} max={600} step={5} unit="A$" onChange={(v) => update((x) => { x.homes.cabinAdr = v; })} />
          <Field label="Occupancy" value={h.cabinOccupancyPct} min={0} max={100} step={1} unit="%" onChange={(v) => update((x) => { x.homes.cabinOccupancyPct = v; })} />
          <Field label="Build cost per cabin" value={h.cabinCapex} min={50000} max={500000} step={5000} unit="A$" onChange={(v) => update((x) => { x.homes.cabinCapex = v; })} />
        </Card>
      </Grid>
      <Card title="Rental income by dwelling (year 1)">
        <table className="table">
          <thead><tr><th>Dwelling</th><th>Units</th><th>Revenue</th><th>Operating costs</th><th>Net</th></tr></thead>
          <tbody>
            {hm.lines.map((l) => <tr key={l.label}><td>{l.label}</td><td>{l.units}</td><td>{aud(l.revenue)}</td><td>{aud(l.opex)}</td><td><b>{aud(l.revenue - l.opex)}</b></td></tr>)}
            {hm.lines.length === 0 && <tr><td colSpan={5} className="muted">No rented dwellings in this plan.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Grid cols={2}>
        <Card title="Designing homes for a floodplain">
          <ul className="facts">
            <li><b>Floors at the flood planning level.</b> New cabins and the granny flat sit on piers with floors at {fpl(s).toFixed(1)} m AHD (A${num(h.raisedFloorPremium)} extra each), the Queenslander answer to a floodplain.</li>
            <li><b>Evacuation first.</b> Short-stay guests leave on a Bureau of Meteorology flood warning, which usually comes a day or more ahead on the Manning. Bookings close when the Taree gauge forecast passes a trigger level.</li>
            <li><b>Energy included.</b> Tenants buy solar power at {aud(h.tenantEnergyPricePerKwh, 2)}/kWh through an exempt embedded network, which is a draw for renters.</li>
            <li><b>Farm experience.</b> Guests can see the stock, the greenhouse and a working solar and compute farm, which sets these cabins apart from other short stays.</li>
          </ul>
        </Card>
        <Card title="Planning notes">
          <Note tone="warn">Cabins add people to a flood-prone area. MidCoast Council will expect a flood emergency response plan and may cap numbers. The base plan stays within the agritourism complying-development scale.</Note>
          <Note tone="info">The R5 house block has a 1.5 ha minimum lot size and the RU1 land 40 ha, so the lot can't be subdivided. Extra homes are a secondary dwelling (granny flat), a dual occupancy, or farm-stay accommodation.</Note>
        </Card>
      </Grid>
    </div>
  );
}
