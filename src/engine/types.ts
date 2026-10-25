export type PvType = 'fixed' | 'tracker' | 'vertical';
export type GpuModel = 'B300' | 'B200' | 'H200' | 'RTXPRO6000' | 'L40S';
export type UnderArrayUse = 'sheep' | 'cattle' | 'poultry' | 'none';
export type OpenLandUse = 'sheep' | 'cattle' | 'hay' | 'none';
export type HouseMode = 'owner' | 'rent';
export type Objective = 'npv' | 'irr' | 'ebitdaPerHa' | 'profitIndex';

export interface Scenario {
  name: string;
  pv: {
    type: PvType;
    fillPct: number; // share of the available array zone that gets rows (0-100)
    gcr: number; // collector width / row pitch (vertical: collector height / pitch)
    dcAcRatio: number;
    keepTrees: boolean;
    clearanceM: number; // lowest module edge above ground (fixed/tracker)
    tiltDeg: number; // fixed-tilt only, facing north
    trackerMaxAngleDeg: number;
    moduleWp: number;
    moduleLengthM: number;
    moduleWidthM: number;
    bifaciality: number;
    albedo: number;
    tempCoeffPctPerC: number;
    systemLossPct: number;
    inverterEffPct: number;
    degradationPctYr: number;
    capexPerWdc: Record<PvType, number>; // A$/Wdc installed at standard clearance
    standardClearanceM: Record<PvType, number>;
    raisePremiumPerWdcPerM: number; // A$/Wdc for every metre above standard clearance
    omPerKwYr: number; // A$/kWdc/yr excl. vegetation management
    vegMgmtPerHaYr: number; // A$/ha/yr slashing if not grazed
    inverterReplaceYear: number;
    inverterReplacePerWac: number;
    lgcPrice: number; // A$/certificate (MWh)
    lgcEndYear: number; // last calendar year LGCs are created
  };
  bess: {
    powerKw: number;
    hours: number;
    rtePct: number;
    minSocPct: number;
    capexPerKwh: number;
    capexPerKw: number;
    omPctYr: number;
    degradationPctYr: number;
    augmentYear: number;
    augmentPctOfCapex: number;
    cycleCostPerMwh: number; // wear cost used in arbitrage decisions
    ancillaryPerKwYr: number; // FCAS / network-support income via an aggregator
  };
  grid: {
    importLimitKw: number;
    exportLimitKw: number;
    connectionFixed: number; // A$ (studies, protection, metering)
    connectionPerKva: number; // A$/kVA of max(import, export)
    networkAdderPerMwh: number; // network energy + retail + market fees on imports
    demandChargePerKvaMonth: number;
    exportLossFactor: number; // MLF x DLF
    exportFeePerMwh: number;
    priceScale: number; // multiplier on the historical NSW1 price series
    priceEscalationPctYr: number;
    gridEmissionsKgPerKwh: number;
  };
  compute: {
    model: GpuModel;
    servers: number; // 8-GPU nodes
    utilisationPct: number; // share of hours sold at the full price
    busyPowerPct: number; // average draw when sold, % of nameplate
    idlePowerPct: number;
    flexEnabled: boolean; // run interruptible jobs when energy is cheap
    flexPricePct: number; // interruptible price as % of the full price
    pueBase: number;
    pueSlopePerC: number; // added PUE per degree above pueRefC
    pueRefC: number;
    priceDeclinePctYr: number;
    refreshYears: number;
    marketplaceFeePct: number;
    maintenancePctYr: number; // % of server capex
    dcCapexPerKw: number; // A$/kW IT for containers, cooling, power distribution
    dcOmPctYr: number;
    networkPerMonth: number;
    staffPerYr: number;
    insurancePctYr: number;
    padRaiseM: number; // elevated platform height above ground
    padCostPerM2PerM: number;
    heatToGreenhouse: boolean;
    catalog: Record<GpuModel, GpuSpec>;
  };
  ag: {
    underArray: UnderArrayUse;
    openLand: OpenLandUse;
    dsePerHa: number; // improved floodplain pasture carrying capacity
    underArrayFactorAtGcr0: number;
    underArrayFactorSlope: number; // per unit GCR
    sheepGmPerDse: number;
    cattleGmPerDse: number;
    hayGmPerHa: number;
    henPerHa: number;
    henGm: number; // A$/hen/yr
    poultryFixedPerYr: number;
    hives: number;
    hiveGm: number;
    greenhouseM2: number;
    greenhouseGmPerM2: number; // with year-round heat
    greenhouseUnheatedFactor: number;
    greenhouseCapexPerM2: number;
    greenhouseHeatKwhPerM2Yr: number;
    fencingWaterCapex: number;
    refugeMound: boolean;
    refugeMoundCapex: number;
  };
  homes: {
    houseMode: HouseMode;
    houseWeeklyRent: number;
    grannyFlat: boolean;
    grannyWeeklyRent: number;
    grannyCapex: number;
    cabins: number;
    cabinAdr: number; // average daily rate
    cabinOccupancyPct: number;
    cabinCapex: number;
    cabinOpexPctRevenue: number;
    platformFeePct: number;
    vacancyPct: number;
    ltrManagementPct: number;
    raisedFloorPremium: number; // A$ per new dwelling to lift floors above the flood planning level
    rentGrowthPctYr: number;
    dwellingKwhPerDay: number;
    tenantEnergyPricePerKwh: number; // embedded-network sale to tenants
  };
  site: {
    floodOffsetM: number; // site flood levels relative to the Dumaresq Island reporting location
    dfeM: number; // defined flood event: 2100 planning-horizon 1% AEP at the reporting location, m AHD
    freeboardM: number;
    groundLevelM: number; // typical paddock level, m AHD
    padGroundM: number; // ground at the equipment pad
    floodDamagePct: number; // share of exposed asset value lost per inundation
    councilRatesPerYr: number;
    landTaxPerYr: number;
    farmBaseKw: number;
  };
  finance: {
    years: number;
    startYear: number;
    discountRatePct: number;
    inflationPct: number;
    includeLand: boolean;
    landPrice: number;
    landGrowthPctYr: number;
    developmentFixed: number; // DA, flood, ASS, glare, bushfire, ecology, heritage studies
    contingencyPct: number;
    debtPct: number;
    interestPct: number;
    loanYears: number;
    capexBudget: number; // 0 = unlimited (optimiser constraint)
    usdAud: number;
  };
}

