'use client';

/**
 * WordGod — โหมด "ไม่มีหน้าร้าน / ขายออนไลน์"
 * Business-Centric SEO/AEO/GEO Keyword Intelligence Workspace
 *
 * เรียก /api/wordgod/online-research (NDJSON stream + checkpoint/resume) แล้วแสดง
 * workspace: ฟอร์มธุรกิจซ้าย (360–420px) → ขวาเป็น KPI 12 ใบ → ตารางหลักมี checkbox
 * → Detail Drawer (Why this keyword? + Evidence) → bulk bar "ส่งไปหน้า Keyword"
 * ผ่าน API เดิม /api/projects/[id]/keyword-bank (REUSE ไม่สร้างระบบใหม่)
 *
 * กติกาข้อมูล: Google กับ DataForSEO แสดงแยกเสมอ ไม่มีการเฉลี่ยรวม, NULL ≠ 0,
 * ทุก action บนตาราง (filter/sort/หน้า/เลือก) ทำใน memory — ไม่ยิง API ซ้ำ,
 * การเลือกคงอยู่ข้ามหน้า, ส่งเฉพาะคำที่ผู้ใช้ติ๊กเท่านั้น
 * ไม่แตะโหมด Local (มีหน้าร้าน) และไม่แก้หน้าอื่นใด ๆ
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { KeywordResearchProgress } from './KeywordResearchProgress';
import { referenceSourceLabel } from '@/lib/wordgod/local/metrics';
import {
  BUSINESS_TYPE_LABELS,
  JOURNEY_STAGE_MAP,
  ONLINE_STEPS,
  ONLINE_TARGET_PRESETS,
  STRATEGY_PRESETS,
  clampTargetCount,
  type OnlineBusinessType,
  type OnlineKeywordResult,
  type OnlineResearchResponse,
  type StrategyGoal,
} from '@/lib/wordgod/online/types';

interface OnlineProject {
  id: string;
  name: string;
  website: string;
  businessType: string;
}

interface Props {
  project: OnlineProject;
  onSendToBank?: () => void;
}

const fieldClass = 'w-full rounded-xl border border-[#cfd9ea] bg-white px-3.5 py-3 text-sm text-[#17233a] placeholder:text-[#91a0b8] shadow-sm outline-none transition focus:border-[#155eef] focus:ring-4 focus:ring-[#155eef]/10';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[#495975]';
const cardClass = 'rounded-2xl border border-[#dbe1ee] bg-white shadow-[0_8px_30px_rgba(28,73,52,0.05)]';

const BUSINESS_TYPE_OPTIONS: Array<{ value: OnlineBusinessType; label: string; hint: string }> = [
  { value: 'ONLINE_SERVICE', label: 'บริการออนไลน์', hint: 'เอเจนซี่ ที่ปรึกษา รับทำ…' },
  { value: 'ECOMMERCE', label: 'ขายสินค้า (Ecommerce)', hint: 'ขายของออนไลน์ มีตัวสินค้า' },
  { value: 'SAAS', label: 'ซอฟต์แวร์ (SaaS)', hint: 'ระบบ/แอปแบบสมัครสมาชิก' },
  { value: 'DIGITAL_PRODUCT', label: 'สินค้าดิจิทัล', hint: 'คอร์ส อีบุ๊ก เทมเพลต' },
  { value: 'OTHER', label: 'อื่น ๆ', hint: 'ระบุเอง' },
];

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  MEDIUM: 'border-blue-200 bg-blue-50 text-blue-800',
  LOW: 'border-amber-200 bg-amber-50 text-amber-800',
  NO_VOLUME: 'border-slate-200 bg-slate-50 text-slate-500',
};

const CONFIDENCE_TOOLTIP: Record<string, string> = {
  HIGH: 'Google และ DataForSEO ให้ตัวเลขตรงกัน (ต่างกัน ≤1.5 เท่า) — ใช้ได้อย่างมั่นใจ',
  MEDIUM: 'มีข้อมูลจากแหล่งเดียว หรือสองแหล่งต่างกันไม่เกิน 3 เท่า',
  LOW: 'สองแหล่งให้ตัวเลขต่างกันมาก (>3 เท่า) — ใช้ตัวเลขอย่างระวัง',
  NO_VOLUME: 'ยังไม่มีข้อมูล volume จากแหล่งใด — แสดง N/A ตามจริง ไม่แต่งตัวเลข',
};

const INTENT_LABEL_TH: Record<string, string> = {
  transactional: 'พร้อมซื้อ',
  commercial: 'กำลังเลือก',
  navigational: 'หาแบรนด์',
  informational: 'หาความรู้',
};

const OBJECTIVE_LABEL: Record<string, string> = { SALE: 'Sale', LEAD: 'Lead', TRAFFIC: 'Traffic' };
const OBJECTIVE_STYLE: Record<string, string> = {
  SALE: 'bg-[#e9f7ef] text-[#157347]',
  LEAD: 'bg-[#e7f0ff] text-[#0d4fd8]',
  TRAFFIC: 'bg-[#f4effd] text-[#6d3fc4]',
};

const SLUG_STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-emerald-50 text-emerald-700',
  EXISTING: 'bg-blue-50 text-blue-700',
  CONFLICT: 'bg-red-50 text-red-700',
  REVIEW: 'bg-amber-50 text-amber-700',
};

const HANDOFF_LABEL: Record<string, string> = {
  RESEARCHED: '',
  SELECTED: 'เลือกแล้ว',
  SENT_TO_KEYWORDS: 'ส่งแล้ว ✓',
  REVIEW: 'รอตรวจ',
};

const PAGE_TYPE_LABELS: Record<string, string> = {
  LANDING_PAGE: 'Landing Page',
  PRODUCT_PAGE: 'Product Page',
  CATEGORY_PAGE: 'Category Page',
  ARTICLE: 'บทความ',
  COMPARISON_PAGE: 'หน้าเปรียบเทียบ',
  FAQ_PAGE: 'FAQ',
  CASE_STUDY: 'Case Study',
};

const TOPIC_ROLE_LABELS: Record<string, string> = {
  PILLAR: 'Pillar',
  CLUSTER: 'Cluster',
  SUPPORTING: 'Supporting',
  MONEY_PAGE: 'Money Page',
};

function parseLines(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map(line => line.trim()).filter(Boolean)));
}

function fmtInt(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('th-TH') : '—';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); } catch { return '—'; }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function metricStatusText(status: string | undefined, value: number | null | undefined): string {
  if (status === 'ok' || status === 'zero') return fmtInt(value ?? 0);
  if (status === 'api_error') return 'API error';
  if (status === 'no_data') return 'ไม่มีข้อมูล';
  return 'ไม่ได้ดึง';
}

function journeyLabel(row: OnlineKeywordResult): string {
  return JOURNEY_STAGE_MAP[row.journeyStage]?.labelTh ?? row.journeyStage;
}

/** พร้อมส่งหรือยัง: title มีจริง + slug ไม่ค้าง REVIEW/CONFLICT */
function isReadyToSend(row: OnlineKeywordResult): boolean {
  return !!row.recommendedTitle && row.slugStatus !== 'REVIEW' && row.slugStatus !== 'CONFLICT';
}

// ── ชิ้นส่วนแสดงผลย่อย ────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  if (!confidence) return <span className="text-[#c7cfde]">—</span>;
  const label = confidence === 'NO_VOLUME' ? 'NO VOLUME' : confidence;
  return (
    <span
      title={CONFIDENCE_TOOLTIP[confidence]}
      className={`inline-block cursor-help rounded-full border px-2 py-0.5 text-[10px] font-bold ${CONFIDENCE_STYLE[confidence] ?? 'border-slate-200 bg-slate-50 text-slate-600'}`}
    >
      {label}
    </span>
  );
}

