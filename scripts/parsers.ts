// Pure parsers for the daily market feeds, kept separate so they can be unit-tested against fixtures.
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const plain = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#8211;|&ndash;/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** RBA F11.1 CSV: last daily A$1 = US$ value. */
export function parseRbaF11(csv: string): { audUsd: number; date: string } {
  const rows = csv.split(/\r?\n/).filter((l) => /^\d{2}-[A-Za-z]{3}-\d{4},\d/.test(l));
  if (!rows.length) throw new Error('no RBA rows');
  const last = rows[rows.length - 1].split(',');
  const audUsd = parseFloat(last[1]);
  if (!(audUsd > 0.3 && audUsd < 1.5)) throw new Error('bad RBA value');
  const [dd, mon, yyyy] = last[0].split('-');
  return { audUsd, date: `${yyyy}-${String(MON.indexOf(mon) + 1).padStart(2, '0')}-${dd}` };
}

/** Per-GPU hourly prices from a Vast.ai bundles response. */
export function vastGpuPrices(json: { offers?: { dph_total: number; num_gpus: number }[] }): number[] {
  return (json.offers ?? []).filter((o) => o.dph_total > 0 && o.num_gpus > 0).map((o) => o.dph_total / o.num_gpus).sort((a, b) => a - b);
}

/** InfoLink spot page: average TOPCon module price (US$/W). */
export function parseInfolinkModule(html: string): number {
  const m = html.match(/Mono TOPCon Module \(USD\)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)/);
  if (!m) throw new Error('TOPCon module row not found');
  const avg = parseFloat(m[3]);
  if (!(avg > 0.03 && avg < 0.6)) throw new Error('module price out of range');
  return avg;
}

export interface AbaresRow { label: string; date: string; unit: string; value: number; prev: number; yearAgo: number }
/** ABARES weekly commodity table row: label, date, unit, latest, previous week, change, last year, change. */
export function abaresRow(html: string, label: RegExp): AbaresRow | null {
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length >= 7 && label.test(cells[0])) {
      const n = (s: string) => parseFloat(s.replace(/,/g, ''));
      return { label: cells[0], date: cells[1], unit: cells[2], value: n(cells[3]), prev: n(cells[4]), yearAgo: n(cells[6]) };
    }
  }
  return null;
}

/** "14-Oct" read on `now` → ISO date, rolling back a year for dates that would be in the future. */
export function dayMonthToIso(dm: string, now = new Date()): string {
  const [d, mon] = dm.split('-');
  const m = MON.indexOf(mon);
  let y = now.getUTCFullYear();
  if (m > now.getUTCMonth() + 1) y -= 1;
  return `${y}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** FAO Food Price Index CSV (2014-2016 = 100): latest month. */
export function parseFaoCsv(csv: string): { value: number; meat: number; month: string } {
  const rows = csv.split(/\r?\n/).map((l) => l.split(',')).filter((c) => /^\d{4}-\d{2}$/.test(c[0]?.trim() ?? '') && parseFloat(c[1]) > 0);
  if (!rows.length) throw new Error('no FPI rows');
  const last = rows[rows.length - 1];
  return { value: parseFloat(last[1]), meat: parseFloat(last[2]), month: last[0].trim() };
}

/**
 * Ecovantage weekly update (plain text): the LGC spot close. Reads only the spot paragraph (forward/CAL prices
 * follow it) and prefers the sentence about Friday or the close.
 */
export function parseLgc(text: string): { price: number; week?: string } {
  const i = text.search(/The LGC spot market/i);
  if (i < 0) throw new Error('LGC section not found');
  const fwd = text.slice(i).search(/forward\s+(?:LGC\s+)?market/i);
  const spot = text.slice(i, i + (fwd > 0 ? fwd : 900));
  const lastPrice = (s: string) => { const m = [...s.matchAll(/\$\s?(\d{1,3}\.\d{2})/g)]; return m.length ? parseFloat(m[m.length - 1][1]) : NaN; };
  const closing = spot.split(/\.\s+/).reverse().find((s) => /friday|clos/i.test(s) && /\$\s?\d/.test(s));
  const price = closing ? lastPrice(closing) : lastPrice(spot);
  if (!(price > 0.5 && price < 100)) throw new Error('LGC price not parsed');
  const wk = text.match(/Weekly Market Update \|\s*([^|]{6,40}?20\d\d)/);
  return { price, week: wk?.[1]?.trim() };
}

/** Unitree Shopify products.json: humanoids and their lowest variant price. */
export function parseUnitree(json: { products: { title: string; variants: { price: string }[] }[] }): { name: string; fromUsd: number }[] {
  return json.products
    .filter((p) => /^Unitree (R1|G1|H1|H2)/i.test(p.title) && !/hand|arm/i.test(p.title))
    .map((p) => ({ name: p.title.replace(/（.*）|\(.*\)/g, '').trim(), fromUsd: Math.min(...p.variants.map((v) => parseFloat(v.price)).filter((v) => v > 0)) }))
    .filter((p) => Number.isFinite(p.fromUsd));
}

/** 1X order page (plain text): ownership price and monthly subscription. */
export function parseNeo(text: string): { priceUsd?: number; monthlyUsd?: number } {
  const own = text.match(/\$\s?([\d,]{5,})\s*Ownership/i), mo = text.match(/\$\s?([\d,]+)\s*\/\s*mo/i);
  return { priceUsd: own ? parseFloat(own[1].replace(/,/g, '')) : undefined, monthlyUsd: mo ? parseFloat(mo[1].replace(/,/g, '')) : undefined };
}
