'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PipelineResult } from '@/lib/wordgod/pipeline/wordgodPipeline';
import type { KeywordMetricMode } from '@/lib/wordgod/pipeline/keywordMetricPolicy';
import type { PlanMode, PlanPillarInput } from '@/lib/wordgod/planning/contentPlan';
import { INTENT_DESCRIPTIONS, INTENT_LABELS, PRESETS, rebalanceRatio, totalRatio } from '@/lib/wordgod/skills/intentRatioSkill';
import type { IntentRatio, PresetKey } from '@/lib/wordgod/skills/intentRatioSkill';
import WordGodLocalPanel from './WordGodLocalPanel';
import WordGodOnlinePanel from './WordGodOnlinePanel';
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

  // โหมดไม่มีหน้าร้าน → workspace ใหม่ (Business-Centric Keyword Intelligence)
  // แทนที่ standard pipeline UI เดิมทั้งก้อน — logic ฝั่ง run เดิมยังอยู่ในไฟล์เผื่ออ้างอิง
  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#17233a]">
      <div className="mx-auto max-w-[1600px] px-1 pt-4">
        <ResearchModeSwitch mode={researchMode} onChange={setResearchMode} />
      </div>
      <WordGodOnlinePanel project={project} onSendToBank={onSendToBank} />
    </div>
  );

}