/** Reference Volume + ป้ายที่มา — tooltip แสดงสองแหล่งแยกกันเสมอ (ไม่เฉลี่ยรวม) */
function ReferenceVolumeCell({ row }: { row: OnlineKeywordResult }) {
  const tooltip = [
    `Google Keyword Planner: ${metricStatusText(row.google.status, row.google.avgMonthlySearches)}`
    + (row.google.geoTarget ? ` @ ${row.google.geoTarget}` : '')
    + (row.google.retrievedAt ? ` · ${fmtDate(row.google.retrievedAt)}` : ''),
    `DataForSEO: ${metricStatusText(row.dfs.status, row.dfs.searchVolume)} @ Thailand`
    + (row.dfs.retrievedAt ? ` · ${fmtDate(row.dfs.retrievedAt)}` : ''),
    'ตัวเลขสองแหล่งเก็บแยกกัน ไม่มีการเฉลี่ยรวม',
  ].join('\n');
  return (
    <span className="inline-flex cursor-help items-center gap-1.5" title={tooltip}>
      {row.reference.volume === null
        ? <span className="text-[#c7cfde]">—</span>
        : <span className="tabular-nums font-semibold">{fmtInt(row.reference.volume)}</span>}
      <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${
        row.reference.source === 'google_keyword_planner' ? 'bg-[#e7f0ff] text-[#0d4fd8]'
          : row.reference.source === 'dataforseo' ? 'bg-[#fdf0e7] text-[#c46a12]'
            : 'bg-[#f1f3f8] text-[#91a0b8]'
      }`}>
        {referenceSourceLabel(row.reference.source)}
      </span>
    </span>
  );
}

function SingleSourceVolumeCell({ status, value }: { status?: string; value: number | null | undefined }) {
  if (status === 'ok' || status === 'zero') {
    return <span className={`tabular-nums ${(value ?? 0) === 0 ? 'text-[#71809c]' : ''}`}>{fmtInt(value ?? 0)}</span>;
  }
  if (status === 'api_error') return <span title="เรียก API ไม่สำเร็จ (ไม่ใช่ศูนย์)" className="cursor-help text-[10px] font-semibold text-red-500">ERR</span>;
  return <span title={status === 'no_data' ? 'แหล่งนี้ไม่มีข้อมูลสำหรับคำนี้' : 'ไม่ได้ดึงข้อมูลจากแหล่งนี้'} className="cursor-help text-[#c7cfde]">—</span>;
}

function KpiCard({ label, value, sub, tooltip }: { label: string; value: string; sub?: string; tooltip?: string }) {
  return (
    <div title={tooltip} className={`${tooltip ? 'cursor-help ' : ''}rounded-xl border border-[#e3e8f1] bg-white px-4 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#91a0b8]">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-[#17233a]">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] leading-4 text-[#71809c]">{sub}</p> : null}
    </div>
  );
}

const SOURCE_STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-500',
  partial: 'bg-amber-500',
  error: 'bg-red-500',
  unavailable: 'bg-red-500',
  skipped: 'bg-slate-300',
};

function SourcePill({ name, status, detail }: { name: string; status: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8f1] bg-white px-2.5 py-1.5 text-[11px] text-[#495975]" title={detail}>
      <span className={`h-2 w-2 rounded-full ${SOURCE_STATUS_STYLE[status] ?? 'bg-slate-300'}`} />
      <span className="font-semibold text-[#17233a]">{name}</span>
      <span className="text-[#91a0b8]">{detail}</span>
    </span>
  );
}

