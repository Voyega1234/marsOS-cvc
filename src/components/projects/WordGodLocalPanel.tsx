'use client';

/**
 * WordGod — โหมด "ธุรกิจในพื้นที่ (Local SME)"
 *
 * เรียก /api/wordgod/local-research แล้วแสดงผลโดยจัดลำดับตาม "คะแนนโอกาส"
 * ไม่ใช่ปริมาณการค้นหา — คำที่คนค้นน้อยแต่พร้อมจ้างงาน ต้องอยู่บนสุด
 *
 * ใช้ typography / ปุ่ม / การ์ด ชุดเดียวกับหน้า Keyword Research เดิม
 * ไม่แตะเส้นทาง Standard และไม่แก้หน้าอื่นใด ๆ
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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

const FILTER_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'high', label: 'คะแนนสูง' },
  { key: 'local', label: 'ระบุพื้นที่' },
  { key: 'near_me', label: 'ใกล้ฉัน' },
  { key: 'price', label: 'ถามราคา' },
  { key: 'commercial', label: 'กำลังเลือกเจ้า' },
  { key: 'comparison', label: 'เปรียบเทียบ' },
  { key: 'urgency', label: 'ต้องการด่วน' },
  { key: 'question', label: 'ตั้งคำถาม' },
  { key: 'nearby', label: 'พื้นที่ใกล้เคียง' },
];

const PRIORITY_LABELS: Record<string, string> = { high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' };
const PRIORITY_TO_NUMBER: Record<string, number> = { high: 3, medium: 2, low: 1 };

const COMPETITION_LABELS: Record<string, string> = {
  LOW: 'ต่ำ', MEDIUM: 'ปานกลาง', HIGH: 'สูง', UNSPECIFIED: 'ไม่ระบุ',
};

const SOURCE_LABELS: Record<string, string> = {
  generated: 'สร้างจากพื้นที่+บริการ',
  keyword_planner: 'Keyword Planner',
  search_console: 'Search Console',
  suggest: 'Google Suggest',
};

const NO_VOLUME_TOOLTIP = 'Keyword Planner มีข้อมูลไม่เพียงพอสำหรับคำนี้';

/** เจตนา → ค่า intent/funnel ของ Keyword Bank เดิม (ไม่เปลี่ยนสคีมา) */
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

function PriorityCell({ row }: { row: KeywordResearchResult }) {
  const breakdown = scoreBreakdown(row.score)
    .map(part => `${part.label} ${part.earned}/${part.max}`)
    .join(' · ');
  const style = row.priority === 'high'
    ? 'border-blue-200 bg-blue-50 text-blue-800'
    : row.priority === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span
      title={`${row.score.total}/100 — ${breakdown}`}
      className={`inline-flex cursor-help items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${style}`}
    >
      {row.score.total}
      <span className="font-semibold opacity-70">{PRIORITY_LABELS[row.priority]}</span>
    </span>
  );
}

function VolumeCell({ value }: { value: number | null }) {
  if (value === null) return <span title={NO_VOLUME_TOOLTIP} className="cursor-help text-[#c7cfde]">—</span>;
  if (value === 0) {
    return (
      <span title="Keyword Planner รายงานว่าค้นหาน้อยมาก (ต่ำกว่าเกณฑ์ที่รายงานได้)" className="cursor-help text-[#71809c]">
        0
      </span>
    );
  }
  return <span>{value.toLocaleString('th-TH')}</span>;
}

/** sparkline ยอดค้นหารายเดือน (เก่า → ใหม่) — เส้นน้ำเงินแบรนด์ */
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

