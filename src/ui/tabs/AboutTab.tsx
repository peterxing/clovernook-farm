import { Card, Grid, Ext } from '../components';
import { climate, prices, site } from '../data';
import { SOURCES } from '../../engine/params';

export function AboutTab() {
  return (
    <div className="stack">
      <Grid cols={2}>
        <Card title="What this is">
          <p>An open, interactive planning model for turning <b>{site.address}</b> ({site.lotPlan}, {site.areaHa.toFixed(1)} ha) into a layered farm: agrivoltaic solar over grazing, a battery, a GPU compute platform, a heat-recovery greenhouse, and rental homes around the edges, sized for the highest return the site supports.</p>
          <p>Everything runs in your browser. Each change re-simulates a full year hour by hour (8,760 hours) and a {25}-year cash flow in a few milliseconds, which is what lets the optimiser test hundreds of designs a second.</p>
          <p className="small muted">A concept study for discussion. It is not financial, engineering, planning or legal advice, and it isn't affiliated with the owner, vendor or selling agent of the property.</p>
        </Card>
        <Card title="How the model works">
          <ol className="facts">
            <li><b>Layout.</b> Rows are laid inside the available zone of the RU1 paddock (cadastre minus fire breaks, the northern tree line, the dam, the house block and optionally the paddock trees). Row length × modules per metre gives the DC capacity.</li>
            <li><b>Solar.</b> Sun position (NOAA), Hay-Davies transposition, row-to-row shading (fixed and vertical) or backtracking (trackers), bifacial rear gain that improves with clearance, and Faiman cell temperature, on an hourly typical year.</li>
            <li><b>Loads.</b> GPU servers draw power by utilisation with a temperature-dependent PUE; idle GPUs can sell interruptible jobs when energy is cheap. Homes, farm and greenhouse loads follow typical daily shapes.</li>
            <li><b>Dispatch.</b> Each hour, solar serves load, then storage, export (never at negative prices) or curtailment. The battery uses daily price thresholds with day-ahead foresight and keeps a reserve whenever the GPUs would otherwise exceed the import limit.</li>
            <li><b>Farm & homes.</b> Grazing scales with pasture under panels (falling with ground cover), stocking rates and NSW DPI gross margins; rentals use local rents and short-stay rates.</li>
            <li><b>Money.</b> Capex by component, escalating revenue and cost lines, GPU price decline and hardware refreshes, inverter and battery replacements, expected flood losses, and NPV/IRR/payback on pre-tax, unlevered cash flows (with optional debt).</li>
            <li><b>Optimiser & risk.</b> Multi-start coordinate descent over 17 decisions; tornado sensitivity and Monte Carlo over every ranged assumption.</li>
          </ol>
        </Card>
      </Grid>
      <Card title="Data sources">
        <table className="table compact">
          <tbody>
            <tr><th>Lot boundary & address</th><td><Ext href={site.sources[0].url}>NSW Spatial Services cadastre</Ext> (CC BY 4.0)</td></tr>
            <tr><th>Zoning, lot size, height, overlays</th><td><Ext href={site.sources[1].url}>NSW Planning Portal EPI layers</Ext>, <Ext href={site.sources[2].url}>protection</Ext> and <Ext href={site.sources[3].url}>hazard</Ext> layers (CC BY 4.0)</td></tr>
            <tr><th>Ground levels</th><td><Ext href={site.sources[4].url}>NSW 5 m LiDAR DEM</Ext>, sampled on a 10 m grid</td></tr>
            <tr><th>Aerial imagery & base maps</th><td>NSW Spatial Services NSW_Imagery / NSW_Base_Map tile services (CC BY 4.0)</td></tr>
            <tr><th>Design flood levels</th><td><Ext href={SOURCES.frms.url}>Manning River Floodplain Risk Management Study and Plan</Ext> (BMT for MidCoast Council, 2020, CC BY 4.0), Tables 4-2 and 4-3, Dumaresq Island (Cundletown) reporting point</td></tr>
            <tr><th>Weather</th><td><Ext href={climate.url}>{climate.source}</Ext>. Beam irradiance scaled by {climate.dniScale} so annual DNI matches NASA POWER's climatology for the site; global irradiance unchanged.</td></tr>
            <tr><th>Electricity prices</th><td><Ext href={SOURCES.aemo.url}>{prices.source}</Ext>, {prices.period}. Mean A${prices.intervalMean.toFixed(2)}/MWh; {(prices.negativeIntervalShare * 100).toFixed(1)}% of intervals negative.</td></tr>
            <tr><th>Costs & market prices</th><td>See the Assumptions tab: each value links to its source (Bargo and GPU.ai GPU rental indices, Mercatus and Gatewell server prices, Modo Energy battery costs, Essential Energy tariffs, Ecovantage LGC prices, NSW DPI gross margins, HtAG rental data, RBA exchange rate).</td></tr>
          </tbody>
        </table>
      </Card>
      <Card title="Known limitations">
        <ul className="facts">
          <li>Flood levels come from the nearest published reporting point, not a site flood study; local drainage, levees and the Dawson River arm may change them.</li>
          <li>A single typical weather year and one year of NEM prices; no explicit modelling of future market structure, network constraints or curtailment by AEMO.</li>
          <li>GPU revenue assumes a market for the capacity at the stated utilisation; contracts, latency needs and data sovereignty requirements of buyers are not modelled.</li>
          <li>Pre-tax analysis. Depreciation, GST, land tax treatment, grants and the Capacity Investment Scheme are not included.</li>
          <li>The layout is indicative. Existing structures, trees and drains are digitised from imagery and need survey.</li>
        </ul>
      </Card>
      <p className="small muted">Source code: <Ext href="https://github.com/peterxing/clovernook-farm">github.com/peterxing/clovernook-farm</Ext> · MIT licence · Data generated {site.generated}.</p>
    </div>
  );
}
