"use client";

import { useState, useMemo, Fragment } from "react";
import { formatDistanceToNow } from "date-fns";
import { th } from "date-fns/locale";
import { KpiTile, Panel, DonutChart, MeterBar, EmptyState } from "@/components/ds";
import {
  Zap, DollarSign, Cpu, AlertCircle, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp, Filter,
} from "lucide-react";

interface Job {
  id: string;
  jobType: string;
  status: string;
  modelProvider: string;
  modelName: string;
  tokenUsed: number | null;
  estimatedCost: number | null;
  externalCost: number | null;
  externalCalls: number | null;
  externalApi: string | null;
  errorMessage: string | null;
  createdAt: Date;
  article: { id: string; title: string } | null;
  createdBy: { name: string | null } | null;
  /** ชื่อโปรเจกต์/ลูกค้า — null = ไม่ผูกลูกค้า */
  projectName?: string | null;
  /** หน้าที่สร้าง job เช่น Clients / Upload Article / Studio */
  sourcePage?: string;
}

interface CostByProject {
  projectId: string;
  projectName: string;
  /** หน้าที่สร้าง job เช่น Clients / Upload Article / Studio */
  page?: string;
  cost: number;
  tokens: number;
  jobs: number;
}

interface Props {
  jobs: Job[];
  totalCostMonth: number;
  totalTokensMonth: number;
  jobCountByType: { jobType: string; count: number; cost: number }[];
  costByProject: CostByProject[];
}

const JOB_TYPE_LABEL: Record<string, string> = {
  ARTICLE_WRITE:       "เขียนบทความ (AI)",
  IMAGE_COVER:         "รูปปก (AI)",
  IMAGE_MID:           "รูปประกอบ (AI)",
  KEYWORD_CLASSIFY:    "จัด Keyword (CSV)",
  KEYWORD_RESEARCH:    "Keyword Research (AI)",
  KP_VOLUME_LOOKUP:    "Keyword Planner Volume (Google)",
  DFS_VOLUME_LOOKUP:   "Search Volume (DataForSEO)",
  OUTLINE:             "สร้าง Outline (AI)",
  SEO_REVIEW:          "SEO Review (AI)",
  CONTENT_MAP:         "Content Map (AI)",
  ARTICLE_HTML:        "เขียนบทความ HTML (AI)",
  IMAGE_PROMPT:        "Image Prompt (AI)",
  SEO_CHECK:           "SEO Check (AI)",
  WORDPRESS_DRAFT:     "WordPress Draft",
  ARTICLE_AUDIT:       "Article Audit (AI)",
  ARTICLE_FIX:         "Article Fix (AI)",
  DATA_BRAIN_SUMMARY:  "Data Brain Summary (AI)",
  UPLOAD_ARTICLE_WRITE:        "Upload Article · เขียนบทความ (AI)",
  UPLOAD_ARTICLE_IMAGE_COVER:  "Upload Article · รูปปก (AI)",
  UPLOAD_ARTICLE_IMAGE_INLINE: "Upload Article · รูปประกอบ (AI)",
  UPLOAD_ARTICLE_KEYWORDS_AI:  "Upload Article · Keyword + Title (AI)",
  UPLOAD_ARTICLE_META:         "Upload Article · Meta (AI)",
  SME_ARTICLE_META:            "SEO SME · Meta (AI)",
  UPLOAD_THEME_SCAN:           "Upload Article · สแกนธีมเว็บ",
  UPLOAD_SITE_SCAN:            "Upload Article · สแกนเว็บปลายทาง",
};

const PAGE_BADGE: Record<string, string> = {
  "Upload Article": "bg-violet-50 text-violet-700 border border-violet-100",
  Clients:          "bg-blue-50 text-brand-blue border border-blue-100",
  Studio:           "bg-gray-100 text-gray-500",
};

function sourceKey(j: { projectName?: string | null; sourcePage?: string }) {
  return `${j.sourcePage ?? "Studio"}|${j.projectName ?? ""}`;
}
function sourceText(j: { projectName?: string | null; sourcePage?: string }) {
  const page = j.sourcePage ?? "Studio";
  return j.projectName ? `${j.projectName} · ${page}` : page;
}

const PROVIDER_COLOR: Record<string, string> = {
  CLAUDE:      "bg-orange-100 text-orange-700",
  GEMINI:      "bg-blue-100 text-blue-700",
  OPENAI:      "bg-emerald-100 text-emerald-700",
  OPENROUTER:  "bg-sky-100 text-sky-700",
  GOOGLE:      "bg-blue-100 text-blue-700",
  DATAFORSEO:  "bg-violet-100 text-violet-700",
  ANTHROPIC:   "bg-orange-100 text-orange-700",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  COMPLETED: { label: "สำเร็จ",  color: "text-emerald-600", icon: <CheckCircle2 size={12} /> },
  SUCCESS:   { label: "สำเร็จ",  color: "text-emerald-600", icon: <CheckCircle2 size={12} /> },
  FAILED:    { label: "ผิดพลาด", color: "text-red-500",     icon: <XCircle size={12} /> },
  RUNNING:   { label: "กำลังทำ", color: "text-blue-500",    icon: <Clock size={12} className="animate-pulse" /> },
  PENDING:   { label: "รอ",      color: "text-gray-400",    icon: <Clock size={12} /> },
};