/** checklist ~24 ขั้นของ pipeline — ไฮไลต์ตาม step จริงที่ server รายงาน */
function StepChecklist({ current }: { current: number }) {
  return (
    <div className="mx-auto mt-6 grid w-full max-w-2xl grid-cols-1 gap-x-6 gap-y-1 text-left sm:grid-cols-2">
      {ONLINE_STEPS.map(step => {
        const done = step.index < current;
        const active = step.index === current;
        return (
          <div key={step.key} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${active ? 'bg-[#eef4ff] font-bold text-[#0d4fd8]' : done ? 'text-[#157347]' : 'text-[#a7b1c4]'}`}>
            <span className="w-4 text-center">{done ? '✓' : active ? '●' : '○'}</span>
            <span>{step.index}. {step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── คอลัมน์ + การเรียงของตารางหลัก ────────────────────────────────────────────

type SortKey = 'final' | 'business' | 'seo' | 'aeo' | 'geo' | 'ref' | 'kd' | 'cpc' | 'journey';

function sortValue(row: OnlineKeywordResult, key: SortKey): number {
  switch (key) {
    case 'final': return row.scores.finalScore;
    case 'business': return row.scores.businessScore;
    case 'seo': return row.scores.seoOpportunity;
    case 'aeo': return row.scores.aeoOpportunity;
    case 'geo': return row.scores.geoOpportunity;
    case 'ref': return row.reference.volume ?? -1;
    case 'kd': return row.dfs.keywordDifficulty ?? -1;
    case 'cpc': return row.dfs.cpc ?? row.google.bidHighMicros ?? -1;
    case 'journey': return -row.journeyOrder;
  }
}

export default function WordGodOnlinePanel({ project, onSendToBank }: Props) {
  // ── ฟอร์มซ้าย ──
  const [businessType, setBusinessType] = useState<OnlineBusinessType>('ONLINE_SERVICE');
  const [businessTypeOther, setBusinessTypeOther] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState(project.website || '');
  const [brandName, setBrandName] = useState('');
  const [productsText, setProductsText] = useState('');
  const [targetCustomer, setTargetCustomer] = useState('');
  const [problemsText, setProblemsText] = useState('');
  const [country, setCountry] = useState('Thailand');
  const [language, setLanguage] = useState<'th' | 'en'>('th');
  const [strategyGoal, setStrategyGoal] = useState<StrategyGoal>('BALANCED');
  const [targetCount, setTargetCount] = useState(300);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [competitorsText, setCompetitorsText] = useState('');
  const [existingPagesText, setExistingPagesText] = useState('');
  const [includeBrand, setIncludeBrand] = useState(true);
  const [includeComparison, setIncludeComparison] = useState(true);
  const [includeProblem, setIncludeProblem] = useState(true);

  // ── สถานะรัน + ผลลัพธ์ ──
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [progressStep, setProgressStep] = useState(1);
  const [data, setData] = useState<OnlineResearchResponse | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Workspace: tabs + ตัวกรอง + เรียง + หน้า + เลือก + drawer ──
  type Tab = 'keywords' | 'wave1' | 'clusters' | 'blueprint' | 'sitemap' | 'sources';
  const [tab, setTab] = useState<Tab>('keywords');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [objectiveFilter, setObjectiveFilter] = useState('all');
  const [funnelFilter, setFunnelFilter] = useState('all');
  const [waveFilter, setWaveFilter] = useState('all');
  const [clusterFilter, setClusterFilter] = useState('all');
  const [journeyFilter, setJourneyFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('final');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [drawerKeyword, setDrawerKeyword] = useState<string | null>(null);
  // การเลือกคงอยู่ข้ามหน้า/ตัวกรอง — เก็บเป็น Set ของ keyword
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dupChecking, setDupChecking] = useState(false);
  const [existingBank, setExistingBank] = useState<Set<string> | null>(null);
  const [sending, setSending] = useState(false);

  // debounce ช่องค้นหา — กันตารางใหญ่กระตุกตอนพิมพ์
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    setPage(1);
  }, [query, confidenceFilter, objectiveFilter, funnelFilter, waveFilter, clusterFilter, journeyFilter, sortKey, sortDesc, tab, pageSize]);

  // โหลดผลรอบล่าสุดที่บันทึกไว้ของโปรเจกต์นี้ (canonical run) — เงียบ ๆ ถ้าไม่มี
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/wordgod/online-research?projectId=${encodeURIComponent(project.id)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.results?.length && json?.meta) {
          setData(json as OnlineResearchResponse);
          setStatus('done');
          setStatusMessage(`โหลดผลรอบล่าสุด (${json.results.length} คำ · ${fmtDate(json.meta.generatedAt)})`);
        }
      } catch { /* ไม่มีผลเก่า — เริ่มจากฟอร์มว่าง */ }
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const results = data?.results ?? [];
  const clusters = data?.clusters ?? [];
  const meta = data?.meta;
  const blueprint = data?.blueprint;

  // ── ตัวกรอง + เรียง (ใน memory ทั้งหมด — ไม่มี API call) ──
  const filtered = useMemo(() => {
    const base = tab === 'wave1' ? results.filter(r => r.priorityWave === 1) : results;
    const rows = base.filter(row => {
      if (query
        && !row.keyword.toLowerCase().includes(query)
        && !(row.recommendedTitle ?? '').toLowerCase().includes(query)
        && !(row.cluster ?? '').toLowerCase().includes(query)) return false;
      if (confidenceFilter !== 'all' && row.confidence !== confidenceFilter) return false;
      if (objectiveFilter !== 'all' && row.objective !== objectiveFilter) return false;
      if (funnelFilter !== 'all' && row.funnelStage !== funnelFilter) return false;
      if (waveFilter !== 'all' && String(row.priorityWave) !== waveFilter) return false;
      if (clusterFilter !== 'all' && row.cluster !== clusterFilter) return false;
      if (journeyFilter !== 'all' && row.journeyStage !== journeyFilter) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const diff = sortValue(b, sortKey) - sortValue(a, sortKey);
      return sortDesc ? diff : -diff;
    });
  }, [results, tab, query, confidenceFilter, objectiveFilter, funnelFilter, waveFilter, clusterFilter, journeyFilter, sortKey, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const kpi = useMemo(() => {
    const total = results.length;
    const highConf = results.filter(r => r.confidence === 'HIGH').length;
    const kdVals = results.map(r => r.dfs.keywordDifficulty).filter((v): v is number => typeof v === 'number');
    const refDemand = results.reduce((sum, r) => sum + (r.reference.volume ?? 0), 0);
    const wave1 = results.filter(r => r.priorityWave === 1).length;
    const money = results.filter(r => r.sitemap.topicRole === 'MONEY_PAGE').length;
    const aeo = results.filter(r => r.journeyStage === 'AEO_QUESTION').length;
    const geo = results.filter(r => r.journeyStage === 'GEO_AI_TOPIC').length;
    const sent = results.filter(r => r.handoffStatus === 'SENT_TO_KEYWORDS').length;
    const problem = results.filter(r => !!r.problemGroup).length;
    return {
      total,
      candidates: meta?.candidateCount ?? total,
      refDemand,
      highConfPct: total ? Math.round((highConf / total) * 100) : 0,
      avgKd: kdVals.length ? Math.round(kdVals.reduce((a, b) => a + b, 0) / kdVals.length) : null,
      clusters: clusters.length,
      wave1,
      money,
      aeo,
      geo,
      sent,
      problem,
      coveragePct: Math.round((meta?.verifiedVolumeCoverage ?? 0) * 100),
    };
  }, [results, clusters, meta]);

  const clusterNames = useMemo(
    () => Array.from(new Set(results.map(r => r.cluster).filter(Boolean))),
    [results]
  );
  const journeyStagesInData = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of results) if (!seen.has(r.journeyStage)) seen.set(r.journeyStage, r.journeyOrder);
    return Array.from(seen.entries()).sort((a, b) => a[1] - b[1]).map(([stage]) => stage);
  }, [results]);

  const drawerRow = useMemo(
    () => (drawerKeyword ? results.find(r => r.keyword === drawerKeyword) ?? null : null),
    [drawerKeyword, results]
  );

  const selectedRows = useMemo(
    () => results.filter(r => selectedKeys.has(r.keyword)),
    [results, selectedKeys]
  );
  const readyRows = selectedRows.filter(isReadyToSend);
  const reviewRows = selectedRows.filter(r => !isReadyToSend(r));

  function toggleSelect(keyword: string): void {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  const pageAllSelected = pageRows.length > 0 && pageRows.every(r => selectedKeys.has(r.keyword));
  function toggleSelectPage(): void {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach(r => next.delete(r.keyword));
      else pageRows.forEach(r => next.add(r.keyword));
      return next;
    });
  }
  function selectAllFiltered(): void {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      filtered.forEach(r => next.add(r.keyword));
      return next;
    });
  }

  // ── รันวิจัย: NDJSON stream + checkpoint/resume (แพทเทิร์นเดียวกับโหมด Local) ──
  const runningRef = useRef(false);
  async function runResearch(): Promise<void> {
    if (runningRef.current) return;
    const products = parseLines(productsText);
    if (products.length === 0) {
      setStatus('error');
      setStatusMessage('กรุณาระบุสินค้า/บริการหลักอย่างน้อย 1 รายการ');
      return;
    }

    runningRef.current = true;
    setStatus('running');
    setStatusMessage('กำลังเริ่มวิเคราะห์ธุรกิจ…');
    setProgressLogs([]);
    setProgressStep(1);
    setData(null);
    setDrawerKeyword(null);
    setSelectedKeys(new Set());
    setExistingBank(null);

    const body = {
      businessType,
      businessTypeOther: businessType === 'OTHER' ? businessTypeOther.trim() || undefined : undefined,
      websiteUrl: websiteUrl.trim() || undefined,
      brandName: brandName.trim() || undefined,
      products,
      targetCustomer: targetCustomer.trim() || undefined,
      customerProblems: parseLines(problemsText),
      country: country.trim() || 'Thailand',
      language,
      strategyGoal,
      targetCount: clampTargetCount(targetCount),
      competitorDomains: parseLines(competitorsText).slice(0, 10),
      existingPages: parseLines(existingPagesText),
      includeBrandKeywords: includeBrand,
      includeComparisonKeywords: includeComparison,
      includeProblemKeywords: includeProblem,
      businessContext: [project.name, project.businessType].filter(Boolean).join(' — '),
      projectId: project.id,
      stream: true,
      resumable: true, // run ยาวถูกซอยเป็นหลาย request ฝั่ง server (กัน Vercel maxDuration ตัด)
    };

    try {
      let payload: OnlineResearchResponse | null = null;
      let resumeRunId: string | null = null;
      let retries = 0;
      let lockWaits = 0;
      for (;;) {
        let response: Response;
        try {
          response = await fetch('/api/wordgod/online-research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resumeRunId ? { ...body, resumeRunId } : body),
          });
        } catch (err) {
          if (!resumeRunId || retries >= 3) throw err;
          retries++;
          setStatusMessage(`การเชื่อมต่อสะดุด — กำลังทำต่อจากจุดเดิม (ครั้งที่ ${retries}) …`);
          await new Promise(r => setTimeout(r, 3000 * retries));
          continue;
        }
        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('ndjson') && response.body) {
          let yielded = false;
          try {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.trim()) continue;
                let event: any;
                try { event = JSON.parse(line); } catch { continue; }
                if (event.type === 'progress' && typeof event.message === 'string') {
                  setProgressLogs(prev => [...prev, event.message]);
                  setStatusMessage(event.message);
                  if (typeof event.step === 'number') setProgressStep(s => Math.max(s, event.step));
                } else if (event.type === 'run' && typeof event.runId === 'string') {
                  resumeRunId = event.runId;
                } else if (event.type === 'yield' && typeof event.runId === 'string') {
                  resumeRunId = event.runId;
                  yielded = true;
                } else if (event.type === 'result') {
                  payload = event.data as OnlineResearchResponse;
                } else if (event.type === 'error') {
                  const e = new Error(String(event.error ?? 'เกิดข้อผิดพลาด'));
                  (e as any).fromServer = true;
                  throw e;
                }
              }
            }
          } catch (err) {
            if ((err as any)?.fromServer || !resumeRunId || retries >= 3) throw err;
            retries++;
            setStatusMessage(`การเชื่อมต่อสะดุด — กำลังทำต่อจากจุดเดิม (ครั้งที่ ${retries}) …`);
            await new Promise(r => setTimeout(r, 3000 * retries));
            continue;
          }
          if (payload) break;
          if (yielded) { retries = 0; continue; }
          if (resumeRunId && retries < 3) {
            retries++;
            setStatusMessage(`การเชื่อมต่อสะดุด — กำลังทำต่อจากจุดเดิม (ครั้งที่ ${retries}) …`);
            await new Promise(r => setTimeout(r, 3000 * retries));
            continue;
          }
          throw new Error('การเชื่อมต่อถูกตัดก่อนได้ผลลัพธ์ — ลองใหม่อีกครั้ง');
        } else {
          const json = await response.json().catch(() => ({}));
          if (response.status === 202 && json.runId) {
            resumeRunId = String(json.runId);
            retries = 0;
            continue;
          }
          if (response.status === 409 && json.locked && lockWaits < 40) {
            lockWaits++;
            setStatusMessage('รอรอบประมวลผลก่อนหน้าของ run นี้ปิดตัว …');
            await new Promise(r => setTimeout(r, 8000));
            continue;
          }
          if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
          payload = json as OnlineResearchResponse;
          break;
        }
      }
      if (!payload) throw new Error('การเชื่อมต่อถูกตัดก่อนได้ผลลัพธ์ — ลองใหม่อีกครั้ง');

      setData(payload);
      setTab('keywords');
      setQueryInput(''); setQuery('');
      setConfidenceFilter('all'); setObjectiveFilter('all'); setFunnelFilter('all');
      setWaveFilter('all'); setClusterFilter('all'); setJourneyFilter('all');
      setSortKey('final'); setSortDesc(true); setPage(1);
      setStatus('done');
      setStatusMessage(`ได้ ${payload.results?.length ?? 0} คีย์เวิร์ด — ติ๊กเลือกแล้วส่งไปหน้า Keyword ได้เลย`);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    } finally {
      runningRef.current = false;
    }
  }

  // ── Export Excel: อ่านจาก saved run เดียวกับที่ UI แสดง — ไม่วิจัยซ้ำ ──
  async function exportExcel(): Promise<void> {
    if (!data) return;
    const researchId = data.meta.researchId;
    if (!researchId) {
      toast.error('ผลชุดนี้ไม่ได้ถูกบันทึกลงฐานข้อมูล (ดู warnings) — รันใหม่เพื่อ export Excel');
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/api/wordgod/online-research/export?researchId=${encodeURIComponent(researchId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Export ไม่สำเร็จ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const m = disposition.match(/filename="([^"]+)"/);
      downloadBlob(blob, m?.[1] ?? `keyword-online-${results.length}.xlsx`);
      toast.success('ดาวน์โหลดไฟล์ Excel แล้ว (7 ชีต จากข้อมูลชุดเดียวกับตาราง)');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export Excel ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  }

  // ── ส่งไปหน้า Keyword: ตรวจซ้ำก่อน → modal ยืนยัน → API เดิม → mark handoff ──
  async function openConfirm(): Promise<void> {
    if (selectedRows.length === 0) return;
    setDupChecking(true);
    setConfirmOpen(true);
    try {
      const res = await fetch(`/api/keywords?projectId=${encodeURIComponent(project.id)}`);
      const json = await res.json().catch(() => ({}));
      const list: any[] = Array.isArray(json) ? json : (json.keywords ?? json.data ?? []);
      setExistingBank(new Set(list.map(k => String(k.keyword ?? '').trim().toLowerCase()).filter(Boolean)));
    } catch {
      setExistingBank(null); // ตรวจซ้ำไม่ได้ — แจ้งใน modal ว่า API เดิมจะ upsert ให้เอง (ไม่สร้างซ้ำ)
    } finally {
      setDupChecking(false);
    }
  }

  const duplicateRows = useMemo(
    () => (existingBank ? selectedRows.filter(r => existingBank.has(r.keyword.trim().toLowerCase())) : []),
    [existingBank, selectedRows]
  );

  async function sendToKeywordPage(): Promise<void> {
    if (selectedRows.length === 0) return;
    setSending(true);
    try {
      const rows = selectedRows.map(r => ({
        keyword: r.keyword,
        title: r.recommendedTitle ?? undefined,
        volume: r.reference.volume ?? undefined,
        difficulty: r.dfs.keywordDifficulty ?? undefined,
        intent: r.businessIntent === 'TRANSACTIONAL' ? 'TRANSACTIONAL'
          : r.businessIntent === 'EVALUATIVE' ? 'COMMERCIAL' : 'INFORMATIONAL',
        funnelStage: r.funnelStage,
        priority: r.priorityWave === 1 ? 3 : r.priorityWave === 2 ? 2 : 1,
        seedKeyword: r.seedKeyword ?? undefined,
        meta: {
          opportunity_score: Math.round(r.scores.finalScore),
          page_type: PAGE_TYPE_LABELS[r.pageType] ?? r.pageType,
          primary_objective: r.objective,
          notes: r.whyThisKeyword ?? undefined,
          cluster: r.cluster,
          clusterRole: r.clusterRole,
          journeyStage: r.journeyStage,
          businessScore: Math.round(r.scores.businessScore),
          seoOpportunity: Math.round(r.scores.seoOpportunity),
          aeoOpportunity: Math.round(r.scores.aeoOpportunity),
          geoOpportunity: Math.round(r.scores.geoOpportunity),
          confidence: r.confidence,
          referenceSource: r.reference.source,
          slug: r.suggestedSlug ?? undefined,
          suggestedPath: r.sitemap.suggestedPath ?? undefined,
          topicRole: r.sitemap.topicRole,
          wave: r.priorityWave,
          secondaryKeywords: r.secondaryKeywords,
          problemGroup: r.problemGroup ?? undefined,
        },
      }));
      const response = await fetch(`/api/projects/${project.id}/keyword-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source: 'keyword-research-online' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'ส่งไปหน้า Keyword ไม่สำเร็จ');

      // อัปเดตสถานะ handoff ใน canonical run (ไม่บล็อกถ้าพลาด — คำเข้า bank แล้ว)
      const sentKeywords = selectedRows.map(r => r.keyword);
      if (data?.meta.researchId) {
        fetch('/api/wordgod/online-research/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ researchId: data.meta.researchId, keywords: sentKeywords, status: 'SENT_TO_KEYWORDS' }),
        }).catch(() => {});
      }
      setData(prev => prev ? {
        ...prev,
        results: prev.results.map(r =>
          selectedKeys.has(r.keyword) ? { ...r, handoffStatus: 'SENT_TO_KEYWORDS' as const } : r
        ),
      } : prev);
      setSelectedKeys(new Set());
      setConfirmOpen(false);
      toast.success(`ส่งไปหน้า Keyword แล้ว ${sentKeywords.length} คำ (สร้างใหม่ ${payload.created ?? 0} • อัปเดต ${payload.updated ?? 0})`);
      onSendToBank?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ส่งไปหน้า Keyword ไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  }
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDesc ? ' ▾' : ' ▴') : '';

  const preset = STRATEGY_PRESETS[strategyGoal];
  const sourceStatus = data?.sourceStatus;

  // ── ตารางคีย์เวิร์ดหลัก (แท็บ Keywords และ Wave 1) ──
  const keywordTable = (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eef1f7] px-4 py-2.5">
        <input
          className="w-52 rounded-xl border border-[#cfd9ea] bg-white px-3 py-2 text-xs outline-none focus:border-[#155eef]"
          value={queryInput}
          onChange={event => setQueryInput(event.target.value)}
          placeholder="ค้นหาคีย์เวิร์ด / title / cluster"
        />
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)}>
          <option value="all">ทุก Confidence</option>
          {['HIGH', 'MEDIUM', 'LOW', 'NO_VOLUME'].map(c => <option key={c} value={c}>{c === 'NO_VOLUME' ? 'NO VOLUME' : c}</option>)}
        </select>
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={objectiveFilter} onChange={e => setObjectiveFilter(e.target.value)}>
          <option value="all">ทุก Objective</option>
          <option value="SALE">Sale</option>
          <option value="LEAD">Lead</option>
          <option value="TRAFFIC">Traffic</option>
        </select>
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={funnelFilter} onChange={e => setFunnelFilter(e.target.value)}>
          <option value="all">ทุก Funnel</option>
          <option value="TOFU">TOFU</option>
          <option value="MOFU">MOFU</option>
          <option value="BOFU">BOFU</option>
        </select>
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={journeyFilter} onChange={e => setJourneyFilter(e.target.value)}>
          <option value="all">ทุก Journey Stage</option>
          {journeyStagesInData.map(s => (
            <option key={s} value={s}>{JOURNEY_STAGE_MAP[s as keyof typeof JOURNEY_STAGE_MAP]?.labelTh ?? s}</option>
          ))}
        </select>
        {tab !== 'wave1' ? (
          <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={waveFilter} onChange={e => setWaveFilter(e.target.value)}>
            <option value="all">ทุก Wave</option>
            <option value="1">Wave 1</option>
            <option value="2">Wave 2</option>
            <option value="3">Wave 3</option>
          </select>
        ) : null}
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={clusterFilter} onChange={e => setClusterFilter(e.target.value)}>
          <option value="all">ทุก Cluster</option>
          {clusterNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="ml-auto text-[11px] text-[#91a0b8]">{filtered.length.toLocaleString('th-TH')} คำ</span>
        <button
          onClick={selectAllFiltered}
          className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#155eef] hover:bg-[#f0f5ff]"
        >
          เลือกทั้งหมดที่กรองอยู่
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1750px] text-left text-xs">
          <thead>
            <tr className="border-b border-[#eef1f7] text-[10px] uppercase tracking-wide text-[#91a0b8]">
              <th className="px-3 py-2.5">
                <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectPage} title="เลือกทั้งหน้านี้" />
              </th>
              <th className="px-2 py-2.5">#</th>
              <th className="px-3 py-2.5">Keyword</th>
              <th className="px-3 py-2.5">Title ที่แนะนำ</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('ref')} title="Reference Volume: Google ก่อน, DataForSEO สำรอง — ไม่เฉลี่ยรวม">Volume{sortIndicator('ref')}</th>
              <th className="px-3 py-2.5" title="Google Keyword Planner (Primary Reference)">Google</th>
              <th className="px-3 py-2.5" title="DataForSEO (Cross-check)">DFS</th>
              <th className="px-3 py-2.5">Conf</th>
              <th className="px-3 py-2.5">Intent</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('journey')} title="ขั้นใน Customer Journey 19 ขั้น">Journey{sortIndicator('journey')}</th>
              <th className="px-3 py-2.5">Funnel</th>
              <th className="px-3 py-2.5">Obj</th>
              <th className="px-3 py-2.5">Cluster</th>
              <th className="px-3 py-2.5">ปัญหา</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('kd')}>KD{sortIndicator('kd')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('cpc')}>CPC{sortIndicator('cpc')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('business')} title="คุณค่าต่อธุรกิจ (ความเกี่ยวข้อง+ใกล้เงิน+ปัญหา+journey fit)">Biz{sortIndicator('business')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('seo')}>SEO{sortIndicator('seo')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('aeo')} title="Answer Engine Optimization — โอกาสเป็นคำตอบใน AI answer">AEO{sortIndicator('aeo')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('geo')} title="Generative Engine Optimization — โอกาสถูก AI search อ้างอิง (ไม่ใช่ภูมิศาสตร์)">GEO{sortIndicator('geo')}</th>
              <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('final')}>Final{sortIndicator('final')}</th>
              <th className="px-3 py-2.5">Page Type</th>
              <th className="px-3 py-2.5">Wave</th>
              <th className="px-3 py-2.5">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(row => {
              const checked = selectedKeys.has(row.keyword);
              return (
                <tr
                  key={row.keyword}
                  className={`cursor-pointer border-b border-[#f4f6fb] transition hover:bg-[#f7f9fd] ${checked ? 'bg-[#f0f5ff]' : ''}`}
                  onClick={() => setDrawerKeyword(row.keyword)}
                >
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSelect(row.keyword)} />
                  </td>
                  <td className="px-2 py-2.5 tabular-nums text-[#91a0b8]">{row.rank}</td>
                  <td className="max-w-[230px] px-3 py-2.5">
                    <p className="truncate font-semibold text-[#17233a]" title={row.keyword}>{row.keyword}</p>
                    {row.secondaryKeywords.length > 0 ? (
                      <p className="truncate text-[10px] text-[#91a0b8]" title={row.secondaryKeywords.join(', ')}>
                        +{row.secondaryKeywords.length} คำรอง
                      </p>
                    ) : null}
                  </td>
                  <td className="max-w-[260px] px-3 py-2.5">
                    <p className="truncate text-[#374763]" title={row.recommendedTitle ?? undefined}>{row.recommendedTitle ?? '—'}</p>
                    {row.suggestedSlug ? (
                      <p className="flex items-center gap-1 truncate text-[10px] text-[#91a0b8]">
                        <span className={`rounded px-1 text-[9px] font-bold ${SLUG_STATUS_STYLE[row.slugStatus] ?? ''}`}>{row.slugStatus}</span>
                        /{row.suggestedSlug}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5"><ReferenceVolumeCell row={row} /></td>
                  <td className="px-3 py-2.5"><SingleSourceVolumeCell status={row.google.status} value={row.google.avgMonthlySearches} /></td>
                  <td className="px-3 py-2.5"><SingleSourceVolumeCell status={row.dfs.status} value={row.dfs.searchVolume} /></td>
                  <td className="px-3 py-2.5"><ConfidenceBadge confidence={row.confidence} /></td>
                  <td className="px-3 py-2.5 text-[#495975]">
                    {row.searchIntent.intent ? (INTENT_LABEL_TH[row.searchIntent.intent] ?? row.searchIntent.intent) : '—'}
                  </td>
                  <td className="max-w-[150px] truncate px-3 py-2.5 text-[#495975]" title={journeyLabel(row)}>
                    {row.journeyOrder}. {journeyLabel(row)}
                  </td>
                  <td className="px-3 py-2.5 text-[#495975]">{row.funnelStage}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${OBJECTIVE_STYLE[row.objective] ?? ''}`}>
                      {OBJECTIVE_LABEL[row.objective] ?? row.objective}
                    </span>
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-[#495975]" title={row.cluster}>{row.cluster}</td>
                  <td className="max-w-[150px] truncate px-3 py-2.5 text-[#495975]" title={row.problemGroup ?? undefined}>{row.problemGroup ?? '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.dfs.keywordDifficulty ?? '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.dfs.cpc ? row.dfs.cpc.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{Math.round(row.scores.businessScore)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{Math.round(row.scores.seoOpportunity)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{Math.round(row.scores.aeoOpportunity)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{Math.round(row.scores.geoOpportunity)}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-lg bg-[#17233a] px-2 py-1 text-[11px] font-bold tabular-nums text-white">
                      {Math.round(row.scores.finalScore * 10) / 10}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[#495975]">{PAGE_TYPE_LABELS[row.pageType] ?? row.pageType}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.priorityWave}</td>
                  <td className="px-3 py-2.5">
                    {row.handoffStatus === 'SENT_TO_KEYWORDS'
                      ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">ส่งแล้ว ✓</span>
                      : !isReadyToSend(row)
                        ? <span title="title/slug ยังไม่พร้อม — เปิด Detail เพื่อตรวจ" className="cursor-help rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Needs Review</span>
                        : <span className="rounded bg-[#f1f3f8] px-1.5 py-0.5 text-[10px] font-semibold text-[#71809c]">Ready</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f7] px-4 py-2.5 text-[11px] text-[#495975]">
        <span>หน้า {page} / {totalPages}</span>
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-[#dbe1ee] px-2 py-1 disabled:opacity-40">← ก่อนหน้า</button>
        <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-lg border border-[#dbe1ee] px-2 py-1 disabled:opacity-40">ถัดไป →</button>
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / หน้า</option>)}
        </select>
        <span className="ml-auto text-[#91a0b8]">การเลือกคงอยู่แม้เปลี่ยนหน้า/ตัวกรอง — เลือกแล้ว {selectedKeys.size.toLocaleString('th-TH')} คำ</span>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-[1600px] px-1 pb-28 pt-2">
      <div className="flex flex-col gap-5 xl:flex-row">
        {/* ── ฟอร์มซ้าย (360–420px) ── */}
        <aside className="w-full shrink-0 xl:w-[400px]">
          <div className={`${cardClass} p-5`}>
            <h3 className="text-sm font-bold text-[#17233a]">ข้อมูลธุรกิจ (ไม่มีหน้าร้าน / ขายออนไลน์)</h3>
            <p className="mt-1 text-[11px] leading-5 text-[#71809c]">
              ระบบวิเคราะห์จากธุรกิจจริง → ปัญหาลูกค้า → journey 19 ขั้น แล้วค่อยดึงตัวเลขจริงจาก Google / DataForSEO — AI ไม่มีสิทธิ์แต่งตัวเลขใด ๆ
            </p>

            <div className="mt-4">
              <label className={labelClass}>ประเภทธุรกิจ *</label>
              <div className="grid grid-cols-1 gap-1.5">
                {BUSINESS_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBusinessType(opt.value)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${businessType === opt.value ? 'border-[#155eef] bg-[#f0f5ff] font-bold text-[#0d4fd8]' : 'border-[#dbe1ee] bg-white text-[#495975] hover:border-[#b9c6dd]'}`}
                  >
                    <span>{opt.label}</span>
                    <span className="text-[10px] font-normal text-[#91a0b8]">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {businessType === 'OTHER' ? (
                <input className={`${fieldClass} mt-2`} value={businessTypeOther} onChange={e => setBusinessTypeOther(e.target.value)} placeholder="ระบุประเภทธุรกิจ" />
              ) : null}
            </div>

            <div className="mt-4">
              <label className={labelClass}>สินค้า / บริการหลัก * (บรรทัดละรายการ)</label>
              <textarea rows={3} className={fieldClass} value={productsText} onChange={e => setProductsText(e.target.value)} placeholder={'เช่น\nรับทำ SEO\nเครื่องฟอกอากาศ'} />
            </div>

            <div className="mt-4">
              <label className={labelClass}>เว็บไซต์ (ไม่บังคับ — ใช้อ่านบริบท ไม่ใช่ตรวจเทคนิค)</label>
              <input className={fieldClass} value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
            </div>

            <div className="mt-4">
              <label className={labelClass}>ชื่อแบรนด์ (ไม่บังคับ)</label>
              <input className={fieldClass} value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="เช่น MarsBrand" />
            </div>

            <div className="mt-4">
              <label className={labelClass}>กลุ่มลูกค้าเป้าหมาย (แนะนำให้กรอก — ถ้าเว้น AI จะวิเคราะห์เองและติดป้ายว่าเป็นข้อสันนิษฐาน)</label>
              <textarea rows={2} className={fieldClass} value={targetCustomer} onChange={e => setTargetCustomer(e.target.value)} placeholder="เช่น เจ้าของ SME ที่อยากได้ลูกค้าจาก Google" />
            </div>

            <div className="mt-4">
              <label className={labelClass}>ปัญหาของลูกค้า (ไม่บังคับ — บรรทัดละข้อ)</label>
              <textarea rows={2} className={fieldClass} value={problemsText} onChange={e => setProblemsText(e.target.value)} placeholder={'เช่น\nเว็บไม่ติดหน้าแรก\nยิงแอดแพงขึ้นเรื่อย ๆ'} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>ประเทศ</label>
                <input className={fieldClass} value={country} onChange={e => setCountry(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>ภาษา</label>
                <select className={fieldClass} value={language} onChange={e => setLanguage(e.target.value as 'th' | 'en')}>
                  <option value="th">ไทย</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className={labelClass}>Strategy Goal *</label>
              <div className="grid grid-cols-1 gap-1.5">
                {(Object.keys(STRATEGY_PRESETS) as StrategyGoal[]).map(goal => {
                  const p = STRATEGY_PRESETS[goal];
                  return (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => setStrategyGoal(goal)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${strategyGoal === goal ? 'border-[#155eef] bg-[#f0f5ff] font-bold text-[#0d4fd8]' : 'border-[#dbe1ee] bg-white text-[#495975] hover:border-[#b9c6dd]'}`}
                    >
                      <span>{p.label}</span>
                      <span className="text-[10px] font-normal text-[#91a0b8]">Traffic {p.traffic}% / Sales {p.sales}%</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <label className={labelClass}>จำนวนคีย์เวิร์ดเป้าหมาย (50–1000)</label>
              <div className="flex flex-wrap gap-1.5">
                {ONLINE_TARGET_PRESETS.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTargetCount(n)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${targetCount === n ? 'border-[#155eef] bg-[#155eef] text-white' : 'border-[#dbe1ee] bg-white text-[#495975] hover:border-[#b9c6dd]'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(s => !s)}
              className="mt-4 text-[11px] font-semibold text-[#155eef]"
            >
              {showAdvanced ? '▾ ซ่อนตัวเลือกขั้นสูง' : '▸ ตัวเลือกขั้นสูง (คู่แข่ง / หน้าเดิม / ชนิดคำ)'}
            </button>
            {showAdvanced ? (
              <div className="mt-3 space-y-4 rounded-xl border border-[#eef1f7] bg-[#fafbfe] p-3">
                <div>
                  <label className={labelClass}>โดเมนคู่แข่ง (1–10 โดเมน บรรทัดละอัน — ขุดคำที่คู่แข่งติดอันดับจริง)</label>
                  <textarea rows={2} className={fieldClass} value={competitorsText} onChange={e => setCompetitorsText(e.target.value)} placeholder={'competitor1.com\ncompetitor2.co.th'} />
                </div>
                <div>
                  <label className={labelClass}>หน้าที่มีอยู่แล้วบนเว็บ (บรรทัดละ path — กันแนะนำหน้าซ้ำ)</label>
                  <textarea rows={2} className={fieldClass} value={existingPagesText} onChange={e => setExistingPagesText(e.target.value)} placeholder={'/services/seo\n/blog/what-is-seo'} />
                </div>
                <div className="space-y-1.5 text-xs text-[#495975]">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeBrand} onChange={e => setIncludeBrand(e.target.checked)} /> รวมคำที่มีชื่อแบรนด์</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeComparison} onChange={e => setIncludeComparison(e.target.checked)} /> รวมคำเปรียบเทียบ (เทียบ/vs/แบบไหนดี)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={includeProblem} onChange={e => setIncludeProblem(e.target.checked)} /> รวมคำจากปัญหาลูกค้า (problem-first)</label>
                </div>
              </div>
            ) : null}

            <button
              onClick={runResearch}
              disabled={status === 'running'}
              className="mt-5 w-full rounded-xl bg-[#155eef] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0d4fd8] disabled:opacity-50"
            >
              {status === 'running' ? 'กำลังวิเคราะห์…' : `เริ่มวิเคราะห์ (เป้า ${targetCount} คำ · ${preset.label})`}
            </button>
            {status === 'error' ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                {statusMessage}
                <button onClick={runResearch} className="ml-2 rounded-lg border border-red-300 bg-white px-2 py-1 text-[11px] font-bold text-red-700">ลองใหม่</button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* ── Workspace ขวา ── */}
        <main className="min-w-0 flex-1">
          {status === 'running' ? (
            <div>
              <KeywordResearchProgress title="กำลังวิเคราะห์ธุรกิจ + ดึงข้อมูลจริง" logs={progressLogs} />
              <div className={`${cardClass} mt-4 p-5`}>
                <p className="text-xs font-bold text-[#17233a]">ขั้นตอน ({Math.min(progressStep, ONLINE_STEPS.length)}/{ONLINE_STEPS.length})</p>
                <StepChecklist current={progressStep} />
              </div>
            </div>
          ) : !data ? (
            <div className={`${cardClass} flex min-h-[420px] flex-col items-center justify-center p-10 text-center`}>
              <p className="text-lg font-bold text-[#17233a]">Business-Centric Keyword Intelligence</p>
              <p className="mt-2 max-w-md text-xs leading-6 text-[#71809c]">
                กรอกข้อมูลธุรกิจด้านซ้ายแล้วกด "เริ่มวิเคราะห์" — ระบบจะสร้าง Business Blueprint,
                เดินตาม Customer Journey 19 ขั้น, ดึง Search Volume จริงจาก Google Keyword Planner
                (cross-check ด้วย DataForSEO), ให้คะแนน SEO / AEO / GEO แล้วให้คุณ
                <span className="font-bold text-[#17233a]"> ติ๊กเลือกคำที่ต้องการ</span> ก่อนส่งเข้าหน้า Keyword
              </p>
              {statusMessage && status === 'done' ? <p className="mt-3 text-[11px] text-[#91a0b8]">{statusMessage}</p> : null}
            </div>
          ) : (
            <div className="space-y-4">
              {/* KPI 12 ใบ */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                <KpiCard label="คีย์เวิร์ด" value={fmtInt(kpi.total)} sub={`จาก candidate ${fmtInt(kpi.candidates)} คำ`} />
                <KpiCard label="Reference Demand" value={fmtInt(kpi.refDemand)} tooltip="ผลรวม volume เฉพาะคำที่มีข้อมูลจริง — ไม่ใช่คำสัญญา traffic" sub="ครั้ง/เดือน (เฉพาะคำที่มีข้อมูล)" />
                <KpiCard label="Confidence HIGH" value={`${kpi.highConfPct}%`} tooltip="สัดส่วนคำที่ Google และ DataForSEO ยืนยันตรงกัน" />
                <KpiCard label="Volume Coverage" value={`${kpi.coveragePct}%`} sub={meta?.clientReady ? 'Client Ready ✓' : 'ต่ำกว่าเกณฑ์ 90%'} tooltip="สัดส่วนคำที่มี volume ยืนยันจากแหล่งจริงอย่างน้อยหนึ่งแหล่ง" />
                <KpiCard label="เฉลี่ย KD" value={kpi.avgKd === null ? '—' : String(kpi.avgKd)} tooltip="Keyword Difficulty เฉลี่ย (DataForSEO)" />
                <KpiCard label="Clusters" value={fmtInt(kpi.clusters)} />
                <KpiCard label="Wave 1" value={fmtInt(kpi.wave1)} sub="ลงมือก่อน — portfolio สมดุล" />
                <KpiCard label="Money Pages" value={fmtInt(kpi.money)} tooltip="หน้าที่ตั้งใจปิดการขายโดยตรง" />
                <KpiCard label="คำ AEO" value={fmtInt(kpi.aeo)} tooltip="คำถามสำหรับ Answer Engine (คืออะไร/ทำไม/ดีไหม)" />
                <KpiCard label="หัวข้อ GEO" value={fmtInt(kpi.geo)} tooltip="หัวข้อที่ AI search ชอบอ้างอิง (Generative Engine Optimization — ไม่ใช่ภูมิศาสตร์)" />
                <KpiCard label="ผูกกับปัญหาจริง" value={fmtInt(kpi.problem)} tooltip="คำที่โยงกับ Problem Map ของลูกค้า" />
                <KpiCard label="ส่งไปหน้า Keyword แล้ว" value={fmtInt(kpi.sent)} />
              </div>

              {/* Data Source Status */}
              {sourceStatus ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SourcePill name="Google Keyword Planner" status={sourceStatus.googleKeywordPlanner.status} detail={`${Math.round(sourceStatus.googleKeywordPlanner.coverage * 100)}% · ${sourceStatus.googleKeywordPlanner.geo}`} />
                  <SourcePill name="DataForSEO" status={sourceStatus.dataForSeo.status} detail={`${Math.round(sourceStatus.dataForSeo.coverage * 100)}%`} />
                  <SourcePill name="SERP" status={sourceStatus.serp.status} detail={`ตรวจ ${sourceStatus.serp.checkedCount} คำ`} />
                  <SourcePill name="AI (ตีความเท่านั้น)" status="ok" detail="ไม่ใช่แหล่งตัวเลข" />
                  {meta?.customerSource === 'AI_INFERRED' ? (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                      กลุ่มลูกค้า: AI วิเคราะห์เอง (ไม่ได้ระบุมา)
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* คำเตือนจากระบบ — ความจริงต้องมาก่อน */}
              {meta?.warnings?.length ? (
                <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                  <summary className="cursor-pointer font-bold">หมายเหตุจากระบบ ({meta.warnings.length})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              ) : null}

              {/* Tabs */}
              <div className={cardClass}>
                <div className="flex flex-wrap items-center gap-1 border-b border-[#eef1f7] px-3 pt-3">
                  {([
                    ['keywords', `Keywords (${results.length})`],
                    ['wave1', `Wave 1 (${kpi.wave1})`],
                    ['clusters', `Clusters (${clusters.length})`],
                    ['blueprint', 'Business Blueprint'],
                    ['sitemap', 'Sitemap Plan'],
                    ['sources', 'Data Sources'],
                  ] as Array<[Tab, string]>).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`rounded-t-xl px-3.5 py-2 text-xs font-semibold transition ${tab === key ? 'border border-b-0 border-[#eef1f7] bg-white text-[#0d4fd8]' : 'text-[#71809c] hover:text-[#17233a]'}`}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-2 pb-2">
                    <button
                      onClick={exportExcel}
                      disabled={exporting}
                      className="rounded-lg border border-[#dbe1ee] bg-white px-3 py-1.5 text-[11px] font-bold text-[#17233a] transition hover:border-[#b9c6dd] disabled:opacity-50"
                    >
                      {exporting ? 'กำลังสร้างไฟล์…' : '⬇ Excel (7 ชีต)'}
                    </button>
                  </div>
                </div>

                {(tab === 'keywords' || tab === 'wave1') ? keywordTable : null}

                {tab === 'clusters' ? (
                  <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#eef1f7] text-[10px] uppercase tracking-wide text-[#91a0b8]">
                          <th className="px-3 py-2">Cluster</th>
                          <th className="px-3 py-2">Primary Keyword</th>
                          <th className="px-3 py-2">Keywords</th>
                          <th className="px-3 py-2">Search Demand รวม</th>
                          <th className="px-3 py-2">Section</th>
                          <th className="px-3 py-2">Topic Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusters.map(c => (
                          <tr key={c.clusterId} className="border-b border-[#f4f6fb]">
                            <td className="px-3 py-2.5 font-semibold text-[#17233a]">{c.name}</td>
                            <td className="px-3 py-2.5 text-[#495975]">{c.primaryKeyword}</td>
                            <td className="px-3 py-2.5 tabular-nums">{c.keywordCount}</td>
                            <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.totalReferenceVolume)}</td>
                            <td className="px-3 py-2.5 text-[#495975]">/{c.section}</td>
                            <td className="px-3 py-2.5 text-[#495975]">{TOPIC_ROLE_LABELS[c.topicRole] ?? c.topicRole}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {tab === 'blueprint' && blueprint ? (
                  <div className="space-y-5 p-5 text-xs leading-6 text-[#374763]">
                    <div>
                      <p className="text-sm font-bold text-[#17233a]">สรุปธุรกิจ</p>
                      <p className="mt-1">{blueprint.businessSummary}</p>
                    </div>
                    <div>
                      <p className="font-bold text-[#17233a]">กลุ่มลูกค้า ({blueprint.segments.length})</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {blueprint.segments.map((s, i) => (
                          <li key={i}>
                            <span className="font-semibold">{s.name}</span> — {s.description}
                            {s.source === 'AI_INFERRED' ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-bold text-amber-700">AI วิเคราะห์</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-bold text-[#17233a]">Problem Map ({blueprint.problemMap.length})</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {blueprint.problemMap.map((p, i) => (
                          <li key={i}><span className="font-semibold">{p.problem}</span> ({p.segment} · ระดับ {p.severity}) → ค้นแบบ: {p.searchBehaviors.join(', ') || '—'}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-bold text-[#17233a]">Jobs-to-be-Done ({blueprint.jtbd.length})</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {blueprint.jtbd.map((j, i) => <li key={i}>{j.job} — <span className="text-[#71809c]">{j.desiredOutcome}</span></li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-bold text-[#17233a]">ปัจจัยตัดสินใจซื้อ ({blueprint.purchaseFactors.length})</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {blueprint.purchaseFactors.map((f, i) => <li key={i}><span className="font-semibold">{f.factor}</span> — มุมคำค้น: {f.keywordAngles.join(', ') || '—'}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-bold text-[#17233a]">Keyword Taxonomy ({blueprint.taxonomy.length} กิ่ง)</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {blueprint.taxonomy.map((t, i) => (
                          <li key={i}><span className="font-semibold">{t.branch}</span> ({t.product}) — seeds: {t.seedKeywords.join(', ')}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {tab === 'sitemap' ? (
                  <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[900px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#eef1f7] text-[10px] uppercase tracking-wide text-[#91a0b8]">
                          <th className="px-3 py-2">Suggested Path</th>
                          <th className="px-3 py-2">Keyword</th>
                          <th className="px-3 py-2">Topic Role</th>
                          <th className="px-3 py-2">Parent Topic</th>
                          <th className="px-3 py-2">Internal Link ไปหน้าเดิม</th>
                          <th className="px-3 py-2">Slug Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...results].sort((a, b) => (a.sitemap.section + a.cluster).localeCompare(b.sitemap.section + b.cluster)).map(r => (
                          <tr key={r.keyword} className="border-b border-[#f4f6fb]">
                            <td className="px-3 py-2 font-mono text-[11px] text-[#0d4fd8]">{r.sitemap.suggestedPath ?? '—'}</td>
                            <td className="px-3 py-2 text-[#17233a]">{r.keyword}</td>
                            <td className="px-3 py-2 text-[#495975]">{TOPIC_ROLE_LABELS[r.sitemap.topicRole] ?? r.sitemap.topicRole}</td>
                            <td className="px-3 py-2 text-[#495975]">{r.sitemap.parentTopic ?? '—'}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[#495975]">{r.sitemap.internalLinkTarget ?? '—'}</td>
                            <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SLUG_STATUS_STYLE[r.slugStatus] ?? ''}`}>{r.slugStatus}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {tab === 'sources' && sourceStatus ? (
                  <div className="space-y-3 p-5 text-xs leading-6 text-[#374763]">
                    <p className="text-sm font-bold text-[#17233a]">แหล่งข้อมูล — ตัวเลขทุกตัวมาจาก API จริง ไม่มีตัวเลขจาก AI</p>
                    <ul className="list-disc space-y-2 pl-5">
                      <li><span className="font-semibold">Google Keyword Planner (Primary Reference)</span> — สถานะ {sourceStatus.googleKeywordPlanner.status}, ครอบคลุม {Math.round(sourceStatus.googleKeywordPlanner.coverage * 100)}% @ {sourceStatus.googleKeywordPlanner.geo}, ดึงเมื่อ {fmtDate(sourceStatus.googleKeywordPlanner.fetchedAt)}{sourceStatus.googleKeywordPlanner.message ? ` — ${sourceStatus.googleKeywordPlanner.message}` : ''}</li>
                      <li><span className="font-semibold">DataForSEO (Cross-check + Ideas + Intent + KD)</span> — สถานะ {sourceStatus.dataForSeo.status}, ครอบคลุม {Math.round(sourceStatus.dataForSeo.coverage * 100)}%, ดึงเมื่อ {fmtDate(sourceStatus.dataForSeo.fetchedAt)}{sourceStatus.dataForSeo.message ? ` — ${sourceStatus.dataForSeo.message}` : ''}</li>
                      <li><span className="font-semibold">DataForSEO SERP Validation</span> — สถานะ {sourceStatus.serp.status}, ตรวจ {sourceStatus.serp.checkedCount} คำ (เฉพาะ Tier A เพื่อคุมค่าใช้จ่าย)</li>
                      <li><span className="font-semibold">OpenRouter AI</span> — {sourceStatus.ai.role}</li>
                    </ul>
                    <p className="rounded-xl bg-[#f7f9fd] px-4 py-3 text-[11px] text-[#71809c]">
                      Reference Volume เลือกจาก Google ก่อน → DataForSEO สำรอง → ไม่มีข้อมูล = N/A
                      ตัวเลขสองแหล่งเก็บแยกคอลัมน์เสมอ ไม่มีการเฉลี่ยรวม · ZERO (ค้นเป็นศูนย์จริง) ≠ NULL (ไม่มีข้อมูล)
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Detail Drawer ── */}
      {drawerRow ? (
        <div className="fixed inset-0 z-40" onClick={() => setDrawerKeyword(null)}>
          <div className="absolute inset-0 bg-black/20" />
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#91a0b8]">อันดับ {drawerRow.rank} · {drawerRow.cluster}</p>
                <h3 className="mt-1 text-lg font-bold text-[#17233a]">{drawerRow.keyword}</h3>
              </div>
              <button onClick={() => setDrawerKeyword(null)} className="rounded-lg border border-[#dbe1ee] px-2.5 py-1 text-xs text-[#495975]">ปิด ✕</button>
            </div>

            <label className="mt-4 flex items-center gap-2 rounded-xl border border-[#dbe1ee] bg-[#fafbfe] px-3 py-2.5 text-xs font-semibold text-[#17233a]">
              <input type="checkbox" checked={selectedKeys.has(drawerRow.keyword)} onChange={() => toggleSelect(drawerRow.keyword)} />
              เลือกคำนี้เพื่อส่งไปหน้า Keyword
              {drawerRow.handoffStatus === 'SENT_TO_KEYWORDS' ? <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">ส่งแล้ว ✓</span> : null}
            </label>

            <div className="mt-4 rounded-xl border border-[#e3e8f1] bg-[#f7f9fd] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#91a0b8]">Why this keyword?</p>
              <p className="mt-1.5 text-xs leading-6 text-[#374763]">{drawerRow.whyThisKeyword ?? 'ยังไม่มีคำอธิบาย (title generation ไม่สำเร็จสำหรับคำนี้ — สถานะ REVIEW)'}</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-[#e3e8f1] p-3">
                <p className="text-[10px] font-semibold text-[#91a0b8]">Google Keyword Planner</p>
                <p className="mt-1 font-bold tabular-nums">{metricStatusText(drawerRow.google.status, drawerRow.google.avgMonthlySearches)}</p>
                <p className="text-[10px] text-[#91a0b8]">{drawerRow.google.geoTarget ?? '—'} · {fmtDate(drawerRow.google.retrievedAt)}</p>
              </div>
              <div className="rounded-xl border border-[#e3e8f1] p-3">
                <p className="text-[10px] font-semibold text-[#91a0b8]">DataForSEO</p>
                <p className="mt-1 font-bold tabular-nums">{metricStatusText(drawerRow.dfs.status, drawerRow.dfs.searchVolume)}</p>
                <p className="text-[10px] text-[#91a0b8]">Thailand · {fmtDate(drawerRow.dfs.retrievedAt)}</p>
              </div>
              <div className="rounded-xl border border-[#e3e8f1] p-3">
                <p className="text-[10px] font-semibold text-[#91a0b8]">Reference (ไม่เฉลี่ยรวม)</p>
                <p className="mt-1 font-bold tabular-nums">{drawerRow.reference.volume === null ? 'N/A' : fmtInt(drawerRow.reference.volume)}</p>
                <p className="text-[10px] text-[#91a0b8]">{referenceSourceLabel(drawerRow.reference.source)} · <ConfidenceBadge confidence={drawerRow.confidence} /></p>
              </div>
              <div className="rounded-xl border border-[#e3e8f1] p-3">
                <p className="text-[10px] font-semibold text-[#91a0b8]">KD / CPC</p>
                <p className="mt-1 font-bold tabular-nums">{drawerRow.dfs.keywordDifficulty ?? '—'} / {drawerRow.dfs.cpc ? `฿${drawerRow.dfs.cpc.toLocaleString('th-TH', { maximumFractionDigits: 1 })}` : '—'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[#e3e8f1] p-4 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#91a0b8]">Evidence Summary</p>
              <ul className="mt-2 space-y-1.5 text-[#374763]">
                <li>• Journey: <span className="font-semibold">{drawerRow.journeyOrder}. {journeyLabel(drawerRow)}</span> ({drawerRow.funnelStage} → {OBJECTIVE_LABEL[drawerRow.objective]})</li>
                <li>• Search intent จริง: {drawerRow.searchIntent.intent ? `${INTENT_LABEL_TH[drawerRow.searchIntent.intent] ?? drawerRow.searchIntent.intent}${typeof drawerRow.searchIntent.probability === 'number' ? ` (${Math.round(drawerRow.searchIntent.probability * 100)}%)` : ''}` : 'ไม่ได้ตรวจ'}</li>
                <li>• ปัญหาลูกค้า: {drawerRow.problemGroup ?? 'ไม่ได้ผูกกับ Problem Map'}</li>
                <li>• SERP: {drawerRow.serp.status === 'ok'
                  ? `ตรวจแล้ว — service ${drawerRow.serp.servicePageCount}, บทความ ${drawerRow.serp.articleCount}, directory ${drawerRow.serp.directoryCount}`
                  : 'ไม่ได้ตรวจ (ใช้คะแนนกลาง — ไม่แต่งข้อมูล)'}</li>
                <li>• Cannibalization: {drawerRow.cannibalizationAction}{drawerRow.secondaryKeywords.length ? ` — ดูดคำรอง ${drawerRow.secondaryKeywords.length} คำ` : ''}</li>
                <li>• ที่มา: {drawerRow.sources.join(', ')}{drawerRow.seedKeyword ? ` (seed: ${drawerRow.seedKeyword})` : ''}</li>
              </ul>
            </div>

            <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
              {([['Biz', drawerRow.scores.businessScore], ['SEO', drawerRow.scores.seoOpportunity], ['AEO', drawerRow.scores.aeoOpportunity], ['GEO', drawerRow.scores.geoOpportunity], ['Final', drawerRow.scores.finalScore]] as Array<[string, number]>).map(([label, val]) => (
                <div key={label} className={`rounded-xl border p-2.5 ${label === 'Final' ? 'border-[#17233a] bg-[#17233a] text-white' : 'border-[#e3e8f1]'}`}>
                  <p className={`text-[10px] font-semibold ${label === 'Final' ? 'text-white/70' : 'text-[#91a0b8]'}`}>{label}</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums">{Math.round(val * 10) / 10}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-[#e3e8f1] p-4 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#91a0b8]">แผนหน้าเว็บ</p>
              <ul className="mt-2 space-y-1.5 text-[#374763]">
                <li>• Title: <span className="font-semibold">{drawerRow.recommendedTitle ?? '—'}</span></li>
                <li>• Slug: <span className="font-mono text-[11px]">{drawerRow.suggestedSlug ? `/${drawerRow.suggestedSlug}` : '—'}</span> <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${SLUG_STATUS_STYLE[drawerRow.slugStatus] ?? ''}`}>{drawerRow.slugStatus}</span></li>
                <li>• Page Type: {PAGE_TYPE_LABELS[drawerRow.pageType] ?? drawerRow.pageType} · Topic Role: {TOPIC_ROLE_LABELS[drawerRow.sitemap.topicRole]}</li>
                <li>• Path ที่แนะนำ: <span className="font-mono text-[11px]">{drawerRow.sitemap.suggestedPath ?? '—'}</span></li>
                <li>• Internal link ไปหน้าเดิม: {drawerRow.sitemap.internalLinkTarget ?? 'ไม่มีหน้าเดิมที่ตรง'}</li>
                <li>• Wave {drawerRow.priorityWave}</li>
              </ul>
              {drawerRow.secondaryKeywords.length > 0 ? (
                <p className="mt-2 rounded-lg bg-[#f7f9fd] px-3 py-2 text-[11px] text-[#71809c]">
                  คำรองที่ควรอยู่หน้าเดียวกัน: {drawerRow.secondaryKeywords.join(', ')}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {/* ── Sticky bulk bar ── */}
      {selectedKeys.size > 0 && status !== 'running' ? (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl border border-[#17233a]/10 bg-[#17233a] px-5 py-3 text-white shadow-2xl">
            <span className="text-xs">
              เลือกแล้ว <span className="font-bold tabular-nums">{selectedKeys.size.toLocaleString('th-TH')}</span> คำ
              {reviewRows.length > 0 ? <span className="ml-1.5 text-amber-300">({reviewRows.length} คำ Needs Review)</span> : null}
            </span>
            <button onClick={() => setSelectedKeys(new Set())} className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/10">
              ล้าง
            </button>
            <button
              onClick={openConfirm}
              className="rounded-xl bg-[#155eef] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0d4fd8]"
            >
              ส่งไปหน้า Keyword →
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Confirmation modal (pre-send validation + duplicate protection) ── */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !sending && setConfirmOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-[#17233a]">ยืนยันส่งไปหน้า Keyword</h3>
            <p className="mt-1 text-xs text-[#71809c]">ส่งเฉพาะคำที่ติ๊กเลือก ({selectedRows.length.toLocaleString('th-TH')} คำ) เข้า Keyword Bank ของโปรเจกต์นี้ผ่านระบบเดิม</p>
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
                <span className="font-semibold text-emerald-800">Ready (title + slug พร้อม)</span>
                <span className="font-bold tabular-nums text-emerald-800">{readyRows.length.toLocaleString('th-TH')}</span>
              </div>
              {reviewRows.length > 0 ? (
                <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <span className="font-semibold text-amber-800" title="ไม่มี title หรือ slug ยังเป็น REVIEW/CONFLICT — ส่งได้ แต่ควรตรวจก่อนใช้จริง">Needs Review</span>
                  <span className="font-bold tabular-nums text-amber-800">{reviewRows.length.toLocaleString('th-TH')}</span>
                </div>
              ) : null}
              {dupChecking ? (
                <p className="text-[11px] text-[#91a0b8]">กำลังตรวจคำซ้ำกับหน้า Keyword …</p>
              ) : existingBank ? (
                duplicateRows.length > 0 ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-blue-800">
                    <p className="font-semibold">มีอยู่ในหน้า Keyword แล้ว {duplicateRows.length.toLocaleString('th-TH')} คำ — ระบบจะอัปเดตข้อมูลให้ ไม่สร้างซ้ำ</p>
                    <p className="mt-1 max-h-16 overflow-y-auto text-[11px]">{duplicateRows.slice(0, 20).map(r => r.keyword).join(', ')}{duplicateRows.length > 20 ? ` … (+${duplicateRows.length - 20})` : ''}</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-emerald-700">ไม่มีคำซ้ำกับหน้า Keyword ✓</p>
                )
              ) : (
                <p className="text-[11px] text-[#91a0b8]">ตรวจคำซ้ำล่วงหน้าไม่ได้ — ระบบปลายทาง upsert ให้อยู่แล้ว จะไม่เกิดคำซ้ำ</p>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button disabled={sending} onClick={() => setConfirmOpen(false)} className="rounded-xl border border-[#dbe1ee] px-4 py-2 text-xs font-semibold text-[#495975]">ยกเลิก</button>
              <button
                disabled={sending || selectedRows.length === 0}
                onClick={sendToKeywordPage}
                className="rounded-xl bg-[#155eef] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0d4fd8] disabled:opacity-50"
              >
                {sending ? 'กำลังส่ง…' : `ยืนยันส่ง ${selectedRows.length.toLocaleString('th-TH')} คำ`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
