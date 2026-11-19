"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Filter, Loader2, SlidersHorizontal, X } from "lucide-react";

import { Segmented } from "@/components/ds";
import {
  AI_COST_PRESET_LABEL, isDateKey, type AiCostPreset, type AiCostRange,
} from "@/lib/ai-cost-range";
import {
  AI_COST_FILTER_KEYS, hasActiveAiCostFilters, type AiCostFilterKey, type AiCostFilters,
} from "@/lib/ai-cost-filters";
import { aiCostModuleByKey, aiCostModuleOf } from "@/lib/ai-cost-modules";
import { fmtInt } from "@/lib/ai-cost-format";
import type { AiCostView, FilterOption } from "@/lib/ai-cost-data";

const PRESETS: AiCostPreset[] = ["today", "7d", "30d", "this_month", "last_month", "all"];
const RANGE_OPTIONS = [
  ...PRESETS.map((p) => ({ value: p as AiCostPreset | "custom", label: AI_COST_PRESET_LABEL[p] })),
  { value: "custom" as const, label: "กำหนดเอง" },
];
/** กันช่อง date ยิงค่าระหว่างพิมพ์ปี (เช่น 0002-11-03) */
const MIN_DATE = "2020-01-01";

const FIELD_LABEL: Record<AiCostFilterKey, string> = {
  module: "ระบบ", type: "ประเภทงาน", model: "โมเดล", source: "โปรเจกต์/ลูกค้า", user: "ผู้ใช้", status: "สถานะ",
};
const STATUS_LABEL = { ok: "สำเร็จ", failed: "ล้มเหลว" } as const;

/** ข้อความของค่าที่เลือก — หาจากตัวเลือกในช่วงเวลา ถ้าไม่มี (เช่นเปลี่ยนช่วงแล้ว) ใช้ค่าดิบ */
export function filterValueLabel(key: AiCostFilterKey, f: AiCostFilters, options: AiCostView["options"]): string {
  const v = f[key];
  if (!v) return "";
  if (key === "status") return STATUS_LABEL[v as "ok" | "failed"] ?? v;
  const found = options[key].find((o) => o.value === v);
  if (found) return found.label;
  return key === "module" ? aiCostModuleByKey(v).label : v;
}

export function describeView(range: AiCostRange, f: AiCostFilters, options: AiCostView["options"]): string {
  const parts = [range.label];
  for (const k of AI_COST_FILTER_KEYS) {
    if (!f[k]) continue;
    const label = filterValueLabel(k, f, options);
    parts.push(k === "status" ? `สถานะ${label}` : `${FIELD_LABEL[k]} ${label}`);
  }
  return parts.join(" · ");
}

function Select({ label, value, onChange, options, allLabel }: {
  label: string; value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel: string;
}) {
  // ตัวเลือกที่เลือกอยู่แต่ไม่อยู่ในช่วงเวลานี้ ยังต้องโชว์ ไม่งั้น select ว่าง
  const missing = value && !options.some((o) => o.value === value);
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold text-gray-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field-input !py-1.5 text-xs">
        <option value="">{allLabel}</option>
        {missing && <option value={value}>{value}</option>}
        {options.slice(0, 300).map((o) => (
          <option key={o.value} value={o.value}>{o.label} ({fmtInt(o.count)})</option>
        ))}
      </select>
    </label>
  );
}

