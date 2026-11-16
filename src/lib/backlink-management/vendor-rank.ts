/**
 * Vendor-site rank, derived from the site's starting price (BlmVendorSite.price, THB). Nothing is stored:
 * changing a price changes the rank, and changing the threshold here re-ranks every site.
 *
 *   General         0 – 7,999 THB
 *   High Authority  8,000 THB and up
 *
 * A site with no price (0 or missing) has no rank yet, because 0 means "price not filled in", not "free".
 */

export type VendorRank = "GENERAL" | "HIGH_AUTHORITY";

export const HIGH_AUTHORITY_MIN_PRICE = 8000;

export const VENDOR_RANKS: { key: VendorRank; label: string; range: string }[] = [
  { key: "HIGH_AUTHORITY", label: "High Authority", range: `${HIGH_AUTHORITY_MIN_PRICE.toLocaleString("en-US")}+ บาท` },
  { key: "GENERAL", label: "General", range: `0–${(HIGH_AUTHORITY_MIN_PRICE - 1).toLocaleString("en-US")} บาท` },
];

export const VENDOR_RANK_LABEL: Record<VendorRank, string> = { GENERAL: "General", HIGH_AUTHORITY: "High Authority" };

/** Rank for a starting price, or null when the site has no price yet. */
export function vendorRank(price: number | null | undefined): VendorRank | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  return price >= HIGH_AUTHORITY_MIN_PRICE ? "HIGH_AUTHORITY" : "GENERAL";
}
