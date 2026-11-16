"use client";

import { Chip } from "@/components/ds";
import { VENDOR_RANK_LABEL, vendorRank } from "@/lib/backlink-management/vendor-rank";

/** Rank badge for a vendor site, from its starting price. Shows a dash when the site has no price yet. */
export default function VendorRankChip({ price }: { price: number | null | undefined }) {
  const r = vendorRank(price);
  if (!r) return <span className="text-gray-400">—</span>;
  return <Chip tone={r === "HIGH_AUTHORITY" ? "info" : "muted"} dot>{VENDOR_RANK_LABEL[r]}</Chip>;
}
