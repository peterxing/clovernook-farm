import type { Climate, PvType } from './types';

const D2R = Math.PI / 180;
export const HOURS = 8760;
const AEST_OFFSET_H = 10;
const MIN_COS_ZEN = Math.cos(85 * D2R);

export interface SunGeometry {
  cosZen: Float64Array;
  sinZen: Float64Array;
  azimuth: Float64Array; // radians, clockwise from north
  dniExtra: Float64Array;
}

/** Solar position (NOAA/Spencer series) at the middle of every AEST hour of a 365-day year. */
export function sunGeometry(lat: number, lon: number, offsetH = 0.5): SunGeometry {
  const cosZen = new Float64Array(HOURS), sinZen = new Float64Array(HOURS), azimuth = new Float64Array(HOURS), dniExtra = new Float64Array(HOURS);
  const phi = lat * D2R;
  for (let i = 0; i < HOURS; i++) {
    // AEST hour i starts at i; irradiance represents i + offset (AEST) = i + offset - 10 (UTC)
    const tUtc = i + offsetH - AEST_OFFSET_H;
    const dayFloat = tUtc / 24; // days since 1 Jan 00:00 UTC (may be negative for the first hours)
    const doy = Math.floor(dayFloat) + 1;
    const hourUtc = (dayFloat - Math.floor(dayFloat)) * 24;
    const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourUtc - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = hourUtc * 60 + eqt + 4 * lon;
    const ha = (tst / 4 - 180) * D2R;
    const cz = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
    cosZen[i] = cz;
    sinZen[i] = Math.sqrt(Math.max(0, 1 - cz * cz));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
    if (az >= 2 * Math.PI) az -= 2 * Math.PI;
    azimuth[i] = az;
    dniExtra[i] = 1367 * (1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365));
  }
  return { cosZen, sinZen, azimuth, dniExtra };
}

export interface PvProfileConfig {
  type: PvType;
  tiltDeg: number;
  gcr: number;
  albedo: number;
  bifaciality: number;
  clearanceM: number;
  trackerMaxAngleDeg: number;
  tempCoeffPctPerC: number;
  systemLossPct: number;
  moduleLengthM: number;
  moduleWidthM: number;
}

export interface PvProfile {
  /** DC output in kW per kWp installed, for each hour (year 1). */
  dcPerKwp: Float64Array;
  /** Plane-of-array effective irradiance (front + bifacial rear), W/m2 */
  poaEff: Float64Array;
  annualDcPerKwp: number;
}

const iam = (cosAoi: number) => (cosAoi <= 0 ? 0 : Math.max(0, 1 - 0.05 * (1 / cosAoi - 1)));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Collector width across the row (fixed: 2 modules in portrait; tracker: 1 in portrait; vertical: 2 in landscape). */
export function collectorWidthM(type: PvType, moduleLengthM: number, moduleWidthM: number): number {
  if (type === 'fixed') return 2 * moduleLengthM + 0.02;
  if (type === 'tracker') return moduleLengthM;
  return 2 * moduleWidthM + 0.02;
}

/**
 * Hourly DC output per kWp for one array configuration: Hay-Davies transposition, bifacial rear gain,
 * row-to-row shading (fixed, vertical) or backtracking (tracker), Faiman cell temperature.
 */
