"use client";

// SEO Performance Report Skill — Report only. No tasks, no workflow handoff.

import { useMemo } from "react";
import {
  TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2,
  Lightbulb, BarChart3, Globe, Zap, Link2, FileText,
  ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { useState } from "react";
import type {
  GSCData, GA4Data, PSIData, GscAiData, SEOInsight, ExecutiveSummary, RecommendationGroup,
} from "@/lib/report/seo-insights";
import {
  deriveGSCInsights, deriveGA4Insights, deriveConversionInsights,
  derivePSIInsights, deriveConnectedInsights, deriveAIInsights,
  buildExecutiveSummary, buildRecommendations,
} from "@/lib/report/seo-insights";

// ─── Sub-components (report-only) ─────────────────────────────────────────────

function Collapsible({ title, icon, children, defaultOpen = true, badge }:
  { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; badge?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-2.5 font-semibold text-gray-900 text-sm">
          {icon}{title}
          {badge && <span className="ml-1 px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] rounded-full font-normal">{badge}</span>}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-400 shrink-0" /> : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function InsightCard({ insight }: { insight: SEOInsight }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = {
    strength:    { bg: "bg-emerald-50",  border: "border-emerald-200", icon: <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />, label: "Strength",    dot: "bg-emerald-400" },
    opportunity: { bg: "bg-blue-50",     border: "border-blue-200",    icon: <Lightbulb size={13} className="text-blue-600 shrink-0" />,       label: "Opportunity", dot: "bg-blue-400" },
    warning:     { bg: "bg-amber-50",    border: "border-amber-200",   icon: <AlertCircle size={13} className="text-amber-600 shrink-0" />,    label: "Warning",     dot: "bg-amber-400" },
    risk:        { bg: "bg-red-50",      border: "border-red-200",     icon: <AlertCircle size={13} className="text-red-600 shrink-0" />,      label: "Risk",        dot: "bg-red-400" },
  }[insight.type];

  return (
    <div className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          {cfg.icon}
          <div className="flex-1">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mr-2 ${cfg.bg}`} style={{ color: "inherit" }}>{cfg.label}</span>
            <p className="text-sm font-semibold text-gray-900 inline">{insight.title}</p>
            <p className="text-xs text-gray-600 mt-1">{insight.finding}</p>
            {expanded && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-gray-700"><b>Business Impact:</b> {insight.impact}</p>
                <p className="text-xs text-gray-700"><b>Recommendation:</b> {insight.recommendation}</p>
              </div>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-700 shrink-0">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, delta, suffix = "", inverse = false }:
  { label: string; value: string | number; delta?: number; suffix?: string; inverse?: boolean }) {
  const n = typeof delta === "number" ? delta : 0;
  const good = inverse ? n < 0 : n > 0;
  const neutral = n === 0 || delta === undefined;
  return (
    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
      <p className="text-[10px] text-gray-500 font-medium mb-1">{label}</p>
      <p className="text-xl font-black text-gray-900">{typeof value === "number" ? value.toLocaleString() : value}{suffix}</p>
      {delta !== undefined && (
        <div className={`flex items-center gap-0.5 text-[10px] mt-1 font-semibold ${neutral ? "text-gray-400" : good ? "text-emerald-600" : "text-red-500"}`}>
          {neutral ? <Minus size={9} /> : good ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {Math.abs(n)}{suffix === "%" ? "" : "%"} vs prev
        </div>
      )}
    </div>
  );
}

function MissingDataNotice({ source, message }: { source: string; message?: string }) {
  return (
    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500">
      <Info size={13} className="shrink-0" />
      <span><b>{source}</b> — {message ?? "Data not available for this period."}</span>
    </div>
  );
}

function DataRow({ rank, label, cols }: { rank?: number; label: string; cols: (string | number)[] }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
      {rank !== undefined && <span className="text-gray-400 w-4 shrink-0 text-right">{rank}</span>}
      <span className="flex-1 text-gray-700 truncate" title={label}>{label}</span>
      {cols.map((c, i) => (
        <span key={i} className="text-gray-600 font-medium shrink-0 text-right" style={{ minWidth: "4rem" }}>
          {typeof c === "number" ? c.toLocaleString() : c}
        </span>
      ))}
    </div>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const color = score === null ? "text-gray-300"
    : score >= 90 ? "text-emerald-600"
    : score >= 50 ? "text-amber-500"
    : "text-red-500";
  const bg = score === null ? "bg-gray-50"
    : score >= 90 ? "bg-emerald-50"
    : score >= 50 ? "bg-amber-50"
    : "bg-red-50";
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl p-3 ${bg} min-w-[70px]`}>
      <span className={`text-2xl font-black ${color}`}>{score ?? "—"}</span>
      <span className="text-[10px] text-gray-500 mt-0.5 text-center leading-tight">{label}</span>
    </div>
  );
}

