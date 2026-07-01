"use client";

import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { th } from "date-fns/locale";
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
}

interface CostByProject {
  projectId: string;
  projectName: string;
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
  ARTICLE_WRITE:       "เขียนบทความ (Claude)",
  IMAGE_COVER:         "รูปปก (Gemini)",
  IMAGE_MID:           "รูปประกอบ (Gemini)",
  KEYWORD_CLASSIFY:    "จัด Keyword (CSV)",
  KEYWORD_RESEARCH:    "Keyword Research (Gemini)",
  KP_VOLUME_LOOKUP:    "Keyword Planner Volume (Google)",
  DFS_VOLUME_LOOKUP:   "Search Volume (DataForSEO)",
  OUTLINE:             "สร้าง Outline (Claude)",
  SEO_REVIEW:          "SEO Review (Claude)",
  CONTENT_MAP:         "Content Map (Claude)",
  ARTICLE_HTML:        "เขียนบทความ HTML (Claude)",
  IMAGE_PROMPT:        "Image Prompt (Claude)",
  SEO_CHECK:           "SEO Check (Claude)",
  WORDPRESS_DRAFT:     "WordPress Draft",
  ARTICLE_AUDIT:       "Article Audit (Claude)",
  ARTICLE_FIX:         "Article Fix (Claude)",
  DATA_BRAIN_SUMMARY:  "Data Brain Summary (Claude)",
};

const PROVIDER_COLOR: Record<string, string> = {
  CLAUDE:      "bg-orange-100 text-orange-700",
  GEMINI:      "bg-blue-100 text-blue-700",
  OPENAI:      "bg-emerald-100 text-emerald-700",
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
  const [expandedId, setExpandedId]     = useState<string | null>(null);

  const jobTotalCost = (j: Job) => (j.estimatedCost ?? 0) + (j.externalCost ?? 0);
  const totalCostAll = jobs.reduce((s, j) => s + jobTotalCost(j), 0);
  const totalFailed  = jobs.filter(j => j.status === "FAILED").length;

  const filtered = useMemo(() => jobs.filter(j => {
    if (filterType   !== "all" && j.jobType !== filterType)   return false;
    if (filterStatus !== "all" && j.status  !== filterStatus) return false;
    return true;
  }), [jobs, filterType, filterStatus]);

  const allTypes    = Array.from(new Set(jobs.map(j => j.jobType)));
  const allStatuses = Array.from(new Set(jobs.map(j => j.status)));

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-amber-500" /><span className="text-xs text-gray-500">ค่าใช้จ่ายเดือนนี้</span></div>
          <div className="text-xl font-bold text-amber-600">{fmt(totalCostMonth)}</div>
          <div className="text-sm font-semibold text-red-500 mt-0.5">{fmtTHB(totalCostMonth)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">AI + API รวมกัน</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-gray-400" /><span className="text-xs text-gray-500">ค่าใช้จ่ายทั้งหมด</span></div>
          <div className="text-xl font-bold text-gray-700">{fmt(totalCostAll)}</div>
          <div className="text-sm font-semibold text-red-500 mt-0.5">{fmtTHB(totalCostAll)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">all time</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2"><Cpu size={16} className="text-purple-500" /><span className="text-xs text-gray-500">Tokens เดือนนี้</span></div>
          <div className="text-xl font-bold text-purple-600">{totalTokensMonth.toLocaleString()}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">tokens</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2"><AlertCircle size={16} className="text-red-400" /><span className="text-xs text-gray-500">ล้มเหลว</span></div>
          <div className={`text-xl font-bold ${totalFailed > 0 ? "text-red-500" : "text-gray-400"}`}>{totalFailed}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">need attention</div>
        </div>
      </div>

      {/* Cost by project */}
      {costByProject.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">ค่าใช้จ่ายตาม Client (เดือนนี้)</h3>
          <div className="space-y-2">
            {[...costByProject].sort((a, b) => b.cost - a.cost).map(p => {
              const maxCost = Math.max(...costByProject.map(x => x.cost), 0.0001);
              return (
                <div key={p.projectId} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate shrink-0">{p.projectName}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(p.cost / maxCost) * 100}%` }} />
                  </div>
                  <div className="text-right shrink-0 w-28">
                    <div className="text-xs font-mono text-amber-600">{fmt(p.cost)}</div>
                    <div className="text-[10px] font-semibold text-red-500">{fmtTHB(p.cost)}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{p.jobs} jobs</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cost by type */}
      {jobCountByType.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">ค่าใช้จ่ายตามประเภท</h3>
          <div className="flex flex-wrap gap-2">
            {[...jobCountByType].sort((a, b) => b.cost - a.cost).map(t => (
              <div key={t.jobType} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-xs text-gray-600">{JOB_TYPE_LABEL[t.jobType] ?? t.jobType}</span>
                <span className="text-xs font-semibold text-amber-600">{fmt(t.cost)}</span>
                <span className="text-[10px] font-semibold text-red-500">{fmtTHB(t.cost)}</span>
                <span className="text-[10px] text-gray-400">{t.count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className="text-gray-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
          <option value="all">ทุกประเภท</option>
          {allTypes.map(t => <option key={t} value={t}>{JOB_TYPE_LABEL[t] ?? t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
          <option value="all">ทุก Status</option>
          {allStatuses.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filtered.length} jobs</span>
        <span className="text-xs font-mono text-amber-600">{fmt(filtered.reduce((s, j) => s + jobTotalCost(j), 0))}</span>
        <span className="text-xs font-semibold text-red-500">{fmtTHB(filtered.reduce((s, j) => s + jobTotalCost(j), 0))}</span>
        <span className="text-xs text-purple-500">{filtered.reduce((s, j) => s + (j.tokenUsed ?? 0), 0).toLocaleString()} tokens</span>
      </div>

      {/* Jobs table */}
      {filtered.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["ประเภท", "Model", "Status", "Tokens", "ค่าใช้จ่าย", "โดย", "เวลา"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(j => {
                  const sc = STATUS_CONFIG[j.status] ?? STATUS_CONFIG.PENDING;
                  const provColor = PROVIDER_COLOR[j.modelProvider] ?? "bg-gray-100 text-gray-500";
                  const isExpanded = expandedId === j.id;
                  return (
                    <>
                      <tr
                        key={j.id}
                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
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
                          <span className="text-xs font-mono text-purple-600">
                            {j.tokenUsed ? j.tokenUsed.toLocaleString() : "—"}
                          </span>
                          {j.externalCalls != null && j.externalCalls > 0 && (
                            <div className="text-[10px] text-violet-500 mt-0.5">{j.externalCalls} API calls</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-amber-600">
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
                          <td colSpan={7} className="px-4 py-2">
                            <p className="text-xs text-red-600 font-mono">{j.errorMessage}</p>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <Zap size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">ยังไม่มี AI Jobs</p>
          <p className="text-gray-400 text-sm mt-1">เมื่อเขียนบทความหรือสร้างรูป จะแสดง cost ที่นี่อัตโนมัติ</p>
        </div>
      )}
    </div>
  );
}