export interface GpuSpec {
  label: string;
  gpusPerServer: number;
  serverKw: number; // nameplate at full load
  serverCapexUsd: number;
  priceUsdPerGpuHr: number; // achievable full-price rental
  memoryGb: number;
}

export interface Climate {
  ghi: number[];
  dni: number[];
  dhi: number[];
  tamb: number[];
  wind: number[];
  irradianceTimeOffsetH: number;
  lat: number;
  lon: number;
}

export interface Prices {
  price: number[];
}

export interface LayoutRow {
  a: [number, number]; // local metres
  b: [number, number];
  length: number;
}

export interface Layout {
  rows: LayoutRow[];
  pitchM: number;
  rowWidthM: number; // footprint across the row
  totalRowM: number;
  kwdc: number;
  arrayAreaHa: number; // land under the used rows (pitch x length)
  zoneAreaHa: number;
  orientation: 'EW' | 'NS'; // direction the rows run
}

export interface HourlySeries {
  pvAc: Float64Array;
  pvDc: Float64Array;
  gpuLoad: Float64Array;
  flexLoad: Float64Array;
  otherLoad: Float64Array;
  pvToLoad: Float64Array;
  battCharge: Float64Array;
  battDischarge: Float64Array;
  soc: Float64Array;
  gridImport: Float64Array;
  gridExport: Float64Array;
  curtailed: Float64Array;
  unserved: Float64Array;
  price: Float64Array;
}

export interface EnergyTotals {
  pvDcMwh: number;
  pvAcMwh: number;
  pvToLoadMwh: number;
  pvToBattMwh: number;
  pvToFlexMwh: number;
  gridToBattMwh: number;
  battToLoadMwh: number;
  battToGridMwh: number;
  exportMwh: number;
  importMwh: number;
  curtailedMwh: number;
  unservedMwh: number;
  gpuLoadMwh: number;
  flexLoadMwh: number;
  otherLoadMwh: number;
  importCost: number;
  demandCharges: number;
  exportRevenue: number;
  arbitrageRevenue: number;
  specificYield: number; // kWh/kWp/yr (AC)
  selfSufficiencyPct: number; // share of load met by PV directly or via battery
  solarSelfUsePct: number;
  peakImportKw: number;
  batteryCycles: number;
  gpuHoursSold: number;
  gpuHoursLost: number;
  flexGpuHours: number;
  heatMwhTh: number;
  monthly: { pv: number[]; load: number[]; imp: number[]; exp: number[]; curtail: number[]; heat: number[] };
}

export interface CapexLine {
  key: string;
  label: string;
  group: 'Solar' | 'Battery' | 'Grid' | 'Compute' | 'Agriculture' | 'Homes' | 'Site' | 'Land';
  amount: number;
}

export interface YearRow {
  year: number;
  calYear: number;
  revenue: Record<string, number>;
  opex: Record<string, number>;
  capex: number;
  ebitda: number;
  netCash: number; // ebitda - capex (unlevered, pre-tax)
  cumulative: number;
  debtService: number;
  equityCash: number;
}

export interface FloodItem {
  label: string;
  levelM: number; // critical level, m AHD
  aep: number; // annual chance of inundation
  value: number; // exposed value A$
  expectedLoss: number; // A$/yr
  safe: boolean; // above flood planning level
}

export interface AgResult {
  underArrayHa: number;
  openHa: number;
  dse: number;
  pastureFactor: number;
  hens: number;
  grossMargin: number;
  lines: { label: string; value: number }[];
  greenhouseHeatCoverPct: number;
  lerSolar: number;
  lerAg: number;
  ler: number;
}

export interface HomesResult {
  dwellings: number;
  revenue: number;
  opex: number;
  capex: number;
  lines: { label: string; units: number; revenue: number; opex: number }[];
  guestNights: number;
}

export interface Result {
  scenario: Scenario;
  layout: Layout;
  pvKwac: number;
  bessKwh: number;
  itKw: number;
  energy: EnergyTotals;
  series: HourlySeries | null;
  ag: AgResult;
  homes: HomesResult;
  capex: CapexLine[];
  capexTotal: number;
  years: YearRow[];
  npv: number;
  irr: number | null;
  equityIrr: number | null;
  paybackYears: number | null;
  lcoe: number; // A$/MWh for the PV system
  year1: { revenue: number; opex: number; ebitda: number; revenueByStream: Record<string, number> };
  ebitdaPerHa: number;
  profitIndex: number;
  flood: FloodItem[];
  co2AvoidedT: number;
  warnings: string[];
}
