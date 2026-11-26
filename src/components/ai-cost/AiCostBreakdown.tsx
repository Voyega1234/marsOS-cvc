"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Segmented } from "@/components/ds";
import { fmtInt, fmtPct, fmtThb } from "@/lib/ai-cost-format";
import type { AiCostFilterKey, AiCostFilters } from "@/lib/ai-cost-filters";
import type { AiCostView, BreakdownRow } from "@/lib/ai-cost-data";

type Dim = "module" | "type" | "model" | "source" | "user";
const DIMS: { value: Dim; label: string; head: string }[] = [
  { value: "module", label: "แยกตามระบบ", head: "ระบบ" },
  { value: "type", label: "ประเภทงาน", head: "ประเภทงาน" },
  { value: "model", label: "โมเดล", head: "โมเดล" },
  { value: "source", label: "โปรเจกต์", head: "โปรเจกต์/ลูกค้า" },
  { value: "user", label: "ผู้ใช้", head: "ผู้ใช้" },
];

export function AiCostBreakdown({ breakdown, total, filters, onDrill }: {
  breakdown: AiCostView["breakdown"];
  total: number;
  filters: AiCostFilters;
  onDrill: (patch: Partial<Record<AiCostFilterKey, string>>) => void;
}) {
  const [dim, setDim] = useState<Dim>("module");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const rows = breakdown[dim];
  const head = DIMS.find((d) => d.value === dim)!.head;
  const filterKey: AiCostFilterKey = dim;
  const toggle = (k: string) => setOpenKeys((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const renderRow = (r: BreakdownRow, opts: { child?: boolean; parentKey?: string } = {}) => {
    const selected = opts.child ? filters.type === r.key : filters[filterKey] === r.key;
    const expandable = dim === "module" && !opts.child && (r.children?.length ?? 0) > 0;
    const expanded = openKeys.has(r.key);
    const drill = () => onDrill(opts.child ? { module: opts.parentKey, type: r.key } : { [filterKey]: r.key });
    return (
      <Fragment key={`${opts.parentKey ?? ""}/${r.key}`}>
        <tr className={`cursor-pointer ${selected ? "bg-brand-mist/70" : ""}`} onClick={drill}>
          <td className="px-3 py-2.5 md:px-4">
            <div className={`flex items-center gap-1.5 ${opts.child ? "pl-6" : ""}`}>
              {expandable ? (
                <button type="button" aria-label={expanded ? "ซ่อนประเภทงาน" : "ดูประเภทงานในระบบนี้"} aria-expanded={expanded}
                  onClick={(e) => { e.stopPropagation(); toggle(r.key); }} className="rounded p-0.5 text-gray-400 hover:text-brand-navy">
                  {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                </button>
              ) : !opts.child && dim === "module" ? <span className="w-[18px]" /> : null}
              <button type="button" onClick={(e) => { e.stopPropagation(); drill(); }} className="min-w-0 text-left" title={`กรองเฉพาะ ${r.label}`}>
                <span className="block max-w-[220px] truncate text-xs font-medium text-brand-navy">{r.label}</span>
                {r.sub && <span className="block max-w-[220px] truncate text-[10px] text-gray-400">{r.sub}</span>}
              </button>
            </div>
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-brand-navy md:px-4">{fmtThb(r.cost)}</td>
          <td className="px-3 py-2.5 md:px-4">
            <div className="flex min-w-[110px] items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--chart-track)" }}>
                <div className="h-full rounded-full bg-brand-blue" style={{ width: `${total > 0 ? Math.min(100, (r.cost / total) * 100) : 0}%` }} />
              </div>
              <span className="w-9 text-right text-[11px] tabular-nums text-gray-500">{fmtPct(r.cost, total)}</span>
            </div>
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-gray-600 md:px-4">{fmtInt(r.calls)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-gray-600 md:px-4">{fmtInt(r.tokens)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-gray-600 md:px-4">{fmtThb(r.calls > 0 ? r.cost / r.calls : 0)}</td>
          <td className={`whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums md:px-4 ${r.failed > 0 ? "font-semibold text-red-500" : "text-gray-400"}`}>
            {r.failed > 0 ? `${fmtInt(r.failed)}` : "0"}
          </td>
        </tr>
        {expandable && expanded && r.children!.map((c) => renderRow(c, { child: true, parentKey: r.key }))}
      </Fragment>
    );
  };

  return (
    <div>
      <Segmented<Dim> ariaLabel="แยกค่าใช้จ่ายตาม" options={DIMS.map((d) => ({ value: d.value, label: d.label }))} value={dim} onChange={setDim} size="sm" />
      <p className="mt-2 text-[11px] text-gray-500">กดที่แถวเพื่อกรองเฉพาะรายการนั้นทั้งหน้า</p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">ไม่มีข้อมูล</p>
      ) : (
        <div className="-mx-4 mt-2 overflow-x-auto md:-mx-5">
          <table className="tbl w-full min-w-[640px] text-left">
            <thead>
              <tr>
                {[head, "ค่าใช้จ่าย", "สัดส่วน", "ครั้ง", "Tokens", "เฉลี่ย/ครั้ง", "ล้มเหลว"].map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 md:px-4 ${i === 0 || i === 2 ? "" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map((r) => renderRow(r))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
