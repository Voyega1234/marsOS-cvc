'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PipelineResult } from '@/lib/wordgod/pipeline/wordgodPipeline';
import type { KeywordMetricMode } from '@/lib/wordgod/pipeline/keywordMetricPolicy';
import type { PlanMode, PlanPillarInput } from '@/lib/wordgod/planning/contentPlan';
import { INTENT_DESCRIPTIONS, INTENT_LABELS, PRESETS, rebalanceRatio, totalRatio } from '@/lib/wordgod/skills/intentRatioSkill';
import type { IntentRatio, PresetKey } from '@/lib/wordgod/skills/intentRatioSkill';
import WordGodLocalPanel from './WordGodLocalPanel';
import { KeywordResearchProgress } from './KeywordResearchProgress';
import { threeMonthChange, formatPercentChange } from '@/lib/wordgod/pipeline/kpMetrics';

type Status = 'idle' | 'running' | 'done' | 'error';
type Tab = 'keywords' | 'content' | 'pillars' | 'calendar' | 'qa' | 'competitors';

interface WordGodProject {
  id: string;
  name: string;
  website: string;
  businessType: string;
}

interface Props {
  project: WordGodProject;
  onSendToBank?: () => void;
}

interface SiteCategory {
  slug: string;
  label: string;
  url: string;
  count?: number;
}

const fieldClass = 'w-full rounded-xl border border-[#cfd9ea] bg-white px-3.5 py-3 text-sm text-[#17233a] placeholder:text-[#91a0b8] shadow-sm outline-none transition focus:border-[#155eef] focus:ring-4 focus:ring-[#155eef]/10';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[#495975]';
const cardClass = 'rounded-2xl border border-[#dbe1ee] bg-white shadow-[0_8px_30px_rgba(28,73,52,0.05)]';

function parseKeywords(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  if (header.includes('keyword') || header.includes('คีย์เวิร์ด')) lines.shift();
  return Array.from(new Set(lines.flatMap(line => {
    const firstColumn = line.split(',')[0]?.replace(/^"|"$/g, '').trim();
    return firstColumn ? [firstColumn] : [];
  })));
}

function parsePillars(text: string): PlanPillarInput[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [name, seed, moneyPage, quota] = line.split('|').map(value => value.trim());
    return {
      name,
      seed: seed || undefined,
      moneyPage: moneyPage || undefined,
      articlesPerMonth: quota && Number.isFinite(Number(quota)) ? Number(quota) : undefined,
    };
  }).filter(pillar => pillar.name);
}

function formatNumber(value: number | undefined, decimals = 0): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function PriorityBadge({ value }: { value: string }) {
  const style = value === 'P1' || value === 'high'
    ? 'border-blue-200 bg-blue-50 text-blue-800'
    : value === 'P2' || value === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${style}`}>{value}</span>;
}

function SourceBadge({ value }: { value: string }) {
  const label = value === 'keyword_planner' ? 'KP'
    : value === 'planner_variant' ? 'DERIVED'
      : value === 'dataforseo' ? 'DFS'
        : 'AI IDEA';
  const style = value === 'keyword_planner' || value === 'dataforseo'
    ? 'bg-blue-50 text-blue-700'
    : value === 'planner_variant'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${style}`}>{label}</span>;
}

