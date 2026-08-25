'use client';

/**
 * WordGod — โหมด "มีหน้าร้าน / ธุรกิจในพื้นที่ (Local SME)"
 * Local SEO Keyword Intelligence Workspace
 *
 * เรียก /api/wordgod/local-research (NDJSON stream) แล้วแสดงผลเป็น workspace:
 * KPI cards → Data Source Status → Tabs (Overview / All Keywords / Wave 1 /
 * Clusters / Sitemap / Data Sources / Methodology) → ตารางเต็ม + Detail Drawer
 *
 * กติกาข้อมูล: Google กับ DataForSEO แสดงแยกคอลัมน์เสมอ ไม่มีการเฉลี่ยรวม,
 * NULL ≠ 0, ทุก action บนตาราง (filter/sort/หน้า) ทำใน memory — ไม่ยิง API ซ้ำ
 * ใช้ typography / ปุ่ม / การ์ด ชุดเดียวกับหน้า Keyword Research เดิม
 * ไม่แตะเส้นทาง Standard (ไม่มีหน้าร้าน) และไม่แก้หน้าอื่นใด ๆ
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { KeywordResearchProgress } from './KeywordResearchProgress';
import {
  INTENT_TAG_LABELS,
  SUGGESTED_PAGE_LABELS,
  scoreBreakdown,
} from '@/lib/wordgod/local';
import type {
  KeywordResearchResult,
  LocalAreaType,
  LocalBusinessType,
  LocalIntentTag,
  LocalResearchResponse,
} from '@/lib/wordgod/local/types';
import { referenceSourceLabel } from '@/lib/wordgod/local/metrics';
import { findNearbyAreas, normalizeAreaName, type AreaSuggestion } from '@/lib/wordgod/local/thaiAreas';

interface LocalProject {
  id: string;
  name: string;
  website: string;
  businessType: string;
}

interface Props {
  project: LocalProject;
  onSendToBank?: () => void;
}

const fieldClass = 'w-full rounded-xl border border-[#cfd9ea] bg-white px-3.5 py-3 text-sm text-[#17233a] placeholder:text-[#91a0b8] shadow-sm outline-none transition focus:border-[#155eef] focus:ring-4 focus:ring-[#155eef]/10';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[#495975]';
const cardClass = 'rounded-2xl border border-[#dbe1ee] bg-white shadow-[0_8px_30px_rgba(28,73,52,0.05)]';

const AREA_TYPE_OPTIONS: Array<{ value: LocalAreaType; label: string }> = [
  { value: 'district', label: 'เขต / อำเภอ' },
  { value: 'subdistrict', label: 'แขวง / ตำบล' },
  { value: 'province', label: 'จังหวัด' },
  { value: 'road', label: 'ถนน' },
  { value: 'bts', label: 'BTS' },
  { value: 'mrt', label: 'MRT' },
  { value: 'arl', label: 'Airport Rail Link' },
  { value: 'landmark', label: 'จุดสังเกต / ห้าง' },
];

const SUGGESTION_GROUPS: Array<{ relation: AreaSuggestion['relation']; label: string; hint: string }> = [
  { relation: 'subdistrict', label: 'แขวง / ตำบลในเขตนี้', hint: 'เจาะระดับย่อยที่สุด แข่งน้อย ปิดง่าย' },
  { relation: 'adjacent', label: 'เขต / อำเภอที่ติดกัน', hint: 'ขยายรัศมีโดยไม่หลุดพื้นที่ให้บริการ' },
  { relation: 'sibling', label: 'อำเภออื่นในจังหวัดเดียวกัน', hint: 'ขยายพื้นที่ระดับจังหวัด' },
  { relation: 'transit', label: 'สถานีรถไฟฟ้าใกล้เคียง', hint: 'คนค้นแบบอ้างอิงสถานี โดยเฉพาะคอนโด/ร้าน' },
];

const BUSINESS_TYPE_OPTIONS: Array<{ value: LocalBusinessType; label: string; hint: string }> = [
  { value: 'service_area', label: 'ออกไปหาลูกค้า', hint: 'ช่าง ทีมบริการ ส่งถึงที่ (Service Area)' },
  { value: 'storefront', label: 'ลูกค้ามาที่ร้าน', hint: 'มีหน้าร้าน คลินิก สำนักงาน (Storefront)' },
  { value: 'hybrid', label: 'มีทั้งสองแบบ', hint: 'มีหน้าร้านและออกไปให้บริการด้วย' },
];

const RADIUS_OPTIONS = [3, 5, 10, 15, 20];
const TARGET_PRESETS = [50, 100, 200, 300, 500, 550, 750, 1000];
/** น้ำหนัก Sales:Traffic — ตัวเลือกตามสเปก, ค่าเริ่มต้น 60/40 */
const WEIGHT_OPTIONS = [70, 60, 50, 40, 30];

const PRIORITY_LABELS: Record<string, string> = { high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' };
const PRIORITY_TO_NUMBER: Record<string, number> = { high: 3, medium: 2, low: 1 };

const SOURCE_LABELS: Record<string, string> = {
  generated: 'สร้างจากพื้นที่+บริการ',
  keyword_planner: 'Keyword Planner',
  dataforseo: 'DataForSEO',
  search_console: 'Search Console',
  suggest: 'Google Suggest',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  MEDIUM: 'border-blue-200 bg-blue-50 text-blue-800',
  LOW: 'border-amber-200 bg-amber-50 text-amber-800',
  LOCAL: 'border-violet-200 bg-violet-50 text-violet-800',
  NO_VOLUME: 'border-slate-200 bg-slate-50 text-slate-500',
};

const CONFIDENCE_TOOLTIP: Record<string, string> = {
  HIGH: 'Google และ DataForSEO ให้ตัวเลขตรงกัน (ต่างกัน ≤1.5 เท่า) — ใช้ได้อย่างมั่นใจ',
  MEDIUM: 'มีข้อมูลจากแหล่งเดียว หรือสองแหล่งต่างกันไม่เกิน 3 เท่า',
  LOW: 'สองแหล่งให้ตัวเลขต่างกันมาก (>3 เท่า) — ใช้ตัวเลขอย่างระวัง',
  LOCAL: 'volume ต่ำ/เป็นศูนย์ แต่ SERP มีหลักฐานธุรกิจท้องถิ่นจริง — โอกาสท้องถิ่นที่เครื่องมือวัดไม่ถึง',
  NO_VOLUME: 'ยังไม่มีข้อมูล volume จากแหล่งใด — ตรวจสอบก่อนนำไปใช้',
};

const INTENT_LABEL_TH: Record<string, string> = {
  transactional: 'พร้อมจ้าง',
  commercial: 'กำลังเลือกเจ้า',
  navigational: 'หาแบรนด์',
  informational: 'หาความรู้',
};

function bankIntent(intents: LocalIntentTag[]): { intent: string; funnelStage: string } {
  if (intents.some(t => t === 'price' || t === 'service_provider' || t === 'urgency' || t === 'near_me')) {
    return { intent: 'TRANSACTIONAL', funnelStage: 'BOFU' };
  }
  if (intents.some(t => t === 'commercial' || t === 'comparison')) {
    return { intent: 'COMMERCIAL', funnelStage: 'MOFU' };
  }
  if (intents.includes('local')) return { intent: 'TRANSACTIONAL', funnelStage: 'BOFU' };
  return { intent: 'INFORMATIONAL', funnelStage: 'TOFU' };
}

function parseLines(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\n,]/).map(line => line.trim()).filter(Boolean)
  ));
}

