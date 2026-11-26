"use client";

import { useState, useMemo, useEffect, useTransition, Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { th } from "date-fns/locale";
import { KpiTile, Panel, DonutChart, MeterBar, EmptyState, Segmented } from "@/components/ds";
import {
  Zap, DollarSign, Cpu, AlertCircle, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp, Filter, CalendarDays, Loader2,
} from "lucide-react";
import { fmtThb } from "@/lib/ai-cost-format";
import {
  AI_COST_PRESETS, AI_COST_PRESET_LABEL, aiCostRangeQuery, isDateKey,
  type AiCostPreset, type AiCostRange,
} from "@/lib/ai-cost-range";

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
  /** รายการล่าสุดในช่วงที่เลือก (จำกัดจำนวน) — ยอดรวมใช้ total* ด้านล่าง ไม่ได้บวกจากรายการนี้ */
  jobs: Job[];
  /** ช่วงเวลาที่เลือกอยู่ — เปลี่ยนแล้วหน้าโหลดข้อมูลใหม่จากเซิร์ฟเวอร์ */
  range: AiCostRange;
  totalCostRange: number;
  totalTokensRange: number;
  totalJobsRange: number;
  totalFailedRange: number;
  /** ยอดรวมตั้งแต่เริ่มใช้ระบบ ไม่ขึ้นกับช่วงที่เลือก */
  totalCostAll: number;
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
  UPLOAD_ARTICLE_COMMENT_REVISE: "Upload Article · ปรับตาม Comment ลูกค้า (AI)",
  UPLOAD_ARTICLE_TRANSLATE: "Upload Article · Translate บทความ (AI)",
  UPLOAD_ARTICLE_IMAGE_COVER:  "Upload Article · รูปปก (AI)",
  UPLOAD_ARTICLE_IMAGE_INLINE: "Upload Article · รูปประกอบ (AI)",
  UPLOAD_ARTICLE_KEYWORDS_AI:  "Upload Article · Keyword + Title (AI)",
  UPLOAD_ARTICLE_META:         "Upload Article · Meta (AI)",
  SME_ARTICLE_META:            "SEO SME · Meta (AI)",
  UPLOAD_THEME_SCAN:           "Upload Article · สแกนธีมเว็บ",
  UPLOAD_SITE_SCAN:            "Upload Article · สแกนเว็บปลายทาง",
  UPLOAD_ARTICLE_CONNECT_HELP: "Upload Article · AI ช่วยแก้การเชื่อมต่อ",
  COMPLIANCE_CHECK:            "Compliance · ตรวจบทความ (AI)",
  COMPLIANCE_RULE_UPDATE:      "Compliance · AI อัปเดตกฎ",
  COMPLIANCE_RULE_FILL:        "Compliance · AI อ่านลิงก์/ไฟล์กรอกกฎ",
  LINE_TRACKING_SLIP_OCR:      "LINE Tracking · AI อ่านสลิปโอนเงิน",
  LINE_TRACKING_QUOTATION_OCR: "LINE Tracking · AI อ่านใบเสนอราคา/ใบแจ้งหนี้ (PDF)",
};