// KP-style in-cell trend preview (before export). Pure inline SVG — no external
// libs, CSP-safe. Hover shows the raw monthly series + 3-month change.
function Sparkline({ trend }: { trend?: number[] }) {
  const series = (trend ?? []).filter(value => typeof value === 'number' && isFinite(value));
  if (series.length < 2) return <span className="text-[#c7cfde]">—</span>;

  const width = 68;
  const height = 20;
  const pad = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (width - 2 * pad);
  const y = (value: number) => height - pad - ((value - min) / span) * (height - 2 * pad);
  const points = series.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

  const change = threeMonthChange(series);
  const rising = change === null ? series[series.length - 1] >= series[0] : change >= 0;
  const stroke = rising ? '#155eef' : '#d1584f';
  const changeLabel = change === null ? '' : ` • 3-mo ${formatPercentChange(change)}`;
  const lastX = x(series.length - 1);
  const lastY = y(series[series.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`trend ${formatPercentChange(change)}`}>
      <title>{`${series.map(v => v.toLocaleString('th-TH')).join(' → ')}${changeLabel}`}</title>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={1.9} fill={stroke} />
    </svg>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Dependency-free CSV export (no csv-stringify) — a practical subset of columns
// covering the Keyword Master table shown on-screen.
function isDirectMetricSource(source: string): boolean {
  return source === 'keyword_planner' || source === 'dataforseo';
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv(result: PipelineResult): string {
  const headers = ['No.', 'Keyword', 'Title (H1)', 'Volume', 'KD', 'CPC (THB)', 'Intent', 'Priority', 'Source'];
  const rows = result.keywords.map((kw, index) => [
    index + 1,
    kw.keyword,
    kw.title,
    isDirectMetricSource(kw.volume_source) ? kw.volume : '',
    kw.organic_difficulty ?? '',
    isDirectMetricSource(kw.volume_source) && typeof kw.cpc === 'number' && kw.cpc > 0 ? kw.cpc : '',
    kw.intent,
    kw.priority,
    kw.volume_source,
  ]);
  const lines = [headers, ...rows].map(row => row.map(csvEscape).join(','));
  return '﻿' + lines.join('\n');
}

const PRIORITY_TO_NUMBER: Record<string, number> = { high: 3, medium: 2, low: 1 };

type ResearchMode = 'standard' | 'local_sme';

/** สลับระหว่างงานวิจัยคีย์เวิร์ดแบบเดิม กับโหมดธุรกิจในพื้นที่ */
function ResearchModeSwitch({ mode, onChange }: { mode: ResearchMode; onChange: (next: ResearchMode) => void }) {
  // แบ่งการค้นหาเป็น 2 แบบตามรูปแบบธุรกิจ:
  //   มีหน้าร้าน   → เน้น keyword + ทำเล (local_sme — WordGodLocalPanel)
  //   ไม่มีหน้าร้าน → เน้น keyword ที่มีโอกาสขายของธุรกิจนั้น (standard pipeline)
  const options: Array<{ key: ResearchMode; label: string; hint: string }> = [
    { key: 'local_sme', label: 'มีหน้าร้าน / ธุรกิจในพื้นที่', hint: 'เน้น keyword + ทำเล — เขต อำเภอ สถานี ที่ลูกค้าใช้ค้นหา' },
    { key: 'standard', label: 'ไม่มีหน้าร้าน / ขายออนไลน์', hint: 'หา keyword ที่มีโอกาสขายของธุรกิจ — จัดอันดับตามโอกาสปิดการขาย' },
  ];
  return (
    <div className="inline-grid w-full max-w-2xl grid-cols-2 gap-1 rounded-xl bg-[#eef1f7] p-1">
      {options.map(option => (
        <button
          key={option.key}
          onClick={() => onChange(option.key)}
          title={option.hint}
          className={`rounded-lg px-4 py-2 text-left transition ${
            mode === option.key ? 'bg-white shadow-sm' : 'hover:bg-white/50'
          }`}
        >
          <span className={`block text-xs font-semibold ${mode === option.key ? 'text-[#0d4fd8]' : 'text-[#606f8c]'}`}>{option.label}</span>
          <span className="mt-0.5 block text-[10px] font-normal leading-4 text-[#71809c]">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

const WEBSITE_TYPE_OPTIONS: Array<{ value: '' | 'ecommerce' | 'service' | 'knowledge'; label: string; hint: string }> = [
  { value: '', label: 'ให้ระบบเลือกให้', hint: 'ตัดสินจากธุรกิจและ seed ที่กรอก' },
  { value: 'ecommerce', label: 'ขายสินค้า (E-commerce)', hint: 'เน้นคำที่พร้อมซื้อ ชื่อสินค้า รุ่น ราคา' },
  { value: 'service', label: 'ขายบริการ (Service)', hint: 'เน้นคำที่พร้อมติดต่อ จ้างงาน ขอใบเสนอราคา' },
  { value: 'knowledge', label: 'เว็บให้ความรู้ (Knowledge)', hint: 'เน้นคำให้ความรู้ ไม่มี CTA ขาย' },
];

// pipeline กำหนด website_type จาก preset เหล่านี้เอง (ดู wordgodPipeline.ts)
// ตัวเลือกของผู้ใช้จะมีผลเฉพาะ preset ที่ไม่ได้ผูกประเภทเว็บไว้แล้ว
const PRESET_IMPLIED_WEBSITE_TYPE: Partial<Record<PresetKey, string>> = {
  preset3: 'ขายบริการ (Service)',
  preset4: 'ขายสินค้า (E-commerce)',
  preset6: 'เว็บให้ความรู้ (Knowledge)',
};

const STRATEGY_MODE_OPTIONS: Array<{ value: 'volume_first' | 'problem_first' | 'hybrid'; label: string; hint: string }> = [
  { value: 'hybrid', label: 'สมดุล', hint: 'ผสมคำที่คนค้นเยอะกับคำที่ตรงปัญหาลูกค้า' },
  { value: 'volume_first', label: 'เน้นยอดค้นหา', hint: 'ไล่จากคำที่มีปริมาณค้นหาสูงก่อน' },
  { value: 'problem_first', label: 'เน้นปัญหาลูกค้า', hint: 'ไล่จากปัญหาและคำถามจริงของลูกค้าก่อน' },
];

export default function WordGodTab({ project, onSendToBank }: Props) {
  const [mode, setMode] = useState<PlanMode>('full_plan');
  const [niche, setNiche] = useState(project.businessType || '');
  const [businessContext, setBusinessContext] = useState(project.name || '');
  const [siteUrl, setSiteUrl] = useState(project.website || '');
  const [seedText, setSeedText] = useState('');
  const [targetCount, setTargetCount] = useState(150);
  const [metricMode, setMetricMode] = useState<KeywordMetricMode>('api_only');
  const [planMonths, setPlanMonths] = useState(12);
  const [articlesPerMonth, setArticlesPerMonth] = useState(12);
  const [planStartMonth, setPlanStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pillarText, setPillarText] = useState('');
  const [presetKey, setPresetKey] = useState<PresetKey>('preset1');
  const [intentRatio, setIntentRatio] = useState<IntentRatio>(PRESETS[0].ratio);
  const [researchMode, setResearchMode] = useState<ResearchMode>('standard');
  const [websiteType, setWebsiteType] = useState<'' | 'ecommerce' | 'service' | 'knowledge'>('');
  const [strategyMode, setStrategyMode] = useState<'volume_first' | 'problem_first' | 'hybrid'>('hybrid');
  const [siteSummary, setSiteSummary] = useState('');
  const [siteCategories, setSiteCategories] = useState<SiteCategory[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [crawlMessage, setCrawlMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('keywords');
  const [sortBy, setSortBy] = useState<'priority' | 'volume' | 'kd'>('priority');
  const [query, setQuery] = useState('');
  const [savingToBank, setSavingToBank] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestedArticles = planMonths * articlesPerMonth;
  const keywordWarning = mode === 'full_plan' && targetCount < requestedArticles;

  const filteredKeywords = useMemo(() => {
    if (!result) return [];
    const search = query.trim().toLowerCase();
    return [...result.keywords]
      .filter(keyword => !search || keyword.keyword.toLowerCase().includes(search) || keyword.title.toLowerCase().includes(search))
      .sort((a, b) => {
        if (sortBy === 'volume') return b.volume - a.volume;
        if (sortBy === 'kd') return (a.organic_difficulty ?? 999) - (b.organic_difficulty ?? 999);
        return (b.priority_score ?? b.opportunity_score) - (a.priority_score ?? a.opportunity_score);
      });
  }, [query, result, sortBy]);

  async function handleSeedFile(file: File): Promise<void> {
    const text = await file.text();
    setSeedText(parseKeywords(text).join('\n'));
  }

  async function crawlSite(): Promise<void> {
    if (!siteUrl.trim()) return;
    setCrawlStatus('loading');
    setCrawlMessage('กำลังอ่าน Sitemap และหน้าสำคัญ...');
    try {
      const response = await fetch('/api/wordgod-v2/crawl-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ไม่สามารถอ่านเว็บไซต์ได้');
      setSiteSummary(data.summary || '');
      setSiteCategories(data.categories || []);
      if (!pillarText) {
        // Prefer money-page-aware derived pillars (real service/apply landings +
        // article quotas); fall back to a naive one-per-category mapping.
        if (Array.isArray(data.derivedPillars) && data.derivedPillars.length > 0) {
          setPillarText((data.derivedPillars as PlanPillarInput[]).map(pillar =>
            `${pillar.name} | ${pillar.seed ?? pillar.name} | ${pillar.moneyPage ?? ''} | ${pillar.articlesPerMonth ?? ''}`
          ).join('\n'));
        } else if (Array.isArray(data.categories)) {
          setPillarText(data.categories.slice(0, 6).map((category: SiteCategory) =>
            `${category.label} | ${category.label} | ${category.url} |`
          ).join('\n'));
        }
      }
      setCrawlStatus('done');
      setCrawlMessage(`พบ ${data.page_count || 0} หน้า และ ${data.categories?.length || 0} หมวด`);
    } catch (error) {
      setCrawlStatus('error');
      setCrawlMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    }
  }

  async function runPipeline(): Promise<void> {
    const seeds = parseKeywords(seedText);
    if (!niche.trim()) {
      setStatus('error');
      setStatusMessage('กรุณาระบุธุรกิจหรือหัวข้อหลัก');
      return;
    }

    setStatus('running');
    setStatusMessage('กำลังเริ่มวิเคราะห์...');
    setLogs([]);
    setResult(null);
    setActiveTab('keywords');

    const requestBody = {
      seeds: seeds.length > 0 ? seeds : [niche.trim()],
      niche: niche.trim(),
      businessContext: businessContext.trim() || niche.trim(),
      category: niche.trim(),
      targetLanguage: 'th',
      targetCount,
      metricMode,
      presetKey,
      intentRatio,
      website_type: websiteType || undefined,
      strategy_mode: strategyMode,
      useKeywordPlanner: true,
      ai_search_optimization: true,
      site_url: siteUrl.trim() || undefined,
      site_context_summary: siteSummary || undefined,
      site_categories: siteCategories,
      mode,
      planMonths,
      articlesPerMonth,
      planStartMonth,
      planPillars: parsePillars(pillarText),
      projectId: project.id,
      // Chunked-run: the server suspends near its soft budget and returns a
      // checkpoint; we immediately re-POST it so big runs never hit the
      // serverless maxDuration wall.
      chunked: true,
    };

    // Drives one server invocation. Returns the checkpoint to continue from,
    // or null when the run is complete.
    async function runChunk(checkpoint: unknown): Promise<{ checkpoint: unknown } | null> {
      const response = await fetch('/api/wordgod-v2/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkpoint ? { ...requestBody, checkpoint } : requestBody),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let complete = false;
      let outcome: { checkpoint: unknown } | null = null;
      let sawTerminal = false;
      while (!complete) {
        const chunk = await reader.read();
        complete = chunk.done;
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !complete });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const payloadLine = event.split('\n').find(line => line.startsWith('data: '));
          if (!payloadLine) continue;
          const payload = JSON.parse(payloadLine.slice(6));
          if (payload.type === 'log') {
            setLogs(previous => [...previous, payload.msg]);
            setStatusMessage(payload.msg);
          } else if (payload.type === 'checkpoint') {
            outcome = { checkpoint: payload.state };
            sawTerminal = true;
          } else if (payload.type === 'done') {
            setResult(payload.result);
            setStatus('done');
            setStatusMessage(`เสร็จแล้ว — ${payload.result.meta.api_backed_count} คีย์เวิร์ดมีข้อมูล API จริง จากทั้งหมด ${payload.result.keywords.length} คำ`);
            sawTerminal = true;
          } else if (payload.type === 'error') {
            sawTerminal = true;
            throw new Error(payload.msg);
          }
        }
      }
      // Stream ended without done/checkpoint/error → the invocation was cut off
      // (network drop or serverless kill). Throw so the caller can retry from
      // the last checkpoint instead of silently showing a frozen screen.
      if (!sawTerminal) throw new Error('การเชื่อมต่อหลุดกลางทาง (ไม่ได้รับผลลัพธ์จากเซิร์ฟเวอร์)');
      return outcome;
    }

    try {
      let checkpoint: unknown = null;
      let finished = false;
      let retries = 0;
      while (!finished) {
        try {
          const outcome = await runChunk(checkpoint);
          retries = 0;
          if (outcome) {
            checkpoint = outcome.checkpoint;
            setLogs(previous => [...previous, '— ทำงานต่อช่วงถัดไปอัตโนมัติ (กันชน timeout ของเซิร์ฟเวอร์) —']);
          } else {
            finished = true;
          }
        } catch (chunkError) {
          // Pipeline-reported errors are terminal; only connection cut-offs retry.
          const message = chunkError instanceof Error ? chunkError.message : '';
          const isCutOff = message.includes('การเชื่อมต่อหลุดกลางทาง') || message.includes('Failed to fetch') || message.includes('network');
          if (!isCutOff || retries >= 2) throw chunkError;
          retries++;
          setLogs(previous => [...previous, `การเชื่อมต่อสะดุด — กำลังลองต่อจากจุดล่าสุด (ครั้งที่ ${retries}/2)...`]);
        }
      }
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    }
  }

  function exportCsv(): void {
    if (!result) return;
    const csv = buildCsv(result);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `wordgod-keywords-${Date.now()}.csv`);
  }

  async function saveToKeywordBank(): Promise<void> {
    if (!result || result.keywords.length === 0) return;
    setSavingToBank(true);
    try {
      const rows = result.keywords.map(kw => ({
        keyword: kw.keyword,
        title: kw.title,
        volume: isDirectMetricSource(kw.volume_source) ? kw.volume : undefined,
        difficulty: kw.organic_difficulty,
        intent: kw.intent,
        funnelStage: kw.journey_stage,
        priority: PRIORITY_TO_NUMBER[kw.priority] ?? undefined,
        meta: { volume_source: kw.volume_source, title_notes: kw.title_notes },
      }));
      const response = await fetch(`/api/projects/${project.id}/keyword-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source: 'keyword-research' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'บันทึกเข้า Keyword Bank ไม่สำเร็จ');
      toast.success(`บันทึกเข้า Keyword Bank แล้ว (สร้างใหม่ ${data.created ?? 0} • อัปเดต ${data.updated ?? 0})`);
      onSendToBank?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกเข้า Keyword Bank ไม่สำเร็จ');
    } finally {
      setSavingToBank(false);
    }
  }

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'keywords', label: 'Keyword Master', count: result?.keywords.length },
    { key: 'competitors', label: 'Competitors', count: result?.keywords.filter(k => (k as any).competitors?.length).length },
    { key: 'content', label: 'Content Plan', count: result?.plan?.contentItems.length },
    { key: 'pillars', label: 'Pillar Map', count: result?.plan?.pillars.length },
    { key: 'calendar', label: 'Calendar', count: result?.plan?.calendar.length },
    { key: 'qa', label: 'QA Report', count: result?.plan?.qa.warnings.length },
  ];

  if (researchMode === 'local_sme') {
    return (
      <div className="min-h-screen bg-[#f7f9fd] text-[#17233a]">
        <div className="mx-auto max-w-[1600px] px-1 pt-4">
          <ResearchModeSwitch mode={researchMode} onChange={setResearchMode} />
        </div>
        <WordGodLocalPanel project={project} onSendToBank={onSendToBank} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#17233a]">
      <div className="mx-auto max-w-[1600px] px-1 pt-4">
        <ResearchModeSwitch mode={researchMode} onChange={setResearchMode} />
      </div>
      <div className="mx-auto grid max-w-[1600px] gap-6 px-1 py-4 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section className={`${cardClass} p-5`}>
            <div className="mb-4">
              <h1 className="text-xl font-bold tracking-tight">สร้างแผน SEO</h1>
              <p className="mt-1 text-xs leading-5 text-[#71809c]">
                โหมดไม่มีหน้าร้าน — หาคีย์เวิร์ดที่มีโอกาสขายของธุรกิจ จากปัญหา/ความต้องการจริงของลูกค้า
                แล้วจัดอันดับตามโอกาสปิดการขาย (เลือกจำนวนคีย์เวิร์ดและระยะเวลาแผนแยกจากกันได้)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#eef1f7] p-1">
              <button onClick={() => setMode('quick_research')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === 'quick_research' ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'}`}>Quick Research</button>
              <button onClick={() => setMode('full_plan')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === 'full_plan' ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'}`}>Full Content Plan</button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className={labelClass}>ธุรกิจ / หัวข้อหลัก *</label>
                <input className={fieldClass} value={niche} onChange={event => setNiche(event.target.value)} placeholder="เช่น สินเชื่อดิจิทัล และการออม" />
              </div>
              <div>
                <label className={labelClass}>บริบทแบรนด์</label>
                <textarea className={`${fieldClass} min-h-20 resize-y`} value={businessContext} onChange={event => setBusinessContext(event.target.value)} placeholder="ชื่อแบรนด์ กลุ่มลูกค้า และบริการหลัก" />
              </div>
              <div>
                <label className={labelClass}>เว็บไซต์</label>
                <div className="flex gap-2">
                  <input className={fieldClass} value={siteUrl} onChange={event => setSiteUrl(event.target.value)} placeholder="https://example.com" />
                  <button disabled={!siteUrl || crawlStatus === 'loading'} onClick={crawlSite} className="shrink-0 rounded-xl border border-[#bcc9e2] bg-[#eff4fe] px-3 text-xs font-bold text-[#0d4fd8] disabled:opacity-50">Crawl</button>
                </div>
                {crawlMessage ? <p className={`mt-1.5 text-[11px] ${crawlStatus === 'error' ? 'text-red-600' : 'text-[#606f8c]'}`}>{crawlMessage}</p> : null}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Seed Keywords</label>
                  <button onClick={() => fileInputRef.current?.click()} className="text-[11px] font-semibold text-[#0d4fd8]">อัปโหลด CSV/TXT</button>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={event => event.target.files?.[0] && handleSeedFile(event.target.files[0])} />
                </div>
                <textarea className={`${fieldClass} min-h-28 resize-y font-mono text-xs`} value={seedText} onChange={event => setSeedText(event.target.value)} placeholder={'หนึ่งคีย์เวิร์ดต่อบรรทัด\nสินเชื่อออนไลน์\nบัญชีออมทรัพย์'} />
              </div>

              <div>
                <label className={labelClass}>ประเภทเว็บไซต์</label>
                <select className={fieldClass} value={websiteType} onChange={event => setWebsiteType(event.target.value as typeof websiteType)}>
                  {WEBSITE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <p className="mt-1.5 text-[10px] leading-4 text-[#71809c]">
                  {PRESET_IMPLIED_WEBSITE_TYPE[presetKey]
                    ? `รูปแบบ Search Intent ที่เลือกไว้กำหนดประเภทเว็บเป็น “${PRESET_IMPLIED_WEBSITE_TYPE[presetKey]}” อยู่แล้ว ค่านี้จะถูกใช้เมื่อเลือกรูปแบบอื่น`
                    : WEBSITE_TYPE_OPTIONS.find(option => option.value === websiteType)?.hint}
                </p>
              </div>

              <div>
                <label className={labelClass}>โฟกัสของการหาคีย์เวิร์ด</label>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#eef1f7] p-1">
                  {STRATEGY_MODE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      onClick={() => setStrategyMode(option.value)}
                      title={option.hint}
                      className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                        strategyMode === option.value ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-[#71809c]">
                  {STRATEGY_MODE_OPTIONS.find(option => option.value === strategyMode)?.hint}
                </p>
              </div>

              <div>
                <label className={labelClass}>รูปแบบ Search Intent</label>
                <select className={fieldClass} value={presetKey} onChange={event => {
                  const key = event.target.value as PresetKey;
                  setPresetKey(key);
                  const preset = PRESETS.find(item => item.key === key);
                  if (preset) setIntentRatio(preset.ratio);
                }}>
                  {PRESETS.filter(preset => preset.key !== 'manual').map(preset => <option key={preset.key} value={preset.key}>{preset.name}</option>)}
                  <option value="manual">ปรับสัดส่วนเอง</option>
                </select>
                <p className="mt-1.5 text-[10px] leading-4 text-[#71809c]">
                  {presetKey === 'manual'
                    ? 'เลื่อนแถบด้านล่างได้ตามต้องการ ระบบจะเกลี่ยสัดส่วนที่เหลือให้รวมเป็น 100%'
                    : PRESETS.find(preset => preset.key === presetKey)?.description}
                </p>
              </div>

              {presetKey === 'manual' ? (
                <div className="space-y-3 rounded-2xl border border-[#cfdefa] bg-[#f4f8fe] p-4">
                  {(Object.keys(intentRatio) as Array<keyof IntentRatio>).map(key => (
                    <div key={key}>
                      <div className="flex items-end justify-between">
                        <label className="text-[11px] font-semibold text-[#495975]" title={INTENT_DESCRIPTIONS[key]}>
                          {INTENT_LABELS[key]}
                        </label>
                        <strong className="text-xs text-[#0d4fd8]">{intentRatio[key]}%</strong>
                      </div>
                      <input
                        type="range" min="0" max="100" step="5" value={intentRatio[key]}
                        onChange={event => setIntentRatio(rebalanceRatio(intentRatio, key, Number(event.target.value)))}
                        className="w-full accent-[#155eef]"
                      />
                    </div>
                  ))}
                  <div className="text-[10px] text-[#71809c]">รวม {totalRatio(intentRatio)}%</div>
                </div>
              ) : null}

              <div>
                <div className="flex items-end justify-between">
                  <label className={labelClass}>จำนวนคีย์เวิร์ด</label>
                  <strong className="text-lg text-[#0d4fd8]">{targetCount.toLocaleString()}</strong>
                </div>
                <input type="range" min="20" max="3000" step="10" value={targetCount} onChange={event => setTargetCount(Number(event.target.value))} className="w-full accent-[#155eef]" />
                <div className="mt-1 flex justify-between text-[10px] text-[#91a0b8]"><span>20</span><span>3,000</span></div>
              </div>

              <div>
                <label className={labelClass}>รูปแบบข้อมูล Volume / CPC</label>
                <select className={fieldClass} value={metricMode} onChange={event => setMetricMode(event.target.value as KeywordMetricMode)}>
                  <option value="api_only">เฉพาะข้อมูล API จริง (แนะนำ)</option>
                  <option value="api_first">ข้อมูล API จริง + Keyword แนะนำ</option>
                </select>
                <p className="mt-1.5 text-[10px] leading-4 text-[#71809c]">
                  {metricMode === 'api_only'
                    ? 'ไม่เติม Volume ประมาณ หาก API หาไม่ครบ ระบบจะแจ้งจำนวนที่พบจริง'
                    : 'เติมคำแนะนำให้ใกล้จำนวนเป้าหมาย แต่ช่อง Volume/CPC ของคำที่ไม่มีข้อมูลจริงจะเว้นว่าง'}
                </p>
              </div>

              {mode === 'full_plan' ? (
                <div className="space-y-4 rounded-2xl border border-[#cfdefa] bg-[#f4f8fe] p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>วางแผนกี่เดือน</label>
                      <select className={fieldClass} value={planMonths} onChange={event => setPlanMonths(Number(event.target.value))}>
                        {Array.from({ length: 12 }, (_, index) => index + 1).map(month => <option key={month} value={month}>{month} เดือน</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>บทความ / เดือน</label>
                      <input className={fieldClass} type="number" min="1" max="50" value={articlesPerMonth} onChange={event => setArticlesPerMonth(Math.min(Math.max(Number(event.target.value), 1), 50))} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>เริ่มเดือน</label>
                    <input className={fieldClass} type="month" value={planStartMonth} onChange={event => setPlanStartMonth(event.target.value)} />
                  </div>
                  <div className="rounded-xl border border-[#dbe1ee] bg-white px-3 py-2.5 text-xs">
                    เป้าหมาย <strong className="text-[#0d4fd8]">{requestedArticles.toLocaleString()} บทความ</strong>
                    <span className="ml-1 text-[#71809c]">ตลอด {planMonths} เดือน</span>
                  </div>
                  {keywordWarning ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">จำนวนคีย์เวิร์ดน้อยกว่าเป้าหมายบทความ ระบบจะจัด Calendar เท่าที่ทำได้โดยไม่ใช้ Primary Keyword ซ้ำ</p> : null}
                  <div>
                    <label className={labelClass}>Pillar / Money Page / Quota (ไม่บังคับ)</label>
                    <textarea className={`${fieldClass} min-h-28 resize-y font-mono text-[11px]`} value={pillarText} onChange={event => setPillarText(event.target.value)} placeholder={'ชื่อ Pillar | Seed | Money Page URL | บทความ/เดือน\nSavings | เงินออม | https://site.com/savings/ | 3'} />
                    <p className="mt-1 text-[10px] leading-4 text-[#71809c]">หากไม่กรอก ระบบจะสร้าง Pillar และกระจายบทความให้อัตโนมัติ</p>
                  </div>
                </div>
              ) : null}

              <button disabled={status === 'running'} onClick={runPipeline} className="w-full rounded-xl bg-[#155eef] px-4 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(21,94,239,0.22)] transition hover:bg-[#0d4fd8] disabled:cursor-not-allowed disabled:opacity-60">
                {status === 'running' ? 'กำลังวิเคราะห์...' : mode === 'full_plan' ? 'สร้าง Keyword + Content Plan' : 'เริ่ม Keyword Research'}
              </button>
            </div>
          </section>

          {status !== 'idle' ? (
            <section className={`${cardClass} overflow-hidden`}>
              <div className="border-b border-[#e3e8f1] px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse bg-amber-500' : status === 'done' ? 'bg-blue-500' : 'bg-red-500'}`} />
                  {statusMessage}
                </div>
              </div>
              {logs.length > 0 ? <div className="max-h-44 overflow-auto px-4 py-3 font-mono text-[10px] leading-5 text-[#71809c]">{logs.slice(-30).map((log, index) => <div key={`${index}-${log}`}>{log}</div>)}</div> : null}
            </section>
          ) : null}
        </aside>

        <section className="min-w-0 space-y-5">
          {status === 'running' ? (
            <KeywordResearchProgress title="กำลังวิเคราะห์คีย์เวิร์ด" logs={logs} />
          ) : !result ? (
            <div className="grid min-h-[640px] place-items-center rounded-2xl p-10 text-center shadow-sm"
              style={{ background: 'linear-gradient(160deg, #1d48f3 0%, #0618df 45%, #0107a9 75%, #000E3F 100%)' }}>
              {/* Dark Tone ตาม CVC Brand Guideline — Technology · Trust · Innovation */}
              <div className="max-w-xl">
                <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-3xl text-brand-cyan">⌁</div>
                <h2 className="text-2xl font-bold tracking-tight text-white">Keyword Research ที่ต่อยอดเป็น<span className="text-brand-cyan">แผนได้จริง</span></h2>
                <p className="mt-3 text-sm leading-7 text-white/70">ระบบจะแยก Keyword Master, Content Plan, Pillar Map, Calendar และ QA โดยจำนวนคีย์เวิร์ดยังคงเลือกได้เหมือนเดิม</p>
                <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
                  {[
                    ['1–3,000', 'เลือกจำนวนคีย์เวิร์ด'],
                    ['1–12 เดือน', 'เลือกระยะเวลาแผน'],
                    ['CSV', 'ส่งออกได้ทันที'],
                  ].map(([value, label]) => <div key={label} className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"><div className="text-lg font-bold text-white">{value}</div><div className="mt-1 text-xs text-white/60">{label}</div></div>)}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ['Keywords', result.keywords.length, 'Keyword Master'],
                  ['API Metrics', result.meta.api_backed_count, 'KP + DataForSEO'],
                  ['Suggestions', result.meta.derived_count + result.meta.estimated_count, 'ไม่มี Volume ตรง'],
                  ['Content', result.plan?.contentItems.length ?? 0, 'รายการบทความ'],
                  ['Calendar', result.plan?.calendar.length ?? 0, `${result.plan?.config.months ?? 0} เดือน`],
                ].map(([label, value, sub]) => <div key={String(label)} className={`${cardClass} p-4`}><div className="text-xs font-semibold text-[#71809c]">{label}</div><div className="mt-1 text-2xl font-bold tracking-tight text-[#17233a]">{Number(value).toLocaleString()}</div><div className="mt-1 text-[11px] text-[#91a0b8]">{sub}</div></div>)}
              </div>

              <div className={`rounded-2xl border px-4 py-3 text-xs leading-5 ${result.meta.api_backed_count === result.keywords.length ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                พบข้อมูล Volume API จริง <strong>{result.meta.api_backed_count.toLocaleString()} คำ</strong> จากเป้าหมาย <strong>{result.meta.requested_count.toLocaleString()} คำ</strong>
                {result.meta.shortfall_count > 0 ? ` • ขาด ${result.meta.shortfall_count.toLocaleString()} คำ และระบบไม่ได้สร้าง Volume ปลอมมาทดแทน` : ''}
                {' • '}CPC แสดงเป็น <strong>THB เท่านั้น</strong>; ถ้า Provider แปลงสกุลเงินไม่ได้ ระบบจะเว้น CPC ว่าง
              </div>

              <div className={`${cardClass} overflow-hidden`}>
                <div className="flex flex-col gap-3 border-b border-[#dbe1ee] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#eef1f7] p-1">
                    {tabs.map(tab => (
                      <button key={tab.key} disabled={tab.key === 'competitors' ? !result?.keywords.some(k => (k as any).competitors?.length) : tab.key !== 'keywords' && !result.plan} onClick={() => setActiveTab(tab.key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${activeTab === tab.key ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c] hover:text-[#17233a]'}`}>
                        {tab.label}{typeof tab.count === 'number' ? ` (${tab.count})` : ''}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={exportCsv} className="rounded-lg border border-[#cfd9ea] bg-white px-3 py-2 text-xs font-semibold text-[#495975] hover:bg-[#f7f9fd]">CSV</button>
                    <button disabled={savingToBank} onClick={saveToKeywordBank} className="rounded-lg bg-[#155eef] px-3 py-2 text-xs font-bold text-white hover:bg-[#0d4fd8] disabled:cursor-not-allowed disabled:opacity-60">
                      {savingToBank ? 'กำลังบันทึก...' : `บันทึกเข้า Keyword (${result.keywords.length})`}
                    </button>
                  </div>
                </div>

                {activeTab === 'keywords' ? (
                  <div>
                    <div className="flex flex-col gap-3 border-b border-[#e3e8f1] bg-[#fbfcfe] p-4 sm:flex-row">
                      <input className={`${fieldClass} sm:max-w-sm`} value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหา Keyword หรือ Title" />
                      <select className={`${fieldClass} sm:w-48`} value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}>
                        <option value="priority">เรียงตาม Priority</option>
                        <option value="volume">เรียงตาม Volume</option>
                        <option value="kd">เรียงตาม KD ต่ำ</option>
                      </select>
                    </div>
                    <div className="max-h-[760px] overflow-auto">
                      <table className="w-full min-w-[1330px] text-xs">
                        <thead className="sticky top-0 z-10 bg-[#f0f3f9] text-[#495975]">
                          <tr>{['#', 'Keyword', 'Pillar', 'Title (H1)', 'Volume', 'Trend', 'KD', 'CPC (THB)', 'Intent', 'AEO', 'P Score', 'Priority', 'Source'].map(header => <th key={header} className="border-b border-[#dbe1ee] px-3 py-3 text-left font-bold">{header}</th>)}</tr>
                        </thead>
                        <tbody>
                          {filteredKeywords.map((keyword, index) => {
                            const item = result.plan?.contentItems.find(content => content.primaryKeyword === keyword.keyword);
                            return (
                              <tr key={keyword.keyword} className="border-b border-[#edf0f5] align-top hover:bg-[#f8fafd]">
                                <td className="px-3 py-3 text-[#91a0b8]">{index + 1}</td>
                                <td className="max-w-[240px] px-3 py-3 font-semibold text-[#17233a]">{keyword.keyword}</td>
                                <td className="max-w-[180px] px-3 py-3 text-[#606f8c]">{item?.pillar ?? keyword.parent_topic ?? '—'}</td>
                                <td className="max-w-[360px] px-3 py-3 leading-5 text-[#495975]">{keyword.title}</td>
                                <td className="px-3 py-3 text-right font-mono">{keyword.metric_confidence === 'high' ? formatNumber(keyword.volume) : '—'}</td>
                                <td className="px-3 py-3"><Sparkline trend={keyword.monthly_trend} /></td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.organic_difficulty)}</td>
                                <td className="px-3 py-3 text-right font-mono">{keyword.metric_confidence === 'high' && typeof keyword.cpc === 'number' && keyword.cpc > 0 ? formatNumber(keyword.cpc, 2) : '—'}</td>
                                <td className="px-3 py-3 text-[#606f8c]">{keyword.intent}</td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.aeo_opportunity_score)}</td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.priority_score)}</td>
                                <td className="px-3 py-3"><PriorityBadge value={item?.priority ?? keyword.priority} /></td>
                                <td className="px-3 py-3"><SourceBadge value={keyword.volume_source} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'competitors' ? (
                  <div className="space-y-4 p-5">
                    {result.keywords.filter(k => (k as any).competitors?.length > 0).map(keyword => {
                      const kw = keyword as any;
                      const siteRank = kw.site_rank;
                      const confidence = kw.rank_confidence as 'high' | 'medium' | 'low' | undefined;
                      const competitors = Array.from(kw.competitors as Array<{ position: number; domain: string; url: string; title: string }>).sort((a, b) => a.position - b.position);
                      const confidenceStyle = confidence === 'high'
                        ? 'bg-blue-50 text-blue-700'
                        : confidence === 'medium'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-red-50 text-red-700';
                      const confidenceLabel = confidence === 'high' ? 'ความมั่นใจสูง' : confidence === 'medium' ? 'ปานกลาง' : 'ต่ำ — ควรเช็กเอง';
                      return (
                        <article key={keyword.keyword} className="rounded-2xl border border-[#dbe1ee] bg-white p-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-bold">{keyword.keyword}</h3>
                            <div className="flex items-center gap-2">
                              {confidence ? <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${confidenceStyle}`}>{confidenceLabel}</span> : null}
                              {typeof siteRank === 'number'
                                ? <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">อันดับของเรา: #{siteRank}</span>
                                : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">ยังไม่ติดอันดับ</span>}
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            {competitors.map(entry => {
                              const isOurs = entry.position === siteRank;
                              return (
                                <div key={entry.position} className={`rounded-lg px-3 py-2 text-xs ${isOurs ? 'border border-blue-200 bg-blue-50' : ''}`}>
                                  <div className="flex items-start gap-2">
                                    <span className="font-mono font-semibold text-[#606f8c]">#{entry.position}</span>
                                    <div className="min-w-0 flex-1">
                                      <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-[#155eef] hover:underline">{entry.title}</a>
                                      <div className="mt-0.5 text-[11px] text-[#91a0b8]">{entry.domain}</div>
                                    </div>
                                    {isOurs ? <span className="whitespace-nowrap font-bold text-blue-700">← เว็บของเรา</span> : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}

                {activeTab === 'content' && result.plan ? (
                  <div className="max-h-[820px] overflow-auto">
                    <table className="w-full min-w-[1350px] text-xs">
                      <thead className="sticky top-0 z-10 bg-[#f0f3f9] text-[#495975]"><tr>{['Type', 'Title', 'Primary Keyword', 'Pillar', 'Funnel', 'Money Page', 'Internal Links', 'Priority', 'Status'].map(header => <th key={header} className="border-b border-[#dbe1ee] px-3 py-3 text-left">{header}</th>)}</tr></thead>
                      <tbody>{result.plan.contentItems.map(item => <tr key={item.id} className="border-b border-[#edf0f5] align-top hover:bg-[#f8fafd]">
                        <td className="px-3 py-3 font-semibold text-[#0d4fd8]">{item.type}</td>
                        <td className="max-w-[380px] px-3 py-3 font-medium leading-5">{item.title}</td>
                        <td className="max-w-[220px] px-3 py-3 text-[#495975]">{item.primaryKeyword}</td>
                        <td className="px-3 py-3">{item.pillar}</td>
                        <td className="px-3 py-3">{item.funnel}</td>
                        <td className="max-w-[240px] break-all px-3 py-3 text-[#606f8c]">{item.moneyPage || '—'}</td>
                        <td className="max-w-[300px] px-3 py-3 text-[#606f8c]">{item.internalLinks.join(' • ') || '—'}</td>
                        <td className="px-3 py-3"><PriorityBadge value={item.priority} /></td>
                        <td className="px-3 py-3">{item.status}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                ) : null}

                {activeTab === 'pillars' && result.plan ? (
                  <div className="grid gap-4 p-5 xl:grid-cols-2">
                    {result.plan.pillars.map(pillar => <article key={pillar.name} className="rounded-2xl border border-[#dbe1ee] bg-[#fbfcfe] p-5">
                      <div className="flex items-start justify-between gap-4"><div><h3 className="font-bold">{pillar.name}</h3><p className="mt-1 text-xs text-[#71809c]">{pillar.pillarKeyword}</p></div><span className="rounded-full bg-[#eaf1fe] px-2.5 py-1 text-xs font-bold text-[#0d4fd8]">{pillar.totalItems} items</span></div>
                      <div className="mt-4 grid grid-cols-4 gap-2 text-center">{[['Quota', pillar.monthlyQuota], ['P1', pillar.p1], ['P2', pillar.p2], ['P3', pillar.p3]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#e3e8f1] bg-white p-2"><div className="font-bold">{value}</div><div className="text-[10px] text-[#71809c]">{label}</div></div>)}</div>
                      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100"><div className="bg-sky-400" style={{ width: `${pillar.totalItems ? pillar.tofu / pillar.totalItems * 100 : 0}%` }} /><div className="bg-amber-400" style={{ width: `${pillar.totalItems ? pillar.mofu / pillar.totalItems * 100 : 0}%` }} /><div className="bg-blue-500" style={{ width: `${pillar.totalItems ? pillar.bofu / pillar.totalItems * 100 : 0}%` }} /></div>
                      <div className="mt-2 flex gap-4 text-[10px] text-[#71809c]"><span>TOFU {pillar.tofu}</span><span>MOFU {pillar.mofu}</span><span>BOFU {pillar.bofu}</span></div>
                      {pillar.moneyPage ? <p className="mt-3 break-all text-[11px] text-[#606f8c]">Money Page: {pillar.moneyPage}</p> : null}
                    </article>)}
                  </div>
                ) : null}

                {activeTab === 'calendar' && result.plan ? (
                  <div className="space-y-6 p-5">
                    {Array.from({ length: result.plan.config.months }, (_, index) => index + 1).map(monthIndex => {
                      const entries = result.plan!.calendar.filter(entry => entry.monthIndex === monthIndex);
                      const month = entries[0]?.month || `เดือน ${monthIndex}`;
                      return <section key={monthIndex} className="overflow-hidden rounded-2xl border border-[#dbe1ee]">
                        <div className="flex items-center justify-between bg-[#f0f3f9] px-4 py-3"><h3 className="font-bold">เดือน {monthIndex} — {month}</h3><span className="text-xs text-[#606f8c]">{entries.length} บทความ</span></div>
                        {entries.length > 0 ? <div className="divide-y divide-[#edf0f5]">{entries.map(entry => <div key={entry.contentItemId} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-[90px_150px_1fr_100px]">
                          <div className="font-mono text-[#606f8c]">{entry.publishDate}</div><div className="font-semibold text-[#0d4fd8]">{entry.pillar}</div><div><div className="font-medium leading-5">{entry.title}</div><div className="mt-1 text-[11px] text-[#71809c]">{entry.primaryKeyword} • {entry.funnel} • {entry.contentType}</div></div><div><PriorityBadge value={entry.priority} /></div>
                        </div>)}</div> : <div className="px-4 py-5 text-xs text-amber-700">ไม่มีคีย์เวิร์ดเหลือสำหรับเดือนนี้ กรุณาเพิ่มจำนวนคีย์เวิร์ด</div>}
                      </section>;
                    })}
                  </div>
                ) : null}

                {activeTab === 'qa' && result.plan ? (
                  <div className="p-5">
                    <div className={`rounded-2xl border p-5 ${result.plan.qa.passes ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="text-sm font-bold">{result.plan.qa.passes ? 'QA ผ่านเงื่อนไขหลัก' : 'QA ต้องตรวจเพิ่มเติม'}</div>
                      <div className="mt-1 text-xs text-[#606f8c]">จัด Calendar ได้ {result.plan.qa.scheduledArticles}/{result.plan.qa.requestedArticles} บทความ</div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ['Keyword ซ้ำ', result.plan.qa.duplicateKeywords.length],
                        ['Title ซ้ำ', result.plan.qa.duplicateTitles.length],
                        ['ไม่มี Money Page', result.plan.qa.missingMoneyPages],
                        ['ไม่มี Internal Links', result.plan.qa.missingInternalLinks],
                        ['ไม่มี Organic KD', result.plan.qa.missingOrganicDifficulty],
                        ['ไม่มี CPC', result.plan.qa.missingCpc],
                        ['Calendar นอก Master', result.plan.qa.calendarOutsideKeywordMaster],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#dbe1ee] bg-[#fbfcfe] p-4"><div className="text-xl font-bold">{value}</div><div className="mt-1 text-xs text-[#71809c]">{label}</div></div>)}
                    </div>
                    <div className="mt-5 space-y-2">{result.plan.qa.warnings.length > 0 ? result.plan.qa.warnings.map(warning => <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">{warning}</div>) : <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">ไม่พบคำเตือนเพิ่มเติม</div>}</div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
