import type { Scenario } from './types';

export type ParamGroup = 'Solar' | 'Battery' | 'Grid & market' | 'Compute' | 'Agriculture' | 'Homes' | 'Robots' | 'Site & flood' | 'Finance';

export interface Source {
  title: string;
  url: string;
  date?: string;
}

export interface ParamMeta {
  path: string; // dot path into Scenario; "$model" resolves to the selected GPU model
  label: string;
  unit: string;
  group: ParamGroup;
  min: number;
  max: number;
  step: number;
  low?: number; // plausible range used by the tornado and Monte Carlo
  high?: number;
  relative?: boolean; // low/high are multipliers of the current value
  source?: Source;
  note?: string;
}

const S = {
  straightline: { title: 'Straight Line Estimating / Greenlight Solar: small (1-5 MW) Australian solar farms A$1.3-2.0/W', url: 'https://www.greenlightsolar.com.au/solar-farms-in-australia-costs-pros-and-cons-explained/', date: '2026' },
  modo: { title: 'Modo Energy: battery build cost in Australia (2026), ~A$480/kWh for 1-hour systems', url: 'https://modoenergy.com/research/en/australia-nem-capex-historical-and-forecast-build-cost-battery-energy-storage-2026', date: '2026' },
  ecovantage: { title: 'Ecovantage energy certificate market update: LGC spot ~A$7.85, 2027-29 forwards A$7.15-8.15', url: 'https://www.ecovantage.com.au/energy-certificate-market-update/', date: 'Oct 2026' },
  essential: { title: 'Essential Energy 2025-26 price list (BHND3AO HV demand tariff: A$11.27/kVA/month peak; 3.1-4.6 c/kWh)', url: 'https://www.essentialenergy.com.au/-/media/Project/EssentialEnergy/Website/Files/Our-Network/PriceListAndExplanatoryNotes2025-26.pdf', date: 'Jun 2025' },
  aemo: { title: 'AEMO aggregated price and demand data, NSW1, Oct 2025-Sep 2026', url: 'https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/aggregated-data', date: 'Oct 2026' },
  bargo: { title: 'Bargo B200 tracker (39 providers): avg US$7.99 on-demand, US$6.71 reserved, US$4.26 spot', url: 'https://www.bargo.ai/gpu/b200', date: '25 Oct 2026' },
  gpuai: { title: 'GPU.ai price index: RTX PRO 6000 US$1.60-2.19/hr mainstream, median ~US$2.19', url: 'https://gpu.ai/gpu-price-index', date: 'Oct 2026' },
  mercatus: { title: 'Mercatus: 8-GPU HGX B200 server US$400-500k (typical ~US$450k); 8x H200 ~US$370k', url: 'https://www.mercatus-ai.com/blog/b200-server-price', date: '2026' },
  gatewell: { title: 'Gatewell: RTX PRO 6000 Server Edition ~US$20k per card; HGX B200 board US$270-282k', url: 'https://gatewellusa.com/ai-compute/datacenter-gpu-prices', date: '2026' },
  rba: { title: 'RBA exchange rates: A$1 = US$0.7034 (24 Oct 2026)', url: 'https://www.rba.gov.au/statistics/frequency/exchange-rates.html', date: 'Oct 2026' },
  dpiSheep: { title: 'NSW DPIRD 2025 sheep gross margins: first-cross ewes x terminal sire A$53.70/DSE', url: 'https://www.dpird.nsw.gov.au/about-us/media-centre/releases/2026/general/sheep-enterprise-profits-surge-in-2025-gross-margin-budgets', date: '2026' },
  dpiBeef: { title: 'Beef Central: NSW DPI 2025 coastal weaner gross margin rose to ~A$60/DSE', url: 'https://www.beefcentral.com/production/latest-gross-margin-figures-show-encouraging-signs-for-most-nsw-beef-producers-2/', date: '2025' },
  rent: { title: 'HtAG Analytics, Taree 2430: vacancy 1.32%, rents +4.7% year on year', url: 'https://www.htag.com.au/nsw/nsw328-mid-coast-council/taree-nsw-2430/', date: 'Oct 2026' },
  frms: { title: 'Manning River Floodplain Risk Management Study and Plan (BMT for MidCoast Council, 2020), Tables 4-2 and 4-3', url: 'https://data.nsw.gov.au/data/dataset/fdp-reports-manning-river-frms-p', date: 'Sep 2020' },
  lidar: { title: 'NSW Spatial Services 5 m LiDAR DEM (NSW_5M_Elevation)', url: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer', date: '2026' },
  listing: { title: 'Homely/Ray White listing for 18 Clovernook Drive (32 acres, 4-bed home); ~A$1.25M guide', url: 'https://www.homely.com.au/homes/18-clovernook-drive-cundletown-nsw-2430/11759719', date: '2026' },
};

export const PARAMS: ParamMeta[] = [
  // Solar
  { path: 'pv.capexPerWdc.fixed', label: 'Fixed-tilt capex (standard height)', unit: 'A$/Wdc', group: 'Solar', min: 0.6, max: 3, step: 0.05, low: 1.1, high: 1.7, source: S.straightline },
  { path: 'pv.capexPerWdc.tracker', label: 'Single-axis tracker capex', unit: 'A$/Wdc', group: 'Solar', min: 0.6, max: 3, step: 0.05, low: 1.2, high: 1.85, source: S.straightline },
  { path: 'pv.capexPerWdc.vertical', label: 'Vertical bifacial capex', unit: 'A$/Wdc', group: 'Solar', min: 0.6, max: 3, step: 0.05, low: 1.25, high: 1.95, source: S.straightline },
  { path: 'pv.raisePremiumPerWdcPerM', label: 'High-clearance premium per extra metre', unit: 'A$/Wdc/m', group: 'Solar', min: 0, max: 0.3, step: 0.01, low: 0.04, high: 0.12, note: 'Heavier steel, deeper piles and flood/debris loading for agrivoltaic structures.' },
  { path: 'pv.clearanceM', label: 'Lowest module edge above ground', unit: 'm', group: 'Solar', min: 0.5, max: 6, step: 0.1, note: 'Default puts modules at the flood planning level (5.1 m AHD) and lets cattle and machinery pass underneath.' },
  { path: 'pv.tiltDeg', label: 'Fixed-tilt angle (north)', unit: '°', group: 'Solar', min: 0, max: 45, step: 1 },
  { path: 'pv.moduleWp', label: 'Module rating', unit: 'Wp', group: 'Solar', min: 400, max: 800, step: 5, note: 'Bifacial TOPCon, 2382 x 1134 mm.' },
  { path: 'pv.bifaciality', label: 'Bifaciality factor', unit: '', group: 'Solar', min: 0, max: 0.95, step: 0.05 },
  { path: 'pv.albedo', label: 'Ground albedo (pasture)', unit: '', group: 'Solar', min: 0.1, max: 0.4, step: 0.01 },
  { path: 'pv.systemLossPct', label: 'DC system losses', unit: '%', group: 'Solar', min: 2, max: 20, step: 0.5, note: 'Soiling, mismatch, wiring, availability.' },
  { path: 'pv.degradationPctYr', label: 'Module degradation', unit: '%/yr', group: 'Solar', min: 0, max: 1.5, step: 0.05 },
  { path: 'pv.omPerKwYr', label: 'Solar O&M and insurance', unit: 'A$/kWdc/yr', group: 'Solar', min: 5, max: 60, step: 1, low: 14, high: 28 },
  { path: 'pv.lgcPrice', label: 'LGC price (to 2030)', unit: 'A$/MWh', group: 'Solar', min: 0, max: 60, step: 0.5, low: 4, high: 15, source: S.ecovantage },
  // Battery
  { path: 'bess.capexPerKwh', label: 'Battery energy capex', unit: 'A$/kWh', group: 'Battery', min: 100, max: 1000, step: 10, low: 280, high: 420, source: S.modo },
  { path: 'bess.capexPerKw', label: 'Battery power (PCS & BOP) capex', unit: 'A$/kW', group: 'Battery', min: 0, max: 800, step: 10, low: 150, high: 300, source: S.modo },
  { path: 'bess.rtePct', label: 'Round-trip efficiency', unit: '%', group: 'Battery', min: 70, max: 95, step: 1 },
  { path: 'bess.cycleCostPerMwh', label: 'Wear cost per MWh cycled', unit: 'A$/MWh', group: 'Battery', min: 0, max: 80, step: 1 },
  { path: 'bess.omPctYr', label: 'Battery O&M', unit: '% capex/yr', group: 'Battery', min: 0, max: 5, step: 0.1 },
  { path: 'bess.ancillaryPerKwYr', label: 'FCAS & network-support income', unit: 'A$/kW/yr', group: 'Battery', min: 0, max: 150, step: 1, low: 5, high: 40, note: 'Indicative income via an aggregator; NEM FCAS prices have fallen as batteries flood the market.' },
  // Grid & market
  { path: 'grid.priceScale', label: 'Wholesale price level vs last 12 months', unit: '×', group: 'Grid & market', min: 0.3, max: 3, step: 0.05, low: 0.8, high: 1.3, source: S.aemo },
  { path: 'grid.priceEscalationPctYr', label: 'Energy price escalation', unit: '%/yr', group: 'Grid & market', min: -3, max: 8, step: 0.1 },
  { path: 'grid.networkAdderPerMwh', label: 'Network, retail & market charges on imports', unit: 'A$/MWh', group: 'Grid & market', min: 0, max: 250, step: 1, low: 50, high: 90, source: S.essential },
  { path: 'grid.demandChargePerKvaMonth', label: 'Demand charge', unit: 'A$/kVA/month', group: 'Grid & market', min: 0, max: 40, step: 0.5, low: 8, high: 14, source: S.essential },
  { path: 'grid.connectionFixed', label: 'Grid connection fixed cost', unit: 'A$', group: 'Grid & market', min: 0, max: 3000000, step: 10000, low: 150000, high: 600000, note: 'Essential Energy studies, protection, metering and HV works.' },
  { path: 'grid.connectionPerKva', label: 'Grid connection cost per kVA', unit: 'A$/kVA', group: 'Grid & market', min: 0, max: 1000, step: 5, low: 80, high: 300 },
  { path: 'grid.exportLossFactor', label: 'Loss factors on exports (MLF × DLF)', unit: '', group: 'Grid & market', min: 0.7, max: 1.05, step: 0.01 },
  // Compute
  { path: 'compute.catalog.$model.priceUsdPerGpuHr', label: 'GPU rental price (selected GPU)', unit: 'US$/GPU-hr', group: 'Compute', min: 0.1, max: 20, step: 0.05, low: 0.75, high: 1.25, source: S.bargo, note: 'Range used for risk is ±25% of the base price.' },
  { path: 'compute.catalog.$model.serverCapexUsd', label: 'Server price (selected GPU)', unit: 'US$/server', group: 'Compute', min: 10000, max: 1500000, step: 5000, low: 0.9, high: 1.15, source: S.mercatus, note: 'Range used for risk is -10%/+15% of the base price.' },
  { path: 'compute.utilisationPct', label: 'Hours sold at full price', unit: '%', group: 'Compute', min: 0, max: 100, step: 1, low: 45, high: 85 },
  { path: 'compute.flexPricePct', label: 'Interruptible price vs full price', unit: '%', group: 'Compute', min: 0, max: 100, step: 1, low: 20, high: 55, source: S.bargo, note: 'Spot B200 ~US$4.26 vs reserved ~US$5.62.' },
  { path: 'compute.priceDeclinePctYr', label: 'GPU-hour price decline (within a hardware generation)', unit: '%/yr', group: 'Compute', min: 0, max: 50, step: 1, low: 10, high: 35, note: 'B200 on-demand rates rose 35% in the 90 days to Oct 2026 on scarcity (Bargo); earlier, H100 rates fell sharply once supply caught up.' },
  { path: 'compute.refreshYears', label: 'Hardware refresh cycle', unit: 'years', group: 'Compute', min: 2, max: 10, step: 1 },
  { path: 'compute.marketplaceFeePct', label: 'Marketplace / sales fee', unit: '%', group: 'Compute', min: 0, max: 40, step: 1, low: 5, high: 25 },
  { path: 'compute.dcCapexPerKw', label: 'Modular data hall, cooling & power', unit: 'A$/kW IT', group: 'Compute', min: 1000, max: 20000, step: 100, low: 4000, high: 9000 },
  { path: 'compute.pueBase', label: 'PUE at ≤22 °C', unit: '', group: 'Compute', min: 1.02, max: 1.8, step: 0.01, low: 1.08, high: 1.3 },
  { path: 'compute.networkPerMonth', label: 'Fibre backhaul', unit: 'A$/month', group: 'Compute', min: 0, max: 30000, step: 100, low: 2500, high: 8000 },
  { path: 'compute.staffPerYr', label: 'Operations staff & remote hands', unit: 'A$/yr', group: 'Compute', min: 0, max: 1000000, step: 5000, low: 60000, high: 180000 },
  { path: 'compute.maintenancePctYr', label: 'Hardware maintenance', unit: '% capex/yr', group: 'Compute', min: 0, max: 15, step: 0.5 },
  { path: 'compute.padRaiseM', label: 'Equipment platform height above ground', unit: 'm', group: 'Compute', min: 0, max: 6, step: 0.1, note: 'Default lifts the platform to the flood planning level (5.1 m AHD) on piles, which keeps floodplain storage.' },
  // Agriculture
  { path: 'ag.dsePerHa', label: 'Carrying capacity (open pasture)', unit: 'DSE/ha', group: 'Agriculture', min: 2, max: 25, step: 0.5, low: 8, high: 15, note: 'Improved kikuyu/ryegrass/clover on the Manning floodplain.' },
  { path: 'ag.underArrayFactorSlope', label: 'Pasture loss per unit ground cover under panels', unit: '', group: 'Agriculture', min: -1.5, max: 0.5, step: 0.05, low: -0.8, high: -0.2, note: 'Pasture factor = 1 + slope × GCR.' },
  { path: 'ag.sheepGmPerDse', label: 'Sheep gross margin', unit: 'A$/DSE', group: 'Agriculture', min: 0, max: 120, step: 0.5, low: 35, high: 65, source: S.dpiSheep },
  { path: 'ag.cattleGmPerDse', label: 'Cattle gross margin (coastal weaners)', unit: 'A$/DSE', group: 'Agriculture', min: 0, max: 120, step: 0.5, low: 38, high: 70, source: S.dpiBeef },
  { path: 'ag.hayGmPerHa', label: 'Hay/silage gross margin', unit: 'A$/ha', group: 'Agriculture', min: 0, max: 3000, step: 10 },
  { path: 'ag.henGm', label: 'Free-range hen gross margin', unit: 'A$/hen/yr', group: 'Agriculture', min: 0, max: 40, step: 0.5 },
  { path: 'ag.greenhouseGmPerM2', label: 'Heated greenhouse gross margin', unit: 'A$/m²/yr', group: 'Agriculture', min: 0, max: 300, step: 1, low: 25, high: 80 },
  { path: 'ag.greenhouseCapexPerM2', label: 'Greenhouse capex', unit: 'A$/m²', group: 'Agriculture', min: 0, max: 1500, step: 10 },
  { path: 'ag.hiveGm', label: 'Beehive gross margin', unit: 'A$/hive/yr', group: 'Agriculture', min: 0, max: 600, step: 5 },
  // Homes
  { path: 'homes.houseWeeklyRent', label: 'Existing 4-bed house rent', unit: 'A$/week', group: 'Homes', min: 0, max: 3000, step: 10, low: 560, high: 780, source: S.rent, note: 'Estimate: local house medians are around A$500-550/wk and this home is larger, with a self-contained wing on 32 acres.' },
  { path: 'homes.grannyWeeklyRent', label: 'Granny flat rent', unit: 'A$/week', group: 'Homes', min: 0, max: 2000, step: 10, low: 340, high: 460, source: S.rent },
  { path: 'homes.cabinAdr', label: 'Farm-stay cabin nightly rate', unit: 'A$/night', group: 'Homes', min: 0, max: 1000, step: 5, low: 140, high: 220, note: 'Indicative Manning Valley/Old Bar range; no free suburb-level data, so verify with AirDNA or local managers.' },
  { path: 'homes.cabinOccupancyPct', label: 'Cabin occupancy', unit: '%', group: 'Homes', min: 0, max: 100, step: 1, low: 45, high: 65, note: 'Indicative regional coastal NSW range.' },
  { path: 'homes.cabinCapex', label: 'Cabin build cost (incl. services)', unit: 'A$/cabin', group: 'Homes', min: 0, max: 1000000, step: 5000, low: 150000, high: 260000 },
  { path: 'homes.grannyCapex', label: 'Granny flat build cost', unit: 'A$', group: 'Homes', min: 0, max: 1000000, step: 5000, low: 180000, high: 300000 },
  { path: 'homes.raisedFloorPremium', label: 'Raising a new dwelling to the flood planning level', unit: 'A$/dwelling', group: 'Homes', min: 0, max: 200000, step: 1000 },
  { path: 'homes.cabinOpexPctRevenue', label: 'Cabin operating costs (cleaning, linen, management)', unit: '% of revenue', group: 'Homes', min: 0, max: 80, step: 1 },
  { path: 'homes.rentGrowthPctYr', label: 'Rent growth', unit: '%/yr', group: 'Homes', min: -2, max: 10, step: 0.1 },
  // Robots
  { path: 'robots.priceUsd', label: 'Work-capable humanoid price (reference year)', unit: 'US$/robot', group: 'Robots', min: 2000, max: 300000, step: 500, low: 0.75, high: 1.4, relative: true, note: 'Full-size humanoid with dexterous hands; tracks the Unitree H2 list price daily. Risk range is -25%/+40% of the base.' },
  { path: 'robots.priceDeclinePctYr', label: 'Humanoid price decline', unit: '%/yr', group: 'Robots', min: 0, max: 50, step: 1, low: 8, high: 28 },
  { path: 'robots.leaseUsdPerMonth', label: 'Robot-as-a-service fee (reference year)', unit: 'US$/month', group: 'Robots', min: 0, max: 10000, step: 50, note: '1X NEO is US$499/month for homes; work robots cost more.' },
  { path: 'robots.readinessShiftYears', label: 'Robot capability timing vs forecast', unit: 'years', group: 'Robots', min: -5, max: 8, step: 0.5, low: -2, high: 3, note: 'Positive means slower progress than the readiness forecast.' },
  { path: 'robots.productivity', label: 'Robot output vs a person (mature task)', unit: '×', group: 'Robots', min: 0.1, max: 2, step: 0.05, low: 0.5, high: 1 },
  { path: 'robots.hoursPerDay', label: 'Working hours per robot per day', unit: 'h', group: 'Robots', min: 1, max: 24, step: 0.5 },
  { path: 'robots.uptimePct', label: 'Robot uptime', unit: '%', group: 'Robots', min: 10, max: 100, step: 1 },
  { path: 'robots.lifeYears', label: 'Robot service life', unit: 'years', group: 'Robots', min: 1, max: 15, step: 1 },
  { path: 'robots.maintenancePctYr', label: 'Robot maintenance', unit: '% of price/yr', group: 'Robots', min: 0, max: 30, step: 0.5 },
  { path: 'robots.softwarePerYr', label: 'Robot software & autonomy subscription', unit: 'A$/robot/yr', group: 'Robots', min: 0, max: 30000, step: 100 },
  { path: 'robots.dataRevenuePerHour', label: 'Sale of task-demonstration data', unit: 'A$/robot-hour', group: 'Robots', min: 0, max: 100, step: 0.5, note: 'Optional: robot labs buy real-world farm and hospitality task data. Off by default.' },
  // Site & flood
  { path: 'site.dfeM', label: 'Defined flood event (2100 1% AEP)', unit: 'm AHD', group: 'Site & flood', min: 2, max: 8, step: 0.1, source: S.frms, note: 'Present-day 1% AEP 4.1 m; +10% flow with 2100 sea level rise 4.6 m (Dumaresq Island/Cundletown reporting point).' },
  { path: 'site.floodOffsetM', label: 'Site flood levels vs Cundletown reporting point', unit: 'm', group: 'Site & flood', min: -2, max: 2, step: 0.05, low: -0.3, high: 0.4, note: 'Confirm with MidCoast Council flood mapping for Lot 43 DP825601.' },
  { path: 'site.freeboardM', label: 'Freeboard', unit: 'm', group: 'Site & flood', min: 0, max: 1.5, step: 0.05, source: S.frms },
  { path: 'site.groundLevelM', label: 'Paddock ground level', unit: 'm AHD', group: 'Site & flood', min: 0, max: 6, step: 0.05, source: S.lidar, note: 'LiDAR median 1.42 m AHD; 90% of the lot is below 1.8 m.' },
  { path: 'site.floodDamagePct', label: 'Damage per inundation (share of exposed value)', unit: '%', group: 'Site & flood', min: 0, max: 100, step: 1 },
  { path: 'site.councilRatesPerYr', label: 'Council rates', unit: 'A$/yr', group: 'Site & flood', min: 0, max: 50000, step: 100 },
  { path: 'site.landTaxPerYr', label: 'Land tax', unit: 'A$/yr', group: 'Site & flood', min: 0, max: 100000, step: 100, note: 'Primary-production land is usually exempt; commercial uses may change that.' },
  // Finance
  { path: 'finance.discountRatePct', label: 'Discount rate (nominal)', unit: '%', group: 'Finance', min: 0, max: 25, step: 0.25, low: 6, high: 11 },
  { path: 'finance.inflationPct', label: 'Inflation', unit: '%/yr', group: 'Finance', min: 0, max: 10, step: 0.1 },
  { path: 'finance.landPrice', label: 'Land purchase price', unit: 'A$', group: 'Finance', min: 0, max: 5000000, step: 10000, low: 1100000, high: 1300000, source: S.listing },
  { path: 'finance.landGrowthPctYr', label: 'Land value growth', unit: '%/yr', group: 'Finance', min: -2, max: 12, step: 0.1 },
  { path: 'finance.developmentFixed', label: 'Approvals & specialist studies', unit: 'A$', group: 'Finance', min: 0, max: 3000000, step: 10000, low: 250000, high: 600000 },
  { path: 'finance.contingencyPct', label: 'Contingency', unit: '%', group: 'Finance', min: 0, max: 40, step: 1 },
  { path: 'finance.debtPct', label: 'Debt share of capex', unit: '%', group: 'Finance', min: 0, max: 90, step: 5 },
  { path: 'finance.interestPct', label: 'Interest rate', unit: '%', group: 'Finance', min: 0, max: 15, step: 0.1 },
  { path: 'finance.loanYears', label: 'Loan term', unit: 'years', group: 'Finance', min: 1, max: 25, step: 1 },
  { path: 'finance.usdAud', label: 'A$ per US$', unit: '', group: 'Finance', min: 1, max: 2.2, step: 0.01, low: 1.32, high: 1.55, source: S.rba },
];

export const SOURCES = S;

function resolve(s: Scenario, path: string): string[] {
  return path.replace('$model', s.compute.model).split('.');
}

export function getParam(s: Scenario, path: string): number {
  let o: unknown = s;
  for (const k of resolve(s, path)) o = (o as Record<string, unknown>)[k];
  return o as number;
}

export function setParam(s: Scenario, path: string, value: number): void {
  const keys = resolve(s, path);
  let o = s as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

/** Relative ranges (GPU price/server capex) are stored as multipliers of the base value. */
export function rangeFor(p: ParamMeta, s: Scenario): [number, number] | null {
  if (p.low === undefined || p.high === undefined) return null;
  const base = getParam(s, p.path);
  if (p.relative || p.path.includes('$model')) return [base * p.low, base * p.high];
  return [p.low, p.high];
}