const PAGE_BADGE: Record<string, string> = {
  "Upload Article": "bg-violet-50 text-violet-700 border border-violet-100",
  Clients:          "bg-blue-50 text-brand-blue border border-blue-100",
  Compliance:       "bg-amber-50 text-amber-700 border border-amber-100",
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

const PRESET_OPTIONS = AI_COST_PRESETS.map((p) => ({ value: p, label: AI_COST_PRESET_LABEL[p] }));
/** กันช่อง date ยิงค่าระหว่างพิมพ์ปี (เช่น 0002-11-03) */
const MIN_DATE = "2020-01-01";

export function AIJobsClient({
  jobs, range, totalCostRange, totalTokensRange, totalJobsRange, totalFailedRange, totalCostAll,
  jobCountByType, costByProject,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [loadingRange, startRangeChange] = useTransition();

  const [filterType, setFilterType]     = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [fromInput, setFromInput]       = useState(range.from ?? "");
  const [toInput, setToInput]           = useState(range.to ?? "");

  // ช่วงเวลาเปลี่ยน = ข้อมูลชุดใหม่: ช่องวันที่ตามช่วงจริง และล้างตัวกรองที่อาจไม่มีในชุดใหม่
  useEffect(() => {
    setFromInput(range.from ?? "");
    setToInput(range.to ?? "");
    setFilterType("all");
    setFilterStatus("all");
    setFilterSource("all");
    setExpandedId(null);
  }, [range.preset, range.from, range.to]);

  const goRange = (query: string) => startRangeChange(() => router.replace(`${pathname}${query}`, { scroll: false }));
  const onDateChange = (which: "from" | "to", value: string) => {
    const from = which === "from" ? value : fromInput;
    const to   = which === "to"   ? value : toInput;
    if (which === "from") setFromInput(value); else setToInput(value);
    const ok = (v: string) => v === "" || (isDateKey(v) && v >= MIN_DATE);
    if ((from || to) && ok(from) && ok(to)) goRange(aiCostRangeQuery({ from, to }));
  };

  const jobTotalCost = (j: Job) => (j.estimatedCost ?? 0) + (j.externalCost ?? 0);

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
    <div className="space-y-5">

      {/* ช่วงเวลา — เปลี่ยนแล้วทุกตัวเลขในหน้าคิดใหม่ตามช่วงนั้น */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/80 bg-white/70 px-4 py-2.5 shadow-sm">
        <CalendarDays size={14} className="shrink-0 text-gray-400" />
        <Segmented
          size="sm"
          ariaLabel="ช่วงเวลา"
          options={PRESET_OPTIONS}
          value={range.preset as AiCostPreset}
          onChange={(p) => goRange(aiCostRangeQuery({ preset: p }))}
        />
        <div className="flex items-center gap-2">
          <input type="date" aria-label="ตั้งแต่วันที่" value={fromInput} min={MIN_DATE} max={toInput || undefined}
            onChange={e => onDateChange("from", e.target.value)}
            className="field-input !w-auto !py-1.5 text-xs" />
          <span className="text-xs text-gray-400">ถึง</span>
          <input type="date" aria-label="ถึงวันที่" value={toInput} min={fromInput || MIN_DATE}
            onChange={e => onDateChange("to", e.target.value)}
            className="field-input !w-auto !py-1.5 text-xs" />
        </div>
        {loadingRange && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" role="status">
            <Loader2 size={13} className="animate-spin" /> กำลังโหลด
          </span>
        )}
      </div>

      <div className={`space-y-5 transition-opacity ${loadingRange ? "opacity-50 pointer-events-none" : ""}`} aria-busy={loadingRange}>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile tone="blue" icon={<DollarSign size={16} />} label={`ค่าใช้จ่าย · ${range.label}`} value={fmtThb(totalCostRange)}
          hint="AI + API รวมกัน" />
        <KpiTile tone="sky" icon={<DollarSign size={16} />} label="ค่าใช้จ่ายทั้งหมด" value={fmtThb(totalCostAll)}
          hint="ตั้งแต่เริ่มใช้ระบบ" />
        <KpiTile tone="mist" icon={<Cpu size={16} />} label={`Tokens · ${range.label}`} value={totalTokensRange.toLocaleString()}
          hint={`${totalJobsRange.toLocaleString()} jobs`} />
        <KpiTile tone={totalFailedRange > 0 ? "warm" : "plain"} icon={<AlertCircle size={16} />} label={`ล้มเหลว · ${range.label}`} value={totalFailedRange}
          hint={totalFailedRange > 0 ? "need attention" : "ไม่มีงานล้มเหลว"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cost by project */}
        {costByProject.length > 0 && (
          <Panel title={`ค่าใช้จ่ายตาม Client (${range.label})`}>
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
                      <div className="text-xs font-mono text-brand-navy">{fmtThb(p.cost)}</div>
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
          <Panel title={`ค่าใช้จ่ายตามประเภท (${range.label})`}>
            {typeSegments.some(t => t.value > 0) && (
              <div className="mb-4 flex justify-center">
                <DonutChart segments={typeSegments} size={160} showLegend={false} formatValue={(v) => fmtThb(v)} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {[...jobCountByType].sort((a, b) => b.cost - a.cost).map(t => (
                <div key={t.jobType} className="flex flex-wrap max-w-full items-center gap-2 px-3 py-1.5 bg-white/70 rounded-xl border border-white/80">
                  <span className="text-xs text-gray-600">{JOB_TYPE_LABEL[t.jobType] ?? t.jobType}</span>
                  <span className="text-xs font-semibold text-brand-navy">{fmtThb(t.cost)}</span>
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
        <span className="text-xs text-gray-400">
          {filtered.length} jobs{totalJobsRange > jobs.length ? ` (ล่าสุดจาก ${totalJobsRange.toLocaleString()})` : ""}
        </span>
        <span className="text-xs font-mono text-brand-navy">{fmtThb(filtered.reduce((s, j) => s + jobTotalCost(j), 0))}</span>
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
                            {jobTotalCost(j) > 0 ? fmtThb(jobTotalCost(j)) : "—"}
                          </div>
                          {j.externalCost != null && j.externalCost > 0 && (
                            <div className="text-[10px] text-violet-500 mt-0.5">
                              incl. {j.externalApi ?? "API"} {fmtThb(j.externalCost)}
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
      ) : jobs.length > 0 ? (
        <EmptyState icon={<Filter size={22} />} title="ไม่มี job ตรงกับตัวกรอง" description="ลองเปลี่ยนประเภท Status หรือโปรเจกต์" />
      ) : range.preset !== "all" ? (
        <EmptyState icon={<CalendarDays size={22} />} title={`ไม่มี AI Jobs ในช่วง ${range.label}`} description="ลองเลือกช่วงเวลาอื่น หรือกด ทั้งหมด" />
      ) : (
        <EmptyState icon={<Zap size={22} />} title="ยังไม่มี AI Jobs" description="เมื่อเขียนบทความหรือสร้างรูป จะแสดง cost ที่นี่อัตโนมัติ" />
      )}

      {totalJobsRange > jobs.length && (
        <p className="text-xs text-gray-400">
          ตารางแสดง {jobs.length.toLocaleString()} รายการล่าสุด จากทั้งหมด {totalJobsRange.toLocaleString()} jobs ในช่วงนี้ — ยอดรวมด้านบนคิดครบทุก job เลือกช่วงให้แคบลงเพื่อดูรายการที่เหลือ
        </p>
      )}

      </div>
    </div>
  );
}
