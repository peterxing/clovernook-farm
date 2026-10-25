import { describe, expect, it } from 'vitest';
import { abaresRow, dayMonthToIso, parseFaoCsv, parseInfolinkModule, parseLgc, parseNeo, parseRbaF11, parseUnitree, plain, vastGpuPrices } from '../scripts/parsers';

describe('feed parsers', () => {
  it('RBA F11.1: last daily AUD/USD', () => {
    const csv = 'F11.1 EXCHANGE RATES\nTitle,A$1=USD,Trade-weighted\nSeries ID,FXRUSD,FXRTWI\n22-Oct-2026,0.6991,63.1\n23-Oct-2026,0.7006,63.2\n';
    expect(parseRbaF11(csv)).toEqual({ audUsd: 0.7006, date: '2026-10-23' });
    expect(() => parseRbaF11('no data')).toThrow();
  });

  it('Vast.ai: per-GPU prices, sorted', () => {
    expect(vastGpuPrices({ offers: [{ dph_total: 80, num_gpus: 8 }, { dph_total: 9, num_gpus: 1 }, { dph_total: 0, num_gpus: 1 }] })).toEqual([9, 10]);
  });

  it('InfoLink: TOPCon module average', () => {
    const html = `<tr>
      <td align="left" nowrap>182*182-210mm/210mm Mono TOPCon Module (USD)</td>
      <td align="right">0.500 </td>
      <td align="right">0.100 </td>
      <td align="right">0.114 </td>
      <td align="right"><span class="">--</span></td></tr>`;
    expect(parseInfolinkModule(html)).toBe(0.114);
    expect(() => parseInfolinkModule('<table></table>')).toThrow();
  });

  it('ABARES: livestock indicator rows and dates', () => {
    const html = '<tr><td colspan="8"><strong>Selected domestic livestock indicator prices</strong></td></tr>'
      + '<tr><td style="text-align:right;">Beef – Eastern Young Cattle Indicator</td><td>14-Oct</td><td>Ac/kg cwt</td><td>939</td><td>918</td><td>2%</td><td>846</td><td>11%</td></tr>'
      + '<tr><td>Lamb – National Trade Lamb Indicator</td><td>14-Oct</td><td>Ac/kg cwt</td><td>1,150</td><td>1,127</td><td>2%</td><td>1,108</td><td>4%</td></tr>';
    expect(abaresRow(html, /Eastern Young Cattle Indicator/)).toMatchObject({ value: 939, prev: 918, yearAgo: 846, date: '14-Oct' });
    expect(abaresRow(html, /National Trade Lamb Indicator/)?.value).toBe(1150);
    expect(abaresRow(html, /Mutton/)).toBeNull();
    expect(dayMonthToIso('14-Oct', new Date('2026-10-26T00:00:00Z'))).toBe('2026-10-14');
    expect(dayMonthToIso('28-Dec', new Date('2027-01-05T00:00:00Z'))).toBe('2026-12-28');
  });

  it('FAO: latest monthly index', () => {
    const csv = 'FAO Food Price Index,,,\n2014-2016=100,,,\nDate,Food Price Index,Meat,Dairy\n,,,\n2026-08,134.0,129.3,119.2,,,\n2026-09,136.0,127.9,119.1,,,\n';
    expect(parseFaoCsv(csv)).toEqual({ value: 136, meat: 127.9, month: '2026-09' });
  });

  it('Ecovantage: LGC spot close, ignoring forward prices', () => {
    const week1 = plain('<h2>Weekly Market Update | 12 &#8211; 16 October 2026</h2><p>The LGC spot market remained stable throughout the week. Closing at a lower of 5 bps compared to last week’s closing of $7.90, at $7.85. It opened at $7.85 on Monday and continued its fluctuation to $7.80 on Tuesday before peaking at $7.95 mid week and finally closing at $7.85 on Friday.</p><p>The forward LGC market opened the week with trades for CAL 27–29, driven by CAL 29 clearing up to $7.15 in 20k and CAL 27 reaching $8.15.</p>');
    expect(parseLgc(week1)).toEqual({ price: 7.85, week: '12 - 16 October 2026' });
    const week2 = plain('<h2>Weekly Market Update | 19 &#8211; 23 October 2026</h2><p>The LGC spot market opened and closed actively last week. On Monday LGCs saw active trading with prices between $7.50 and $7.80 across 117k certificates. Activity slowed on Tuesday to 60k certificates traded at $7.60 and $7.75, followed by a quiet mid-week with no trades reported on Wednesday or Thursday. Trading continued on Friday at slightly lower valuation levels, with 55k certificates exchanging hands between $7.50 and $7.55.</p><p>The LGC forward market saw active trading across multiple vintages during the week. Market opened softly at the start of the week following steady inclines upon closing, with CAL 26 dipping to a low of $7.20.</p>');
    expect(parseLgc(week2)).toEqual({ price: 7.55, week: '19 - 23 October 2026' });
    expect(() => parseLgc('nothing here')).toThrow();
  });

  it('Unitree and 1X: humanoid list prices', () => {
    const products = { products: [
      { title: 'Unitree R1', variants: [{ price: '5900.00' }, { price: '4900.00' }] },
      { title: 'Unitree H2', variants: [{ price: '29900.00' }] },
      { title: 'Unitree H1（Contact us for the real price）', variants: [{ price: '90000.00' }] },
      { title: 'Unitree Dex5-S Dexterous Hand', variants: [{ price: '6350.00' }] },
    ] };
    expect(parseUnitree(products)).toEqual([{ name: 'Unitree R1', fromUsd: 4900 }, { name: 'Unitree H2', fromUsd: 29900 }, { name: 'Unitree H1', fromUsd: 90000 }]);
    expect(parseNeo('Standard $499/mo Subscription Monthly Subscription Early Access $20,000 Ownership Ownership with 3-Year Warranty')).toEqual({ priceUsd: 20000, monthlyUsd: 499 });
  });
});
