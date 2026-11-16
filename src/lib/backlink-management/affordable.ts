/** คำนวณว่างบที่เหลือซื้อเว็บในคลังได้กี่เว็บ — ไฟล์บริสุทธิ์ ใช้ได้ทั้ง client และ server */
import { PRICE_TYPES } from "./vendor-detail";
import { round2 } from "./budget";

export interface AffordableInput {
  id: string; domain: string; category: string; price: number;
  domainRating: number | null; traffic: number | null; linkType: string;
  priceBacklink?: number | null; pricePublisherWeb?: number | null; pricePublisherWebFb?: number | null;
  priceCvcWeb?: number | null; priceCvcWebFb?: number | null; pricePr?: number | null;
}
export interface PriceOption { label: string; price: number }
export interface AffordableSite {
  id: string; domain: string; category: string; domainRating: number | null; traffic: number | null; linkType: string;
  minPrice: number;
  options: PriceOption[];
  maxLinks: number;
}
export interface AffordableResult {
  sites: AffordableSite[];
  total: number;
  pricedSites: number;
  cheapest: number | null;
  greedyCount: number;
  greedyCost: number;
}

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function priceOptions(v: AffordableInput): PriceOption[] {
  const out: PriceOption[] = [];
  for (const t of PRICE_TYPES) {
    const p = v[t.key];
    if (ok(p)) out.push({ label: t.label, price: round2(p) });
  }
  if (out.length === 0) return ok(v.price) ? [{ label: "ราคาเริ่มต้น", price: round2(v.price) }] : [];
  return out
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.price - b.o.price || a.i - b.i)
    .map((x) => x.o);
}

export function affordableSites(remainingRaw: number, vendors: AffordableInput[], limit = 50): AffordableResult {
  const remaining = round2(remainingRaw);
  const priced = vendors
    .map((v) => ({ v, options: priceOptions(v) }))
    .filter((x) => x.options.length > 0)
    .map((x) => ({ ...x, min: x.options[0].price }));
  const pricedSites = priced.length;
  const cheapest = pricedSites ? Math.min(...priced.map((x) => x.min)) : null;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { sites: [], total: 0, pricedSites, cheapest, greedyCount: 0, greedyCost: 0 };
  }
  const afford = priced
    .filter((x) => x.min <= remaining)
    .sort((a, b) => {
      const da = a.v.domainRating, db = b.v.domainRating;
      if (da !== db) {
        if (da === null || da === undefined) return 1;
        if (db === null || db === undefined) return -1;
        return db - da;
      }
      return a.min - b.min || a.v.domain.localeCompare(b.v.domain);
    });
  const sites: AffordableSite[] = afford.slice(0, Math.max(0, limit)).map((x) => ({
    id: x.v.id, domain: x.v.domain, category: x.v.category, domainRating: x.v.domainRating ?? null,
    traffic: x.v.traffic ?? null, linkType: x.v.linkType,
    minPrice: x.min,
    options: x.options.filter((o) => o.price <= remaining),
    maxLinks: Math.floor(round2(remaining / x.min)),
  }));
  let sum = 0, count = 0;
  for (const m of priced.map((x) => x.min).sort((a, b) => a - b)) {
    const next = round2(sum + m);
    if (next > remaining) break;
    sum = next; count++;
  }
  return { sites, total: afford.length, pricedSites, cheapest, greedyCount: count, greedyCost: round2(sum) };
}
