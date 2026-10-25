// Rebuilds src/data/*.json from public sources. Raw downloads are cached in scripts/.cache.
// Usage: node scripts/build-data.mjs [--refresh]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const outDir = path.join(here, '..', 'src', 'data');
const refresh = process.argv.includes('--refresh');
fs.mkdirSync(path.join(cache, 'aemo'), { recursive: true });

const ADDRESS_POINT = [152.5164704519641, -31.868618748920536];
const CADASTRE = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer/8';
const PLANNING = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer';
const PROTECTION = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer';
const HAZARD = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer';
const DEM = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer';
const PVGIS = 'https://re.jrc.ec.europa.eu/api/v5_3/tmy';
const AEMO = 'https://aemo.com.au/aemo/data/nem/priceanddemand';
const UA = { 'User-Agent': 'Mozilla/5.0 (clovernook-farm data builder)' };

async function cached(name, fetcher) {
  const file = path.join(cache, name);
  if (!refresh && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = await fetcher();
  fs.writeFileSync(file, text);
  return text;
}
async function getText(url, init) {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
function polyQuery(base, layer, rings, geojson = true) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: '*', returnGeometry: String(geojson), outSR: '4326', f: geojson ? 'geojson' : 'json',
  });
  return getText(`${base}/${layer}/query`, { method: 'POST', body });
}
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;
const ringRound = (ring) => ring.map(([x, y]) => [round(x, 7), round(y, 7)]);
function largestPolygon(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return turf.polygon(geom.coordinates);
  const parts = geom.coordinates.map((c) => turf.polygon(c));
  return parts.sort((a, b) => turf.area(b) - turf.area(a))[0];
}
function clean(feature, minM2 = 400) {
  if (!feature) return null;
  const g = feature.geometry;
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const kept = parts.filter((c) => turf.area(turf.polygon(c)) >= minM2);
  if (!kept.length) return null;
  return kept.length === 1 ? turf.polygon(kept[0]) : turf.multiPolygon(kept);
}
const diff = (a, b) => (a && b ? turf.difference(turf.featureCollection([a, b])) : a);
const inter = (a, b) => (a && b ? turf.intersect(turf.featureCollection([a, b])) : null);
const polys = (f) => (!f ? [] : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);

// ---------- Site geometry ----------
const lotText = await cached('lot.geojson', () => getText(`${CADASTRE}/query?geometry=${ADDRESS_POINT.join(',')}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=lotidstring,lotnumber,planlabel&returnGeometry=true&outSR=4326&f=geojson`));
const lot = JSON.parse(lotText).features[0];
const lotRings = lot.geometry.coordinates;
const lotArea = turf.area(lot);

const zoningFc = JSON.parse(await cached('zoning.geojson', () => polyQuery(PLANNING, 2, lotRings)));
const zoneParts = {};
for (const f of zoningFc.features) {
  const code = f.properties.SYM_CODE;
  const i = clean(inter(lot, f));
  if (i) zoneParts[code] = { feature: i, props: f.properties };
}
const ru1 = zoneParts.RU1?.feature;
const r5 = zoneParts.R5?.feature;

const assFc = JSON.parse(await cached('ass.geojson', () => polyQuery(PROTECTION, 1, lotRings)));
const ass = assFc.features.map((f) => ({ cls: f.properties.LAY_CLASS, f: clean(inter(lot, f), 50) })).filter((a) => a.f);

const bushFc = JSON.parse(await cached('bushfire.geojson', () => polyQuery(HAZARD, 229, lotRings)));
const bushInLot = bushFc.features.map((f) => ({ cat: f.properties.d_Category, area: turf.area(inter(lot, f) ?? turf.polygon([[[0, 0], [0, 1e-9], [1e-9, 0], [0, 0]]])) }));
const planning = JSON.parse(await cached('planning.json', async () => {
  const out = {};
  for (const [name, base, layer] of [['zoning', PLANNING, 2], ['lotsize', PLANNING, 4], ['hob', PLANNING, 5], ['heritage', PLANNING, 0], ['flood', HAZARD, 230]]) {
    out[name] = (JSON.parse(await polyQuery(base, layer, lotRings, false)).features ?? []).map((f) => f.attributes);
  }
  return JSON.stringify(out, null, 2);
}));

