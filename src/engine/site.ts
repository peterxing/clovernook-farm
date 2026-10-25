export type LonLat = [number, number];
export type GeoRing = LonLat[];
export type GeoPolygon = GeoRing[]; // [outer, ...holes]

export interface SiteData {
  generated: string;
  address: string;
  lotPlan: string;
  addressPoint: LonLat;
  centroid: LonLat;
  areaHa: number;
  perimeterM: number;
  lot: GeoRing[];
  zones: Record<'RU1' | 'R5', { areaHa: number; rings: GeoPolygon[]; minLotSizeHa: number; name: string }>;
  acidSulfate: { cls: string; areaHa: number; rings: GeoPolygon[] }[];
  elevation: {
    source: string;
    minM: number; p10M: number; medianM: number; p90M: number; maxM: number;
    haAbove: Record<string, number>;
    grid: [number, number, number][];
  };
  planning: {
    lep: string;
    zoning: Record<string, { pct: number; amendment: string }>;
    maxBuildingHeightM: number;
    heritage: boolean;
    floodPlanningMapFeatures: number;
    bushfire: string;
    obstacleLimitationSurfaceM: number;
    koalaManagementArea: boolean;
    coastalEnvironmentArea: boolean;
  };
  layout: {
    arrayZoneKeepTrees: GeoPolygon[];
    arrayZoneNoTrees: GeoPolygon[];
    arrayZoneKeepTreesHa: number;
    arrayZoneNoTreesHa: number;
    trees: GeoRing[];
    dam: { centre: LonLat; radiusM: number };
    house: LonLat;
    pad: { centre: LonLat; angleDeg: number };
    refugeMound: { centre: LonLat; angleDeg: number };
    greenhouse: { centre: LonLat; angleDeg: number };
    grannyFlat: LonLat;
    cabins: LonLat[];
    accessTrack: LonLat[];
    northBufferLine: LonLat[];
    localFrame: { originLon: number; originLat: number; mPerDegLon: number; mPerDegLat: number };
  };
  airport: { name: string; lonLat: LonLat };
  sources: { name: string; url: string }[];
}
