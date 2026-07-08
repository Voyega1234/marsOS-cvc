'use client'

import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import Link from 'next/link'
import {
  ChevronRight, Upload, Sparkles, RefreshCw, Download,
  Calendar, CheckCircle2, XCircle, Clock, AlertTriangle,
  Zap, Image as ImageIcon, Eye, Palette, Save, X,
  Lock, Unlock, ChevronDown, Info, Target, BarChart2, Globe,
  Code2, FileText, Edit3, Bold, Italic, List, AlignLeft, Minus, Copy, Check,
} from 'lucide-react'

import type { AuthorProfile } from '@/types'
import { ClientReportClient } from '@/components/report/ClientReportClient'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'keyword-research' | 'keywords' | 'content-map' | 'articles' | 'lab' | 'push' | 'review' | 'publish' | 'report'

export interface ProjectData {
  id: string
  autoSchedule?: boolean
  wordpressConnectionId?: string | null
  name: string
  clientName: string | null
  website: string
  businessType: string
  industry: string | null
  language: string
  notes: string | null
  projectContext: string | null
  imageStyleGuide: string | null
  brandTone?: string | null
  styleGuide?: string | null
  accentColor?: string
  articleTheme?: string
  forbiddenWords?: string
  sampleArticle?: string | null
  internalLinks?: string
  gscSiteUrl?: string | null
  ga4PropertyId?: string | null
  ctaSetting?: string
  authorEnabled?: boolean
  authorName?: string | null
  authorTitle?: string | null
  authorImage?: string | null
  authors?: string  // JSON: AuthorProfile[]
  _count: { articles: number; keywords: number }
}

interface KeywordRow {
  no: number
  keyword: string
  title: string
  volume: number
  intent: string
  keyword_type: string
  priority: 'high' | 'medium' | 'low'
  opportunity_score: number
  content_type: string
  page_type?: string
  notes?: string
  // Framework fields
  funnel?: string
  traffic_score?: number
  authority_score?: number
  lead_score?: number
  sales_score?: number
  retention_score?: number
  primary_objective?: string
  secondary_objective?: string
  article_type?: string
  // Sheet fields
  slug?: string
  cluster?: string
  page_tier?: string
  status?: string
  action?: string
  section?: string
  keyword_group?: string
  current_url?: string
  conversion_potential?: number
  traffic_potential?: number
  relevance_score?: number
  position?: number
}

interface TimelineEntry {
  date: string
  thaiDate: string
  dayOfWeek: string
  keyword: string
  title: string
  priority: string
  volume: number
  intent: string
  opportunity_score: number
  isCore: boolean
  phase: number
  weekLabel: string
  articleStatus: 'pending' | 'writing' | 'done' | 'review' | 'approved'
  // Extended fields
  articleObjectiveTag?: string
  funnel?: string
  timelineBatch?: '20/80 First Batch' | '20/80 Remaining Batch'
  timelinePhase?: string
  priorityScore?: number
  publishingPriority?: number
  reasonForScheduling?: string
  websiteTypeUsed?: string
  isLocked?: boolean
  isManualDateOverride?: boolean
  status?: 'Draft' | 'Scheduled' | 'Published' | 'Locked' | 'Excluded'
  slug?: string
  page_type?: string
  kw_status?: string
  assignedAuthorId?: string  // id from Project.authors array
  keywordId?: string  // DB Keyword.id for article slug mapping
}

// ─── Content Map Types ────────────────────────────────────────────────────────

type WebsiteType = 'Auto Detect' | 'Affiliate' | 'Ecommerce' | 'Knowledge' | 'Service' | 'SaaS' | 'Lead Gen' | 'Marketplace' | 'Media/News'
type SeoGoal = 'Traffic Growth' | 'Lead Generation' | 'Sales / Conversion' | 'Authority Building' | 'Balanced Growth'
type TimelineStrategy = 'Follow Website Type Ratio' | 'Traffic First' | 'Lead First' | 'Sales First' | 'Authority First' | 'Balanced' | 'Custom Ratio'
type ArticleObjective = 'Traffic Content' | 'Educational Content' | 'Authority Content' | 'Comparison Content' | 'Problem Solving Content' | 'Service Content' | 'Sales Content' | 'Brand Content' | 'Retention Content'

const ARTICLE_OBJECTIVES: ArticleObjective[] = [
  'Traffic Content', 'Educational Content', 'Authority Content', 'Comparison Content',
  'Problem Solving Content', 'Service Content', 'Sales Content', 'Brand Content', 'Retention Content',
]

const OBJ_COLORS: Record<string, string> = {
  'Traffic Content': '#3b82f6',
  'Educational Content': '#8b5cf6',
  'Authority Content': '#f59e0b',
  'Comparison Content': '#06b6d4',
  'Problem Solving Content': '#10b981',
  'Service Content': '#f97316',
  'Sales Content': '#ef4444',
  'Brand Content': '#ec4899',
  'Retention Content': '#6b7280',
}

// Website Type Ratio Matrix
const WEBSITE_TYPE_RATIO: Record<string, Record<ArticleObjective, number>> = {
  Affiliate:   { 'Traffic Content':20,'Educational Content':15,'Authority Content':10,'Comparison Content':25,'Problem Solving Content':10,'Service Content':0,'Sales Content':15,'Brand Content':3,'Retention Content':2 },
  Ecommerce:   { 'Traffic Content':10,'Educational Content':8,'Authority Content':7,'Comparison Content':20,'Problem Solving Content':10,'Service Content':5,'Sales Content':30,'Brand Content':5,'Retention Content':5 },
  Knowledge:   { 'Traffic Content':35,'Educational Content':30,'Authority Content':20,'Comparison Content':5,'Problem Solving Content':5,'Service Content':0,'Sales Content':0,'Brand Content':3,'Retention Content':2 },
  Service:     { 'Traffic Content':8,'Educational Content':7,'Authority Content':15,'Comparison Content':10,'Problem Solving Content':20,'Service Content':30,'Sales Content':5,'Brand Content':5,'Retention Content':0 },
  SaaS:        { 'Traffic Content':5,'Educational Content':7,'Authority Content':10,'Comparison Content':15,'Problem Solving Content':18,'Service Content':20,'Sales Content':20,'Brand Content':3,'Retention Content':2 },
  'Lead Gen':  { 'Traffic Content':10,'Educational Content':5,'Authority Content':10,'Comparison Content':15,'Problem Solving Content':20,'Service Content':30,'Sales Content':5,'Brand Content':3,'Retention Content':2 },
  Marketplace: { 'Traffic Content':20,'Educational Content':10,'Authority Content':8,'Comparison Content':20,'Problem Solving Content':8,'Service Content':5,'Sales Content':20,'Brand Content':5,'Retention Content':4 },
  'Media/News':{ 'Traffic Content':45,'Educational Content':15,'Authority Content':10,'Comparison Content':5,'Problem Solving Content':5,'Service Content':0,'Sales Content':0,'Brand Content':10,'Retention Content':10 },
}

// ─── Detection Logic ──────────────────────────────────────────────────────────

function detectWebsiteType(keywords: KeywordRow[]): {
  detectedType: string; confidence: number; scores: Record<string, number>
  isHybrid: boolean; secondaryType: string | null; reasons: string[]
} {
  const scores: Record<string, number> = { Affiliate:0, Ecommerce:0, Knowledge:0, Service:0, SaaS:0, 'Lead Gen':0, Marketplace:0, 'Media/News':0 }
  const matches: Record<string, string[]> = { Affiliate:[], Ecommerce:[], Knowledge:[], Service:[], SaaS:[], 'Lead Gen':[], Marketplace:[], 'Media/News':[] }

  const check = (text: string, patterns: string[], type: string, weight: number) => {
    for (const p of patterns) {
      if (text.includes(p)) { scores[type] += weight; matches[type].push(p); break }
    }
  }

  for (const kw of keywords) {
    const t = `${kw.keyword || ''} ${kw.title || ''} ${kw.intent || ''}`.toLowerCase()
    check(t, ['รุ่นไหนดี','ยี่ห้อไหนดี','รีวิว','เปรียบเทียบ','vs ','คุ้มไหม','top ','best ','ข้อดีข้อเสีย','แนะนำ'], 'Affiliate', 3)
    check(t, ['ซื้อ','ราคา','สั่งซื้อ','โปรโมชั่น','ลดราคา','ของแท้','ส่งฟรี','ร้านขาย'], 'Ecommerce', 3)
    check(t, ['คืออะไร','วิธี','ทำไม','ขั้นตอน','คู่มือ','เบื้องต้น','how to','what is','มือใหม่','อธิบาย'], 'Knowledge', 3)
    check(t, ['รับทำ','บริการ','บริษัท','เอเจนซี่','ที่ปรึกษา','รับยื่น','รับแปล','รับออกแบบ','ใกล้ฉัน'], 'Service', 4)
    check(t, ['ระบบ','โปรแกรม','ซอฟต์แวร์','แพลตฟอร์ม','crm','erp','automation','dashboard','trial','demo','subscription'], 'SaaS', 4)
    check(t, ['สมัคร','ลงทะเบียน','ขอใบเสนอราคา','ปรึกษาฟรี','นัดหมาย','ติดต่อกลับ','เช็กสิทธิ์','ประเมินราคา'], 'Lead Gen', 4)
    check(t, ['รวม','แหล่งรวม','จอง','เปรียบเทียบราคา','ร้านใกล้','หาช่าง','ค้นหาร้าน','หาผู้ให้บริการ'], 'Marketplace', 3)
    check(t, ['ข่าว','ล่าสุด','อัปเดต','เทรนด์','วันนี้','กระแส','รายงาน','ประจำวัน'], 'Media/News', 4)
    // article_type signals
    if (kw.article_type === 'Comparison Content') scores['Affiliate'] += 2
    if (kw.article_type === 'Sales Content') scores['Ecommerce'] += 2
    if (kw.article_type === 'Service Content') scores['Service'] += 2
    if (kw.article_type === 'Educational Content') scores['Knowledge'] += 1
    // funnel signals
    if (kw.funnel === 'BOFU') { scores['Ecommerce'] += 1; scores['SaaS'] += 1; scores['Lead Gen'] += 1 }
    if (kw.sales_score && kw.sales_score > 30) scores['Lead Gen'] += 1
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topType, topScore] = sorted[0]
  const [secType, secScore] = sorted[1]
  const total = Object.values(scores).reduce((s, v) => s + v, 0)
  const confidence = total > 0 ? Math.min(99, Math.round((topScore / total) * 100)) : 0
  const isHybrid = secScore > 0 && topScore > 0 && (topScore - secScore) <= topScore * 0.2

  const dedup = (arr: string[]) => arr.filter((v, i, a) => a.indexOf(v) === i)
  const reasons = matches[topType].length > 0
    ? [`พบ pattern: "${dedup(matches[topType]).slice(0, 5).join('", "')}"`, ...(isHybrid && matches[secType].length > 0 ? [`และ "${dedup(matches[secType]).slice(0, 3).join('", "')}" ของ ${secType}`] : [])]
    : ['วิเคราะห์จาก intent และ article type ของ keywords']

  return { detectedType: topType, confidence, scores, isHybrid, secondaryType: isHybrid ? secType : null, reasons }
}

// ─── Auto Classify Article Objective ─────────────────────────────────────────

function autoClassifyObjective(kw: KeywordRow): ArticleObjective {
  const t = `${kw.keyword} ${kw.title || ''} ${kw.intent || ''}`.toLowerCase()

  if (/ราคา|ซื้อ|สมัคร|แพ็กเกจ|โปรโมชั่น|ส่วนลด|ค่าบริการ|pricing/.test(t)) return 'Sales Content'
  if (/รับทำ|บริการ|บริษัท|เอเจนซี่|รับยื่น|รับแปล|ใกล้ฉัน|ติดต่อ/.test(t)) return 'Service Content'
  if (/vs\b|เปรียบ|ต่างกัน|อันไหนดี|รุ่นไหนดี|เจ้าไหนดี|รีวิว|ข้อดีข้อเสีย/.test(t)) return 'Comparison Content'
  if (/ปัญหา|แก้ยังไง|ทำอย่างไร|ไม่ผ่าน|ไม่อนุมัติ|ไม่แสดง|ไม่ติดอันดับ|error|fail/.test(t)) return 'Problem Solving Content'
  if (/คู่มือฉบับสมบูรณ์|checklist|complete guide|ทุกขั้นตอน|ละเอียด|รวมข้อมูล/.test(t)) return 'Authority Content'
  if (/คืออะไร|วิธี|ทำไม|ขั้นตอน|คู่มือ|เบื้องต้น|how to|สำหรับมือใหม่|อธิบาย/.test(t)) return 'Educational Content'
  if (/หลังซื้อ|วิธีใช้งาน|ดูแลรักษา|ต่ออายุ|ใช้ยังไงให้คุ้ม/.test(t)) return 'Retention Content'
  if (/ทำไมต้องเลือก|รีวิวบริษัท|เคส|ผลงาน|case study|trust/.test(t)) return 'Brand Content'

  if (kw.article_type) {
    const map: Record<string, ArticleObjective> = {
      'Traffic Content':'Traffic Content','Educational Content':'Educational Content',
      'Authority Content':'Authority Content','Comparison Content':'Comparison Content',
      'Problem Solving Content':'Problem Solving Content','Service Content':'Service Content',
      'Sales Content':'Sales Content','Brand Content':'Brand Content','Retention Content':'Retention Content',
    }
    if (map[kw.article_type]) return map[kw.article_type]
  }
  if (kw.primary_objective === 'Sales') return 'Sales Content'
  if (kw.primary_objective === 'Lead') return 'Service Content'
  if (kw.primary_objective === 'Authority') return 'Authority Content'
  if (kw.volume && kw.volume > 3000) return 'Traffic Content'
  return 'Educational Content'
}

// ─── Ratio Logic ──────────────────────────────────────────────────────────────

function getRecommendedRatio(websiteType: string): Record<ArticleObjective, number> {
  return { ...(WEBSITE_TYPE_RATIO[websiteType] ?? WEBSITE_TYPE_RATIO['Service']) } as Record<ArticleObjective, number>
}

function applyGoalModifier(ratio: Record<ArticleObjective, number>, goal: SeoGoal): Record<ArticleObjective, number> {
  const r = { ...ratio }
  if (goal === 'Traffic Growth') {
    r['Traffic Content'] = Math.min(100, r['Traffic Content'] + 10)
    r['Educational Content'] = Math.min(100, r['Educational Content'] + 5)
    r['Authority Content'] = Math.min(100, r['Authority Content'] + 5)
    r['Sales Content'] = Math.max(0, r['Sales Content'] - 10)
    r['Service Content'] = Math.max(0, r['Service Content'] - 10)
  } else if (goal === 'Lead Generation') {
    r['Service Content'] = Math.min(100, r['Service Content'] + 8)
    r['Problem Solving Content'] = Math.min(100, r['Problem Solving Content'] + 7)
    r['Comparison Content'] = Math.min(100, r['Comparison Content'] + 5)
    r['Retention Content'] = Math.max(0, r['Retention Content'] - 5)
    r['Traffic Content'] = Math.max(0, r['Traffic Content'] - 15)
  } else if (goal === 'Sales / Conversion') {
    r['Sales Content'] = Math.min(100, r['Sales Content'] + 10)
    r['Comparison Content'] = Math.min(100, r['Comparison Content'] + 5)
    r['Problem Solving Content'] = Math.min(100, r['Problem Solving Content'] + 5)
    r['Educational Content'] = Math.max(0, r['Educational Content'] - 10)
    r['Traffic Content'] = Math.max(0, r['Traffic Content'] - 10)
  } else if (goal === 'Authority Building') {
    r['Authority Content'] = Math.min(100, r['Authority Content'] + 10)
    r['Educational Content'] = Math.min(100, r['Educational Content'] + 8)
    r['Brand Content'] = Math.min(100, r['Brand Content'] + 5)
    r['Sales Content'] = Math.max(0, r['Sales Content'] - 8)
    r['Traffic Content'] = Math.max(0, r['Traffic Content'] - 15)
  }
  return normalizeRatio(r, []) as Record<ArticleObjective, number>
}

function normalizeRatio(ratio: Record<string, number>, lockedKeys: string[]): Record<string, number> {
  const result = { ...ratio }
  const lockedTotal = lockedKeys.reduce((s, k) => s + (result[k] || 0), 0)
  if (lockedTotal > 100) throw new Error('Locked ratio total exceeds 100%')
  const adjustable = Object.keys(result).filter(k => !lockedKeys.includes(k))
  const adjTotal = adjustable.reduce((s, k) => s + (result[k] || 0), 0)
  const remaining = 100 - lockedTotal
  if (adjTotal === 0) {
    const share = Math.floor(remaining / adjustable.length)
    adjustable.forEach(k => { result[k] = share })
    if (adjustable.length > 0) result[adjustable[0]] += remaining - share * adjustable.length
  } else {
    adjustable.forEach(k => { result[k] = Math.floor((result[k] / adjTotal) * remaining) })
    const finalTotal = Object.values(result).reduce((s, v) => s + v, 0)
    const diff = 100 - finalTotal
    if (diff !== 0 && adjustable.length > 0) result[adjustable[0]] += diff
  }
  return result
}

// ─── Priority Score ───────────────────────────────────────────────────────────

function calcPriorityScore(
  kw: KeywordRow & { articleObjectiveTag?: ArticleObjective },
  websiteType: string, goal: SeoGoal, strategy: TimelineStrategy, ratio: Record<string, number>
): number {
  let score = 0

  // Article objective ratio weight
  const objRatio = ratio[kw.articleObjectiveTag ?? 'Traffic Content'] ?? 0
  score += objRatio * 1.5

  // Volume score
  const vol = kw.volume ?? 0
  score += Math.min(30, vol / 500)

  // Opportunity score from keyword analysis
  score += (kw.opportunity_score ?? 0) * 0.5

  // Funnel priority by goal
  const funnel = kw.funnel ?? 'TOFU'
  if (goal === 'Traffic Growth') {
    if (funnel === 'TOFU') score += 25
    else if (funnel === 'MOFU') score += 15
    else if (funnel === 'BOFU') score += 5
  } else if (goal === 'Lead Generation' || goal === 'Sales / Conversion') {
    if (funnel === 'BOFU') score += 30
    else if (funnel === 'MOFU') score += 20
    else if (funnel === 'TOFU') score += 5
  } else if (goal === 'Authority Building') {
    if (kw.articleObjectiveTag === 'Authority Content') score += 25
    if (funnel === 'TOFU') score += 15
    else if (funnel === 'MOFU') score += 10
  }

  // Strategy modifier
  if (strategy === 'Traffic First' && kw.articleObjectiveTag === 'Traffic Content') score += 20
  if (strategy === 'Lead First' && (kw.articleObjectiveTag === 'Service Content' || kw.articleObjectiveTag === 'Problem Solving Content')) score += 20
  if (strategy === 'Sales First' && (kw.articleObjectiveTag === 'Sales Content' || kw.articleObjectiveTag === 'Comparison Content')) score += 20
  if (strategy === 'Authority First' && (kw.articleObjectiveTag === 'Authority Content' || kw.articleObjectiveTag === 'Educational Content')) score += 20

  // Priority tag
  if (kw.priority === 'high') score += 20
  else if (kw.priority === 'medium') score += 10

  // Sheet scores if available
  if (kw.sales_score) score += kw.sales_score * 0.3
  if (kw.lead_score) score += kw.lead_score * 0.2
  if (kw.conversion_potential) score += kw.conversion_potential * 3
  if (kw.relevance_score) score += kw.relevance_score * 2

  // Page tier
  if (kw.page_tier === 'Primary') score += 15
  else if (kw.page_tier === 'Secondary') score += 8

  return Math.round(score)
}

// ─── Schedule Reason ──────────────────────────────────────────────────────────

function generateScheduleReason(
  obj: string, batch: string, priority: number, goal: SeoGoal, websiteType: string, priorityScore: number
): string {
  const phase = batch === '20/80 First Batch' ? 'ช่วงแรก (20/80 First Batch)' : 'ช่วงหลัง (20/80 Remaining Batch)'
  if (batch === '20/80 First Batch') {
    return `จัดลง${phase} เนื่องจาก Priority Score สูง (${priorityScore}) ตรงกับ ${websiteType} + ${goal} — เป็น ${obj} ที่ต้องการเร่ง`
  }
  return `จัดลง${phase} เป็น Supporting Content — ${obj} มี Priority Score ${priorityScore} ซึ่งเหมาะกับช่วง Support & Expansion`
}

// ─── Donut Chart Component ────────────────────────────────────────────────────

