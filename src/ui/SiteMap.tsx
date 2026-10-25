import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Result } from '../engine/types';
import { padAreaM2, fpl } from '../engine/model';
import { toLonLat, toLocal, type LocalFrame } from '../engine/layout';
import { site } from './data';
import { num } from './format';

type LayerKey = 'zoning' | 'flood' | 'ass' | 'layout' | 'labels';
const LAYER_LABELS: Record<LayerKey, string> = {
  layout: 'Proposed layout',
  flood: 'Flood exposure (LiDAR)',
  zoning: 'Zoning (RU1 / R5)',
  ass: 'Acid sulfate soils',
  labels: 'Labels',
};

const NSW = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';
const BASEMAPS = {
  aerial: { label: 'NSW aerial (15 cm)', url: `${NSW}/NSW_Imagery/MapServer/tile/{z}/{y}/{x}`, max: 21 },
  base: { label: 'NSW base map', url: `${NSW}/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}`, max: 21 },
  topo: { label: 'NSW topographic', url: `${NSW}/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}`, max: 19 },
} as const;

const ll = ([lon, lat]: [number, number]): L.LatLngExpression => [lat, lon];

export const FLOOD_CLASSES = [
  { max: 2.0, color: '#1e3a8a', label: 'Below the 20% AEP flood (2.0 m AHD): floods every few years' },
  { max: 3.1, color: '#2563eb', label: '20%-5% AEP band (2.0-3.1 m)' },
  { max: 4.1, color: '#60a5fa', label: '5%-1% AEP band (3.1-4.1 m)' },
  { max: 5.1, color: '#a5f3fc', label: 'Above 1% AEP, below the flood planning level (4.1-5.1 m)' },
  { max: 99, color: '#22c55e', label: 'Above the flood planning level (>5.1 m AHD)' },
];

function rect(frame: LocalFrame, centre: [number, number], w: number, h: number, angleDeg: number): L.LatLngExpression[] {
  const c = toLocal(frame, centre);
  const a = (angleDeg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ll(toLonLat(frame, [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs])));
}

