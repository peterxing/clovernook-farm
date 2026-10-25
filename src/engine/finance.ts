export function npv(rate: number, flows: number[]): number {
  let v = 0;
  for (let t = 0; t < flows.length; t++) v += flows[t] / Math.pow(1 + rate, t);
  return v;
}

/** IRR by bisection; null when the cash flows never change sign or no root in (-99%, 300%). */
export function irr(flows: number[]): number | null {
  const hasNeg = flows.some((f) => f < 0), hasPos = flows.some((f) => f > 0);
  if (!hasNeg || !hasPos) return null;
  let lo = -0.99, hi = 3;
  let fLo = npv(lo, flows), fHi = npv(hi, flows);
  if (Number.isNaN(fLo) || Number.isNaN(fHi) || fLo * fHi > 0) {
    // Scan for a bracket (handles non-conventional cash flows).
    let prev = lo, fPrev = fLo, found = false;
    for (let r = -0.95; r <= 3; r += 0.05) {
      const f = npv(r, flows);
      if (fPrev * f <= 0) { lo = prev; hi = r; fLo = fPrev; fHi = f; found = true; break; }
      prev = r; fPrev = f;
    }
    if (!found) return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-6 || hi - lo < 1e-9) return mid;
    if (fLo * fm < 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
  }
  return (lo + hi) / 2;
}

/** Years until cumulative cash turns positive (linear within the year), null if never. */
export function payback(flows: number[]): number | null {
  let cum = flows[0];
  if (cum >= 0) return 0;
  for (let t = 1; t < flows.length; t++) {
    const next = cum + flows[t];
    if (next >= 0) return t - 1 + (flows[t] !== 0 ? -cum / flows[t] : 0);
    cum = next;
  }
  return null;
}

export function annuity(principal: number, ratePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const r = ratePct / 100;
  if (r === 0) return principal / years;
  return (principal * r) / (1 - Math.pow(1 + r, -years));
}
