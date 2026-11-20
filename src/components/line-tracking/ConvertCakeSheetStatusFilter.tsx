"use client";

import { useRouter } from "next/navigation";
import { ccStatusName } from "@/lib/line-tracking/services/convertCakeSheetPlan";

/** Value of the "not in the sheet yet" option. */
export const CC_NO_SHEET = "-";

/**
 * Convert Cake only: filter leads by the status name in Convert Cake's sheet
 * ("A. Spam" … "K. No opportunity") instead of the MarsOS status.
 * Counts come from the leads that pass the other filters. `extra` carries the page's
 * other parameters so switching status keeps them.
 */
export function ConvertCakeSheetStatusFilter({
  base,
  active,
  counts,
  noSheet,
  extra = {},
}: {
  base: string;
  active?: string;
  counts: Record<string, number>;
  /** Leads not linked to a sheet row. */
  noSheet: number;
  extra?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const keep = Object.entries(extra).filter(([, v]) => v != null && v !== "") as [string, string][];
  const href = (sheet?: string) => {
    const s = new URLSearchParams(sheet ? [["sheet", sheet], ...keep] : keep).toString();
    return s ? `${base}?${s}` : base;
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + noSheet;
  const labels = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  if (active && active !== CC_NO_SHEET && !labels.includes(active)) labels.push(active);

  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">สถานะ</span>
      <select
        value={active ?? ""}
        onChange={(e) => router.push(href(e.target.value || undefined))}
        className={`w-full max-w-full rounded-full px-3 py-2 text-sm ring-1 sm:w-auto sm:py-1.5 ${
          active ? "bg-brand-blue text-white ring-brand-blue" : "bg-white text-slate-600 ring-slate-200"
        }`}
      >
        <option value="">ทุกสถานะ ({total})</option>
        {labels.map((s) => (
          <option key={s} value={s}>
            {ccStatusName(s)} ({counts[s] ?? 0})
          </option>
        ))}
        <option value={CC_NO_SHEET}>ยังไม่มีสถานะ ({noSheet})</option>
      </select>
    </label>
  );
}