export function SiteMap({ result, height = 560, initialLayers, showControls = true }: { result: Result; height?: number; initialLayers?: Partial<Record<LayerKey, boolean>>; showControls?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<Partial<Record<LayerKey, L.LayerGroup>>>({});
  const baseLayer = useRef<L.TileLayer | null>(null);
  const [base, setBase] = useState<keyof typeof BASEMAPS>('aerial');
  const [mapId, setMapId] = useState(0);
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ layout: true, flood: false, zoning: false, ass: false, labels: true, ...initialLayers });
  const frame = site.layout.localFrame;
  const lotBounds = useMemo(() => L.latLngBounds(site.lot[0].map(ll)), []);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, preferCanvas: true, maxZoom: 21, zoomSnap: 0.25 });
    map.current = m;
    m.fitBounds(lotBounds, { padding: [20, 20] });
    // The container may be laid out after the map is created; re-fit once it has a real size.
    let fitted = false;
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      if (!fitted && el.current && el.current.clientWidth > 50) { m.fitBounds(lotBounds, { padding: [20, 20] }); fitted = true; }
    });
    ro.observe(el.current);
    const syncLabels = () => m.getContainer().classList.toggle('labels-hidden', m.getZoom() < 17.25);
    m.on('zoomend', syncLabels);
    syncLabels();
    L.polygon(site.lot.map((r) => r.map(ll)), { color: '#fde047', weight: 3, fill: false, dashArray: '6 4' }).addTo(m).bindTooltip(`${site.lotPlan} · ${site.areaHa.toFixed(2)} ha`);
    const airport = site.airport.lonLat;
    L.circleMarker(ll(airport), { radius: 6, color: '#111827', fillColor: '#f8fafc', fillOpacity: 1, weight: 2 }).addTo(m).bindTooltip(`${site.airport.name}, ~2.3 km south`);
    m.on('click', () => m.scrollWheelZoom.enable());
    baseLayer.current = null;
    setMapId((n) => n + 1);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [lotBounds]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    baseLayer.current?.remove();
    const b = BASEMAPS[base];
    baseLayer.current = L.tileLayer(b.url, { maxZoom: 21, maxNativeZoom: b.max, attribution: '© Spatial Services NSW (CC BY 4.0)' }).addTo(m);
    baseLayer.current.bringToBack();
  }, [base, mapId]);

  // Static overlays
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const zoning = L.layerGroup();
    for (const [code, z] of Object.entries(site.zones)) {
      for (const poly of z.rings) L.polygon(poly.map((r) => r.map(ll)), { color: code === 'RU1' ? '#16a34a' : '#ea580c', weight: 2, fillOpacity: 0.22 })
        .bindTooltip(`${code} ${z.name} · ${z.areaHa.toFixed(2)} ha · min lot ${z.minLotSizeHa} ha`).addTo(zoning);
    }
    const ass = L.layerGroup();
    const assColor: Record<string, string> = { 'Class 2a': '#b91c1c', 'Class 2b': '#f97316', 'Class 5': '#facc15' };
    for (const a of site.acidSulfate) for (const poly of a.rings) L.polygon(poly.map((r) => r.map(ll)), { color: assColor[a.cls] ?? '#a855f7', weight: 1, fillOpacity: 0.3 }).bindTooltip(`Acid sulfate soils ${a.cls} · ${a.areaHa.toFixed(2)} ha`).addTo(ass);
    const flood = L.layerGroup();
    const half = 5; // 10 m grid
    for (const [lon, lat, z] of site.elevation.grid) {
      const cls = FLOOD_CLASSES.find((c) => z < c.max) ?? FLOOD_CLASSES[FLOOD_CLASSES.length - 1];
      const c = toLocal(frame, [lon, lat]);
      const sw = toLonLat(frame, [c[0] - half, c[1] - half]), ne = toLonLat(frame, [c[0] + half, c[1] + half]);
      L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { stroke: false, fillColor: cls.color, fillOpacity: 0.55 }).bindTooltip(`${z.toFixed(2)} m AHD`).addTo(flood);
    }
    groups.current.zoning = zoning; groups.current.ass = ass; groups.current.flood = flood;
    return () => { zoning.remove(); ass.remove(); flood.remove(); };
  }, [frame, mapId]);

  // Layout overlay (depends on the result)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const s = result.scenario;
    const g = L.layerGroup();
    const labels = L.layerGroup();
    const lay = site.layout;
    // Retained paddock trees & dam
    if (s.pv.keepTrees) L.polygon(lay.trees.map((r) => r.map(ll)), { color: '#166534', weight: 1, fillColor: '#15803d', fillOpacity: 0.35, dashArray: '3 3' }).bindTooltip('Retained paddock trees (shade, koala habitat)').addTo(g);
    L.circle(ll(lay.dam.centre), { radius: lay.dam.radiusM, color: '#0369a1', fillColor: '#38bdf8', fillOpacity: 0.6, weight: 1 }).bindTooltip('Farm dam').addTo(g);
    // Array rows
    const w = Math.max(0.6, result.layout.rowWidthM);
    const color = s.pv.type === 'vertical' ? '#0f172a' : '#1d4ed8';
    for (const row of result.layout.rows) {
      const [ax, ay] = row.a, [bx, by] = row.b;
      const pts: [number, number][] = result.layout.orientation === 'EW'
        ? [[ax, ay - w / 2], [bx, by - w / 2], [bx, by + w / 2], [ax, ay + w / 2]]
        : [[ax - w / 2, ay], [ax + w / 2, ay], [bx + w / 2, by], [bx - w / 2, by]];
      L.polygon(pts.map((p) => ll(toLonLat(frame, p))), { color, weight: s.pv.type === 'vertical' ? 2 : 0.5, fillColor: s.pv.type === 'vertical' ? '#0f172a' : '#2563eb', fillOpacity: 0.85 })
        .bindTooltip(`${num(row.length)} m row · ${num((row.length * result.layout.kwdc) / Math.max(1, result.layout.totalRowM))} kWp`).addTo(g);
    }
    // Equipment platform
    const padM2 = result.itKw > 0 || result.bessKwh > 0 ? padAreaM2(result.itKw, result.bessKwh, Math.max(s.grid.importLimitKw, s.grid.exportLimitKw) > 100) : 0;
    if (padM2 > 0) {
      const pw = Math.sqrt(padM2 * 2), ph = padM2 / pw;
      L.polygon(rect(frame, lay.pad.centre, pw, ph, lay.pad.angleDeg), { color: '#7c2d12', weight: 2, fillColor: '#ef4444', fillOpacity: 0.85 })
        .bindTooltip(`Raised equipment platform ${num(padM2)} m² at ${(s.site.padGroundM + s.compute.padRaiseM).toFixed(1)} m AHD: ${s.compute.servers} GPU servers, ${(result.bessKwh / 1000).toFixed(1)} MWh battery, inverters & HV kiosk`).addTo(g);
      L.marker(ll(lay.pad.centre), { icon: L.divIcon({ className: 'map-label', html: 'GPU + battery platform' }) }).addTo(labels);
    }
    // Greenhouse
    if (s.ag.greenhouseM2 > 0) {
      const gw = Math.sqrt(s.ag.greenhouseM2 * 2.5), gh = s.ag.greenhouseM2 / gw;
      L.polygon(rect(frame, lay.greenhouse.centre, gw, gh, lay.greenhouse.angleDeg), { color: '#065f46', weight: 1.5, fillColor: '#6ee7b7', fillOpacity: 0.8 })
        .bindTooltip(`Greenhouse ${num(s.ag.greenhouseM2)} m²${s.compute.heatToGreenhouse && s.compute.servers > 0 ? ', heated with GPU waste heat' : ''}`).addTo(g);
      L.marker(ll(lay.greenhouse.centre), { icon: L.divIcon({ className: 'map-label', html: 'Greenhouse' }) }).addTo(labels);
    }
    // Refuge mound
    if (s.ag.refugeMound) {
      L.polygon(rect(frame, lay.refugeMound.centre, 44, 30, lay.refugeMound.angleDeg), { color: '#78350f', weight: 1.5, fillColor: '#d97706', fillOpacity: 0.6 }).bindTooltip(`Livestock flood refuge mound, top above ${fpl(s).toFixed(1)} m AHD`).addTo(g);
      L.marker(ll(lay.refugeMound.centre), { icon: L.divIcon({ className: 'map-label', html: 'Refuge mound' }) }).addTo(labels);
    }
    // Homes
    L.circleMarker(ll(lay.house), { radius: 7, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1, weight: 2 }).bindTooltip(`Existing 4-bed home (${s.homes.houseMode === 'rent' ? 'leased' : 'owner-occupied'})`).addTo(g);
    L.marker(ll(lay.house), { icon: L.divIcon({ className: 'map-label', html: 'Existing house' }) }).addTo(labels);
    if (s.homes.grannyFlat) L.polygon(rect(frame, lay.grannyFlat, 10, 6, 0), { color: '#0f766e', weight: 1.5, fillColor: '#5eead4', fillOpacity: 0.9 }).bindTooltip('Granny flat (60 m², floor at flood planning level)').addTo(g);
    lay.cabins.slice(0, Math.min(s.homes.cabins, lay.cabins.length)).forEach((c, i) => {
      L.polygon(rect(frame, c, 11, 6, -8), { color: '#0f766e', weight: 1.5, fillColor: '#99f6e4', fillOpacity: 0.95 }).bindTooltip(`Farm-stay cabin ${i + 1} on piers`).addTo(g);
    });
    if (s.homes.cabins > lay.cabins.length) L.marker(ll(lay.cabins[lay.cabins.length - 1]), { icon: L.divIcon({ className: 'map-label warn', html: `+${s.homes.cabins - lay.cabins.length} more cabins (no site shown)` }) }).addTo(labels);
    if (s.homes.cabins > 0) L.marker(ll(lay.cabins[Math.min(2, s.homes.cabins - 1)]), { icon: L.divIcon({ className: 'map-label', html: 'Farm-stay cabins' }) }).addTo(labels);
    // Access track
    L.polyline(lay.accessTrack.map(ll), { color: '#fef3c7', weight: 3, opacity: 0.9, dashArray: '8 6' }).bindTooltip('All-weather access track (raised)').addTo(g);
    if (result.layout.rows.length) {
      let sx = 0, sy = 0, sw = 0;
      for (const row of result.layout.rows) { sx += ((row.a[0] + row.b[0]) / 2) * row.length; sy += ((row.a[1] + row.b[1]) / 2) * row.length; sw += row.length; }
      const p = toLonLat(frame, [sx / sw, sy / sw]);
      L.marker(ll(p), { icon: L.divIcon({ className: 'map-label big', html: `${(result.layout.kwdc / 1000).toFixed(2)} MWp array${s.ag.underArray === 'none' ? '' : `<br/>${s.ag.underArray} grazing beneath`}` }) }).addTo(labels);
    }
    groups.current.layout = g;
    groups.current.labels = labels;
    if (on.layout) g.addTo(m);
    if (on.labels) labels.addTo(m);
    return () => { g.remove(); labels.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, frame, mapId]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (Object.keys(on) as LayerKey[]).forEach((k) => {
      const grp = groups.current[k];
      if (!grp) return;
      if (on[k] && !m.hasLayer(grp)) grp.addTo(m);
      if (!on[k] && m.hasLayer(grp)) grp.remove();
    });
  }, [on, result, mapId]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" style={{ height }} />
      {showControls && (
        <div className="map-controls">
          <div className="map-panel">
            <strong>Base map</strong>
            {(Object.keys(BASEMAPS) as (keyof typeof BASEMAPS)[]).map((k) => (
              <label key={k}><input type="radio" name="basemap" checked={base === k} onChange={() => setBase(k)} /> {BASEMAPS[k].label}</label>
            ))}
            <strong>Layers</strong>
            {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
              <label key={k}><input type="checkbox" checked={on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} /> {LAYER_LABELS[k]}</label>
            ))}
            <button type="button" className="btn small" onClick={() => map.current?.fitBounds(lotBounds, { padding: [20, 20] })}>Zoom to lot</button>
          </div>
          {on.flood && (
            <div className="map-panel legend">
              <strong>Ground level vs design floods</strong>
              {FLOOD_CLASSES.map((c) => <div key={c.color}><span className="swatch" style={{ background: c.color }} />{c.label}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