function formatBaht(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
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

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** objective ของคำ: informational = Traffic, ที่เหลือ = Sales (ตรงกับ Excel export) */
function objectiveOf(row: KeywordResearchResult): 'Sales' | 'Traffic' {
  const intent = row.intel?.searchIntent.intent;
  if (intent) return intent === 'informational' ? 'Traffic' : 'Sales';
  return row.intents.includes('informational') || row.intents.includes('question') ? 'Traffic' : 'Sales';
}

/** สถานะแหล่งข้อมูลรายคำ → ข้อความใน tooltip (ตรงไปตรงมา ไม่กลบ error) */
function metricStatusText(status: string | undefined, value: number | null | undefined): string {
  if (status === 'ok' || status === 'zero') return fmtInt(value ?? 0);
  if (status === 'api_error') return 'API error';
  if (status === 'no_data') return 'ไม่มีข้อมูล';
  return 'ไม่ได้ดึง';
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

/**
 * Reference Volume + ป้ายที่มา — tooltip โชว์ทั้งสองแหล่งแยกกัน พร้อม geo และวันที่
 * (สเปก §26–§28: ห้ามเฉลี่ย, ห้ามอ้างระดับเขตถ้าข้อมูลเป็นระดับจังหวัด/ประเทศ)
 */
function ReferenceVolumeCell({ row }: { row: KeywordResearchResult }) {
  const i = row.intel;
  if (!i) {
    if (row.volume === null || row.volume === undefined) return <span className="text-[#c7cfde]">—</span>;
    return <span className="tabular-nums">{fmtInt(row.volume)}</span>;
  }
  const tooltip = [
    `Google Keyword Planner: ${metricStatusText(i.google.status, i.google.avgMonthlySearches)}`
    + (i.google.geoTarget ? ` @ ${i.google.geoTarget} (${i.google.geoLevel})` : '')
    + (i.google.retrievedAt ? ` · ${fmtDate(i.google.retrievedAt)}` : ''),
    `DataForSEO: ${metricStatusText(i.dfs.status, i.dfs.searchVolume)}`
    + ` @ Thailand` + (i.dfs.retrievedAt ? ` · ${fmtDate(i.dfs.retrievedAt)}` : ''),
    'ตัวเลขสองแหล่งเก็บแยกกัน ไม่มีการเฉลี่ยรวม',
  ].join('\n');
  return (
    <span className="inline-flex cursor-help items-center gap-1.5" title={tooltip}>
      {i.referenceVolume === null
        ? <span className="text-[#c7cfde]">—</span>
        : <span className="tabular-nums font-semibold">{fmtInt(i.referenceVolume)}</span>}
      <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${
        i.referenceSource === 'google_keyword_planner' ? 'bg-[#e7f0ff] text-[#0d4fd8]'
          : i.referenceSource === 'dataforseo' ? 'bg-[#fdf0e7] text-[#c46a12]'
            : 'bg-[#f1f3f8] text-[#91a0b8]'
      }`}>
        {referenceSourceLabel(i.referenceSource)}
      </span>
      {i.zeroVolumeLocalOpportunity ? (
        <span title="Local Opportunity — volume ต่ำแต่มีหลักฐานธุรกิจท้องถิ่นใน SERP จริง" className="rounded bg-violet-50 px-1 py-0.5 text-[9px] font-bold text-violet-700">LOCAL</span>
      ) : null}
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

function TrendSpark({ trend }: { trend?: number[] }) {
  if (!trend || trend.length < 2) return <span className="text-[#c7cfde]">—</span>;
  const w = 72, h = 22, max = Math.max(...trend, 1);
  const pts = trend.map((v, i) => `${(i / (trend.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  const rising = trend[trend.length - 1] >= (trend[0] || 0);
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={rising ? '#1d48f3' : '#e35336'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
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

// ── คอลัมน์ + การเรียงของตารางหลัก ────────────────────────────────────────────

type SortKey = 'final' | 'sales' | 'traffic' | 'ref' | 'kd' | 'cpc';

function sortValue(row: KeywordResearchResult, key: SortKey): number {
  const i = row.intel;
  switch (key) {
    case 'final': return i?.finalScore ?? row.score.total;
    case 'sales': return i?.salesScore.total ?? -1;
    case 'traffic': return i?.trafficScore.total ?? -1;
    case 'ref': return i?.referenceVolume ?? row.volume ?? -1;
    case 'kd': return i?.dfs.keywordDifficulty ?? -1;
    case 'cpc': return i?.dfs.cpc ?? i?.google.bidHighMicros ?? row.bidHigh ?? -1;
  }
}

export default function WordGodLocalPanel({ project, onSendToBank }: Props) {
  // ── ฟอร์มซ้าย ──
  const [serviceText, setServiceText] = useState('');
  const [primaryLocation, setPrimaryLocation] = useState('');
  const [primaryType, setPrimaryType] = useState<LocalAreaType>('district');
  const [primaryParent, setPrimaryParent] = useState('');
  const [nearbyText, setNearbyText] = useState('');
  const [businessType, setBusinessType] = useState<LocalBusinessType>('storefront');
  const [radius, setRadius] = useState<number | null>(null);
  const [language, setLanguage] = useState<'th' | 'th_en'>('th');
  const [expandWithKP, setExpandWithKP] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [targetCount, setTargetCount] = useState(50);
  // น้ำหนัก Sales (%) — Traffic = 100 − sales, ค่าเริ่มต้น 60/40
  const [salesWeightPct, setSalesWeightPct] = useState(60);

  // ── สถานะรัน + ผลลัพธ์ ──
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  type SitemapPage = { page: string; pageType: string; slug: string; category?: string; clusterId?: number; pillarSlug?: string; role?: 'pillar' | 'supporting' | 'standalone'; keywords: Array<{ keyword: string; volume: number | null; title?: string }> };
  type TopicCluster = { clusterId: number; name: string; pillarSlug: string; memberSlugs: string[]; totalVolume: number };
  type FullResponse = LocalResearchResponse & { sitemap?: SitemapPage[]; topicClusters?: TopicCluster[] };
  const [data, setData] = useState<FullResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Workspace: tabs + ตัวกรอง + เรียง + หน้า + drawer ──
  type Tab = 'overview' | 'keywords' | 'wave1' | 'clusters' | 'sitemap' | 'sources' | 'method';
  const [tab, setTab] = useState<Tab>('keywords');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [objectiveFilter, setObjectiveFilter] = useState('all');
  const [waveFilter, setWaveFilter] = useState('all');
  const [clusterFilter, setClusterFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('final');
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [drawerKeyword, setDrawerKeyword] = useState<string | null>(null);

  // debounce ช่องค้นหา — กันตารางใหญ่กระตุกตอนพิมพ์
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [queryInput]);

  // เปลี่ยนตัวกรอง/เรียง → กลับหน้าแรกเสมอ
  useEffect(() => {
    setPage(1);
  }, [query, confidenceFilter, objectiveFilter, waveFilter, clusterFilter, sortKey, sortDesc, tab, pageSize]);

  const results = data?.results ?? [];
  const clusters = data?.clusters ?? [];
  const meta = data?.meta;
  const hasIntel = results.some(r => !!r.intel);

  // ── ตัวกรอง + เรียง (ทำงานใน memory ทั้งหมด — ไม่มี API call) ──
  const filtered = useMemo(() => {
    const base = tab === 'wave1' ? results.filter(r => r.intel?.wave === 1) : results;
    const rows = base.filter(row => {
      if (query && !row.keyword.toLowerCase().includes(query) && !(row.suggestedTitle ?? '').toLowerCase().includes(query)) return false;
      if (confidenceFilter !== 'all' && (row.intel?.confidence ?? 'NO_VOLUME') !== confidenceFilter) return false;
      if (objectiveFilter !== 'all' && objectiveOf(row) !== objectiveFilter) return false;
      if (waveFilter !== 'all' && String(row.intel?.wave ?? '') !== waveFilter) return false;
      if (clusterFilter !== 'all' && (row.cluster ?? row.service) !== clusterFilter) return false;
      return true;
    });
    const sorted = [...rows].sort((a, b) => {
      const diff = sortValue(b, sortKey) - sortValue(a, sortKey);
      return sortDesc ? diff : -diff;
    });
    return sorted;
  }, [results, tab, query, confidenceFilter, objectiveFilter, waveFilter, clusterFilter, sortKey, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  /** อันดับตาม Final Score ในชุดเต็ม (คงที่ ไม่เปลี่ยนตามตัวกรอง) */
  const rankByKeyword = useMemo(() => {
    const m = new Map<string, number>();
    [...results]
      .sort((a, b) => (b.intel?.finalScore ?? b.score.total) - (a.intel?.finalScore ?? a.score.total))
      .forEach((r, idx) => m.set(r.keyword, idx + 1));
    return m;
  }, [results]);

  const kpi = useMemo(() => {
    const total = results.length;
    const highConf = results.filter(r => r.intel?.confidence === 'HIGH').length;
    const kdVals = results.map(r => r.intel?.dfs.keywordDifficulty).filter((v): v is number => typeof v === 'number');
    const localPack = results.filter(r => r.intel?.serp.hasLocalPack).length;
    const refDemand = results.reduce((sum, r) => sum + (r.intel?.referenceVolume ?? r.volume ?? 0), 0);
    const wave1 = results.filter(r => r.intel?.wave === 1).length;
    return {
      total,
      candidates: meta?.candidateCount ?? total,
      refDemand,
      highConfPct: total ? Math.round((highConf / total) * 100) : 0,
      avgKd: kdVals.length ? Math.round(kdVals.reduce((a, b) => a + b, 0) / kdVals.length) : null,
      localPack,
      clusters: clusters.length,
      wave1,
    };
  }, [results, clusters, meta]);

  const clusterNames = useMemo(
    () => Array.from(new Set(results.map(r => r.cluster ?? r.service).filter(Boolean))) as string[],
    [results]
  );

  const drawerRow = useMemo(
    () => (drawerKeyword ? results.find(r => r.keyword === drawerKeyword) ?? null : null),
    [drawerKeyword, results]
  );

  // ── ฐานข้อมูลพื้นที่ (เหมือนเดิม) ──
  const localMatch = useMemo(() => findNearbyAreas(primaryLocation), [primaryLocation]);
  const [nationwideMatch, setNationwideMatch] = useState<ReturnType<typeof findNearbyAreas>>(null);
  useEffect(() => {
    if (localMatch || !primaryLocation.trim()) { setNationwideMatch(null); return; }
    let cancelled = false;
    import('@/lib/wordgod/local/thaiAreasNationwide')
      .then(m => m.findNearbyAreasNationwide(primaryLocation))
      .then(match => { if (!cancelled) setNationwideMatch(match); })
      .catch(() => { if (!cancelled) setNationwideMatch(null); });
    return () => { cancelled = true; };
  }, [primaryLocation, localMatch]);
  const areaMatch = localMatch ?? nationwideMatch;

  const pickedNearby = useMemo(
    () => new Set(parseLines(nearbyText).map(normalizeAreaName)),
    [nearbyText]
  );

  function toggleNearby(name: string): void {
    const current = parseLines(nearbyText);
    const key = normalizeAreaName(name);
    const next = current.some(item => normalizeAreaName(item) === key)
      ? current.filter(item => normalizeAreaName(item) !== key)
      : [...current, name];
    setNearbyText(next.join(', '));
  }

  function addSuggestionGroup(relation: AreaSuggestion['relation']): void {
    if (!areaMatch) return;
    const current = parseLines(nearbyText);
    const seen = new Set(current.map(normalizeAreaName));
    for (const suggestion of areaMatch.suggestions) {
      if (suggestion.relation !== relation) continue;
      const key = normalizeAreaName(suggestion.name);
      if (seen.has(key)) continue;
      seen.add(key);
      current.push(suggestion.name);
    }
    setNearbyText(current.join(', '));
  }

  // ── รันวิจัย: NDJSON stream → progress จริงทีละขั้น → ผลลัพธ์ก้อนเดียว ──
  const runningRef = useRef(false);
  async function runResearch(): Promise<void> {
    if (runningRef.current) return;
    const services = parseLines(serviceText);
    if (services.length === 0) {
      setStatus('error');
      setStatusMessage('กรุณาระบุบริการหรือคำหลักอย่างน้อย 1 อย่าง');
      return;
    }
    if (!primaryLocation.trim()) {
      setStatus('error');
      setStatusMessage('กรุณาระบุพื้นที่หลักที่ให้บริการ');
      return;
    }

    runningRef.current = true;
    setStatus('running');
    setStatusMessage('กำลังเริ่มวิเคราะห์…');
    setProgressLogs([]);
    setData(null);
    setDrawerKeyword(null);

    const body = {
      services,
      primaryLocation: {
        name: primaryLocation.trim(),
        type: primaryType,
        parent: primaryParent.trim() || areaMatch?.province || undefined,
      },
      nearbyLocations: parseLines(nearbyText).map(name => {
        const known = areaMatch?.suggestions.find(
          s => normalizeAreaName(s.name) === normalizeAreaName(name)
        );
        return { name, type: known?.type ?? 'district', parent: known?.parent };
      }),
      businessType,
      serviceRadiusKm: radius,
      language,
      businessContext: [project.name, project.businessType].filter(Boolean).join(' — '),
      targetCount,
      salesWeight: salesWeightPct / 100,
      trafficWeight: (100 - salesWeightPct) / 100,
      expandWithKeywordPlanner: expandWithKP,
      projectId: project.id,
      stream: true,
      resumable: true, // run ยาวถูกซอยเป็นหลาย request ฝั่ง server (กัน Vercel maxDuration ตัด)
    };

    try {
      // โหมด resumable: server ทำงานเป็นช่วง ๆ ตามงบเวลา แล้วส่ง event `yield` พร้อม runId
      // → client ยิง resumeRunId ทำต่อจาก checkpoint จนได้ result (run ใหญ่ไม่โดน maxDuration ตัด)
      let payload: FullResponse | null = null;
      let resumeRunId: string | null = null;
      let retries = 0; // network สะดุด: ต่อจาก checkpoint เดิมได้สูงสุด 3 ครั้งติด
      let lockWaits = 0;
      for (;;) {
        let response: Response;
        try {
          response = await fetch('/api/wordgod/local-research', {
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
          // อ่าน progress จริงทีละบรรทัด — ไม่มี loading เปล่า ๆ
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
                } else if (event.type === 'run' && typeof event.runId === 'string') {
                  resumeRunId = event.runId;
                } else if (event.type === 'yield' && typeof event.runId === 'string') {
                  resumeRunId = event.runId;
                  yielded = true;
                } else if (event.type === 'result') {
                  payload = event.data as FullResponse;
                } else if (event.type === 'error') {
                  const e = new Error(String(event.error ?? 'เกิดข้อผิดพลาด'));
                  (e as any).fromServer = true;
                  throw e;
                }
              }
            }
          } catch (err) {
            // สายหลุดกลาง stream (ไม่ใช่ error จริงจาก server) — ต่อจาก checkpoint ได้ถ้ารู้ runId
            if ((err as any)?.fromServer || !resumeRunId || retries >= 3) throw err;
            retries++;
            setStatusMessage(`การเชื่อมต่อสะดุด — กำลังทำต่อจากจุดเดิม (ครั้งที่ ${retries}) …`);
            await new Promise(r => setTimeout(r, 3000 * retries));
            continue;
          }
          if (payload) break;
          if (yielded) { retries = 0; continue; } // ช่วงนี้จบตามงบเวลา — ยิงต่อทันที
          if (resumeRunId && retries < 3) {
            retries++;
            setStatusMessage(`การเชื่อมต่อสะดุด — กำลังทำต่อจากจุดเดิม (ครั้งที่ ${retries}) …`);
            await new Promise(r => setTimeout(r, 3000 * retries));
            continue;
          }
          throw new Error('การเชื่อมต่อถูกตัดก่อนได้ผลลัพธ์ — ลองใหม่อีกครั้ง');
        } else {
          // fallback: เซิร์ฟเวอร์ตอบ JSON ก้อนเดียว (เวอร์ชันเก่า/พร็อกซีไม่รองรับ stream)
          const json = await response.json().catch(() => ({}));
          if (response.status === 202 && json.runId) {
            resumeRunId = String(json.runId);
            retries = 0;
            continue;
          }
          if (response.status === 409 && json.locked && lockWaits < 40) {
            // request ก่อนหน้าของ run เดียวกันยังถือ lock อยู่ — รอ (server ปลด lock ค้างเองใน 5 นาที)
            lockWaits++;
            setStatusMessage('รอรอบประมวลผลก่อนหน้าของ run นี้ปิดตัว …');
            await new Promise(r => setTimeout(r, 8000));
            continue;
          }
          if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
          payload = json as FullResponse;
          break;
        }
      }
      if (!payload) throw new Error('การเชื่อมต่อถูกตัดก่อนได้ผลลัพธ์ — ลองใหม่อีกครั้ง');

      setData(payload);
      setTab('keywords');
      setQueryInput(''); setQuery('');
      setConfidenceFilter('all'); setObjectiveFilter('all'); setWaveFilter('all'); setClusterFilter('all');
      setSortKey('final'); setSortDesc(true); setPage(1);
      setStatus('done');
      setStatusMessage(`ได้ ${payload.results?.length ?? 0} SEO Opportunities`);
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
    if (researchId) {
      setExporting(true);
      try {
        const res = await fetch(`/api/wordgod/local-research/export?researchId=${encodeURIComponent(researchId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Export ไม่สำเร็จ (HTTP ${res.status})`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') ?? '';
        const m = disposition.match(/filename="([^"]+)"/);
        downloadBlob(blob, m?.[1] ?? `keyword-research-${targetCount}.xlsx`);
        toast.success('ดาวน์โหลดไฟล์ Excel แล้ว (7 ชีต จากข้อมูลชุดเดียวกับตาราง)');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Export Excel ไม่สำเร็จ');
      } finally {
        setExporting(false);
      }
      return;
    }
    // run ไม่ได้ถูกบันทึก (ดู warnings) → ให้ CSV จากข้อมูลชุดเดียวกันในหน้านี้แทน
    exportCsv();
    toast.warning('ผลชุดนี้ไม่ได้ถูกบันทึกลงฐานข้อมูล — ดาวน์โหลดเป็น CSV จากข้อมูลบนหน้านี้แทน');
  }

  function exportCsv(): void {
    if (results.length === 0) return;
    const header = [
      'Rank', 'Keyword', 'SEO Title', 'Slug', 'Reference Volume', 'Volume Source', 'Google Volume', 'DFS Volume',
      'Confidence', 'Intent', 'Cluster', 'Objective', 'KD', 'CPC (THB)', 'Sales Score', 'Traffic Score', 'Final Score',
      'Wave', 'Suggested Page', 'Location', 'Sources',
    ];
    const lines = [header.join(',')];
    for (const row of filtered) {
      const i = row.intel;
      lines.push([
        csvCell(rankByKeyword.get(row.keyword)),
        csvCell(row.keyword),
        csvCell(row.suggestedTitle),
        csvCell(row.slug),
        csvCell(i ? i.referenceVolume ?? 'N/A' : row.volume ?? 'N/A'),
        csvCell(i ? referenceSourceLabel(i.referenceSource) : ''),
        csvCell(i && (i.google.status === 'ok' || i.google.status === 'zero') ? i.google.avgMonthlySearches ?? 0 : 'N/A'),
        csvCell(i && (i.dfs.status === 'ok' || i.dfs.status === 'zero') ? i.dfs.searchVolume ?? 0 : 'N/A'),
        csvCell(i?.confidence),
        csvCell(i?.searchIntent.intent ?? row.intents[0]),
        csvCell(row.cluster ?? row.service),
        csvCell(objectiveOf(row)),
        csvCell(i?.dfs.keywordDifficulty ?? 'N/A'),
        csvCell(i?.dfs.cpc ?? i?.google.bidHighMicros ?? row.bidHigh ?? 'N/A'),
        csvCell(i ? Math.round(i.salesScore.total) : ''),
        csvCell(i ? Math.round(i.trafficScore.total) : ''),
        csvCell(i ? Math.round(i.finalScore * 10) / 10 : row.score.total),
        csvCell(i?.wave ?? ''),
        csvCell(row.suggestedPage ? SUGGESTED_PAGE_LABELS[row.suggestedPage] : ''),
        csvCell(row.location),
        csvCell(row.sources.map(s => SOURCE_LABELS[s] ?? s).join(' | ')),
      ].join(','));
    }
    downloadBlob(
      new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
      `keyword-research-local-${Date.now()}.csv`,
    );
  }

  async function saveToKeywordBank(): Promise<void> {
    if (filtered.length === 0) return;
    setSaving(true);
    try {
      const rows = filtered.map(row => {
        const mapped = bankIntent(row.intents);
        const i = row.intel;
        return {
          keyword: row.keyword,
          volume: (i?.referenceVolume ?? row.volume) ?? undefined,
          intent: mapped.intent,
          funnelStage: mapped.funnelStage,
          priority: PRIORITY_TO_NUMBER[row.priority] ?? undefined,
          seedKeyword: row.service || undefined,
          meta: {
            priorityScore: row.score.total,
            finalScore: i?.finalScore,
            salesScore: i ? Math.round(i.salesScore.total) : undefined,
            trafficScore: i ? Math.round(i.trafficScore.total) : undefined,
            confidence: i?.confidence,
            referenceSource: i?.referenceSource,
            wave: i?.wave,
            scoreBreakdown: row.score,
            intents: row.intents,
            location: row.location,
            locationRole: row.locationRole,
            adsCompetition: row.adsCompetition,
            competitionIndex: row.competitionIndex,
            bidLow: row.bidLow,
            bidHigh: row.bidHigh,
            cluster: row.cluster,
            suggestedPage: row.suggestedPage,
            sources: row.sources,
          },
        };
      });
      const response = await fetch(`/api/projects/${project.id}/keyword-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source: 'keyword-research-local' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'บันทึกเข้า Keyword Bank ไม่สำเร็จ');
      toast.success(`บันทึกเข้า Keyword Bank แล้ว (สร้างใหม่ ${payload.created ?? 0} • อัปเดต ${payload.updated ?? 0})`);
      onSendToBank?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกเข้า Keyword Bank ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const kpDegraded = meta?.keywordPlannerStatus === 'unavailable';
  const sourceStatus = meta?.sourceStatus;

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDesc ? ' ▾' : ' ▴') : '';

  // ── ตารางคีย์เวิร์ดหลัก (ใช้ทั้งแท็บ All Keywords และ Wave 1) ──
  const keywordTable = (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eef1f7] px-4 py-2.5">
        <input
          className="w-52 rounded-xl border border-[#cfd9ea] bg-white px-3 py-2 text-xs outline-none focus:border-[#155eef]"
          value={queryInput}
          onChange={event => setQueryInput(event.target.value)}
          placeholder="ค้นหาคีย์เวิร์ด / title"
        />
        {hasIntel ? (
          <>
            <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={confidenceFilter} onChange={e => setConfidenceFilter(e.target.value)}>
              <option value="all">ทุก Confidence</option>
              {['HIGH', 'MEDIUM', 'LOW', 'LOCAL', 'NO_VOLUME'].map(c => <option key={c} value={c}>{c === 'NO_VOLUME' ? 'NO VOLUME' : c}</option>)}
            </select>
            <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={objectiveFilter} onChange={e => setObjectiveFilter(e.target.value)}>
              <option value="all">Sales + Traffic</option>
              <option value="Sales">เฉพาะ Sales</option>
              <option value="Traffic">เฉพาะ Traffic</option>
            </select>
            {tab !== 'wave1' ? (
              <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={waveFilter} onChange={e => setWaveFilter(e.target.value)}>
                <option value="all">ทุก Wave</option>
                <option value="1">Wave 1</option>
                <option value="2">Wave 2</option>
                <option value="3">Wave 3</option>
              </select>
            ) : null}
          </>
        ) : null}
        <select className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1.5 text-[11px] text-[#495975]" value={clusterFilter} onChange={e => setClusterFilter(e.target.value)}>
          <option value="all">ทุกคลัสเตอร์</option>
          {clusterNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="ml-auto text-[11px] text-[#91a0b8]">{filtered.length.toLocaleString('th-TH')} คำ</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] border-collapse text-xs">
          <thead className="bg-[#f7f9fd] text-left text-[11px] uppercase tracking-wide text-[#71809c]">
            <tr>
              <th className="px-3 py-2.5 font-semibold">#</th>
              <th className="px-3 py-2.5 font-semibold">คีย์เวิร์ด</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('ref')}
                title="Reference Volume = Google ถ้ามี → DataForSEO → ไม่มีทั้งคู่ = — (ไม่มีการเฉลี่ยรวม)">
                Ref. Volume{sortIndicator('ref')}
              </th>
              <th className="px-3 py-2.5 text-right font-semibold" title="Google Keyword Planner (แหล่งอ้างอิงหลัก)">Google</th>
              <th className="px-3 py-2.5 text-right font-semibold" title="DataForSEO (แหล่ง cross-check)">DFS</th>
              <th className="px-3 py-2.5 font-semibold" title="ระดับความเชื่อมั่นของตัวเลข — เทียบสองแหล่ง">Conf.</th>
              <th className="px-3 py-2.5 font-semibold" title="Search intent จาก DataForSEO (ไม่ใช่ AI เดา)">Intent</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('kd')}
                title="Keyword Difficulty 0–100 (DataForSEO) — ความยาก SEO จริง">KD{sortIndicator('kd')}</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('cpc')}>CPC ฿{sortIndicator('cpc')}</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('sales')}
                title="โอกาสได้ลูกค้า 0–100">Sales{sortIndicator('sales')}</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('traffic')}
                title="โอกาสได้ผู้เข้าชม 0–100">Traffic{sortIndicator('traffic')}</th>
              <th className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-[#0d4fd8]" onClick={() => toggleSort('final')}
                title={`Final = Sales×${meta?.opportunityWeights ? Math.round(meta.opportunityWeights.sales * 100) : 60}% + Traffic×${meta?.opportunityWeights ? Math.round(meta.opportunityWeights.traffic * 100) : 40}% − โทษความไม่แน่นอนของข้อมูล`}>
                Final{sortIndicator('final')}
              </th>
              <th className="px-3 py-2.5 font-semibold">Trend</th>
              <th className="px-3 py-2.5 font-semibold">หน้า</th>
              <th className="px-3 py-2.5 font-semibold" title="ลำดับการเผยแพร่: Wave 1 ≈15% แรก → Wave 2 ≈30% → Wave 3 ที่เหลือ">Wave</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(row => {
              const i = row.intel;
              return (
                <tr
                  key={row.keyword}
                  onClick={() => setDrawerKeyword(row.keyword)}
                  className="cursor-pointer border-t border-[#eef1f7] align-top transition hover:bg-[#f4f8fe]"
                >
                  <td className="px-3 py-2.5 tabular-nums text-[#91a0b8]">{rankByKeyword.get(row.keyword)}</td>
                  <td className="max-w-[320px] px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#17233a]">{row.keyword}</span>
                    </div>
                    {row.suggestedTitle ? (
                      <div className="mt-0.5 truncate text-[10px] leading-4 text-[#0d4fd8]" title={row.suggestedTitle}>✍ {row.suggestedTitle}</div>
                    ) : null}
                    {i?.secondaryKeywords.length ? (
                      <div className="mt-0.5 text-[10px] text-[#91a0b8]" title={`คำรองที่ถูกรวมเข้าคำนี้ (เจตนาซ้ำกัน): ${i.secondaryKeywords.join(', ')}`}>
                        +{i.secondaryKeywords.length} คำรอง
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right"><ReferenceVolumeCell row={row} /></td>
                  <td className="px-3 py-2.5 text-right"><SingleSourceVolumeCell status={i?.google.status} value={i?.google.avgMonthlySearches} /></td>
                  <td className="px-3 py-2.5 text-right"><SingleSourceVolumeCell status={i?.dfs.status} value={i?.dfs.searchVolume} /></td>
                  <td className="px-3 py-2.5"><ConfidenceBadge confidence={i?.confidence} /></td>
                  <td className="px-3 py-2.5">
                    {i?.searchIntent.intent ? (
                      <span title={`จาก DataForSEO · ความน่าจะเป็น ${i.searchIntent.probability !== null ? Math.round(i.searchIntent.probability * 100) + '%' : '—'}`} className="cursor-help text-[#495975]">
                        {INTENT_LABEL_TH[i.searchIntent.intent] ?? i.searchIntent.intent}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#91a0b8]">{row.intents.slice(0, 2).map(t => INTENT_TAG_LABELS[t]).join(' · ') || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{i?.dfs.keywordDifficulty ?? <span className="text-[#c7cfde]">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatBaht(i?.dfs.cpc ?? i?.google.bidHighMicros ?? row.bidHigh)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{i ? Math.round(i.salesScore.total) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{i ? Math.round(i.trafficScore.total) : '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="rounded-lg bg-[#eff4fe] px-2 py-0.5 font-bold tabular-nums text-[#0d4fd8]">
                      {i ? (Math.round(i.finalScore * 10) / 10).toFixed(1) : row.score.total}
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><TrendSpark trend={row.trend} /></td>
                  <td className="px-3 py-2.5 text-[#495975]">{row.suggestedPage ? SUGGESTED_PAGE_LABELS[row.suggestedPage] : '—'}</td>
                  <td className="px-3 py-2.5">
                    {i?.wave ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${i.wave === 1 ? 'bg-[#155eef] text-white' : i.wave === 2 ? 'bg-[#dbe7fd] text-[#0d4fd8]' : 'bg-[#eef1f7] text-[#606f8c]'}`}>
                        W{i.wave}
                      </span>
                    ) : <span className="text-[#c7cfde]">—</span>}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr><td colSpan={15} className="px-4 py-10 text-center text-[#91a0b8]">ไม่มีคีย์เวิร์ดที่ตรงกับตัวกรองนี้</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize || pageSize !== 50 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f7] px-4 py-2.5 text-[11px] text-[#495975]">
          <span>
            แสดง {((page - 1) * pageSize + 1).toLocaleString('th-TH')}–{Math.min(page * pageSize, filtered.length).toLocaleString('th-TH')} จาก {filtered.length.toLocaleString('th-TH')} คำ
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <select className="rounded-lg border border-[#dbe1ee] bg-white px-1.5 py-1" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}/หน้า</option>)}
            </select>
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1 font-semibold disabled:opacity-40">←</button>
            <span className="tabular-nums">หน้า {page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-lg border border-[#dbe1ee] bg-white px-2.5 py-1 font-semibold disabled:opacity-40">→</button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6 px-1 py-4 lg:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <section className={`${cardClass} p-5`}>
          <div className="mb-4">
            <h1 className="text-xl font-bold tracking-tight">หาคีย์เวิร์ดลูกค้าในพื้นที่</h1>
            <p className="mt-1 text-xs leading-5 text-[#71809c]">
              โหมดมีหน้าร้าน — Local SEO Intelligence: ดึงตัวเลขจริงจาก Google Keyword Planner + DataForSEO
              ให้คะแนนโอกาสขาย/โอกาส traffic ต่อคำ แล้วคัดเฉพาะคำที่ควรทำจริง
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className={labelClass}>บริการหลัก (Service) *</label>
              <textarea
                className={`${fieldClass} min-h-20 resize-y`}
                value={serviceText}
                onChange={event => setServiceText(event.target.value)}
                placeholder={'หนึ่งบริการต่อบรรทัด\nล้างแอร์\nซ่อมแอร์\nติดตั้งแอร์'}
              />
              <p className="mt-1 text-[10px] leading-4 text-[#71809c]">ใส่ได้หลายบริการ ระบบจะแยกคีย์เวิร์ดให้แต่ละบริการ</p>
            </div>

            <div>
              <label className={labelClass}>ทำเลหลัก (Primary Location) *</label>
              <input
                className={fieldClass}
                value={primaryLocation}
                onChange={event => setPrimaryLocation(event.target.value)}
                placeholder="เช่น บางแค"
              />
              {areaMatch ? (
                <p className="mt-1 text-[10px] leading-4 text-[#0a7a45]">
                  รู้จักพื้นที่นี้ · {areaMatch.matchedVia === 'subdistrict' ? `อยู่ในเขต${areaMatch.name}` : `เขต${areaMatch.name}`} จ.{areaMatch.province} — เลือกทำเลรองจากรายการด้านล่างได้เลย
                </p>
              ) : primaryLocation.trim() ? (
                <p className="mt-1 text-[10px] leading-4 text-[#71809c]">
                  ยังไม่พบพื้นที่นี้ในฐานข้อมูล (ครอบคลุมทุกจังหวัด/อำเภอ/ตำบลทั่วประเทศ) — เช็คตัวสะกด หรือกรอกทำเลรองเองด้านล่างได้
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClass}>ทำเลรอง / ใกล้เคียง (Secondary Locations)</label>
              <textarea
                className={`${fieldClass} min-h-20 resize-y`}
                value={nearbyText}
                onChange={event => setNearbyText(event.target.value)}
                placeholder={'คั่นด้วยบรรทัดหรือจุลภาค\nบางหว้า, ภาษีเจริญ, หนองแขม'}
              />

              {areaMatch ? (
                <div className="mt-2 space-y-3 rounded-2xl border border-[#cfdefa] bg-[#f4f8fe] p-3">
                  {SUGGESTION_GROUPS.map(group => {
                    const items = areaMatch.suggestions.filter(s => s.relation === group.relation);
                    if (items.length === 0) return null;
                    return (
                      <div key={group.relation}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#495975]">{group.label}</span>
                          <button
                            onClick={() => addSuggestionGroup(group.relation)}
                            className="shrink-0 text-[10px] font-semibold text-[#0d4fd8] hover:underline"
                          >
                            + เพิ่มทั้งหมด
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(item => {
                            const picked = pickedNearby.has(normalizeAreaName(item.name));
                            return (
                              <button
                                key={`${item.relation}-${item.name}`}
                                onClick={() => toggleNearby(item.name)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                  picked
                                    ? 'border-[#155eef] bg-[#155eef] text-white'
                                    : 'border-[#cfd9ea] bg-white text-[#495975] hover:border-[#155eef] hover:text-[#0d4fd8]'
                                }`}
                              >
                                {picked ? '✓ ' : '+ '}{item.name}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-[#71809c]">{group.hint}</p>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div>
              <label className={labelClass}>จำนวน Keyword / SEO Opportunities ที่ต้องการ</label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {TARGET_PRESETS.map(n => (
                  <button
                    key={n}
                    onClick={() => setTargetCount(n)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      targetCount === n
                        ? 'border-[#155eef] bg-[#155eef] text-white'
                        : 'border-[#cfd9ea] bg-white text-[#495975] hover:border-[#155eef] hover:text-[#0d4fd8]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="range" min={10} max={1000} step={10} value={targetCount}
                  onChange={e => setTargetCount(Number(e.target.value))} className="flex-1 accent-brand-blue" />
                <input type="number" min={10} max={1000} step={1} value={targetCount}
                  onChange={e => setTargetCount(Math.min(1000, Math.max(10, Math.round(Number(e.target.value) || 50))))}
                  className="h-8 w-16 rounded-lg border border-[#bcc9e2] bg-white px-2 text-center text-xs font-bold" />
              </div>
              <p className="mb-3 mt-1 text-[10px] leading-4 text-[#71809c]">
                นี่คือจำนวน "คำที่ผ่านการคัดแล้ว" ที่จะได้ — ระบบจะวิเคราะห์ candidate มากกว่านี้หลายเท่า
                แล้วคัด รวมคำซ้ำ และตัดคำไม่เกี่ยวข้องออกก่อนถึงมือคุณ
              </p>
              <label className={labelClass}>ประเภทธุรกิจ (หน้าร้าน / ไปหาลูกค้า)</label>
              <select className={fieldClass} value={businessType} onChange={event => setBusinessType(event.target.value as LocalBusinessType)}>
                {BUSINESS_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="mt-1 text-[10px] leading-4 text-[#71809c]">
                {BUSINESS_TYPE_OPTIONS.find(option => option.value === businessType)?.hint}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>รัศมีบริการ (Service Radius)</label>
                <select className={fieldClass} value={radius ?? ''} onChange={event => setRadius(event.target.value ? Number(event.target.value) : null)}>
                  <option value="">ไม่ระบุ</option>
                  {RADIUS_OPTIONS.map(km => <option key={km} value={km}>{km} กม.</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>ภาษา</label>
                <select className={fieldClass} value={language} onChange={event => setLanguage(event.target.value as 'th' | 'th_en')}>
                  <option value="th">ไทย</option>
                  <option value="th_en">ไทย + อังกฤษ</option>
                </select>
                <p className="mt-1 text-[10px] leading-4 text-[#71809c]">มีลูกค้าต่างชาติให้เลือกไทย + อังกฤษ</p>
              </div>
            </div>

            <button
              onClick={() => setShowAdvanced(previous => !previous)}
              className="text-[11px] font-semibold text-[#0d4fd8]"
            >
              {showAdvanced ? 'ซ่อนตัวเลือกขั้นสูง' : 'ตัวเลือกขั้นสูง (น้ำหนัก Sales/Traffic, ประเภทพื้นที่, จังหวัด)'}
            </button>

            {showAdvanced ? (
              <div className="space-y-4 rounded-2xl border border-[#cfdefa] bg-[#f4f8fe] p-4">
                <div>
                  <label className={labelClass}>น้ำหนักเป้าหมาย: ยอดขาย vs Traffic</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEIGHT_OPTIONS.map(pct => (
                      <button
                        key={pct}
                        onClick={() => setSalesWeightPct(pct)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                          salesWeightPct === pct
                            ? 'border-[#155eef] bg-[#155eef] text-white'
                            : 'border-[#cfd9ea] bg-white text-[#495975] hover:border-[#155eef]'
                        }`}
                      >
                        {pct}/{100 - pct}{pct === 60 ? ' (แนะนำ)' : ''}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-[#71809c]">
                    Sales {salesWeightPct}% / Traffic {100 - salesWeightPct}% — เอียงซ้ายเน้นคำที่ปิดลูกค้า
                    เอียงขวาเน้นคำที่ดึงผู้เข้าชม (มีผลต่อ Final Score และลำดับคำ)
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>ประเภทพื้นที่หลัก</label>
                    <select className={fieldClass} value={primaryType} onChange={event => setPrimaryType(event.target.value as LocalAreaType)}>
                      {AREA_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>จังหวัด / พื้นที่แม่</label>
                    <input
                      className={fieldClass}
                      value={primaryParent}
                      onChange={event => setPrimaryParent(event.target.value)}
                      placeholder={areaMatch?.province ?? 'กรุงเทพมหานคร'}
                    />
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-[#495975]">
                  <input type="checkbox" className="mt-0.5 accent-[#155eef]" checked={expandWithKP} onChange={event => setExpandWithKP(event.target.checked)} />
                  <span>ดึงคำแนะนำเพิ่มจาก Keyword Planner (ช้าลง แต่ได้คำที่คนค้นจริงเพิ่ม)</span>
                </label>
              </div>
            ) : null}

            <button
              disabled={status === 'running'}
              onClick={runResearch}
              className="w-full rounded-xl bg-[#155eef] px-4 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(21,94,239,0.22)] transition hover:bg-[#0d4fd8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'running' ? 'กำลังวิเคราะห์...' : 'หาคีย์เวิร์ดในพื้นที่'}
            </button>
          </div>
        </section>

        {status !== 'idle' ? (
          <section className={`${cardClass} px-4 py-3`}>
            <div className="flex items-start gap-2 text-xs font-semibold">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${status === 'running' ? 'animate-pulse bg-amber-500' : status === 'done' ? 'bg-blue-500' : 'bg-red-500'}`} />
              <span className="leading-5">{statusMessage}</span>
            </div>
            {meta?.locationTarget ? (
              <p className="mt-3 border-t border-[#eef1f7] pt-2 text-[10px] leading-4 text-[#71809c]">
                ข้อมูลยอดค้นหาอิงพื้นที่: <strong>{meta.locationTarget.resolved}</strong>
                {meta.locationTarget.level === 'country' ? ' (ระดับประเทศ)' : ''}
                {' '}· ขอ "{meta.locationTarget.requested}"
              </p>
            ) : null}
            {meta?.warnings?.length ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[10px] leading-4 text-amber-700">
                {meta.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}
              </ul>
            ) : null}
          </section>
        ) : null}
      </aside>

      <main className="space-y-4">
        {kpDegraded && data ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <span>{meta?.keywordPlannerMessage}</span>
            <button onClick={runResearch} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-900">
              ลองใหม่
            </button>
          </div>
        ) : null}

        {data ? (
          <>
            {/* ── Research Header ── */}
            <section className={`${cardClass} px-5 py-4`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[#17233a]">Keyword Intelligence Workspace</h2>
                  <p className="mt-0.5 text-[11px] text-[#71809c]">
                    {parseLines(serviceText).join(', ') || 'ผลการวิจัย'} @ {meta?.locationTarget.requested ?? primaryLocation}
                    {' '}· Sales {Math.round((meta?.opportunityWeights?.sales ?? 0.6) * 100)}% / Traffic {Math.round((meta?.opportunityWeights?.traffic ?? 0.4) * 100)}%
                    {' '}· {fmtDate(meta?.generatedAt)}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {meta?.clientReady === false ? (
                    <span title={`Volume ที่ตรวจสอบแล้วครอบคลุม ${Math.round((meta.verifiedVolumeCoverage ?? 0) * 100)}% (เกณฑ์ ≥90%) — ดูรายละเอียดใน warnings`} className="cursor-help rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                      DRAFT — ยังไม่พร้อมส่งลูกค้า
                    </span>
                  ) : meta?.clientReady ? (
                    <span title={`Volume ที่ตรวจสอบแล้วครอบคลุม ${Math.round((meta.verifiedVolumeCoverage ?? 0) * 100)}% ของตาราง`} className="cursor-help rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">
                      CLIENT READY ✓
                    </span>
                  ) : null}
                  <button
                    disabled={exporting}
                    onClick={exportExcel}
                    className="rounded-xl border border-[#bcc9e2] bg-[#eff4fe] px-3 py-2 text-xs font-bold text-[#0d4fd8] disabled:opacity-60"
                    title={meta?.researchId ? 'Excel 7 ชีต จาก research run ที่บันทึกไว้ (ชุดเดียวกับตารางนี้)' : 'run นี้ไม่ได้ถูกบันทึก — จะได้ CSV จากข้อมูลบนหน้านี้แทน'}
                  >
                    {exporting ? 'กำลังสร้างไฟล์…' : 'Export Excel'}
                  </button>
                  <button
                    disabled={saving || filtered.length === 0}
                    onClick={saveToKeywordBank}
                    className="rounded-xl bg-[#155eef] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {saving ? 'กำลังบันทึก...' : 'ส่งเข้า Keyword Bank'}
                  </button>
                </div>
              </div>

              {/* ── KPI cards ── */}
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7">
                <KpiCard label="SEO Opportunities" value={fmtInt(kpi.total)} sub={`จากเป้า ${fmtInt(targetCount)}`} />
                <KpiCard label="Candidates ที่วิเคราะห์" value={fmtInt(kpi.candidates)} sub="ก่อนคัด/รวมคำซ้ำ" />
                <KpiCard
                  label="Reference Demand"
                  value={fmtInt(kpi.refDemand)}
                  sub="ค้นหา/เดือน (รวม)"
                  tooltip="ผลรวม reference volume ของคำที่มีข้อมูลเท่านั้น — เป็นเพดานความต้องการค้นหา ไม่ใช่คำสัญญาว่าจะได้ traffic เท่านี้"
                />
                <KpiCard label="High Confidence" value={`${kpi.highConfPct}%`} sub="สองแหล่งยืนยันตรงกัน" tooltip={CONFIDENCE_TOOLTIP.HIGH} />
                <KpiCard label="Avg KD" value={kpi.avgKd === null ? '—' : String(kpi.avgKd)} sub="ความยาก SEO เฉลี่ย" />
                <KpiCard label="Local Pack" value={fmtInt(kpi.localPack)} sub="คำที่ SERP มีแผนที่ร้าน" />
                <KpiCard label="Clusters" value={fmtInt(kpi.clusters)} sub={`Wave 1: ${fmtInt(kpi.wave1)} คำ`} />
              </div>

              {/* ── Data Source Status bar (ไม่ซ่อน error) ── */}
              {sourceStatus ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <SourcePill
                    name="Google Keyword Planner"
                    status={sourceStatus.googleKeywordPlanner.status}
                    detail={`${Math.round(sourceStatus.googleKeywordPlanner.coverage * 100)}% · ${sourceStatus.googleKeywordPlanner.geo}`}
                  />
                  <SourcePill
                    name="DataForSEO"
                    status={sourceStatus.dataForSeo.status}
                    detail={`${Math.round(sourceStatus.dataForSeo.coverage * 100)}%${sourceStatus.dataForSeo.message ? ` · ${sourceStatus.dataForSeo.message}` : ''}`}
                  />
                  <SourcePill
                    name="Local SERP"
                    status={sourceStatus.localSerp.status}
                    detail={`ตรวจ ${sourceStatus.localSerp.checkedCount} คำ${sourceStatus.localSerp.message ? ` · ${sourceStatus.localSerp.message}` : ''}`}
                  />
                  <span className="inline-flex items-center rounded-lg border border-[#e3e8f1] bg-[#f8fafd] px-2.5 py-1.5 text-[10px] text-[#71809c]">
                    AI ใช้แค่เสนอคำ/ตั้งชื่อ/เขียน title — ตัวเลขทุกตัวมาจาก API จริง
                  </span>
                </div>
              ) : null}
            </section>

            {/* ── Tabs ── */}
            <section className={`${cardClass} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-1 border-b border-[#e3e8f1] px-3 py-2">
                {([
                  ['overview', 'Overview'],
                  ['keywords', `All Keywords (${results.length})`],
                  ['wave1', `Wave 1 (${kpi.wave1})`],
                  ['clusters', `Clusters (${clusters.length})`],
                  ['sitemap', `Sitemap (${data.sitemap?.length ?? 0})`],
                  ['sources', 'Data Sources'],
                  ['method', 'Methodology'],
                ] as Array<[Tab, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === key ? 'bg-[#155eef] text-white shadow-sm' : 'text-[#606f8c] hover:bg-[#eef1f7]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'keywords' || tab === 'wave1' ? keywordTable : null}

              {tab === 'overview' ? (
                <div className="space-y-5 px-5 py-5">
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-[#17233a]">Top 10 โอกาสสูงสุด</h3>
                    <ol className="grid gap-1.5 lg:grid-cols-2">
                      {[...results]
                        .sort((a, b) => (b.intel?.finalScore ?? b.score.total) - (a.intel?.finalScore ?? a.score.total))
                        .slice(0, 10)
                        .map((r, idx) => (
                          <li key={r.keyword}>
                            <button onClick={() => { setDrawerKeyword(r.keyword); }} className="flex w-full items-center gap-2 rounded-xl border border-[#eef1f7] bg-white px-3 py-2 text-left text-xs transition hover:border-[#155eef]/40 hover:bg-[#f4f8fe]">
                              <span className="w-5 shrink-0 text-right font-bold tabular-nums text-[#91a0b8]">{idx + 1}</span>
                              <span className="min-w-0 flex-1 truncate font-semibold text-[#17233a]">{r.keyword}</span>
                              <ConfidenceBadge confidence={r.intel?.confidence} />
                              <span className="rounded-lg bg-[#eff4fe] px-2 py-0.5 font-bold tabular-nums text-[#0d4fd8]">
                                {r.intel ? (Math.round(r.intel.finalScore * 10) / 10).toFixed(1) : r.score.total}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ol>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-sm font-bold text-[#17233a]">สัดส่วน Objective</h3>
                      {(['Sales', 'Traffic'] as const).map(obj => {
                        const count = results.filter(r => objectiveOf(r) === obj).length;
                        const pct = results.length ? Math.round((count / results.length) * 100) : 0;
                        return (
                          <div key={obj} className="mb-2">
                            <div className="mb-1 flex justify-between text-[11px] text-[#495975]">
                              <span className="font-semibold">{obj === 'Sales' ? 'คำโอกาสขาย (Sales)' : 'คำดึงผู้เข้าชม (Traffic)'}</span>
                              <span className="tabular-nums">{count} คำ · {pct}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-[#eef1f7]">
                              <div className={`h-full rounded-full ${obj === 'Sales' ? 'bg-[#155eef]' : 'bg-[#7ba3f7]'}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      <h3 className="mb-2 mt-4 text-sm font-bold text-[#17233a]">Publish Waves</h3>
                      {[1, 2, 3].map(w => {
                        const count = results.filter(r => r.intel?.wave === w).length;
                        const pct = results.length ? Math.round((count / results.length) * 100) : 0;
                        return (
                          <div key={w} className="mb-1.5 flex items-center gap-2 text-[11px] text-[#495975]">
                            <span className={`w-8 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${w === 1 ? 'bg-[#155eef] text-white' : w === 2 ? 'bg-[#dbe7fd] text-[#0d4fd8]' : 'bg-[#eef1f7] text-[#606f8c]'}`}>W{w}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef1f7]">
                              <div className="h-full rounded-full bg-[#155eef]/70" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-20 shrink-0 text-right tabular-nums">{count} คำ · {pct}%</span>
                          </div>
                        );
                      })}
                      <p className="mt-1 text-[10px] leading-4 text-[#71809c]">Wave 1 = ชุดแรกที่ควรเผยแพร่ (คะแนนสูงสุด กระจายทุกคลัสเตอร์) → Wave 2 → Wave 3</p>
                    </div>
                    <div>
                      <h3 className="mb-2 text-sm font-bold text-[#17233a]">คลัสเตอร์ใหญ่สุด</h3>
                      {clusters.slice(0, 8).map(c => (
                        <button key={c.name} onClick={() => { setTab('keywords'); setClusterFilter(c.name); }} className="mb-1.5 flex w-full items-center gap-2 rounded-xl border border-[#eef1f7] px-3 py-2 text-left text-[11px] transition hover:border-[#155eef]/40 hover:bg-[#f4f8fe]">
                          <span className="min-w-0 flex-1 truncate font-semibold text-[#17233a]">{c.name}</span>
                          <span className="tabular-nums text-[#71809c]">{c.keywordCount} คำ</span>
                          <span className="tabular-nums text-[#91a0b8]">{c.searchDemand === null ? '—' : fmtInt(c.searchDemand)}/ด.</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === 'clusters' ? (
                <div className="divide-y divide-[#eef1f7]">
                  {clusters.map(cluster => (
                    <div key={cluster.name} className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-sm font-bold text-[#17233a]">{cluster.name}</h3>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                          คะแนนสูงสุด {cluster.maxPriority}
                        </span>
                        <span className="text-[11px] text-[#71809c]">เฉลี่ย {cluster.avgPriority} · {cluster.keywordCount} คำ</span>
                        <span className="text-[11px] text-[#71809c]">
                          ยอดค้นหารวม: {cluster.searchDemand === null
                            ? <span title="ทั้งคลัสเตอร์ยังไม่มีข้อมูล volume" className="cursor-help">—</span>
                            : fmtInt(cluster.searchDemand)}
                        </span>
                        <span className="ml-auto rounded-lg bg-[#eef1f7] px-2 py-1 text-[11px] font-semibold text-[#495975]">
                          {SUGGESTED_PAGE_LABELS[cluster.suggestedPage]}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#606f8c]">
                        คำหลักของกลุ่ม: <strong className="text-[#17233a]">{cluster.mainKeyword}</strong>
                      </p>
                      {cluster.locationPageAdvice ? (
                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">{cluster.locationPageAdvice}</p>
                      ) : null}
                      <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-[#495975] sm:grid-cols-2">
                        {cluster.contentRecommendations.map(item => <li key={item}>• {item}</li>)}
                      </ul>
                    </div>
                  ))}
                  {clusters.length === 0 ? <div className="px-4 py-10 text-center text-[#91a0b8]">ยังไม่มีคลัสเตอร์</div> : null}
                </div>
              ) : null}

              {tab === 'sitemap' ? (
                <div className="divide-y divide-[#eef1f7]">
                  {(data.topicClusters ?? []).length > 0 ? (
                    <div className="bg-[#f8fafd] px-4 py-3">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#71809c]">โครงสร้างเว็บ · {data.topicClusters!.length} กลุ่มหัวข้อ (pillar + บทความสนับสนุน)</p>
                      <div className="flex flex-wrap gap-2">
                        {data.topicClusters!.map(tc => (
                          <span key={tc.clusterId} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8f2] bg-white px-2.5 py-1 text-[11px] text-[#495975]" title={`pillar: /${tc.pillarSlug}`}>
                            <span className="font-semibold text-[#17233a]">{tc.name}</span>
                            <span className="text-[#91a0b8]">· {tc.memberSlugs.length} หน้า</span>
                            {tc.totalVolume > 0 ? <span className="tabular-nums text-[#0d4fd8]">· {tc.totalVolume.toLocaleString('th-TH')}/ด.</span> : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {(data.sitemap ?? []).length === 0 ? (
                    <div className="px-4 py-10 text-center text-[#91a0b8]">ยังไม่มีข้อมูล sitemap — รันการค้นหาก่อน</div>
                  ) : (data.sitemap ?? []).map(pg => (
                    <div key={`${pg.pageType}-${pg.slug}-${pg.page}`} className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-sm font-bold text-[#17233a]">{pg.page}</h3>
                        <code className="rounded bg-[#f4f6fb] border border-[#e3e8f2] px-1.5 py-0.5 font-mono text-[10px] text-[#0d4fd8]">/{pg.slug}</code>
                        <span className="rounded-lg bg-[#eef1f7] px-2 py-1 text-[11px] font-semibold text-[#495975]">{pg.pageType}</span>
                        {pg.role === 'pillar' ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">PILLAR</span> : null}
                        {pg.category ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">{pg.category}</span> : null}
                        <span className="ml-auto text-[11px] text-[#71809c]">1 บทความ</span>
                      </div>
                      <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-[#495975] sm:grid-cols-2">
                        {pg.keywords.map(k => (
                          <li key={k.keyword} className="flex items-baseline gap-1.5">
                            <span className="font-semibold text-[#17233a]">{k.keyword}</span>
                            <span className="tabular-nums text-[#91a0b8]">{k.volume?.toLocaleString('th-TH') ?? '—'}/ด.</span>
                            {k.title ? <span className="truncate text-[10px] text-[#606f8c]" title={k.title}>— {k.title}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === 'sources' ? (
                <div className="space-y-4 px-5 py-5 text-xs leading-5 text-[#495975]">
                  <p className="rounded-xl bg-[#f4f8fe] px-4 py-3 text-[11px] leading-5">
                    ตัวเลขทุกตัวในผลชุดนี้ (volume / CPC / KD / competition / SERP) มาจาก API ของแหล่งข้อมูลจริงเท่านั้น
                    — AI ถูกใช้แค่เสนอคำ ตั้งชื่อคลัสเตอร์ และเขียน SEO title ตัวเลขสองแหล่งเก็บแยกกันเสมอ ไม่มีการเฉลี่ยรวม
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                      <thead className="bg-[#f7f9fd] text-left text-[11px] uppercase tracking-wide text-[#71809c]">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold">แหล่งข้อมูล</th>
                          <th className="px-3 py-2.5 font-semibold">สถานะ</th>
                          <th className="px-3 py-2.5 font-semibold">Coverage</th>
                          <th className="px-3 py-2.5 font-semibold">Geo / ขอบเขต</th>
                          <th className="px-3 py-2.5 font-semibold">ดึงเมื่อ</th>
                          <th className="px-3 py-2.5 font-semibold">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody className="align-top">
                        <tr className="border-t border-[#eef1f7]">
                          <td className="px-3 py-2.5 font-semibold text-[#17233a]">Google Keyword Planner<div className="text-[10px] font-normal text-[#91a0b8]">Primary Reference Volume</div></td>
                          <td className="px-3 py-2.5"><span className={`inline-block h-2 w-2 rounded-full ${SOURCE_STATUS_STYLE[sourceStatus?.googleKeywordPlanner.status ?? ''] ?? 'bg-slate-300'}`} /> {sourceStatus?.googleKeywordPlanner.status ?? meta?.keywordPlannerStatus}</td>
                          <td className="px-3 py-2.5 tabular-nums">{sourceStatus ? `${Math.round(sourceStatus.googleKeywordPlanner.coverage * 100)}%` : '—'}</td>
                          <td className="px-3 py-2.5">{sourceStatus?.googleKeywordPlanner.geo ?? '—'}</td>
                          <td className="px-3 py-2.5">{fmtDate(sourceStatus?.googleKeywordPlanner.fetchedAt)}</td>
                          <td className="px-3 py-2.5 text-[#71809c]">{sourceStatus?.googleKeywordPlanner.message ?? meta?.keywordPlannerMessage ?? '—'}</td>
                        </tr>
                        <tr className="border-t border-[#eef1f7]">
                          <td className="px-3 py-2.5 font-semibold text-[#17233a]">DataForSEO<div className="text-[10px] font-normal text-[#91a0b8]">Cross-check + Intent + KD</div></td>
                          <td className="px-3 py-2.5"><span className={`inline-block h-2 w-2 rounded-full ${SOURCE_STATUS_STYLE[sourceStatus?.dataForSeo.status ?? ''] ?? 'bg-slate-300'}`} /> {sourceStatus?.dataForSeo.status ?? '—'}</td>
                          <td className="px-3 py-2.5 tabular-nums">{sourceStatus ? `${Math.round(sourceStatus.dataForSeo.coverage * 100)}%` : '—'}</td>
                          <td className="px-3 py-2.5">Thailand (2764)</td>
                          <td className="px-3 py-2.5">{fmtDate(sourceStatus?.dataForSeo.fetchedAt)}</td>
                          <td className="px-3 py-2.5 text-[#71809c]">{sourceStatus?.dataForSeo.message ?? '—'}</td>
                        </tr>
                        <tr className="border-t border-[#eef1f7]">
                          <td className="px-3 py-2.5 font-semibold text-[#17233a]">DataForSEO Local SERP<div className="text-[10px] font-normal text-[#91a0b8]">Local pack + ประเภทหน้าใน top 10</div></td>
                          <td className="px-3 py-2.5"><span className={`inline-block h-2 w-2 rounded-full ${SOURCE_STATUS_STYLE[sourceStatus?.localSerp.status ?? ''] ?? 'bg-slate-300'}`} /> {sourceStatus?.localSerp.status ?? '—'}</td>
                          <td className="px-3 py-2.5 tabular-nums">ตรวจ {sourceStatus?.localSerp.checkedCount ?? 0} คำ</td>
                          <td className="px-3 py-2.5">Thailand (2764)</td>
                          <td className="px-3 py-2.5">{fmtDate(sourceStatus?.localSerp.fetchedAt)}</td>
                          <td className="px-3 py-2.5 text-[#71809c]">{sourceStatus?.localSerp.message ?? 'ตรวจแบบ tiered เฉพาะคำ local/commercial เด่นสุด เพื่อคุมค่าใช้จ่าย'}</td>
                        </tr>
                        <tr className="border-t border-[#eef1f7]">
                          <td className="px-3 py-2.5 font-semibold text-[#17233a]">OpenRouter AI<div className="text-[10px] font-normal text-[#91a0b8]">ภาษาเท่านั้น — ไม่ใช่ตัวเลข</div></td>
                          <td className="px-3 py-2.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> ok</td>
                          <td className="px-3 py-2.5">—</td>
                          <td className="px-3 py-2.5">เสนอ candidate · ตั้งชื่อคลัสเตอร์ · SEO title</td>
                          <td className="px-3 py-2.5">{fmtDate(meta?.generatedAt)}</td>
                          <td className="px-3 py-2.5 text-[#71809c]">ห้ามเป็นแหล่งของ volume/CPC/KD/competition โดยการออกแบบ</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[11px]">
                    <p className="font-semibold text-[#17233a]">Verified Volume Coverage: {Math.round((meta?.verifiedVolumeCoverage ?? 0) * 100)}% (เกณฑ์ Client Ready ≥90%)</p>
                    <p className="mt-1 text-[#71809c]">คำที่นับว่า "ตรวจสอบแล้ว" = มีตัวเลขจากแหล่งจริง (รวมศูนย์จริง) หรือเป็น LOCAL opportunity ที่มีหลักฐานใน SERP</p>
                  </div>
                </div>
              ) : null}

              {tab === 'method' ? (
                <div className="space-y-4 px-5 py-5 text-xs leading-6 text-[#495975]">
                  <div>
                    <h3 className="mb-1 text-sm font-bold text-[#17233a]">ระบบทำงานอย่างไร (DATA → AI)</h3>
                    <ol className="list-decimal space-y-1 pl-5">
                      <li>สร้าง candidate จากโครงสร้างบริการ × พื้นที่ × คำขยาย (ใกล้ฉัน/ราคา/ด่วน ฯลฯ) + ปัญหาจริงของลูกค้า + AI ขยาย pool + ฐานข้อมูล DataForSEO</li>
                      <li>ดึงตัวเลขจริง: Google Keyword Planner (แหล่งอ้างอิงหลัก ระดับพื้นที่ที่ resolve ได้จริง) และ DataForSEO (แหล่ง cross-check) — เก็บแยกกัน ไม่เฉลี่ย</li>
                      <li>ตรวจ search intent + Keyword Difficulty + Local SERP (local pack, ประเภทหน้าใน top 10) จาก DataForSEO</li>
                      <li>ให้คะแนน Sales / Traffic ต่อคำ แล้วรวมเป็น Final Opportunity Score ตามน้ำหนักที่เลือก ({Math.round((meta?.opportunityWeights?.sales ?? 0.6) * 100)}/{Math.round((meta?.opportunityWeights?.traffic ?? 0.4) * 100)})</li>
                      <li>กันคำกินกันเอง: คำสลับทำเลเจตนาเดียวกัน + คำที่ SERP ทับกัน ≥50% ถูกรวมเป็น "คำรอง" ของคำที่แข็งแรงที่สุด</li>
                      <li>คัดตามโควตาคลัสเตอร์ (คลัสเตอร์เดียวไม่เกิน ~35%) → แบ่งลำดับเผยแพร่ Wave 1 (~15%) / Wave 2 (~30%) / Wave 3</li>
                      <li>AI เขียน SEO title/slug เป็นขั้นสุดท้าย — หลังตัวเลขทั้งหมดจบแล้ว</li>
                    </ol>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-[#eef1f7] p-4">
                      <h4 className="mb-2 font-bold text-[#17233a]">Sales Score (โอกาสได้ลูกค้า)</h4>
                      <ul className="space-y-1">
                        <li>• Local Relevance <strong>25%</strong> — ผูกกับพื้นที่เป้าหมาย</li>
                        <li>• Search Intent <strong>20%</strong> — พร้อมจ้าง &gt; กำลังเลือก &gt; หาความรู้</li>
                        <li>• Service Proximity <strong>20%</strong> — ตรงกับบริการที่ทำจริง</li>
                        <li>• CPC Value <strong>15%</strong> — ตลาดยอมจ่ายต่อคลิกสูง = ลูกค้ามีมูลค่า</li>
                        <li>• Local SERP Fit <strong>10%</strong> — Google มองคำนี้เป็น local</li>
                        <li>• Paid Competition <strong>10%</strong> — ระดับการแข่งขันโฆษณา</li>
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#eef1f7] p-4">
                      <h4 className="mb-2 font-bold text-[#17233a]">Traffic Score (โอกาสได้ผู้เข้าชม)</h4>
                      <ul className="space-y-1">
                        <li>• Demand <strong>40%</strong> — reference volume (log scale)</li>
                        <li>• Low Difficulty <strong>20%</strong> — 100 − KD</li>
                        <li>• Trend <strong>15%</strong> — 3 เดือนล่าสุด vs ก่อนหน้า</li>
                        <li>• SERP Opportunity <strong>15%</strong> — SERP มี directory/forum = แทรกง่าย</li>
                        <li>• Topical Fit <strong>10%</strong> — เกี่ยวข้องกับธุรกิจ</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-xl bg-[#f8fafd] px-4 py-3 text-[11px]">
                    <p className="font-semibold text-[#17233a]">Confidence ของตัวเลข volume</p>
                    <p className="mt-1">HIGH = สองแหล่งตรงกัน (≤1.5 เท่า) · MEDIUM = แหล่งเดียวหรือต่างกัน ≤3 เท่า · LOW = ต่างกัน &gt;3 เท่า ·
                    LOCAL = volume ศูนย์แต่มีหลักฐานธุรกิจท้องถิ่นใน SERP · NO VOLUME = ไม่มีข้อมูลจากแหล่งใด</p>
                    <p className="mt-1 text-[#71809c]">ZERO (API ตอบ 0 จริง) ≠ NULL (ไม่มีข้อมูล) ≠ API ERROR (เรียกไม่สำเร็จ) — สามสถานะนี้แสดงต่างกันเสมอ</p>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : status === 'running' ? (
          <KeywordResearchProgress title="กำลังหาคีย์เวิร์ดในพื้นที่" logs={progressLogs} />
        ) : (
          <section className={`${cardClass} px-6 py-16 text-center`}>
            <p className="text-sm font-semibold text-[#495975]">ยังไม่มีผลลัพธ์</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#71809c]">
              กรอกบริการที่ทำและพื้นที่หลัก แล้วกด "หาคีย์เวิร์ดในพื้นที่"
              ระบบจะดึงตัวเลขจริงจาก Google Keyword Planner + DataForSEO
              ให้คะแนนโอกาสขายต่อคำ แล้วคัดเฉพาะคำที่ควรทำจริง
            </p>
          </section>
        )}
      </main>

      {/* ── Detail Drawer: ทำไมคำนี้ถึงได้คะแนนนี้ ── */}
      {drawerRow ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrawerKeyword(null)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 flex items-start gap-3 border-b border-[#e3e8f1] bg-white px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#91a0b8]">อันดับ {rankByKeyword.get(drawerRow.keyword)} · {drawerRow.cluster ?? drawerRow.service}</p>
                <h3 className="mt-0.5 break-words text-base font-bold text-[#17233a]">{drawerRow.keyword}</h3>
                {drawerRow.suggestedTitle ? <p className="mt-1 text-[11px] leading-5 text-[#0d4fd8]">✍ {drawerRow.suggestedTitle}</p> : null}
                {drawerRow.slug ? <p className="mt-0.5 font-mono text-[10px] text-[#91a0b8]">/{drawerRow.slug}</p> : null}
              </div>
              <button onClick={() => setDrawerKeyword(null)} className="rounded-lg border border-[#dbe1ee] px-2.5 py-1.5 text-xs font-bold text-[#606f8c] hover:bg-[#f4f6fb]">✕</button>
            </div>

            <div className="space-y-5 px-5 py-5 text-xs text-[#495975]">
              {drawerRow.intel ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-[#eff4fe] px-3 py-2.5 text-center">
                      <p className="text-[10px] font-semibold text-[#71809c]">Final</p>
                      <p className="text-lg font-bold tabular-nums text-[#0d4fd8]">{(Math.round(drawerRow.intel.finalScore * 10) / 10).toFixed(1)}</p>
                      {drawerRow.intel.wave ? <p className="text-[10px] font-bold text-[#155eef]">Wave {drawerRow.intel.wave}</p> : null}
                    </div>
                    <div className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-center">
                      <p className="text-[10px] font-semibold text-[#71809c]">Sales</p>
                      <p className="text-lg font-bold tabular-nums text-[#17233a]">{Math.round(drawerRow.intel.salesScore.total)}</p>
                    </div>
                    <div className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-center">
                      <p className="text-[10px] font-semibold text-[#71809c]">Traffic</p>
                      <p className="text-lg font-bold tabular-nums text-[#17233a]">{Math.round(drawerRow.intel.trafficScore.total)}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-bold text-[#17233a]">ทำไมคำนี้? (Why this keyword)</h4>
                    <ul className="space-y-1.5 leading-5">
                      <li>• Objective: <strong>{objectiveOf(drawerRow)}</strong> — {objectiveOf(drawerRow) === 'Sales' ? 'คำที่มีโอกาสเปลี่ยนเป็นลูกค้า' : 'คำดึงผู้เข้าชม/สร้างความน่าเชื่อถือ'}</li>
                      {drawerRow.intel.searchIntent.intent ? (
                        <li>• Search intent: <strong>{INTENT_LABEL_TH[drawerRow.intel.searchIntent.intent] ?? drawerRow.intel.searchIntent.intent}</strong>{drawerRow.intel.searchIntent.probability !== null ? ` (ความน่าจะเป็น ${Math.round(drawerRow.intel.searchIntent.probability * 100)}%)` : ''} — จาก DataForSEO</li>
                      ) : null}
                      {drawerRow.location ? <li>• พื้นที่: <strong>{drawerRow.location}</strong> ({drawerRow.locationRole === 'primary' ? 'ทำเลหลัก' : drawerRow.locationRole === 'nearby' ? 'ทำเลใกล้เคียง' : 'ไม่ระบุ'})</li> : null}
                      {drawerRow.intel.zeroVolumeLocalOpportunity ? (
                        <li>• <strong className="text-violet-700">Local Opportunity:</strong> volume ต่ำ/ศูนย์ แต่ SERP มีหลักฐานธุรกิจท้องถิ่นจริง — เครื่องมือวัดคำระดับย่านไม่ถึง แต่ลูกค้าค้นจริง</li>
                      ) : null}
                      {drawerRow.intel.dfs.keywordDifficulty !== null ? (
                        <li>• ความยาก SEO (KD): <strong>{drawerRow.intel.dfs.keywordDifficulty}</strong>/100 {drawerRow.intel.dfs.keywordDifficulty <= 30 ? '— แข่งง่าย เหมาะกับเว็บใหม่' : drawerRow.intel.dfs.keywordDifficulty <= 60 ? '— แข่งได้ถ้าเนื้อหาดี' : '— แข่งยาก ต้องใช้เวลา'}</li>
                      ) : null}
                    </ul>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-bold text-[#17233a]">Volume แยกตามแหล่ง (ไม่เฉลี่ยรวม)</h4>
                    <div className="overflow-hidden rounded-xl border border-[#eef1f7]">
                      <table className="w-full text-[11px]">
                        <tbody>
                          <tr className="border-b border-[#eef1f7] bg-[#f8fafd]">
                            <td className="px-3 py-2 font-semibold text-[#17233a]">Reference</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums">{drawerRow.intel.referenceVolume === null ? 'N/A' : fmtInt(drawerRow.intel.referenceVolume)}</td>
                            <td className="px-3 py-2 text-[#71809c]">ที่มา: {referenceSourceLabel(drawerRow.intel.referenceSource)}</td>
                          </tr>
                          <tr className="border-b border-[#eef1f7]">
                            <td className="px-3 py-2 font-semibold">Google KP</td>
                            <td className="px-3 py-2 text-right tabular-nums">{metricStatusText(drawerRow.intel.google.status, drawerRow.intel.google.avgMonthlySearches)}</td>
                            <td className="px-3 py-2 text-[#71809c]">{drawerRow.intel.google.geoTarget ? `${drawerRow.intel.google.geoTarget} (${drawerRow.intel.google.geoLevel})` : '—'} · {fmtDate(drawerRow.intel.google.retrievedAt)}</td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 font-semibold">DataForSEO</td>
                            <td className="px-3 py-2 text-right tabular-nums">{metricStatusText(drawerRow.intel.dfs.status, drawerRow.intel.dfs.searchVolume)}</td>
                            <td className="px-3 py-2 text-[#71809c]">Thailand · {fmtDate(drawerRow.intel.dfs.retrievedAt)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ConfidenceBadge confidence={drawerRow.intel.confidence} />
                      <span className="text-[10px] text-[#71809c]">{CONFIDENCE_TOOLTIP[drawerRow.intel.confidence]}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#eef1f7] px-3 py-2.5">
                      <p className="text-[10px] font-semibold text-[#71809c]">CPC (฿)</p>
                      <p className="font-bold tabular-nums">{formatBaht(drawerRow.intel.dfs.cpc ?? drawerRow.intel.google.bidHighMicros)}</p>
                    </div>
                    <div className="rounded-xl border border-[#eef1f7] px-3 py-2.5">
                      <p className="text-[10px] font-semibold text-[#71809c]">Ads Competition</p>
                      <p className="font-bold">{drawerRow.intel.google.competition ?? drawerRow.intel.dfs.competition ?? '—'}{typeof (drawerRow.intel.google.competitionIndex ?? drawerRow.intel.dfs.competitionIndex) === 'number' ? ` (${drawerRow.intel.google.competitionIndex ?? drawerRow.intel.dfs.competitionIndex})` : ''}</p>
                    </div>
                  </div>

                  {drawerRow.intel.serp.status === 'ok' ? (
                    <div>
                      <h4 className="mb-2 text-sm font-bold text-[#17233a]">Local SERP จริง ({fmtDate(drawerRow.intel.serp.serpCheckedAt)})</h4>
                      <ul className="space-y-1 leading-5">
                        <li>• Local Pack (แผนที่ร้าน): <strong>{drawerRow.intel.serp.hasLocalPack ? `มี (ตำแหน่ง ${drawerRow.intel.serp.localPackPosition ?? '—'})` : 'ไม่มี'}</strong></li>
                        <li>• Top 10: หน้า service คู่แข่ง {drawerRow.intel.serp.servicePageCount} · บทความ {drawerRow.intel.serp.articleCount} · directory {drawerRow.intel.serp.directoryCount}</li>
                        <li>• โอกาสแทรกหน้าใหม่ (SERP Opportunity): <strong>{drawerRow.intel.serp.serpOpportunityScore ?? '—'}</strong>/100</li>
                      </ul>
                      {drawerRow.intel.serp.topDomains.length > 0 ? (
                        <p className="mt-1.5 text-[10px] leading-4 text-[#91a0b8]">โดเมนใน SERP: {drawerRow.intel.serp.topDomains.slice(0, 6).join(', ')}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="rounded-lg bg-[#f8fafd] px-3 py-2 text-[10px] text-[#91a0b8]">
                      คำนี้ไม่ได้ตรวจ Local SERP ({drawerRow.intel.serp.status === 'api_error' ? 'เรียก API ไม่สำเร็จ' : 'อยู่นอกงบตรวจ SERP ของรอบนี้'}) — คะแนน SERP ใช้ค่ากลาง ไม่แต่งข้อมูล
                    </p>
                  )}

                  {drawerRow.intel.secondaryKeywords.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-sm font-bold text-[#17233a]">คำรองที่ถูกรวมเข้าคำนี้ ({drawerRow.intel.secondaryKeywords.length})</h4>
                      <p className="mb-1.5 text-[10px] text-[#71809c]">เจตนาซ้ำกับคำหลัก — ใช้ในเนื้อหาเดียวกัน ไม่แยกทำคนละหน้า (กันหน้ากินกันเอง)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {drawerRow.intel.secondaryKeywords.map(kw => (
                          <span key={kw} className="rounded-full bg-[#eef1f7] px-2.5 py-1 text-[11px] text-[#495975]">{kw}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {drawerRow.intel.cannibalization.action !== 'KEEP' ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                      คำนี้ถูกจัดเป็น {drawerRow.intel.cannibalization.action} ของ "{drawerRow.intel.cannibalization.againstKeyword}" — {drawerRow.intel.cannibalization.reason}
                    </p>
                  ) : null}
                </>
              ) : (
                <div>
                  <h4 className="mb-2 text-sm font-bold text-[#17233a]">คะแนนโอกาส (รุ่นเดิม)</h4>
                  <ul className="space-y-1">
                    {scoreBreakdown(drawerRow.score).map(part => (
                      <li key={part.label} className="flex justify-between"><span>{part.label}</span><span className="tabular-nums">{part.earned}/{part.max}</span></li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-[#91a0b8]">ผลชุดนี้มาจากระบบรุ่นเดิม — รันใหม่เพื่อได้ข้อมูล intelligence เต็มรูปแบบ</p>
                </div>
              )}

              <div>
                <p className="text-[10px] text-[#91a0b8]">ที่มา candidate: {(drawerRow.intel?.candidateSources ?? drawerRow.sources).map(s => SOURCE_LABELS[s] ?? s).join(' · ')}</p>
                <p className="mt-0.5 text-[10px] text-[#91a0b8]">ระดับความสำคัญเดิม: {PRIORITY_LABELS[drawerRow.priority]} ({drawerRow.score.total}/100)</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