export function pvProfile(cfg: PvProfileConfig, sun: SunGeometry, climate: Climate): PvProfile {
  const dcPerKwp = new Float64Array(HOURS);
  const poaEff = new Float64Array(HOURS);
  const gcr = Math.max(0.05, Math.min(0.9, cfg.gcr));
  const width = collectorWidthM(cfg.type, cfg.moduleLengthM, cfg.moduleWidthM);
  const pitchOverWidth = 1 / gcr;
  const beta = cfg.tiltDeg * D2R;
  const cosB = Math.cos(beta), sinB = Math.sin(beta);
  const maxRot = cfg.trackerMaxAngleDeg * D2R;
  // More clearance lets light reach the ground under the array (rear-side irradiance and pasture).
  const clearanceBenefit = Math.min(0.6, Math.max(0, cfg.clearanceM) / 7);
  const groundFactor = cfg.type === 'vertical' ? 0.95 : 1 - gcr * (1 - clearanceBenefit);
  const rearStructure = cfg.type === 'vertical' ? 0.95 : cfg.type === 'tracker' ? 0.88 : 0.85;
  const u0 = cfg.type === 'vertical' ? 30 : 27, u1 = 6.5;
  const gamma = cfg.tempCoeffPctPerC / 100;
  const lossFactor = 1 - cfg.systemLossPct / 100;
  let annual = 0;
  void width;

  for (let i = 0; i < HOURS; i++) {
    const ghi = climate.ghi[i], dni = climate.dni[i], dhi = climate.dhi[i];
    const cz = sun.cosZen[i];
    if (ghi <= 0 || cz <= 0) continue;
    const sz = sun.sinZen[i], az = sun.azimuth[i];
    const sx = sz * Math.sin(az); // east component of the sun vector
    const sy = sz * Math.cos(az); // north component
    const ai = Math.min(1, dni / sun.dniExtra[i]);
    const czFloor = Math.max(cz, MIN_COS_ZEN);
    let front = 0, rear = 0;

    if (cfg.type === 'fixed') {
      // North-facing rows (southern hemisphere), rows run east-west.
      const cosAoi = sinB * sy + cosB * cz;
      let shade = 0;
      if (sy > 0) {
        const elev = Math.asin(Math.min(1, cz));
        const ap = Math.atan2(Math.tan(elev), sy / sz);
        shade = clamp01(1 - pitchOverWidth * (Math.sin(ap) / Math.sin(ap + beta)));
      }
      const beam = dni * Math.max(0, cosAoi) * iam(cosAoi) * (1 - Math.min(1, 1.5 * shade));
      const sky = dhi * (ai * (Math.max(0, cosAoi) / czFloor) + (1 - ai) * (1 + cosB) / 2) * 0.97;
      const ground = ghi * cfg.albedo * (1 - cosB) / 2 * 0.92;
      front = beam + sky + ground;
      const cosBack = -cosAoi;
      const rBeam = dni * Math.max(0, cosBack) * iam(cosBack);
      const rSky = dhi * ((1 - ai) * (1 - cosB) / 2 + ai * (Math.max(0, cosBack) / czFloor));
      const rGround = ghi * cfg.albedo * (1 + cosB) / 2 * groundFactor;
      rear = (rBeam + rSky + rGround) * rearStructure;
    } else if (cfg.type === 'tracker') {
      // Horizontal north-south axis tracking east-west, with backtracking.
      let theta = Math.atan2(sx, cz);
      const temp = Math.abs(Math.cos(theta)) / gcr;
      if (temp < 1) theta -= Math.sign(theta) * Math.acos(temp);
      if (theta > maxRot) theta = maxRot;
      if (theta < -maxRot) theta = -maxRot;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      const cosAoi = sinT * sx + cosT * cz;
      const beam = dni * Math.max(0, cosAoi) * iam(cosAoi);
      const sky = dhi * (ai * (Math.max(0, cosAoi) / czFloor) + (1 - ai) * (1 + cosT) / 2) * 0.97;
      const ground = ghi * cfg.albedo * (1 - cosT) / 2 * 0.92;
      front = beam + sky + ground;
      const cosBack = -cosAoi;
      const rBeam = dni * Math.max(0, cosBack) * iam(cosBack);
      const rSky = dhi * ((1 - ai) * (1 - cosT) / 2 + ai * (Math.max(0, cosBack) / czFloor));
      const rGround = ghi * cfg.albedo * (1 + cosT) / 2 * groundFactor;
      rear = (rBeam + rSky + rGround) * rearStructure;
    } else {
      // Vertical bifacial fences running north-south: front faces east, rear faces west.
      const elev = Math.asin(Math.min(1, cz));
      const tanE = Math.tan(elev);
      const horiz = Math.abs(sx) / sz; // |sin(az)|
      const shade = horiz > 1e-6 ? clamp01(1 - pitchOverWidth * (tanE / horiz)) : 0;
      const sideBeam = (cosAoi: number) => dni * Math.max(0, cosAoi) * iam(cosAoi) * (1 - Math.min(1, 1.3 * shade));
      const sideSky = (cosAoi: number) => dhi * (ai * (Math.max(0, cosAoi) / czFloor) + (1 - ai) * 0.5);
      const gr = ghi * cfg.albedo * 0.5 * groundFactor;
      front = sideBeam(sx) + sideSky(sx) * 0.97 + gr;
      rear = (sideBeam(-sx) + sideSky(-sx) + gr) * rearStructure;
    }

    const eff = front + cfg.bifaciality * rear;
    poaEff[i] = eff;
    const ws = climate.wind[i] * 0.75;
    const tc = climate.tamb[i] + eff / (u0 + u1 * ws);
    const p = (eff / 1000) * (1 + gamma * (tc - 25)) * lossFactor;
    const v = p > 0 ? p : 0;
    dcPerKwp[i] = v;
    annual += v;
  }
  return { dcPerKwp, poaEff, annualDcPerKwp: annual };
}

/**
 * Design flood levels at the nearest reporting location (D, Dumaresq Island / Cundletown) from Table 4-2 of the
 * Manning River Floodplain Risk Management Study and Plan (BMT for MidCoast Council, 2020): [m AHD, AEP].
 * The PMF has no defined probability; 1e-5 is used for interpolation only.
 */
export const FLOOD_CURVE: [number, number][] = [[2.0, 0.2], [2.5, 0.1], [3.1, 0.05], [3.8, 0.02], [4.1, 0.01], [4.5, 0.005], [4.9, 0.002], [7.3, 1e-5]];

/** Annual chance of floodwater reaching `level` (m AHD), log-linear between design events. */
export function floodAep(level: number, offsetM = 0, curve: [number, number][] = FLOOD_CURVE): number {
  const x = level - offsetM;
  const [l0, a0] = curve[0], [l1, a1] = curve[1];
  if (x <= l0) {
    const slope = (Math.log(a0) - Math.log(a1)) / (l1 - l0);
    return Math.min(1, Math.exp(Math.log(a0) + slope * (l0 - x)));
  }
  for (let k = 0; k < curve.length - 1; k++) {
    const [la, aa] = curve[k], [lb, ab] = curve[k + 1];
    if (x <= lb) return Math.exp(Math.log(aa) + ((x - la) / (lb - la)) * (Math.log(ab) - Math.log(aa)));
  }
  return curve[curve.length - 1][1];
}
