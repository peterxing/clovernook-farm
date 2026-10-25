import siteJson from '../data/site.json';
import climateJson from '../data/climate.json';
import pricesJson from '../data/prices.json';
import type { SiteData } from '../engine/site';
import type { Climate } from '../engine/types';
import { createContext, type Context } from '../engine/model';

export const site = siteJson as unknown as SiteData;
export const climate = climateJson as unknown as Climate & { source: string; url: string; dniScale: number; monthsSelected: { month: number; year: number }[] };
export const prices = pricesJson as unknown as { source: string; url: string; period: string; intervalMean: number; negativeIntervalShare: number; price: number[] };

let ctx: Context | null = null;
export function getContext(): Context {
  if (!ctx) ctx = createContext(site, climate, prices.price);
  return ctx;
}
