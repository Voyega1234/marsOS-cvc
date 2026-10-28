"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, RefreshCw, Eye, CheckCircle2, Send, XCircle, Search, Filter, X } from "lucide-react";
import {
  OVERVIEW_SOURCES,
  OVERVIEW_STATUSES,
  type ArticleSource,
  type OverviewArticle,
  type OverviewClient,
  type OverviewStatus,
} from "@/lib/article-overview";

// ป้ายสถานะ/แหล่งที่มาของบทความ — ใช้ร่วมกันที่ บทความทั้งหมด / Content Calendar / Review Queue

/** true หลัง mount — ใช้กับค่าที่ขึ้นกับเวลาเครื่องผู้ใช้ (server render เป็น UTC) กัน hydration ไม่ตรง */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export const STATUS_CONFIG: Record<OverviewStatus, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  pending:  { label: "รอเขียน",        color: "bg-gray-100 text-gray-500",       dot: "bg-gray-400",    icon: <Clock size={10} /> },
  writing:  { label: "กำลังเขียน",     color: "bg-blue-100 text-brand-blue",     dot: "bg-blue-500",    icon: <RefreshCw size={10} className="animate-spin" /> },
  review:   { label: "รอตรวจ",         color: "bg-amber-100 text-amber-700",     dot: "bg-amber-500",   icon: <Eye size={10} /> },
  done:     { label: "เขียนแล้ว",      color: "bg-purple-100 text-purple-700",   dot: "bg-purple-500",  icon: <CheckCircle2 size={10} /> },
  approved: { label: "Approved",       color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", icon: <CheckCircle2 size={10} /> },
  pushed:   { label: "Pushed",         color: "bg-teal-100 text-teal-700",       dot: "bg-teal-500",    icon: <Send size={10} /> },
  failed:   { label: "Push ไม่สำเร็จ", color: "bg-rose-100 text-rose-700",       dot: "bg-rose-500",    icon: <XCircle size={10} /> },
};

export const SOURCE_CONFIG: Record<ArticleSource, { label: string; color: string }> = {
  "seo-sme": { label: "SEO SME", color: "bg-indigo-100 text-indigo-700" },
  "upload-article": { label: "Upload Article", color: "bg-orange-100 text-orange-700" },
  "pbn": { label: "PBN Backlinks", color: "bg-pink-100 text-pink-700" },
};

