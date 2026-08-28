"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus,
  Globe, Zap, BarChart3, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink,
  FileBarChart2, Lightbulb, Search, ArrowUp, ArrowDown, Star, Target,
  Download, FileText, FileSpreadsheet, Users, MousePointerClick, Activity, MapPin,
} from "lucide-react";
import { SEOPerformanceReport } from "@/components/report/SEOPerformanceReport";
import type { GSCData, GA4Data, PSIData, GscAiData, SEOInsight, GscInsightItem } from "@/lib/report/seo-insights";
import {
  deriveGSCInsights, deriveGA4Insights, deriveConversionInsights,
  derivePSIInsights, deriveConnectedInsights, deriveAIInsights,
} from "@/lib/report/seo-insights";

interface Project {
  id: string;
  name: string;
  website: string;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, delta, format = "number", inverse = false }:
  { label: string; value: number; delta?: number; format?: "number" | "pct" | "money" | "position"; inverse?: boolean }) {
  const fmt = (v: number) => {
    if (format === "pct")      return `${v.toFixed(1)}%`;
    if (format === "money")    return `฿${v.toLocaleString()}`;
    if (format === "position") return `#${v.toFixed(1)}`;
    return v.toLocaleString();
  };

  const goodDelta = inverse ? (delta ?? 0) < 0 : (delta ?? 0) > 0;
  const deltaNeutral = (delta ?? 0) === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-brand-navy">{fmt(value)}</p>
      {delta !== undefined && (
        <div className={`flex items-center gap-1 text-xs mt-1 font-medium ${deltaNeutral ? "text-gray-400" : goodDelta ? "text-emerald-600" : "text-red-500"}`}>
          {deltaNeutral ? <Minus size={11} /> : goodDelta ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(delta)}{format === "position" ? "" : "%"} vs ก่อนหน้า
        </div>
      )}
    </div>
  );
}

// ── Score ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const color = score === null ? "text-gray-300"
    : score >= 90 ? "text-emerald-500"
    : score >= 50 ? "text-amber-500"
    : "text-red-500";
  return (
    <div className="text-center">
      <div className={`text-3xl font-black ${color}`}>{score ?? "—"}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true }:
  { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2 font-semibold text-brand-navy text-sm">{icon}{title}</div>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: SEOInsight }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = {
    strength:    { bg: "bg-emerald-50", border: "border-emerald-200", icon: <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />, label: "Strength",    dot: "bg-emerald-500" },
    opportunity: { bg: "bg-blue-50",    border: "border-blue-200",    icon: <Lightbulb    size={13} className="text-brand-blue shrink-0" />,    label: "Opportunity", dot: "bg-blue-500" },
    warning:     { bg: "bg-amber-50",   border: "border-amber-200",   icon: <AlertCircle  size={13} className="text-amber-600 shrink-0" />,   label: "Warning",     dot: "bg-amber-500" },
    risk:        { bg: "bg-red-50",     border: "border-red-200",     icon: <AlertCircle  size={13} className="text-red-600 shrink-0" />,     label: "Risk",        dot: "bg-red-500" },
  }[insight.type];
  return (
    <div className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          {cfg.icon}
          <div className="flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mr-1.5 opacity-70">{cfg.label}</span>
            <span className="text-sm font-semibold text-brand-navy">{insight.title}</span>
            <p className="text-xs text-gray-600 mt-1">{insight.finding}</p>
            {expanded && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-gray-700"><b>Business Impact:</b> {insight.impact}</p>
                <p className="text-xs text-gray-700"><b>Recommendation:</b> {insight.recommendation}</p>
              </div>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-700 shrink-0 mt-0.5">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
    </div>
  );
}

