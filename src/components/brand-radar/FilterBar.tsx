"use client";

import { RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES, LANGUAGES, PROVIDER_KEYS, type RadarFilters } from "@/lib/brand-radar/types";
import { fmtDate, providerShort } from "./shared";

const fieldCls = "h-9 w-full rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysAgo(days: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(now) };
}

/** Range that starts `months` calendar months before today and ends today, both inclusive. */
function monthsAgo(months: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  const day = from.getDate();
  from.setDate(1);
  from.setMonth(from.getMonth() - months);
  from.setDate(Math.min(day, new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate()));
  from.setDate(from.getDate() + 1);
  return { from: ymd(from), to: ymd(now) };
}

/** The page's starting range (see defaultFilters) */
const DEFAULT_DAYS = 90;

/**
 * Report filters. The page keeps one slim line (the range in use, the filters that are on, refresh);
 * every control lives in a panel that drops down from the "ตัวกรอง" button on the right.
 */
export default function FilterBar({ filters, onChange, onRefresh }: {
  filters: RadarFilters;
  onChange: (patch: Partial<RadarFilters>) => void;
  onRefresh: () => void;
}) {
  const ranges = [
    { label: "วันนี้", range: daysAgo(1) },
    { label: "7 วัน", range: daysAgo(7) },
    { label: "14 วัน", range: daysAgo(14) },
    { label: "30 วัน", range: daysAgo(30) },
    { label: "1 เดือน", range: monthsAgo(1) },
    { label: "90 วัน", range: daysAgo(90) },
    { label: "3 เดือน", range: monthsAgo(3) },
    { label: "180 วัน", range: daysAgo(180) },
  ];
  const isOn = (r: { from: string; to: string }) => r.from === filters.from && r.to === filters.to;
  const activeRange = ranges.find((r) => isOn(r.range));
  const dates = filters.from && filters.to
    ? filters.from === filters.to
      ? fmtDate(`${filters.from}T00:00:00`)
      : `${fmtDate(`${filters.from}T00:00:00`)} – ${fmtDate(`${filters.to}T00:00:00`)}`
    : "ทุกช่วงเวลา";

  const country = filters.country === "all" ? null : COUNTRIES.find((c) => c.code === filters.country)?.label ?? filters.country;
  const language = filters.language === "all" ? null : LANGUAGES.find((l) => l.code === filters.language)?.label ?? filters.language;
  const provider = filters.provider === "all" ? null : providerShort(filters.provider);
  const chips: Array<{ key: string; text: string; clear: Partial<RadarFilters> }> = [];
  if (country) chips.push({ key: "country", text: country, clear: { country: "all" } });
  if (language) chips.push({ key: "language", text: language, clear: { language: "all" } });
  if (provider) chips.push({ key: "provider", text: provider, clear: { provider: "all" } });

  const defaultRange = daysAgo(DEFAULT_DAYS);
  const changed = chips.length + (isOn(defaultRange) ? 0 : 1);
  const reset = () => onChange({ ...defaultRange, country: "all", language: "all", provider: "all" });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <p className="min-w-0 flex-1 text-xs text-gray-500">
        ช่วงข้อมูล{" "}
        <span className="font-medium text-brand-navy">{activeRange ? activeRange.label : dates}</span>
        {activeRange ? <span className="hidden sm:inline"> ({dates})</span> : null}
      </p>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-brand-mist px-2.5 py-1 text-xs text-brand-navy">
          {c.text}
          <button type="button" aria-label={`เอาตัวกรอง ${c.text} ออก`} onClick={() => onChange(c.clear)}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-h-[36px]">
            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> ตัวกรอง
            {changed > 0 ? (
              <span className="ml-1.5 rounded-full bg-brand-blue px-1.5 py-px text-[10px] font-medium text-white">{changed}</span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(21rem,calc(100vw-1.5rem))] space-y-4 overflow-y-auto rounded-2xl p-4 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-brand-navy">ตัวกรองรายงาน</span>
            <button
              type="button"
              onClick={reset}
              disabled={changed === 0}
              className="text-xs text-brand-blue underline-offset-2 hover:underline disabled:text-gray-400 disabled:no-underline"
            >
              ล้างตัวกรอง
            </button>
          </div>

          <div>
            <span className={labelCls}>ช่วงวันที่</span>
            <div role="group" aria-label="ช่วงวันที่ที่ตั้งไว้" className="grid grid-cols-4 gap-1.5">
              {ranges.map((r) => {
                const on = isOn(r.range);
                return (
                  <button
                    key={r.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(r.range)}
                    className={`h-9 min-h-[36px] rounded-xl border px-1 text-xs font-medium ${on ? "border-brand-blue bg-brand-mist text-brand-blue" : "border-input bg-white/90 text-gray-600 hover:bg-white"}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>ตั้งแต่</span>
                <input type="date" className={fieldCls} value={filters.from} max={filters.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>ถึง</span>
                <input type="date" className={fieldCls} value={filters.to} min={filters.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
              </label>
            </div>
          </div>

          <label className="block">
            <span className={labelCls}>ประเทศ</span>
            <select className={fieldCls} value={filters.country} onChange={(e) => onChange({ country: e.target.value })}>
              <option value="all">All countries</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={labelCls}>ภาษา</span>
            <select className={fieldCls} value={filters.language} onChange={(e) => onChange({ language: e.target.value })}>
              <option value="all">All languages</option>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={labelCls}>AI platform</span>
            <select className={fieldCls} value={filters.provider} onChange={(e) => onChange({ provider: e.target.value as RadarFilters["provider"] })}>
              <option value="all">All platforms</option>
              {PROVIDER_KEYS.map((k) => <option key={k} value={k}>{providerShort(k)}</option>)}
            </select>
          </label>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="min-h-[36px]">
        <RefreshCw className="mr-1.5 h-4 w-4" /> รีเฟรช
      </Button>
    </div>
  );
}
