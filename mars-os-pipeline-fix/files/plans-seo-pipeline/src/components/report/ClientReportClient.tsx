"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus,
  Globe, Zap, BarChart3, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink,
  FileBarChart2, Lightbulb, Search, ArrowUp, ArrowDown, Star, Target,
  Download, FileText, FileSpreadsheet,
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
      <p className="text-2xl font-bold text-gray-900">{fmt(value)}</p>
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
        <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">{icon}{title}</div>
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
    opportunity: { bg: "bg-blue-50",    border: "border-blue-200",    icon: <Lightbulb    size={13} className="text-blue-600 shrink-0" />,    label: "Opportunity", dot: "bg-blue-500" },
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
            <span className="text-sm font-semibold text-gray-900">{insight.title}</span>
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
      ${(["mobile","desktop"] as const).filter(s=>psi[s]?.scores).map(s => {
        const sc = psi[s]!.scores;
        const vi = psi[s]!.vitals as Record<string,{display:string;value:number|null}>;
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

type GscType = { overview?: Record<string, number>; pages?: {page:string;clicks:number;impressions:number;ctr:number;position:number}[]; queries?: {query:string;clicks:number;impressions:number;ctr:number;position:number}[] } | null;
type Ga4Type = { overview?: Record<string, number>; channels?: {channel:string;sessions:number;conversions:number;revenue:number}[]; pages?: {path:string;views:number;sessions:number;bounceRate:number;engagementRate:number;sessionDuration?:number}[]; devices?: {device:string;sessions:number;conversions:number}[]; events?: {event:string;isConversion:boolean;count:number;conversions:number}[]; countries?: {country:string;sessions:number}[] } | null;
type PsiType = { mobile?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]}; desktop?: {status:string;scores:{performance:number|null;accessibility:number|null;seo:number|null};vitals:{lcp:{display:string;value:number|null};cls:{display:string;value:number|null};fcp:{display:string;value:number|null};ttfb:{display:string;value:number|null};responsiveness:{metric:string;value:string;numericValue:number|null}};opportunities:{type:string;savings?:string}[]} } | null;

function SimpleMetricCard({ label, value, subLabel, delta, deltaLabel, color = "text-gray-900" }: {
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
            <span className="font-bold text-gray-900">{Math.round(s.pct * 100)}%</span>
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
            <span className="font-semibold text-gray-900 ml-2 shrink-0">{d.value.toLocaleString()}</span>
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

type GscDailyRow = { date: string; clicks: number; impressions: number };
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

function SimpleReport({ project, gsc, ga4, psi, gscLoading, ga4Loading, psiLoading, gscError, ga4Error, days }: {
  project: { name: string; website: string }
  gsc: GscType; ga4: Ga4Type; psi: PsiType
  gscLoading: boolean; ga4Loading: boolean; psiLoading: boolean
  gscError: string | null; ga4Error: string | null
  days: number
}) {
  const [donutTab, setDonutTab] = useState<'channels'|'locations'|'devices'>('channels');
  const [psiTab, setPsiTab] = useState<'lab'|'field'|'improve'>('field');
  const [psiMode, setPsiMode] = useState<'mobile'|'desktop'>('mobile');
  const [activeGscMetric, setActiveGscMetric] = useState<'clicks'|'impressions'|'users'>('clicks');
  const [activeGa4Metric, setActiveGa4Metric] = useState<'sessions'|'users'>('sessions');

  const loading = gscLoading || ga4Loading;

  const sessions    = ga4?.overview?.sessions ?? 0;
  const sessionsD   = ga4?.overview?.sessionsDelta ?? 0;
  const conversions = ga4?.overview?.conversions ?? 0;
  const conversionsD = ga4?.overview?.conversionsDelta ?? 0;
  const revenue     = ga4?.overview?.revenue ?? 0;
  const revenueD    = ga4?.overview?.revenueDelta ?? 0;
  const clicks      = gsc?.overview?.clicks ?? 0;
  const clicksD     = gsc?.overview?.clicksDelta ?? 0;
  const impressions = gsc?.overview?.impressions ?? 0;
  const impressionsD = gsc?.overview?.impressionsDelta ?? 0;
  const users       = ga4?.overview?.users ?? 0;
  const usersD      = ga4?.overview?.usersDelta ?? 0;
  const position    = gsc?.overview?.position ?? 0;

  const ga4Daily = ((ga4 as {daily?: Ga4DailyRow[]})?.daily ?? []) as Ga4DailyRow[];
  const gscDaily = ((gsc as {daily?: GscDailyRow[]})?.daily ?? []) as GscDailyRow[];

  const CHANNEL_COLORS: Record<string,string> = {
    "Organic Search":"#fbbc04","Direct":"#8ab4f8","Paid Search":"#ea4335",
    "Organic Social":"#34a853","Referral":"#a142f4","Cross-Network":"#e6c7fb",
    "Email":"#00bcd4","(Other)":"#9e9e9e","Others":"#9e9e9e",
  };
  const DEVICE_COLORS: Record<string,string> = { mobile:"#fbbc04", desktop:"#8ab4f8", tablet:"#34a853" };

  const channelData = (ga4?.channels ?? []).map(c => ({
    label: c.channel, value: c.sessions,
    color: CHANNEL_COLORS[c.channel] ?? "#9e9e9e",
  }));
  const deviceData = (ga4?.devices ?? []).map(d => ({
    label: d.device ?? "other", value: d.sessions,
    color: DEVICE_COLORS[(d.device ?? "").toLowerCase()] ?? "#9e9e9e",
  }));
  const LOC_COLORS = ["#8ab4f8","#fbbc04","#34a853","#a142f4","#ea4335","#00bcd4","#e6c7fb","#9e9e9e"];
  const locationData = (ga4?.countries ?? []).map((c, i) => ({
    label: c.country || "Unknown", value: c.sessions,
    color: LOC_COLORS[i % LOC_COLORS.length],
  }));

  const convEvents = (ga4?.events ?? []).filter(e => e.isConversion);
  const mPsi = psi?.mobile; const dPsi = psi?.desktop;
  const curPsi = psiMode === "mobile" ? mPsi : dPsi;

  function fmtBig(n: number) {
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n/1_000).toFixed(0)}K`;
    return n.toLocaleString();
  }

  function Delta({ v, inv = false }: { v: number; inv?: boolean }) {
    const good = inv ? v <= 0 : v >= 0;
    if (v === 0) return null;
    return (
      <p className={`text-[13px] font-normal mt-1.5 ${good ? "text-[#137333]" : "text-[#c5221f]"}`}>
        <span>{good ? "↑" : "↓"}{Math.abs(v).toFixed(1)}%</span>
        <span className="text-[#5f6368] ml-1">compared to the previous {days} days</span>
      </p>
    );
  }

  // SK card wrapper
  function SKCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
      <div className={`bg-white rounded-lg shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)] overflow-hidden ${className}`}>
        {children}
      </div>
    );
  }

  // PSI vitals definitions per tab
  const labVitals = curPsi ? [
    { label: "Largest Contentful Paint", desc: "Time it takes for the page to load",
      display: curPsi.vitals.lcp.display, val: curPsi.vitals.lcp.value, good: 2500, bad: 4000 },
    { label: "Cumulative Layout Shift", desc: "How stable the elements on the page are",
      display: curPsi.vitals.cls.display, val: curPsi.vitals.cls.value, good: 0.1, bad: 0.25 },
    { label: "Total Blocking Time", desc: "How long people had to wait after the page loaded before they could click something",
      display: curPsi.vitals.responsiveness.value, val: curPsi.vitals.responsiveness.numericValue, good: 200, bad: 500 },
  ] : [];
  const fieldVitals = curPsi ? [
    { label: "Largest Contentful Paint", desc: "Time it takes for the page to load",
      display: curPsi.vitals.lcp.display, val: curPsi.vitals.lcp.value, good: 2500, bad: 4000 },
    { label: "Cumulative Layout Shift", desc: "How stable the elements on the page are",
      display: curPsi.vitals.cls.display, val: curPsi.vitals.cls.value, good: 0.1, bad: 0.25 },
    { label: "Interaction to Next Paint", desc: "How quickly your page responds when people interact with it",
      display: curPsi.vitals.responsiveness.value, val: curPsi.vitals.responsiveness.numericValue, good: 200, bad: 500 },
  ] : [];

  return (
    <div className="bg-[#f1f3f4] -mx-6 -mt-4 px-4 pt-5 pb-10 min-h-screen space-y-3 w-[calc(100%+3rem)]">
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-[#5f6368] bg-white rounded px-3 py-1.5 w-fit shadow-sm">
          <RefreshCw size={11} className="animate-spin"/> กำลังโหลดข้อมูล...
        </div>
      )}

      {/* ══ CARD 1 — Find out how your audience is growing ══ */}
      <SKCard>
        <div className="px-6 pt-5 pb-2">
          <p className="text-[15px] font-normal text-[#202124] leading-snug">Find out how your audience is growing</p>
          <p className="text-[13px] text-[#5f6368] mt-0.5">Track your site&apos;s traffic over time</p>
        </div>
        {/* layout: chart left, donut+tabs right — no border between */}
        <div className="flex flex-col lg:flex-row">
          {/* Left — metric selector + chart */}
          <div className="flex-1 px-6 pt-2 pb-5 min-w-0">
            {/* Clickable metric tabs */}
            <div className="flex gap-6 border-b border-[#e8eaed] mb-3">
              {[
                { key: 'sessions' as const, label: 'All Visitors', value: sessions, delta: sessionsD },
                { key: 'users' as const,    label: 'Unique Visitors', value: users, delta: usersD },
              ].map(m => (
                <button key={m.key} onClick={() => setActiveGa4Metric(m.key)}
                  className={`pb-2.5 border-b-2 text-left transition-colors ${activeGa4Metric === m.key ? "border-[#137333]" : "border-transparent"}`}>
                  <p className={`text-[13px] mb-0.5 ${activeGa4Metric === m.key ? "text-[#137333] font-medium" : "text-[#5f6368]"}`}>{m.label}</p>
                  <p className="text-[2rem] font-normal text-[#202124] leading-none tracking-tight">{fmtBig(m.value)}</p>
                  <Delta v={m.delta} />
                </button>
              ))}
            </div>
            <div className="mt-2">
              <SKLineChart data={ga4Daily} field={activeGa4Metric} color="#137333" />
            </div>
            <p className="text-[11px] mt-3">
              <a href={`https://analytics.google.com`} target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
                Source: Analytics ↗
              </a>
            </p>
          </div>
          {/* Right — tabs + donut (no border-left per screenshots) */}
          <div className="lg:w-[340px] shrink-0 px-6 pt-3 pb-5">
            <div className="flex gap-6 border-b border-[#e8eaed] mb-3">
              {(['Channels','Locations','Devices'] as const).map(t => {
                const key = t.toLowerCase() as 'channels'|'locations'|'devices';
                return (
                  <button key={t} onClick={() => setDonutTab(key)}
                    className={`text-[13px] pb-2.5 border-b-2 transition-colors whitespace-nowrap ${
                      donutTab === key ? "border-[#137333] text-[#202124] font-medium" : "border-transparent text-[#5f6368] hover:text-[#202124]"
                    }`}>{t}
                  </button>
                );
              })}
            </div>
            {donutTab === 'channels' && <SKDonut data={channelData} label="Channels"/>}
            {donutTab === 'devices'  && <SKDonut data={deviceData}  label="Devices"/>}
            {donutTab === 'locations' && (locationData.length
              ? <SKDonut data={locationData} label="Locations"/>
              : <p className="text-xs text-[#5f6368] py-10 text-center">ยังไม่มีข้อมูล Locations</p>
            )}
            <p className="text-[11px] mt-3">
              <a href={`https://analytics.google.com`} target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
                Source: Analytics ↗
              </a>
            </p>
          </div>
        </div>
      </SKCard>

      {/* ══ CARD 2 — Search traffic ══ */}
      <SKCard>
        <div className="px-6 pt-5 pb-2">
          <p className="text-base font-normal text-[#202124]">Search traffic over the last {days} days</p>
        </div>
        {/* 3 metrics — กดได้เพื่อเปลี่ยน chart */}
        <div className="px-6 pt-4 pb-5 grid grid-cols-3 gap-0">
          {[
            { label: "Total Impressions", value: impressions, delta: impressionsD, metric: 'impressions' as const },
            { label: "Total Clicks",      value: clicks,      delta: clicksD,      metric: 'clicks' as const },
            { label: "Unique Visitors from Search", value: users, delta: usersD,   metric: 'users' as const },
          ].map((k, i) => {
            const isActive = k.metric === activeGscMetric;
            return (
              <button key={i}
                onClick={() => k.metric && setActiveGscMetric(k.metric)}
                className={`px-4 first:pl-0 text-left transition-colors rounded-lg py-1 ${k.metric ? "cursor-pointer hover:bg-[#f8f9fa]" : "cursor-default"}`}>
                {isActive && <div className="h-[3px] w-full bg-[#137333] rounded-full mb-3"/>}
                {!isActive && k.metric && <div className="h-[3px] w-full bg-transparent mb-3"/>}
                <p className={`text-[13px] mb-1 ${isActive ? "text-[#137333] font-medium" : "text-[#5f6368]"}`}>{k.label}</p>
                <p className="text-[2.25rem] font-normal text-[#202124] leading-none tracking-tight">{fmtBig(k.value)}</p>
                {k.delta !== 0 && (
                  <p className={`text-[13px] mt-1.5 font-normal ${k.delta > 0 ? "text-[#137333]" : "text-[#c5221f]"}`}>
                    {k.delta > 0 ? "↑" : "↓"}{Math.abs(k.delta).toFixed(1)}%
                  </p>
                )}
              </button>
            );
          })}
        </div>
        {/* Chart legend + chart */}
        <div className="px-6 pb-3">
          <div className="flex items-center gap-5 mb-3 text-[12px] text-[#5f6368]">
            <span className="flex items-center gap-1.5">
              <svg width="24" height="3"><line x1="0" y1="1.5" x2="24" y2="1.5" stroke="#137333" strokeWidth="2"/></svg>
              {activeGscMetric === 'clicks' ? 'Clicks' : activeGscMetric === 'impressions' ? 'Impressions' : 'Unique Visitors'}
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#137333" strokeWidth="1.5" strokeDasharray="5 3" strokeOpacity="0.5"/></svg>
              Previous period
            </span>
          </div>
          {/* users มาจาก GA4 daily (GSC ไม่มี unique visitors) — สลับ data source ตาม metric */}
          <SKLineChart data={activeGscMetric === 'users' ? ga4Daily : gscDaily} field={activeGscMetric} color="#137333" />
        </div>
        <div className="px-6 py-3 text-[11px]">
          <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
            Source: Search Console ↗
          </a>
        </div>
      </SKCard>

      {/* ══ CARD 3 — See how your content is doing (queries) ══ */}
      <SKCard>
        <div className="px-6 pt-5 pb-1">
          <p className="text-base font-normal text-[#202124]">See how your content is doing</p>
          <p className="text-[13px] text-[#5f6368] mt-0.5">Keep track of your most popular pages and how people found them from Search</p>
        </div>
        <div className="px-6 pt-4 pb-2">
          <p className="text-[14px] font-semibold text-[#202124] mb-3">Top search queries for your site</p>
          {gsc?.queries && gsc.queries.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e8eaed]">
                  <th className="pb-2 w-8 text-left"/>
                  <th className="pb-2 text-left text-[13px] font-normal text-[#5f6368]"/>
                  <th className="pb-2 text-right text-[13px] font-semibold text-[#202124] w-20">Clicks</th>
                  <th className="pb-2 text-right text-[13px] font-semibold text-[#202124] w-24">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {gsc.queries.slice(0, 10).map((q, i) => (
                  <tr key={i} className="border-b border-[#f1f3f4] last:border-0 hover:bg-[#f8f9fa]">
                    <td className="py-3.5 text-[14px] text-[#5f6368] pr-2">{i + 1}.</td>
                    <td className="py-3.5">
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(q.query)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[14px] text-[#1a73e8] hover:underline">{q.query}</a>
                    </td>
                    <td className="py-3.5 text-[14px] text-right text-[#202124] tabular-nums">{q.clicks.toLocaleString()}</td>
                    <td className="py-3.5 text-[14px] text-right text-[#202124] tabular-nums">{q.impressions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-[#5f6368] py-8 text-center">{gscLoading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</p>
          )}
        </div>
        <div className="px-6 py-3 text-[11px]">
          <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
            Source: Search Console ↗
          </a>
        </div>
      </SKCard>

      {/* ══ CARD 4 — Top content ══ */}
      <SKCard>
        <div className="px-6 pt-5 pb-4">
          <p className="text-base font-normal text-[#202124]">Top content over the last {days} days</p>
        </div>
        {ga4?.pages && ga4.pages.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e8eaed]">
                <th className="px-6 pb-2 w-8 text-left"/>
                <th className="pb-2 text-left text-[13px] font-semibold text-[#5f6368]">Title</th>
                <th className="px-3 pb-2 text-right text-[13px] font-semibold text-[#5f6368] w-24">Pageviews</th>
                <th className="px-3 pb-2 text-right text-[13px] font-semibold text-[#5f6368] w-20">Sessions</th>
                <th className="px-3 pb-2 text-right text-[13px] font-semibold text-[#5f6368] w-28">Engagement Rate</th>
                <th className="px-6 pb-2 text-right text-[13px] font-semibold text-[#5f6368] w-28">Session Duration</th>
              </tr>
            </thead>
            <tbody>
              {ga4.pages.slice(0, 10).map((p, i) => {
                const parts = p.path.replace(/\/$/, '').split('/').filter(Boolean);
                const title = parts[parts.length - 1] ?? p.path;
                const dur = (p as {sessionDuration?:number}).sessionDuration ?? 0;
                return (
                  <tr key={i} className="border-b border-[#f1f3f4] last:border-0 hover:bg-[#f8f9fa]">
                    <td className="pl-6 py-3.5 text-[14px] text-[#5f6368] pr-2">{i + 1}.</td>
                    <td className="py-3.5 pr-3 min-w-0">
                      <a href={`${project.website}${p.path}`} target="_blank" rel="noopener noreferrer"
                        className="text-[14px] text-[#1a73e8] hover:underline block truncate max-w-xs leading-snug">
                        {title}
                      </a>
                      <span className="text-[11px] text-[#5f6368] block truncate max-w-xs">{p.path}</span>
                    </td>
                    <td className="py-3.5 px-3 text-[14px] text-right text-[#202124] tabular-nums">{p.views.toLocaleString()}</td>
                    <td className="py-3.5 px-3 text-[14px] text-right text-[#202124] tabular-nums">{p.sessions.toLocaleString()}</td>
                    <td className="py-3.5 px-3 text-[14px] text-right text-[#202124] tabular-nums">{p.engagementRate ? `${p.engagementRate}%` : "—"}</td>
                    <td className="pr-6 py-3.5 text-[14px] text-right text-[#202124] tabular-nums">{dur ? fmtDuration(dur) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[#5f6368] py-8 text-center px-6">{ga4Loading ? "กำลังโหลด..." : "ยังไม่มีข้อมูลหน้าเว็บ"}</p>
        )}
        <div className="px-6 py-3 text-[11px]">
          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
            Source: Analytics ↗
          </a>
        </div>
      </SKCard>

      {/* ══ CARD 5 — PageSpeed ══ */}
      <SKCard>
        <div className="px-6 pt-5 pb-4">
          <p className="text-base font-normal text-[#202124]">Find out how visitors experience your site</p>
          <p className="text-sm text-[#5f6368] mt-0.5">Keep track of how fast your pages are and get specific recommendations on what to improve</p>
        </div>
        {psiLoading ? (
          <div className="px-6 py-10 flex items-center gap-2 text-sm text-[#5f6368]">
            <RefreshCw size={13} className="animate-spin"/> กำลังโหลด PageSpeed...
          </div>
        ) : (mPsi?.status === "ok" || dPsi?.status === "ok") ? (
          <div>
            {/* Tab bar + device pill toggle */}
            <div className="px-6 flex items-center border-b border-[#e8eaed]">
              <div className="flex flex-1">
                {([
                  { key: 'lab',     label: 'In the Lab' },
                  { key: 'field',   label: 'In the Field' },
                  { key: 'improve', label: 'How to improve' },
                ] as const).map(t => (
                  <button key={t.key} onClick={() => setPsiTab(t.key)}
                    className={`py-3 mr-6 text-[14px] border-b-2 transition-colors ${
                      psiTab === t.key ? "border-[#137333] text-[#202124] font-medium" : "border-transparent text-[#5f6368] hover:text-[#202124]"
                    }`}>{t.label}
                  </button>
                ))}
              </div>
              {/* Device pill toggle — matches Site Kit screenshot exactly */}
              <div className="flex items-center shrink-0 mb-1">
                <div className="flex rounded-full bg-[#f1f3f4] p-0.5">
                  <button onClick={() => setPsiMode("mobile")} title="Mobile"
                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${psiMode === "mobile" ? "bg-[#137333] text-white shadow-sm" : "text-[#5f6368] hover:text-[#202124]"}`}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>
                  </button>
                  <button onClick={() => setPsiMode("desktop")} title="Desktop"
                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${psiMode === "desktop" ? "bg-[#137333] text-white shadow-sm" : "text-[#5f6368] hover:text-[#202124]"}`}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 3H4v10h16V3zm0 12H4v2h16v-2zM8 19h8v2H8v-2z"/></svg>
                  </button>
                </div>
              </div>
            </div>

            {/* ── In the Lab ── */}
            {psiTab === 'lab' && (
              curPsi?.status === "ok" ? (
                <div className="px-6 py-6">
                  <p className="text-[13px] text-[#5f6368] mb-6">
                    Lab data is a snapshot of how your page performs right now, measured in tests we run in a controlled environment.{" "}
                    <a href="https://web.dev/lab-and-field-data-differences/" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">Learn more ↗</a>
                  </p>
                  <div className="space-y-7">
                    {labVitals.map(v => {
                      const grade = v.val === null ? "—" : v.val <= v.good ? "Good" : v.val <= v.bad ? "Needs Improvement" : "Poor";
                      const gc = v.val === null ? "#5f6368" : v.val <= v.good ? "#137333" : v.val <= v.bad ? "#e37400" : "#c5221f";
                      return (
                        <div key={v.label} className="flex items-start justify-between gap-8">
                          <div>
                            <p className="text-[15px] font-semibold text-[#202124]">{v.label}</p>
                            <p className="text-[13px] text-[#5f6368] mt-0.5">{v.desc}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[15px] font-semibold tabular-nums" style={{ color: gc }}>{v.display ?? "N/A"}</p>
                            <p className="text-[13px] font-medium" style={{ color: gc }}>{grade}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setPsiTab('improve')}
                    className="mt-7 px-6 py-2.5 bg-[#1a5e36] text-white text-[14px] font-medium rounded-full hover:bg-[#14492a] transition-colors">
                    How to improve
                  </button>
                  <div className="mt-4 flex items-center justify-between text-[12px] text-[#5f6368]">
                    <span className="underline cursor-pointer hover:text-[#202124]">Run test again</span>
                    <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}&strategy=${psiMode}`}
                      target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] underline">
                      View details at PageSpeed Insights ↗
                    </a>
                  </div>
                </div>
              ) : <p className="px-6 py-8 text-[14px] text-[#5f6368] text-center">ยังไม่มีข้อมูล Lab สำหรับ {psiMode}</p>
            )}

            {/* ── In the Field ── */}
            {psiTab === 'field' && (
              curPsi?.status === "ok" ? (
                <div className="px-6 py-6">
                  <p className="text-[13px] text-[#5f6368] mb-6">
                    Field data shows how real users actually loaded and interacted with your page over time.{" "}
                    <a href="https://web.dev/lab-and-field-data-differences/" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">Learn more ↗</a>
                  </p>
                  <div className="space-y-7">
                    {fieldVitals.map((v, vi) => {
                      const grade = v.val === null ? "—" : v.val <= v.good ? "Good" : v.val <= v.bad ? "Needs Improvement" : "Poor";
                      const gc = v.val === null ? "#5f6368" : v.val <= v.good ? "#137333" : v.val <= v.bad ? "#e37400" : "#c5221f";
                      return (
                        <div key={v.label}>
                          <div className="flex items-start justify-between gap-8">
                            <div>
                              <p className="text-[15px] font-semibold text-[#202124]">{v.label}</p>
                              <p className="text-[13px] text-[#5f6368] mt-0.5">{v.desc}</p>
                              {vi === 2 && (
                                <p className="text-[12px] text-[#5f6368] mt-1">
                                  INP is a new Core Web Vital that replaced FID in March 2024.{" "}
                                  <a href="https://web.dev/inp/" target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">Learn more ↗</a>
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[15px] font-semibold tabular-nums" style={{ color: gc }}>{v.display ?? "N/A"}</p>
                              <p className="text-[13px] font-medium" style={{ color: gc }}>{grade}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-6 flex items-center justify-end text-[12px]">
                    <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}&strategy=${psiMode}`}
                      target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] underline">
                      View details at PageSpeed Insights ↗
                    </a>
                  </div>
                </div>
              ) : <p className="px-6 py-8 text-[14px] text-[#5f6368] text-center">ยังไม่มีข้อมูล Field สำหรับ {psiMode}</p>
            )}

            {/* ── How to improve ── */}
            {psiTab === 'improve' && (
              <div className="px-6 py-6">
                {curPsi?.opportunities && curPsi.opportunities.length > 0 ? (
                  <div>
                    <p className="text-[13px] text-[#5f6368] mb-4">Opportunities to improve page performance ({psiMode}):</p>
                    {curPsi.opportunities.map((o, i) => (
                      <div key={i} className="flex items-center justify-between py-3.5 border-b border-[#f1f3f4] last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full bg-[#e37400] shrink-0"/>
                          <p className="text-[14px] text-[#202124]">
                            {o.type.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </p>
                        </div>
                        {o.savings && <span className="text-[13px] text-[#137333] font-medium shrink-0">{o.savings}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-[14px] text-[#137333] font-medium">ไม่พบจุดที่ต้องปรับปรุงสำหรับ {psiMode}</p>
                    <p className="text-[13px] text-[#5f6368] mt-2">หน้าเว็บทำงานได้ดีอยู่แล้ว</p>
                  </div>
                )}
                <div className="mt-5 flex items-center justify-end text-[12px]">
                  <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}&strategy=${psiMode}`}
                    target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] underline">
                    View full report at PageSpeed Insights ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="px-6 py-10 text-[14px] text-[#5f6368] text-center">ยังไม่มีข้อมูล PageSpeed</p>
        )}
        <div className="px-6 py-3 text-[11px]">
          <a href={`https://pagespeed.web.dev/report?url=${encodeURIComponent(project.website)}`}
            target="_blank" rel="noopener noreferrer" className="text-[#1a73e8] hover:underline">
            Source: PageSpeed Insights ↗
          </a>
        </div>
      </SKCard>
    </div>
  );
}

type ReportMode = "dashboard" | "seo-performance" | "simple";

export function ClientReportClient({ project, isClient = false }: { project: Project; isClient?: boolean }) {
  const [days, setDays]               = useState(28);
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

  // GA4 property picker state
  const [ga4PropertyId, setGa4PropertyId] = useState<string>(project.ga4PropertyId ?? "");
  const [ga4Properties, setGa4Properties] = useState<{ propertyId: string; displayName: string; accountName: string }[]>([]);
  const [ga4PropLoading, setGa4PropLoading] = useState(false);
  const [ga4PropSaving, setGa4PropSaving] = useState(false);

  const fetchGA4Properties = useCallback(async () => {
    setGa4PropLoading(true);
    try {
      const r = await fetch("/api/report/ga4-properties");
      const d = await r.json() as { properties?: { propertyId: string; displayName: string; accountName: string }[]; error?: string };
      if (d.properties) setGa4Properties(d.properties);
    } catch { /* skip */ } finally { setGa4PropLoading(false); }
  }, []);

  const saveGA4PropertyId = useCallback(async (id: string) => {
    setGa4PropSaving(true);
    try {
      await fetch(`/api/projects/${project.id}/style`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ga4PropertyId: id }),
      });
    } catch { /* skip */ } finally { setGa4PropSaving(false); }
  }, [project.id]);

  useEffect(() => {
    // CLIENT role: never allow linking new properties — only show what's already connected
    if (isClient) return;
    if (!project.ga4PropertyId) fetchGA4Properties();
  }, [project.ga4PropertyId, fetchGA4Properties, isClient]);

  const fetchGSC = useCallback(async () => {
    if (!project.gscSiteUrl) return;
    setGscLoading(true); setGscError(null);
    try {
      const [gscRes, aiRes] = await Promise.allSettled([
        fetch("/api/report/gsc", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: project.gscSiteUrl, days }),
        }).then(r => r.json()),
        fetch("/api/report/gsc-ai", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteUrl: project.gscSiteUrl, days }),
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
        body: JSON.stringify({ siteUrl: project.gscSiteUrl, days }),
      });
      const d = await r.json();
      if (!d.error) setGscInsights(d);
    } catch { /* non-fatal */ }
    finally { setGscInsLoading(false); }
  }, [project.gscSiteUrl, days]);

  const fetchGA4 = useCallback(async (overrideId?: string) => {
    const pid = overrideId ?? ga4PropertyId;
    if (!pid) return;
    setGa4Loading(true); setGa4Error(null);
    try {
      const r = await fetch("/api/report/ga4", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: pid, days }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setGa4Data(d);
    } catch (e) { setGa4Error(e instanceof Error ? e.message : "Error"); }
    finally { setGa4Loading(false); }
  }, [ga4PropertyId, days]);

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
      setPsiData(d);
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
    const gscIns  = gsc  ? deriveGSCInsights(gsc  as unknown as GSCData)  : [];
    const ga4Ins  = ga4  ? deriveGA4Insights(ga4  as unknown as GA4Data)  : [];
    const convIns = ga4  ? deriveConversionInsights(ga4 as unknown as GA4Data) : [];
    const psiIns  = psi  ? derivePSIInsights(psi  as unknown as PSIData)  : [];
    const connIns = deriveConnectedInsights(gsc as unknown as GSCData | null, ga4 as unknown as GA4Data | null, psi as unknown as PSIData | null);
    const aiIns   = gscAiData ? deriveAIInsights(gscAiData) : [];
    return {
      gsc:  gscIns,
      ga4:  [...ga4Ins, ...convIns],
      psi:  psiIns,
      ai:   aiIns,
      conn: connIns,
    };
  }, [gsc, ga4, psi, gscAiData]);

  return (
    <div className={`space-y-5 ${reportMode === "simple" || isClient ? "w-full" : "max-w-5xl"}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {!isClient && (
            <Link href="/report" className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <ArrowLeft size={16} />
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
            <a href={project.website} target="_blank" rel="noopener" className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-0.5">
              <ExternalLink size={9} />{project.website}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[7, 28, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${days === d ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {d} วัน
            </button>
          ))}
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
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "simple" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <FileText size={12} /> Simple Report
          </button>
          <button onClick={() => setReportMode("dashboard")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "dashboard" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <BarChart3 size={12} /> Dashboard
          </button>
          <button onClick={() => setReportMode("seo-performance")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${reportMode === "seo-performance" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <FileBarChart2 size={12} /> SEO Performance Report
          </button>
        </div>
      )}

      {/* Status badges + GA4 picker */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* GSC badge — read-only always */}
        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${project.gscSiteUrl ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
          {project.gscSiteUrl ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          GSC{project.gscSiteUrl ? "" : " — ยังไม่เชื่อมต่อ"}
        </span>

        {/* GA4 badge — CLIENT sees read-only status, admin sees picker if not set */}
        {ga4PropertyId ? (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={11} />
            GA4 ({ga4PropertyId})
          </span>
        ) : isClient ? (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
            <AlertCircle size={11} /> GA4 — ยังไม่เชื่อมต่อ
          </span>
        ) : ga4PropLoading ? (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
            <RefreshCw size={11} className="animate-spin" /> กำลังโหลด GA4...
          </span>
        ) : ga4Properties.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              <AlertCircle size={11} /> GA4 — เลือก Property:
            </span>
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
              value=""
              onChange={async e => {
                const id = e.target.value;
                if (!id) return;
                setGa4PropertyId(id);
                await saveGA4PropertyId(id);
                fetchGA4(id);
              }}>
              <option value="">— เลือก —</option>
              {ga4Properties.map(p => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
            </select>
            {ga4PropSaving && <RefreshCw size={11} className="animate-spin text-gray-400" />}
          </div>
        ) : (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
            <AlertCircle size={11} /> GA4 — ยังไม่ผูก
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
                        <span className="text-gray-900 font-semibold w-14 text-right">{p.clicks.toLocaleString()}</span>
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
                        <span className="text-gray-900 font-semibold w-14 text-right">{q.clicks.toLocaleString()}</span>
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
                          <span className="text-gray-900 font-semibold w-14 text-right">{c.sessions.toLocaleString()}</span>
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
                        <span className="text-gray-900 font-semibold w-14 text-right">{p.views.toLocaleString()} views</span>
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
          <Link href={`/projects/${project.id}?tab=settings`} className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1 mt-1">
            <ExternalLink size={10} /> ไปที่ Project Settings
          </Link>
        </div>
      )}
    </div>
  );
}