const USD_TO_THB = 33;

function fmt(n: number) {
  return n < 0.0001 ? "<$0.0001" : `$${n.toFixed(4)}`;
}
function fmtTHB(n: number) {
  const baht = n * USD_TO_THB;
  return baht < 0.01 ? "<฿0.01" : `฿${baht.toFixed(2)}`;
}

export function AIJobsClient({ jobs, totalCostMonth, totalTokensMonth, jobCountByType, costByProject }: Props) {
  const [filterType, setFilterType]     = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [expandedId, setExpandedId]     = useState<string | null>(null);

  const jobTotalCost = (j: Job) => (j.estimatedCost ?? 0) + (j.externalCost ?? 0);
  const totalCostAll = jobs.reduce((s, j) => s + jobTotalCost(j), 0);
  const totalFailed  = jobs.filter(j => j.status === "FAILED").length;

  const filtered = useMemo(() => jobs.filter(j => {
    if (filterType   !== "all" && j.jobType !== filterType)   return false;
    if (filterStatus !== "all" && j.status  !== filterStatus) return false;
    if (filterSource !== "all" && sourceKey(j) !== filterSource) return false;
    return true;
  }), [jobs, filterType, filterStatus, filterSource]);

  const allTypes    = Array.from(new Set(jobs.map(j => j.jobType)));
  const allStatuses = Array.from(new Set(jobs.map(j => j.status)));
  const allSources  = Array.from(new Map(jobs.map(j => [sourceKey(j), sourceText(j)])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], "th"));

  const typeSegments = [...jobCountByType].sort((x, y) => y.cost - x.cost)
    .map(t => ({ label: JOB_TYPE_LABEL[t.jobType] ?? t.jobType, value: t.cost }));

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile tone="blue" icon={<DollarSign size={16} />} label="ค่าใช้จ่ายเดือนนี้" value={fmt(totalCostMonth)}
          hint={`${fmtTHB(totalCostMonth)} · AI + API รวมกัน`} />
        <KpiTile tone="sky" icon={<DollarSign size={16} />} label="ค่าใช้จ่ายทั้งหมด" value={fmt(totalCostAll)}
          hint={`${fmtTHB(totalCostAll)} · all time`} />
        <KpiTile tone="mist" icon={<Cpu size={16} />} label="Tokens เดือนนี้" value={totalTokensMonth.toLocaleString()} hint="tokens" />
        <KpiTile tone={totalFailed > 0 ? "warm" : "plain"} icon={<AlertCircle size={16} />} label="ล้มเหลว" value={totalFailed} hint="need attention" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cost by project */}
        {costByProject.length > 0 && (
          <Panel title="ค่าใช้จ่ายตาม Client (เดือนนี้)">
            <div className="space-y-2.5">
              {[...costByProject].sort((a, b) => b.cost - a.cost).map(p => {
                const maxCost = Math.max(...costByProject.map(x => x.cost), 0.0001);
                return (
                  <div key={p.projectId} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-24 sm:w-40 shrink-0 min-w-0">
                      <div className="text-xs text-gray-600 truncate" title={p.projectName}>{p.projectName}</div>
                      {p.page && (
                        <span className={`inline-flex items-center px-1.5 rounded-full text-[9px] font-semibold mt-0.5 ${PAGE_BADGE[p.page] ?? PAGE_BADGE.Studio}`}>{p.page}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <MeterBar value={(p.cost / maxCost) * 100} max={100} tone="blue" />
                    </div>
                    <div className="text-right shrink-0 w-20 sm:w-28">
                      <div className="text-xs font-mono text-brand-navy">{fmt(p.cost)}</div>
                      <div className="text-[10px] font-semibold text-red-500">{fmtTHB(p.cost)}</div>
                    </div>
                    <span className="text-[10px] text-gray-400 w-12 sm:w-14 text-right shrink-0">{p.jobs} jobs</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Cost by type */}
        {jobCountByType.length > 0 && (
          <Panel title="ค่าใช้จ่ายตามประเภท">
            {typeSegments.some(t => t.value > 0) && (
              <div className="mb-4 flex justify-center">
                <DonutChart segments={typeSegments} size={160} showLegend={false} formatValue={(v) => fmt(v)} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {[...jobCountByType].sort((a, b) => b.cost - a.cost).map(t => (
                <div key={t.jobType} className="flex flex-wrap max-w-full items-center gap-2 px-3 py-1.5 bg-white/70 rounded-xl border border-white/80">
                  <span className="text-xs text-gray-600">{JOB_TYPE_LABEL[t.jobType] ?? t.jobType}</span>
                  <span className="text-xs font-semibold text-brand-navy">{fmt(t.cost)}</span>
                  <span className="text-[10px] font-semibold text-red-500">{fmtTHB(t.cost)}</span>
                  <span className="text-[10px] text-gray-400">{t.count}x</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap rounded-2xl border border-white/80 bg-white/70 px-4 py-2.5 shadow-sm">
        <Filter size={13} className="text-gray-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="field-input !w-auto !py-1.5 text-xs">
          <option value="all">ทุกประเภท</option>
          {allTypes.map(t => <option key={t} value={t}>{JOB_TYPE_LABEL[t] ?? t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="field-input !w-auto !py-1.5 text-xs">
          <option value="all">ทุก Status</option>
          {allStatuses.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className="field-input !w-auto !py-1.5 text-xs max-w-[240px]">
          <option value="all">ทุกโปรเจกต์ / หน้า</option>
          {allSources.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filtered.length} jobs</span>
        <span className="text-xs font-mono text-brand-navy">{fmt(filtered.reduce((s, j) => s + jobTotalCost(j), 0))}</span>
        <span className="text-xs font-semibold text-red-500">{fmtTHB(filtered.reduce((s, j) => s + jobTotalCost(j), 0))}</span>
        <span className="text-xs text-purple-500">{filtered.reduce((s, j) => s + (j.tokenUsed ?? 0), 0).toLocaleString()} tokens</span>
      </div>

      {/* Jobs table */}
      {filtered.length > 0 ? (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl w-full text-left">
              <thead>
                <tr>
                  {["ประเภท", "โปรเจกต์", "Model", "Status", "Tokens", "ค่าใช้จ่าย", "โดย", "เวลา"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(j => {
                  const sc = STATUS_CONFIG[j.status] ?? STATUS_CONFIG.PENDING;
                  const provColor = PROVIDER_COLOR[j.modelProvider] ?? "bg-gray-100 text-gray-500";
                  const isExpanded = expandedId === j.id;
                  return (
                    <Fragment key={j.id}>
                      <tr
                        key={j.id}
                        className="transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : j.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Zap size={11} className="text-gray-400 shrink-0" />
                            <span className="text-xs font-medium text-gray-700">{JOB_TYPE_LABEL[j.jobType] ?? j.jobType}</span>
                          </div>
                          {j.article && (
                            <p className="text-[10px] text-gray-400 truncate max-w-[180px] ml-4 mt-0.5">{j.article.title}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {j.projectName && (
                            <div className="text-xs font-medium text-gray-700 max-w-[160px] truncate" title={j.projectName}>{j.projectName}</div>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${j.projectName ? "mt-0.5 " : ""}${PAGE_BADGE[j.sourcePage ?? "Studio"] ?? PAGE_BADGE.Studio}`}>
                            {j.sourcePage ?? "Studio"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${provColor}`}>
                            {j.modelProvider}
                          </span>
                          <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[120px]">{j.modelName}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs font-medium ${sc.color}`}>
                            {sc.icon}{sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-brand-navy">
                            {j.tokenUsed ? j.tokenUsed.toLocaleString() : "—"}
                          </span>
                          {j.externalCalls != null && j.externalCalls > 0 && (
                            <div className="text-[10px] text-violet-500 mt-0.5">{j.externalCalls} API calls</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-brand-navy">
                            {jobTotalCost(j) > 0 ? fmt(jobTotalCost(j)) : "—"}
                          </div>
                          {jobTotalCost(j) > 0 && (
                            <div className="text-[10px] font-semibold text-red-500 mt-0.5">
                              {fmtTHB(jobTotalCost(j))}
                            </div>
                          )}
                          {j.externalCost != null && j.externalCost > 0 && (
                            <div className="text-[10px] text-violet-500 mt-0.5">
                              incl. {j.externalApi ?? "API"} {fmt(j.externalCost)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] text-gray-500">{j.createdBy?.name ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">
                              {formatDistanceToNow(new Date(j.createdAt), { addSuffix: true, locale: th })}
                            </span>
                            {j.errorMessage && (
                              isExpanded
                                ? <ChevronUp size={12} className="text-gray-400" />
                                : <ChevronDown size={12} className="text-gray-400" />
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && j.errorMessage && (
                        <tr key={`${j.id}-err`} className="bg-red-50">
                          <td colSpan={8} className="px-4 py-2">
                            <p className="text-xs text-red-600 font-mono">{j.errorMessage}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon={<Zap size={22} />} title="ยังไม่มี AI Jobs" description="เมื่อเขียนบทความหรือสร้างรูป จะแสดง cost ที่นี่อัตโนมัติ" />
      )}
    </div>
  );
}