export function AiCostFilterBar({ range, filters, options, pending, onRange, onFilter, onClear }: {
  range: AiCostRange;
  filters: AiCostFilters;
  options: AiCostView["options"];
  pending: boolean;
  onRange: (r: { preset: AiCostPreset | "custom"; from?: string; to?: string }) => void;
  onFilter: (key: AiCostFilterKey, value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(range.preset === "custom");
  const [fromInput, setFromInput] = useState(range.from ?? "");
  const [toInput, setToInput] = useState(range.to ?? "");

  useEffect(() => {
    setFromInput(range.from ?? "");
    setToInput(range.to ?? "");
    setCustom(range.preset === "custom");
  }, [range.preset, range.from, range.to]);

  const onDate = (which: "from" | "to", value: string) => {
    const from = which === "from" ? value : fromInput;
    const to = which === "to" ? value : toInput;
    if (which === "from") setFromInput(value); else setToInput(value);
    const ok = (v: string) => v === "" || (isDateKey(v) && v >= MIN_DATE);
    if ((from || to) && ok(from) && ok(to)) onRange({ preset: "custom", from, to });
  };

  const activeKeys = AI_COST_FILTER_KEYS.filter((k) => filters[k]);
  const typeOptions = filters.module ? options.type.filter((o) => aiCostModuleOf(o.value).key === filters.module) : options.type;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/80 bg-white/70 px-3 py-3 shadow-sm backdrop-blur-xl md:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CalendarDays size={14} className="shrink-0 text-gray-400" aria-hidden />
          <Segmented<AiCostPreset | "custom">
            size="sm"
            ariaLabel="ช่วงเวลา"
            options={RANGE_OPTIONS}
            value={custom ? "custom" : (range.preset as AiCostPreset)}
            onChange={(p) => {
              if (p === "custom") setCustom(true);
              else { setCustom(false); onRange({ preset: p }); }
            }}
          />
          {custom && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="ตั้งแต่วันที่" value={fromInput} min={MIN_DATE} max={toInput || undefined}
                onChange={(e) => onDate("from", e.target.value)} className="field-input !w-auto !py-1.5 text-xs" />
              <span className="text-xs text-gray-400">ถึง</span>
              <input type="date" aria-label="ถึงวันที่" value={toInput} min={fromInput || MIN_DATE}
                onChange={(e) => onDate("to", e.target.value)} className="field-input !w-auto !py-1.5 text-xs" />
            </div>
          )}
          {pending && (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" role="status">
              <Loader2 size={13} className="animate-spin" aria-hidden /> กำลังโหลด
            </span>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 md:hidden">
            <SlidersHorizontal size={13} aria-hidden /> ตัวกรอง{activeKeys.length ? ` (${activeKeys.length})` : ""}
          </button>
        </div>

        <div className={`${open ? "grid" : "hidden"} mt-3 grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid md:grid-cols-3 xl:grid-cols-6`}>
          <Select label={FIELD_LABEL.module} value={filters.module ?? ""} onChange={(v) => onFilter("module", v)} options={options.module} allLabel="ทุกระบบ" />
          <Select label={FIELD_LABEL.type} value={filters.type ?? ""} onChange={(v) => onFilter("type", v)} options={typeOptions} allLabel="ทุกประเภทงาน" />
          <Select label={FIELD_LABEL.model} value={filters.model ?? ""} onChange={(v) => onFilter("model", v)} options={options.model} allLabel="ทุกโมเดล" />
          <Select label={FIELD_LABEL.source} value={filters.source ?? ""} onChange={(v) => onFilter("source", v)} options={options.source} allLabel="ทุกโปรเจกต์/ลูกค้า" />
          <Select label={FIELD_LABEL.user} value={filters.user ?? ""} onChange={(v) => onFilter("user", v)} options={options.user} allLabel="ทุกคน" />
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500">{FIELD_LABEL.status}</span>
            <select value={filters.status ?? ""} onChange={(e) => onFilter("status", e.target.value)} className="field-input !py-1.5 text-xs">
              <option value="">ทั้งหมด</option>
              <option value="ok">สำเร็จ</option>
              <option value="failed">ล้มเหลว</option>
            </select>
          </label>
        </div>

        {hasActiveAiCostFilters(filters) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Filter size={12} className="text-gray-400" aria-hidden />
            {activeKeys.map((k) => (
              <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-mist px-2.5 py-1 text-xs text-brand-navy">
                <span className="text-gray-500">{FIELD_LABEL[k]}:</span>
                <span className="max-w-[180px] truncate font-medium" title={filterValueLabel(k, filters, options)}>{filterValueLabel(k, filters, options)}</span>
                <button type="button" aria-label={`เอา ${FIELD_LABEL[k]} ออก`} onClick={() => onFilter(k, "")} className="rounded-full p-0.5 hover:bg-white/60">
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            <button type="button" onClick={onClear} className="text-xs font-semibold text-brand-blue hover:underline">ล้างตัวกรอง</button>
          </div>
        )}
      </div>

      <p className="px-1 text-sm text-gray-600">
        <span className="font-semibold text-brand-navy">กำลังดู:</span> {describeView(range, filters, options)}
      </p>
    </div>
  );
}
