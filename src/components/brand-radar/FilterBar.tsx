"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ds";
import { COUNTRIES, LANGUAGES, PROVIDER_KEYS, type RadarFilters } from "@/lib/brand-radar/types";
import { providerShort } from "./shared";

const fieldCls =
  "h-9 rounded-xl border border-input bg-white/90 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

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

export default function FilterBar({ filters, onChange, onRefresh }: {
  filters: RadarFilters;
  onChange: (patch: Partial<RadarFilters>) => void;
  onRefresh: () => void;
}) {
  const quick = [30, 90, 180];
  const active = quick.find((d) => {
    const r = daysAgo(d);
    return r.from === filters.from && r.to === filters.to;
  });

  return (
    <Panel className="mb-4" bodyClassName="!p-3 md:!p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          ตั้งแต่
          <input type="date" className={fieldCls} value={filters.from} max={filters.to || undefined}
            onChange={(e) => onChange({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          ถึง
          <input type="date" className={fieldCls} value={filters.to} min={filters.from || undefined}
            onChange={(e) => onChange({ to: e.target.value })} />
        </label>
        <div className="flex items-center gap-1.5">
          {quick.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={active === d}
              onClick={() => onChange(daysAgo(d))}
              className={`h-9 rounded-xl border px-3 text-xs font-medium ${active === d ? "border-brand-blue bg-brand-mist text-brand-blue" : "border-input bg-white/90 text-gray-600 hover:bg-white"}`}
            >
              {d} วัน
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          ประเทศ
          <select className={fieldCls} value={filters.country} onChange={(e) => onChange({ country: e.target.value })}>
            <option value="all">All countries</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          ภาษา
          <select className={fieldCls} value={filters.language} onChange={(e) => onChange({ language: e.target.value })}>
            <option value="all">All languages</option>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          AI platform
          <select className={fieldCls} value={filters.provider}
            onChange={(e) => onChange({ provider: e.target.value as RadarFilters["provider"] })}>
            <option value="all">All platforms</option>
            {PROVIDER_KEYS.map((k) => <option key={k} value={k}>{providerShort(k)}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="ml-auto">
          <RefreshCw className="mr-1.5 h-4 w-4" /> รีเฟรช
        </Button>
      </div>
    </Panel>
  );
}