// 10 m DEM grid (NSW 5 m LiDAR DEM, bilinear samples)
const demText = await cached('dem10.json', async () => {
  const buf = turf.buffer(lot, 15, { units: 'meters' });
  const [minX, minY, maxX, maxY] = turf.bbox(buf);
  const kx = 111320 * Math.cos((minY * Math.PI) / 180);
  const pts = [];
  for (let y = maxY; y >= minY; y -= 10 / 110574) for (let x = minX; x <= maxX; x += 10 / kx) if (turf.booleanPointInPolygon([x, y], buf)) pts.push([round(x), round(y)]);
  const out = [];
  for (let i = 0; i < pts.length; i += 500) {
    const chunk = pts.slice(i, i + 500);
    const body = new URLSearchParams({ geometry: JSON.stringify({ points: chunk, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json' });
    const j = JSON.parse(await getText(`${DEM}/getSamples`, { method: 'POST', body }));
    for (const s of j.samples) out.push([chunk[s.locationId][0], chunk[s.locationId][1], Math.round(parseFloat(s.value) * 100) / 100]);
  }
  return JSON.stringify(out);
});
const dem = JSON.parse(demText).filter((p) => Number.isFinite(p[2]));
const demInLot = dem.filter((p) => turf.booleanPointInPolygon([p[0], p[1]], lot)).map((p) => p[2]).sort((a, b) => a - b);
const q = (f) => demInLot[Math.floor(f * (demInLot.length - 1))];
const above = (h) => round((demInLot.filter((v) => v >= h).length * 100) / 1e4, 2); // ha (10 m cells)

// ---------- Indicative layout primitives ----------
// Local metric frame anchored at the lot's south-west bbox corner.
const [bx0, by0] = turf.bbox(lot);
const kx = 111320 * Math.cos(((by0 + 0.002) * Math.PI) / 180), ky = 110574;
const L = ([x, y]) => [round(bx0 + x / kx, 7), round(by0 + y / ky, 7)];
const rect = (cx, cy, w, h, angleDeg = 0) => {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]].map(([x, y]) => L([cx + x * c - y * s, cy + x * s + y * c]));
  return turf.polygon([pts]);
};
// Edges digitised from the cadastre (local metres): north boundary, and the south edge of the RU1 paddock.
const northLine = turf.lineString([L([0, 439]), L([444, 373])]);
const southLine = turf.lineString([L([2, 130]), L([82, 171]), L([259, 100]), L([399, 79])]);
const damCentre = L([40, 254]);
const trees = turf.polygon([[L([168, 196]), L([214, 186]), L([256, 214]), L([262, 262]), L([236, 296]), L([186, 292]), L([160, 250]), L([168, 196])]]);

let arrayBase = clean(turf.buffer(ru1, -10, { units: 'meters' }));
arrayBase = diff(arrayBase, turf.buffer(northLine, 40, { units: 'meters' }));
arrayBase = diff(arrayBase, turf.buffer(southLine, 32, { units: 'meters' }));
arrayBase = diff(arrayBase, turf.circle(damCentre, 25, { units: 'meters' }));
const arrayNoTrees = clean(arrayBase, 2000);
const arrayKeepTrees = clean(diff(arrayBase, turf.buffer(trees, 8, { units: 'meters' })), 2000);

const padCentre = [218, 134];
const lineAngle = (Math.atan2(100 - 171, 259 - 82) * 180) / Math.PI; // R5/RU1 boundary bearing
const site = {
  generated: new Date().toISOString().slice(0, 10),
  address: '18 Clovernook Drive, Cundletown NSW 2430',
  lotPlan: lot.properties.lotidstring.replace('//', ' '),
  addressPoint: ADDRESS_POINT.map((v) => round(v, 7)),
  centroid: turf.centroid(lot).geometry.coordinates.map((v) => round(v, 7)),
  areaHa: round(lotArea / 1e4, 3),
  perimeterM: Math.round(turf.length(turf.polygonToLine(lot)) * 1000),
  lot: lotRings.map(ringRound),
  zones: {
    RU1: { areaHa: round(turf.area(ru1) / 1e4, 3), rings: polys(ru1).map((p) => p.map(ringRound)), minLotSizeHa: 40, name: 'Primary Production' },
    R5: { areaHa: round(turf.area(r5) / 1e4, 3), rings: polys(r5).map((p) => p.map(ringRound)), minLotSizeHa: 1.5, name: 'Large Lot Residential' },
  },
  acidSulfate: ass.map((a) => ({ cls: a.cls, areaHa: round(turf.area(a.f) / 1e4, 3), rings: polys(a.f).map((p) => p.map(ringRound)) })),
  elevation: {
    source: 'NSW Spatial Services 5 m LiDAR DEM (NSW_5M_Elevation), sampled on a 10 m grid',
    minM: q(0), p10M: q(0.1), medianM: q(0.5), p90M: q(0.9), maxM: q(1),
    haAbove: { 1.5: above(1.5), 2: above(2), 3: above(3), 4: above(4), 5: above(5) },
    grid: dem.map((p) => [round(p[0]), round(p[1]), p[2]]),
  },
  planning: {
    lep: 'Greater Taree Local Environmental Plan 2010',
    zoning: Object.fromEntries(Object.entries(zoneParts).map(([k, v]) => [k, { pct: round((100 * turf.area(v.feature)) / lotArea, 1), amendment: v.props.AMENDMENT }])),
    maxBuildingHeightM: planning.hob?.[0]?.MAX_B_H ?? 8.5,
    heritage: (planning.heritage ?? []).length > 0,
    floodPlanningMapFeatures: (planning.flood ?? []).length,
    bushfire: bushInLot.length ? `${bushInLot[0].cat} (${round((100 * bushInLot[0].area) / lotArea, 0)}% of lot)` : 'not mapped',
    obstacleLimitationSurfaceM: 56,
    koalaManagementArea: true,
    coastalEnvironmentArea: true,
  },
  layout: {
    arrayZoneKeepTrees: polys(arrayKeepTrees).map((p) => p.map(ringRound)),
    arrayZoneNoTrees: polys(arrayNoTrees).map((p) => p.map(ringRound)),
    arrayZoneKeepTreesHa: round(turf.area(arrayKeepTrees) / 1e4, 3),
    arrayZoneNoTreesHa: round(turf.area(arrayNoTrees) / 1e4, 3),
    trees: trees.geometry.coordinates.map(ringRound),
    dam: { centre: damCentre, radiusM: 15 },
    house: L([172, 40]),
    pad: { centre: L(padCentre), angleDeg: round(lineAngle, 1) },
    refugeMound: { centre: L([72, 197]), angleDeg: round((Math.atan2(41, 80) * 180) / Math.PI, 1) },
    greenhouse: { centre: L([165, 162]), angleDeg: round(lineAngle, 1) },
    grannyFlat: L([205, 66]),
    cabins: [[284, 112], [306, 109], [328, 106], [350, 103], [372, 99], [392, 96]].map(L),
    accessTrack: [L([158, 30]), L([196, 92]), L([240, 118]), L([300, 98]), L([400, 86])],
    northBufferLine: northLine.geometry.coordinates,
    localFrame: { originLon: round(bx0, 7), originLat: round(by0, 7), mPerDegLon: round(kx, 3), mPerDegLat: ky },
  },
  airport: { name: 'Taree Airport (YTRE)', lonLat: [152.5139, -31.8886] },
  sources: [
    { name: 'NSW Spatial Services cadastre (Lot 43 DP825601)', url: CADASTRE },
    { name: 'NSW Planning Portal EPI layers (zoning, lot size, height)', url: PLANNING },
    { name: 'NSW Planning Portal protection layers (acid sulfate soils, OLS)', url: PROTECTION },
    { name: 'NSW Planning Portal hazard layers (bush fire prone land, flood planning)', url: HAZARD },
    { name: 'NSW Spatial Services 5 m elevation (LiDAR DEM)', url: DEM },
  ],
};
void rect;
fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(site));
console.log('site.json', (fs.statSync(path.join(outDir, 'site.json')).size / 1024).toFixed(0), 'KB; lot', site.areaHa, 'ha; array zone (keep trees)', site.layout.arrayZoneKeepTreesHa, 'ha; (no trees)', site.layout.arrayZoneNoTreesHa, 'ha');

// ---------- Climate: PVGIS TMY (ERA5) ----------
const tmy = JSON.parse(await cached('pvgis_tmy.json', () => getText(`${PVGIS}?lat=-31.8684&lon=152.5161&outputformat=json`)));
const hours = tmy.outputs.tmy_hourly;
const N = 8760;
const climate = { ghi: new Array(N), dni: new Array(N), dhi: new Array(N), tamb: new Array(N), wind: new Array(N), rh: new Array(N) };
// PVGIS rows are UTC; the app indexes hours in AEST (UTC+10). Row k covers AEST hour (k + 10) mod 8760.
// ERA5 over-predicts beam irradiance on this coast (annual DNI 2,186 kWh/m2 vs 1,884 in NASA POWER's CERES-based
// climatology for the same point). Scale DNI to the NASA POWER total and move the difference into diffuse, which keeps
// global horizontal irradiance unchanged hour by hour.
const NASA_POWER_DNI_KWH = 1884; // NASA POWER climatology ALLSKY_SFC_SW_DNI, 5.163 kWh/m2/day
const era5Dni = hours.reduce((a, h) => a + h['Gb(n)'], 0) / 1000;
const dniScale = Math.min(1, NASA_POWER_DNI_KWH / era5Dni);
hours.forEach((h, k) => {
  const i = (k + 10) % N;
  const ghi = h['G(h)'], dhi = h['Gd(h)'];
  const beamH = Math.max(0, ghi - dhi);
  climate.ghi[i] = Math.round(ghi);
  climate.dni[i] = Math.round(h['Gb(n)'] * dniScale);
  climate.dhi[i] = Math.round(dhi + (1 - dniScale) * beamH);
  climate.tamb[i] = Math.round(h.T2m * 10) / 10;
  climate.wind[i] = Math.round(h.WS10m * 10) / 10;
  climate.rh[i] = Math.round(h.RH);
});
const climateOut = {
  source: 'PVGIS 5.3 typical meteorological year (PVGIS-ERA5, 2005-2023), European Commission JRC; beam/diffuse split calibrated to NASA POWER climatology',
  url: `${PVGIS}?lat=-31.8684&lon=152.5161`,
  lat: -31.8684, lon: 152.5161, timezone: 'AEST (UTC+10), hour-beginning index 0..8759',
  irradianceTimeOffsetH: tmy.inputs.location.irradiance_time_offset ?? 0.5,
  dniScale: Math.round(dniScale * 1000) / 1000,
  monthsSelected: tmy.outputs.months_selected,
  ...climate,
};
fs.writeFileSync(path.join(outDir, 'climate.json'), JSON.stringify(climateOut));
const sum = (a) => a.reduce((s, v) => s + v, 0);
console.log('climate.json GHI', (sum(climate.ghi) / 1000).toFixed(0), 'DNI', (sum(climate.dni) / 1000).toFixed(0), 'DHI', (sum(climate.dhi) / 1000).toFixed(0), 'kWh/m2/yr; DNI scale', dniScale.toFixed(3), '; mean T', (sum(climate.tamb) / N).toFixed(1));

// ---------- Prices: AEMO NSW1, last 12 complete months ----------
const months = ['202510', '202511', '202512', '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609'];
const hourly = new Map();
let tot = 0, neg = 0, s = 0;
for (const ym of months) {
  const csv = await cached(`aemo/${ym}.csv`, () => getText(`${AEMO}/PRICE_AND_DEMAND_${ym}_NSW1.csv`));
  for (const ln of csv.split(/\r?\n/).slice(1)) {
    if (!ln.trim()) continue;
    const [, sd, , rrp] = ln.split(',');
    const p = parseFloat(rrp);
    const [d, t] = sd.split(' ');
    const [Y, M, D] = d.split('/').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    const start = new Date(Date.UTC(Y, M - 1, D, hh, mm) - 5 * 60000); // interval-ending -> start
    const key = start.toISOString().slice(0, 13);
    const a = hourly.get(key) ?? [0, 0];
    a[0] += p; a[1]++; hourly.set(key, a);
    tot++; s += p; if (p < 0) neg++;
  }
}
const price = new Array(N).fill(null);
for (const [key, [ps, n]] of hourly) {
  const dt = new Date(`${key}:00:00Z`);
  const y = dt.getUTCFullYear();
  let doy = Math.floor((dt.getTime() - Date.UTC(y, 0, 1)) / 86400000);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (leap && doy === 59) continue;
  if (leap && doy > 59) doy -= 1;
  const i = doy * 24 + dt.getUTCHours();
  if (i >= 0 && i < N) price[i] = Math.round((ps / n) * 10) / 10;
}
for (let i = 0; i < N; i++) if (price[i] === null) price[i] = price[(i + N - 24) % N] ?? 80;
const pricesOut = {
  source: 'AEMO aggregated price and demand data, NSW1 regional reference price (5-minute RRP averaged to hourly)',
  url: `${AEMO}/PRICE_AND_DEMAND_YYYYMM_NSW1.csv`,
  period: 'October 2025 to September 2026 (mapped onto a 365-day calendar, AEST hour-beginning)',
  intervalMean: Math.round((s / tot) * 100) / 100,
  negativeIntervalShare: Math.round((neg / tot) * 10000) / 10000,
  price,
};
fs.writeFileSync(path.join(outDir, 'prices.json'), JSON.stringify(pricesOut));
console.log('prices.json mean', pricesOut.intervalMean, 'neg share', pricesOut.negativeIntervalShare);