export function SourceBadge({ source }: { source: ArticleSource }) {
  const s = SOURCE_CONFIG[source] ?? SOURCE_CONFIG["seo-sme"];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap ${s.color}`}>
      {s.label}
    </span>
  );
}

export function StatusChip({ status }: { status: OverviewStatus }) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

export interface OverviewFilter {
  source: "" | ArticleSource;
  status: "" | OverviewStatus;
  /** clientId — '' = ทุก client */
  client: string;
  search: string;
}

export const EMPTY_OVERVIEW_FILTER: OverviewFilter = { source: "", status: "", client: "", search: "" };

/** ตรงกับ filter ไหม — skip = ไม่เช็คช่องนั้น (ใช้นับจำนวนบนปุ่มของช่องนั้นเอง) */
export function matchOverviewFilter(a: OverviewArticle, f: OverviewFilter, skip?: keyof OverviewFilter): boolean {
  if (skip !== "source" && f.source && a.source !== f.source) return false;
  if (skip !== "status" && f.status && a.status !== f.status) return false;
  if (skip !== "client" && f.client && a.clientId !== f.client) return false;
  if (skip !== "search" && f.search) {
    const q = f.search.toLowerCase();
    if (!a.title.toLowerCase().includes(q) && !a.keyword.toLowerCase().includes(q) && !a.clientName.toLowerCase().includes(q)) return false;
  }
  return true;
}

function countBy<K extends string>(items: OverviewArticle[], key: (a: OverviewArticle) => K): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of items) {
    const k = key(a);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * แถบ filter ด้านบน: แหล่งที่มา / สถานะ / client / ค้นหา
 * ตัวเลขบนปุ่มของแต่ละแถว = จำนวนที่ตรงกับ filter ช่องอื่น ๆ ที่เลือกอยู่
 */
export function OverviewFilterBar({
  articles,
  clients,
  filter,
  onChange,
  statuses = OVERVIEW_STATUSES,
  resultCount,
}: {
  articles: OverviewArticle[];
  clients: OverviewClient[];
  filter: OverviewFilter;
  onChange: (next: OverviewFilter) => void;
  /** สถานะที่แสดงเป็นปุ่ม (ค่าเริ่มต้น = ทุกสถานะ) */
  statuses?: OverviewStatus[];
  /** จำนวนรายการหลัง filter — แสดงท้ายแถว */
  resultCount?: number;
}) {
  const sourceCounts = useMemo(() => countBy(articles.filter(a => matchOverviewFilter(a, filter, "source")), a => a.source), [articles, filter]);
  const statusCounts = useMemo(() => countBy(articles.filter(a => matchOverviewFilter(a, filter, "status")), a => a.status), [articles, filter]);
  const sourceTotal = Object.values(sourceCounts).reduce((s, n) => s + n, 0);
  const statusTotal = Object.values(statusCounts).reduce((s, n) => s + n, 0);

  // client เฉพาะแหล่งที่เลือก, จัดกลุ่มตามแหล่ง (ชื่อซ้ำกันข้ามระบบได้)
  const clientGroups = OVERVIEW_SOURCES
    .filter(s => !filter.source || s === filter.source)
    .map(s => ({ source: s, items: clients.filter(c => c.source === s) }))
    .filter(g => g.items.length > 0);

  const setSource = (s: "" | ArticleSource) => {
    const keepClient = !s || clients.some(c => c.id === filter.client && c.source === s);
    onChange({ ...filter, source: s, client: keepClient ? filter.client : "" });
  };
  const active = !!(filter.source || filter.status || filter.client || filter.search);

  const chip = (selected: boolean, base: string, accent: string) =>
    `inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
      selected ? `${accent} text-white` : `${base} border-transparent hover:border-gray-200`
    }`;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2" data-testid="overview-source-filter">
        <button type="button" onClick={() => setSource("")} className={chip(!filter.source, "bg-gray-100 text-gray-600", "bg-brand-navy border-brand-navy")}>
          ทุกระบบ <span className="opacity-60 ml-0.5">{sourceTotal}</span>
        </button>
        {OVERVIEW_SOURCES.map(s => (
          <button
            key={s}
            type="button"
            data-source={s}
            onClick={() => setSource(filter.source === s ? "" : s)}
            className={chip(filter.source === s, SOURCE_CONFIG[s].color, "bg-brand-navy border-brand-navy")}
          >
            {SOURCE_CONFIG[s].label}
            <span className="opacity-60 ml-0.5">{sourceCounts[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" data-testid="overview-status-filter">
        <button type="button" onClick={() => onChange({ ...filter, status: "" })} className={chip(!filter.status, "bg-gray-100 text-gray-600", "bg-brand-blue border-brand-blue")}>
          ทุกสถานะ <span className="opacity-60 ml-0.5">{statusTotal}</span>
        </button>
        {statuses.map(s => {
          const n = statusCounts[s] || 0;
          // ซ่อนสถานะที่ไม่มีบทความเลย เว้นแต่กำลังเลือกอยู่
          if (n === 0 && filter.status !== s) return null;
          return (
            <button
              key={s}
              type="button"
              data-status={s}
              onClick={() => onChange({ ...filter, status: filter.status === s ? "" : s })}
              className={chip(filter.status === s, STATUS_CONFIG[s].color, "bg-brand-blue border-brand-blue")}
            >
              {STATUS_CONFIG[s].icon}{STATUS_CONFIG[s].label}
              <span className="opacity-60 ml-0.5">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={filter.search}
            onChange={e => onChange({ ...filter, search: e.target.value })}
            placeholder="ค้นหา keyword / title / client..."
            className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 w-56 max-w-full"
          />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Filter size={12} className="text-gray-400 shrink-0" />
          <select
            data-testid="overview-client-filter"
            value={filter.client}
            onChange={e => onChange({ ...filter, client: e.target.value })}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white max-w-[260px]"
          >
            <option value="">ทุก Client ({clientGroups.reduce((s, g) => s + g.items.length, 0)})</option>
            {clientGroups.map(g => (
              <optgroup key={g.source} label={SOURCE_CONFIG[g.source].label}>
                {g.items.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_OVERVIEW_FILTER)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
          >
            <X size={12} /> ล้าง filter
          </button>
        )}
        {resultCount !== undefined && <span className="text-xs text-gray-400">{resultCount} รายการ</span>}
      </div>
    </div>
  );
}
