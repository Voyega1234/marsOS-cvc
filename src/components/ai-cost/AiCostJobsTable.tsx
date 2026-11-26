"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Segmented } from "@/components/ds";
import { fmtInt, fmtCost } from "@/lib/ai-cost-format";
import type { AiCostSort } from "@/lib/ai-cost-filters";
import type { JobRow } from "@/lib/ai-cost-data";

const timeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

const STATUS = {
  ok: { label: "สำเร็จ", cls: "badge-done" },
  failed: { label: "ล้มเหลว", cls: "badge-error" },
  other: { label: "ค้าง/อื่นๆ", cls: "badge-neutral" },
} as const;

export function AiCostJobsTable({ jobs, total, page, pageSize, totalPages, sort, onSort, onPage }: {
  jobs: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: AiCostSort;
  onSort: (s: AiCostSort) => void;
  onPage: (p: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, (page - 1) * pageSize + jobs.length);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">แสดง {fmtInt(start)}–{fmtInt(end)} จาก {fmtInt(total)} ครั้ง</p>
        <Segmented<AiCostSort> size="sm" ariaLabel="เรียงตาม" value={sort} onChange={onSort}
          options={[{ value: "time", label: "เวลาล่าสุด" }, { value: "cost", label: "ค่าใช้จ่ายสูงสุด" }]} />
      </div>

      <div className="-mx-4 mt-2 overflow-x-auto md:-mx-5">
        <table className="tbl w-full min-w-[920px] text-left">
          <thead>
            <tr>
              {["เวลา", "ระบบ", "ประเภทงาน", "โมเดล", "โปรเจกต์/ลูกค้า", "ผู้ใช้", "Tokens", "ค่าใช้จ่าย", "สถานะ"].map((h, i) => (
                <th key={h} className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 md:px-4 ${i === 6 || i === 7 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const st = STATUS[j.status];
              return (
                <tr key={j.id}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-gray-500 md:px-4">{timeFmt.format(new Date(j.createdAt))}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-700 md:px-4">{j.moduleLabel}</td>
                  <td className="px-3 py-2.5 md:px-4">
                    <div className="max-w-[220px] truncate font-mono text-[11px] text-brand-navy" title={j.jobType}>{j.jobType}</div>
                    {j.status === "failed" && j.errorMessage && (
                      <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-red-500" title={j.errorMessage}>{j.errorMessage}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 md:px-4">
                    <div className="max-w-[160px] truncate text-xs text-gray-700" title={j.modelName}>{j.modelName}</div>
                    <div className="text-[10px] text-gray-400">{j.modelProvider}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 md:px-4">
                    <div className="max-w-[160px] truncate" title={j.sourceName ?? undefined}>{j.sourceName ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 md:px-4">
                    <div className="max-w-[120px] truncate" title={j.userName ?? undefined}>{j.userName ?? "—"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-gray-600 md:px-4">{j.tokens == null ? "—" : fmtInt(j.tokens)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-brand-navy md:px-4">{j.cost > 0 ? fmtCost(j.cost) : "—"}</td>
                  <td className="px-3 py-2.5 md:px-4">
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`} title={j.rawStatus}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-40">
            <ChevronLeft size={14} aria-hidden /> ก่อนหน้า
          </button>
          <span className="text-xs tabular-nums text-gray-500">หน้า {fmtInt(page)} / {fmtInt(totalPages)}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-40">
            ถัดไป <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