export default function WordGodLocalPanel({ project, onSendToBank }: Props) {
  const [serviceText, setServiceText] = useState('');
  const [primaryLocation, setPrimaryLocation] = useState('');
  const [primaryType, setPrimaryType] = useState<LocalAreaType>('district');
  const [primaryParent, setPrimaryParent] = useState('');
  const [nearbyText, setNearbyText] = useState('');
  // โหมดนี้คือทางเข้า "มีหน้าร้าน" ของหน้า Keyword Research — ค่าเริ่มต้นจึงเป็น storefront
  const [businessType, setBusinessType] = useState<LocalBusinessType>('storefront');
  const [radius, setRadius] = useState<number | null>(null);
  const [language, setLanguage] = useState<'th' | 'th_en'>('th');
  const [expandWithKP, setExpandWithKP] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  type SitemapPage = { page: string; pageType: string; slug: string; keywords: Array<{ keyword: string; volume: number | null; title?: string }> };
  const [data, setData] = useState<(LocalResearchResponse & { sitemap?: SitemapPage[] }) | null>(null);
  const [view, setView] = useState<'keywords' | 'clusters' | 'sitemap'>('keywords');
  const [targetCount, setTargetCount] = useState(50);
  const [chip, setChip] = useState('all');
  const [pageFilter, setPageFilter] = useState('all');
  const [clusterFilter, setClusterFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const results = data?.results ?? [];
  const clusters = data?.clusters ?? [];

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return results.filter(row => {
      if (search && !row.keyword.toLowerCase().includes(search)) return false;
      if (pageFilter !== 'all' && row.suggestedPage !== pageFilter) return false;
      if (clusterFilter !== 'all' && row.cluster !== clusterFilter) return false;
      switch (chip) {
        case 'all': return true;
        case 'high': return row.priority === 'high';
        case 'nearby': return row.locationRole === 'nearby';
        default: return row.intents.includes(chip as LocalIntentTag);
      }
    });
  }, [results, query, chip, pageFilter, clusterFilter]);

  const summary = useMemo(() => {
    const high = results.filter(r => r.priority === 'high').length;
    const withVolume = results.filter(r => r.volume !== null).length;
    const primary = results.filter(r => r.locationRole === 'primary').length;
    const nearby = results.filter(r => r.locationRole === 'nearby').length;
    return { high, withVolume, primary, nearby };
  }, [results]);

  // ทำเลหลักที่พิมพ์ → แขวง/เขตติดกัน/สถานีรถไฟฟ้า จากฐานข้อมูลพื้นที่
  // ไม่รู้จักพื้นที่ = คืน null แล้วให้ผู้ใช้พิมพ์เอง ไม่เดาให้
  // ฐาน กทม./ปริมณฑล (มีเขตติดกัน+รถไฟฟ้า) ก่อน → ไม่เจอค่อยเปิดฐานทั้งประเทศ (lazy load)
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

  /** ชื่อทำเลรองที่เลือกไว้แล้ว (normalize) ใช้เช็คว่าชิปไหนถูกกดไปแล้ว */
  const pickedNearby = useMemo(
    () => new Set(parseLines(nearbyText).map(normalizeAreaName)),
    [nearbyText]
  );

  /** ชิปที่กดแล้วเป็น toggle — กดซ้ำเอาออก เพื่อไม่ให้ต้องไปลบในกล่องข้อความเอง */
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

  async function runResearch(): Promise<void> {
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

    setStatus('running');
    setStatusMessage('กำลังสร้างคีย์เวิร์ดและดึงข้อมูลจาก Keyword Planner...');

    try {
      const response = await fetch('/api/wordgod/local-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          services,
          primaryLocation: {
            name: primaryLocation.trim(),
            type: primaryType,
            // ไม่ได้กรอกจังหวัดเอง แต่ระบบรู้จักพื้นที่นี้ → เติมจังหวัดที่ถูกต้องให้
            parent: primaryParent.trim() || areaMatch?.province || undefined,
          },
          // ชื่อที่มาจากฐานข้อมูลรู้ชนิดจริง (แขวง / BTS / MRT) ส่งไปให้ถูกชนิด
          // ชื่อที่ผู้ใช้พิมพ์เองและไม่รู้จัก ใช้ 'district' เป็นค่าตั้งต้นเหมือนเดิม
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
          expandWithKeywordPlanner: expandWithKP,
          projectId: project.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

      setData(payload as LocalResearchResponse);
      setChip('all');
      setPageFilter('all');
      setClusterFilter('all');
      setStatus('done');
      setStatusMessage(`ได้ ${payload.results?.length ?? 0} คีย์เวิร์ด`);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    }
  }

  function exportCsv(): void {
    if (results.length === 0) return;
    const header = [
      'Keyword', 'Search Volume', 'Ads Competition', 'Competition Index', 'Bid Low (THB)', 'Bid High (THB)',
      'Priority Score', 'Priority Level', 'Intent', 'Location', 'Location Role', 'Service', 'Cluster',
      'Suggested Page', 'Source',
    ];
    const lines = [header.join(',')];
    for (const row of filtered) {
      lines.push([
        csvCell(row.keyword),
        csvCell(row.volume),
        csvCell(row.adsCompetition),
        csvCell(row.competitionIndex),
        csvCell(row.bidLow),
        csvCell(row.bidHigh),
        csvCell(row.score.total),
        csvCell(PRIORITY_LABELS[row.priority]),
        csvCell(row.intents.map(t => INTENT_TAG_LABELS[t]).join(' | ')),
        csvCell(row.location),
        csvCell(row.locationRole === 'primary' ? 'พื้นที่หลัก' : row.locationRole === 'nearby' ? 'พื้นที่ใกล้เคียง' : ''),
        csvCell(row.service),
        csvCell(row.cluster),
        csvCell(row.suggestedPage ? SUGGESTED_PAGE_LABELS[row.suggestedPage] : ''),
        csvCell(row.sources.map(s => SOURCE_LABELS[s] ?? s).join(' | ')),
      ].join(','));
    }
    // BOM เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง (เหมือน export เดิม)
    downloadBlob(
      new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
      `wordgod-local-${Date.now()}.csv`,
    );
  }

  async function saveToKeywordBank(): Promise<void> {
    if (filtered.length === 0) return;
    setSaving(true);
    try {
      const rows = filtered.map(row => {
        const mapped = bankIntent(row.intents);
        return {
          keyword: row.keyword,
          volume: row.volume ?? undefined,
          intent: mapped.intent,
          funnelStage: mapped.funnelStage,
          priority: PRIORITY_TO_NUMBER[row.priority] ?? undefined,
          seedKeyword: row.service || undefined,
          meta: {
            priorityScore: row.score.total,
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

  const kpStatus = data?.meta.keywordPlannerStatus;
  const kpDegraded = kpStatus === 'unavailable';

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6 px-1 py-4 lg:grid-cols-[390px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <section className={`${cardClass} p-5`}>
          <div className="mb-4">
            <h1 className="text-xl font-bold tracking-tight">หาคีย์เวิร์ดลูกค้าในพื้นที่</h1>
            <p className="mt-1 text-xs leading-5 text-[#71809c]">
              โหมดมีหน้าร้าน — เน้น keyword + ทำเล เรียงตาม “คำที่มีโอกาสเป็นลูกค้าสูง” ไม่ใช่ยอดค้นหา
              — คำที่คนค้นน้อยแต่พร้อมจ้างงานจะอยู่บนสุด
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
              <label className={labelClass}>จำนวนคีย์เวิร์ดที่ต้องการ</label>
              <div className="flex items-center gap-2">
                <input type="range" min={10} max={200} step={10} value={targetCount}
                  onChange={e => setTargetCount(Number(e.target.value))} className="flex-1 accent-brand-blue" />
                <input type="number" min={10} max={200} value={targetCount}
                  onChange={e => setTargetCount(Math.min(200, Math.max(10, Number(e.target.value) || 50)))}
                  className="h-8 w-16 rounded-lg border border-[#bcc9e2] bg-white px-2 text-center text-xs font-bold" />
              </div>
              <p className="mb-3 mt-1 text-[10px] leading-4 text-[#71809c]">ระบบคัดตามคะแนนโอกาส — ทุกคำมี Search Volume จริง</p>
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
              {showAdvanced ? 'ซ่อนตัวเลือกขั้นสูง' : 'ตัวเลือกขั้นสูง (ประเภทพื้นที่, จังหวัด, Keyword Planner)'}
            </button>

            {showAdvanced ? (
              <div className="space-y-4 rounded-2xl border border-[#cfdefa] bg-[#f4f8fe] p-4">
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
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse bg-amber-500' : status === 'done' ? 'bg-blue-500' : 'bg-red-500'}`} />
              {statusMessage}
            </div>
            {data ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[#495975]">
                <div><dt className="text-[#91a0b8]">คะแนนสูง</dt><dd className="font-bold text-[#0d4fd8]">{summary.high}</dd></div>
                <div><dt className="text-[#91a0b8]">มีข้อมูลยอดค้นหา</dt><dd className="font-bold">{summary.withVolume}</dd></div>
                <div><dt className="text-[#91a0b8]">พื้นที่หลัก</dt><dd className="font-bold">{summary.primary}</dd></div>
                <div><dt className="text-[#91a0b8]">พื้นที่ใกล้เคียง</dt><dd className="font-bold">{summary.nearby}</dd></div>
              </dl>
            ) : null}
            {data?.meta.locationTarget ? (
              <p className="mt-3 border-t border-[#eef1f7] pt-2 text-[10px] leading-4 text-[#71809c]">
                ข้อมูลยอดค้นหาอิงพื้นที่: <strong>{data.meta.locationTarget.resolved}</strong>
                {data.meta.locationTarget.level === 'country' ? ' (ระดับประเทศ)' : ''}
              </p>
            ) : null}
            {data?.meta.warnings?.length ? (
              <ul className="mt-2 space-y-1 text-[10px] leading-4 text-amber-700">
                {data.meta.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}
              </ul>
            ) : null}
          </section>
        ) : null}
      </aside>

      <main className="space-y-4">
        {kpDegraded ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <span>{data?.meta.keywordPlannerMessage}</span>
            <button onClick={runResearch} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-900">
              ลองใหม่
            </button>
          </div>
        ) : null}

        {data ? (
          <section className={`${cardClass} overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#e3e8f1] px-4 py-3">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef1f7] p-1">
                <button onClick={() => setView('keywords')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === 'keywords' ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'}`}>คีย์เวิร์ด ({results.length})</button>
                <button onClick={() => setView('clusters')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === 'clusters' ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'}`}>กลุ่มเนื้อหา ({clusters.length})</button>
                <button onClick={() => setView('sitemap')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === 'sitemap' ? 'bg-white text-[#0d4fd8] shadow-sm' : 'text-[#606f8c]'}`}>Sitemap ({data?.sitemap?.length ?? 0})</button>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  className="w-44 rounded-xl border border-[#cfd9ea] bg-white px-3 py-2 text-xs outline-none focus:border-[#155eef]"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="ค้นหาคีย์เวิร์ด"
                />
                <button onClick={exportCsv} className="rounded-xl border border-[#bcc9e2] bg-[#eff4fe] px-3 py-2 text-xs font-bold text-[#0d4fd8]">Export CSV</button>
                <button
                  disabled={saving || filtered.length === 0}
                  onClick={saveToKeywordBank}
                  className="rounded-xl bg-[#155eef] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {saving ? 'กำลังบันทึก...' : 'ส่งเข้า Keyword Bank'}
                </button>
              </div>
            </div>

            {view === 'keywords' ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5 border-b border-[#eef1f7] px-4 py-2.5">
                  {FILTER_CHIPS.map(item => (
                    <button
                      key={item.key}
                      onClick={() => setChip(item.key)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                        chip === item.key
                          ? 'border-[#155eef] bg-[#155eef] text-white'
                          : 'border-[#dbe1ee] bg-white text-[#606f8c] hover:border-[#bcc9e2]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  <select
                    className="ml-auto rounded-lg border border-[#dbe1ee] bg-white px-2 py-1 text-[11px] text-[#495975]"
                    value={pageFilter}
                    onChange={event => setPageFilter(event.target.value)}
                  >
                    <option value="all">ทุกหน้าที่แนะนำ</option>
                    {Array.from(new Set(results.map(r => r.suggestedPage).filter(Boolean))).map(page => (
                      <option key={page} value={page as string}>{SUGGESTED_PAGE_LABELS[page as keyof typeof SUGGESTED_PAGE_LABELS]}</option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-[#dbe1ee] bg-white px-2 py-1 text-[11px] text-[#495975]"
                    value={clusterFilter}
                    onChange={event => setClusterFilter(event.target.value)}
                  >
                    <option value="all">ทุกกลุ่ม</option>
                    {clusters.map(cluster => <option key={cluster.name} value={cluster.name}>{cluster.name}</option>)}
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-xs">
                    <thead className="bg-[#f7f9fd] text-left text-[11px] uppercase tracking-wide text-[#71809c]">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">คีย์เวิร์ด</th>
                        <th className="px-3 py-2.5 font-semibold" title="คะแนน 0–100 จาก ตรงพื้นที่ 40 · เจตนาจะใช้บริการ 30 · ยอดค้นหา 15 · โอกาสจากการแข่งขัน 10 · ตรงกับบริการ 5">คะแนนโอกาส</th>
                        <th className="px-3 py-2.5 text-right font-semibold">ยอดค้นหา/เดือน</th>
                        <th className="px-3 py-2.5 font-semibold" title="ยอดค้นหาย้อนหลัง 12 เดือน (Keyword Planner)">Trend</th>
                        <th className="px-3 py-2.5 font-semibold">เจตนา</th>
                        <th className="px-3 py-2.5 font-semibold">พื้นที่</th>
                        <th className="px-3 py-2.5 font-semibold" title="ระดับการแข่งขันโฆษณาของ Google Ads — ไม่ใช่ค่าความยากในการทำ SEO">Ads Competition</th>
                        <th className="px-3 py-2.5 text-right font-semibold">ราคาประมูล (บาท)</th>
                        <th className="px-3 py-2.5 font-semibold">กลุ่มเนื้อหา</th>
                        <th className="px-3 py-2.5 font-semibold">หน้าที่แนะนำ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(row => (
                        <tr key={row.keyword} className="border-t border-[#eef1f7] align-top hover:bg-[#fafbfe]">
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-[#17233a]">{row.keyword}</div>
                            {row.suggestedTitle ? (
                              <div className="mt-0.5 max-w-[320px] text-[10px] leading-4 text-[#0d4fd8]" title="SEO Title ที่ AI เขียนให้">✍ {row.suggestedTitle}</div>
                            ) : null}
                            {row.slug ? (
                              <div className="mt-0.5 font-mono text-[9px] text-[#91a0b8]">/{row.slug}</div>
                            ) : null}
                            <div className="mt-0.5 text-[10px] text-[#91a0b8]">
                              {row.sources.map(source => SOURCE_LABELS[source] ?? source).join(' · ')}
                            </div>
                          </td>
                          <td className="px-3 py-2.5"><PriorityCell row={row} /></td>
                          <td className="px-3 py-2.5 text-right tabular-nums"><VolumeCell value={row.volume ?? null} /></td>
                          <td className="px-3 py-2.5"><TrendSpark trend={row.trend} /></td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {row.intents.map(tag => (
                                <span key={tag} className="rounded-md bg-[#eef1f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#495975]">
                                  {INTENT_TAG_LABELS[tag]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {row.location ? (
                              <span className="text-[#17233a]">
                                {row.location}
                                <span className="ml-1 text-[10px] text-[#91a0b8]">
                                  {row.locationRole === 'primary' ? 'หลัก' : row.locationRole === 'nearby' ? 'ใกล้เคียง' : ''}
                                </span>
                              </span>
                            ) : <span className="text-[#c7cfde]">—</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {row.adsCompetition
                              ? <span>{COMPETITION_LABELS[row.adsCompetition] ?? row.adsCompetition}{typeof row.competitionIndex === 'number' ? <span className="ml-1 text-[10px] text-[#91a0b8]">{row.competitionIndex}</span> : null}</span>
                              : <span title={NO_VOLUME_TOOLTIP} className="cursor-help text-[#c7cfde]">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {row.bidLow !== null || row.bidHigh !== null
                              ? `${formatBaht(row.bidLow)} – ${formatBaht(row.bidHigh)}`
                              : <span className="text-[#c7cfde]">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[#495975]">{row.cluster ?? '—'}</td>
                          <td className="px-3 py-2.5 text-[#495975]">
                            {row.suggestedPage ? SUGGESTED_PAGE_LABELS[row.suggestedPage] : '—'}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 ? (
                        <tr><td colSpan={10} className="px-4 py-10 text-center text-[#91a0b8]">ไม่มีคีย์เวิร์ดที่ตรงกับตัวกรองนี้</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : view === 'sitemap' ? (
              <div className="divide-y divide-[#eef1f7]">
                {(data?.sitemap ?? []).length === 0 ? (
                  <div className="px-4 py-10 text-center text-[#91a0b8]">ยังไม่มีข้อมูล sitemap — รันการค้นหาก่อน</div>
                ) : (data?.sitemap ?? []).map(pg => (
                  <div key={`${pg.pageType}-${pg.slug}-${pg.page}`} className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-sm font-bold text-[#17233a]">{pg.page}</h3>
                      <code className="rounded bg-[#f4f6fb] border border-[#e3e8f2] px-1.5 py-0.5 font-mono text-[10px] text-[#0d4fd8]">/{pg.slug}</code>
                      <span className="rounded-lg bg-[#eef1f7] px-2 py-1 text-[11px] font-semibold text-[#495975]">{pg.pageType}</span>
                      <span className="text-[11px] text-[#71809c]">{pg.keywords.length} คำ</span>
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
            ) : (
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
                          ? <span title={NO_VOLUME_TOOLTIP} className="cursor-help">—</span>
                          : cluster.searchDemand.toLocaleString('th-TH')}
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
              </div>
            )}
          </section>
        ) : (
          <section className={`${cardClass} px-6 py-16 text-center`}>
            <p className="text-sm font-semibold text-[#495975]">ยังไม่มีผลลัพธ์</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#71809c]">
              กรอกบริการที่ทำและพื้นที่หลัก แล้วกด “หาคีย์เวิร์ดในพื้นที่”
              ระบบจะสร้างคำค้นแบบที่ลูกค้าในพื้นที่พิมพ์จริง แล้วเรียงให้ตามโอกาสปิดงาน
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