function VitalBadge({ label, display, value, good, bad }:
  { label: string; display: string; value: number | null; good: number; bad: number }) {
  const color = value === null ? "bg-gray-100 text-gray-500"
    : value <= good ? "bg-emerald-100 text-emerald-700"
    : value <= bad  ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";
  return (
    <div className={`rounded-xl px-2.5 py-2 text-center ${color}`}>
      <div className="text-[9px] font-bold opacity-60">{label}</div>
      <div className="text-xs font-bold mt-0.5">{display}</div>
    </div>
  );
}

// ─── Section: Executive Summary ───────────────────────────────────────────────
function ExecutiveSummarySection({ summary }: { summary: ExecutiveSummary }) {
  const dirCfg = {
    growth:  { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", icon: <TrendingUp size={16} className="text-emerald-600" /> },
    stable:  { bg: "bg-blue-50 border-blue-200",       text: "text-blue-800",    icon: <Minus size={16} className="text-blue-600" /> },
    decline: { bg: "bg-red-50 border-red-200",         text: "text-red-800",     icon: <TrendingDown size={16} className="text-red-600" /> },
    mixed:   { bg: "bg-amber-50 border-amber-200",     text: "text-amber-800",   icon: <Info size={16} className="text-amber-600" /> },
  }[summary.direction];

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${dirCfg.bg}`}>
      <div className="flex items-center gap-2">
        {dirCfg.icon}
        <p className={`font-bold text-base ${dirCfg.text}`}>{summary.headline}</p>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">{summary.summary}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.mainStrengths.length > 0 && (
          <div className="bg-white/70 rounded-xl p-3">
            <p className="text-[10px] font-bold text-emerald-700 mb-2 uppercase tracking-wide">Strengths</p>
            <ul className="space-y-1">
              {summary.mainStrengths.map((s, i) => (
                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                  <CheckCircle2 size={10} className="text-emerald-500 mt-0.5 shrink-0" />{s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.mainOpportunities.length > 0 && (
          <div className="bg-white/70 rounded-xl p-3">
            <p className="text-[10px] font-bold text-blue-700 mb-2 uppercase tracking-wide">Opportunities</p>
            <ul className="space-y-1">
              {summary.mainOpportunities.map((o, i) => (
                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                  <Lightbulb size={10} className="text-blue-500 mt-0.5 shrink-0" />{o}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.mainRisks.length > 0 && (
          <div className="bg-white/70 rounded-xl p-3">
            <p className="text-[10px] font-bold text-red-700 mb-2 uppercase tracking-wide">Risks & Warnings</p>
            <ul className="space-y-1">
              {summary.mainRisks.map((r, i) => (
                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                  <AlertCircle size={10} className="text-red-500 mt-0.5 shrink-0" />{r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section: Recommendations ─────────────────────────────────────────────────
function RecommendationsSection({ groups }: { groups: RecommendationGroup[] }) {
  if (groups.length === 0) return <MissingDataNotice source="Recommendations" message="Not enough data to generate recommendations yet." />;
  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <div key={i}>
          <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">{g.area}</p>
          <ul className="space-y-2">
            {g.items.map((rec, j) => (
              <li key={j} className="flex gap-2 text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
                <span className="shrink-0 w-4 h-4 rounded-full bg-gray-300 text-white text-[9px] flex items-center justify-center font-bold mt-0.5">{j + 1}</span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Main SEOPerformanceReport ─────────────────────────────────────────────────
interface Props {
  projectName: string;
  gsc:  GSCData  | null;
  ga4:  GA4Data  | null;
  psi:  PSIData  | null;
  gscAi: GscAiData | null;
  gscError:  string | null;
  ga4Error:  string | null;
  psiError:  string | null;
  gscLoading:  boolean;
  ga4Loading:  boolean;
  psiLoading:  boolean;
  period: { days: number };
}

export function SEOPerformanceReport({
  projectName, gsc, ga4, psi, gscAi,
  gscError, ga4Error, psiError,
  gscLoading, ga4Loading, psiLoading,
  period,
}: Props) {
  const isLoading = gscLoading || ga4Loading || psiLoading;

  const { allInsights, execSummary, recommendations } = useMemo(() => {
    const gscIns  = gsc ? deriveGSCInsights(gsc)  : [];
    const ga4Ins  = ga4 ? deriveGA4Insights(ga4)   : [];
    const convIns = ga4 ? deriveConversionInsights(ga4) : [];
    const psiIns  = psi ? derivePSIInsights(psi)   : [];
    const connIns = deriveConnectedInsights(gsc, ga4, psi);
    const aiIns   = gscAi ? deriveAIInsights(gscAi) : [];

    const all = [...gscIns, ...ga4Ins, ...convIns, ...psiIns, ...connIns, ...aiIns];
    return {
      allInsights:     all,
      execSummary:     buildExecutiveSummary(gsc, ga4, psi, all),
      recommendations: buildRecommendations(all),
    };
  }, [gsc, ga4, psi, gscAi]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
        <p className="text-xs text-center text-gray-400">Fetching data and generating report…</p>
      </div>
    );
  }

  const hasAnyData = gsc || ga4 || psi;
  if (!hasAnyData) {
    return (
      <div className="space-y-3">
        {gscError && <MissingDataNotice source="Google Search Console" message={gscError} />}
        {ga4Error && <MissingDataNotice source="GA4" message={ga4Error} />}
        {psiError && <MissingDataNotice source="PageSpeed" message={psiError} />}
        {!gscError && !ga4Error && !psiError && (
          <MissingDataNotice source="Report" message="No data sources connected. Please add GSC Site URL and GA4 Property ID to the project settings." />
        )}
      </div>
    );
  }

  const gscInsights  = allInsights.filter(i => i.area === "gsc");
  const ga4Insights  = allInsights.filter(i => i.area === "ga4");
  const convInsights = allInsights.filter(i => i.area === "conversion");
  const psiInsights  = allInsights.filter(i => i.area === "pagespeed");
  const connInsights = allInsights.filter(i => i.area === "connected");
  const aiInsights   = allInsights.filter(i => i.area === "ai");

  const organic = ga4?.channels.find(c => c.channel.toLowerCase().includes("organic"));
  const convEvents = ga4?.events.filter(e => e.isConversion) ?? [];
  const mobileOk = psi?.mobile?.status === "ok";
  const desktopOk = psi?.desktop?.status === "ok";

  return (
    <div className="space-y-4">

      {/* Report header */}
      <div className="bg-gray-900 rounded-2xl px-5 py-4 text-white">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={14} className="text-gray-400" />
          <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">SEO Performance Report</span>
        </div>
        <p className="font-bold text-lg">{projectName}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Period: last {period.days} days
          {gsc?.period && ` · ${gsc.period.start} → ${gsc.period.end}`}
        </p>
      </div>

      {/* 1. Executive Summary */}
      <Collapsible title="Executive Summary" icon={<FileText size={14} />} defaultOpen badge="Overview">
        <ExecutiveSummarySection summary={execSummary} />
      </Collapsible>

      {/* 2. Search Visibility */}
      <Collapsible title="Search Visibility" icon={<Globe size={14} />} defaultOpen badge="GSC">
        {!gsc && (gscError
          ? <MissingDataNotice source="Google Search Console" message={gscError} />
          : <MissingDataNotice source="Google Search Console" message="GSC Site URL not configured for this project." />
        )}
        {gsc && (
          <div className="space-y-5">
            {/* Overview metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Clicks"        value={gsc.overview.clicks}      delta={gsc.overview.clicksDelta} />
              <MetricCard label="Impressions"   value={gsc.overview.impressions} delta={gsc.overview.impressionsDelta} />
              <MetricCard label="CTR"           value={`${gsc.overview.ctr}%`}   delta={gsc.overview.ctrDelta} />
              <MetricCard label="Avg. Position" value={`#${gsc.overview.position}`} delta={gsc.overview.positionDelta} inverse />
            </div>

            {/* GSC Insights */}
            {gscInsights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Analysis</p>
                {gscInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}

            {/* Top Keywords */}
            {gsc.queries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Top Keywords</p>
                <div className="text-[10px] text-gray-400 flex gap-2 pb-1 border-b border-gray-100 mb-1">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1">Keyword</span>
                  <span className="w-16 text-right">Clicks</span>
                  <span className="w-16 text-right">Impr.</span>
                  <span className="w-12 text-right">CTR</span>
                  <span className="w-12 text-right">Position</span>
                </div>
                {gsc.queries.slice(0, 15).map((q, i) => (
                  <DataRow key={i} rank={i + 1} label={q.query}
                    cols={[q.clicks.toLocaleString(), q.impressions.toLocaleString(), `${q.ctr}%`, `#${q.position}`]} />
                ))}
              </div>
            )}

            {/* Top Pages */}
            {gsc.pages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Top Landing Pages</p>
                <div className="text-[10px] text-gray-400 flex gap-2 pb-1 border-b border-gray-100 mb-1">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1">Page</span>
                  <span className="w-16 text-right">Clicks</span>
                  <span className="w-16 text-right">Impr.</span>
                  <span className="w-12 text-right">CTR</span>
                  <span className="w-12 text-right">Pos.</span>
                </div>
                {gsc.pages.slice(0, 15).map((p, i) => (
                  <DataRow key={i} rank={i + 1} label={p.page}
                    cols={[p.clicks.toLocaleString(), p.impressions.toLocaleString(), `${p.ctr}%`, `#${p.position}`]} />
                ))}
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {/* 3. AI Search Performance */}
      <Collapsible title="AI Search Performance" icon={<Zap size={14} className="text-blue-500" />} defaultOpen badge="GSC AI Beta">
        {!gscAi ? (
          <MissingDataNotice source="AI Performance" message="กด Refresh เพื่อโหลดข้อมูล AI Performance จาก GSC" />
        ) : !gscAi.available ? (
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-5 flex gap-3 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Zap size={14} className="text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800 mb-1">Account นี้ยังไม่มีข้อมูล AI Performance</p>
              <p className="text-xs text-blue-600 leading-relaxed">
                Google Search Console กำลัง rollout ฟีเจอร์ <strong>AI Overviews</strong> และ <strong>AI Mode</strong> Report แบบ Beta
                — หากเว็บไซต์มี traffic จาก AI-generated results จะเริ่มเห็นข้อมูลในส่วนนี้โดยอัตโนมัติ
              </p>
              {aiInsights.length > 0 && (
                <div className="mt-4 space-y-2">
                  {aiInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* AI Overview metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {gscAi.aiOverviews && (
                <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                      <Zap size={10} className="text-white" />
                    </div>
                    <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">AI Overviews</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-semibold">Beta</span>
                  </div>
                  <p className="text-[10px] text-blue-400 mb-3">Google-generated summaries at the top of search results</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Impressions</p>
                      <p className="text-xl font-black text-slate-900">{gscAi.aiOverviews.impressions.toLocaleString()}</p>
                      {gscAi.aiOverviews.impressionsDelta !== 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${gscAi.aiOverviews.impressionsDelta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {gscAi.aiOverviews.impressionsDelta > 0 ? "▲" : "▼"} {Math.abs(gscAi.aiOverviews.impressionsDelta)}% vs prev
                        </p>
                      )}
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Clicks</p>
                      <p className="text-xl font-black text-slate-900">{gscAi.aiOverviews.clicks.toLocaleString()}</p>
                      {gscAi.aiOverviews.clicksDelta !== 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${gscAi.aiOverviews.clicksDelta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {gscAi.aiOverviews.clicksDelta > 0 ? "▲" : "▼"} {Math.abs(gscAi.aiOverviews.clicksDelta)}% vs prev
                        </p>
                      )}
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">CTR</p>
                      <p className="text-base font-bold text-slate-700">{gscAi.aiOverviews.ctr.toFixed(1)}%</p>
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Avg Position</p>
                      <p className="text-base font-bold text-slate-700">#{gscAi.aiOverviews.position.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              )}
              {gscAi.aiMode && (
                <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                      <BarChart3 size={10} className="text-white" />
                    </div>
                    <span className="text-xs font-bold text-violet-900 uppercase tracking-wide">AI Mode</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold">Beta</span>
                  </div>
                  <p className="text-[10px] text-violet-400 mb-3">Conversational AI experience in Search</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Impressions</p>
                      <p className="text-xl font-black text-slate-900">{gscAi.aiMode.impressions.toLocaleString()}</p>
                      {gscAi.aiMode.impressionsDelta !== 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${gscAi.aiMode.impressionsDelta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {gscAi.aiMode.impressionsDelta > 0 ? "▲" : "▼"} {Math.abs(gscAi.aiMode.impressionsDelta)}% vs prev
                        </p>
                      )}
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Clicks</p>
                      <p className="text-xl font-black text-slate-900">{gscAi.aiMode.clicks.toLocaleString()}</p>
                      {gscAi.aiMode.clicksDelta !== 0 && (
                        <p className={`text-[10px] font-semibold mt-0.5 ${gscAi.aiMode.clicksDelta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {gscAi.aiMode.clicksDelta > 0 ? "▲" : "▼"} {Math.abs(gscAi.aiMode.clicksDelta)}% vs prev
                        </p>
                      )}
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">CTR</p>
                      <p className="text-base font-bold text-slate-700">{gscAi.aiMode.ctr.toFixed(1)}%</p>
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5">
                      <p className="text-[10px] text-gray-500 mb-0.5">Avg Position</p>
                      <p className="text-base font-bold text-slate-700">#{gscAi.aiMode.position.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* AI Insights */}
            {aiInsights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">AI Search Analysis</p>
                {aiInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {/* 4. Organic Traffic & Engagement */}
      <Collapsible title="Organic Traffic & Engagement" icon={<BarChart3 size={14} />} defaultOpen badge="GA4">
        {!ga4 && (ga4Error
          ? <MissingDataNotice source="GA4" message={ga4Error} />
          : <MissingDataNotice source="GA4" message="GA4 Property ID not configured for this project." />
        )}
        {ga4 && (
          <div className="space-y-5">
            {/* Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Sessions"    value={ga4.overview.sessions}    delta={ga4.overview.sessionsDelta} />
              <MetricCard label="Users"       value={ga4.overview.users}       delta={ga4.overview.usersDelta} />
              <MetricCard label="Eng. Rate"   value={`${ga4.overview.engagementRate}%`} />
              <MetricCard label="Conversions" value={ga4.overview.conversions} delta={ga4.overview.conversionsDelta} />
            </div>

            {/* GA4 Insights */}
            {ga4Insights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Analysis</p>
                {ga4Insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}

            {/* Organic channel highlight */}
            {organic && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm">
                <p className="font-semibold text-blue-800 mb-1">Organic Search Channel</p>
                <div className="flex gap-6 text-xs text-blue-700">
                  <span><b>{organic.sessions.toLocaleString()}</b> sessions</span>
                  <span><b>{organic.conversions}</b> conversions</span>
                  {organic.revenue > 0 && <span><b>฿{organic.revenue.toLocaleString()}</b> revenue</span>}
                </div>
              </div>
            )}

            {/* Channel breakdown */}
            {ga4.channels.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Traffic Channels</p>
                {ga4.channels.map((c, i) => {
                  const total = ga4.channels.reduce((s, r) => s + r.sessions, 0);
                  const pct = total > 0 ? Math.round(c.sessions / total * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs py-1.5">
                      <span className="w-28 text-gray-700 truncate shrink-0">{c.channel}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-gray-900 font-semibold w-16 text-right">{c.sessions.toLocaleString()}</span>
                      <span className="text-gray-400 w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top pages */}
            {ga4.pages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Top Landing Pages</p>
                <div className="text-[10px] text-gray-400 flex gap-2 pb-1 border-b border-gray-100 mb-1">
                  <span className="w-4 shrink-0" />
                  <span className="flex-1">Page</span>
                  <span className="w-16 text-right">Views</span>
                  <span className="w-16 text-right">Eng.Rate</span>
                </div>
                {ga4.pages.slice(0, 15).map((p, i) => (
                  <DataRow key={i} rank={i + 1} label={p.path}
                    cols={[p.views.toLocaleString(), `${p.engagementRate}%`]} />
                ))}
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {/* 4. Conversion Performance */}
      <Collapsible title="Conversion Performance" icon={<TrendingUp size={14} />} defaultOpen badge="GA4 Events">
        {!ga4 && (ga4Error
          ? <MissingDataNotice source="GA4 Conversion" message={ga4Error} />
          : <MissingDataNotice source="GA4 Conversion" message="GA4 not connected." />
        )}
        {ga4 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MetricCard label="Total Conversions" value={ga4.overview.conversions} delta={ga4.overview.conversionsDelta} />
              <MetricCard label="Revenue"           value={`฿${ga4.overview.revenue.toLocaleString()}`} delta={ga4.overview.revenueDelta} />
              <MetricCard label="Conv. Rate"
                value={ga4.overview.sessions > 0 ? `${(ga4.overview.conversions / ga4.overview.sessions * 100).toFixed(2)}%` : "0%"} />
            </div>

            {convInsights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Analysis</p>
                {convInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}

            {convEvents.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Conversion Events</p>
                <div className="space-y-2">
                  {convEvents.sort((a, b) => b.conversions - a.conversions).map((ev, i) => (
                    <div key={i} className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        <span className="font-semibold text-emerald-800">{ev.event}</span>
                      </div>
                      <span className="text-emerald-700 font-bold">{ev.conversions.toLocaleString()} conversions</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <MissingDataNotice source="Conversion Events" message="No conversion events marked in GA4 for this period. Set up key events in GA4 to track conversions." />
            )}

            {/* Device breakdown */}
            {ga4.devices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">Conversions by Device</p>
                <div className="flex gap-3 flex-wrap">
                  {ga4.devices.map((d, i) => (
                    <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-center">
                      <p className="text-[10px] text-gray-500 capitalize">{d.device}</p>
                      <p className="font-bold text-gray-900">{d.sessions.toLocaleString()}</p>
                      <p className="text-[10px] text-emerald-600">{d.conversions} conv</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {/* 5. PageSpeed & Technical SEO */}
      <Collapsible title="PageSpeed & Technical SEO" icon={<Zap size={14} />} defaultOpen={false} badge="Core Web Vitals">
        {!psi && (psiError
          ? <MissingDataNotice source="PageSpeed" message={psiError} />
          : <MissingDataNotice source="PageSpeed" message="PageSpeed data not available." />
        )}
        {psi && (
          <div className="space-y-5">
            {psiInsights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Analysis</p>
                {psiInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}

            {(["mobile", "desktop"] as const).map(strategy => {
              const s = strategy === "mobile" ? psi.mobile : psi.desktop;
              const ok = strategy === "mobile" ? mobileOk : desktopOk;
              if (!ok || !s) return null;
              return (
                <div key={strategy}>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">{strategy}</p>
                  <div className="flex gap-3 flex-wrap mb-4">
                    <ScoreRing score={s.scores.performance}   label="Performance" />
                    <ScoreRing score={s.scores.accessibility} label="Accessibility" />
                    <ScoreRing score={s.scores.seo}           label="SEO" />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
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
                    <div className="space-y-1">
                      {s.opportunities.map((o, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg text-amber-800">
                          <AlertCircle size={10} className="shrink-0" />
                          <span className="capitalize">{o.type.replace(/_/g, " ")}</span>
                          {o.savings && <span className="font-semibold ml-auto">save {o.savings}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Collapsible>

      {/* 6. Connected SEO Insights */}
      <Collapsible title="Connected SEO Insights" icon={<Link2 size={14} />} defaultOpen badge="Cross-channel">
        {connInsights.length === 0 && !hasAnyData && (
          <MissingDataNotice source="Connected Insights" message="Connect GSC, GA4, and PageSpeed data to see cross-channel insights." />
        )}
        {connInsights.length === 0 && hasAnyData && (
          <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
            No cross-channel issues detected. Data sources are performing consistently.
          </div>
        )}
        {connInsights.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">
              Insights connecting the full SEO funnel: Query → Landing Page → Traffic → Engagement → Conversion.
            </p>
            {connInsights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
          </div>
        )}
      </Collapsible>

      {/* 7. Recommendations */}
      <Collapsible title="Recommendations" icon={<Lightbulb size={14} />} defaultOpen badge="Report only">
        <p className="text-xs text-gray-400 mb-4 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          These are report recommendations only. No tasks have been created, and no owners or deadlines have been assigned.
        </p>
        <RecommendationsSection groups={recommendations} />
      </Collapsible>

    </div>
  );
}
