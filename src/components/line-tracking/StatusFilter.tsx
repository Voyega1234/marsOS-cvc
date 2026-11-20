"use client";

import { useRouter } from "next/navigation";
import { LEAD_STATUS, LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/line-tracking/enums";

/**
 * Dropdown กรองตามสถานะ lead — แสดงทุกสถานะเสมอ (นับ 0 ก็เลือกได้)
 * จำนวนนับจากผลลัพธ์ที่ผ่านตัวกรองอื่นแล้ว (ยกเว้นตัวกรองสถานะเอง)
 * `extra` พาพารามิเตอร์อื่นของหน้าไปด้วย สลับสถานะแล้วตัวกรองเดิมต้องไม่หาย
 */
export function StatusFilter({
  base,
  active,
  counts,
  extra = {},
  statuses = LEAD_STATUS,
}: {
  base: string;
  active?: string;
  counts: Record<string, number>;
  extra?: Record<string, string | undefined>;
  /** Statuses this project uses (KOWA has no WON). */
  statuses?: readonly LeadStatus[];
}) {
  const router = useRouter();
  const keep = Object.entries(extra).filter(([, v]) => v != null && v !== "") as [string, string][];
  const href = (status?: string) => {
    const s = new URLSearchParams(status ? [["status", status], ...keep] : keep).toString();
    return s ? `${base}?${s}` : base;
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // Hidden statuses (e.g. WON in KOWA) still appear while leads remain in them.
  const options = LEAD_STATUS.filter((s) => statuses.includes(s) || (counts[s] ?? 0) > 0 || s === active);

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
        {options.map((s) => (
          <option key={s} value={s}>
            {s} · {LEAD_STATUS_LABEL[s]} ({counts[s] ?? 0})
          </option>
        ))}
      </select>
    </label>
  );
}