// ── Vital badge ────────────────────────────────────────────────────────────────
function VitalBadge({ label, display, value, good, bad }: { label: string; display: string; value: number | null; good: number; bad: number }) {
  const color = value === null ? "bg-gray-100 text-gray-500"
    : value <= good ? "bg-emerald-100 text-emerald-700"
    : value <= bad  ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${color}`}>
      <div className="text-[10px] font-medium opacity-70">{label}</div>
      <div className="text-sm font-bold">{display}</div>
    </div>
  );
}

// ── GSC Insights redesign ─────────────────────────────────────────────────────

interface InsightGroup {
  key: string;
  label: string;
  emoji: string;
  accent: string;       // tailwind text color
  bg: string;           // card background
  border: string;       // card border
  headerBg: string;     // group header bg
  types: GscInsightItem["type"][];
  priority: number;
}

const INSIGHT_GROUPS: InsightGroup[] = [
  {
    key: "alert", label: "ต้องดูก่อน", emoji: "🚨", priority: 0,
    accent: "text-red-700", bg: "bg-red-50", border: "border-red-200", headerBg: "bg-red-50 border-red-200",
    types: ["declining_query", "position_loss"],
  },
  {
    key: "win", label: "กำลัง Rising", emoji: "🚀", priority: 1,
    accent: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", headerBg: "bg-emerald-50 border-emerald-200",
    types: ["rising_query", "position_gain"],
  },
  {
    key: "new", label: "Keyword ใหม่", emoji: "✨", priority: 2,
    accent: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200", headerBg: "bg-purple-50 border-purple-200",
    types: ["new_keyword"],
  },
  {
    key: "opportunity", label: "โอกาสที่รอดัน", emoji: "🎯", priority: 3,
    accent: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200", headerBg: "bg-sky-50 border-sky-200",
    types: ["opportunity", "page_2"],
  },
  {
    key: "ctr", label: "CTR ต่ำ — ปรับ Snippet", emoji: "✏️", priority: 4,
    accent: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", headerBg: "bg-amber-50 border-amber-200",
    types: ["low_ctr"],
  },
];

function deltaTag(val: number, inverse = false) {
  const good = inverse ? val <= 0 : val >= 0;
  const sign  = val > 0 ? "+" : "";
  return (
    <span className={`text-[10px] font-bold ${good ? "text-emerald-600" : "text-red-500"}`}>
      {sign}{val}{inverse ? "" : "%"}
    </span>
  );
}

function GscInsightCard({ item }: { item: GscInsightItem }) {
  const [open, setOpen] = useState(false);
  const label = item.query ?? (item.page ? item.page.replace(/^https?:\/\/[^/]+/, "") : "—");

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Keyword / page */}
        <span className="flex-1 text-xs font-semibold text-gray-800 truncate">{label}</span>

        {/* Always-visible metrics */}
        <div className="flex items-center gap-3 shrink-0 text-[10px]">
          <div className="text-right">
            <p className="text-gray-400 leading-none">Impr.</p>
            <p className="font-bold text-gray-700">{item.currImpressions.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 leading-none">Pos.</p>
            <p className="font-bold text-gray-700">#{item.currPosition}</p>
          </div>
          {item.clicksDelta !== undefined && (
            <div className="text-right w-10">
              <p className="text-gray-400 leading-none">Δ Clicks</p>
              {deltaTag(item.clicksDelta)}
            </div>
          )}
          {item.positionDelta !== undefined && item.clicksDelta === undefined && (
            <div className="text-right w-10">
              <p className="text-gray-400 leading-none">Δ Pos.</p>
              {deltaTag(item.positionDelta, true)}
            </div>
          )}
        </div>

        <ChevronDown size={12} className={`text-gray-300 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2.5 bg-gray-50 space-y-2">
          {/* 4 metric pills */}
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            {[
              { label: "Clicks", val: item.currClicks.toLocaleString(), delta: item.clicksDelta },
              { label: "Impr.", val: item.currImpressions.toLocaleString(), delta: item.impressionsDelta },
              { label: "CTR", val: `${item.currCtr}%`, delta: undefined },
              { label: "Position", val: `#${item.currPosition}`, delta: item.positionDelta, inv: true },
            ].map(m => (
              <div key={m.label} className="bg-white rounded-lg border border-gray-100 px-2 py-1.5 text-center">
                <p className="text-gray-400">{m.label}</p>
                <p className="font-bold text-gray-800 mt-0.5">{m.val}</p>
                {m.delta !== undefined && (
                  <div className="mt-0.5">{deltaTag(m.delta, m.inv)}</div>
                )}
              </div>
            ))}
          </div>
          {/* prev context */}
          {(item.prevPosition || item.prevClicks !== undefined) && (
            <p className="text-[10px] text-gray-400">
              ช่วงก่อน: {item.prevClicks !== undefined && `${item.prevClicks.toLocaleString()} clicks`}
              {item.prevPosition !== undefined && ` · pos #${item.prevPosition}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GscInsightGroupSection({ group, items }: { group: InsightGroup; items: GscInsightItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className={`rounded-2xl border overflow-hidden ${group.border}`}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center justify-between px-4 py-3 ${group.headerBg} border-b ${group.border}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{group.emoji}</span>
          <span className={`text-xs font-bold ${group.accent}`}>{group.label}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${group.bg} ${group.accent}`}>
            {items.length}
          </span>
        </div>
        <ChevronDown size={13} className={`${group.accent} opacity-60 transition-transform ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed && (
        <div className="divide-y divide-gray-100 bg-white">
          {items.map((item, i) => <GscInsightCard key={i} item={item} />)}
        </div>
      )}
    </div>
  );
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function escapeCsv(v: unknown): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(sections: { title: string; headers: string[]; rows: (string | number)[][] }[]): string {
  return sections.map(sec => {
    const lines = [
      `# ${sec.title}`,
      sec.headers.map(escapeCsv).join(","),
      ...sec.rows.map(r => r.map(escapeCsv).join(",")),
      "",
    ];
    return lines.join("\n");
  }).join("\n");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv(
  projectName: string,
  gsc: { queries?: {query:string;clicks:number;impressions:number;ctr:number;position:number}[]; pages?: {page:string;clicks:number;impressions:number;ctr:number;position:number}[] } | null,
  ga4: { channels?: {channel:string;sessions:number;conversions:number;revenue:number}[]; pages?: {path:string;views:number;sessions:number;bounceRate:number;engagementRate:number}[] } | null,
  days: number,
) {
  const sections = [];

  if (gsc?.queries?.length) {
    sections.push({
      title: `GSC Top Queries (${days} วัน)`,
      headers: ["Keyword", "Clicks", "Impressions", "CTR (%)", "Position"],
      rows: gsc.queries.map(q => [q.query, q.clicks, q.impressions, q.ctr, q.position]),
    });
  }

  if (gsc?.pages?.length) {
    sections.push({
      title: `GSC Top Pages (${days} วัน)`,
      headers: ["Page", "Clicks", "Impressions", "CTR (%)", "Position"],
      rows: gsc.pages.map(p => [p.page, p.clicks, p.impressions, p.ctr, p.position]),
    });
  }

  if (ga4?.channels?.length) {
    sections.push({
      title: `GA4 Traffic Channels (${days} วัน)`,
      headers: ["Channel", "Sessions", "Conversions", "Revenue (฿)"],
      rows: ga4.channels.map(c => [c.channel, c.sessions, c.conversions, c.revenue]),
    });
  }

  if (ga4?.pages?.length) {
    sections.push({
      title: `GA4 Top Pages (${days} วัน)`,
      headers: ["Page", "Views", "Sessions", "Bounce Rate (%)", "Engagement Rate (%)"],
      rows: ga4.pages.map(p => [p.path, p.views, p.sessions, p.bounceRate, p.engagementRate]),
    });
  }

  if (sections.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(buildCsv(sections), `report-${projectName}-${date}.csv`, "text/csv;charset=utf-8;");
}

function exportHtml(
  projectName: string,
  website: string,
  gsc: { overview?: Record<string,number>; queries?: {query:string;clicks:number;impressions:number;ctr:number;position:number}[]; pages?: {page:string;clicks:number;impressions:number;ctr:number;position:number}[] } | null,
  ga4: { overview?: Record<string,number>; channels?: {channel:string;sessions:number;conversions:number;revenue:number}[]; pages?: {path:string;views:number;sessions:number;bounceRate:number;engagementRate:number}[] } | null,
  psi: { mobile?: { scores: {performance:number|null;accessibility:number|null;seo:number|null}; vitals: Record<string,{display:string;value:number|null}> }; desktop?: { scores: {performance:number|null;accessibility:number|null;seo:number|null}; vitals: Record<string,{display:string;value:number|null}> } } | null,
  days: number,
  insights: { gsc: { title:string;type:string;finding:string;impact:string;recommendation:string }[]; ga4: { title:string;type:string;finding:string;impact:string;recommendation:string }[]; psi: { title:string;type:string;finding:string;impact:string;recommendation:string }[]; conn: { title:string;type:string;finding:string;impact:string;recommendation:string }[] },
) {
  const date = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const typeColor: Record<string,string> = {
    strength: "#059669", opportunity: "#2563eb", warning: "#d97706", risk: "#dc2626",
  };
  const typeLabel: Record<string,string> = {
    strength: "Strength", opportunity: "Opportunity", warning: "Warning", risk: "Risk",
  };

  function insightHtml(ins: {title:string;type:string;finding:string;impact:string;recommendation:string}[]) {
    if (!ins.length) return "";
    return ins.map(i => `
      <div style="border:1px solid #e5e7eb;border-left:4px solid ${typeColor[i.type]??'#6b7280'};border-radius:8px;padding:12px 16px;margin-bottom:8px;background:#f9fafb">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:10px;font-weight:700;color:${typeColor[i.type]??'#6b7280'};text-transform:uppercase">${typeLabel[i.type]??i.type}</span>
          <span style="font-size:13px;font-weight:600;color:#111827">${i.title}</span>
        </div>
        <p style="font-size:12px;color:#374151;margin:4px 0">${i.finding}</p>
        <p style="font-size:11px;color:#6b7280;margin:2px 0"><b>Impact:</b> ${i.impact}</p>
        <p style="font-size:11px;color:#6b7280;margin:2px 0"><b>Rec:</b> ${i.recommendation}</p>
      </div>`).join("");
  }

  function tableHtml(headers: string[], rows: (string|number)[][]) {
    return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
      <thead><tr>${headers.map(h => `<th style="text-align:left;padding:6px 10px;background:#f3f4f6;border-bottom:2px solid #e5e7eb;font-size:10px;text-transform:uppercase;color:#6b7280">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r,ri) => `<tr style="background:${ri%2===0?'#fff':'#f9fafb'}">${r.map(c => `<td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:#111827">${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }

  function statCard(label: string, value: string | number, delta?: number) {
    const good = (delta??0) >= 0;
    const deltaHtml = delta !== undefined
      ? `<div style="font-size:11px;color:${good?'#059669':'#dc2626'};margin-top:2px">${good?'▲':'▼'} ${Math.abs(delta)}%</div>` : "";
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;flex:1;min-width:130px">
      <div style="font-size:10px;color:#9ca3af;margin-bottom:4px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:#111827">${typeof value==="number"?value.toLocaleString():value}</div>
      ${deltaHtml}
    </div>`;
  }

  const scoreColor = (s: number|null) => s===null?"#9ca3af":s>=90?"#059669":s>=50?"#d97706":"#dc2626";

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO Report — ${projectName}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#111827;margin:0;padding:0}
  .page{max-width:900px;margin:0 auto;padding:32px 24px}
  h2{font-size:14px;font-weight:700;color:#374151;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
  .section{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;margin-bottom:20px}
  .stats-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  @media print{body{background:#fff}.page{padding:16px}}
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #111827">
    <div>
      <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">SEO Performance Report</div>
      <h1 style="font-size:26px;font-weight:900;color:#111827;margin:0">${projectName}</h1>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">${website}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#9ca3af">สร้างเมื่อ</div>
      <div style="font-size:13px;font-weight:600;color:#374151">${date}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">ช่วง ${days} วันที่ผ่านมา</div>
    </div>
  </div>

  ${gsc?.overview ? `
  <!-- GSC -->
  <div class="section">
    <h2>Google Search Console</h2>
    <div class="stats-row">
      ${statCard("Clicks", gsc.overview.clicks, gsc.overview.clicksDelta)}
      ${statCard("Impressions", gsc.overview.impressions, gsc.overview.impressionsDelta)}
      ${statCard("CTR", `${gsc.overview.ctr?.toFixed(1)}%`, gsc.overview.ctrDelta)}
      ${statCard("Avg Position", `#${gsc.overview.position?.toFixed(1)}`, gsc.overview.positionDelta)}
    </div>
    ${insights.gsc.length ? `<div style="margin-bottom:16px">${insightHtml(insights.gsc)}</div>` : ""}
    ${gsc.queries?.length ? `<div><b style="font-size:12px;color:#374151">Top Keywords</b>${tableHtml(["Keyword","Clicks","Impressions","CTR","Position"], gsc.queries.slice(0,20).map(q=>[q.query,q.clicks.toLocaleString(),q.impressions.toLocaleString(),`${q.ctr}%`,`#${q.position}`]))}</div>` : ""}
    ${gsc.pages?.length ? `<div style="margin-top:16px"><b style="font-size:12px;color:#374151">Top Pages</b>${tableHtml(["Page","Clicks","Impressions","CTR","Position"], gsc.pages.slice(0,20).map(p=>[p.page,p.clicks.toLocaleString(),p.impressions.toLocaleString(),`${p.ctr}%`,`#${p.position}`]))}</div>` : ""}
  </div>` : ""}

  ${ga4?.overview ? `
  <!-- GA4 -->
  <div class="section">
    <h2>GA4 Analytics</h2>
    <div class="stats-row">
      ${statCard("Sessions", ga4.overview.sessions, ga4.overview.sessionsDelta)}
      ${statCard("Users", ga4.overview.users, ga4.overview.usersDelta)}
      ${statCard("Conversions", ga4.overview.conversions, ga4.overview.conversionsDelta)}
      ${statCard("Revenue", `฿${(ga4.overview.revenue??0).toLocaleString()}`, ga4.overview.revenueDelta)}
    </div>
    ${insights.ga4.length ? `<div style="margin-bottom:16px">${insightHtml(insights.ga4)}</div>` : ""}
    ${ga4.channels?.length ? `<div><b style="font-size:12px;color:#374151">Traffic Channels</b>${tableHtml(["Channel","Sessions","Conversions","Revenue"],ga4.channels.map(c=>[c.channel,c.sessions.toLocaleString(),c.conversions,`฿${c.revenue.toLocaleString()}`]))}</div>` : ""}
    ${ga4.pages?.length ? `<div style="margin-top:16px"><b style="font-size:12px;color:#374151">Top Pages</b>${tableHtml(["Page","Views","Sessions","Eng Rate"],ga4.pages.slice(0,20).map(p=>[p.path,p.views.toLocaleString(),p.sessions.toLocaleString(),`${p.engagementRate}%`]))}</div>` : ""}
  </div>` : ""}

  ${psi ? `
  <!-- PageSpeed -->
  <div class="section">
    <h2>PageSpeed / Core Web Vitals</h2>
    ${insights.psi.length ? `<div style="margin-bottom:16px">${insightHtml(insights.psi)}</div>` : ""}
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      ${(["mobile","desktop"] as const).filter(s=>psi[s]?.scores && psi[s]?.vitals).map(s => {
        const sc = psi[s]!.scores;
        const vi = (psi[s]!.vitals ?? {}) as Record<string,{display:string;value:number|null}>;
        return `<div style="flex:1;min-width:200px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:10px">${s}</div>
          <div style="display:flex;gap:16px;margin-bottom:12px">
            ${[["Performance",sc.performance],["Accessibility",sc.accessibility],["SEO",sc.seo]].map(([l,v])=>`
              <div style="text-align:center">
                <div style="font-size:26px;font-weight:900;color:${scoreColor(v as number|null)}">${v??'—'}</div>
                <div style="font-size:10px;color:#6b7280">${l}</div>
              </div>`).join("")}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${["lcp","cls","fcp","ttfb"].filter(k=>vi[k]).map(k=>`
              <div style="background:#f3f4f6;border-radius:8px;padding:6px 10px;text-align:center;min-width:50px">
                <div style="font-size:9px;color:#9ca3af;text-transform:uppercase">${k.toUpperCase()}</div>
                <div style="font-size:12px;font-weight:700;color:#111827">${vi[k].display}</div>
              </div>`).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>` : ""}

  ${insights.conn.length ? `
  <!-- Cross-channel -->
  <div class="section">
    <h2>Cross-Channel Insights</h2>
    ${insightHtml(insights.conn)}
  </div>` : ""}

  <!-- Footer -->
  <div style="text-align:center;padding:20px 0;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;margin-top:24px">
    Generated by Mars OS · ${date}
  </div>
</div>
</body>
</html>`;

  downloadFile(html, `report-${projectName}-${new Date().toISOString().slice(0,10)}.html`, "text/html;charset=utf-8;");
}

// ── Main ───────────────────────────────────────────────────────────────────────
// ── Simple Report ─────────────────────────────────────────────────────────────

type GscType = { overview?: Record<string, number>; pages?: {page:string;clicks:number;impressions:number;ctr:number;position:number}[]; queries?: {query:string;clicks:number;impressions:number;ctr:number;position:number}[]; queryPages?: {query:string;page:string;clicks:number;impressions:number}[] } | null;
type Ga4Type = { overview?: Record<string, number>; channels?: {channel:string;sessions:number;conversions:number;revenue:number}[]; pages?: {path:string;title?:string;views:number;sessions:number;bounceRate:number;engagementRate:number;sessionDuration?:number;avgDuration?:number;conversions?:number;events?:number}[]; devices?: {device:string;sessions:number;conversions:number}[]; events?: {event:string;isConversion:boolean;count:number;conversions:number}[]; countries?: {country:string;sessions:number}[]; landingConversions?: {path:string;sessions:number;conversions:number;revenue:number;events?:number}[]; landingEvents?: {path:string;event:string;count:number}[]; pageEvents?: {path:string;event:string;count:number}[] } | null;
type PsiType = { mobile?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]}; desktop?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]} } | null;

function SimpleMetricCard({ label, value, subLabel, delta, deltaLabel, color = "text-brand-navy" }: {
  label: string; value: string | number; subLabel?: string; delta?: number; deltaLabel?: string; color?: string
}) {
  const up = (delta ?? 0) > 0;
  const neutral = (delta ?? 0) === 0;
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
      <p className={`text-3xl font-black ${color}`}>{value}</p>
      {subLabel && <p className="text-xs text-gray-400 mt-0.5">{subLabel}</p>}
      {delta !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-semibold ${neutral ? "text-gray-400" : up ? "text-emerald-600" : "text-red-500"}`}>
          {neutral ? <Minus size={11}/> : up ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
          {up ? "+" : ""}{delta.toFixed(1)}% {deltaLabel ?? "vs ช่วงก่อน"}
        </div>
      )}
    </div>
  );
}

function SimpleDonut({ data, colors }: { data: {label:string;value:number;color:string}[]; colors?: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="text-xs text-gray-400 py-4 text-center">ไม่มีข้อมูล</div>;
  let offset = 0;
  const R = 60; const r = 38; const cx = 70; const cy = 70;
  const circumference = 2 * Math.PI * R;
  const segments = data.map(d => {
    const pct = d.value / total;
    const dash = pct * circumference;
    const seg = { ...d, pct, dash, offset };
    offset += dash;
    return seg;
  });
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="white"/>
        {segments.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={s.color}
            strokeWidth="22" strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={circumference / 4 - s.offset} />
        ))}
      </svg>
      <div className="space-y-1.5 flex-1 min-w-0">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor: s.color}}/>
            <span className="text-gray-600 flex-1 truncate">{s.label}</span>
            <span className="font-bold text-brand-navy">{Math.round(s.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleBarChart({ data, maxVal }: { data: {label:string;value:number;prev?:number}[]; maxVal?: number }) {
  const max = maxVal ?? Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="space-y-0.5">
          <div className="flex justify-between text-xs text-gray-500">
            <span className="truncate">{d.label}</span>
            <span className="font-semibold text-brand-navy ml-2 shrink-0">{d.value.toLocaleString()}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SimplePsiScore({ score, label }: { score: number | null; label: string }) {
  const color = score === null ? "text-gray-300" : score >= 90 ? "text-emerald-600" : score >= 50 ? "text-amber-500" : "text-red-500";
  const ring  = score === null ? "bg-gray-100" : score >= 90 ? "bg-emerald-50 border border-emerald-200" : score >= 50 ? "bg-amber-50 border border-amber-200" : "bg-red-50 border border-red-200";
  return (
    <div className={`rounded-2xl p-4 text-center ${ring}`}>
      <div className={`text-4xl font-black ${color}`}>{score ?? "—"}</div>
      <div className="text-xs text-gray-500 mt-1 font-medium">{label}</div>
      <div className={`text-[10px] mt-1 font-semibold ${color}`}>{score === null ? "" : score >= 90 ? "Good" : score >= 50 ? "Needs Improvement" : "Poor"}</div>
    </div>
  );
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}นาที ${s}วิ` : `${s}วิ`;
}

type GscDailyRow = { date: string; clicks: number; impressions: number; ctr?: number; position?: number };
type Ga4DailyRow = { date: string; sessions: number; users: number };

function RealSparkline({ data, field, color = "#1a73e8" }: {
  data: GscDailyRow[] | Ga4DailyRow[];
  field: string;
  color?: string;
}) {
  if (!data || data.length < 2) {
    // placeholder flat line
    return (
      <svg viewBox="0 0 300 60" className="w-full h-14" preserveAspectRatio="none">
        <line x1="0" y1="30" x2="300" y2="30" stroke="#e5e7eb" strokeWidth="1.5"/>
      </svg>
    );
  }
  const vals = data.map(d => ((d as unknown) as Record<string,number>)[field] ?? 0);
  const max = Math.max(...vals, 1);
  const W = 300; const H = 60;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - (v / max) * (H - 4) - 2}`);
  const pathD = pts.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(" ");
  const fillD = `${pathD} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${field}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#sg-${field})`}/>
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Site Kit chart: smooth SVG sparkline with Y-axis grid + date labels ──
function SKLineChart({ data, field, color = "#137333", prevData, prevField }: {
  data: GscDailyRow[] | Ga4DailyRow[];
  field: string;
  color?: string;
  prevData?: GscDailyRow[] | Ga4DailyRow[];
  prevField?: string;
}) {
  // NOTE: the SVG stretches to the container width with preserveAspectRatio="none".
  // Any <text> inside would stretch with it (the "ตัวเลขยืด" bug) — so ALL labels
  // are rendered as HTML overlays outside the SVG, and the SVG holds paths only.
  const W = 560; const H = 200; const PL = 40; const PB = 28; const PT = 10;
  const TH = H + PT + PB;
  const vals = data.map(d => ((d as unknown) as Record<string,number>)[field] ?? 0);
  if (vals.length < 2) return (
    <div className="w-full" style={{ height: TH }}>
      <svg viewBox={`0 0 ${W} ${TH}`} className="w-full h-full" preserveAspectRatio="none">
        <line x1={0} y1={PT + H/2} x2={W} y2={PT + H/2} stroke="#e8eaed" strokeWidth="1"/>
      </svg>
    </div>
  );

  const max = Math.max(...vals, 1);
  const fmtLabel = (v: number) => v >= 1000 ? `${(v/1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(v);
  // Evenly spaced grid lines; labels rounded from the true value at each line
  // (the old nice-rounding produced non-monotonic labels like 0, 60, 100, 200).
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PT + H * (1 - f),
    label: fmtLabel(Math.round(max * f)),
  }));

  const toX = (i: number) => (i / (vals.length - 1)) * W;
  const toY = (v: number) => PT + H * (1 - v / max);
  const mainPath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const fillPath = mainPath + ` L${W},${PT + H} L0,${PT + H} Z`;

  let prevPath = '';
  if (prevData && prevField && prevData.length >= 2) {
    const pv = prevData.map(d => ((d as unknown) as Record<string,number>)[prevField] ?? 0);
    const pm = Math.max(...pv, 1);
    const toYp = (v: number) => PT + H * (1 - v / pm);
    prevPath = pv.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(Math.min(i, vals.length - 1)).toFixed(1)},${toYp(v).toFixed(1)}`).join(' ');
  }

  const dateLabels = [0, Math.floor((vals.length - 1) / 2), vals.length - 1].map(i => {
    const row = data[i] as GscDailyRow;
    const raw = row?.date ?? '';
    if (raw.length === 8) {
      const m = raw.slice(4,6); const d2 = raw.slice(6);
      const months = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      return `${months[parseInt(m)] ?? m} ${parseInt(d2)}`;
    }
    if (raw.includes('-')) { const p = raw.split('-'); return `${p[1]}/${p[2]}`; }
    return raw;
  });

  return (
    <div className="w-full flex" style={{ height: TH }}>
      {/* Y-axis labels — HTML, never stretched */}
      <div className="relative shrink-0" style={{ width: PL - 4 }}>
        {gridLines.map((g, i) => (
          <span key={i} className="absolute right-1.5 text-[10px] leading-none text-[#5f6368] tabular-nums"
            style={{ top: g.y - 5 }}>{g.label}</span>
        ))}
      </div>
      {/* Chart — SVG stretches horizontally but contains no text */}
      <div className="relative flex-1 min-w-0">
        <svg viewBox={`0 0 ${W} ${TH}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`sk-fill-${field}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
              <stop offset="85%" stopColor={color} stopOpacity="0.03"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {gridLines.map((g, i) => (
            <line key={i} x1={0} y1={g.y} x2={W} y2={g.y} stroke="#e8eaed" strokeWidth="0.8"/>
          ))}
          <path d={fillPath} fill={`url(#sk-fill-${field})`}/>
          {prevPath && <path d={prevPath} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.45"/>}
          <path d={mainPath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
          <line x1={0} y1={PT + H} x2={W} y2={PT + H} stroke="#e8eaed" strokeWidth="0.8"/>
        </svg>
        {/* Date labels — HTML, never stretched */}
        <div className="absolute left-0 right-0 flex justify-between text-[10px] text-[#5f6368]" style={{ top: PT + H + 8 }}>
          {dateLabels.map((d, i) => <span key={i}>{d}</span>)}
        </div>
      </div>
    </div>
  );
}

// ── Site Kit donut — large donut center + legend list below (matches Site Kit screenshots) ──
function SKDonut({ data, label }: { data: {label:string;value:number;color:string}[]; label?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <p className="text-xs text-[#5f6368] text-center py-8">ไม่มีข้อมูล</p>;

  const sorted = [...data].sort((a, b) => b.value - a.value);

  // Large donut: R=80, thick=28, viewBox 200x200
  const R = 80; const cx = 100; const cy = 100; const thick = 28;
  const innerR = R - thick;
  let startAngle = -90;
  const segments = sorted.map(d => {
    const pct = d.value / total;
    const angle = pct * 360;
    const a1 = (startAngle * Math.PI) / 180;
    const a2 = ((startAngle + angle) * Math.PI) / 180;
    const x1 = cx + R * Math.cos(a1); const y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2); const y2 = cy + R * Math.sin(a2);
    const large = angle > 180 ? 1 : 0;
    const xi1 = cx + innerR * Math.cos(a1); const yi1 = cy + innerR * Math.sin(a1);
    const xi2 = cx + innerR * Math.cos(a2); const yi2 = cy + innerR * Math.sin(a2);
    const path = `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${xi2.toFixed(2)},${yi2.toFixed(2)} A${innerR},${innerR} 0 ${large} 0 ${xi1.toFixed(2)},${yi1.toFixed(2)} Z`;
    startAngle += angle;
    return { ...d, path, pct };
  });

  return (
    <div>
      {/* Large centered donut */}
      <div className="flex justify-center">
        <svg viewBox="0 0 200 200" className="w-48 h-48">
          {segments.map((s, i) => <path key={i} d={s.path} fill={s.color}/>)}
          <text x={cx} y={cy - 8} textAnchor="middle" fill="#5f6368" fontSize="12" fontFamily="Google Sans,sans-serif">By</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fill="#5f6368" fontSize="12" fontFamily="Google Sans,sans-serif">{label ?? 'Channels'}</text>
        </svg>
      </div>
      {/* Legend: percentage on right, label left — matches Site Kit */}
      <div className="mt-3 space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }}/>
            <span className="text-[12px] text-[#5f6368] truncate flex-1 min-w-0" title={s.label}>
              {s.label.length > 14 ? s.label.slice(0, 13) + '…' : s.label}
            </span>
            <span className="text-[12px] text-[#202124] font-medium shrink-0 tabular-nums">{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Simple Report — Clarity-style dashboard (CVC CI theme)
// ข้อมูลจริง 3 แหล่ง: GSC / GA4 / PageSpeed — ไม่มี mock
// ═══════════════════════════════════════════════════════════════════════════════

// สีกราฟตาม CI: brand เป็นหลัก + addon เฉพาะกราฟ (กติกา CVC guideline)
const CI = {
  blue:   "#1d48f3", // brand.blue — series หลัก
  dark:   "#0107a9", // brand.dark — series รอง
  sky:    "#177cfe",
  soft:   "#6b8cef",
  navy:   "#000E3F",
  mist:   "#eff5f9",
  sage:   "#769a6d", // addon — CTR / good
  salmon: "#e35336", // addon — position / attention
  mustard:"#ffb95c",
};
const DONUT_COLORS = [CI.blue, CI.soft, CI.mustard, CI.sage, CI.salmon, CI.sky, CI.dark, "#DAE1E7"];

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fmtMin(seconds: number) {
  if (!seconds) return "—";
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)} min`;
  return `${Math.round(seconds)} s`;
}

// การ์ดขาวสไตล์ Clarity: หัวการ์ดเล็ก + เนื้อหา
function CCard({ title, right, children, className = "", pad = true }: {
  title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border border-[#e3e9f2] shadow-[0_1px_2px_rgba(0,14,63,0.06)] ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
          <p className="text-[13px] font-semibold text-brand-navy flex items-center gap-1.5">{title}</p>
          {right}
        </div>
      )}
      <div className={pad ? "px-4 pb-4 pt-1" : ""}>{children}</div>
    </div>
  );
}

// KPI แถวบนสุด (Sessions / Pages per session / ...)
function CKpi({ label, value, sub, delta, invert = false }: {
  label: string; value: string; sub?: string; delta?: number; invert?: boolean;
}) {
  const good = delta === undefined ? true : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="bg-white rounded-xl border border-[#e3e9f2] shadow-[0_1px_2px_rgba(0,14,63,0.06)] px-4 py-3.5">
      <p className="text-[12px] font-semibold text-brand-navy mb-1.5">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[1.9rem] leading-none font-bold text-brand-navy tabular-nums">{value}</p>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[12px] font-semibold ${good ? "text-emerald-600" : "text-red-500"}`}>
            {delta > 0 ? "↑" : "↓"}{Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] italic text-gray-400 mt-1.5">{sub}</p>}
    </div>
  );
}

// แถว insight (สไตล์ Rage clicks / Dead clicks ของ Clarity)
function InsightRow({ icon, label, value, sub, valueColor = "#000E3F" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div className="border border-[#eef2f8] rounded-lg px-3 py-2.5">
      <p className="text-[12px] font-medium text-gray-500 mb-1.5">{label}</p>
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: CI.mist, color: CI.blue }}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[1.35rem] leading-none font-bold tabular-nums" style={{ color: valueColor }}>{value}</p>
          {sub && <p className="text-[11px] italic text-gray-400 mt-1">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// รายการแถบแนวนอน (สไตล์ Source / Top pages ของ Clarity)
function HBarList({ items, color = CI.blue, linkPrefix }: {
  items: { label: string; value: number; href?: string }[]; color?: string; linkPrefix?: string;
}) {
  const max = Math.max(...items.map(i => i.value), 1);
  if (!items.length) return <p className="text-[12px] text-gray-400 text-center py-8">ยังไม่มีข้อมูล</p>;
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i}>
          {it.href || linkPrefix ? (
            <a href={it.href ?? `${linkPrefix}${it.label}`} target="_blank" rel="noopener noreferrer"
              className="text-[12px] text-brand-navy hover:text-brand-blue hover:underline block truncate" title={it.label}>{it.label}</a>
          ) : (
            <p className="text-[12px] text-brand-navy truncate" title={it.label}>{it.label}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-3 rounded-sm bg-[#f4f7fb] overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: `${Math.max((it.value / max) * 100, 2)}%`, backgroundColor: color }} />
            </div>
            <span className="text-[12px] text-gray-500 tabular-nums w-12 text-right shrink-0">{fmtNum(it.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// กราฟหลายเส้นสไตล์ GSC — แต่ละ series สเกลตาม max ตัวเอง (เหมือนแกนคู่ของ GSC)
function MLChart({ data, series }: {
  data: Record<string, number | string>[];
  series: { key: string; color: string; invert?: boolean }[];
}) {
  const W = 560, H = 330, PT = 10, PB = 26; const TH = H + PT + PB;
  if (!data || data.length < 2 || !series.length) {
    return <div className="w-full flex items-center justify-center text-[12px] text-gray-400" style={{ height: TH }}>ยังไม่มีข้อมูลกราฟ</div>;
  }
  const toX = (i: number) => (i / (data.length - 1)) * W;
  const paths = series.map(s => {
    const vals = data.map(d => Number(d[s.key] ?? 0));
    const max = Math.max(...vals, 1e-6);
    const toY = (v: number) => s.invert ? PT + H * (v / max) : PT + H * (1 - v / max);
    return { color: s.color, d: vals.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ") };
  });
  const dateLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1].map(i => {
    const raw = String(data[i]?.date ?? "");
    if (raw.length === 8) return `${parseInt(raw.slice(6))}/${parseInt(raw.slice(4, 6))}`;
    if (raw.includes("-")) { const p = raw.split("-"); return `${parseInt(p[2])}/${parseInt(p[1])}`; }
    return raw;
  });
  return (
    <div className="relative w-full" style={{ height: TH }}>
      <svg viewBox={`0 0 ${W} ${TH}`} className="w-full h-full" preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <line key={i} x1={0} y1={PT + H * f} x2={W} y2={PT + H * f} stroke="#e8ecf3" strokeWidth="0.8" />
        ))}
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="absolute left-0 right-0 flex justify-between text-[10px] text-gray-400" style={{ top: PT + H + 6 }}>
        {dateLabels.map((d, i) => <span key={i}>{d}</span>)}
      </div>
    </div>
  );
}

function SimpleReport({ project, gsc, ga4, psi, gscLoading, ga4Loading, psiLoading, gscError, ga4Error, days, periodLabel }: {
  project: { name: string; website: string }
  gsc: GscType; ga4: Ga4Type; psi: PsiType
  gscLoading: boolean; ga4Loading: boolean; psiLoading: boolean
  gscError: string | null; ga4Error: string | null
  days: number
  periodLabel?: string
}) {
  const [donutTab, setDonutTab]   = useState<"devices" | "locations">("devices");
  const [psiMode, setPsiMode]     = useState<"mobile" | "desktop">("mobile");
  const [gscTable, setGscTable]   = useState<"queries" | "pages" | "devices">("queries");
  const [evFilter, setEvFilter]   = useState("");  // "" = รวมทุก event (ใช้เฉพาะโหมด Events)
  const [gscSeries, setGscSeries] = useState<Record<"clicks" | "impressions" | "ctr" | "position", boolean>>({
    clicks: true, impressions: true, ctr: true, position: true,
  });

  const loading = gscLoading || ga4Loading;

  // ── GA4 overview ──
  const sessions     = ga4?.overview?.sessions ?? 0;
  const sessionsD    = ga4?.overview?.sessionsDelta ?? 0;
  const users        = ga4?.overview?.users ?? 0;
  const usersD       = ga4?.overview?.usersDelta ?? 0;
  const newUsers     = (ga4?.overview as Record<string, number> | undefined)?.newUsers ?? 0;
  const pageviews    = (ga4?.overview as Record<string, number> | undefined)?.pageviews ?? 0;
  const avgDur       = (ga4?.overview as Record<string, number> | undefined)?.avgSessionDuration ?? 0;
  const engagement   = ga4?.overview?.engagementRate ?? 0;
  const conversions  = ga4?.overview?.conversions ?? 0;
  const conversionsD = ga4?.overview?.conversionsDelta ?? 0;
  const revenue      = ga4?.overview?.revenue ?? 0;
  const returningUsers = Math.max(users - newUsers, 0);
  const pagesPerSession = sessions ? (pageviews / sessions) : 0;

  // ── GSC overview ──
  const clicks       = gsc?.overview?.clicks ?? 0;
  const clicksD      = gsc?.overview?.clicksDelta ?? 0;
  const impressions  = gsc?.overview?.impressions ?? 0;
  const impressionsD = gsc?.overview?.impressionsDelta ?? 0;
  const ctr          = gsc?.overview?.ctr ?? 0;
  const ctrD         = gsc?.overview?.ctrDelta ?? 0;
  const position     = gsc?.overview?.position ?? 0;
  const positionD    = gsc?.overview?.positionDelta ?? 0;

  const gscDaily = ((gsc as { daily?: GscDailyRow[] })?.daily ?? []) as GscDailyRow[];

  // ── Donut data (CI palette) ──
  const deviceData = (ga4?.devices ?? []).map((d, i) => ({
    label: d.device || "other", value: d.sessions, color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));
  const locationData = (ga4?.countries ?? []).map((c, i) => ({
    label: c.country || "Unknown", value: c.sessions, color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));
  const topCountry = (ga4?.countries ?? [])[0];

  const channelItems = (ga4?.channels ?? []).slice(0, 6).map(c => ({ label: c.channel, value: c.sessions }));
  const topPageItems = (ga4?.pages ?? []).slice(0, 8).map(p => ({
    label: p.path, value: p.views, href: `${project.website}${p.path}`,
  }));
  const events = (ga4?.events ?? []).slice(0, 6);

  // ── Conversion deep-dive: โยง GSC query×page ↔ GA4 conversion ราย landing page ──
  const landingConv = ga4?.landingConversions ?? [];
  const queryPages  = gsc?.queryPages ?? [];
  // normalize path ให้ GA4 (ไม่มี trailing slash) กับ GSC (มี trailing slash + percent-encoded) แมตช์กัน
  const normPath = (raw: string) => {
    let v = raw; try { v = decodeURIComponent(v) } catch {}
    v = v.replace(/\/+$/, "");
    return v === "" ? "/" : v;
  };
  const pathOf = (u: string) => { try { return normPath(new URL(u).pathname) } catch { return normPath(u) } };
  // property ที่ยังไม่ตั้ง conversion/key event ใน GA4 → สลับไปใช้ eventCount แทน (หัวคอลัมน์เปลี่ยนเป็น Events)
  const hasConv = landingConv.some(l => l.conversions > 0);
  // เลือกดูเฉพาะ event เดียว (โหมด Events): รวม count จาก breakdown ราย event ต่อ path
  const landingEvByPath = new Map<string, number>();
  const pageEvByPath = new Map<string, number>();
  if (!hasConv && evFilter) {
    (ga4?.landingEvents ?? []).forEach(r => { if (r.event === evFilter) { const k = normPath(r.path); landingEvByPath.set(k, (landingEvByPath.get(k) ?? 0) + r.count) } });
    (ga4?.pageEvents ?? []).forEach(r => { if (r.event === evFilter) { const k = normPath(r.path); pageEvByPath.set(k, (pageEvByPath.get(k) ?? 0) + r.count) } });
  }
  const landingEvVal = (l: { path: string; events?: number }) => evFilter ? (landingEvByPath.get(normPath(l.path)) ?? 0) : (l.events ?? 0);
  const convByPath = new Map<string, number>();
  landingConv.forEach(l => { const v = hasConv ? l.conversions : landingEvVal(l); if (v > 0) convByPath.set(normPath(l.path), v) });
  const pageClickTotals = new Map<string, number>();
  queryPages.forEach(r => { const pp = pathOf(r.page); pageClickTotals.set(pp, (pageClickTotals.get(pp) ?? 0) + r.clicks) });
  // กระจาย conversion ของแต่ละหน้าให้ keyword ตามสัดส่วน clicks (ประมาณการ — GA4 ไม่บอก keyword ตรง ๆ)
  const kwConvMap = new Map<string, number>();
  queryPages.forEach(r => {
    const pp = pathOf(r.page);
    const conv = convByPath.get(pp);
    const total = pageClickTotals.get(pp) ?? 0;
    if (conv && total > 0 && r.clicks > 0) kwConvMap.set(r.query, (kwConvMap.get(r.query) ?? 0) + conv * (r.clicks / total));
  });
  const topQueryRows = (gsc?.queries ?? []).slice(0, 10).map(q => ({ ...q, estConv: kwConvMap.get(q.query) ?? 0 }));
  const kwConvRows = Array.from(kwConvMap.entries()).map(([query, conv]) => ({ query, conv }))
    .sort((a, b) => b.conv - a.conv).slice(0, 10);
  const pagesHaveConv = (ga4?.pages ?? []).some(pg => (pg.conversions ?? 0) > 0);
  const gaPageRows = (ga4?.pages ?? []).slice(0, 10).map(pg => ({ ...pg, actVal: pagesHaveConv ? (pg.conversions ?? 0) : (!hasConv && evFilter ? (pageEvByPath.get(normPath(pg.path)) ?? 0) : (pg.events ?? 0)) }));
  const convPageRows = landingConv
    .map(l => ({ ...l, actVal: hasConv ? l.conversions : landingEvVal(l) }))
    .filter(l => l.actVal > 0)
    .sort((a, b) => b.actVal - a.actVal)
    .slice(0, 10);
  // รวม event ชื่อเดียวกันเป็นแถวเดียว (GA4 แยกแถวตาม isConversionEvent)
  const allEvents = (() => {
    const m = new Map<string, { event: string; isConversion: boolean; count: number }>();
    (ga4?.events ?? []).forEach(e => {
      const cur = m.get(e.event);
      if (cur) { cur.count += e.count; cur.isConversion = cur.isConversion || e.isConversion; }
      else m.set(e.event, { event: e.event, isConversion: e.isConversion, count: e.count });
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  })();
  // dropdown เลือก event (โผล่เฉพาะโหมด Events) — ตัวเดียวคุมทุกตารางที่โชว์ค่า Events
  const evSelect = !hasConv && allEvents.length > 0 ? (
    <select
      value={evFilter}
      onChange={e => setEvFilter(e.target.value)}
      className="text-[11px] border border-[#e3e9f2] rounded-md px-1.5 py-1 text-gray-600 bg-white max-w-[190px] cursor-pointer focus:outline-none"
      title="เลือก event ที่ใช้คำนวณคอลัมน์ Events"
    >
      <option value="">ทุก event</option>
      {allEvents.map(e => <option key={e.event} value={e.event}>{e.event}</option>)}
    </select>
  ) : null;

  // ── PSI ──
  const curPsi = psiMode === "mobile" ? psi?.mobile : psi?.desktop;
  const perfScore = curPsi?.scores?.performance ?? null;
  const scoreColor = perfScore === null ? "#9ca3af" : perfScore >= 90 ? "#059669" : perfScore >= 50 ? "#d97706" : "#dc2626";
  const vitals = curPsi?.vitals?.lcp && curPsi.vitals.cls && curPsi.vitals.responsiveness ? [
    { label: "LCP", full: "Largest Contentful Paint", display: curPsi.vitals.lcp.display, val: curPsi.vitals.lcp.value, good: 2500, bad: 4000 },
    { label: "INP", full: "Interaction to Next Paint", display: curPsi.vitals.responsiveness.value, val: curPsi.vitals.responsiveness.numericValue, good: 200, bad: 500 },
    { label: "CLS", full: "Cumulative Layout Shift", display: curPsi.vitals.cls.display, val: curPsi.vitals.cls.value, good: 0.1, bad: 0.25 },
  ] : [];

  // ── GSC chart series/tiles ──
  const GSC_METRICS = [
    { key: "clicks" as const,      label: "Total clicks",      color: CI.blue,   value: fmtNum(clicks),      delta: clicksD },
    { key: "impressions" as const, label: "Total impressions", color: CI.dark,   value: fmtNum(impressions), delta: impressionsD },
    { key: "ctr" as const,         label: "Average CTR",       color: CI.sage,   value: `${ctr}%`,           delta: ctrD },
    { key: "position" as const,    label: "Average position",  color: CI.salmon, value: position.toFixed(1), delta: positionD, invert: true },
  ];
  const activeSeries = GSC_METRICS.filter(m => gscSeries[m.key]).map(m => ({ key: m.key, color: m.color, invert: m.key === "position" }));

  const gscRows: { name: string; clicks: number; impressions: number; ctr: number; position: number; href?: string }[] =
    gscTable === "queries"
      ? (gsc?.queries ?? []).slice(0, 10).map(q => ({ name: q.query, ...q, href: `https://www.google.com/search?q=${encodeURIComponent(q.query)}` }))
      : gscTable === "pages"
        ? (gsc?.pages ?? []).slice(0, 10).map(p => ({ name: p.page.replace(project.website, "") || "/", clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position, href: p.page }))
        : ((gsc as { devices?: { device: string; clicks: number; impressions: number }[] })?.devices ?? []).map(d => ({
            name: d.device.toLowerCase(), clicks: d.clicks, impressions: d.impressions,
            ctr: d.impressions ? Number(((d.clicks / d.impressions) * 100).toFixed(1)) : 0, position: 0,
          }));

  const newPct = users ? Math.round((newUsers / users) * 100) : 0;

  return (
    <div className="bg-brand-mist -mx-6 -mt-4 px-4 pt-5 pb-10 min-h-screen space-y-3 w-[calc(100%+3rem)]">
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-lg px-3 py-1.5 w-fit shadow-sm">
          <RefreshCw size={11} className="animate-spin" /> กำลังโหลดข้อมูล...
        </div>
      )}
      {(gscError || ga4Error) && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="shrink-0" />
          <span>{gscError ? `GSC: ${gscError}` : ""}{gscError && ga4Error ? " · " : ""}{ga4Error ? `GA4: ${ga4Error}` : ""}</span>
        </div>
      )}

      {/* ══ ROW 1 — KPI cards (Clarity top strip) — GA4 ══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CKpi label="Sessions" value={fmtNum(sessions)} sub={`${fmtNum(users)} unique users`} delta={sessionsD} />
        <CKpi label="Pages per session" value={pagesPerSession ? pagesPerSession.toFixed(2) : "—"} sub="average" />
        <CKpi label="Engagement rate" value={engagement ? `${engagement}%` : "—"} sub="average" />
        <CKpi label="Active time spent" value={fmtMin(avgDur)} sub="avg per session" />
      </div>

      {/* ══ ROW 2 — Users overview · Insights · Performance overview ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Users overview */}
        <CCard title="Users overview">
          <div className="space-y-2 mt-1">
            <div className="border border-[#eef2f8] rounded-lg px-3 py-2.5 flex items-center gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: CI.mist, color: CI.blue }}>
                <Users size={16} />
              </span>
              <div>
                <p className="text-[1.35rem] leading-none font-bold text-brand-navy tabular-nums">{fmtNum(users)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Unique users</p>
              </div>
              {usersD !== 0 && (
                <span className={`ml-auto text-[12px] font-semibold ${usersD >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {usersD > 0 ? "↑" : "↓"}{Math.abs(usersD)}%
                </span>
              )}
            </div>

            {/* New vs returning bar — ซ่อนตอนยังไม่มีข้อมูล users */}
            {users > 0 && (
            <div className="pt-2">
              <div className="h-3.5 rounded-full overflow-hidden flex bg-[#f4f7fb]">
                <div style={{ width: `${newPct}%`, backgroundColor: CI.blue }} />
                <div style={{ width: `${100 - newPct}%`, backgroundColor: CI.soft }} />
              </div>
              <div className="mt-2.5 space-y-1.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CI.blue }} />
                  <span className="text-gray-500 flex-1">New users</span>
                  <span className="font-semibold text-brand-navy tabular-nums">{newPct}%</span>
                  <span className="text-gray-400 tabular-nums w-14 text-right">{fmtNum(newUsers)}</span>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CI.soft }} />
                  <span className="text-gray-500 flex-1">Returning users</span>
                  <span className="font-semibold text-brand-navy tabular-nums">{100 - newPct}%</span>
                  <span className="text-gray-400 tabular-nums w-14 text-right">{fmtNum(returningUsers)}</span>
                </div>
              </div>
            </div>
            )}

            {/* Top location banner */}
            {topCountry && (
              <div className="rounded-lg px-3 py-2.5 flex items-center gap-2.5 mt-2" style={{ backgroundColor: CI.mist }}>
                <MapPin size={14} style={{ color: CI.blue }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-500">Top location</p>
                  <p className="text-[13px] font-semibold text-brand-navy truncate">{topCountry.country || "Unknown"}</p>
                </div>
                <span className="text-[12px] text-gray-500 tabular-nums shrink-0">{fmtNum(topCountry.sessions)} sessions</span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Source: Google Analytics 4</p>
        </CCard>

        {/* Insights */}
        <CCard title="Insights">
          <div className="space-y-2 mt-1">
            <InsightRow icon={<MousePointerClick size={16} />} label="Average CTR (Search)"
              value={`${ctr}%`} sub={`${fmtNum(clicks)} clicks from Google`} />
            <InsightRow icon={<Search size={16} />} label="Average position (Search)"
              value={position ? position.toFixed(1) : "—"} sub="lower is better" />
            <InsightRow icon={<Target size={16} />} label="Conversions"
              value={fmtNum(conversions)} sub={conversionsD ? `${conversionsD > 0 ? "↑" : "↓"}${Math.abs(conversionsD)}% vs previous ${days} days` : `last ${days} days`} />
            <InsightRow icon={<Activity size={16} />} label="Revenue"
              value={revenue > 0 ? `฿${fmtNum(revenue)}` : "0"} sub="from GA4 ecommerce" />
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Source: Search Console · GA4</p>
        </CCard>

        {/* Performance overview (PageSpeed) */}
        <CCard title="Performance overview"
          right={
            <div className="flex rounded-full bg-[#f4f7fb] p-0.5">
              {(["mobile", "desktop"] as const).map(m => (
                <button key={m} onClick={() => setPsiMode(m)}
                  className={`px-2.5 h-6 flex items-center text-[11px] font-medium rounded-full transition-colors ${psiMode === m ? "bg-brand-blue text-white" : "text-gray-500 hover:text-brand-navy"}`}>
                  {m === "mobile" ? "Mobile" : "Desktop"}
                </button>
              ))}
            </div>
          }>
          {psiLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-gray-400 py-10 justify-center">
              <RefreshCw size={12} className="animate-spin" /> กำลังโหลด PageSpeed...
            </div>
          ) : curPsi?.status === "ok" ? (
            <div className="mt-1">
              <div className="border border-[#eef2f8] rounded-lg px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <p className="text-[1.6rem] leading-none font-bold tabular-nums" style={{ color: scoreColor }}>
                    {perfScore ?? "—"}<span className="text-[13px] text-gray-400 font-normal">/100</span>
                  </p>
                  <p className="text-[11px] text-gray-400">Performance score ({psiMode})</p>
                </div>
                <div className="h-2 rounded-full bg-[#f4f7fb] mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${perfScore ?? 0}%`, backgroundColor: scoreColor }} />
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />90+ good</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />50–89 needs improvement</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />&lt;50 poor</span>
                </div>
              </div>

              <p className="text-[11px] font-semibold text-gray-500 mt-3 mb-1.5">Performance score breakdown</p>
              <div className="space-y-1.5">
                {vitals.map(v => {
                  const grade = v.val === null ? "—" : v.val <= v.good ? "good" : v.val <= v.bad ? "needs improvement" : "poor";
                  const gc = v.val === null ? "#9ca3af" : v.val <= v.good ? "#059669" : v.val <= v.bad ? "#d97706" : "#dc2626";
                  return (
                    <div key={v.label} className="border border-[#eef2f8] rounded-lg px-3 py-2 flex items-center gap-3">
                      <p className="text-[1.05rem] font-bold tabular-nums w-16 shrink-0" style={{ color: gc }}>{v.display ?? "—"}</p>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-brand-navy font-medium truncate">{v.label} ({v.full})</p>
                        <p className="text-[11px] italic" style={{ color: gc }}>{grade}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}&strategy=${psiMode}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-brand-blue hover:underline inline-block mt-2.5">
                Learn how to improve your performance ↗
              </a>
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-10">ยังไม่มีข้อมูล PageSpeed สำหรับ {psiMode}</p>
          )}
        </CCard>
      </div>

      {/* ══ ROW 3 — Sources · Devices/Locations donut · Smart events ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Traffic sources */}
        <CCard title="Traffic sources">
          <div className="mt-1.5">
            <HBarList items={channelItems} color={CI.blue} />
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Sessions by channel · Source: GA4</p>
        </CCard>

        {/* Devices / Locations donut */}
        <CCard
          title={
            <span className="flex gap-4">
              {(["devices", "locations"] as const).map(t => (
                <button key={t} onClick={() => setDonutTab(t)}
                  className={`pb-0.5 border-b-2 transition-colors ${donutTab === t ? "border-brand-blue text-brand-navy" : "border-transparent text-gray-400 hover:text-brand-navy"}`}>
                  {t === "devices" ? "Devices" : "Locations"}
                </button>
              ))}
            </span>
          }>
          <div className="mt-1">
            {donutTab === "devices"
              ? <SKDonut data={deviceData} label="Devices" />
              : (locationData.length ? <SKDonut data={locationData} label="Locations" /> : <p className="text-[12px] text-gray-400 text-center py-10">ยังไม่มีข้อมูล Locations</p>)}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Sessions share · Source: GA4</p>
        </CCard>

        {/* Smart events */}
        <CCard title="Smart events">
          {events.length ? (
            <div className="mt-1 divide-y divide-[#f1f5fa]">
              {events.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: CI.mist, color: CI.blue }}>
                    <Zap size={14} />
                  </span>
                  <p className="text-[12.5px] text-brand-navy truncate flex-1 min-w-0" title={e.event}>{e.event}</p>
                  {e.isConversion && (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 shrink-0">conversion</span>
                  )}
                  <span className="text-[12px] text-gray-500 tabular-nums shrink-0">{fmtNum(e.count)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-10">{ga4Loading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล events"}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Event count · Source: GA4</p>
        </CCard>
      </div>

      {/* ══ ROW 4 — Search performance (GSC-style tiles + multi-line chart) ══ */}
      <CCard title={`Search performance — ${periodLabel ?? `last ${days} days`}`} pad={false}>
        <div className="px-4 pt-2 pb-1 grid grid-cols-2 lg:grid-cols-4 gap-2">
          {GSC_METRICS.map(m => {
            const on = gscSeries[m.key];
            return (
              <button key={m.key}
                onClick={() => setGscSeries(s => ({ ...s, [m.key]: !s[m.key] }))}
                className="rounded-lg px-3.5 py-3 text-left transition-opacity"
                style={{ backgroundColor: on ? m.color : "#f4f7fb", opacity: on ? 1 : 0.9 }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] leading-none ${on ? "bg-white/25 border-white/70 text-white" : "border-gray-300 text-transparent bg-white"}`}>✓</span>
                  <p className={`text-[11.5px] ${on ? "text-white/90" : "text-gray-500"}`}>{m.label}</p>
                </div>
                <p className={`text-[1.5rem] leading-none font-bold tabular-nums ${on ? "text-white" : "text-gray-400"}`}>{m.value}</p>
                {m.delta !== 0 && (
                  <p className={`text-[11px] mt-1 ${on ? "text-white/80" : "text-gray-400"}`}>
                    {(m.invert ? m.delta < 0 : m.delta > 0) ? "▲" : "▼"} {Math.abs(m.delta)}{m.key === "position" ? "" : "%"} vs prev
                  </p>
                )}
              </button>
            );
          })}
        </div>
        <div className="px-4 pt-3 pb-2">
          <MLChart data={gscDaily as unknown as Record<string, number | string>[]} series={activeSeries} />
        </div>
        <div className="px-4 pb-3 flex items-center justify-between flex-wrap gap-2">
          <p className="text-[10px] text-gray-400">Average position ใช้สเกลกลับด้าน (เส้นอยู่สูง = อันดับดี) · Source: Search Console</p>
          <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-[11px] text-brand-blue hover:underline">Open Search Console ↗</a>
        </div>
      </CCard>

      {/* ══ ROW 4.1 — Top search queries + Conversion (ประมาณการจาก landing page) ══ */}
      <CCard title="Top search queries for your site" right={evSelect} pad={false}>
        {topQueryRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#eef2f8]">
                  <th className="px-4 pb-2 pt-1 text-left text-[11.5px] font-medium text-gray-400">Keyword</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.blue }}>Clicks</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-28" style={{ color: CI.dark }}>Impressions</th>
                  <th className="px-4 pb-2 pt-1 text-right text-[11.5px] font-medium w-28" style={{ color: CI.sage }}>{hasConv ? "Conversions*" : "Events*"}</th>
                </tr>
              </thead>
              <tbody>
                {topQueryRows.map((r, i) => (
                  <tr key={i} className="border-b border-[#f4f7fb] last:border-0 hover:bg-[#fafcff]">
                    <td className="px-4 py-2.5 min-w-0">
                      <span className="text-[13px] text-brand-navy"><span className="text-gray-400 tabular-nums mr-2">{i + 1}.</span>{r.query}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.blue }}>{r.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.dark }}>{r.impressions.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums font-medium" style={{ color: r.estConv >= 0.05 ? CI.sage : "#c3ccd6" }}>{r.estConv >= 0.05 ? (hasConv ? r.estConv.toFixed(1) : Math.round(r.estConv).toLocaleString()) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 text-center py-10">{gscLoading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</p>
        )}
        <p className="text-[10px] text-gray-400 px-4 py-2.5">*{hasConv ? "Conversions" : evFilter ? `Events (เฉพาะ ${evFilter})` : "Events"} เป็นค่าประมาณ — กระจายจาก {hasConv ? "conversion" : "event"} ของ landing page (GA4) ตามสัดส่วนคลิกของแต่ละ keyword (GSC) · Source: Search Console + GA4</p>
      </CCard>

      {/* ══ ROW 4.2 — Top pages: pageviews / engagement / duration / conversion ══ */}
      <CCard title="Top pages — pageviews & engagement" right={evSelect} pad={false}>
        {gaPageRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#eef2f8]">
                  <th className="px-4 pb-2 pt-1 text-left text-[11.5px] font-medium text-gray-400">Title</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.blue }}>Pageviews</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.dark }}>Sessions</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-32" style={{ color: CI.soft }}>Engagement Rate</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-32" style={{ color: CI.mustard }}>Session Duration</th>
                  <th className="px-4 pb-2 pt-1 text-right text-[11.5px] font-medium w-28" style={{ color: CI.sage }}>{pagesHaveConv ? "Conversions" : "Events"}</th>
                </tr>
              </thead>
              <tbody>
                {gaPageRows.map((r, i) => (
                  <tr key={i} className="border-b border-[#f4f7fb] last:border-0 hover:bg-[#fafcff]">
                    <td className="px-4 py-2.5 min-w-0 max-w-lg">
                      <a href={`${project.website}${r.path}`} target="_blank" rel="noopener noreferrer"
                        className="text-[13px] text-brand-navy hover:text-brand-blue hover:underline block truncate"
                        title={r.title || r.path}>
                        <span className="text-gray-400 tabular-nums mr-2">{i + 1}.</span>{r.title || r.path}
                      </a>
                      <p className="text-[11px] text-gray-400 truncate pl-6">{r.path}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.blue }}>{r.views.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.dark }}>{r.sessions.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.soft }}>{r.engagementRate}%</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.mustard }}>{fmtDuration(r.avgDuration ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums font-medium" style={{ color: r.actVal > 0 ? CI.sage : "#c3ccd6" }}>{r.actVal > 0 ? r.actVal.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 text-center py-10">{ga4Loading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</p>
        )}
        <p className="text-[10px] text-gray-400 px-4 py-2.5">Source: GA4</p>
      </CCard>

      {/* ══ ROW 4.3 — Events & Conversions + Conversion deep-dive ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CCard title="Events" pad={false}>
          {allEvents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#eef2f8]">
                    <th className="px-4 pb-2 pt-1 text-left text-[11.5px] font-medium text-gray-400">Event</th>
                    <th className="px-4 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.blue }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {allEvents.slice(0, 12).map((e, i) => (
                    <tr key={i} className="border-b border-[#f4f7fb] last:border-0 hover:bg-[#fafcff]">
                      <td className="px-4 py-2.5 min-w-0">
                        <span className="text-[13px] text-brand-navy">{e.event}</span>
                        {e.isConversion && (
                          <span className="ml-2 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full align-middle" style={{ backgroundColor: "#e8f3ec", color: CI.sage }}>conversion</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.blue }}>{e.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-10">{ga4Loading ? "กำลังโหลด..." : "ยังไม่มี event ในช่วงนี้"}</p>
          )}
          <p className="text-[10px] text-gray-400 px-4 py-2.5">Source: GA4</p>
        </CCard>

        <CCard title={hasConv ? "Conversion เกิดที่หน้าไหน" : "Event เกิดที่หน้าไหน"} right={evSelect} pad={false}>
          {convPageRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#eef2f8]">
                    <th className="px-4 pb-2 pt-1 text-left text-[11.5px] font-medium text-gray-400">Landing page</th>
                    <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.dark }}>Sessions</th>
                    <th className="px-4 pb-2 pt-1 text-right text-[11.5px] font-medium w-28" style={{ color: CI.sage }}>{hasConv ? "Conversions" : "Events"}</th>
                  </tr>
                </thead>
                <tbody>
                  {convPageRows.map((r, i) => (
                    <tr key={i} className="border-b border-[#f4f7fb] last:border-0 hover:bg-[#fafcff]">
                      <td className="px-4 py-2.5 min-w-0 max-w-xs">
                        <a href={`${project.website}${r.path}`} target="_blank" rel="noopener noreferrer"
                          className="text-[13px] text-brand-navy hover:text-brand-blue hover:underline block truncate" title={r.path}>
                          <span className="text-gray-400 tabular-nums mr-2">{i + 1}.</span>{r.path}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.dark }}>{r.sessions.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-[13px] tabular-nums font-medium" style={{ color: CI.sage }}>{r.actVal.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {kwConvRows.length > 0 && (
                <div className="border-t border-[#eef2f8] px-4 pt-2.5 pb-1">
                  <p className="text-[11.5px] font-medium text-gray-400 mb-1.5">Keyword ที่คาดว่าพาให้เกิด {hasConv ? "conversion" : "event"}*</p>
                  {kwConvRows.map((k, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-[12.5px] text-brand-navy truncate min-w-0">{k.query}</span>
                      <span className="text-[12.5px] tabular-nums font-medium shrink-0" style={{ color: CI.sage }}>{hasConv ? k.conv.toFixed(1) : Math.round(k.conv).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-10">{ga4Loading ? "กำลังโหลด..." : `ยังไม่มี ${hasConv ? "conversion" : "event"} ในช่วงนี้`}</p>
          )}
          <p className="text-[10px] text-gray-400 px-4 py-2.5">*ประมาณจากสัดส่วนคลิกของ keyword บน landing page ที่เกิด {hasConv ? "conversion" : "event"} · Source: GA4 + Search Console</p>
        </CCard>
      </div>

      {/* ══ ROW 5 — GSC table: Queries / Pages / Devices ══ */}
      <CCard pad={false}
        title={
          <span className="flex gap-5">
            {(["queries", "pages", "devices"] as const).map(t => (
              <button key={t} onClick={() => setGscTable(t)}
                className={`pb-0.5 border-b-2 uppercase tracking-wide text-[11.5px] transition-colors ${gscTable === t ? "border-brand-blue text-brand-navy font-semibold" : "border-transparent text-gray-400 hover:text-brand-navy"}`}>
                {t}
              </button>
            ))}
          </span>
        }>
        {gscRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#eef2f8]">
                  <th className="px-4 pb-2 pt-1 text-left text-[11.5px] font-medium text-gray-400">
                    {gscTable === "queries" ? "Top queries" : gscTable === "pages" ? "Top pages" : "Device"}
                  </th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-20" style={{ color: CI.blue }}>Clicks</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-24" style={{ color: CI.dark }}>Impressions</th>
                  <th className="px-3 pb-2 pt-1 text-right text-[11.5px] font-medium w-16" style={{ color: CI.sage }}>CTR</th>
                  <th className="px-4 pb-2 pt-1 text-right text-[11.5px] font-medium w-20" style={{ color: CI.salmon }}>Position</th>
                </tr>
              </thead>
              <tbody>
                {gscRows.map((r, i) => (
                  <tr key={i} className="border-b border-[#f4f7fb] last:border-0 hover:bg-[#fafcff]">
                    <td className="px-4 py-2.5 min-w-0">
                      {r.href ? (
                        <a href={r.href} target="_blank" rel="noopener noreferrer"
                          className="text-[13px] text-brand-navy hover:text-brand-blue hover:underline block truncate max-w-md" title={r.name}>{r.name}</a>
                      ) : (
                        <span className="text-[13px] text-brand-navy block truncate max-w-md">{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.blue }}>{r.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.dark }}>{r.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.sage }}>{r.ctr}%</td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums" style={{ color: CI.salmon }}>{r.position ? r.position.toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 text-center py-10">{gscLoading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</p>
        )}
        <p className="text-[10px] text-gray-400 px-4 py-2.5">Source: Search Console</p>
      </CCard>

      {/* ══ ROW 6 — Top pages (GA4) · How to improve (PSI) ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CCard title="Top pages">
          <div className="mt-1.5">
            <HBarList items={topPageItems} color={CI.soft} />
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Pageviews · Source: GA4</p>
        </CCard>

        <CCard title="How to improve"
          right={<span className="text-[11px] text-gray-400">{psiMode}</span>}>
          {curPsi?.opportunities && curPsi.opportunities.length > 0 ? (
            <div className="mt-1 divide-y divide-[#f1f5fa]">
              {curPsi.opportunities.slice(0, 8).map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CI.mustard }} />
                    <p className="text-[12.5px] text-brand-navy truncate">
                      {o.type.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </p>
                  </div>
                  {o.savings && <span className="text-[12px] font-medium shrink-0" style={{ color: CI.sage }}>{o.savings}</span>}
                </div>
              ))}
            </div>
          ) : curPsi?.status === "ok" ? (
            <p className="text-[12px] text-gray-400 text-center py-10">ไม่พบจุดที่ต้องปรับปรุง — หน้าเว็บทำงานได้ดีอยู่แล้ว</p>
          ) : (
            <p className="text-[12px] text-gray-400 text-center py-10">ยังไม่มีข้อมูล PageSpeed</p>
          )}
          <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}&strategy=${psiMode}`}
            target="_blank" rel="noopener noreferrer" className="text-[11px] text-brand-blue hover:underline inline-block mt-2">
            View full report at PageSpeed Insights ↗
          </a>
        </CCard>
      </div>
    </div>
  );
}

type ReportMode = "dashboard" | "seo-performance" | "simple";

export function ClientReportClient({ project, isClient = false }: { project: Project; isClient?: boolean }) {
  const [days, setDays]               = useState(28);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [showCustom, setShowCustom]   = useState(false);
  const [draftStart, setDraftStart]   = useState("");
  const [draftEnd, setDraftEnd]       = useState("");
  const [reportMode, setReportMode]   = useState<ReportMode>("simple");
  const [gscData, setGscData]         = useState<Record<string, unknown> | null>(null);
  const [ga4Data, setGa4Data]         = useState<Record<string, unknown> | null>(null);
  const [psiData, setPsiData]         = useState<Record<string, unknown> | null>(null);
  const [gscAiData, setGscAiData]     = useState<GscAiData | null>(null);
  const [gscInsights, setGscInsights] = useState<{ insights: GscInsightItem[]; counts: Record<string, number>; period?: Record<string, string | number> } | null>(null);
  const [gscInsLoading, setGscInsLoading] = useState(false);
  const [gscLoading, setGscLoading]   = useState(false);
  const [ga4Loading, setGa4Loading]   = useState(false);
  const [psiLoading, setPsiLoading]   = useState(false);
  const [gscError, setGscError]       = useState<string | null>(null);
  const [ga4Error, setGa4Error]       = useState<string | null>(null);
  const [psiError, setPsiError]       = useState<string | null>(null);

  // GA4 property — read-only here; ผูก property ทำที่ Settings › GSC · GA4
  const ga4PropertyId = project.ga4PropertyId ?? "";

  const fetchGSC = useCallback(async () => {
    if (!project.gscSiteUrl) return;
    setGscLoading(true); setGscError(null);
    try {
      const [gscRes, aiRes] = await Promise.allSettled([
        fetch("/api/report/gsc", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: project.gscSiteUrl, days, ...(customRange ? { startDate: customRange.start, endDate: customRange.end } : {}) }),
        }).then(r => r.json()),
        fetch("/api/report/gsc-ai", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: project.gscSiteUrl, days, ...(customRange ? { startDate: customRange.start, endDate: customRange.end } : {}) }),
        }).then(r => r.json()),
      ]);
      if (gscRes.status === "fulfilled" && !gscRes.value.error) setGscData(gscRes.value);
      else if (gscRes.status === "rejected") throw new Error(String(gscRes.reason));
      else if (gscRes.status === "fulfilled" && gscRes.value.error) throw new Error(gscRes.value.error);
      if (aiRes.status === "fulfilled" && !aiRes.value.error) setGscAiData(aiRes.value as GscAiData);
    } catch (e) { setGscError(e instanceof Error ? e.message : "Error"); }
    finally { setGscLoading(false); }

    // Fetch GSC Insights (per-query comparison)
    setGscInsLoading(true);
    try {
      const r = await fetch("/api/report/gsc-insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: project.gscSiteUrl, days, ...(customRange ? { startDate: customRange.start, endDate: customRange.end } : {}) }),
      });
      const d = await r.json();
      if (!d.error) setGscInsights(d);
    } catch { /* non-fatal */ }
    finally { setGscInsLoading(false); }
  }, [project.gscSiteUrl, days, customRange]);

  const fetchGA4 = useCallback(async (overrideId?: string) => {
    const pid = overrideId ?? ga4PropertyId;
    if (!pid) return;
    setGa4Loading(true); setGa4Error(null);
    try {
      const r = await fetch("/api/report/ga4", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: pid, days, ...(customRange ? { startDate: customRange.start, endDate: customRange.end } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setGa4Data(d);
    } catch (e) { setGa4Error(e instanceof Error ? e.message : "Error"); }
    finally { setGa4Loading(false); }
  }, [ga4PropertyId, days, customRange]);

  const fetchPSI = useCallback(async () => {
    const url = project.gscSiteUrl?.startsWith("sc-domain:")
      ? `https://${project.gscSiteUrl.replace("sc-domain:", "")}/`
      : project.gscSiteUrl ?? project.website;
    if (!url) return;
    setPsiLoading(true); setPsiError(null);
    try {
      const r = await fetch("/api/report/pagespeed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      // เก็บเฉพาะ payload ที่มี vitals จริง — กัน component crash จาก shape เพี้ยน
      if (d?.mobile?.vitals?.lcp || d?.desktop?.vitals?.lcp) setPsiData(d);
      else throw new Error(d?.mobile?.error ?? d?.error ?? "PageSpeed ตอบข้อมูลไม่ครบ ลองใหม่อีกครั้ง");
    } catch (e) { setPsiError(e instanceof Error ? e.message : "Error"); }
    finally { setPsiLoading(false); }
  }, [project.gscSiteUrl, project.website]);

  useEffect(() => {
    fetchGSC(); fetchGA4(); fetchPSI();
  }, [fetchGSC, fetchGA4, fetchPSI]);

  const gsc  = gscData as { overview?: Record<string, number>; pages?: {page:string;clicks:number;impressions:number;ctr:number;position:number}[]; queries?: {query:string;clicks:number;impressions:number;ctr:number;position:number}[]; devices?: {device:string;clicks:number}[]; period?: Record<string,string|number> } | null;
  const ga4  = ga4Data as { overview?: Record<string, number>; channels?: {channel:string;sessions:number;conversions:number;revenue:number}[]; pages?: {path:string;views:number;sessions:number;bounceRate:number;engagementRate:number}[]; devices?: {device:string;sessions:number;conversions:number}[]; events?: {event:string;isConversion:boolean;count:number;conversions:number}[] } | null;
  const psi  = psiData as { mobile?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]}; desktop?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]} } | null;

  // Derive insights for Dashboard mode
  const dashInsights = useMemo(() => {
    // เกราะกัน crash ถาวร: API ตอบ shape เพี้ยนแค่ไหน insights ก็แค่ว่าง ไม่ล้มทั้งหน้า
    const safe = <T,>(fn: () => T[]): T[] => { try { return fn() } catch { return [] } };
    const gscIns  = gsc  ? safe(() => deriveGSCInsights(gsc  as unknown as GSCData))  : [];
    const ga4Ins  = ga4  ? safe(() => deriveGA4Insights(ga4  as unknown as GA4Data))  : [];
    const convIns = ga4  ? safe(() => deriveConversionInsights(ga4 as unknown as GA4Data)) : [];
    const psiIns  = psi  ? safe(() => derivePSIInsights(psi  as unknown as PSIData))  : [];
    const connIns = safe(() => deriveConnectedInsights(gsc as unknown as GSCData | null, ga4 as unknown as GA4Data | null, psi as unknown as PSIData | null));
    const aiIns   = gscAiData ? safe(() => deriveAIInsights(gscAiData)) : [];
    return {
      gsc:  gscIns,
      ga4:  [...ga4Ins, ...convIns],
      psi:  psiIns,
      ai:   aiIns,
      conn: connIns,
    };
  }, [gsc, ga4, psi, gscAiData]);

  return (
    <div className="space-y-5 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {!isClient && (
            <Link href={`/projects/${project.id}`} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <ArrowLeft size={16} />
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold text-brand-navy">{project.name}</h1>
            <a href={project.website} target="_blank" rel="noopener" className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-0.5">
              <ExternalLink size={9} />{project.website}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[7, 28, 90].map(d => (
            <button key={d} onClick={() => { setCustomRange(null); setShowCustom(false); setDays(d); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${!customRange && days === d ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {d} วัน
            </button>
          ))}
          <button onClick={() => setShowCustom(v => !v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${customRange ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {customRange ? `${customRange.start} → ${customRange.end}` : "กำหนดเอง"}
          </button>
          {showCustom && (
            <span className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-2.5 py-1">
              <input type="date" value={draftStart} max={draftEnd || undefined} onChange={e => setDraftStart(e.target.value)}
                className="text-[11px] text-gray-600 outline-none bg-transparent" />
              <span className="text-[11px] text-gray-400">→</span>
              <input type="date" value={draftEnd} min={draftStart || undefined} onChange={e => setDraftEnd(e.target.value)}
                className="text-[11px] text-gray-600 outline-none bg-transparent" />
              <button disabled={!draftStart || !draftEnd}
                onClick={() => { if (draftStart && draftEnd) { setCustomRange({ start: draftStart, end: draftEnd }); setShowCustom(false); } }}
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand-blue text-white disabled:opacity-40 transition-opacity">
                ดู
              </button>
            </span>
          )}
          <button onClick={() => { fetchGSC(); fetchGA4(); fetchPSI(); }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <RefreshCw size={14} className={gscLoading || ga4Loading || psiLoading ? "animate-spin" : ""} />
          </button>
          {!isClient && (
            <>
              <button
                onClick={() => exportCsv(project.name, gsc, ga4, days)}
                title="Export CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold transition-colors">
                <FileSpreadsheet size={13} /> CSV
              </button>
              <button
                onClick={() => exportHtml(project.name, project.website, gsc, ga4, psi as any, days, dashInsights)}
                title="Export HTML"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-colors">
                <FileText size={13} /> HTML
              </button>
            </>
          )}
        </div>
      </div>

      {/* Report type selector — hidden for clients (always simple) */}
      {!isClient && (
        <div className="flex gap-2 border-b border-gray-100 pb-3">
          <button onClick={() => setReportMode("simple")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "simple" ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <FileText size={12} /> Simple Report
          </button>
          <button onClick={() => setReportMode("dashboard")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "dashboard" ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <BarChart3 size={12} /> Dashboard
          </button>
          <button onClick={() => setReportMode("seo-performance")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "seo-performance" ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <FileBarChart2 size={12} /> SEO Performance Report
          </button>
        </div>
      )}

      {/* การตั้งค่าเชื่อมต่อ Google ย้ายไปอยู่ Project Settings (ฟันเฟือง) > GSC · GA4 */}

      {/* Status badges — read-only. การผูก GSC/GA4 Property ทำที่ Project Settings › GSC · GA4 เท่านั้น */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${project.gscSiteUrl ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
          {project.gscSiteUrl ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          GSC{project.gscSiteUrl ? "" : " — ยังไม่เชื่อมต่อ"}
        </span>

        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${ga4PropertyId ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
          {ga4PropertyId ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {ga4PropertyId ? `GA4 (${ga4PropertyId})` : "GA4 — ยังไม่เชื่อมต่อ"}
        </span>

        {!isClient && (!project.gscSiteUrl || !ga4PropertyId) && (
          <span className="text-[11px] text-gray-400">
            ตั้งค่าการเชื่อมต่อที่ปุ่มฟันเฟือง (Settings) › แท็บ “GSC · GA4”
          </span>
        )}
      </div>

      {/* ── SEO Performance Report Skill ── */}
      {reportMode === "seo-performance" && (
        <SEOPerformanceReport
          projectName={project.name}
          gsc={gscData as GSCData | null}
          ga4={ga4Data as GA4Data | null}
          psi={psiData as PSIData | null}
          gscAi={gscAiData}
          gscError={gscError}
          ga4Error={ga4Error}
          psiError={psiError}
          gscLoading={gscLoading}
          ga4Loading={ga4Loading}
          psiLoading={psiLoading}
          period={{ days }}
        />
      )}

      {/* ── Dashboard view ── */}
      {reportMode === "dashboard" && project.gscSiteUrl && (
        <Section title="Google Search Console" icon={<Globe size={14} />} defaultOpen>
          {gscLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><RefreshCw size={14} className="animate-spin" /> กำลังโหลด...</div>
          ) : gscError ? (
            <div className="flex items-center gap-2 text-sm text-red-500"><AlertCircle size={14} />{gscError}</div>
          ) : gsc?.overview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Clicks"      value={gsc.overview.clicks}      delta={gsc.overview.clicksDelta} />
                <StatCard label="Impressions" value={gsc.overview.impressions} delta={gsc.overview.impressionsDelta} />
                <StatCard label="CTR"         value={gsc.overview.ctr}         delta={gsc.overview.ctrDelta}         format="pct" />
                <StatCard label="Avg Position" value={gsc.overview.position}   delta={gsc.overview.positionDelta}   format="position" inverse />
              </div>

              {/* GSC Insights */}
              {dashInsights.gsc.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Analysis</p>
                  {dashInsights.gsc.map((ins, i) => <InsightCard key={i} insight={ins} />)}
                </div>
              )}

              {/* Top pages */}
              {gsc.pages && gsc.pages.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Top Pages</p>
                  <div className="space-y-0">
                    {/* header */}
                    <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1.5 border-b border-gray-100">
                      <span className="w-4 shrink-0" />
                      <span className="flex-1">Page</span>
                      <span className="w-14 text-right">Clicks</span>
                      <span className="w-16 text-right">Impressions</span>
                      <span className="w-10 text-right">CTR</span>
                      <span className="w-10 text-right">Position</span>
                    </div>
                    {gsc.pages.slice(0, 10).map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-400 w-4 shrink-0">{i + 1}</span>
                        <span className="flex-1 text-gray-700 truncate" title={p.page}>{p.page}</span>
                        <span className="text-brand-navy font-semibold w-14 text-right">{p.clicks.toLocaleString()}</span>
                        <span className="text-gray-500 w-16 text-right">{p.impressions.toLocaleString()}</span>
                        <span className="text-gray-400 w-10 text-right">{p.ctr}%</span>
                        <span className="text-gray-400 w-10 text-right">#{p.position}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top queries */}
              {gsc.queries && gsc.queries.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Top Keywords</p>
                  <div className="space-y-0">
                    {/* header */}
                    <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1.5 border-b border-gray-100">
                      <span className="w-4 shrink-0" />
                      <span className="flex-1">Keyword</span>
                      <span className="w-14 text-right">Clicks</span>
                      <span className="w-16 text-right">Impressions</span>
                      <span className="w-10 text-right">CTR</span>
                      <span className="w-10 text-right">Position</span>
                    </div>
                    {gsc.queries.slice(0, 10).map((q, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-400 w-4 shrink-0">{i + 1}</span>
                        <span className="flex-1 text-gray-700 truncate">{q.query}</span>
                        <span className="text-brand-navy font-semibold w-14 text-right">{q.clicks.toLocaleString()}</span>
                        <span className="text-gray-500 w-16 text-right">{q.impressions.toLocaleString()}</span>
                        <span className="text-gray-400 w-10 text-right">{q.ctr}%</span>
                        <span className="text-gray-400 w-10 text-right">#{q.position}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </Section>
      )}

      {/* ── GA4 ── */}
      {reportMode === "dashboard" && project.ga4PropertyId && (
        <Section title="GA4 Analytics & Conversions" icon={<BarChart3 size={14} />} defaultOpen>
          {ga4Loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><RefreshCw size={14} className="animate-spin" /> กำลังโหลด...</div>
          ) : ga4Error ? (
            <div className="flex items-center gap-2 text-sm text-red-500"><AlertCircle size={14} />{ga4Error}</div>
          ) : ga4?.overview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Sessions"    value={ga4.overview.sessions}    delta={ga4.overview.sessionsDelta} />
                <StatCard label="Users"       value={ga4.overview.users}       delta={ga4.overview.usersDelta} />
                <StatCard label="Conversions" value={ga4.overview.conversions} delta={ga4.overview.conversionsDelta} />
                <StatCard label="Revenue (฿)" value={ga4.overview.revenue}     delta={ga4.overview.revenueDelta}    format="money" />
              </div>

              {/* GA4 Insights */}
              {dashInsights.ga4.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Analysis</p>
                  {dashInsights.ga4.map((ins, i) => <InsightCard key={i} insight={ins} />)}
                </div>
              )}

              {/* Channels */}
              {ga4.channels && ga4.channels.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Traffic Channels</p>
                  <div className="space-y-1.5">
                    {ga4.channels.map((c, i) => {
                      const totalSessions = ga4.channels!.reduce((s, r) => s + r.sessions, 0);
                      const pct = totalSessions > 0 ? Math.round(c.sessions / totalSessions * 100) : 0;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-28 text-gray-700 truncate shrink-0">{c.channel}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-brand-navy font-semibold w-14 text-right">{c.sessions.toLocaleString()}</span>
                          <span className="text-emerald-600 w-14 text-right">{c.conversions} conv</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conversion events */}
              {ga4.events && ga4.events.filter(e => e.isConversion).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Conversion Events</p>
                  <div className="flex flex-wrap gap-2">
                    {ga4.events.filter(e => e.isConversion).map((ev, i) => (
                      <span key={i} className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
                        <span className="font-semibold text-emerald-800">{ev.event}</span>
                        <span className="text-emerald-600 ml-2">{ev.conversions.toLocaleString()}x</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Top pages */}
              {ga4.pages && ga4.pages.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Top Pages</p>
                  <div className="space-y-1">
                    {ga4.pages.slice(0, 10).map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-400 w-4 shrink-0">{i + 1}</span>
                        <span className="flex-1 text-gray-700 truncate" title={p.path}>{p.path}</span>
                        <span className="text-brand-navy font-semibold w-14 text-right">{p.views.toLocaleString()} views</span>
                        <span className="text-gray-400 w-14 text-right">Eng {p.engagementRate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </Section>
      )}

      {/* ── PageSpeed ── */}
      {reportMode === "dashboard" && <Section title="PageSpeed / Core Web Vitals" icon={<Zap size={14} />} defaultOpen={false}>
        {psiLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><RefreshCw size={14} className="animate-spin" /> กำลัง fetch PageSpeed...</div>
        ) : psiError ? (
          <div className="flex items-center gap-2 text-sm text-red-500"><AlertCircle size={14} />{psiError}</div>
        ) : psi ? (
          <div className="space-y-5">
            {/* PSI Insights */}
            {dashInsights.psi.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Analysis</p>
                {dashInsights.psi.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}
            {(["mobile", "desktop"] as const).map(strategy => {
              const s = psi[strategy];
              if (!s || s.status !== "ok") return null;
              return (
                <div key={strategy}>
                  <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">{strategy}</p>
                  <div className="flex gap-6 mb-4">
                    <ScoreRing score={s.scores.performance}    label="Performance" />
                    <ScoreRing score={s.scores.accessibility}  label="Accessibility" />
                    <ScoreRing score={s.scores.seo}            label="SEO" />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    <VitalBadge label="LCP"  display={s.vitals.lcp.display}   value={s.vitals.lcp.value}   good={2500} bad={4000} />
                    <VitalBadge label="CLS"  display={s.vitals.cls.display}   value={s.vitals.cls.value}   good={0.1}  bad={0.25} />
                    <VitalBadge label="FCP"  display={s.vitals.fcp.display}   value={s.vitals.fcp.value}   good={1800} bad={3000} />
                    <VitalBadge label="TTFB" display={s.vitals.ttfb.display}  value={s.vitals.ttfb.value}  good={800}  bad={1800} />
                    <VitalBadge label={s.vitals.responsiveness.metric}
                      display={s.vitals.responsiveness.value}
                      value={s.vitals.responsiveness.numericValue}
                      good={200} bad={500} />
                  </div>
                  {s.opportunities.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {s.opportunities.map((o, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">
                          <AlertCircle size={10} />
                          <span>{o.type.replace(/_/g, " ")}</span>
                          {o.savings && <span className="font-semibold">— save {o.savings}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-4">ไม่มี URL สำหรับ PageSpeed</p>
        )}
      </Section>}

      {/* ── Connected Insights ── */}
      {reportMode === "dashboard" && dashInsights.conn.length > 0 && (
        <Section title="Cross-Channel Insights" icon={<TrendingUp size={14} />} defaultOpen>
          <div className="space-y-2">
            {dashInsights.conn.map((ins, i) => <InsightCard key={i} insight={ins} />)}
          </div>
        </Section>
      )}

      {/* ── AI Search Insights ── */}
      {reportMode === "dashboard" && dashInsights.ai.length > 0 && (
        <Section title="AI Search Performance" icon={<Zap size={14} />} defaultOpen>
          <div className="space-y-2">
            {dashInsights.ai.map((ins, i) => <InsightCard key={i} insight={ins} />)}
          </div>
        </Section>
      )}

      {/* ── GSC Query Insights ── */}
      {reportMode === "dashboard" && project.gscSiteUrl && (
        <Section title="GSC Query Insights" icon={<Search size={14} />} defaultOpen>
          {gscInsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
              <RefreshCw size={14} className="animate-spin" /> กำลังวิเคราะห์ข้อมูล GSC...
            </div>
          ) : gscInsights ? (
            <div className="space-y-3">
              {/* Period + total */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                {gscInsights.period && (
                  <p className="text-[10px] text-gray-400">
                    {gscInsights.period.start} — {gscInsights.period.end}
                    <span className="text-gray-300 mx-1.5">vs</span>
                    {gscInsights.period.prevStart} — {gscInsights.period.prevEnd}
                  </p>
                )}
                <span className="text-[10px] text-gray-400 font-medium">
                  {gscInsights.counts.total ?? gscInsights.insights.length} signals พบ
                </span>
              </div>

              {/* Grouped sections */}
              {gscInsights.insights.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">ยังไม่มี insight ที่น่าสนใจในช่วงนี้</p>
              ) : (
                <div className="space-y-3">
                  {INSIGHT_GROUPS.map(group => {
                    const items = gscInsights.insights.filter(i => group.types.includes(i.type));
                    return <GscInsightGroupSection key={group.key} group={group} items={items} />;
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-4 text-center">ยังไม่มีข้อมูล — ตรวจสอบว่า GSC เชื่อมต่อแล้ว</p>
          )}
        </Section>
      )}

      {/* ── Simple Report — shown for clients always, for admins when mode=simple ── */}
      {(isClient || reportMode === "simple") && (
        <SimpleReport
          project={project}
          gsc={gsc}
          ga4={ga4}
          psi={psi}
          gscLoading={gscLoading}
          ga4Loading={ga4Loading}
          psiLoading={psiLoading}
          gscError={gscError}
          ga4Error={ga4Error}
          days={days}
          periodLabel={customRange ? `${customRange.start} ถึง ${customRange.end}` : `last ${days} days`}
        />
      )}

      {/* Setup guide if not connected — admin only */}
      {!isClient && reportMode === "dashboard" && (!project.gscSiteUrl || !project.ga4PropertyId) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-sm text-gray-500 space-y-2">
          <p className="font-semibold text-gray-700">ตั้งค่าเพื่อดูรายงานครบ</p>
          {!project.gscSiteUrl && (
            <p>• <b>GSC</b>: เพิ่ม <code className="bg-gray-200 px-1 rounded text-xs">gscSiteUrl</code> ใน Project settings เช่น <code className="bg-gray-200 px-1 rounded text-xs">sc-domain:example.com</code></p>
          )}
          {!project.ga4PropertyId && (
            <p>• <b>GA4</b>: เพิ่ม <code className="bg-gray-200 px-1 rounded text-xs">ga4PropertyId</code> ใน Project settings เช่น <code className="bg-gray-200 px-1 rounded text-xs">511641653</code></p>
          )}
          <Link href={`/projects/${project.id}?tab=settings`} className="text-brand-blue hover:underline text-xs inline-flex items-center gap-1 mt-1">
            <ExternalLink size={10} /> ไปที่ Project Settings
          </Link>
        </div>
      )}
    </div>
  );
}