function DonutChart({ ratio }: { ratio: Record<string, number> }) {
  const r = 60, cx = 80, cy = 80, strokeW = 22
  const entries = ARTICLE_OBJECTIVES.map(k => ({ key: k, value: ratio[k] ?? 0, color: OBJ_COLORS[k] })).filter(e => e.value > 0)
  const total = entries.reduce((s, e) => s + e.value, 0)
  if (total === 0) return <div className="w-40 h-40 flex items-center justify-center text-gray-300 text-xs">ยังไม่มีข้อมูล</div>

  let cumulative = 0
  const circumference = 2 * Math.PI * r
  const segments = entries.map(e => {
    const pct = e.value / total
    const offset = circumference * (1 - cumulative)
    const dash = circumference * pct
    cumulative += pct
    return { ...e, dash, offset }
  })

  return (
    <svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={strokeW} />
      {segments.map((seg, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
          stroke={seg.color} strokeWidth={strokeW}
          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
          strokeDashoffset={seg.offset}
          strokeLinecap="butt"
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" className="text-[10px]" fontSize="10" fill="#6b7280">Total</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#111827">100%</text>
    </svg>
  )
}

interface ArticleJob {
  entryIdx: number
  date: string
  keyword: string
  title: string
  status: 'idle' | 'writing' | 'done' | 'error' | 'cover' | 'review' | 'approved'
  html: string
  coverImage: string
  coverMimeType: string
  midImage: string
  midMimeType: string
  error: string
  slug?: string
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────

// preset_key ต้องตรงกับที่ API route รับ (wordgod intentRatioSkill presets)
const INTENT_PRESETS = [
  { id: 'preset1', label: 'Balanced',   info: 'สมดุลทุก intent',           mix: { informational: 50, commercial: 30, transactional: 15, navigational: 5, update: 0  } },
  { id: 'preset2', label: 'New Website',info: 'เน้น informational ก่อน',   mix: { informational: 60, commercial: 25, transactional: 10, navigational: 5, update: 0  } },
  { id: 'preset3', label: 'Lead Gen',   info: 'เน้น commercial + transact', mix: { informational: 40, commercial: 35, transactional: 20, navigational: 5, update: 0  } },
  { id: 'preset4', label: 'Affiliate',  info: 'Review + Comparison',        mix: { informational: 40, commercial: 40, transactional: 15, navigational: 5, update: 0  } },
  { id: 'preset6', label: 'Knowledge',  info: 'ความรู้ อ้างอิง เชื่อถือได้', mix: { informational: 85, commercial: 0,  transactional: 0,  navigational: 5, update: 10 } },
  { id: 'manual',  label: 'Manual',     info: 'ปรับเองทุก slider',          mix: { informational: 50, commercial: 30, transactional: 15, navigational: 5, update: 0  } },
]

const INTENT_LABELS: Record<string, string> = {
  informational: 'Informational Intent',
  commercial:    'Commercial Investigation',
  transactional: 'Transactional / Service',
  navigational:  'Navigational / Brand',
  update:        'Update / News / Freshness',
}

function IntentSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-48 shrink-0">{label}</span>
      <input type="range" min={0} max={100} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-gray-800 cursor-pointer" />
      <span className="text-xs font-semibold text-gray-700 w-8 text-right tabular-nums">{value}%</span>
    </div>
  )
}

// ─── Keyword Research Tab (WordGod mode) ─────────────────────────────────────

function KeywordResearchTab({
  project, setKeywords, selectedKws, setSelectedKws, priorityScore, onDone,
  niche, setNiche, siteUrl, setSiteUrl,
  queryCount, setQueryCount, preset, setPreset, intentMix, setIntentMix,
  loadingWG, setLoadingWG, progressLog, setProgressLog, statusMsg, setStatusMsg,
  resultRows, setResultRows, isDragging, setIsDragging, seedFile, setSeedFile, seedKeywords, setSeedKeywords,
}: {
  project: ProjectData
  setKeywords: (kws: KeywordRow[]) => void
  selectedKws: Set<string>
  setSelectedKws: (s: Set<string>) => void
  priorityScore?: (kw: KeywordRow) => number
  onDone: () => void
  niche: string; setNiche: (v: string) => void
  siteUrl: string; setSiteUrl: (v: string) => void
  queryCount: number; setQueryCount: (v: number) => void
  preset: string; setPreset: (v: string) => void
  intentMix: Record<string, number>; setIntentMix: React.Dispatch<React.SetStateAction<Record<string, number>>>
  loadingWG: boolean; setLoadingWG: (v: boolean) => void
  progressLog: string[]; setProgressLog: React.Dispatch<React.SetStateAction<string[]>>
  statusMsg: string; setStatusMsg: (v: string) => void
  resultRows: KeywordRow[]; setResultRows: (v: KeywordRow[]) => void
  isDragging: boolean; setIsDragging: (v: boolean) => void
  seedFile: File | null; setSeedFile: (v: File | null) => void
  seedKeywords: string[]; setSeedKeywords: (v: string[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  function applyPreset(id: string) {
    setPreset(id)
    const p = INTENT_PRESETS.find(p => p.id === id)
    if (p && id !== 'manual') setIntentMix(p.mix)
  }

  function updateIntent(key: string, val: number) {
    setPreset('manual')
    setIntentMix(prev => ({ ...prev, [key]: val }))
  }

  const total = Object.values(intentMix).reduce((s, v) => s + v, 0)

  function handleSeedFile(file: File) {
    setSeedFile(file)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string ?? ''
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      const kws = lines.length && /keyword/i.test(lines[0]) ? lines.slice(1).map(l => l.split(',')[0].replace(/^"|"$/g,'').trim()).filter(Boolean) : lines
      setSeedKeywords(kws)
    }
    reader.readAsText(file, 'utf-8')
  }

  function addLog(msg: string) {
    setStatusMsg(msg)
    setProgressLog(prev => {
      const next = [...prev.slice(-400), msg]
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 10)
      return next
    })
  }

  async function runWordGod() {
    if (!niche.trim()) return
    setLoadingWG(true)
    setProgressLog(() => [])
    setStatusMsg('Starting...')
    setResultRows([])
    abortRef.current = new AbortController()

    try {
      const body: Record<string, unknown> = {
        niche: niche.trim(),
        business_name: project.clientName ?? project.name,
        category: project.industry ?? project.businessType,
        count: queryCount,
        preset_key: preset,
        project_id: project.id,
        ...(preset === 'manual' ? { intent_mix: intentMix } : {}),
        site_url: siteUrl.trim() || undefined,
        ...(seedKeywords.length > 0 ? { seed_keywords: seedKeywords } : {}),
      }

      const res = await fetch('/api/wordgod/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let resultData: any = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { eventType = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            let payload: any = null
            try { payload = JSON.parse(line.slice(6)) } catch { eventType = ''; continue }
            if (eventType === 'progress') addLog(payload.msg)
            else if (eventType === 'result') resultData = payload
            else if (eventType === 'error') throw new Error(payload.error ?? 'Unknown error')
            eventType = ''
          }
        }
      }

      if (resultData?.rows) {
        setResultRows(resultData.rows)
        addLog(`✅ สำเร็จ — ${resultData.rows.length} keywords พร้อมแล้ว`)
      }
    } catch (e: unknown) {
      const err = e as Error
      if (err.name !== 'AbortError') addLog(`❌ เกิดข้อผิดพลาด: ${err.message}`)
      else setStatusMsg('หยุดแล้ว')
    } finally { setLoadingWG(false) }
  }

  async function handleSendToContentMap() {
    if (!resultRows.length) return
    setKeywords(resultRows)
    onDone()
    // บันทึก keywords ลง DB แบบ background (ไม่บล็อก UI)
    try {
      await Promise.all(resultRows.map(kw =>
        fetch('/api/keywords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId:   project.id,
            seedKeyword: kw.keyword,
            keyword:     kw.keyword,
            intent:      (kw.intent ?? 'informational').toUpperCase(),
            funnelStage: kw.funnel ?? 'TOFU',
            volume:      kw.volume ?? 0,
            priority:    kw.no ?? 0,
            status:      'RESEARCHED',
          }),
        })
      ))
    } catch { /* non-fatal — keywords still in UI state */ }
  }

  function downloadCsv() {
    if (!resultRows.length) return
    const headers = ['no','keyword','title','volume','intent','keyword_type','priority','opportunity_score','content_type','page_type','funnel','article_type','primary_objective']
    const rows = resultRows.map(r => headers.map(h => {
      const v = (r as any)[h] ?? ''
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
    }).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'keywords.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function downloadHtml() {
    if (!resultRows.length) return
    const PRIORITY_COLOR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }
    const FUNNEL_COLOR: Record<string, string> = { TOFU: '#3b82f6', MOFU: '#8b5cf6', BOFU: '#10b981' }
    const rows = resultRows.map((r, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td>${i + 1}</td>
        <td class="kw">${r.keyword}</td>
        <td>${r.title ?? '—'}</td>
        <td class="num">${r.volume > 0 ? r.volume.toLocaleString() : '—'}</td>
        <td><span class="badge" style="background:${FUNNEL_COLOR[r.funnel ?? 'TOFU'] ?? '#e5e7eb'};color:#fff">${r.funnel ?? '—'}</span></td>
        <td>${r.page_type ?? '—'}</td>
        <td>${r.article_type ?? '—'}</td>
        <td>${r.primary_objective ?? '—'}</td>
        <td><span class="badge" style="background:${PRIORITY_COLOR[r.priority] ?? '#6b7280'};color:#fff">${r.priority}</span></td>
        <td class="num">${(r as any).priority_score ?? r.opportunity_score ?? '—'}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Keyword Research Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  p.meta { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f9fafb; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr.odd td { background: #fafafa; }
  tr:hover td { background: #f0f9ff; }
  td.kw { font-weight: 600; color: #111; }
  td.num { font-family: monospace; text-align: right; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
</style>
</head>
<body>
<h1>Keyword Research</h1>
<p class="meta">Export: ${new Date().toLocaleString('th-TH')} · ${resultRows.length} keywords</p>
<table>
  <thead>
    <tr>
      <th>#</th><th>Keyword</th><th>Title (H1)</th><th>Vol.</th><th>Funnel</th>
      <th>Page Type</th><th>Article Type</th><th>Objective</th><th>Priority</th><th>Score</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'keywords.html'; a.click()
    URL.revokeObjectURL(url)
  }

  const canRun = niche.trim().length > 0 && total === 100

  return (
    <div className="w-full">

      {/* ── 2-col layout: form left | progress right ── */}
      {resultRows.length === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-[520px]">

          {/* ── LEFT: form ── */}
          <div className="space-y-6 pr-8 border-r border-gray-100">

            {/* Queries slider */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-500">Queries</span>
                <input
                  type="number" min={1} max={3000} value={queryCount}
                  onChange={e => { const v = Math.min(3000, Math.max(1, Number(e.target.value) || 1)); setQueryCount(v) }}
                  className="text-3xl font-bold text-gray-900 tabular-nums w-28 text-right bg-transparent border-none outline-none focus:ring-0 p-0"
                />
              </div>
              <input type="range" min={1} max={3000} step={1} value={queryCount}
                onChange={e => setQueryCount(Number(e.target.value))}
                className="w-full h-px accent-gray-900 cursor-pointer" />
              <div className="flex justify-between text-[9px] text-gray-300 font-mono">
                {['5','100','500','1,000','3,000'].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>

            {/* Niche */}
            <input type="text" value={niche} onChange={e => setNiche(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canRun && !loadingWG) runWordGod() }}
              placeholder="Category — e.g. Visa Agency, Google Ads Agency, ประกันสุขภาพ"
              className="w-full bg-transparent border-b border-gray-200 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-600 transition-colors" />

            {/* Site URL */}
            <input type="text" value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
              placeholder="Website URL (optional) — paste to auto-crawl sitemap"
              className="w-full bg-transparent border-b border-gray-200 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-600 transition-colors" />

            {/* Seed file drop zone */}
            <div
              className={`border border-dashed rounded-xl p-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors ${
                isDragging ? 'border-gray-400 bg-gray-50' : seedFile ? 'border-gray-300 bg-gray-50/60' : 'border-gray-200 hover:border-gray-300'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleSeedFile(f) }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleSeedFile(f) }} />
              <Upload size={16} className="text-gray-300" />
              {seedFile ? (
                <>
                  <p className="text-xs text-gray-600 font-medium">{seedFile.name}</p>
                  <p className="text-[11px] text-gray-400">{seedKeywords.length} seed keywords</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400">Drop seed keyword file <span className="text-gray-300">(optional)</span></p>
                  <p className="text-[10px] text-gray-300">CSV or TXT · without file, WordGod expands from category</p>
                </>
              )}
            </div>

            {/* Intent Mix */}
            <div className="border border-gray-100 rounded-xl p-3.5 space-y-3 bg-gray-50/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Intent Mix</span>
                <span className={`text-[10px] font-mono ${total === 100 ? 'text-gray-400' : 'text-red-500 font-bold'}`}>{total}/100</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {INTENT_PRESETS.map(p => (
                  <button key={p.id} onClick={() => applyPreset(p.id)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors border ${
                      preset === p.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {preset !== 'manual' && (() => {
                const desc: Record<string, string> = {
                  preset1: 'เหมาะกับเว็บทั่วไปที่ต้องการ traffic และ conversion ไปพร้อมกัน',
                  preset2: 'เน้น informational สูง เพื่อสร้าง authority ก่อนในช่วงแรก',
                  preset3: 'เน้น commercial + transactional เพื่อ lead / conversion โดยตรง',
                  preset4: 'เน้น review + comparison เพื่อ affiliate revenue',
                  preset6: 'เน้น informational ล้วน ไม่มี commercial/transactional',
                }
                return desc[preset] ? <p className="text-[10px] text-gray-400">{desc[preset]}</p> : null
              })()}
              <div className="space-y-1.5 pt-0.5">
                {Object.entries(intentMix).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2.5">
                    <span className="text-[10px] text-gray-500 w-44 shrink-0">{INTENT_LABELS[key] ?? key}</span>
                    <input type="range" min={0} max={100} step={1} value={val}
                      onChange={e => updateIntent(key, Number(e.target.value))}
                      className="flex-1 h-px accent-gray-900 cursor-pointer" />
                    <span className="text-[10px] font-mono text-gray-600 w-7 text-right">{val}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Generate / Stop */}
            {!loadingWG ? (
              <button onClick={runWordGod} disabled={!canRun}
                className={`w-full rounded-xl py-3 text-sm font-bold tracking-wide transition-all ${
                  canRun ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                {!niche.trim() ? 'Enter a niche to start' : total !== 100 ? `Intent Mix ต้องรวมได้ 100%` : 'Generate'}
              </button>
            ) : (
              <button onClick={() => abortRef.current?.abort()}
                className="w-full rounded-xl py-3 text-sm font-bold bg-white border border-gray-200 text-gray-500 hover:text-gray-800 transition-colors">
                Stop
              </button>
            )}

          </div>

          {/* ── RIGHT: progress ── */}
          <div className="pl-8 pt-1 flex flex-col">
            {!loadingWG && progressLog.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-200 select-none">
                <Sparkles size={28} className="mb-3 opacity-20" />
                <p className="text-xs text-gray-400">Progress จะแสดงที่นี่</p>
                <p className="text-[10px] text-gray-300 mt-1">ใส่ Category แล้วกด Generate</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Status line */}
                {loadingWG && (
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <p className="text-xs text-gray-500 font-mono leading-relaxed truncate">{statusMsg}</p>
                  </div>
                )}
                {/* Log lines */}
                <div ref={logRef} className="overflow-y-auto font-mono text-[10px] leading-5 space-y-px"
                  style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '200px' }}>
                  {progressLog.map((l, i) => (
                    <div key={i} className={
                      l.startsWith('✅') ? 'text-emerald-600' :
                      l.startsWith('❌') ? 'text-red-500' :
                      l.includes('batch') || l.includes('Batch') ? 'text-blue-500' :
                      l.startsWith('📋') || l.startsWith('🌐') || l.startsWith('🤖') ? 'text-blue-400' :
                      'text-gray-400'
                    }>{l}</div>
                  ))}
                  {loadingWG && <div className="animate-pulse text-blue-400">▍</div>}
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Result Table (same as Keywords tab) ── */}
      {resultRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { setResultRows([]); setProgressLog([]); setStatusMsg(''); setSelectedKws(new Set()) }}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors">← ค้นหาใหม่</button>
          </div>
          <KeywordResultsTable
            keywords={resultRows}
            onDone={handleSendToContentMap}
            downloadCsv={downloadCsv}
            downloadHtml={downloadHtml}
            selectedKws={selectedKws}
            setSelectedKws={setSelectedKws}
            priorityScore={priorityScore}
            isAdmin={true}
            hidePosStatus={true}
            setKeywords={(kws) => setResultRows(kws)}
          />
        </div>
      )}

    </div>
  )
}

// ─── Keywords Tab (CSV Import only) ──────────────────────────────────────────

function KeywordsTab({
  project, keywords, setKeywords, onDone, selectedKws, setSelectedKws, priorityScore, userRole = 'MEMBER',
}: {
  project: ProjectData
  keywords: KeywordRow[]
  setKeywords: (kws: KeywordRow[]) => void
  onDone: () => void
  selectedKws: Set<string>
  setSelectedKws: (s: Set<string>) => void
  priorityScore?: (kw: KeywordRow) => number
  userRole?: string
}) {
  const isAdmin = userRole === 'ADMIN'

  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [parsedXlsxRows, setParsedXlsxRows] = useState<{ keyword: string; volume: number; title?: string; page_type?: string }[]>([])
  const [loadingCSV, setLoadingCSV] = useState(false)
  const [csvProgressLog, setCsvProgressLog] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  type CsvRow = {
    keyword: string; volume: number; title?: string; page_type?: string
    slug?: string; cluster?: string; page_tier?: string
    status?: string; action?: string; section?: string
    pillar_intent?: string; keyword_group?: string
    conversion_potential?: number; traffic_potential?: number
    relevance_score?: number; current_url?: string
    position?: number
  }

  function parseCsv(text: string): CsvRow[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (!lines.length) return []
    const sep = lines[0].includes('\t') ? '\t' : ','
    const h = lines[0].split(sep).map(c => c.replace(/"/g, '').trim().toLowerCase())
    const hasHeader = /keyword|คีย์เวิร์ด|kw|query|search term/i.test(h[0] ?? '')
    const ci = (re: RegExp) => h.findIndex(x => re.test(x))
    const kwIdx     = Math.max(0, ci(/^keyword$|^kw$|search term|คีย์/i))
    const volIdx    = ci(/^volume$|^vol$|monthly|search vol/i)
    const hsvIdx    = ci(/highest.?sv|hsv|highest.*volume/i)
    const titleIdx  = ci(/^title$|^h1$|seo title|page title|หัวข้อ/i)
    const ptIdx     = ci(/^page.?type$|page_type|ประเภท/i)
    const slugIdx   = ci(/slug|path/i)
    const clusterIdx= ci(/cluster/i)
    const tierIdx   = ci(/tier|page.?tier/i)
    const statusIdx = ci(/^status$/i)
    const actionIdx = ci(/^action|action.?all/i)
    const sectionIdx= ci(/^section$/i)
    const intentIdx = ci(/pillar.?intent|intent/i)
    const kwgIdx    = ci(/keyword.?group/i)
    const convIdx   = ci(/conversion.?potential/i)
    const trafficIdx= ci(/traffic.?potential/i)
    const relIdx    = ci(/relevance.?score/i)
    const urlIdx    = ci(/current.?url/i)
    const posIdx    = ci(/^position$|^pos$|^rank$/i)
    const dataLines = hasHeader ? lines.slice(1) : lines
    return dataLines.map(line => {
      const cols = line.split(sep).map(c => c.replace(/^"|"$/g, '').trim())
      const vol = volIdx >= 0 ? Number(cols[volIdx]?.replace(/,/g, '') || 0) : 0
      const hsv = hsvIdx >= 0 ? Number(cols[hsvIdx]?.replace(/,/g, '') || 0) : 0
      const r: CsvRow = { keyword: cols[kwIdx] ?? '', volume: hsv > 0 ? hsv : vol }
      if (titleIdx >= 0 && cols[titleIdx])  r.title = cols[titleIdx]
      if (ptIdx >= 0 && cols[ptIdx])        r.page_type = cols[ptIdx]
      if (slugIdx >= 0 && cols[slugIdx])    r.slug = cols[slugIdx]
      if (clusterIdx >= 0 && cols[clusterIdx]) r.cluster = cols[clusterIdx]
      if (tierIdx >= 0 && cols[tierIdx])    r.page_tier = cols[tierIdx]
      if (statusIdx >= 0 && cols[statusIdx]) r.status = cols[statusIdx]
      if (actionIdx >= 0 && cols[actionIdx]) r.action = cols[actionIdx]
      if (sectionIdx >= 0 && cols[sectionIdx]) r.section = cols[sectionIdx]
      if (intentIdx >= 0 && cols[intentIdx]) r.pillar_intent = cols[intentIdx]
      if (kwgIdx >= 0 && cols[kwgIdx])      r.keyword_group = cols[kwgIdx]
      if (convIdx >= 0 && cols[convIdx])    r.conversion_potential = Number(cols[convIdx]) || 0
      if (trafficIdx >= 0 && cols[trafficIdx]) r.traffic_potential = Number(cols[trafficIdx]) || 0
      if (relIdx >= 0 && cols[relIdx])      r.relevance_score = Number(cols[relIdx]) || 0
      if (urlIdx >= 0 && cols[urlIdx])      r.current_url = cols[urlIdx]
      if (posIdx >= 0 && cols[posIdx])      r.position = Number(cols[posIdx]?.replace(/,/g, '')) || undefined
      return r
    }).filter(r => r.keyword)
  }

  function parseXlsx(buf: ArrayBuffer): { text: string; rows: CsvRow[] } {
    const wb = XLSX.read(buf, { type: 'array' })
    const sheetName = wb.SheetNames.find(n => /keyword/i.test(n)) ?? wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const data: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number)[][]
    if (!data.length) return { text: '', rows: [] }
    const header = data[0].map(c => String(c).toLowerCase().trim())
    const ci = (re: RegExp) => header.findIndex(h => re.test(h))

    const kwIdx     = Math.max(0, ci(/^keyword$|^kw$|search term|คีย์/i))
    const volIdx    = ci(/^volume$|^vol$|monthly searches/i)
    const hsvIdx    = ci(/highest.?sv|hsv|highest.*volume/i)
    const titleIdx  = ci(/^page title$|^title$|^h1$|seo title|หัวข้อ/i)
    const ptIdx     = ci(/^page.?type$/i)
    const slugIdx   = ci(/^slug|slug.?and.?path|^path$/i)
    const clusterIdx= ci(/^cluster$/i)
    const tierIdx   = ci(/^page.?tier$|^tier$/i)
    const statusIdx = ci(/^status$/i)
    const actionIdx = ci(/^action.?-?.?all$|^action$/i)
    const sectionIdx= ci(/^section$/i)
    const intentIdx = ci(/^pillar.?intent$|^intent$/i)
    const kwgIdx    = ci(/^keyword.?group$/i)
    const convIdx   = ci(/^conversion.?potential$/i)
    const trafficIdx= ci(/^traffic.?potential$/i)
    const relIdx    = ci(/^relevance.?score$/i)
    const urlIdx    = ci(/^current.?url$/i)
    const posIdx    = ci(/^position$|^pos$|^rank$/i)

    const hasHeader = isNaN(Number(data[0][kwIdx]))
    const rows: CsvRow[] = (hasHeader ? data.slice(1) : data).map(row => {
      const s = (i: number) => i >= 0 ? String(row[i] ?? '').trim() : ''
      const n = (i: number) => i >= 0 ? Number(row[i] ?? 0) : 0
      const vol = n(volIdx)
      const hsv = n(hsvIdx)
      const kw = s(kwIdx)
      if (!kw) return null
      const r: CsvRow = { keyword: kw, volume: hsv > 0 ? hsv : vol }
      const title = s(titleIdx); if (title) r.title = title
      const pt = s(ptIdx);       if (pt) r.page_type = pt
      const slug = s(slugIdx);   if (slug) r.slug = slug
      const cluster = s(clusterIdx); if (cluster) r.cluster = cluster
      const tier = s(tierIdx);   if (tier) r.page_tier = tier
      const status = s(statusIdx); if (status) r.status = status
      const action = s(actionIdx); if (action) r.action = action
      const section = s(sectionIdx); if (section) r.section = section
      const intent = s(intentIdx); if (intent) r.pillar_intent = intent
      const kwg = s(kwgIdx);     if (kwg) r.keyword_group = kwg
      const conv = n(convIdx);   if (conv) r.conversion_potential = conv
      const traf = n(trafficIdx); if (traf) r.traffic_potential = traf
      const rel = n(relIdx);     if (rel) r.relevance_score = rel
      const url = s(urlIdx);     if (url) r.current_url = url
      const pos = n(posIdx);     if (pos) r.position = pos
      return r
    }).filter((r): r is CsvRow => r !== null && !!r.keyword)

    const previewLines = [`keyword,volume,title,page_type,slug,cluster,tier,status,action`,
      ...rows.slice(0, 5).map(r => `${r.keyword},${r.volume},${r.title ?? ''},${r.page_type ?? ''},${r.slug ?? ''},${r.cluster ?? ''},${r.page_tier ?? ''},${r.status ?? ''},${r.action ?? ''}`)]
    return { text: previewLines.join('\n'), rows }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setCsvFileName(file.name)
    setParsedXlsxRows([])
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
      const reader = new FileReader()
      reader.onload = ev => {
        const buf = ev.target?.result as ArrayBuffer
        const { text, rows } = parseXlsx(buf)
        setCsvText(text)
        setParsedXlsxRows(rows)
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = ev => { setCsvText(ev.target?.result as string ?? ''); setParsedXlsxRows([]) }
      reader.readAsText(file)
    }
  }

  function addLog(logs: string[], msg: string) { return [...logs, `[${new Date().toLocaleTimeString('th')}] ${msg}`] }

  function classifyIntent(kw: string): string {
    const k = kw.toLowerCase()
    if (/ราคา|ค่าบริการ|ค่าใช้จ่าย|เท่าไร|เท่าไหร่|กี่บาท|cost|price/.test(k)) return 'price'
    if (/เปรียบเทียบ|vs\b|ดีกว่า|ต่างกัน|ไหนดี|compare/.test(k)) return 'comparison'
    if (/รีวิว|review|ดีไหม|pantip/.test(k)) return 'review'
    if (/ซื้อ|สั่ง|จอง|ติดต่อ|buy|order/.test(k)) return 'transactional'
    if (/บริการ|รับทำ|รับจัด|agency|ให้บริการ/.test(k)) return 'service_seeking'
    if (/แก้|รักษา|ป้องกัน|วิธีแก้|ปัญหา|fix|solve/.test(k)) return 'problem_solving'
    if (/วิธีเลือก|ก่อนซื้อ|แนะนำ|ควรรู้|how to choose/.test(k)) return 'commercial'
    return 'informational'
  }
  function classifyFunnel(intent: string): 'TOFU' | 'MOFU' | 'BOFU' {
    if (['transactional','service_seeking','price'].includes(intent)) return 'BOFU'
    if (['commercial','comparison','review'].includes(intent)) return 'MOFU'
    return 'TOFU'
  }
  function classifyPriority(score: number): 'high' | 'medium' | 'low' {
    return score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low'
  }
  function scoreOpportunity(volume: number, intent: string, conv?: number, traffic?: number, relevance?: number): number {
    // rule-based (volume + intent) — 70% weight
    const v = volume >= 10000 ? 40 : volume >= 5000 ? 35 : volume >= 1000 ? 28 : volume >= 100 ? 18 : 8
    const intentScore = ['transactional','service_seeking'].includes(intent) ? 30 : ['price','comparison','review'].includes(intent) ? 20 : ['commercial'].includes(intent) ? 15 : 5
    const ruleScore = v + intentScore  // max 70

    // ชีท score (conv + traffic + relevance) — 30% weight ถ้ามี
    const hasSheet = conv != null && traffic != null && relevance != null
    if (hasSheet) {
      const sheetScore = (conv! * 0.4) + (traffic! * 0.35) + (relevance! * 0.25)  // max 100
      return Math.min(100, Math.round((ruleScore * 0.7) + (sheetScore * 0.3)))
    }
    return Math.min(100, ruleScore)
  }
  function classifyContentType(intent: string, pageType: string): string {
    if (pageType === 'Service Page' || pageType === 'Core Page') return 'service_page'
    const m: Record<string,string> = {
      informational:'pillar_article', commercial:'buying_guide',
      transactional:'service_page', problem_solving:'problem_solution_article',
      comparison:'comparison_article', price:'price_guide',
      review:'review_article', service_seeking:'service_page',
    }
    return m[intent] || 'article'
  }
  // 9 Article Types ตามเอกสาร MarsOS
  function classifyArticleType(intent: string, pageType?: string): string {
    if (pageType === 'Service Page' || pageType === 'Core Page') return 'Service Content'
    const m: Record<string,string> = {
      informational:    'Traffic Content',
      educational:      'Educational Content',
      problem_solving:  'Problem Solving Content',
      comparison:       'Comparison Content',
      review:           'Comparison Content',
      commercial:       'Authority Content',
      transactional:    'Sales Content',
      price:            'Sales Content',
      service_seeking:  'Service Content',
      brand:            'Brand Content',
      retention:        'Retention Content',
    }
    return m[intent] || 'Traffic Content'
  }
  // Primary Objective จาก 5 กลุ่มหลัก: Traffic / Authority / Lead Generation / Sales / Retention
  function classifyPrimaryObjective(intent: string, articleType: string): string {
    if (['Sales Content'].includes(articleType))                 return 'Sales'
    if (['Service Content'].includes(articleType))               return 'Lead Generation'
    if (['Retention Content'].includes(articleType))             return 'Retention'
    if (['Authority Content'].includes(articleType))             return 'Authority'
    if (['Comparison Content','Problem Solving Content'].includes(articleType)) return 'Lead Generation'
    return 'Traffic'
  }
  function classifySecondaryObjective(intent: string, primary: string): string {
    if (primary === 'Traffic')         return 'Authority'
    if (primary === 'Authority')       return 'Traffic'
    if (primary === 'Lead Generation') return 'Sales'
    if (primary === 'Sales')           return 'Lead Generation'
    if (primary === 'Retention')       return 'Traffic'
    return 'Traffic'
  }
  // Score breakdown ตาม 5 Objective
  function calcObjectiveScores(intent: string, volume: number): { traffic: number; authority: number; lead: number; sales: number; retention: number } {
    const vol10 = Math.min(10, Math.round(volume / 1000))
    const scores = {
      informational:   { traffic: vol10, authority: 3, lead: 2, sales: 1, retention: 2 },
      educational:     { traffic: vol10, authority: 5, lead: 3, sales: 1, retention: 3 },
      problem_solving: { traffic: 5,     authority: 4, lead: 6, sales: 3, retention: 5 },
      comparison:      { traffic: 4,     authority: 5, lead: 7, sales: 6, retention: 2 },
      review:          { traffic: 5,     authority: 6, lead: 5, sales: 5, retention: 2 },
      commercial:      { traffic: 4,     authority: 7, lead: 6, sales: 4, retention: 2 },
      transactional:   { traffic: 2,     authority: 2, lead: 5, sales: 9, retention: 2 },
      price:           { traffic: 3,     authority: 2, lead: 6, sales: 8, retention: 1 },
      service_seeking: { traffic: 2,     authority: 3, lead: 9, sales: 5, retention: 2 },
      brand:           { traffic: 3,     authority: 6, lead: 4, sales: 5, retention: 6 },
      retention:       { traffic: 3,     authority: 3, lead: 2, sales: 3, retention: 9 },
    }
    return (scores as any)[intent] ?? { traffic: vol10, authority: 3, lead: 2, sales: 1, retention: 2 }
  }

  function runCsvImport() {
    const rows: CsvRow[] = parsedXlsxRows.length > 0 ? parsedXlsxRows : parseCsv(csvText)
    if (!rows.length) return
    setLoadingCSV(true)
    setCsvProgressLog([])
    const log = (msg: string) => setCsvProgressLog(prev => addLog(prev, msg))
    try {
      log(`📋 อ่านข้อมูลจากไฟล์ — ${rows.length} keywords`)
      const withTitle = rows.filter(r => r.title).length
      if (withTitle > 0) log(`✓ พบ title ใน ${withTitle} แถว — preserve ไว้ ไม่ generate ใหม่`)

      log(`🏷️  classify intent + priority + content type...`)
      const result: KeywordRow[] = rows.map((r, i) => {
        const intent   = (r.pillar_intent as string) || classifyIntent(r.keyword)
        const volume   = Number(r.volume ?? 0)
        const funnel   = classifyFunnel(intent)
        const pageType = r.page_type || (funnel === 'BOFU' ? 'Service Page' : 'Blog')
        const conv     = r.conversion_potential
        const traff    = r.traffic_potential
        const rel      = r.relevance_score
        const score    = scoreOpportunity(volume, intent, conv, traff, rel)
        return {
          no: i + 1,
          keyword: r.keyword,
          title: r.title || r.keyword,
          volume,
          intent,
          keyword_type: 'supporting_keyword',
          priority: classifyPriority(score),
          opportunity_score: score,
          content_type: classifyContentType(intent, pageType),
          page_type: pageType,
          slug: r.slug || r.keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9ก-๙-]/g, '').slice(0, 80),
          notes: '',
          funnel,
          ...(() => {
            const objScores = calcObjectiveScores(intent, volume)
            const articleType = classifyArticleType(intent, pageType)
            const primary = classifyPrimaryObjective(intent, articleType)
            const secondary = classifySecondaryObjective(intent, primary)
            return {
              traffic_score: objScores.traffic,
              authority_score: objScores.authority,
              lead_score: objScores.lead,
              sales_score: objScores.sales,
              retention_score: objScores.retention,
              primary_objective: primary,
              secondary_objective: secondary,
              article_type: articleType,
            }
          })(),
          ...(r.cluster             && { cluster: r.cluster }),
          ...(r.page_tier           && { page_tier: r.page_tier }),
          ...(r.status              && { status: r.status }),
          ...(r.action              && { action: r.action }),
          ...(r.section             && { section: r.section }),
          ...(r.keyword_group       && { keyword_group: r.keyword_group }),
          ...(r.current_url         && { current_url: r.current_url }),
          ...(r.conversion_potential != null && { conversion_potential: r.conversion_potential }),
          ...(r.traffic_potential    != null && { traffic_potential: r.traffic_potential }),
          ...(r.relevance_score      != null && { relevance_score: r.relevance_score }),
          ...(r.position             != null && { position: r.position }),
        } as KeywordRow
      })

      result.sort((a, b) => b.opportunity_score - a.opportunity_score)
      result.forEach((r, i) => { r.no = i + 1 })

      const high = result.filter(r => r.priority === 'high').length
      const med  = result.filter(r => r.priority === 'medium').length
      log(`✅ สำเร็จ — ${result.length} keywords · High ${high} · Medium ${med} · Low ${result.length - high - med}`)
      setKeywords(result)
    } catch (e: unknown) {
      setCsvProgressLog(prev => addLog(prev, `❌ เกิดข้อผิดพลาด: ${String(e)}`))
    } finally { setLoadingCSV(false) }
  }

  function downloadCsv() {
    if (!keywords.length) return
    const headers = ['No.', 'Title (H1)', 'Keyword', 'Volume', 'Intent', 'Keyword Type', 'Priority', 'Opportunity Score', 'Content Type']
    const rows = keywords.map(r => [r.no, `"${r.title}"`, `"${r.keyword}"`, r.volume, r.intent, r.keyword_type, r.priority, r.opportunity_score, r.content_type].join(','))
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `keywords-${project.name}.csv`; a.click()
  }

  const csvRows = parsedXlsxRows.length > 0 ? parsedXlsxRows : parseCsv(csvText)

  return (
    <div className="space-y-6 w-full">

      {/* ── CSV Import ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Upload size={14} className="text-gray-400" />
          <span className="text-sm font-bold text-gray-900">นำเข้า CSV</span>
        </div>

        <div className="px-5 pt-4 pb-3">
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            มี keyword อยู่แล้วจาก Ahrefs / Semrush / GSC หรือลูกค้า approved แล้ว?<br />
            วางที่นี่แล้วกด <strong>Generate Intent + Score</strong> — ระบบจะ<strong>ไม่สร้าง keyword ใหม่</strong><br />
            แต่จะติด tag intent, priority, content type ทุกตัว เหมือนกระบวนการ WordGod พร้อมส่งต่อ Content Map
          </p>

          {/* Drop zone */}
          <div onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${csvRows.length > 0 ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200 hover:border-gray-400'}`}>
            <Upload size={22} className={`mx-auto mb-2 ${csvRows.length > 0 ? 'text-emerald-500' : 'text-gray-300'}`} />
            {csvRows.length > 0 ? (
              <>
                <p className="text-sm font-semibold text-emerald-700">{csvRows.length} keywords</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{csvFileName}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-500">คลิกหรือลากไฟล์มาวาง</p>
                <p className="text-[11px] text-gray-400 mt-0.5">.xlsx · .csv · .tsv · .txt</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods" className="hidden" onChange={handleFile} />
          </div>

          {/* Paste area */}
          <div className="mt-3">
            <label className="block text-[11px] font-medium text-gray-500 mb-1.5">หรือวางข้อมูลตรงนี้</label>
            <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setCsvFileName(''); setParsedXlsxRows([]) }}
              placeholder={`keyword,volume\nรับทำ google ads,1200\nรับทำ facebook ads,800\nSEO marketing,500`}
              rows={6}
              className="w-full text-[11px] font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none" />
          </div>

          {/* Format hint */}
          <div className="mt-2 text-[10px] text-gray-400 space-y-0.5">
            <p>รองรับ format: <span className="font-mono bg-gray-50 px-1 rounded">keyword,volume</span> หรือ <span className="font-mono bg-gray-50 px-1 rounded">keyword เท่านั้น</span></p>
            <p>Header row อัตโนมัติ (ถ้ามี) · รองรับ Ahrefs, Semrush, GSC, DataForSEO</p>
          </div>
        </div>

        {/* Preview count */}
        {csvRows.length > 0 && (
          <div className="mx-5 mb-3 px-3 py-2 bg-gray-50 rounded-xl">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">พร้อม import</span>
              <span className="font-bold text-gray-900">{csvRows.length} keywords</span>
            </div>
            <div className="mt-1 text-[10px] text-gray-400">
              {csvRows.slice(0, 3).map(r => r.keyword).join(' · ')}{csvRows.length > 3 ? ` · +${csvRows.length - 3} อื่นๆ` : ''}
            </div>
          </div>
        )}

        {/* Import button + progress */}
        <div className="px-5 pb-5 space-y-2">
          <button onClick={runCsvImport} disabled={loadingCSV || csvRows.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
            {loadingCSV ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loadingCSV ? 'กำลัง classify...' : `Generate Intent + Score (${csvRows.length > 0 ? csvRows.length + ' kw' : 'วาง CSV ก่อน'})`}
          </button>
          {csvRows.length > 0 && !loadingCSV && !csvProgressLog.length && (
            <p className="text-[10px] text-gray-400 text-center">ไม่หา keyword ใหม่ · classify intent + priority + content type</p>
          )}
          {csvProgressLog.length > 0 && (
            <div className="bg-gray-950 rounded-xl px-3 py-2.5 space-y-1 max-h-32 overflow-y-auto">
              {csvProgressLog.map((line, i) => (
                <p key={i} className={`text-[10px] font-mono ${line.startsWith('✅') ? 'text-emerald-400' : line.startsWith('❌') ? 'text-red-400' : 'text-gray-400'}`}>{line}</p>
              ))}
              {loadingCSV && <p className="text-[10px] font-mono text-blue-400 animate-pulse">▍</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Results table ── */}
      {keywords.length > 0 && <KeywordResultsTable keywords={keywords} onDone={onDone} downloadCsv={downloadCsv} selectedKws={selectedKws} setSelectedKws={setSelectedKws} priorityScore={priorityScore} isAdmin={isAdmin} setKeywords={setKeywords} />}
    </div>
  )
}

// ─── Keyword Results Table (with Framework) ───────────────────────────────────

const FUNNEL_COLOR: Record<string, string> = {
  TOFU: 'bg-blue-100 text-blue-700',
  MOFU: 'bg-amber-100 text-amber-700',
  BOFU: 'bg-red-100 text-red-700',
  'Post Purchase': 'bg-purple-100 text-purple-700',
  All: 'bg-gray-100 text-gray-600',
}

const ARTICLE_TYPE_COLOR: Record<string, string> = {
  'Traffic Content':         'bg-blue-50 text-blue-600 border-blue-200',
  'Educational Content':     'bg-sky-50 text-sky-700 border-sky-200',
  'Authority Content':       'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Comparison Content':      'bg-amber-50 text-amber-700 border-amber-200',
  'Problem Solving Content': 'bg-orange-50 text-orange-700 border-orange-200',
  'Service Content':         'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Sales Content':           'bg-red-50 text-red-700 border-red-200',
  'Brand Content':           'bg-purple-50 text-purple-700 border-purple-200',
  'Retention Content':       'bg-teal-50 text-teal-700 border-teal-200',
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-gray-500 w-6">{value}</span>
    </div>
  )
}

function KeywordResultsTable({ keywords, onDone, downloadCsv, downloadHtml, selectedKws, setSelectedKws, priorityScore, isAdmin, setKeywords, hidePosStatus }: {
  keywords: KeywordRow[]
  onDone: () => void
  downloadCsv: () => void
  downloadHtml?: () => void
  selectedKws: Set<string>
  setSelectedKws: (s: Set<string>) => void
  priorityScore?: (kw: KeywordRow) => number
  isAdmin?: boolean
  setKeywords?: (kws: KeywordRow[]) => void
  hidePosStatus?: boolean
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filterFunnel, setFilterFunnel] = useState<string>('All')
  const [filterType, setFilterType] = useState<string>('All')

  // Quick-select top N by Priority Score (same logic as Content Map)
  const QUICK_N = [100, 300, 500, 1000]
  function selectTopN(n: number) {
    const sorted = [...keywords].sort((a, b) => {
      const scoreA = priorityScore ? priorityScore(a) : (a.opportunity_score ?? 0)
      const scoreB = priorityScore ? priorityScore(b) : (b.opportunity_score ?? 0)
      return scoreB - scoreA
    })
    setSelectedKws(new Set(sorted.slice(0, n).map(k => k.keyword)))
  }
  function toggleAll() {
    if (selectedKws.size === keywords.length) {
      setSelectedKws(new Set())
    } else {
      setSelectedKws(new Set(keywords.map(k => k.keyword)))
    }
  }
  function toggleOne(kw: string) {
    const next = new Set(selectedKws)
    next.has(kw) ? next.delete(kw) : next.add(kw)
    setSelectedKws(next)
  }
  const allSelected = selectedKws.size === keywords.length && keywords.length > 0
  const someSelected = selectedKws.size > 0 && selectedKws.size < keywords.length

  const PRIORITY_COLOR: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-500',
  }

  const funnels = ['All', 'TOFU', 'MOFU', 'BOFU', 'Post Purchase']
  const articleTypes = [
    'All', 'Traffic Content', 'Educational Content', 'Authority Content',
    'Comparison Content', 'Problem Solving Content', 'Service Content',
    'Sales Content', 'Brand Content', 'Retention Content',
  ]

  const filtered = keywords.filter(kw => {
    if (filterFunnel !== 'All' && kw.funnel !== filterFunnel) return false
    if (filterType !== 'All' && kw.article_type !== filterType) return false
    return true
  })

  // Article type summary counts
  const typeCounts = keywords.reduce((acc, kw) => {
    const t = kw.article_type ?? 'Unknown'
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      {/* Article type distribution */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="text-xs font-semibold text-gray-700 mb-3">Content Framework Distribution</div>
        <div className="flex flex-wrap gap-2">
          {/* All pill */}
          <button onClick={() => setFilterType('All')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${filterType === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
            All <span className="text-[10px] opacity-70">({keywords.length})</span>
          </button>
          {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <button key={type} onClick={() => setFilterType(filterType === type ? 'All' : type)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${filterType === type ? (ARTICLE_TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-700 border-gray-300') : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
              {type} <span className="text-[10px] opacity-70">({count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {/* Selection toolbar */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex-wrap">
          <span className="text-[11px] font-bold text-blue-700">เลือก Keyword สำหรับ Content Map:</span>
          <button onClick={toggleAll}
            className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors ${allSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'}`}>
            {allSelected ? '✓ ทั้งหมด' : 'เลือกทั้งหมด'} ({keywords.length})
          </button>
          {QUICK_N.map(n => n <= keywords.length && (
            <button key={n} onClick={() => selectTopN(n)}
              className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors ${selectedKws.size === n ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              Top {n}
            </button>
          ))}
          {someSelected && (
            <button onClick={() => setSelectedKws(new Set())}
              className="text-[10px] px-2.5 py-1 rounded-full font-semibold border border-gray-200 text-gray-400 hover:text-gray-600 bg-white">
              ล้าง
            </button>
          )}
          {selectedKws.size > 0 && (
            <span className="ml-auto text-[11px] font-bold text-blue-800 bg-blue-100 px-2.5 py-1 rounded-full">
              ✓ {selectedKws.size} selected → ไปใช้ใน Content Map
            </span>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">
              {filtered.length !== keywords.length ? `${filtered.length} / ` : ''}{keywords.length} Keywords
            </span>
            {/* Funnel filter pills */}
            <div className="flex gap-1">
              {funnels.map(f => (
                <button key={f} onClick={() => setFilterFunnel(f)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${filterFunnel === f ? (FUNNEL_COLOR[f] ?? 'bg-gray-200 text-gray-700') : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {(filterFunnel !== 'All' || filterType !== 'All') && (
              <button onClick={() => { setFilterFunnel('All'); setFilterType('All') }}
                className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 border border-gray-200 rounded-lg">
                ล้าง filter
              </button>
            )}
            <button onClick={downloadCsv} className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors">
              <Download size={12} /> Export CSV
            </button>
            {downloadHtml && (
              <button onClick={downloadHtml} className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors">
                <Download size={12} /> Export HTML
              </button>
            )}
            {isAdmin && setKeywords && keywords.length > 0 && (
              <button
                onClick={() => {
                  if (confirm(`ล้าง ${keywords.length} keywords ทั้งหมด? (ต้อง generate ใหม่)`)) {
                    setKeywords([])
                    setSelectedKws(new Set())
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 border border-red-200 rounded-lg transition-colors"
              >
                <X size={12} /> Reset Keywords
              </button>
            )}
            <button onClick={onDone} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg transition-colors">
              {selectedKws.size > 0 ? `Content Map (${selectedKws.size}) →` : 'Content Map →'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                </th>
                {['#', 'Keyword', 'Title (H1)', 'Vol.', ...(!hidePosStatus ? ['Pos.', 'Status'] : []), 'Page Type', 'Funnel', 'Article Type', 'Objective', 'Priority', 'Score'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((kw, rowIdx) => (
                <>
                  <tr key={kw.no}
                    className={`transition-colors cursor-pointer ${selectedKws.has(kw.keyword) ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-gray-50/80'}`}
                    onClick={() => setExpanded(expanded === kw.no ? null : kw.no)}>
                    <td className="px-3 py-2.5 w-8" onClick={e => { e.stopPropagation(); toggleOne(kw.keyword) }}>
                      <input type="checkbox" checked={selectedKws.has(kw.keyword)} onChange={() => toggleOne(kw.keyword)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 tabular-nums">{rowIdx + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-gray-900 min-w-[160px]">
                      <span className="block">{kw.keyword}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 min-w-[300px]">
                      <span className="block">{kw.title}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 tabular-nums font-mono">
                      {kw.volume > 0 ? kw.volume.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    {!hidePosStatus && <td className="px-3 py-2.5 tabular-nums text-center">
                      {(kw as any).position != null
                        ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(kw as any).position <= 3 ? 'bg-emerald-100 text-emerald-700' : (kw as any).position <= 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>#{(kw as any).position}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>}
                    {!hidePosStatus && <td className="px-3 py-2.5">
                      {(kw as any).status
                        ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-gray-100 text-gray-600 whitespace-nowrap">{(kw as any).status}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>}
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg whitespace-nowrap ${kw.page_type === 'Service Page' || kw.page_type === 'Core Page' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`}>
                        {kw.page_type || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${FUNNEL_COLOR[kw.funnel ?? 'TOFU'] ?? 'bg-gray-100 text-gray-600'}`}>
                        {kw.funnel ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border whitespace-nowrap ${ARTICLE_TYPE_COLOR[kw.article_type ?? ''] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {kw.article_type ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-[10px] font-semibold text-gray-700">{kw.primary_objective ?? '—'}</div>
                      <div className="text-[10px] text-gray-400">{kw.secondary_objective}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[kw.priority]}`}>{kw.priority}</span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-bold text-gray-800">{kw.opportunity_score}</td>
                  </tr>

                  {/* Expanded Framework row */}
                  {expanded === kw.no && (
                    <tr key={`${kw.no}-expand`} className="bg-gray-50/60">
                      <td colSpan={13} className="px-4 py-4">
                        <div className="grid grid-cols-2 gap-6">
                          {/* Left: Score breakdown */}
                          <div>
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Score Breakdown</p>
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-24">Traffic</span>
                                <ScoreBar value={kw.traffic_score ?? 0} color="bg-blue-400" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-24">Authority</span>
                                <ScoreBar value={kw.authority_score ?? 0} color="bg-indigo-400" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-24">Lead</span>
                                <ScoreBar value={kw.lead_score ?? 0} color="bg-emerald-400" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-24">Sales</span>
                                <ScoreBar value={kw.sales_score ?? 0} color="bg-red-400" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 w-24">Retention</span>
                                <ScoreBar value={kw.retention_score ?? 0} color="bg-teal-400" />
                              </div>
                            </div>
                          </div>

                          {/* Right: Meta + AEO */}
                          <div className="space-y-2">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Framework + AEO</p>
                            <div className="flex flex-wrap gap-2 text-[10px]">
                              <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                <span className="text-gray-400">Intent: </span>
                                <span className="font-semibold text-gray-700">{kw.intent}</span>
                              </span>
                              <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                <span className="text-gray-400">Type: </span>
                                <span className="font-semibold text-gray-700">{kw.keyword_type}</span>
                              </span>
                              <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                <span className="text-gray-400">Content: </span>
                                <span className="font-semibold text-gray-700">{kw.content_type}</span>
                              </span>
                              {(kw as any).topic_cluster_role && (
                                <span className="bg-violet-50 border border-violet-200 text-violet-700 px-2 py-1 rounded-lg">
                                  <span className="text-violet-400">Cluster role: </span>
                                  <span className="font-semibold">{(kw as any).topic_cluster_role}</span>
                                </span>
                              )}
                            </div>
                            {/* AEO row */}
                            {((kw as any).aeo_opportunity || (kw as any).question_pattern) && (
                              <div className="flex flex-wrap gap-2 text-[10px] mt-1">
                                {(kw as any).aeo_opportunity && (
                                  <span className={`px-2 py-1 rounded-lg font-semibold border ${(kw as any).aeo_opportunity === 'high' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : (kw as any).aeo_opportunity === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                                    AEO: {(kw as any).aeo_opportunity} ({(kw as any).aeo_opportunity_score ?? '—'})
                                  </span>
                                )}
                                {(kw as any).ai_overview_risk && (
                                  <span className={`px-2 py-1 rounded-lg font-semibold border ${(kw as any).ai_overview_risk === 'high' ? 'bg-red-50 border-red-200 text-red-700' : (kw as any).ai_overview_risk === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                                    AI Risk: {(kw as any).ai_overview_risk}
                                  </span>
                                )}
                                {(kw as any).question_pattern && (kw as any).question_pattern !== 'none' && (
                                  <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg text-gray-600">
                                    Pattern: {(kw as any).question_pattern}
                                  </span>
                                )}
                                {(kw as any).answer_format_recommendation && (
                                  <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg text-gray-600">
                                    Format: {(kw as any).answer_format_recommendation}
                                  </span>
                                )}
                                {(kw as any).featured_snippet_potential && (
                                  <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg font-semibold">Featured Snippet</span>
                                )}
                                {(kw as any).direct_answer_potential && (
                                  <span className="bg-blue-50 border border-blue-200 text-blue-700 px-2 py-1 rounded-lg font-semibold">Direct Answer</span>
                                )}
                              </div>
                            )}
                            <p className="text-[10px] text-gray-400 mt-2 italic">{kw.notes || '—'}</p>
                          </div>
                        </div>

                        {/* Sheet fields row — always show slug/page_type + any sheet fields */}
                        {(kw.slug || kw.page_type || kw.cluster || kw.page_tier || kw.status || kw.action || kw.current_url || kw.keyword_group || kw.section) && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Page Info</p>
                            <div className="flex flex-wrap gap-2 text-[10px]">
                              {kw.page_type && (
                                <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-1 rounded-lg font-semibold">
                                  {kw.page_type}
                                </span>
                              )}
                              {kw.status && (
                                <span className={`px-2 py-1 rounded-lg font-semibold border ${kw.status === 'New' ? 'bg-blue-50 border-blue-200 text-blue-700' : kw.status === 'Keep' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
                                  Status: {kw.status}
                                </span>
                              )}
                              {kw.action && (
                                <span className="bg-purple-50 border border-purple-200 text-purple-700 px-2 py-1 rounded-lg font-semibold">
                                  Action: {kw.action}
                                </span>
                              )}
                              {kw.cluster && (
                                <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                  <span className="text-gray-400">Cluster: </span>
                                  <span className="font-semibold text-gray-700">{kw.cluster}</span>
                                </span>
                              )}
                              {kw.page_tier && (
                                <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                  <span className="text-gray-400">Tier: </span>
                                  <span className="font-semibold text-gray-700">{kw.page_tier}</span>
                                </span>
                              )}
                              {kw.keyword_group && (
                                <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                  <span className="text-gray-400">Group: </span>
                                  <span className="font-semibold text-gray-700">{kw.keyword_group}</span>
                                </span>
                              )}
                              {kw.section && (
                                <span className="bg-white border border-gray-200 px-2 py-1 rounded-lg">
                                  <span className="text-gray-400">Section: </span>
                                  <span className="font-semibold text-gray-700">{kw.section}</span>
                                </span>
                              )}
                            </div>
                            {kw.slug && (
                              <div className="mt-2 flex items-center gap-2 text-[10px]">
                                <span className="text-gray-400 shrink-0">Slug:</span>
                                <code className="bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-700 truncate">/{kw.slug}</code>
                              </div>
                            )}
                            {kw.current_url && (
                              <div className="mt-1 flex items-center gap-2 text-[10px]">
                                <span className="text-gray-400 shrink-0">Current URL:</span>
                                <a href={kw.current_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{kw.current_url}</a>
                              </div>
                            )}
                            {(kw.conversion_potential || kw.traffic_potential || kw.relevance_score) && (
                              <div className="mt-2 flex gap-4 text-[10px]">
                                {kw.conversion_potential != null && (
                                  <span><span className="text-gray-400">Conv: </span><span className="font-bold text-gray-700">{kw.conversion_potential}/5</span></span>
                                )}
                                {kw.traffic_potential != null && (
                                  <span><span className="text-gray-400">Traffic: </span><span className="font-bold text-gray-700">{kw.traffic_potential}/5</span></span>
                                )}
                                {kw.relevance_score != null && (
                                  <span><span className="text-gray-400">Relevance: </span><span className="font-bold text-gray-700">{kw.relevance_score}/5</span></span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Content Map Tab ──────────────────────────────────────────────────────────

function ContentMapTab({
  project, keywords, selectedKws, timeline, setTimeline, onClearTimeline, onDone, scorerRef, userRole,
}: {
  project: ProjectData
  keywords: KeywordRow[]
  selectedKws: Set<string>
  timeline: TimelineEntry[]
  setTimeline: (t: TimelineEntry[]) => void
  onClearTimeline: () => void
  onDone: () => void
  userRole?: string
  scorerRef?: React.MutableRefObject<((kw: KeywordRow) => number) | undefined>
}) {
  const [days, setDays] = useState(90)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [groupBy, setGroupBy] = useState<'week' | 'date'>('week')
  const [expandedReason, setExpandedReason] = useState<number | null>(null)

  // Strategy settings
  const [websiteType, setWebsiteType] = useState<WebsiteType>('Auto Detect')
  const [seoGoal, setSeoGoal] = useState<SeoGoal>('Balanced Growth')
  const [strategy, setStrategy] = useState<TimelineStrategy>('Follow Website Type Ratio')
  const [useCustomRatio, setUseCustomRatio] = useState(false)
  const [lockedObjectives, setLockedObjectives] = useState<Set<string>>(new Set())
  const [ratioNormError, setRatioNormError] = useState('')

  // Detection result
  const [detection, setDetection] = useState<ReturnType<typeof detectWebsiteType> | null>(null)

  // Ratio state — init from Service as default
  const defaultRatio = getRecommendedRatio('Service')
  const [customRatio, setCustomRatio] = useState<Record<string, number>>(defaultRatio)

  // Auto-detect when keywords change
  useEffect(() => {
    if (keywords.length > 0) {
      const d = detectWebsiteType(keywords)
      setDetection(d)
      // Update ratio to match detected type
      const effectiveType = websiteType === 'Auto Detect' ? d.detectedType : websiteType
      const recommended = applyGoalModifier(getRecommendedRatio(effectiveType), seoGoal)
      setCustomRatio(recommended)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords.length])

  // Update ratio when websiteType or seoGoal changes (only if not custom)
  useEffect(() => {
    if (!useCustomRatio && keywords.length > 0) {
      const effectiveType = websiteType === 'Auto Detect' ? (detection?.detectedType ?? 'Service') : websiteType
      const recommended = applyGoalModifier(getRecommendedRatio(effectiveType), seoGoal)
      setCustomRatio(recommended)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteType, seoGoal])

  const effectiveWebsiteType = websiteType === 'Auto Detect' ? (detection?.detectedType ?? 'Service') : websiteType

  // Priority scorer using current strategy settings — shared with Keywords tab for Top N selection
  function kwPriorityScore(kw: KeywordRow): number {
    return calcPriorityScore(
      { ...kw, articleObjectiveTag: (kw as any).articleObjectiveTag || autoClassifyObjective(kw) },
      effectiveWebsiteType, seoGoal, strategy, customRatio
    )
  }
  // Register scorer so Keywords tab can use it for Top N
  if (scorerRef) scorerRef.current = kwPriorityScore

  function handleSlider(key: string, val: number) {
    setUseCustomRatio(true)
    setStrategy('Custom Ratio')
    setCustomRatio(prev => ({ ...prev, [key]: val }))
    setRatioNormError('')
  }

  function handleNormalize() {
    try {
      const locked = Array.from(lockedObjectives)
      const normalized = normalizeRatio(customRatio, locked)
      setCustomRatio(normalized as Record<string, number>)
      setRatioNormError('')
    } catch (e: unknown) {
      setRatioNormError(String(e instanceof Error ? e.message : e))
    }
  }

  function handleResetRatio() {
    const recommended = applyGoalModifier(getRecommendedRatio(effectiveWebsiteType), seoGoal)
    setCustomRatio(recommended)
    setUseCustomRatio(false)
    setLockedObjectives(new Set())
    setRatioNormError('')
    setStrategy('Follow Website Type Ratio')
  }

  function toggleLock(key: string) {
    setLockedObjectives(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const ratioTotal = Object.values(customRatio).reduce((s, v) => s + v, 0)

  function generate() {
    if (!keywords.length) return
    setLoading(true)
    try {
      // Use selectedKws filter if any selected, else use all
      const kwsToUse = selectedKws.size > 0
        ? keywords.filter(kw => selectedKws.has(kw.keyword))
        : keywords

      // Build classified keywords
      const classified = kwsToUse.map(kw => ({
        ...kw,
        articleObjectiveTag: (kw as any).articleObjectiveTag || autoClassifyObjective(kw),
      }))

      // Priority scoring
      const scored = classified.map(kw => ({
        ...kw,
        priorityScore: calcPriorityScore(kw as any, effectiveWebsiteType, seoGoal, strategy, customRatio),
      }))

      // แยก: New/ไม่มี status = เขียนใหม่ | status อื่นๆ = แก้จากอันเดิม
      const isNewContent = (kw: any) => !kw.status || kw.status === 'New'
      const movable = scored.filter(kw => !(kw as any).isLocked && (kw as any).status !== 'Published' && (kw as any).status !== 'Excluded' && isNewContent(kw))
      const existingContent = scored.filter(kw => !(kw as any).isLocked && !isNewContent(kw) && (kw as any).status !== 'Published' && (kw as any).status !== 'Excluded')
      const fixed = scored.filter(kw => (kw as any).isLocked || (kw as any).status === 'Published' || (kw as any).status === 'Excluded')

      // Sort by priority descending
      movable.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))

      // Working days (skip weekends + Thai holidays)
      const THAI_HOLIDAYS_SET = new Set([
        '01-01','04-06','04-13','04-14','04-15','05-01','05-04','06-03',
        '07-28','08-12','10-13','10-23','12-05','12-10','12-31',
      ])
      const LUNAR_2026: Record<string, boolean> = { '2026-03-03':true,'2026-05-31':true,'2026-07-29':true,'2026-07-30':true,'2026-10-25':true }
      const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
      const THAI_DAYS_ARR = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์']
      const getISOWeekLocal = (s: string) => {
        const d = new Date(s + 'T00:00:00'); const dow = (d.getDay() + 6) % 7
        const thu = new Date(d); thu.setDate(d.getDate() - dow + 3)
        const ys = new Date(thu.getFullYear(), 0, 4); const ysdow = (ys.getDay() + 6) % 7
        const ws = new Date(ys); ws.setDate(ys.getDate() - ysdow)
        return Math.ceil(((thu.getTime() - ws.getTime()) / 86400000 + 1) / 7)
      }
      const startWeek = getISOWeekLocal(startDate)
      const startYear = new Date(startDate + 'T00:00:00').getFullYear()

      const workingDays: { dateStr: string; thaiDate: string; dayOfWeek: string; weekLabel: string }[] = []
      for (let di = 0; workingDays.length < Math.max(movable.length + fixed.length, 1) || di < days; di++) {
        const d = new Date(startDate + 'T00:00:00'); d.setDate(d.getDate() + di)
        const dateStr = d.toISOString().slice(0, 10)
        if (di >= days + 180) break
        const dow = d.getDay()
        if (dow === 0 || dow === 6) continue
        if (THAI_HOLIDAYS_SET.has(dateStr.slice(5))) continue
        if (LUNAR_2026[dateStr]) continue
        const be = (d.getFullYear() + 543) % 100
        const thaiDate = `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${be < 10 ? '0' + be : be}`
        const dayOfWeek = THAI_DAYS_ARR[dow]
        const week = getISOWeekLocal(dateStr)
        const getMondayDate = (w: number, y: number) => {
          const jan4 = new Date(y, 0, 4); const jan4dow = (jan4.getDay() + 6) % 7
          const m = new Date(jan4); m.setDate(jan4.getDate() - jan4dow + (w - 1) * 7); return m
        }
        const thisMonday = getMondayDate(week, d.getFullYear())
        const startMonday = getMondayDate(startWeek, startYear)
        const diffWeeks = Math.max(0, Math.floor((thisMonday.getTime() - startMonday.getTime()) / 604800000))
        const weekLabel = `สัปดาห์ที่ ${diffWeeks + 1}`
        workingDays.push({ dateStr, thaiDate, dayOfWeek, weekLabel })
        if (workingDays.length >= movable.length + 10 && di >= days - 1) break
      }

      // 20/80 split
      const firstPeriodCount = Math.max(1, Math.ceil(workingDays.length * 0.2))
      const firstPeriodDays = workingDays.slice(0, firstPeriodCount)
      const remainingPeriodDays = workingDays.slice(firstPeriodCount)

      const firstBatchCount = Math.ceil(movable.length * 0.8)
      const firstBatch = movable.slice(0, firstBatchCount)
      const remainingBatch = movable.slice(firstBatchCount)

      const assignDates = (items: typeof movable, periodDays: typeof workingDays, batch: '20/80 First Batch' | '20/80 Remaining Batch', phase: string) =>
        items.map((kw, idx) => {
          const wd = periodDays[idx % periodDays.length]
          return {
            date: wd.dateStr, thaiDate: wd.thaiDate, dayOfWeek: wd.dayOfWeek, weekLabel: wd.weekLabel,
            keyword: kw.keyword, title: kw.title ?? kw.keyword,
            priority: kw.priority ?? 'medium', volume: kw.volume ?? 0,
            intent: kw.intent ?? '', opportunity_score: kw.opportunity_score ?? 0,
            isCore: batch === '20/80 First Batch', phase: batch === '20/80 First Batch' ? 1 : 2,
            articleStatus: 'pending' as const,
            articleObjectiveTag: (kw as any).articleObjectiveTag,
            funnel: kw.funnel,
            timelineBatch: batch,
            timelinePhase: phase,
            priorityScore: kw.priorityScore,
            publishingPriority: idx + 1,
            websiteTypeUsed: effectiveWebsiteType,
            reasonForScheduling: generateScheduleReason((kw as any).articleObjectiveTag ?? 'Traffic Content', batch, idx + 1, seoGoal, effectiveWebsiteType, kw.priorityScore ?? 0),
            status: 'Scheduled' as const,
            ...((kw as any).slug      ? { slug: (kw as any).slug } : {}),
            ...((kw as any).page_type ? { page_type: (kw as any).page_type } : {}),
            ...((kw as any).status    ? { kw_status: (kw as any).status } : {}),
          } as TimelineEntry
        })

      existingContent.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))

      const newScheduled = [
        ...assignDates(firstBatch, firstPeriodDays.length > 0 ? firstPeriodDays : workingDays, '20/80 First Batch', 'Priority Acceleration'),
        ...assignDates(remainingBatch, remainingPeriodDays.length > 0 ? remainingPeriodDays : workingDays, '20/80 Remaining Batch', 'Support & Expansion'),
      ]
      newScheduled.sort((a, b) => a.date.localeCompare(b.date))

      // existingContent ไม่ assign วันที่ แต่ต่อท้าย timeline แยก section
      const existingScheduled = existingContent.map((kw, idx) => ({
        date: '', thaiDate: '', dayOfWeek: '', weekLabel: 'Existing Content',
        keyword: kw.keyword, title: kw.title ?? kw.keyword,
        priority: kw.priority ?? 'medium', volume: kw.volume ?? 0,
        intent: kw.intent ?? '', opportunity_score: kw.opportunity_score ?? 0,
        isCore: false, phase: 3,
        articleStatus: 'pending' as const,
        articleObjectiveTag: (kw as any).articleObjectiveTag,
        funnel: kw.funnel,
        timelineBatch: '20/80 Remaining Batch' as const,
        timelinePhase: 'Existing Content (Update/Optimize)',
        priorityScore: kw.priorityScore,
        publishingPriority: idx + 1,
        websiteTypeUsed: effectiveWebsiteType,
        reasonForScheduling: `Status: ${(kw as any).status} — ปรับปรุงจากบทความเดิม ไม่ใช่เขียนใหม่`,
        status: 'Scheduled' as const,
        ...((kw as any).slug      ? { slug: (kw as any).slug } : {}),
        ...((kw as any).page_type ? { page_type: (kw as any).page_type } : {}),
        ...((kw as any).status    ? { kw_status: (kw as any).status } : {}),
      } as TimelineEntry))

      setTimeline([...newScheduled, ...existingScheduled])
      setTimelineSummary({ firstPeriodCount, firstBatchCount, remainingBatchCount: remainingBatch.length, totalWorking: workingDays.length })
      onDone()
    } finally {
      setLoading(false)
    }
  }

  // Summary state
  const [timelineSummary, setTimelineSummary] = useState<{ firstPeriodCount: number; firstBatchCount: number; remainingBatchCount: number; totalWorking: number } | null>(null)

  // Group by week
  const byWeek = timeline.reduce((acc, e) => {
    const key = e.weekLabel
    if (!acc[key]) acc[key] = []
    acc[key].push(e)
    return acc
  }, {} as Record<string, TimelineEntry[]>)

  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-500', writing: 'bg-blue-100 text-blue-700',
    done: 'bg-emerald-100 text-emerald-700', review: 'bg-amber-100 text-amber-700',
    approved: 'bg-purple-100 text-purple-700',
  }

  const OBJ_BADGE: Record<string, string> = {
    'Traffic Content': 'bg-blue-50 text-blue-700',
    'Educational Content': 'bg-purple-50 text-purple-700',
    'Authority Content': 'bg-amber-50 text-amber-700',
    'Comparison Content': 'bg-cyan-50 text-cyan-700',
    'Problem Solving Content': 'bg-emerald-50 text-emerald-700',
    'Service Content': 'bg-orange-50 text-orange-700',
    'Sales Content': 'bg-red-50 text-red-700',
    'Brand Content': 'bg-pink-50 text-pink-700',
    'Retention Content': 'bg-gray-100 text-gray-600',
  }

  // Ratio gap analysis
  const actualRatio: Record<string, number> = {}
  if (timeline.length > 0) {
    for (const e of timeline) {
      const obj = e.articleObjectiveTag ?? 'Traffic Content'
      actualRatio[obj] = (actualRatio[obj] ?? 0) + 1
    }
    for (const k of Object.keys(actualRatio)) {
      actualRatio[k] = Math.round((actualRatio[k] / timeline.length) * 100)
    }
  }

  const selectCls = "text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 w-full"

  return (
    <div className="space-y-5">
      {/* ─── Config Card ─── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        <div className="text-sm font-semibold text-gray-900">⚙️ ตั้งค่า Project Timeline</div>

        {/* Row 1: original fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">วันเริ่มต้น</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">จำนวนวัน</label>
            <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} min={7} max={365}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Keywords</label>
            <div className={`text-sm font-semibold py-2 px-3 rounded-lg ${selectedKws.size > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-900'}`}>
              {selectedKws.size > 0
                ? <><span className="font-bold">{selectedKws.size}</span><span className="text-blue-500 font-normal"> / {keywords.length} selected</span></>
                : <>{keywords.length} รายการ <span className="text-gray-400 text-xs font-normal">(ใช้ทั้งหมด)</span></>
              }
            </div>
          </div>
          <div className="flex items-end gap-2">
            {userRole === 'ADMIN' && timeline.length > 0 && (
              <button
                onClick={onClearTimeline}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors whitespace-nowrap"
              >
                <X size={14} /> Clear Timeline
              </button>
            )}
            <button onClick={generate} disabled={loading || !keywords.length}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
              {loading ? 'กำลัง Generate...' : 'Generate Timeline'}
            </button>
          </div>
        </div>
        {!keywords.length && (
          <p className="text-xs text-amber-600">⚠️ กรุณาไปที่ tab Keywords แล้ว Generate Keywords ก่อน</p>
        )}

        {/* ─── SEO Timeline Strategy ─── */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Target size={13} className="text-gray-400" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">SEO Timeline Strategy</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">Website Type</label>
              <div className="relative">
                <select value={websiteType} onChange={e => { setWebsiteType(e.target.value as WebsiteType); setUseCustomRatio(false) }} className={selectCls}>
                  {(['Auto Detect','Affiliate','Ecommerce','Knowledge','Service','SaaS','Lead Gen','Marketplace','Media/News'] as const).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              {websiteType !== 'Auto Detect' && (
                <span className="text-[9px] text-amber-600 font-semibold mt-0.5 block">Manual Override</span>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">Main SEO Goal</label>
              <select value={seoGoal} onChange={e => setSeoGoal(e.target.value as SeoGoal)} className={selectCls}>
                {(['Traffic Growth','Lead Generation','Sales / Conversion','Authority Building','Balanced Growth'] as const).map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">Timeline Strategy</label>
              <select value={strategy} onChange={e => { setStrategy(e.target.value as TimelineStrategy); if (e.target.value === 'Custom Ratio') setUseCustomRatio(true) }} className={selectCls}>
                {(['Follow Website Type Ratio','Traffic First','Lead First','Sales First','Authority First','Balanced','Custom Ratio'] as const).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Detected Website Type */}
          {keywords.length === 0 ? (
            <div className="mt-3 bg-gray-50 rounded-xl p-3 text-[11px] text-gray-400">ยังไม่สามารถวิเคราะห์ประเภทเว็บไซต์ได้ กรุณา Generate Keywords ก่อน</div>
          ) : detection ? (
            websiteType !== 'Auto Detect' ? (
              /* Manual Override — show override as primary, detection as footnote */
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Globe size={12} className="text-amber-500" />
                  <span className="text-[10px] text-amber-600 font-medium">Using (Manual Override):</span>
                  <span className="text-xs font-bold text-amber-800">{websiteType}</span>
                </div>
                <div className="text-[10px] text-amber-500 mt-0.5">
                  AI detected: {detection.detectedType} ({detection.confidence}% confidence) — overridden by your selection
                </div>
              </div>
            ) : (
              /* Auto Detect — show detection as primary */
              <div className="mt-3 bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Globe size={12} className="text-gray-400" />
                  <span className="text-[10px] text-gray-500 font-medium">Detected:</span>
                  <span className="text-xs font-bold text-gray-900">{detection.detectedType}{detection.isHybrid && detection.secondaryType ? ` + ${detection.secondaryType} Hybrid` : ''}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${detection.confidence >= 70 ? 'bg-green-100 text-green-700' : detection.confidence >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {detection.confidence}% confidence
                  </span>
                </div>
                {detection.reasons.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-0.5">{detection.reasons.join(' ')}</div>
                )}
              </div>
            )
          ) : null}
        </div>

        {/* ─── Content Ratio Control ─── */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart2 size={13} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Content Ratio Control</span>
              {useCustomRatio && <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">Custom</span>}
            </div>
            <span className={`text-xs font-bold ${Math.abs(ratioTotal - 100) > 2 ? 'text-red-600' : 'text-emerald-600'}`}>Total: {ratioTotal}%</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Sliders */}
            <div className="space-y-2.5">
              {ARTICLE_OBJECTIVES.map(obj => {
                const val = customRatio[obj] ?? 0
                const isLocked = lockedObjectives.has(obj)
                return (
                  <div key={obj} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 w-44 shrink-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: OBJ_COLORS[obj] }} />
                      <span className="text-[10px] text-gray-600 truncate">{obj.replace(' Content','')}</span>
                    </div>
                    <input type="range" min={0} max={60} value={val}
                      onChange={e => handleSlider(obj, Number(e.target.value))}
                      disabled={isLocked}
                      className="flex-1 h-1.5 rounded-full accent-gray-800 disabled:opacity-50"
                      style={{ accentColor: OBJ_COLORS[obj] }}
                    />
                    <span className="text-[10px] font-bold text-gray-700 w-8 text-right">{val}%</span>
                    <button onClick={() => toggleLock(obj)}
                      className={`shrink-0 p-1 rounded-lg transition-colors ${isLocked ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                      title={isLocked ? 'Unlock' : 'Lock'}>
                      {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                  </div>
                )
              })}
              {ratioNormError && <p className="text-[10px] text-red-600 mt-1">⚠️ {ratioNormError}</p>}
              <div className="flex gap-2 pt-1 flex-wrap">
                <button onClick={handleNormalize}
                  className="text-[10px] px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors">
                  Normalize 100%
                </button>
                <button onClick={handleResetRatio}
                  className="text-[10px] px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  Reset Recommended
                </button>
                <button onClick={() => { setUseCustomRatio(true); setStrategy('Custom Ratio') }}
                  className="text-[10px] px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
                  Apply Custom Ratio
                </button>
              </div>
            </div>

            {/* Donut Chart + Horizontal Bars */}
            <div className="flex flex-col items-center gap-3">
              <DonutChart ratio={customRatio} />
              <div className="w-full space-y-1">
                {ARTICLE_OBJECTIVES.filter(o => (customRatio[o] ?? 0) > 0).sort((a,b)=>(customRatio[b]??0)-(customRatio[a]??0)).map(obj => (
                  <div key={obj} className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-400 w-28 truncate shrink-0">{obj.replace(' Content','')}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(customRatio[obj]??0, 100)}%`, backgroundColor: OBJ_COLORS[obj] }} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-500 w-6 text-right">{customRatio[obj]??0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Summary Box ─── */}
      {timeline.length > 0 && timelineSummary && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <div className="text-sm font-semibold text-gray-900">📊 Timeline Summary</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Website Type', value: effectiveWebsiteType, sub: websiteType === 'Auto Detect' ? `${detection?.confidence ?? 0}% confidence` : 'Manual Override' },
              { label: 'SEO Goal', value: seoGoal, sub: strategy },
              { label: 'First Batch (80%)', value: `${timelineSummary.firstBatchCount} บทความ`, sub: `ใน ${timelineSummary.firstPeriodCount} วันทำงานแรก` },
              { label: 'Remaining Batch (20%)', value: `${timelineSummary.remainingBatchCount} บทความ`, sub: `ใน ${timelineSummary.totalWorking - timelineSummary.firstPeriodCount} วันที่เหลือ` },
            ].map(stat => (
              <div key={stat.label} className="bg-gray-50 rounded-xl p-3">
                <div className="text-[10px] text-gray-400 mb-0.5">{stat.label}</div>
                <div className="text-sm font-bold text-gray-900">{stat.value}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>

          {/* Ratio in use */}
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Ratio {useCustomRatio ? '(Custom)' : '(Recommended)'}</div>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
              {ARTICLE_OBJECTIVES.map(obj => (
                <div key={obj} className="text-center">
                  <div className="text-[9px] text-gray-400 truncate">{obj.replace(' Content','')}</div>
                  <div className="text-xs font-bold" style={{ color: OBJ_COLORS[obj] }}>{customRatio[obj]??0}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Ratio Gap Analysis */}
          {timeline.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                <Info size={10} />Ratio Gap Analysis
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="text-left py-1">Objective</th>
                      <th className="text-right py-1">Target</th>
                      <th className="text-right py-1">Actual</th>
                      <th className="text-right py-1">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ARTICLE_OBJECTIVES.map(obj => {
                      const target = customRatio[obj] ?? 0
                      const actual = actualRatio[obj] ?? 0
                      const gap = actual - target
                      return (
                        <tr key={obj} className="border-t border-gray-100">
                          <td className="py-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: OBJ_COLORS[obj] }} />
                            {obj.replace(' Content', '')}
                          </td>
                          <td className="text-right py-1 text-gray-500">{target}%</td>
                          <td className="text-right py-1 font-semibold text-gray-700">{actual}%</td>
                          <td className={`text-right py-1 font-bold ${gap > 0 ? 'text-blue-600' : gap < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {gap > 0 ? '+' : ''}{gap}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400">
            ✅ กฎ 20/80 Valid · ลง {timelineSummary.firstBatchCount} บทความใน {timelineSummary.firstPeriodCount} วันแรก · อีก {timelineSummary.remainingBatchCount} บทความใน {timelineSummary.totalWorking - timelineSummary.firstPeriodCount} วันที่เหลือ
          </p>
        </div>
      )}

      {/* ─── Timeline display ─── */}
      {timeline.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold text-gray-900">{timeline.filter(e => e.weekLabel !== 'Existing Content').length} บทความใหม่</div>
              {timeline.some(e => e.weekLabel === 'Existing Content') && (
                <div className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                  + {timeline.filter(e => e.weekLabel === 'Existing Content').length} แก้จากอันเดิม
                </div>
              )}
            </div>
            <div className="flex bg-gray-100 rounded-xl p-1">
              {(['week', 'date'] as const).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${groupBy === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  {g === 'week' ? 'แบ่งรายสัปดาห์' : 'แบ่งรายวัน'}
                </button>
              ))}
            </div>
          </div>

          {groupBy === 'week' ? (
            <>
              {/* New Content timeline */}
              {Object.entries(byWeek).filter(([w]) => w !== 'Existing Content').map(([week, entries]) => (
              <div key={week} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{week}</span>
                  <span className="text-xs text-gray-400">{entries.length} บทความ</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {entries.map((e, i) => {
                    const absIdx = timeline.indexOf(e)
                    return (
                      <div key={i}>
                        <div className="px-5 py-3 flex items-center gap-4">
                          <div className="text-[11px] text-gray-400 shrink-0 w-16">
                            <div className="font-medium text-gray-600">{e.thaiDate}</div>
                            <div>{e.dayOfWeek}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-900 truncate">{e.title}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                              <span className="truncate max-w-[180px]">{e.keyword}</span>
                              {e.volume > 0 && <span className="font-mono shrink-0">Vol. {e.volume.toLocaleString()}</span>}
                              {e.page_type && <span className={`px-1.5 py-0 rounded font-semibold shrink-0 ${e.page_type === 'Service Page' || e.page_type === 'Core Page' ? 'bg-purple-100 text-purple-600' : 'bg-sky-100 text-sky-600'}`}>{e.page_type}</span>}
                              {e.slug && <span className="font-mono text-gray-300 shrink-0">/{e.slug}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            {e.articleObjectiveTag && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${OBJ_BADGE[e.articleObjectiveTag] ?? 'bg-gray-100 text-gray-500'}`}>
                                {e.articleObjectiveTag.replace(' Content','')}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.timelineBatch === '20/80 First Batch' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                              {e.timelineBatch === '20/80 First Batch' ? 'First' : 'Support'}
                            </span>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[e.articleStatus]}`}>
                              {e.articleStatus}
                            </span>
                            <button onClick={() => setExpandedReason(expandedReason === absIdx ? null : absIdx)}
                              className="text-[9px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded-lg hover:bg-gray-100">
                              <Info size={10} />
                            </button>
                          </div>
                        </div>
                        {expandedReason === absIdx && e.reasonForScheduling && (
                          <div className="px-5 pb-3 bg-blue-50/50">
                            <p className="text-[10px] text-blue-700">{e.reasonForScheduling}</p>
                            <div className="flex gap-3 mt-1 text-[9px] text-gray-400">
                              {e.priorityScore != null && <span>Priority Score: <strong>{e.priorityScore}</strong></span>}
                              {e.timelinePhase && <span>Phase: <strong>{e.timelinePhase}</strong></span>}
                              {e.publishingPriority != null && <span>ลำดับ: <strong>#{e.publishingPriority}</strong></span>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              ))}

              {/* Existing Content section */}
              {timeline.some(e => e.weekLabel === 'Existing Content') && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 bg-amber-100 border-b border-amber-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-amber-800">แก้ไข / ปรับปรุงบทความเดิม</span>
                      <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold">ไม่ใช่บทความใหม่</span>
                    </div>
                    <span className="text-xs text-amber-600">{timeline.filter(e => e.weekLabel === 'Existing Content').length} รายการ</span>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {timeline.filter(e => e.weekLabel === 'Existing Content').map((e, i) => {
                      const absIdx = timeline.indexOf(e)
                      return (
                        <div key={i}>
                          <div className="px-5 py-3 flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-gray-900 truncate">{e.title}</div>
                              <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className="truncate max-w-[180px]">{e.keyword}</span>
                                {e.volume > 0 && <span className="font-mono shrink-0">Vol. {e.volume.toLocaleString()}</span>}
                                {e.page_type && <span className={`px-1.5 py-0 rounded font-semibold shrink-0 ${e.page_type === 'Service Page' || e.page_type === 'Core Page' ? 'bg-purple-100 text-purple-600' : 'bg-sky-100 text-sky-600'}`}>{e.page_type}</span>}
                                {e.slug && <span className="font-mono text-gray-300 shrink-0">/{e.slug}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                              {e.articleObjectiveTag && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${OBJ_BADGE[e.articleObjectiveTag] ?? 'bg-gray-100 text-gray-500'}`}>
                                  {e.articleObjectiveTag.replace(' Content','')}
                                </span>
                              )}
                              {(e as any).kw_status && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">
                                  {(e as any).kw_status}
                                </span>
                              )}
                              <button onClick={() => setExpandedReason(expandedReason === absIdx ? null : absIdx)}
                                className="text-[9px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded-lg hover:bg-amber-200">
                                <Info size={10} />
                              </button>
                            </div>
                          </div>
                          {expandedReason === absIdx && e.reasonForScheduling && (
                            <div className="px-5 pb-3 bg-amber-100/50">
                              <p className="text-[10px] text-amber-800">{e.reasonForScheduling}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['#','วันที่','Title','Vol.','Page Type','Objective','Batch','Score','Status','เหตุผล'].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-[10px] font-bold text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {timeline.map((e, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-400">{e.publishingPriority ?? i+1}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-medium text-gray-700">{e.thaiDate}</div>
                        <div className="text-[10px] text-gray-400">{e.dayOfWeek}</div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[180px]">
                        <div className="truncate font-medium">{e.title}</div>
                        <div className="truncate text-[10px] text-gray-400">{e.keyword}</div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-[11px] text-gray-500 font-mono">
                        {e.volume > 0 ? e.volume.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {e.page_type
                          ? <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${e.page_type === 'Service Page' || e.page_type === 'Core Page' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}`}>{e.page_type}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {e.articleObjectiveTag && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${OBJ_BADGE[e.articleObjectiveTag] ?? 'bg-gray-100 text-gray-500'}`}>
                            {e.articleObjectiveTag.replace(' Content','')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${e.timelineBatch === '20/80 First Batch' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {e.timelineBatch === '20/80 First Batch' ? 'First 80%' : 'Remaining 20%'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-gray-700">{e.priorityScore ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[e.articleStatus]}`}>{e.articleStatus}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[180px]">
                        <p className="text-[9px] text-gray-400 truncate" title={e.reasonForScheduling}>{e.reasonForScheduling}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Articles Tab ─────────────────────────────────────────────────────────────

function ArticlesTab({
  project, timeline, setTimeline, jobs, setJobs,
  autoSchedule, onAutoScheduleToggle, writeArticleRef,
  scheduleDays, setScheduleDays, scheduleSelectedEntries, setScheduleSelectedEntries,
  stopRequested, setStopRequested, stopRef,
}: {
  project: ProjectData
  timeline: TimelineEntry[]
  setTimeline: (t: TimelineEntry[]) => void
  jobs: ArticleJob[]
  setJobs: (j: ArticleJob[]) => void
  autoSchedule: boolean
  onAutoScheduleToggle: (enabled: boolean) => void
  writeArticleRef: React.MutableRefObject<((idx: number, adjustNote?: string) => void) | null>
  scheduleDays: Set<number>
  setScheduleDays: (s: Set<number>) => void
  scheduleSelectedEntries: Set<number> | null
  setScheduleSelectedEntries: (s: Set<number> | null) => void
  stopRequested: boolean
  setStopRequested: (v: boolean) => void
  stopRef: React.MutableRefObject<boolean>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [writing, setWriting] = useState<Set<number>>(new Set())
  const [streamTexts, setStreamTexts] = useState<Record<number, string>>({})
  const [stepLabels, setStepLabels] = useState<Record<number, string>>({})
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())
  const [drawerIdx, setDrawerIdx] = useState<number | null>(null)
  const [drawerViewMode, setDrawerViewMode] = useState<'preview' | 'edit' | 'html' | 'text'>('preview')
  const [drawerHtml, setDrawerHtml] = useState<string>('')
  const [drawerPlainText, setDrawerPlainText] = useState<string>('')
  const [copiedDrawer, setCopiedDrawer] = useState(false)
  const [fetchingHtmlIdx, setFetchingHtmlIdx] = useState<number | null>(null)
  const [showScheduleSettings, setShowScheduleSettings] = useState(false)
  const drawerEditorRef = useRef<HTMLDivElement>(null)

  function getJob(idx: number) { return jobs.find(j => j.entryIdx === idx) }

  // Register writeArticle into parent ref so the scheduler poller can call it
  useEffect(() => {
    writeArticleRef.current = writeArticle
    return () => { writeArticleRef.current = null }
  }) // run every render so closure is always fresh

  // Poll DB every 5s to restore "writing" status after tab switch
  // When user navigates away and back, `writing` state is empty but DB may show WRITING
  useEffect(() => {
    let cancelled = false
    async function pollWritingStatus() {
      if (cancelled) return
      try {
        const res = await fetch(`/api/projects/${project.id}/articles?status=WRITING`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const writingTitles: string[] = (data.articles ?? []).map((a: { title: string }) => a.title)
        if (writingTitles.length === 0) return
        // Find timeline entries that match WRITING articles but aren't in local writing state
        const updated: ArticleJob[] = [...jobs]
        let changed = false
        for (let idx = 0; idx < timeline.length; idx++) {
          const entry = timeline[idx]
          if (!writingTitles.includes(entry.title)) continue
          if (writing.has(idx)) continue // already tracked locally
          const existing = updated.find(j => j.entryIdx === idx)
          if (existing) {
            if (existing.status !== 'writing' && existing.status !== 'cover') {
              const i = updated.indexOf(existing)
              updated[i] = { ...existing, status: 'writing' }
              changed = true
            }
          } else {
            updated.push({
              entryIdx: idx, date: entry.date, keyword: entry.keyword, title: entry.title,
              status: 'writing', html: '', coverImage: '', coverMimeType: 'image/webp',
              midImage: '', midMimeType: 'image/webp', error: '',
            })
            changed = true
          }
        }
        if (changed) setJobs(updated)
      } catch { /* non-fatal */ }
    }
    pollWritingStatus()
    const interval = setInterval(pollWritingStatus, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [project.id, timeline, writing, jobs])

  async function writeArticle(entryIdx: number, adjustNote?: string) {
    const entry = timeline[entryIdx]
    if (!entry) return

    setWriting(prev => new Set(Array.from(prev).concat(entryIdx)))
    setStreamTexts(prev => ({ ...prev, [entryIdx]: '' }))

    const updateJob = (patch: Partial<ArticleJob>) => {
      const rest = jobs.filter((j: ArticleJob) => j.entryIdx !== entryIdx)
      const existing: ArticleJob = jobs.find((j: ArticleJob) => j.entryIdx === entryIdx) ?? {
        entryIdx, date: entry.date, keyword: entry.keyword, title: entry.title,
        status: 'writing' as const, html: '', coverImage: '', coverMimeType: 'image/webp', midImage: '', midMimeType: 'image/webp', error: '',
      }
      setJobs([...rest, { ...existing, ...patch }])
    }

    updateJob({ status: 'writing', html: '', error: '' })
    setStepLabels(prev => ({
      ...prev,
      [entryIdx]: adjustNote ? '🔄 Claude กำลังเขียนใหม่ตาม Adjust...' : '✍️ Claude กำลังเขียนบทความ...',
    }))

    try {
      // SSE streaming — pipeline: write → cover → mid → done
      const res = await fetch('/api/article/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: entry.keyword, title: entry.title, stream: true,
          projectId: project.id,
          ...(entry.keywordId && { keywordId: entry.keywordId }),
          siteName: project.clientName ?? project.name,
          websiteUrl: project.website,
          brandTone: project.brandTone ?? 'professional, helpful',
          styleGuide: project.styleGuide ?? '',
          language: project.language,
          accentColor: project.accentColor ?? '#2563eb',
          theme: project.articleTheme ?? 'professional',
          forbiddenWords: project.forbiddenWords ?? '[]',
          sampleArticle: project.sampleArticle ?? '',
          internalLinks: project.internalLinks ?? '[]',
          cta: parseCta(project.ctaSetting),
          ...(adjustNote?.trim() && { adjustNote: adjustNote.trim() }),
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let html = ''
      let coverImage = ''
      let coverMimeType = 'image/webp'
      let midImage = ''
      let midMimeType = 'image/webp'

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          // each SSE block may have multiple "data:" lines — process each
          for (const rawLine of part.split('\n')) {
            const line = rawLine.replace(/^data:\s*/, '').trim()
            if (!line || line === '[DONE]') continue
            try {
              const evt = JSON.parse(line)
              if (evt.type === 'chunk') {
                html += evt.content
                setStreamTexts(prev => ({ ...prev, [entryIdx]: html }))
              } else if (evt.type === 'status') {
                setStepLabels(prev => ({ ...prev, [entryIdx]: evt.message }))
                if (evt.step === 'cover') updateJob({ status: 'cover' as const })
              } else if (evt.type === 'done') {
                html = evt.html ?? html
                coverImage = evt.coverImage ?? ''
                coverMimeType = evt.coverMimeType ?? 'image/webp'
                midImage = evt.midImage ?? ''
                midMimeType = evt.midMimeType ?? 'image/webp'
              } else if (evt.type === 'error') {
                throw new Error(evt.error)
              }
            } catch (parseErr) {
              // only re-throw if it's our own error type, not malformed SSE
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected token') throw parseErr
            }
          }
        }
      }

      updateJob({ status: 'review', html, coverImage, coverMimeType, midImage, midMimeType })

      const updated = [...timeline]
      updated[entryIdx] = { ...updated[entryIdx], articleStatus: 'review' }
      setTimeline(updated)

      // Auto-open drawer
      setDrawerHtml(html)
      setDrawerViewMode('preview')
      setDrawerIdx(entryIdx)

    } catch (e: unknown) {
      updateJob({ status: 'error', error: String(e) })
    } finally {
      setWriting(prev => { const n = new Set(prev); n.delete(entryIdx); return n })
      setStreamTexts(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
      setStepLabels(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
    }
  }

  const STATUS_ICON: Record<string, React.ReactNode> = {
    pending: <Clock size={12} className="text-gray-400" />,
    writing: <RefreshCw size={12} className="text-blue-500 animate-spin" />,
    cover: <ImageIcon size={12} className="text-purple-500 animate-pulse" />,
    done: <CheckCircle2 size={12} className="text-emerald-500" />,
    review: <Eye size={12} className="text-amber-500" />,
    approved: <CheckCircle2 size={12} className="text-purple-500" />,
    error: <XCircle size={12} className="text-red-500" />,
  }
  const STATUS_LABEL: Record<string, string> = {
    pending: 'รอเขียน', writing: 'กำลังเขียน...', cover: 'สร้างรูป...',
    done: 'เสร็จแล้ว', review: 'รอ Review', approved: 'Approved', error: 'Error',
  }

  function EntryRow({ idx, entry }: { idx: number; entry: TimelineEntry }) {
    const job = getJob(idx)
    const isWriting = writing.has(idx)
    const status = job?.status ?? entry.articleStatus
    const streamText = streamTexts[idx]
    const stepLabel = stepLabels[idx]

    // Author list from project (parsed once per render — small array, no perf issue)
    const authorList: AuthorProfile[] = (() => { try { return JSON.parse(project.authors ?? '[]') } catch { return [] } })()
    const assignedAuthor = authorList.find(a => a.id === entry.assignedAuthorId)
      ?? (authorList.length > 0 ? authorList[0] : null)

    const [authorOpen, setAuthorOpen] = useState(false)
    const authorBtnRef = useRef<HTMLSpanElement>(null)
    const [dropPos, setDropPos] = useState({ top: 0, left: 0 })

    function openAuthorDrop() {
      if (authorBtnRef.current) {
        const r = authorBtnRef.current.getBoundingClientRect()
        setDropPos({ top: r.bottom + 4, left: r.left })
      }
      setAuthorOpen(v => !v)
    }

    async function changeAuthor(authorId: string) {
      setTimeline(timeline.map((e, i) => i === idx ? { ...e, assignedAuthorId: authorId } : e))
      // Persist to DB article if it exists
      try {
        const res = await fetch(`/api/articles/by-title?projectId=${encodeURIComponent(project.id)}&title=${encodeURIComponent(entry.title)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.id) {
            await fetch(`/api/articles/${data.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assignedAuthorId: authorId }),
            })
          }
        }
      } catch { /* non-fatal */ }
    }

    return (
      <div className="border border-gray-200 bg-white rounded-xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 leading-snug">{entry.title}</div>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{entry.keyword}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${entry.priority === 'high' ? 'bg-red-100 text-red-600' : entry.priority === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>{entry.priority}</span>
              {entry.volume > 0
                ? <span className="text-gray-400 font-mono text-[10px]">vol {entry.volume.toLocaleString()}</span>
                : <span className="text-gray-200 text-[10px]">vol —</span>}
              {(entry as any).page_type && (
                <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{(entry as any).page_type}</span>
              )}
              {entry.slug && (
                <span className="text-gray-300 font-mono text-[10px]">/{entry.slug}</span>
              )}
              {/* Author badge + dropdown */}
              {authorList.length > 0 && (
                <span className="relative inline-flex items-center">
                  <span ref={authorBtnRef} onClick={openAuthorDrop}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer select-none ${assignedAuthor ? 'bg-violet-50 text-violet-700 border border-violet-100' : 'bg-gray-100 text-gray-400'}`}>
                    {assignedAuthor?.image && (
                      <img src={assignedAuthor.image} alt={assignedAuthor.name} className="w-3 h-3 rounded-full object-cover" />
                    )}
                    {assignedAuthor ? assignedAuthor.name : 'ยังไม่ได้ assign'}
                    <ChevronDown size={8} />
                  </span>
                  {authorOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setAuthorOpen(false)} />
                      <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
                        className="bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px]">
                        {authorList.map(a => (
                          <button key={a.id} onClick={() => { changeAuthor(a.id); setAuthorOpen(false) }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${a.id === (entry.assignedAuthorId ?? authorList[0]?.id) ? 'bg-violet-50' : ''}`}>
                            {a.image
                              ? <img src={a.image} alt={a.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                              : <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] text-gray-500 shrink-0">{a.name.charAt(0)}</span>
                            }
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-gray-800 truncate">{a.name}</p>
                              <p className="text-[9px] text-gray-400 truncate">{a.title}</p>
                            </div>
                            <span className={`ml-auto text-[8px] px-1 py-0.5 rounded-full shrink-0 ${a.gender === 'male' ? 'bg-blue-100 text-blue-500' : a.gender === 'female' ? 'bg-pink-100 text-pink-500' : 'bg-gray-100 text-gray-400'}`}>
                              {a.gender === 'male' ? 'ชาย' : a.gender === 'female' ? 'หญิง' : 'กลาง'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              {STATUS_ICON[status]}
              {stepLabel && (status === 'writing' || status === 'cover') ? stepLabel : (STATUS_LABEL[status] ?? status)}
            </span>
            {(status === 'writing' || status === 'cover') && (
              <button onClick={() => {
                const currentJob = getJob(idx)
                setDrawerIdx(idx)
                setDrawerViewMode('preview')
                // ถ้ายังไม่มี html สมบูรณ์ ให้ clear เพื่อแสดง loading/stream แทน
                if (!currentJob?.html || writing.has(idx)) setDrawerHtml('')
                else setDrawerHtml(currentJob.html)
              }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                <RefreshCw size={11} className="animate-spin" />
                ดูความคืบหน้า
              </button>
            )}
            {(status === 'pending' || status === 'error') && (
              <button onClick={() => { setDrawerIdx(idx); setDrawerHtml(''); setDrawerViewMode('preview'); writeArticle(idx) }} disabled={isWriting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
                {isWriting ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
                {isWriting ? 'กำลังเขียน...' : 'เขียนบทความ'}
              </button>
            )}
            {(status === 'review' || status === 'done' || status === 'approved') && (
              <button
                disabled={fetchingHtmlIdx === idx}
                onClick={async () => {
                  const j = getJob(idx)
                  if (j?.html) {
                    setDrawerHtml(j.html)
                    setDrawerViewMode('preview')
                    setDrawerIdx(idx)
                    return
                  }
                  // html not in memory — fetch from DB
                  setFetchingHtmlIdx(idx)
                  try {
                    const res = await fetch(`/api/articles/by-title?projectId=${encodeURIComponent(project.id)}&title=${encodeURIComponent(entry.title)}`)
                    if (res.ok) {
                      const data = await res.json()
                      if (data.htmlContent) {
                        const existing: ArticleJob = jobs.find((jj: ArticleJob) => jj.entryIdx === idx) ?? {
                          entryIdx: idx, date: entry.date, keyword: entry.keyword, title: entry.title,
                          status: 'review' as const, html: '', coverImage: '', coverMimeType: 'image/webp', midImage: '', midMimeType: 'image/webp', error: '',
                        }
                        setJobs([...jobs.filter((jj: ArticleJob) => jj.entryIdx !== idx), { ...existing, html: data.htmlContent, status: 'review' as const, ...(data.slug && { slug: data.slug }) }])
                        setDrawerHtml(data.htmlContent)
                        setDrawerViewMode('preview')
                        setDrawerIdx(idx)
                      }
                    }
                  } catch { /* ignore */ } finally {
                    setFetchingHtmlIdx(null)
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-60">
                {fetchingHtmlIdx === idx ? <RefreshCw size={11} className="animate-spin" /> : <Eye size={11} />}
                {fetchingHtmlIdx === idx ? 'กำลังโหลด...' : 'ดู / แก้ไข'}
              </button>
            )}
          </div>
        </div>

        {/* Compact inline status while writing (panel is the main display) */}
        {isWriting && (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <RefreshCw size={11} className="animate-spin" />
              <span className="truncate">{stepLabel ?? 'กำลังเขียน...'}</span>
            </div>
          </div>
        )}

        {job?.error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-600">{job.error}</div>
        )}
      </div>
    )
  }

  if (!timeline.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
        <Calendar size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 text-sm font-medium">ยังไม่มี Project Timeline</p>
        <p className="text-gray-400 text-xs mt-1">ไปที่ tab Content Map แล้ว Generate Timeline ก่อน</p>
      </div>
    )
  }

  // Group by date
  const byDate: Record<string, { dateLabel: string; dayOfWeek: string; entries: { idx: number; entry: TimelineEntry }[] }> = {}
  timeline.forEach((entry, idx) => {
    if (!byDate[entry.date]) byDate[entry.date] = { dateLabel: entry.thaiDate, dayOfWeek: entry.dayOfWeek, entries: [] }
    byDate[entry.date].entries.push({ idx, entry })
  })
  const sortedDates = Object.keys(byDate).sort()

  const done = timeline.filter(e => {
    const j = jobs.find(j2 => j2.entryIdx === timeline.indexOf(e))
    return j?.status === 'review' || j?.status === 'approved' || e.articleStatus === 'approved'
  }).length

  function execDrawerCmd(cmd: string, value?: string) {
    drawerEditorRef.current?.focus()
    document.execCommand(cmd, false, value)
    if (drawerEditorRef.current) setDrawerHtml(drawerEditorRef.current.innerHTML)
  }

  function stripHtml(html: string) {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  }

  const drawerEntry = drawerIdx !== null ? timeline[drawerIdx] : null
  const drawerJob = drawerIdx !== null ? getJob(drawerIdx) : null
  // True if actively writing OR job status says writing (restored after tab switch)
  const isDrawerWriting = drawerIdx !== null && (
    writing.has(drawerIdx) ||
    drawerJob?.status === 'writing' ||
    drawerJob?.status === 'cover'
  )

  return (
    <div className="flex gap-5" style={{ minHeight: 'calc(100vh - 180px)' }}>

      {/* ── LEFT: Article List ── */}
      <div className="flex flex-col gap-2" style={{ width: drawerIdx !== null ? '40%' : '100%', transition: 'width 0.2s ease' }}>
        {/* Summary bar */}
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-5 py-3">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-500">ทั้งหมด <strong className="text-gray-900">{timeline.length}</strong> บทความ</span>
            <span className="text-emerald-600">เสร็จแล้ว <strong>{done}</strong></span>
            <span className="text-gray-400">เหลือ <strong className="text-gray-700">{timeline.length - done}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{sortedDates.length} วันทำงาน</span>
            {/* Stop button — visible when auto is running */}
            {autoSchedule && (
              <button
                onClick={() => { stopRef.current = true; setStopRequested(true); onAutoScheduleToggle(false) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-all"
              >
                ⏹ หยุด
              </button>
            )}
            {/* Settings cog */}
            <button
              onClick={() => setShowScheduleSettings(s => !s)}
              className={`p-1.5 rounded-xl border text-xs transition-all ${showScheduleSettings ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}
              title="ตั้งค่า Auto Schedule"
            >
              ⚙️
            </button>
            {/* Auto-schedule toggle */}
            <button
              onClick={() => { stopRef.current = false; setStopRequested(false); onAutoScheduleToggle(!autoSchedule) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                autoSchedule
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoSchedule ? 'bg-white animate-pulse' : 'bg-gray-300'}`} />
              {autoSchedule ? '⚡ Auto กำลังทำงาน' : 'Auto Schedule'}
            </button>
          </div>
        </div>

        {/* Schedule Settings Panel */}
        {showScheduleSettings && (
          <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 space-y-4">
            <div className="text-sm font-semibold text-gray-800">⚙️ ตั้งค่า Auto Schedule</div>

            {/* Day picker */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">เขียนวันไหนบ้าง</div>
              <div className="flex gap-1.5 flex-wrap">
                {(['อา','จ','อ','พ','พฤ','ศ','ส'] as const).map((label, d) => (
                  <button
                    key={d}
                    onClick={() => {
                      const n = new Set(scheduleDays)
                      n.has(d) ? n.delete(d) : n.add(d)
                      setScheduleDays(n)
                    }}
                    className={`w-9 h-9 rounded-xl text-xs font-bold border transition-all ${scheduleDays.has(d) ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'}`}
                  >{label}</button>
                ))}
                <button
                  onClick={() => setScheduleDays(new Set([0,1,2,3,4,5,6]))}
                  className="px-3 h-9 rounded-xl text-xs font-bold border border-gray-200 text-gray-500 hover:border-gray-400 transition-all"
                >ทุกวัน</button>
                <button
                  onClick={() => setScheduleDays(new Set([1,2,3,4,5]))}
                  className="px-3 h-9 rounded-xl text-xs font-bold border border-gray-200 text-gray-500 hover:border-gray-400 transition-all"
                >จ–ศ</button>
              </div>
            </div>

            {/* Article selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-gray-500">เลือกบทความที่จะรัน Auto</div>
                <button
                  onClick={() => setScheduleSelectedEntries(null)}
                  className="text-[10px] text-blue-600 hover:underline"
                >{scheduleSelectedEntries === null ? '✓ ทั้งหมด (pending)' : 'รีเซ็ต → ทั้งหมด'}</button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {timeline.map((e, idx) => {
                  const j = getJob(idx)
                  const isPending = e.articleStatus === 'pending' && (!j || j.status === 'idle' || j.status === 'error')
                  if (!isPending) return null
                  const selected = scheduleSelectedEntries === null || scheduleSelectedEntries.has(idx)
                  return (
                    <label key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selected ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-transparent hover:border-gray-200'}`}>
                      <input type="checkbox" checked={selected} className="rounded"
                        onChange={() => {
                          if (scheduleSelectedEntries === null) {
                            const all = new Set(timeline.map((_, i) => i).filter(i => {
                              const jj = getJob(i); const ee = timeline[i]
                              return ee.articleStatus === 'pending' && (!jj || jj.status === 'idle' || jj.status === 'error')
                            }))
                            all.delete(idx)
                            setScheduleSelectedEntries(all)
                          } else {
                            const n = new Set(scheduleSelectedEntries)
                            n.has(idx) ? n.delete(idx) : n.add(idx)
                            setScheduleSelectedEntries(n)
                          }
                        }}
                      />
                      <span className="text-xs text-gray-700 truncate flex-1">{e.title}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{e.date}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">
              ระบบจะเขียนเฉพาะวันที่เลือก และเฉพาะบทความ pending ที่ถึงกำหนดวันนั้น (เช็คทุก 5 นาที)
            </div>
          </div>
        )}

        {autoSchedule && (
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Auto กำลังทำงาน · วัน: {['อา','จ','อ','พ','พฤ','ศ','ส'].filter((_, d) => scheduleDays.has(d)).join(' ')} ·
            {scheduleSelectedEntries === null ? ' ทุกบทความ pending' : ` ${scheduleSelectedEntries.size} บทความที่เลือก`}
            {stopRequested && ' · กำลังหยุด...'}
          </div>
        )}

        {/* Grouped by date */}
        <div className="space-y-1 overflow-y-auto flex-1">
        {sortedDates.map(date => {
          const group = byDate[date]
          const isToday = date === today
          const isPast = date < today
          const collapsed = collapsedDates.has(date)
          const groupDone = group.entries.filter(({ idx }) => {
            const j = getJob(idx)
            return j?.status === 'review' || j?.status === 'approved'
          }).length

          return (
            <div key={date} className={`rounded-2xl border overflow-hidden ${isToday ? 'border-blue-300' : isPast ? 'border-gray-100' : 'border-gray-200'}`}>
              <button
                onClick={() => setCollapsedDates(prev => {
                  const n = new Set(prev)
                  n.has(date) ? n.delete(date) : n.add(date)
                  return n
                })}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${isToday ? 'bg-blue-50' : isPast ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50`}>
                <div className={`text-sm font-bold ${isToday ? 'text-blue-700' : isPast ? 'text-gray-400' : 'text-gray-800'}`}>
                  {isToday ? '📌 วันนี้ — ' : ''}{group.dayOfWeek} {group.dateLabel}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-gray-400">{group.entries.length} บทความ</span>
                  {groupDone > 0 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">✅ {groupDone}/{group.entries.length}</span>}
                  <span className="text-gray-400 text-xs">{collapsed ? '▶' : '▼'}</span>
                </div>
              </button>

              {!collapsed && (
                <div className={`divide-y divide-gray-100 ${isToday ? 'bg-blue-50/30' : isPast ? 'bg-gray-50/50' : ''}`}>
                  {group.entries.map(({ idx, entry }) => (
                    <div key={idx} className={`px-3 py-2 ${drawerIdx === idx ? 'bg-blue-50/60' : ''}`}>
                      <EntryRow idx={idx} entry={entry} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        </div>
      </div>

      {/* ── RIGHT: Preview Panel ── */}
      {drawerIdx !== null && (
        <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden" style={{ minWidth: 0 }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 bg-white flex-shrink-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{drawerEntry?.title ?? 'บทความ'}</p>
                <p className="text-xs text-slate-400 truncate">{drawerEntry?.keyword}</p>
              </div>

              {/* View mode switcher */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                {([
                  ['preview', Eye, 'Preview'],
                  ['edit', Edit3, 'Edit'],
                  ['html', Code2, 'HTML'],
                  ['text', FileText, 'Text'],
                ] as const).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    onClick={() => {
                      if (mode === 'edit' && drawerEditorRef.current) {
                        drawerEditorRef.current.innerHTML = drawerHtml
                      }
                      if (mode === 'text') {
                        setDrawerPlainText(stripHtml(drawerHtml))
                      }
                      setDrawerViewMode(mode)
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      drawerViewMode === mode
                        ? mode === 'edit' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Copy button */}
              <button
                onClick={() => {
                  const text = drawerViewMode === 'text'
                    ? drawerPlainText
                    : drawerViewMode === 'html'
                      ? drawerHtml
                      : drawerViewMode === 'edit'
                        ? (drawerEditorRef.current?.innerHTML ?? drawerHtml)
                        : drawerHtml
                  navigator.clipboard.writeText(text)
                  setCopiedDrawer(true)
                  setTimeout(() => setCopiedDrawer(false), 2000)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
              >
                {copiedDrawer ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                {copiedDrawer ? 'Copied' : 'Copy'}
              </button>

              {/* Download images */}
              {drawerJob?.coverImage && (
                <div className="flex items-center gap-1">
                  <a
                    href={`data:${drawerJob.coverMimeType || 'image/webp'};base64,${drawerJob.coverImage}`}
                    download={`cover-${drawerEntry?.keyword?.replace(/\s+/g, '-') ?? 'image'}.webp`}
                    title="ดาวน์โหลดรูปปก"
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
                  >
                    <Download size={11} /> Cover
                  </a>
                  {drawerJob.midImage && (
                    <a
                      href={`data:${drawerJob.midMimeType || 'image/webp'};base64,${drawerJob.midImage}`}
                      download={`mid-${drawerEntry?.keyword?.replace(/\s+/g, '-') ?? 'image'}.webp`}
                      title="ดาวน์โหลดรูปประกอบ"
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
                    >
                      <Download size={11} /> Mid
                    </a>
                  )}
                </div>
              )}

              {/* Close */}
              <button
                onClick={() => setDrawerIdx(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Formatting toolbar — edit mode only */}
            {drawerViewMode === 'edit' && (
              <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-orange-100 bg-orange-50 flex-shrink-0">
                {[
                  { icon: Bold, title: 'Bold', cmd: 'bold' },
                  { icon: Italic, title: 'Italic', cmd: 'italic' },
                ].map(({ icon: Icon, title, cmd }) => (
                  <button key={cmd} title={title} onMouseDown={e => { e.preventDefault(); execDrawerCmd(cmd) }}
                    className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                    <Icon size={14} />
                  </button>
                ))}
                <div className="w-px h-4 bg-orange-200 mx-1" />
                {[
                  { label: 'H1', tag: 'h1' }, { label: 'H2', tag: 'h2' },
                  { label: 'H3', tag: 'h3' }, { label: 'P', tag: 'p' },
                ].map(({ label, tag }) => (
                  <button key={tag} onMouseDown={e => { e.preventDefault(); execDrawerCmd('formatBlock', tag) }}
                    className="px-2 py-1 rounded text-xs font-semibold hover:bg-orange-200 text-slate-700 transition-colors">
                    {label}
                  </button>
                ))}
                <div className="w-px h-4 bg-orange-200 mx-1" />
                <button onMouseDown={e => { e.preventDefault(); execDrawerCmd('insertUnorderedList') }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <List size={14} />
                </button>
                <button onMouseDown={e => { e.preventDefault(); execDrawerCmd('insertOrderedList') }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <AlignLeft size={14} />
                </button>
                <button onMouseDown={e => { e.preventDefault(); execDrawerCmd('insertHorizontalRule') }}
                  className="p-1.5 rounded hover:bg-orange-200 text-slate-700 transition-colors">
                  <Minus size={14} />
                </button>
                <div className="w-px h-4 bg-orange-200 mx-1" />
                <button onMouseDown={e => { e.preventDefault(); execDrawerCmd('undo') }}
                  className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700">↩</button>
                <button onMouseDown={e => { e.preventDefault(); execDrawerCmd('redo') }}
                  className="px-2 py-1 rounded text-xs font-mono hover:bg-orange-200 text-slate-700">↪</button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-orange-500 font-medium">กำลังแก้ไข — คลิกเพื่อพิมพ์ได้เลย</span>
                  <button
                    onClick={() => {
                      if (drawerEditorRef.current) {
                        const newHtml = drawerEditorRef.current.innerHTML
                        setDrawerHtml(newHtml)
                        // sync back to job
                        if (drawerIdx !== null) {
                          const existing = jobs.find(j => j.entryIdx === drawerIdx)
                          if (existing) {
                            setJobs([...jobs.filter(j => j.entryIdx !== drawerIdx), { ...existing, html: newHtml }])
                          }
                        }
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors"
                  >
                    <Check size={11} /> บันทึก
                  </button>
                </div>
              </div>
            )}

            {/* Cover image (if available) */}
            {drawerJob?.coverImage && drawerViewMode === 'preview' && (
              <div className="flex-shrink-0 px-5 pt-4 pb-0">
                <img
                  src={`data:${drawerJob.coverMimeType || 'image/webp'};base64,${drawerJob.coverImage}`}
                  alt="cover"
                  className="w-full rounded-xl overflow-hidden border border-gray-100 shadow-sm object-cover"
                  style={{ maxHeight: '200px' }}
                />
              </div>
            )}

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* While writing: show live stream (takes full priority) */}
              {isDrawerWriting && (
                <>
                  {!(streamTexts[drawerIdx ?? -1]?.trim()) ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                      <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full animate-pulse w-3/4" />
                      </div>
                      <p className="text-slate-500 text-sm">Claude กำลังเขียนบทความ...</p>
                      <p className="text-slate-400 text-xs">SEO Master Prompt · อาจใช้เวลา 3–8 นาที (prompt ขนาดใหญ่)</p>
                      <p className="text-slate-300 text-[11px]">กรุณารอ — ห้ามปิดหน้าต่าง</p>
                    </div>
                  ) : (
                    <div
                      className="bg-white border border-blue-100 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm"
                      dangerouslySetInnerHTML={{ __html: streamTexts[drawerIdx ?? -1] }}
                    />
                  )}
                </>
              )}
              {drawerViewMode === 'preview' && !isDrawerWriting && (
                <div
                  className="bg-white border border-gray-100 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm"
                  dangerouslySetInnerHTML={{ __html: drawerHtml }}
                />
              )}
              {drawerViewMode === 'edit' && !isDrawerWriting && (
                <div
                  ref={drawerEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => {
                    if (drawerEditorRef.current) setDrawerHtml(drawerEditorRef.current.innerHTML)
                  }}
                  className="bg-white border-2 border-orange-200 rounded-xl p-8 text-slate-800 prose prose-lg max-w-none shadow-sm outline-none focus:border-orange-400 min-h-[400px]"
                  dangerouslySetInnerHTML={{ __html: drawerHtml }}
                />
              )}
              {drawerViewMode === 'html' && !isDrawerWriting && (
                <pre className="bg-slate-900 border border-gray-100 rounded-xl p-4 text-xs text-green-300 overflow-x-auto leading-relaxed whitespace-pre-wrap font-mono">
                  {drawerHtml}
                </pre>
              )}
              {drawerViewMode === 'text' && (
                <div className="flex flex-col gap-3 h-full">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">แก้ไขข้อความได้เลย — ระบบจะแปลงกลับเป็น HTML ให้อัตโนมัติ</p>
                    <button
                      onClick={() => {
                        const lines = drawerPlainText.split('\n')
                        const html = lines.map(line => {
                          const t = line.trim()
                          if (!t) return ''
                          if (t.startsWith('# ')) return `<h1>${t.slice(2)}</h1>`
                          if (t.startsWith('## ')) return `<h2>${t.slice(3)}</h2>`
                          if (t.startsWith('### ')) return `<h3>${t.slice(4)}</h3>`
                          if (t.startsWith('- ') || t.startsWith('* ')) return `<li>${t.slice(2)}</li>`
                          return `<p>${t}</p>`
                        }).join('\n').replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
                        setDrawerHtml(html)
                        if (drawerIdx !== null) {
                          const existing = jobs.find(j => j.entryIdx === drawerIdx)
                          if (existing) setJobs([...jobs.filter(j => j.entryIdx !== drawerIdx), { ...existing, html }])
                        }
                        setDrawerViewMode('preview')
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                    >
                      <Check size={11} /> Apply → Preview
                    </button>
                  </div>
                  <textarea
                    value={drawerPlainText}
                    onChange={e => setDrawerPlainText(e.target.value)}
                    className="flex-1 w-full bg-gray-50 border border-gray-200 rounded-xl p-5 text-slate-700 text-sm leading-relaxed font-mono resize-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 min-h-[500px]"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

          {/* Streaming indicator inside panel (shown while writing) */}
          {isDrawerWriting && (
            <div className="flex-shrink-0 px-5 py-3 border-t border-blue-100 bg-blue-50">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {(['✍️ เขียน', '🖼️ สร้างรูป (Gemini)'] as const).map((step, i) => {
                    const coverStarted = getJob(drawerIdx)?.status === 'cover'
                    const active = (i === 0 && !coverStarted) || (i === 1 && coverStarted)
                    const done2 = i === 0 && coverStarted
                    return (
                      <div key={step} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${done2 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : active ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-400'}`}>
                        {done2 ? '✓' : active ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" /> : <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />}
                        {step}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-blue-700 font-medium truncate flex-1">{stepLabels[drawerIdx] ?? 'กำลังประมวลผล...'}</p>
                <RefreshCw size={12} className="text-blue-400 animate-spin shrink-0" />
              </div>
              {streamTexts[drawerIdx] && (
                <p className="text-[10px] text-slate-400 truncate mt-1.5 font-mono">
                  {streamTexts[drawerIdx].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-150)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Review Tab ───────────────────────────────────────────────────────────────

interface ReviewComment { id: string; body: string; createdAt: string; user: { name: string | null; role: string } }

function ReviewTab({ project, timeline, setTimeline, jobs, onAdjustRewrite }: {
  project: ProjectData
  timeline: TimelineEntry[]
  setTimeline: (t: TimelineEntry[]) => void
  jobs: ArticleJob[]
  onAdjustRewrite: (entryIdx: number, note: string) => void
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loadingHtml, setLoadingHtml] = useState<number | null>(null)
  const [localJobHtml, setLocalJobHtml] = useState<Record<number, string>>({})
  // articleId cache: title → DB article id
  const [articleIds, setArticleIds] = useState<Record<number, string>>({})
  // comments per entryIdx loaded from DB
  const [comments, setComments] = useState<Record<number, ReviewComment[]>>({})
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({})
  const [savingComment, setSavingComment] = useState<Record<number, boolean>>({})
  const [rewriting, setRewriting] = useState<Record<number, boolean>>({})

  const reviewEntries: { entryIdx: number; entry: TimelineEntry; job: ArticleJob | undefined }[] = []
  timeline.forEach((entry, entryIdx) => {
    const job = jobs.find(j => j.entryIdx === entryIdx)
    const inReview = job?.status === 'review' || job?.status === 'approved' || entry.articleStatus === 'review' || entry.articleStatus === 'approved'
    if (inReview) reviewEntries.push({ entryIdx, entry, job })
  })

  async function fetchArticle(entryIdx: number, entry: TimelineEntry): Promise<{ id: string; htmlContent: string; comments: ReviewComment[] } | null> {
    try {
      const res = await fetch(`/api/articles/by-title?projectId=${encodeURIComponent(project.id)}&title=${encodeURIComponent(entry.title)}`)
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  async function expand(entryIdx: number, entry: TimelineEntry) {
    if (expanded === entryIdx) { setExpanded(null); return }
    setLoadingHtml(entryIdx)
    try {
      const data = await fetchArticle(entryIdx, entry)
      if (data) {
        if (data.id) setArticleIds(prev => ({ ...prev, [entryIdx]: data.id }))
        if (data.htmlContent) setLocalJobHtml(prev => ({ ...prev, [entryIdx]: data.htmlContent }))
        if (data.comments) setComments(prev => ({ ...prev, [entryIdx]: data.comments }))
      }
    } finally {
      setLoadingHtml(null)
      setExpanded(entryIdx)
    }
  }

  function approve(entryIdx: number) {
    const updated = [...timeline]
    updated[entryIdx] = { ...updated[entryIdx], articleStatus: 'approved' }
    setTimeline(updated)
  }

  async function saveComment(entryIdx: number, entry: TimelineEntry) {
    const body = (commentDraft[entryIdx] ?? '').trim()
    if (!body) return
    setSavingComment(prev => ({ ...prev, [entryIdx]: true }))
    try {
      // ensure we have articleId — fetch from DB if not cached
      let artId = articleIds[entryIdx]
      if (!artId) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) {
          artId = data.id
          setArticleIds(prev => ({ ...prev, [entryIdx]: data.id }))
        }
        if (data?.comments) setComments(prev => ({ ...prev, [entryIdx]: data.comments }))
      }
      if (!artId) {
        alert('ไม่พบบทความใน DB — กรุณาสร้างบทความก่อนส่ง Comment')
        return
      }
      const res = await fetch(`/api/articles/${artId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const newComment = await res.json()
        setComments(prev => ({ ...prev, [entryIdx]: [...(prev[entryIdx] ?? []), newComment] }))
        setCommentDraft(prev => ({ ...prev, [entryIdx]: '' }))
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`บันทึก Comment ไม่สำเร็จ: ${err?.error ?? res.status}`)
      }
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${String(e)}`)
    } finally {
      setSavingComment(prev => ({ ...prev, [entryIdx]: false }))
    }
  }

  async function rewriteWithComments(entryIdx: number, entry: TimelineEntry) {
    const allComments = comments[entryIdx] ?? []
    if (!allComments.length && !(commentDraft[entryIdx] ?? '').trim()) return
    // Save draft comment first if any
    const draft = (commentDraft[entryIdx] ?? '').trim()
    if (draft) await saveComment(entryIdx, entry)
    // Build combined note from all comments
    const latestComments = (comments[entryIdx] ?? [])
    const note = latestComments.map((c, i) => `[Comment ${i + 1}] ${c.body}`).join('\n')
    setRewriting(prev => ({ ...prev, [entryIdx]: true }))
    setExpanded(null)
    onAdjustRewrite(entryIdx, note)
    setTimeout(() => setRewriting(prev => ({ ...prev, [entryIdx]: false })), 3000)
  }

  if (!reviewEntries.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
        <CheckCircle2 size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 text-sm font-medium">ยังไม่มีบทความรอ Review</p>
        <p className="text-gray-400 text-xs mt-1">เมื่อเขียนบทความเสร็จจากหน้า Articles บทความจะมาปรากฏที่นี่</p>
      </div>
    )
  }

  const pendingCount  = reviewEntries.filter(({ entry, job }) => !(entry.articleStatus === 'approved' || job?.status === 'approved')).length
  const approvedCount = reviewEntries.length - pendingCount

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-500" />
          <span><strong>{pendingCount}</strong> รอ Review</span>
        </div>
        {approvedCount > 0 && (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={14} />
            <span><strong>{approvedCount}</strong> Approved แล้ว</span>
          </div>
        )}
      </div>

      {reviewEntries.map(({ entryIdx, entry, job }) => {
        const isApproved = entry.articleStatus === 'approved' || job?.status === 'approved'
        const html = job?.html || localJobHtml[entryIdx] || ''
        const entryComments = comments[entryIdx] ?? []
        const hasComments = entryComments.length > 0

        return (
          <div key={entryIdx} className={`border rounded-2xl overflow-hidden ${isApproved ? 'border-emerald-200 bg-emerald-50/20' : hasComments ? 'border-rose-200 bg-rose-50/10' : 'border-amber-200 bg-amber-50/10'}`}>
            {/* Row header */}
            <div className="px-5 py-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-gray-400">{entry.date}</span>
                  {isApproved && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✅ Approved</span>}
                  {hasComments && !isApproved && (
                    <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">
                      💬 {entryComments.length} Comment{entryComments.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-gray-900">{entry.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{entry.keyword}</p>
                {/* Latest comment preview */}
                {hasComments && !isApproved && (
                  <p className="text-xs text-rose-600 mt-1.5 italic line-clamp-1">
                    💬 {entryComments[entryComments.length - 1].body}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* ดู button */}
                <button
                  disabled={loadingHtml === entryIdx}
                  onClick={() => expand(entryIdx, entry)}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60">
                  {loadingHtml === entryIdx ? '⏳' : expanded === entryIdx ? 'ซ่อน' : 'ดู'}
                </button>
                {/* Approve button */}
                {!isApproved && (
                  <button onClick={() => approve(entryIdx)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-500 transition-colors">
                    <CheckCircle2 size={12} /> Approve
                  </button>
                )}
              </div>
            </div>

            {/* Expanded panel */}
            {expanded === entryIdx && (
              <div className="border-t border-gray-200 p-5 space-y-5">

                {/* Article preview */}
                {html ? (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-2">📄 บทความ</div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 prose prose-sm max-w-none max-h-[60vh] overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">ยังไม่มี HTML ของบทความนี้</p>
                )}

                {/* Comment history */}
                {hasComments && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-2">💬 ประวัติ Comment ({entryComments.length} รอบ)</div>
                    <div className="space-y-2">
                      {entryComments.map((c, i) => (
                        <div key={c.id} className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-rose-600">Comment รอบที่ {i + 1}</span>
                            <span className="text-[10px] text-gray-400">{c.user?.name ?? 'ทีม'}</span>
                            <span className="text-[10px] text-gray-300 ml-auto">{new Date(c.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add comment + actions */}
                {!isApproved && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                        💬 {hasComments ? `เพิ่ม Comment รอบที่ ${entryComments.length + 1}` : 'เพิ่ม Comment'}
                      </label>
                      <textarea
                        value={commentDraft[entryIdx] ?? ''}
                        onChange={e => setCommentDraft(prev => ({ ...prev, [entryIdx]: e.target.value }))}
                        placeholder="ระบุสิ่งที่ต้องแก้ไข... comment จะถูกบันทึกไว้ในบทความและใช้เป็น instruction ในการ regenerate"
                        rows={3}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-200 resize-none"
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {/* Approve */}
                      <button onClick={() => approve(entryIdx)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-500 transition-colors">
                        <CheckCircle2 size={12} /> Approve
                      </button>
                      {/* Save comment only */}
                      <button
                        disabled={!(commentDraft[entryIdx] ?? '').trim() || savingComment[entryIdx]}
                        onClick={() => saveComment(entryIdx, entry)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50 disabled:opacity-40 transition-colors">
                        {savingComment[entryIdx] ? <RefreshCw size={12} className="animate-spin" /> : null}
                        บันทึก Comment
                      </button>
                      {/* Rewrite with all comments */}
                      <button
                        disabled={(!hasComments && !(commentDraft[entryIdx] ?? '').trim()) || rewriting[entryIdx]}
                        onClick={() => rewriteWithComments(entryIdx, entry)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors">
                        {rewriting[entryIdx] ? <RefreshCw size={12} className="animate-spin" /> : null}
                        🔄 เขียนใหม่ตาม Comment{entryComments.length > 0 ? ` (${entryComments.length + (commentDraft[entryIdx]?.trim() ? 1 : 0)} รอบ)` : ''}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Article Lab Tab ──────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { id: '#2563eb', label: 'Blue' },
  { id: '#16a34a', label: 'Green' },
  { id: '#dc2626', label: 'Red' },
  { id: '#9333ea', label: 'Purple' },
  { id: '#ea580c', label: 'Orange' },
  { id: '#0891b2', label: 'Cyan' },
  { id: '#be185d', label: 'Pink' },
  { id: '#1c1c1c', label: 'Black' },
  { id: '#ca8a04', label: 'Gold' },
  { id: '#0f766e', label: 'Teal' },
  { id: '#7c3aed', label: 'Violet' },
  { id: '#c2410c', label: 'Rust' },
]

// Default style guide — ใช้เป็น fallback เมื่อ client ยังไม่ได้กำหนด style
const DEFAULT_STYLE_GUIDE = `## Tone & Voice
- เป็นกันเอง ให้ข้อมูล ตรงประเด็น ไม่เยิ่นเย้อ
- ใช้ภาษาไทยที่อ่านง่าย เข้าใจได้ทันที
- หลีกเลี่ยงภาษาวิชาการหนัก ๆ เว้นแต่จำเป็น

## Article Structure
- เริ่มด้วย Short Answer 2-3 บรรทัดก่อน H2 แรก
- H2 แต่ละหัวข้อไม่เกิน 3 ย่อหน้า
- มีตารางหรือ checklist อย่างน้อย 1 รายการ
- FAQ อย่างน้อย 5 ข้อ ใช้ <details><summary>

## Style
- Article Mode: minimal_article
- ใช้ .cc-article wrapper
- ตารางทุกตารางอยู่ใน .cc-table-wrap
- CSS scoped ภายใต้ .cc-article เท่านั้น
- ไม่มี Hero section / CTA แบบ hard sell เว้นแต่ระบุ

## Content Rules
- ห้ามเดาหมายเลขโทรศัพท์ อีเมล LINE ID
- ห้ามใช้คำ: ดีที่สุด, อันดับ 1, รับประกัน (เว้นแต่มีหลักฐาน)
- ใส่ Internal Links ตามรายการที่ระบุในส่วน INTERNAL LINKS
`

const THEMES = [
  { id: 'professional', label: 'Professional', desc: 'เรียบ น่าเชื่อถือ ทางการ' },
  { id: 'modern', label: 'Modern', desc: 'ทันสมัย clean minimalist' },
  { id: 'warm', label: 'Warm', desc: 'อบอุ่น เป็นมิตร lifestyle' },
  { id: 'bold', label: 'Bold', desc: 'โดดเด่น กล้า สะดุดตา' },
  { id: 'minimal', label: 'Minimal', desc: 'เรียบง่าย ข้อมูลชัด' },
  { id: 'editorial', label: 'Editorial', desc: 'สไตล์นิตยสาร longform' },
]

interface InternalLink { keyword: string; url: string }

interface CtaChannel {
  type: 'line' | 'facebook' | 'phone' | 'email' | 'website' | 'form' | 'custom'
  label: string
  value: string
  icon?: string
  imageUrl?: string  // uploaded image/logo for button widget
  buttonStyle?: 'filled' | 'outline' | 'ghost'
}
interface CtaSettings {
  enabled: boolean
  headline: string
  subtext: string
  channels: CtaChannel[]
  alignment: 'left' | 'center' | 'right'
  buttonLayout: 'row' | 'column'
}
const CTA_CHANNEL_OPTS: { type: CtaChannel['type']; icon: string; placeholder: string; defaultLabel: string }[] = [
  { type: 'line',     icon: '💬', placeholder: 'https://line.me/ti/p/~...', defaultLabel: 'Line' },
  { type: 'facebook', icon: '📘', placeholder: 'https://fb.me/...',          defaultLabel: 'Facebook' },
  { type: 'phone',    icon: '📞', placeholder: '02-xxx-xxxx',                defaultLabel: 'Phone' },
  { type: 'email',    icon: '✉️', placeholder: 'contact@example.com',       defaultLabel: 'Email' },
  { type: 'website',  icon: '🌐', placeholder: 'https://example.com/contact',defaultLabel: 'Website' },
  { type: 'form',     icon: '📋', placeholder: 'https://example.com/form',   defaultLabel: 'Form' },
  { type: 'custom',   icon: '⭐', placeholder: 'ข้อความหรือลิงก์',           defaultLabel: 'ติดต่อเรา' },
]
const DEFAULT_CTA: CtaSettings = {
  enabled: false,
  headline: 'สนใจปรึกษาฟรี?',
  subtext: 'ทีมงานพร้อมตอบทุกคำถาม',
  channels: [],
  alignment: 'center',
  buttonLayout: 'row',
}
function parseCta(raw?: string): CtaSettings {
  try { return raw ? { ...DEFAULT_CTA, ...JSON.parse(raw) } : DEFAULT_CTA } catch { return DEFAULT_CTA }
}

function LabTab({ project, onSaved, keywordRows = [] }: { project: ProjectData; onSaved: (updated: Partial<ProjectData>) => void; keywordRows?: KeywordRow[] }) {
  // Style settings
  const [styleGuide, setStyleGuide] = useState(project.styleGuide ?? DEFAULT_STYLE_GUIDE)
  const [accentColor, setAccentColor] = useState(project.accentColor ?? '#2563eb')
  const [theme, setTheme] = useState(project.articleTheme ?? 'professional')
  const [forbiddenWords, setForbiddenWords] = useState(() => {
    try { return JSON.parse(project.forbiddenWords ?? '[]').join('\n') } catch { return '' }
  })
  const [internalLinksText, setInternalLinksText] = useState(() => {
    try {
      const links: InternalLink[] = JSON.parse(project.internalLinks ?? '[]')
      return links.map(l => `${l.keyword} | ${l.url}`).join('\n')
    } catch { return '' }
  })
  const [cta, setCta] = useState<CtaSettings>(() => parseCta(project.ctaSetting))
  const [authorEnabled, setAuthorEnabled] = useState(project.authorEnabled ?? false)
  const [authors, setAuthors] = useState<AuthorProfile[]>(() => {
    try { return JSON.parse(project.authors ?? '[]') } catch { return [] }
  })
  const styleFileRef = useRef<HTMLInputElement>(null)
  const linkFileRef = useRef<HTMLInputElement>(null)
  const authorImageRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Article lab settings
  const [keyword, setKeyword] = useState('')
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState(project.sampleArticle ?? '')
  const [coverImageLab, setCoverImageLab] = useState('')
  const [coverMimeTypeLab, setCoverMimeTypeLab] = useState('image/webp')
  const [midImageLab, setMidImageLab] = useState('')
  const [midMimeTypeLab, setMidMimeTypeLab] = useState('image/webp')
  const [streamText, setStreamText] = useState('')
  const [stepMsg, setStepMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview' | 'cover'>('preview')

  // Save state
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function loadStyleMd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setStyleGuide(ev.target?.result as string ?? '')
    reader.readAsText(file)
  }

  function loadLinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string ?? ''
      // support CSV: keyword,url  OR  keyword | url  OR  keyword\turl
      const lines = text.trim().split('\n').filter(l => l.trim())
      const parsed = lines.map(line => {
        const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : ','
        const parts = line.split(sep).map(p => p.trim())
        return parts.length >= 2 ? `${parts[0]} | ${parts[1]}` : line.trim()
      })
      setInternalLinksText(parsed.join('\n'))
    }
    reader.readAsText(file)
  }

  function parseInternalLinks(): InternalLink[] {
    return internalLinksText.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf('|')
        if (idx > 0) return { keyword: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() }
        return null
      })
      .filter(Boolean) as InternalLink[]
  }

  async function generate() {
    if (!keyword.trim() || !title.trim()) return
    setLoading(true)
    setStreamText('')
    setStepMsg('')
    setHtml('')
    setCoverImageLab('')
    setMidImageLab('')
    try {
      const internalLinks = parseInternalLinks()
      const res = await fetch('/api/article/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword, title, stream: true,
          projectId: project.id,
          siteName: project.clientName ?? project.name,
          websiteUrl: project.website,
          brandTone: project.brandTone ?? 'professional, helpful',
          styleGuide,
          language: project.language,
          accentColor,
          theme,
          forbiddenWords: JSON.stringify(forbiddenWords.split('\n').map((w: string) => w.trim()).filter(Boolean)),
          sampleArticle: project.sampleArticle ?? '',
          internalLinks: JSON.stringify(internalLinks),
          cta,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let fullHtml = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '')
          if (!line) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'chunk') { fullHtml += evt.content; setStreamText(fullHtml) }
            else if (evt.type === 'status') { setStepMsg(evt.message) }
            else if (evt.type === 'done') {
              fullHtml = evt.html ?? fullHtml
              setHtml(fullHtml)
              setStreamText('')
              setStepMsg('')
              if (evt.coverImage) { setCoverImageLab(evt.coverImage); setCoverMimeTypeLab(evt.coverMimeType ?? 'image/webp'); setViewMode('cover') }
              if (evt.midImage) { setMidImageLab(evt.midImage); setMidMimeTypeLab(evt.midMimeType ?? 'image/webp') }
            }
            else if (evt.type === 'error') throw new Error(evt.error)
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setStreamText(`❌ Error: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function saveAll() {
    setSaving(true)
    try {
      const words = forbiddenWords.split('\n').map((w: string) => w.trim()).filter(Boolean)
      const links = parseInternalLinks()
      const body: Record<string, unknown> = {
        styleGuide,
        accentColor,
        articleTheme: theme,
        forbiddenWords: JSON.stringify(words),
        internalLinks: JSON.stringify(links),
        ctaSetting: JSON.stringify(cta),
        authorEnabled,
        authors,
      }
      if (html) body.sampleArticle = html
      const res = await fetch(`/api/projects/${project.id}/style`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved({
        styleGuide,
        accentColor,
        articleTheme: theme,
        forbiddenWords: JSON.stringify(words),
        internalLinks: JSON.stringify(links),
        ctaSetting: JSON.stringify(cta),
        authorEnabled,
        authors: JSON.stringify(authors),
        ...(html ? { sampleArticle: html } : {}),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  // ── Internal Link state — 3 separate tables ──────
  // ilGscLinks: fetched from GSC (read-only preview, user can exclude)
  // ilKwLinks:  fetched from Keywords (read-only preview, user can exclude)
  // ilManualLinks: user-added rows
  const [ilGscLinks, setIlGscLinks] = useState<InternalLink[]>([])
  const [ilKwLinks, setIlKwLinks] = useState<InternalLink[]>([])
  const [ilManualLinks, setIlManualLinks] = useState<InternalLink[]>(() => {
    try { return JSON.parse(project.internalLinks ?? '[]') } catch { return [] }
  })
  const [ilExcluded, setIlExcluded] = useState<Set<string>>(new Set())
  const [ilLinksPerArticle, setIlLinksPerArticle] = useState<string>(() => {
    try {
      const p = (project as { linksPerArticle?: string | number }).linksPerArticle
      return p ? String(p) : '3-5'
    } catch { return '3-5' }
  })
  const [ilGscLoading, setIlGscLoading] = useState(false)
  const [ilKwLoading, setIlKwLoading] = useState(false)
  const [ilSaving, setIlSaving] = useState(false)
  const [ilSaved, setIlSaved] = useState(false)
  const [ilGscFetched, setIlGscFetched] = useState(false)
  const [ilGscProperties, setIlGscProperties] = useState<string[]>([])
  const [ilGscSelected, setIlGscSelected] = useState<string>(project.gscSiteUrl ?? '')

  function ilManualAdd() {
    setIlManualLinks(prev => [...prev, { keyword: '', url: '' }])
  }
  function ilManualRemove(i: number) {
    setIlManualLinks(prev => prev.filter((_, j) => j !== i))
  }
  function ilManualUpdate(i: number, field: 'keyword' | 'url', val: string) {
    setIlManualLinks(prev => prev.map((l, j) => j === i ? { ...l, [field]: val } : l))
  }
  function ilToggleExclude(url: string) {
    setIlExcluded(prev => { const s = new Set(prev); s.has(url) ? s.delete(url) : s.add(url); return s })
  }

  // merged = GSC (non-excluded) + Keywords (non-excluded) + Manual
  function ilMerged(): InternalLink[] {
    const seen = new Set<string>()
    const out: InternalLink[] = []
    for (const l of [...ilGscLinks, ...ilKwLinks, ...ilManualLinks]) {
      if (!l.url.trim()) continue
      if (ilExcluded.has(l.url)) continue
      if (seen.has(l.url)) continue
      seen.add(l.url)
      out.push(l)
    }
    return out
  }

  async function ilFetchGscProperties() {
    try {
      const res = await fetch(`/api/projects/${project.id}/sitelinks?source=properties`)
      if (res.ok) {
        const data = await res.json() as { properties: string[] }
        const props = data.properties ?? []
        setIlGscProperties(props)
        if (props.length > 0 && !ilGscSelected) setIlGscSelected(props[0])
      }
    } catch { /* skip */ }
  }

  async function ilFetchGsc(siteUrl?: string) {
    setIlGscLoading(true)
    const url = siteUrl ?? ilGscSelected ?? project.gscSiteUrl ?? ''
    try {
      const res = await fetch(`/api/projects/${project.id}/sitelinks?source=gsc${url ? `&siteUrl=${encodeURIComponent(url)}` : ''}`)
      if (res.ok) {
        const data = await res.json() as { links: InternalLink[] }
        setIlGscLinks((data.links ?? []).filter(l => l.url))
        setIlGscFetched(true)
      }
    } catch { /* skip */ } finally {
      setIlGscLoading(false)
    }
  }

  async function ilFetchKeywords() {
    setIlKwLoading(true)
    try {
      const rawBase = ilGscSelected || project.website || ''
      const base = rawBase.replace(/\/$/, '')

      // Source of keywords: keywordRows prop (AI Keyword Research, up to thousands of entries)
      // NOT the Keyword table which only has manually-researched ones (usually small)
      const sourceRows = keywordRows.length > 0 ? keywordRows : []

      if (sourceRows.length === 0) {
        // Fallback: try keywords-cache endpoint if state not loaded yet
        const cacheRes = await fetch(`/api/projects/${project.id}/keywords-cache`)
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json() as { keywordRows?: KeywordRow[] }
          const cached = cacheData.keywordRows ?? []
          if (cached.length > 0) {
            const incoming: InternalLink[] = cached
              .filter(k => k.keyword?.trim())
              .map(k => {
                const slug = k.keyword.toLowerCase().trim()
                  .replace(/\s+/g, '-')
                  .replace(/[^a-z0-9ก-๙-]/g, '')
                return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
              })
            setIlKwLinks(incoming)
            return
          }
        }
        // Final fallback: Keyword table (manually-researched)
        const kwRes = await fetch(`/api/keywords?projectId=${project.id}`)
        if (!kwRes.ok) return
        const kws = await kwRes.json() as { keyword: string; id: string }[]
        const incoming: InternalLink[] = kws
          .filter((k: { keyword: string; id: string }) => k.keyword?.trim())
          .map((k: { keyword: string; id: string }) => {
            const slug = k.keyword.toLowerCase().trim()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9ก-๙-]/g, '')
            return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
          })
        setIlKwLinks(incoming)
        return
      }

      // Main path: use keywordRows state (already loaded, up to 2739+)
      const incoming: InternalLink[] = sourceRows
        .filter(k => k.keyword?.trim())
        .map(k => {
          const slug = k.keyword.toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9ก-๙-]/g, '')
          return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
        })
      setIlKwLinks(incoming)
    } catch (e) {
      console.error('[ilFetchKeywords]', e)
    } finally {
      setIlKwLoading(false)
    }
  }

  async function ilSave() {
    setIlSaving(true)
    const merged = ilMerged()
    try {
      const payload = JSON.stringify(merged)
      const res = await fetch(`/api/projects/${project.id}/style`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalLinks: payload, linksPerArticle: ilLinksPerArticle, gscSiteUrl: ilGscSelected || undefined }),
      })
      if (res.ok) {
        setInternalLinksText(merged.map(l => `${l.keyword} | ${l.url}`).join('\n'))
        onSaved({ internalLinks: payload })
        setIlSaved(true)
        setTimeout(() => setIlSaved(false), 2500)
      }
    } finally {
      setIlSaving(false)
    }
  }

  // ── Lab sub-tab state ──────────────────────────────
  const [labSubTab, setLabSubTab] = useState<'style' | 'cta' | 'author' | 'sitelink'>('style')

  const LAB_SUBTABS = [
    { id: 'style' as const,    label: 'Style',    icon: '🎨' },
    { id: 'cta' as const,      label: 'CTA',      icon: '📣' },
    { id: 'author' as const,   label: 'Author',   icon: '👤' },
    { id: 'sitelink' as const, label: 'Internal Link', icon: '🔗' },
  ]

  return (
    <div className="space-y-0">
      {/* ── Sub-tab bar ─────────────────────────────── */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100 rounded-2xl p-1 w-fit">
        {LAB_SUBTABS.map(t => (
          <button key={t.id} onClick={() => {
            setLabSubTab(t.id)
            if (t.id === 'sitelink' && !ilGscFetched) {
              ilFetchGscProperties()
              ilFetchGsc()
              ilFetchKeywords()
            }
          }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              labSubTab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
        <div className="ml-4 pl-4 border-l border-gray-300">
          <button onClick={saveAll} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'บันทึก...' : saved ? '✅ บันทึกแล้ว!' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      {/* ══ STYLE sub-tab ══════════════════════════════ */}
      {labSubTab === 'style' && (
        <div className="flex gap-6 items-start">
          {/* Left settings */}
          <div className="w-72 shrink-0 space-y-4">
            {/* Theme */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Palette size={13} className="text-gray-400" />
                <span className="text-xs font-semibold text-gray-800">Theme บทความ</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {THEMES.map(t => (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    className={`text-left px-3 py-2 rounded-xl border-2 transition-all ${theme === t.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="text-xs font-semibold text-gray-900">{t.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" style={{ backgroundColor: accentColor }} />
                <span className="text-xs font-semibold text-gray-800">Accent Color</span>
                <span className="text-[10px] text-gray-400 font-mono ml-auto">{accentColor}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(c => (
                  <button key={c.id} onClick={() => setAccentColor(c.id)} title={c.label}
                    className={`w-7 h-7 rounded-full border-4 transition-all ${accentColor === c.id ? 'border-gray-400 scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c.id }} />
                ))}
                <label title="Custom color" className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-gray-400">
                  <span className="text-[9px] text-gray-400">+</span>
                  <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="sr-only" />
                </label>
              </div>
              <div className="mt-3 h-1.5 rounded-full" style={{ background: `linear-gradient(to right, ${accentColor}22, ${accentColor})` }} />
            </div>

            {/* Style Guide */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-800 flex-1">Style Guide (.md)</span>
                <button onClick={() => setStyleGuide(DEFAULT_STYLE_GUIDE)}
                  className="flex items-center gap-1 text-[10px] text-indigo-600 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50">
                  Default
                </button>
                <button onClick={() => styleFileRef.current?.click()}
                  className="flex items-center gap-1 text-[10px] text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50">
                  <Upload size={10} /> อัปโหลด
                </button>
                <input ref={styleFileRef} type="file" accept=".md,.txt" className="hidden" onChange={loadStyleMd} />
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Style Guide นี้จะถูกใช้กับบทความทุกชิ้นของ Client นี้ — แก้ไขได้เฉพาะหน้า Content Lab เท่านั้น
              </p>
              <textarea value={styleGuide} onChange={e => setStyleGuide(e.target.value)}
                placeholder={`วาง style.md หรืออัปโหลดไฟล์\n## Tone\n- เป็นกันเอง ให้ข้อมูล`}
                rows={8}
                className="w-full text-[11px] font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-y" />
              {styleGuide && (
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-400">{styleGuide.length.toLocaleString()} chars</span>
                  <button onClick={() => setStyleGuide('')} className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-0.5">
                    <X size={9} /> ล้าง
                  </button>
                </div>
              )}
            </div>

            {/* Forbidden Words */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="mb-2">
                <span className="text-xs font-semibold text-gray-800">คำต้องห้าม</span>
                <p className="text-[10px] text-gray-400 mt-0.5">1 บรรทัด = 1 คำ</p>
              </div>
              <textarea value={forbiddenWords} onChange={e => setForbiddenWords(e.target.value)}
                placeholder={'ดีที่สุด\nถูกที่สุด\nหมายเลข 1'}
                rows={4}
                className="w-full text-xs font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none" />
            </div>
          </div>

          {/* Right: Article Lab */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-bold text-gray-900">Article Lab</div>
                {project.sampleArticle && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✅ มี Pattern บันทึกแล้ว</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-4">Generate บทความทดสอบด้วย Style ปัจจุบัน แก้ไขจนโอเค แล้ว "บันทึกทั้งหมด" — AI จะใช้เป็น reference ทุกครั้ง</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Keyword หลัก</label>
                  <input value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="เช่น รับทำ Google Ads"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Title (H1)</label>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="เช่น รับทำ Google Ads มืออาชีพ"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={generate} disabled={loading || !keyword.trim() || !title.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                  {loading ? 'กำลัง Generate...' : 'Generate ด้วย Style นี้'}
                </button>
                {!html && project.sampleArticle && (
                  <button onClick={() => setHtml(project.sampleArticle!)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 px-3 py-2 rounded-xl hover:bg-blue-50">
                    โหลด Pattern เดิม
                  </button>
                )}
              </div>
            </div>

            {loading && (
              <div className="bg-gray-950 text-emerald-400 rounded-2xl p-4 font-mono text-[11px] max-h-52 overflow-auto space-y-1">
                {stepMsg && <p className="text-blue-300 font-semibold animate-pulse">{stepMsg}</p>}
                {streamText && <><span className="text-gray-400">{streamText.slice(-900)}</span><span className="animate-pulse">▋</span></>}
                {!streamText && !stepMsg && <p className="text-gray-500 animate-pulse">กำลังเริ่มต้น...</p>}
              </div>
            )}

            {html && !loading && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <button onClick={() => setViewMode('preview')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'preview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                      Preview
                    </button>
                    <button onClick={() => setViewMode('code')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'code' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                      HTML
                    </button>
                    {coverImageLab && (
                      <button onClick={() => setViewMode('cover')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'cover' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                        🖼️ รูปปก
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={generate} disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-xl hover:bg-gray-50">
                      <RefreshCw size={11} /> Regenerate
                    </button>
                    <button onClick={saveAll} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                      {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                      {saved ? '✅ บันทึกแล้ว!' : 'บันทึกเป็น Pattern'}
                    </button>
                  </div>
                </div>
                {viewMode === 'code' && (
                  <textarea value={html} onChange={e => setHtml(e.target.value)}
                    className="w-full font-mono text-[11px] text-gray-200 bg-gray-950 p-5 min-h-[500px] resize-y focus:outline-none"
                    spellCheck={false} />
                )}
                {viewMode === 'preview' && (
                  <div className="p-6 min-h-96 overflow-auto">
                    <iframe srcDoc={html} className="w-full border-0 min-h-[600px]" sandbox="allow-same-origin" title="Article Preview" />
                  </div>
                )}
                {viewMode === 'cover' && coverImageLab && (
                  <div className="p-4 space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={11} /> รูปปกบทความ (Cover 1536×864)</p>
                      <div className="relative group">
                        <img src={`data:${coverMimeTypeLab};base64,${coverImageLab}`} alt="cover" className="w-full rounded-xl overflow-hidden border border-gray-100" />
                        <a href={`data:${coverMimeTypeLab};base64,${coverImageLab}`} download="cover.webp"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900/70 text-white text-[10px] px-2 py-1 rounded-lg flex items-center gap-1">
                          <Download size={10} /> ดาวน์โหลด
                        </a>
                      </div>
                    </div>
                    {midImageLab && (
                      <div>
                        <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={11} /> รูปประกอบบทความ (In-body 1200×630)</p>
                        <div className="relative group">
                          <img src={`data:${midMimeTypeLab};base64,${midImageLab}`} alt="mid" className="w-full rounded-xl overflow-hidden border border-gray-100" />
                          <a href={`data:${midMimeTypeLab};base64,${midImageLab}`} download="mid.webp"
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900/70 text-white text-[10px] px-2 py-1 rounded-lg flex items-center gap-1">
                            <Download size={10} /> ดาวน์โหลด
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ CTA sub-tab ════════════════════════════════ */}
      {labSubTab === 'cta' && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-gray-900">CTA (Call-to-Action)</p>
                <p className="text-xs text-gray-500 mt-0.5">จะถูกแทรกในบทความทุกครั้งที่ Generate</p>
              </div>
              <button
                onClick={() => setCta(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${cta.enabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${cta.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {!cta.enabled && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">เปิด CTA เพื่อตั้งค่า</p>
              </div>
            )}

            {cta.enabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Headline</label>
                    <input value={cta.headline} onChange={e => setCta(p => ({ ...p, headline: e.target.value }))}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subtext</label>
                    <input value={cta.subtext} onChange={e => setCta(p => ({ ...p, subtext: e.target.value }))}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                  </div>
                </div>

                {/* Layout controls */}
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">การจัดวาง</p>
                    <div className="flex gap-1">
                      {([['left','◀ ซ้าย'],['center','■ กลาง'],['right','ขวา ▶']] as [CtaSettings['alignment'],string][]).map(([v,lbl]) => (
                        <button key={v} onClick={() => setCta(p => ({ ...p, alignment: v }))}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${cta.alignment === v ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1.5">ปุ่มเรียงแนว</p>
                    <div className="flex gap-1">
                      {([['row','แนวนอน ▷▷'],['column','แนวตั้ง ↓']] as [CtaSettings['buttonLayout'],string][]).map(([v,lbl]) => (
                        <button key={v} onClick={() => setCta(p => ({ ...p, buttonLayout: v }))}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${cta.buttonLayout === v ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preview card */}
                {(cta.headline || cta.subtext || cta.channels.filter(c => c.value).length > 0) && (
                  <div className="rounded-2xl border-2 p-4" style={{ borderColor: accentColor + '40', background: accentColor + '08', textAlign: cta.alignment }}>
                    {cta.headline && <p className="font-bold text-gray-900 text-sm">{cta.headline}</p>}
                    {cta.subtext && <p className="text-xs text-gray-500 mt-0.5">{cta.subtext}</p>}
                    {cta.channels.filter(c => c.value).length > 0 && (
                      <div className={`flex gap-2 mt-3 flex-wrap ${cta.alignment === 'center' ? 'justify-center' : cta.alignment === 'right' ? 'justify-end' : 'justify-start'} ${cta.buttonLayout === 'column' ? 'flex-col items-start' : ''} ${cta.buttonLayout === 'column' && cta.alignment === 'center' ? '!items-center' : ''} ${cta.buttonLayout === 'column' && cta.alignment === 'right' ? '!items-end' : ''}`}>
                        {cta.channels.filter(c => c.value).map(c => {
                          const opt = CTA_CHANNEL_OPTS.find(o => o.type === c.type)
                          const icon = c.icon ?? opt?.icon ?? ''
                          const style = c.buttonStyle ?? 'filled'
                          return (
                            <span key={c.type} className={`text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${style === 'filled' ? 'text-white' : style === 'outline' ? 'bg-transparent border-2' : 'bg-transparent'}`}
                              style={style === 'filled' ? { backgroundColor: accentColor } : style === 'outline' ? { borderColor: accentColor, color: accentColor } : { color: accentColor }}>
                              {c.imageUrl
                                ? <img src={c.imageUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                : icon ? <span>{icon}</span> : null
                              }
                              {c.label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">ช่องทางติดต่อ <span className="font-normal text-gray-400">(ลากเพื่อเรียงลำดับ)</span></p>
                  {/* Active channels — draggable to reorder */}
                  {cta.channels.length > 0 && (
                    <div className="space-y-2 mb-3 pb-3 border-b border-gray-100">
                      {cta.channels.map((ch, idx) => {
                        const opt = CTA_CHANNEL_OPTS.find(o => o.type === ch.type)!
                        const currentIcon = ch.icon ?? opt.icon
                        return (
                          <div key={ch.type}
                            draggable
                            onDragStart={e => e.dataTransfer.setData('text/plain', String(idx))}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                              e.preventDefault()
                              const from = Number(e.dataTransfer.getData('text/plain'))
                              if (from === idx) return
                              setCta(p => {
                                const arr = [...p.channels]
                                const [item] = arr.splice(from, 1)
                                arr.splice(idx, 0, item)
                                return { ...p, channels: arr }
                              })
                            }}
                            className="bg-gray-50 rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing group">
                            {/* Row 1: drag handle + type + label + value + delete */}
                            <div className="flex items-center gap-2">
                              <span className="text-gray-300 text-xs select-none shrink-0">⠿</span>
                              <span className="text-[10px] text-gray-400 w-16 shrink-0">{opt.type}</span>
                              <input
                                value={ch.label}
                                onChange={e => setCta(p => ({ ...p, channels: p.channels.map(c => c.type === ch.type ? { ...c, label: e.target.value } : c) }))}
                                placeholder="ชื่อปุ่ม"
                                className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none bg-white shrink-0"
                              />
                              <input
                                value={ch.value}
                                onChange={e => setCta(p => ({ ...p, channels: p.channels.map(c => c.type === ch.type ? { ...c, value: e.target.value } : c) }))}
                                placeholder={opt.placeholder}
                                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none bg-white"
                              />
                              <button
                                onClick={() => setCta(p => ({ ...p, channels: p.channels.filter(c => c.type !== ch.type) }))}
                                className="text-gray-300 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                ✕
                              </button>
                            </div>
                            {/* Row 2: image upload + button style */}
                            <div className="flex items-center gap-3 mt-2 pl-7">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] text-gray-400 shrink-0">รูป/โลโก้:</span>
                                {ch.imageUrl ? (
                                  <div className="relative shrink-0">
                                    <img src={ch.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200" />
                                    <button
                                      onClick={() => setCta(p => ({ ...p, channels: p.channels.map(c => c.type === ch.type ? { ...c, imageUrl: undefined } : c) }))}
                                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center leading-none">
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <label className="cursor-pointer flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 border border-dashed border-blue-300 rounded-lg px-2 py-1 hover:border-blue-500 transition-colors">
                                    <span>+ อัพโหลด</span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={e => {
                                        const file = e.target.files?.[0]
                                        if (!file) return
                                        const reader = new FileReader()
                                        reader.onload = ev => {
                                          const url = ev.target?.result as string
                                          setCta(p => ({ ...p, channels: p.channels.map(c => c.type === ch.type ? { ...c, imageUrl: url } : c) }))
                                        }
                                        reader.readAsDataURL(file)
                                        e.target.value = ''
                                      }}
                                    />
                                  </label>
                                )}
                                {!ch.imageUrl && (
                                  <span className="text-[10px] text-gray-300">{currentIcon}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 ml-auto shrink-0">
                                <span className="text-[10px] text-gray-400">สไตล์:</span>
                                {(['filled','outline','ghost'] as const).map(s => (
                                  <button key={s} onClick={() => setCta(p => ({ ...p, channels: p.channels.map(c => c.type === ch.type ? { ...c, buttonStyle: s } : c) }))}
                                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${(ch.buttonStyle ?? 'filled') === s ? 'border-gray-700 bg-gray-700 text-white' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>
                                    {s === 'filled' ? 'ทึบ' : s === 'outline' ? 'กรอบ' : 'ข้อความ'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* Add channel buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {CTA_CHANNEL_OPTS.filter(opt => !cta.channels.find(c => c.type === opt.type)).map(opt => (
                      <button key={opt.type}
                        onClick={() => setCta(p => ({ ...p, channels: [...p.channels, { type: opt.type, label: opt.defaultLabel, value: '', icon: opt.icon, buttonStyle: 'filled' }] }))}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-500 hover:text-gray-700 transition-colors">
                        + {opt.icon} {opt.type}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ AUTHOR sub-tab ═════════════════════════════ */}
      {labSubTab === 'author' && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Author Box</p>
                <p className="text-xs text-gray-500 mt-0.5">แนบท้ายบทความ + ปรับโทนภาษาตามผู้เขียน</p>
              </div>
              <button
                onClick={() => setAuthorEnabled(prev => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${authorEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${authorEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {!authorEnabled && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">เปิด Author Box เพื่อตั้งค่า</p>
              </div>
            )}

            {authorEnabled && (
              <div className="space-y-3">
                {authors.map((author, idx) => (
                  <div key={author.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500">Author {idx + 1}</span>
                      <button onClick={() => setAuthors(prev => prev.filter(a => a.id !== author.id))}
                        className="text-xs text-red-400 hover:text-red-600">ลบ</button>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <div
                          className="w-16 h-16 rounded-full border-2 border-gray-200 overflow-hidden bg-gray-100 flex items-center justify-center cursor-pointer hover:border-blue-400 transition-colors"
                          onClick={() => authorImageRefs.current[author.id]?.click()}
                        >
                          {author.image ? (
                            <img src={author.image} alt={author.name} className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-8 h-8 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                            </svg>
                          )}
                        </div>
                        <button onClick={() => authorImageRefs.current[author.id]?.click()}
                          className="text-[10px] text-blue-500 hover:text-blue-700">
                          {author.image ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                        </button>
                        <input
                          ref={el => { authorImageRefs.current[author.id] = el }}
                          type="file" accept="image/*" className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]; if (!file) return
                            const reader = new FileReader()
                            reader.onload = ev => setAuthors(prev => prev.map(a =>
                              a.id === author.id ? { ...a, image: ev.target?.result as string ?? '' } : a
                            ))
                            reader.readAsDataURL(file)
                          }}
                        />
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          value={author.name}
                          onChange={e => setAuthors(prev => prev.map(a => a.id === author.id ? { ...a, name: e.target.value } : a))}
                          placeholder="ชื่อ Author เช่น ทพญ.เอสิกา"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                        <input
                          value={author.title}
                          onChange={e => setAuthors(prev => prev.map(a => a.id === author.id ? { ...a, title: e.target.value } : a))}
                          placeholder="ตำแหน่ง เช่น ทันตแพทย์ผู้เชี่ยวชาญ"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                        <div className="flex gap-1.5">
                          {([['male','ชาย (ครับ/ผม)'],['female','หญิง (ค่ะ/ฉัน)'],['none','กลาง']] as [string,string][]).map(([val, lbl]) => (
                            <button key={val}
                              onClick={() => setAuthors(prev => prev.map(a => a.id === author.id ? { ...a, gender: val as AuthorProfile['gender'] } : a))}
                              className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${author.gender === val ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {(author.name || author.title) && (
                      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                        {author.image && <img src={author.image} alt={author.name} className="w-9 h-9 rounded-full object-cover border border-gray-200" />}
                        <div>
                          {author.name && <p className="text-xs font-semibold text-gray-800">{author.name}</p>}
                          {author.title && <p className="text-[11px] text-gray-400">{author.title}</p>}
                        </div>
                        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${author.gender === 'male' ? 'bg-blue-100 text-blue-600' : author.gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-gray-100 text-gray-400'}`}>
                          {author.gender === 'male' ? 'ชาย' : author.gender === 'female' ? 'หญิง' : 'กลาง'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setAuthors(prev => [...prev, { id: `author-${Date.now()}`, name: '', title: '', gender: 'none', image: '' }])}
                  className="w-full text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl py-3 hover:border-gray-500 hover:text-gray-700 transition-colors"
                >
                  + เพิ่ม Author
                </button>
                {authors.length === 0 && (
                  <p className="text-xs text-gray-400 text-center">ยังไม่มี Author — กด "+ เพิ่ม Author" เพื่อเริ่ม</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ SITELINK sub-tab ═══════════════════════════ */}
      {labSubTab === 'sitelink' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">Internal Links</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    AI จะแทรก {ilLinksPerArticle} links ต่อบทความจากรายการนี้ — ใช้ URL เต็ม (https://...)
                  </p>
                </div>
                <button onClick={ilSave} disabled={ilSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 shrink-0">
                  {ilSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                  {ilSaved ? '✅ บันทึกแล้ว!' : 'บันทึก'}
                </button>
              </div>
            </div>

            {/* Controls row */}
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">GSC Property</span>
                {ilGscProperties.length > 1 ? (
                  <select value={ilGscSelected} onChange={e => setIlGscSelected(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300">
                    {ilGscProperties.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input value={ilGscSelected} onChange={e => setIlGscSelected(e.target.value)}
                    placeholder={project.gscSiteUrl ?? 'sc-domain:example.com'}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white font-mono focus:outline-none focus:ring-1 focus:ring-gray-300" />
                )}
                <button onClick={() => ilFetchGsc()} disabled={ilGscLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-semibold text-gray-600 rounded-xl hover:bg-white disabled:opacity-50 shrink-0">
                  <RefreshCw size={11} className={ilGscLoading ? 'animate-spin' : ''} /> ดึงจาก GSC
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">Keywords</span>
                <span className="flex-1 text-xs text-gray-400">ดึงจาก keyword list + articles ในโปรเจกต์นี้</span>
                <button onClick={ilFetchKeywords} disabled={ilKwLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-semibold text-gray-600 rounded-xl hover:bg-white disabled:opacity-50 shrink-0">
                  <Zap size={11} className={ilKwLoading ? 'animate-spin' : ''} /> ดึงจาก Keywords
                </button>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">Links / บทความ</span>
                <input type="text" value={ilLinksPerArticle} onChange={e => setIlLinksPerArticle(e.target.value)}
                  placeholder="3-5"
                  className="w-20 text-sm text-center border border-gray-200 rounded-lg px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                <span className="text-xs text-gray-400">เช่น <span className="font-mono">3</span> หรือ <span className="font-mono">3-10</span></span>
              </div>
            </div>

            {/* 3 separate tables */}
            <div className="divide-y divide-gray-100">

              {/* Table 1: GSC results */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">จาก GSC</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilGscLinks.filter(l => !ilExcluded.has(l.url)).length} / {ilGscLinks.length}</span>
                  {ilGscLoading && <RefreshCw size={11} className="animate-spin text-gray-400" />}
                </div>
                {ilGscLinks.length === 0 && !ilGscLoading ? (
                  <p className="text-xs text-gray-400 py-2">ยังไม่ได้ดึง — กด "ดึงจาก GSC" ด้านบน</p>
                ) : (
                  <div className="max-h-60 overflow-auto space-y-0.5">
                    {ilGscLinks.map((link, i) => {
                      const excluded = ilExcluded.has(link.url)
                      return (
                        <div key={i} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors ${excluded ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'}`}>
                          <button onClick={() => ilToggleExclude(link.url)}
                            className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${excluded ? 'border-gray-300 bg-white' : 'border-emerald-500 bg-emerald-500'}`}>
                            {!excluded && <span className="text-white text-[10px] leading-none">✓</span>}
                          </button>
                          <span className="text-xs text-gray-700 w-40 shrink-0 truncate">{link.keyword}</span>
                          <span className="text-xs text-blue-500 font-mono truncate flex-1">{link.url}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Table 2: Keywords results */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">จาก Keywords</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilKwLinks.filter(l => !ilExcluded.has(l.url)).length} / {ilKwLinks.length}</span>
                  {ilKwLoading && <RefreshCw size={11} className="animate-spin text-gray-400" />}
                </div>
                {ilKwLinks.length === 0 && !ilKwLoading ? (
                  <p className="text-xs text-gray-400 py-2">ยังไม่ได้ดึง — กด "ดึงจาก Keywords" ด้านบน</p>
                ) : (
                  <div className="max-h-60 overflow-auto space-y-0.5">
                    {ilKwLinks.map((link, i) => {
                      const excluded = ilExcluded.has(link.url)
                      return (
                        <div key={i} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors ${excluded ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'}`}>
                          <button onClick={() => ilToggleExclude(link.url)}
                            className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${excluded ? 'border-gray-300 bg-white' : 'border-blue-500 bg-blue-500'}`}>
                            {!excluded && <span className="text-white text-[10px] leading-none">✓</span>}
                          </button>
                          <span className="text-xs text-gray-700 w-40 shrink-0 truncate">{link.keyword}</span>
                          <span className="text-xs text-blue-500 font-mono truncate flex-1">{link.url}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Table 3: Manual links */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">เพิ่มเอง</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilManualLinks.filter(l => l.url.trim()).length}</span>
                </div>
                <div className="space-y-1 max-h-60 overflow-auto">
                  {ilManualLinks.map((link, i) => (
                    <div key={i} className="grid grid-cols-[1fr_2fr_2rem] items-center gap-2 group">
                      <input value={link.keyword} onChange={e => ilManualUpdate(i, 'keyword', e.target.value)}
                        placeholder="anchor text"
                        className="text-xs text-gray-800 border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
                      <input value={link.url} onChange={e => ilManualUpdate(i, 'url', e.target.value)}
                        placeholder="https://example.com/slug"
                        className="text-xs text-blue-600 font-mono border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
                      <button onClick={() => ilManualRemove(i)}
                        className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm leading-none text-center transition-all">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={ilManualAdd}
                  className="mt-2 w-full text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl py-2 hover:border-gray-400 hover:text-gray-600 transition-colors">
                  + เพิ่มลิงก์เอง
                </button>
              </div>

            </div>

            {/* Footer summary */}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                รวม <span className="font-bold text-gray-800">{ilMerged().length}</span> links (ไม่ซ้ำ ไม่รวมที่ unchecked)
                {ilSaved && <span className="ml-3 text-emerald-600 font-semibold">✅ บันทึกแล้ว</span>}
              </p>
              <button onClick={ilSave} disabled={ilSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                {ilSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                {ilSaved ? '✅ บันทึกแล้ว!' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Publish Tab ──────────────────────────────────────────────────────────────

interface PublishedArticle {
  id: string
  title: string
  slug: string | null
  status: string
  wordpressUrl: string | null
  keyword: { keyword: string } | null
  updatedAt: string
  funnelStage: string | null
}

function PublishTab({ project, pushJobs, isClient = false }: { project: ProjectData; pushJobs: PushJob[]; isClient?: boolean }) {
  const [articles, setArticles] = useState<PublishedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await fetch(`/api/articles/published?projectId=${project.id}`)
      if (res.ok) setArticles(await res.json())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge DB articles with fresh pushJobs from this session (pushJobs may have postUrl not yet in DB)
  const merged: (PublishedArticle & { sessionPostUrl?: string })[] = [...articles]
  for (const pj of pushJobs.filter(p => p.status === 'done' && p.postUrl)) {
    const exists = merged.find(a => a.title === pj.title)
    if (!exists) {
      merged.unshift({
        id: `session-${pj.entryIdx}`,
        title: pj.title,
        slug: pj.slug,
        status: 'WORDPRESS_DRAFTED',
        wordpressUrl: pj.postUrl ?? null,
        keyword: null,
        updatedAt: pj.pushedAt ?? new Date().toISOString(),
        funnelStage: null,
        sessionPostUrl: pj.postUrl,
      })
    } else if (!exists.wordpressUrl && pj.postUrl) {
      exists.wordpressUrl = pj.postUrl
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    POSTED: 'Published',
    WORDPRESS_DRAFTED: 'Draft (WP)',
  }
  const STATUS_COLOR: Record<string, string> = {
    POSTED: 'bg-emerald-100 text-emerald-700',
    WORDPRESS_DRAFTED: 'bg-blue-100 text-blue-600',
  }

  // CLIENT view — only published links
  if (isClient) {
    const published = merged.filter(a => a.wordpressUrl)
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{published.length} บทความที่เผยแพร่แล้ว</p>
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> กำลังโหลด...
          </div>
        ) : published.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Globe size={32} className="text-gray-200" />
            <p className="text-gray-400 text-sm">ยังไม่มีบทความที่เผยแพร่</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-50 overflow-hidden">
            {published.map((a, i) => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="text-xs text-gray-300 w-6 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{a.title}</div>
                  {a.keyword?.keyword && <div className="text-xs text-gray-400 mt-0.5">{a.keyword.keyword}</div>}
                </div>
                <a href={a.wordpressUrl!} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                  <Globe size={11} /> เปิดดู
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">บทความที่ Push แล้ว</h3>
          <p className="text-xs text-gray-400 mt-0.5">{merged.length} บทความ · คลิกลิ้งค์เพื่อดูบนเว็บไซต์</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'กำลังโหลด...' : 'รีเฟรช'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
          <RefreshCw size={14} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : merged.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Globe size={32} className="text-gray-200" />
          <p className="text-gray-400 text-sm">ยังไม่มีบทความที่ Push ไป WordPress</p>
          <p className="text-gray-300 text-xs">Push บทความจาก tab Push แล้วกลับมาดูที่นี่</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">ชื่อบทความ</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Keyword</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">สถานะ</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">วันที่</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">ลิ้งค์</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {merged.map((a, i) => (
                <tr key={a.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-300">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-sm leading-snug">{a.title}</div>
                    {a.slug && <div className="text-[11px] text-gray-400 font-mono mt-0.5">/{a.slug}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.keyword?.keyword ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLOR[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(a.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    {a.wordpressUrl ? (
                      <a
                        href={a.wordpressUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium hover:underline"
                      >
                        <Globe size={11} />
                        เปิดดู
                        <ChevronRight size={10} />
                      </a>
                    ) : (
                      <span className="text-gray-300 text-xs">ไม่มีลิ้งค์</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Push Tab ─────────────────────────────────────────────────────────────────

type WpStatus = 'idle' | 'connecting' | 'connected' | 'error'
type PushStatus = 'idle' | 'pushing' | 'done' | 'error'

interface PushJob {
  entryIdx: number
  keyword: string
  title: string
  slug: string
  status: PushStatus
  postId?: number
  postUrl?: string
  error?: string
  pushedAt?: string
}

interface WpConnection { id: string; name: string; siteUrl: string; username: string }

function PushTab({
  project, timeline, jobs,
  wpConnections, setWpConnections, selectedConnId, setSelectedConnId,
  pushJobs, setPushJobs,
}: {
  project: ProjectData
  timeline: TimelineEntry[]
  jobs: ArticleJob[]
  wpConnections: WpConnection[]
  setWpConnections: (c: WpConnection[]) => void
  selectedConnId: string
  setSelectedConnId: (id: string) => void
  pushJobs: PushJob[]
  setPushJobs: React.Dispatch<React.SetStateAction<PushJob[]>>
}) {
  const [wpStatus, setWpStatus] = useState<WpStatus>('idle')
  const [wpInfo, setWpInfo] = useState<{ url: string; name: string; version: string; source?: string } | null>(null)
  const [wpError, setWpError] = useState('')
  const [publishMode, setPublishMode] = useState<'draft' | 'publish'>('draft')
  const [useElementor, setUseElementor] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set())
  // per-article WP post type override: 'auto' | 'post' | 'page'
  const [wpTypeOverride, setWpTypeOverride] = useState<Record<number, 'auto' | 'post' | 'page'>>({})

  function getWpPostType(entryIdx: number): 'post' | 'page' {
    const override = wpTypeOverride[entryIdx]
    if (override === 'post') return 'post'
    if (override === 'page') return 'page'
    // auto: ดู page_type จาก timeline entry
    const entry = timeline[entryIdx]
    const pt = (entry as any)?.kw_page_type ?? (entry as any)?.page_type ?? ''
    const isPage = /service|page|core/i.test(pt)
    return isPage ? 'page' : 'post'
  }
  const connections = wpConnections
  const setConnections = setWpConnections
  const [savingConn, setSavingConn] = useState(false)

  // Load org-level WP connections on mount (only if not already loaded)
  useEffect(() => {
    if (connections.length > 0) {
      // Already loaded — just ensure selectedConnId is valid
      if (project.wordpressConnectionId && !selectedConnId) setSelectedConnId(project.wordpressConnectionId)
      return
    }
    fetch('/api/settings/wordpress')
      .then(r => r.ok ? r.json() : [])
      .then((data: WpConnection[]) => {
        setConnections(data)
        // Auto-select if project already has one linked
        if (project.wordpressConnectionId) setSelectedConnId(project.wordpressConnectionId)
        else if (data.length === 1) setSelectedConnId(data[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveConnection() {
    setSavingConn(true)
    await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wordpressConnectionId: selectedConnId || null }),
    })
    setSavingConn(false)
  }

  // Articles that have generated HTML (done/review/approved)
  const readyArticles = jobs.filter(j =>
    (j.status === 'done' || j.status === 'review' || j.status === 'approved') && j.html
  )

  async function handleConnect() {
    setWpStatus('connecting')
    setWpError('')
    setWpInfo(null)
    try {
      const res = await fetch('/api/push/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, connectionId: selectedConnId || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setWpStatus('error'); setWpError(data.error ?? 'เชื่อมต่อไม่ได้'); return }
      setWpStatus('connected')
      setWpInfo({ url: data.url, name: data.name, version: data.version, source: data.source })
      // Auto-save if user selected a connection
      if (selectedConnId) handleSaveConnection()
    } catch (e) {
      setWpStatus('error')
      setWpError(String(e))
    }
  }

  function toggleSelect(idx: number) {
    setSelectedIdx(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  function selectAll() {
    setSelectedIdx(new Set(readyArticles.map(j => j.entryIdx)))
  }

  async function handlePush(jobEntryIdx: number) {
    const job = jobs.find(j => j.entryIdx === jobEntryIdx)
    if (!job?.html) return
    const entry = timeline[jobEntryIdx]
    const title = entry?.title ?? job.title ?? ''
    const keyword = entry?.keyword ?? job.keyword ?? ''
    const slug = entry?.slug || job.slug || ''
    const coverImage = job.coverImage ?? ''
    const coverMimeType = job.coverMimeType ?? 'image/webp'

    setPushJobs(prev => {
      const next = prev.filter(p => p.entryIdx !== jobEntryIdx)
      return [...next, { entryIdx: jobEntryIdx, keyword, title, slug, status: 'pushing' }]
    })

    try {
      const res = await fetch('/api/push/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, html: job.html, title, keyword, slug, coverImage, coverMimeType, publishMode, useElementor, wpPostType: getWpPostType(jobEntryIdx), connectionId: selectedConnId || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setPushJobs(prev => prev.map(p => p.entryIdx === jobEntryIdx ? { ...p, status: 'error', error: data.error ?? 'Push ล้มเหลว' } : p))
        return
      }
      setPushJobs(prev => prev.map(p => p.entryIdx === jobEntryIdx
        ? { ...p, status: 'done', postId: data.postId, postUrl: data.postUrl, pushedAt: new Date().toISOString() }
        : p
      ))
      // Save wordpressUrl back to DB so Publish tab can show it persistently
      if (data.postUrl && title) {
        fetch('/api/articles/by-title', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, title, wordpressUrl: data.postUrl, status: publishMode === 'publish' ? 'POSTED' : 'WORDPRESS_DRAFTED' }),
        }).catch(() => {})
      }
    } catch (e) {
      setPushJobs(prev => prev.map(p => p.entryIdx === jobEntryIdx ? { ...p, status: 'error', error: String(e) } : p))
    }
  }

  async function handlePushSelected() {
    for (const idx of Array.from(selectedIdx)) {
      await handlePush(idx)
    }
  }

  const getPushJob = (entryIdx: number) => pushJobs.find(p => p.entryIdx === entryIdx)

  const PUSH_STATUS_COLOR: Record<PushStatus, string> = {
    idle: 'bg-gray-100 text-gray-500',
    pushing: 'bg-blue-100 text-blue-700',
    done: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-600',
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* ─── Connect Card ─── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-gray-900">🔗 WordPress Connection</div>
            <p className="text-xs text-gray-400 mt-0.5">เลือก Site จาก Website Connect หรือใช้ credentials ที่ตั้งไว้ใน Project Settings</p>
          </div>
          <button onClick={handleConnect} disabled={wpStatus === 'connecting'}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              wpStatus === 'connected' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              : wpStatus === 'error' ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}>
            {wpStatus === 'connecting' ? <RefreshCw size={13} className="animate-spin" /> : <Globe size={13} />}
            {wpStatus === 'connecting' ? 'กำลังเชื่อมต่อ...' : wpStatus === 'connected' ? '✓ Connected' : 'Test Connect'}
          </button>
        </div>

        {/* Connection selector */}
        {connections.length > 0 ? (
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase">เลือก Site จาก Website Connect</p>
            <div className="flex items-center gap-2">
              <select
                value={selectedConnId}
                onChange={e => setSelectedConnId(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="">— ไม่เลือก (ใช้ Project Settings หรือ .env) —</option>
                {connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.siteUrl})</option>
                ))}
              </select>
              <button
                onClick={handleSaveConnection}
                disabled={savingConn}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {savingConn ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
            {selectedConnId && (() => {
              const c = connections.find(x => x.id === selectedConnId)
              return c ? (
                <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
                  <CheckCircle2 size={10} className="text-emerald-500" />
                  <span className="font-mono">{c.siteUrl}</span>
                  <span className="text-gray-300">·</span>
                  <span>User: {c.username}</span>
                </div>
              ) : null
            })()}
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-2">
            <Globe size={12} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-[10px] text-blue-600">
              ยังไม่มี WordPress connection — ไปที่{' '}
              <a href="/website-connect" className="font-semibold underline">Website Connect</a>{' '}
              เพื่อเพิ่ม แล้วกลับมาเลือกที่นี่ หรือใช้ credentials ใน Project Settings
            </p>
          </div>
        )}

        {/* Status */}
        {wpStatus === 'connected' && wpInfo && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-emerald-800">{wpInfo.name}</div>
              <div className="text-xs text-emerald-600">{wpInfo.url} · WordPress {wpInfo.version}</div>
              <div className="text-[10px] text-emerald-500 mt-0.5">
                {wpInfo.source === 'connection' ? '🔗 ใช้ Website Connect' : wpInfo.source === 'project' ? '🔑 ใช้ Project Settings' : '🔑 ใช้ .env'}
              </div>
            </div>
          </div>
        )}
        {wpStatus === 'error' && wpError && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
            <XCircle size={16} className="text-red-500 shrink-0" />
            <div className="text-xs text-red-600">{wpError}</div>
          </div>
        )}
      </div>

      {/* ─── Publish Settings ─── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="text-sm font-bold text-gray-900 mb-4">⚙️ Publish Settings</div>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">สถานะเริ่มต้น</p>
            <div className="flex gap-2">
              {(['draft', 'publish'] as const).map(m => (
                <button key={m} onClick={() => setPublishMode(m)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${publishMode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {m === 'draft' ? '📝 Draft' : '🚀 Publish Live'}
                </button>
              ))}
            </div>
            {publishMode === 'publish' && (
              <p className="text-[10px] text-amber-600 mt-1.5">⚠️ จะ Publish บทความขึ้น Live ทันที</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Page Builder</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useElementor} onChange={e => setUseElementor(e.target.checked)}
                className="w-4 h-4 rounded accent-gray-900" />
              <span className="text-xs text-gray-700">ใช้ Elementor HTML Widget</span>
            </label>
            <p className="text-[10px] text-gray-400 mt-1">เปิดถ้าเว็บใช้ Elementor — HTML จะถูก inject เป็น widget แทน native WP content</p>
          </div>
        </div>
      </div>

      {/* ─── Articles Queue ─── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-gray-900">📋 บทความพร้อม Push</div>
            <p className="text-xs text-gray-400 mt-0.5">{readyArticles.length} บทความที่เขียนเสร็จแล้ว</p>
          </div>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
              เลือกทั้งหมด
            </button>
            {selectedIdx.size > 0 && (
              <button onClick={handlePushSelected}
                disabled={wpStatus !== 'connected'}
                className="text-xs px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors font-semibold">
                Push {selectedIdx.size} บทความ →
              </button>
            )}
          </div>
        </div>

        {readyArticles.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-3xl mb-2">📝</div>
            <p className="text-sm text-gray-500 font-medium">ยังไม่มีบทความพร้อม Push</p>
            <p className="text-xs text-gray-400 mt-1">ไปที่ tab Articles แล้ว Generate บทความก่อน</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {readyArticles.map(job => {
              const entry = timeline[job.entryIdx]
              const pj = getPushJob(job.entryIdx)
              const isSelected = selectedIdx.has(job.entryIdx)
              const slug = entry?.slug ?? ''
              const hasCover = !!job.coverImage

              return (
                <div key={job.entryIdx} className={`px-5 py-4 flex items-start gap-4 ${isSelected ? 'bg-blue-50/30' : 'hover:bg-gray-50/50'} transition-colors`}>
                  {/* Checkbox */}
                  <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(job.entryIdx)}
                    className="mt-1 w-4 h-4 rounded accent-gray-900 shrink-0" />

                  {/* Article info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{entry?.title ?? job.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{entry?.keyword ?? job.keyword}</div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {slug && (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                          <span className="text-gray-300">slug:</span>/{slug}
                        </span>
                      )}
                      {entry?.articleObjectiveTag && (
                        <span className="text-[10px] text-gray-400">{entry.articleObjectiveTag}</span>
                      )}
                      {hasCover && (
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <ImageIcon size={9} />รูปปก
                        </span>
                      )}
                      {entry?.date && (
                        <span className="text-[10px] text-gray-400">📅 {entry.thaiDate}</span>
                      )}
                    </div>

                    {/* WP Post Type selector — only show when Elementor is on */}
                    {useElementor && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[10px] text-gray-400">Push as:</span>
                        {(['auto', 'post', 'page'] as const).map(t => {
                          const isActive = (wpTypeOverride[job.entryIdx] ?? 'auto') === t
                          const resolvedLabel = t === 'auto' ? `Auto → ${getWpPostType(job.entryIdx)}` : t
                          return (
                            <button key={t} onClick={() => setWpTypeOverride(prev => ({ ...prev, [job.entryIdx]: t }))}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                                isActive ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                              }`}>
                              {resolvedLabel}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Push status + button */}
                  <div className="flex items-center gap-2 shrink-0">
                    {pj && (
                      <div className="text-right">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PUSH_STATUS_COLOR[pj.status]}`}>
                          {pj.status === 'pushing' ? 'กำลัง Push...' : pj.status === 'done' ? '✓ Push แล้ว' : pj.status === 'error' ? '✗ Error' : ''}
                        </span>
                        {pj.status === 'done' && pj.postUrl && (
                          <a href={pj.postUrl} target="_blank" rel="noopener noreferrer"
                            className="block text-[10px] text-blue-600 hover:underline mt-0.5">
                            ดูบทความ →
                          </a>
                        )}
                        {pj.status === 'error' && pj.error && (
                          <p className="text-[10px] text-red-500 mt-0.5 max-w-[180px] truncate" title={pj.error}>{pj.error}</p>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => handlePush(job.entryIdx)}
                      disabled={wpStatus !== 'connected' || pj?.status === 'pushing'}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                        pj?.status === 'done' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                        : 'bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40'
                      }`}>
                      {pj?.status === 'pushing' ? <RefreshCw size={12} className="animate-spin" />
                        : pj?.status === 'done' ? '↩ Re-push'
                        : '→ Push'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Push Log ─── */}
      {pushJobs.filter(p => p.status === 'done').length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="text-sm font-bold text-gray-900 mb-3">✅ Push Log</div>
          <div className="space-y-2">
            {pushJobs.filter(p => p.status === 'done').map(pj => (
              <div key={pj.entryIdx} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 truncate max-w-xs">{pj.title}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {pj.slug && <code className="text-gray-400 font-mono text-[10px]">/{pj.slug}</code>}
                  {pj.postId && <span className="text-gray-400">Post ID: {pj.postId}</span>}
                  {pj.postUrl && (
                    <a href={pj.postUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline">ดูบทความ →</a>
                  )}
                  {pj.pushedAt && <span className="text-gray-400">{new Date(pj.pushedAt).toLocaleTimeString('th-TH')}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',          label: 'Overview' },
  { id: 'lab',               label: 'Article Lab' },
  { id: 'keyword-research',  label: 'Keyword Research' },
  { id: 'keywords',          label: 'Keywords' },
  { id: 'content-map',       label: 'Content Map' },
  { id: 'articles',          label: 'Articles' },
  { id: 'review',            label: 'Review' },
  { id: 'push',              label: 'Push' },
  { id: 'publish',           label: 'Published' },
  { id: 'report',            label: 'Report' },
]

const CLIENT_TABS: Tab[] = ['review', 'publish', 'report']

export default function ClientDetailTabs({ project: initialProject, userRole = 'MEMBER' }: { project: ProjectData; userRole?: string }) {
  const isClient = userRole === 'CLIENT'
  const storageKey = `mars-project-${initialProject.id}`
  const [tab, setTab] = useState<Tab>(isClient ? 'review' : 'overview')
  const [keywords, setKeywords] = useState<KeywordRow[]>([])
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set())
  const kwPriorityScorerRef = useRef<((kw: KeywordRow) => number) | undefined>(undefined)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [jobs, setJobs] = useState<ArticleJob[]>([])
  const [project, setProject] = useState<ProjectData>(initialProject)
  const [autoSchedule, setAutoSchedule] = useState<boolean>(initialProject.autoSchedule ?? false)
  const autoScheduleRef = useRef(autoSchedule)
  autoScheduleRef.current = autoSchedule
  const isMounted = useRef(false)
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [scheduleDays, setScheduleDays] = useState<Set<number>>(new Set([1,2,3,4,5]))
  const [scheduleSelectedEntries, setScheduleSelectedEntries] = useState<Set<number> | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const stopRef = useRef(false)
  // Push tab — persist across navigation
  const [wpConnections, setWpConnections] = useState<WpConnection[]>([])
  const [pushSelectedConnId, setPushSelectedConnId] = useState<string>(initialProject.wordpressConnectionId ?? '')
  const [pushJobs, setPushJobs] = useState<PushJob[]>([])

  // Keyword Research → Content Map — แยกจาก Keywords tab โดยสิ้นเชิง
  const [wgContentMapKws, setWgContentMapKws] = useState<KeywordRow[]>([])
  const [contentMapSource, setContentMapSource] = useState<'keywords' | 'keyword-research'>('keywords')

  // Keyword Research tab — persist state across navigation (lifted to avoid unmount loss)
  const [wgNiche, setWgNiche] = useState('')
  const [wgSiteUrl, setWgSiteUrl] = useState(initialProject.website ?? '')
  const [wgQueryCount, setWgQueryCount] = useState(50)
  const [wgPreset, setWgPreset] = useState('preset1')
  const [wgIntentMix, setWgIntentMix] = useState<Record<string, number>>(INTENT_PRESETS[0].mix)
  const [wgLoadingWG, setWgLoadingWG] = useState(false)
  const [wgProgressLog, setWgProgressLog] = useState<string[]>([])
  const [wgStatusMsg, setWgStatusMsg] = useState('')
  const [wgResultRows, setWgResultRows] = useState<KeywordRow[]>([])
  const [wgIsDragging, setWgIsDragging] = useState(false)
  const [wgSeedFile, setWgSeedFile] = useState<File | null>(null)
  const [wgSeedKeywords, setWgSeedKeywords] = useState<string[]>([])

  // Read ?tab= from URL on mount (client-only, avoids SSR/Suspense issues)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const t = p.get('tab') as Tab | null
    const allowed = isClient ? CLIENT_TABS : ['overview','keyword-research','keywords','content-map','articles','lab','push','review','publish','report']
    if (t && allowed.includes(t as Tab)) {
      setTab(t as Tab)
    }
  }, [])

  // Load keywords + timeline on mount
  // keywords: DB is source of truth (saved via /api/projects/[id]/keywords-cache)
  // timeline: DB is source of truth, localStorage is fallback
  // jobs:     sessionStorage (survives same-tab navigation, cleared on close)
  useEffect(() => {
    // Restore jobs from storage (instant)
    try {
      const savedJobs = sessionStorage.getItem(`${storageKey}-jobs`) || localStorage.getItem(`${storageKey}-jobs`)
      if (savedJobs) {
        const parsed = JSON.parse(savedJobs)
        if (Array.isArray(parsed) && parsed.length) setJobs(parsed)
      }
    } catch { /* ignore */ }

    // Load scheduler (timeline + autoSchedule) — lightweight, no keywordRows
    fetch(`/api/scheduler?projectId=${initialProject.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(async d => {
        if (!d) return
        if (d.autoSchedule !== undefined) setAutoSchedule(d.autoSchedule)
        if (d.total > 0) {
          const [proj, articles] = await Promise.all([
            fetch(`/api/projects/${initialProject.id}`).then(r => r.ok ? r.json() : null),
            fetch(`/api/articles?projectId=${initialProject.id}`).then(r => r.ok ? r.json() : []),
          ])
          if (proj?.timeline) {
            try {
              const tl: TimelineEntry[] = JSON.parse(proj.timeline)
              if (tl.length) {
                // Sync DB article statuses back into timeline entries
                const REVIEW_STATUSES = new Set(['SEO_REVIEW', 'REVIEWING', 'REVIEW', 'APPROVED', 'ARTICLE_DONE'])
                const APPROVED_STATUSES = new Set(['APPROVED'])
                const articleMap: Record<string, string> = {}
                if (Array.isArray(articles)) {
                  for (const a of articles) {
                    if (a.title && a.status) articleMap[a.title.trim()] = a.status
                  }
                }
                const synced = tl.map(entry => {
                  const dbStatus = articleMap[entry.title?.trim() ?? '']
                  if (!dbStatus) return entry
                  if (APPROVED_STATUSES.has(dbStatus) && entry.articleStatus !== 'approved') {
                    return { ...entry, articleStatus: 'approved' as const }
                  }
                  if (REVIEW_STATUSES.has(dbStatus) && entry.articleStatus === 'pending') {
                    return { ...entry, articleStatus: 'review' as const }
                  }
                  return entry
                })
                setTimeline(synced)
              }
            } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {})

    // Load keywordRows from dedicated endpoint (DB is source of truth)
    fetch(`/api/projects/${initialProject.id}/keywords-cache`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.keywordRows?.length) {
          setKeywords(d.keywordRows)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save timeline to DB whenever it changes
  useEffect(() => {
    if (!timeline.length) return
    fetch(`/api/scheduler`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: initialProject.id, timeline }),
    }).catch(() => {})
    try { localStorage.setItem(storageKey, JSON.stringify({ timeline })) } catch { /* ignore */ }
  }, [timeline]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save keywordRows to DB (debounced 1.5s to avoid hammering on every keystroke)
  useEffect(() => {
    if (!keywords.length) return
    const t = setTimeout(() => {
      fetch(`/api/projects/${initialProject.id}/keywords-cache`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordRows: keywords }),
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [keywords]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearTimeline() {
    if (!confirm(`ล้าง Timeline ${timeline.length} รายการ และ Generate ใหม่?`)) return
    setTimeline([])
    // Clear DB
    fetch(`/api/scheduler`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: initialProject.id, timeline: [] }),
    }).catch(() => {})
    // Clear localStorage
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        localStorage.setItem(storageKey, JSON.stringify({ ...parsed, timeline: [] }))
      }
    } catch { /* ignore */ }
  }

  // Save autoSchedule flag to DB (skip on initial mount)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    fetch(`/api/scheduler`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: initialProject.id, autoSchedule }),
    }).catch(() => {})
  }, [autoSchedule]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist timeline to localStorage (keywords are in DB via keywords-cache endpoint)
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ timeline })) } catch { /* ignore */ }
  }, [timeline, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist jobs — localStorage for html (survives navigation/reload), sessionStorage for images (large base64)
  useEffect(() => {
    if (!jobs.length) return
    // sessionStorage: full jobs including base64 images (same-tab only)
    try { sessionStorage.setItem(`${storageKey}-jobs`, JSON.stringify(jobs)) } catch { /* ignore quota */ }
    // localStorage: jobs without base64 images (persists across navigation)
    try {
      const slim = jobs.map(j => ({ ...j, coverImage: '', midImage: '' }))
      localStorage.setItem(`${storageKey}-jobs`, JSON.stringify(slim))
    } catch { /* ignore quota */ }
  }, [jobs, storageKey])

  // ── Auto-scheduler poller ──────────────────────────────────────────────────
  // Refs for stable access inside setInterval without stale closure
  const timelineRef = useRef<TimelineEntry[]>(timeline)
  timelineRef.current = timeline
  const jobsRef = useRef<ArticleJob[]>(jobs)
  jobsRef.current = jobs
  const scheduleDaysRef = useRef<Set<number>>(new Set([1,2,3,4,5]))
  const scheduleSelectedRef = useRef<Set<number> | null>(null)

  useEffect(() => {
    if (schedulerRef.current) clearInterval(schedulerRef.current)
    schedulerRef.current = setInterval(async () => {
      if (!autoScheduleRef.current) return
      if (stopRef.current) return
      // Check day-of-week filter
      const todayDow = new Date().getDay()
      if (!scheduleDaysRef.current.has(todayDow)) return
      const today = new Date().toISOString().slice(0, 10)
      const tl = timelineRef.current
      const currentJobs = jobsRef.current
      const selectedSet = scheduleSelectedRef.current
      // Find pending entries due today or earlier, matching filters
      const due = tl
        .map((e, idx) => ({ e, idx }))
        .filter(({ e, idx }) => {
          if (e.date > today) return false
          if (e.articleStatus !== 'pending') return false
          const job = currentJobs.find(j => j.entryIdx === idx)
          if (job && job.status !== 'idle' && job.status !== 'error') return false
          if (selectedSet !== null && !selectedSet.has(idx)) return false
          return true
        })
      if (due.length === 0) return
      const { idx } = due[0]
      writeArticleRef.current?.(idx)
    }, 5 * 60 * 1000)
    return () => { if (schedulerRef.current) clearInterval(schedulerRef.current) }
  }, []) // only run once on mount; uses refs for fresh values

  // Keep refs in sync
  useEffect(() => { scheduleDaysRef.current = scheduleDays }, [scheduleDays])
  useEffect(() => { scheduleSelectedRef.current = scheduleSelectedEntries }, [scheduleSelectedEntries])

  // Ref to ArticlesTab's writeArticle function so poller can call it
  const writeArticleRef = useRef<((idx: number, adjustNote?: string) => void) | null>(null)

  function handleAutoScheduleToggle(enabled: boolean) {
    setAutoSchedule(enabled)
    if (enabled) {
      stopRef.current = false
      const todayDow = new Date().getDay()
      if (!scheduleDaysRef.current.has(todayDow)) return
      const today = new Date().toISOString().slice(0, 10)
      const selectedSet = scheduleSelectedRef.current
      timelineRef.current
        .map((e, idx) => ({ e, idx }))
        .filter(({ e, idx }) => {
          if (e.date > today || e.articleStatus !== 'pending') return false
          if (selectedSet !== null && !selectedSet.has(idx)) return false
          return true
        })
        .slice(0, 1)
        .forEach(({ idx }) => writeArticleRef.current?.(idx))
    }
  }

  function handleStyleSaved(updated: Partial<ProjectData>) {
    setProject(prev => ({ ...prev, ...updated }))
  }

  const reviewCount = jobs.filter(j => j.status === 'review' && timeline[j.entryIdx]?.articleStatus !== 'approved').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 pt-6 pb-0">
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
          <Link href="/projects" className="hover:text-gray-600">Clients</Link>
          <ChevronRight size={12} />
          <span className="text-gray-700 font-medium">{project.clientName ?? project.name}</span>
        </div>
        {!isClient && (
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{project.clientName ?? project.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{project.industry ?? project.businessType} · {project.website}</p>
            </div>
            <Link href="/content-studio"
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors font-medium">
              ✍️ Content Studio →
            </Link>
          </div>
        )}

        <nav className="flex gap-0 -mb-px">
          {TABS.filter(t => !isClient || CLIENT_TABS.includes(t.id)).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}>
              {t.label}
              {t.id === 'keywords' && keywords.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">{keywords.length}</span>
              )}
              {t.id === 'content-map' && timeline.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-bold">{timeline.length}</span>
              )}
              {t.id === 'review' && reviewCount > 0 && (
                <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">{reviewCount}</span>
              )}
              {t.id === 'lab' && project.styleGuide && (
                <span className="ml-1.5 w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: project.accentColor ?? '#2563eb' }} />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className={`py-6 ${tab === 'keywords' || tab === 'keyword-research' || tab === 'lab' || tab === 'push' || tab === 'articles' || tab === 'content-map' ? 'px-6' : 'px-8 max-w-5xl'}`}>
        {tab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Keywords', value: keywords.length, color: 'text-blue-700', bg: 'bg-blue-50', action: () => setTab('keywords'), hint: 'คลิกเพื่อจัดการ' },
              { label: 'Timeline', value: timeline.length, color: 'text-gray-700', bg: 'bg-gray-50', action: () => setTab('content-map'), hint: 'บทความตาม schedule' },
              { label: 'รอ Review', value: reviewCount, color: 'text-amber-700', bg: 'bg-amber-50', action: () => setTab('review'), hint: 'กด Approve/Adjust' },
              { label: 'Approved', value: timeline.filter(e => e.articleStatus === 'approved').length, color: 'text-emerald-700', bg: 'bg-emerald-50', action: () => {}, hint: 'บทความผ่านแล้ว' },
            ].map(stat => (
              <button key={stat.label} onClick={stat.action}
                className={`${stat.bg} border border-gray-200 rounded-2xl p-4 text-left hover:border-gray-300 transition-colors`}>
                <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
                <div className="text-sm font-medium text-gray-700 mt-0.5">{stat.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{stat.hint}</div>
              </button>
            ))}
          </div>
        )}
        <div className={tab === 'keyword-research' ? '' : 'hidden'}>
          <KeywordResearchTab
            project={project} setKeywords={(kws) => { setWgContentMapKws(kws); setContentMapSource('keyword-research') }} selectedKws={selectedKws} setSelectedKws={setSelectedKws}
            priorityScore={kwPriorityScorerRef.current} onDone={() => setTab('content-map')}
            niche={wgNiche} setNiche={setWgNiche}
            siteUrl={wgSiteUrl} setSiteUrl={setWgSiteUrl}
            queryCount={wgQueryCount} setQueryCount={setWgQueryCount}
            preset={wgPreset} setPreset={setWgPreset}
            intentMix={wgIntentMix} setIntentMix={setWgIntentMix}
            loadingWG={wgLoadingWG} setLoadingWG={setWgLoadingWG}
            progressLog={wgProgressLog} setProgressLog={setWgProgressLog}
            statusMsg={wgStatusMsg} setStatusMsg={setWgStatusMsg}
            resultRows={wgResultRows} setResultRows={setWgResultRows}
            isDragging={wgIsDragging} setIsDragging={setWgIsDragging}
            seedFile={wgSeedFile} setSeedFile={setWgSeedFile}
            seedKeywords={wgSeedKeywords} setSeedKeywords={setWgSeedKeywords}
          />
        </div>
        {tab === 'keywords' && (
          <KeywordsTab project={project} keywords={keywords} setKeywords={setKeywords} onDone={() => { setContentMapSource('keywords'); setTab('content-map') }} selectedKws={selectedKws} setSelectedKws={setSelectedKws} priorityScore={kwPriorityScorerRef.current} userRole={userRole} />
        )}
        {tab === 'content-map' && (
          <ContentMapTab project={project} keywords={contentMapSource === 'keyword-research' ? wgContentMapKws : keywords} selectedKws={selectedKws} timeline={timeline} setTimeline={setTimeline} onClearTimeline={clearTimeline} onDone={() => setTab('articles')} scorerRef={kwPriorityScorerRef} userRole={userRole} />
        )}
        {tab === 'articles' && (
          <ArticlesTab
            project={project} timeline={timeline} setTimeline={setTimeline} jobs={jobs} setJobs={setJobs}
            autoSchedule={autoSchedule} onAutoScheduleToggle={handleAutoScheduleToggle} writeArticleRef={writeArticleRef}
            scheduleDays={scheduleDays} setScheduleDays={setScheduleDays}
            scheduleSelectedEntries={scheduleSelectedEntries} setScheduleSelectedEntries={setScheduleSelectedEntries}
            stopRequested={stopRequested} setStopRequested={setStopRequested} stopRef={stopRef}
          />
        )}
        {tab === 'lab' && (
          <LabTab project={project} onSaved={handleStyleSaved} keywordRows={keywords} />
        )}
        {tab === 'push' && (
          <PushTab
            project={project} timeline={timeline} jobs={jobs}
            wpConnections={wpConnections} setWpConnections={setWpConnections}
            selectedConnId={pushSelectedConnId} setSelectedConnId={setPushSelectedConnId}
            pushJobs={pushJobs} setPushJobs={setPushJobs}
          />
        )}
        {tab === 'publish' && (
          <PublishTab project={project} pushJobs={pushJobs} isClient={isClient} />
        )}
        {tab === 'report' && (
          <ClientReportClient
            project={{
              id:            project.id,
              name:          project.clientName ?? project.name,
              website:       project.website ?? '',
              gscSiteUrl:    (project as { gscSiteUrl?: string | null }).gscSiteUrl ?? null,
              ga4PropertyId: project.ga4PropertyId ?? null,
            }}
            isClient={isClient}
          />
        )}
        {tab === 'review' && (
          <ReviewTab
            project={project}
            timeline={timeline}
            setTimeline={setTimeline}
            jobs={jobs}
            onAdjustRewrite={(entryIdx, note) => writeArticleRef.current?.(entryIdx, note)}
          />
        )}
      </div>
    </div>
  )
}
