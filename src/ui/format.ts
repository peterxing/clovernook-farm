export const aud = (v: number, digits?: number) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (digits === undefined) {
    if (a >= 1e6) return `${sign}A$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${sign}A$${Math.round(a / 1e3).toLocaleString()}k`;
    return `${sign}A$${Math.round(a).toLocaleString()}`;
  }
  return `${sign}A$${a.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
};
export const audFull = (v: number) => `${v < 0 ? '−' : ''}A$${Math.round(Math.abs(v)).toLocaleString()}`;
export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const kw = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${Math.round(v).toLocaleString()} kW`);
export const kwp = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} MWp` : `${Math.round(v).toLocaleString()} kWp`);
export const kwh = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)} MWh` : `${Math.round(v).toLocaleString()} kWh`);
export const mwh = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} GWh` : `${Math.round(v).toLocaleString()} MWh`);
export const years = (v: number | null) => (v === null || !Number.isFinite(v) ? 'never' : `${v.toFixed(1)} yrs`);
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const PV_LABEL = { fixed: 'Elevated fixed tilt', tracker: 'High-clearance single-axis tracker', vertical: 'Vertical bifacial fences' } as const;
export const USE_LABEL: Record<string, string> = { sheep: 'Sheep', cattle: 'Cattle', poultry: 'Free-range hens', hay: 'Hay / silage', none: 'Not farmed' };
