'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AppShell from '@/components/layout/AppShell'
import {
  BarChart2, TrendingUp, TrendingDown, RefreshCw, ChevronDown,
  Users, AlertCircle, Download, Calendar, Sparkles, Search,
  MapPin, Monitor, Clock, Target, ShoppingCart, Layers,
  MessageSquare, Send, Bot, User, ChevronUp, Mail, Copy, Check,
  Zap, ArrowRight, FileText, Eye, MousePointer, ChevronRight,
  Edit2, X, Plus, Trash,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { Noto_Sans_Thai } from 'next/font/google'
import MarketShareSection from '@/components/reports/MarketShareSection'
const notoThai = Noto_Sans_Thai({ subsets: ['thai', 'latin'], weight: ['400', '500', '600', '700'] })
const { TrendChart, CampaignBarChart, DonutChart, FunnelBars } = {
  TrendChart:       dynamic(() => import('@/components/reports/ReportCharts').then(m => m.TrendChart),       { ssr: false }),
  CampaignBarChart: dynamic(() => import('@/components/reports/ReportCharts').then(m => m.CampaignBarChart), { ssr: false }),
  DonutChart:       dynamic(() => import('@/components/reports/ReportCharts').then(m => m.DonutChart),       { ssr: false }),
  FunnelBars:       dynamic(() => import('@/components/reports/ReportCharts').then(m => m.FunnelBars),       { ssr: false }),
}
import { formatCurrency, formatNumber, formatConversions, pctChangeColor, metricValueColor } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoogleAdsAccount { id: string; descriptiveName: string; currencyCode: string; testAccount: boolean }

interface PctChanges {
  cost?: number | null; impressions?: number | null; clicks?: number | null
  conversions?: number | null; ctr?: number | null; cpc?: number | null
  cpa?: number | null; convRate?: number | null
}

interface CampaignRow {
  campaignName: string; cost: number; impressions: number; clicks: number
  conversions: number; ctr: number; cpc: number; cpa: number; conversionRate: number
  changes?: PctChanges
}

interface NarrativeReport {
  headline:             string
  performance:          string
  winners:              string
  concerns:             string
  actions:              string[]
  outlook:              string
  keyInsights?:         string[]
  deviceAnalysis?:      string
  locationInsights?:    string
  wastedBudget?:        string
  clientSummary?:       string
  // Strategic planner fields
  strategicContext?:      string
  strategicNextStep?:     string
  clientTalkingPoints?:   string[]
  // Closing summary paragraph
  executiveSummary?:      string
}

interface WeeklyReport {
  summary: {
    totalCost: number; totalConversions: number; totalClicks: number; totalImpressions: number
    blendedCPA: number; blendedCTR: number; targetCPA: number; cpaVsTarget: number | null; period: string
    changes?: {
      totalCost: number | null; totalConversions: number | null; totalClicks: number | null
      totalImpressions: number | null; blendedCPA: number | null; blendedCTR: number | null
    }
  }
  campaigns: CampaignRow[]
  recommendations: Array<{ campaignName: string; type: string; priority: 'critical' | 'high' | 'medium' | 'low'; title: string; detail: string; action: string; estimatedImpact?: string }>
}

interface DimKeyword { keyword: string; matchType: string; qualityScore: number | null; impressions: number; clicks: number; cost: number; conversions: number; ctr: number; cpc: number; cpa: number }
interface DimAudience { audienceName: string; type: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number; cpc: number; cpa: number }
interface DimLocation { location: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number; cpc: number; cpa: number }
interface DimDevice { device: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number; cpc: number; cpa: number }
interface DimSearchTerm { searchTerm: string; matchedKeyword: string; impressions: number; clicks: number; cost: number; conversions: number; ctr: number; cpc: number; cpa: number }
interface DimTime { date: string; impressions: number; clicks: number; cost: number; conversions: number }
interface DimConversionAction { conversionName: string; category: string; conversions: number; value: number; allConversions: number; viewThroughConversions: number }
interface EcommerceFunnel { view_item: number; add_to_cart: number; begin_checkout: number; purchase: number; revenue: number; roas: number; aov: number; cartAbandonRate: number; checkoutAbandonRate: number }

const DATE_RANGES = [
  { value: 'LAST_7_DAYS', label: '7 วัน' },
  { value: 'LAST_30_DAYS', label: '30 วัน' },
  { value: 'LAST_90_DAYS', label: '90 วัน' },
  { value: 'THIS_MONTH', label: 'เดือนนี้' },
  { value: 'LAST_MONTH', label: 'เดือนที่แล้ว' },
  { value: 'CUSTOM', label: 'กำหนดเอง...' },
]

// Label สำหรับทั้ง preset และช่วง CUSTOM_start_end
function rangeLabel(dateRange: string): string {
  const m = dateRange.match(/^CUSTOM_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/)
  if (m) return `${m[1]} – ${m[2]}`
  return DATE_RANGES.find(r => r.value === dateRange)?.label ?? dateRange
}

const PRIORITY_COLOR = {
  critical: 'bg-red-50 border-red-200 text-red-700',
  high:     'bg-orange-50 border-orange-200 text-orange-700',
  medium:   'bg-yellow-50 border-yellow-200 text-yellow-700',
  low:      'bg-blue-50 border-blue-200 text-blue-700',
}
const PRIORITY_LABEL = { critical: 'วิกฤต', high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' }

const DEVICE_LABEL: Record<string, string> = { MOBILE: '📱 Mobile', DESKTOP: '🖥️ Desktop', TABLET: '📲 Tablet', CONNECTED_TV: '📺 TV' }
const MATCH_LABEL: Record<string, string> = { BROAD: 'Broad', PHRASE: 'Phrase', EXACT: 'Exact' }
const MATCH_COLOR: Record<string, string> = { BROAD: 'bg-blue-50 text-blue-700', PHRASE: 'bg-purple-50 text-purple-700', EXACT: 'bg-green-50 text-green-700' }

// ── Mini helpers ──────────────────────────────────────────────────────────────

function Trend({ value, metricKey, inverse }: { value: number | null; metricKey?: string; inverse?: boolean }) {
  if (value === null) return null
  const colorCls = metricKey
    ? pctChangeColor(metricKey, value)
    : (inverse ? (value <= 0 ? 'text-emerald-600' : 'text-red-500') : (value >= 0 ? 'text-emerald-600' : 'text-red-500'))
  const good = colorCls.includes('emerald')
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', colorCls)}>
      {good ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {value >= 0 ? '+' : ''}{typeof value === 'number' ? value.toFixed(2) : value}%
    </span>
  )
}

function ChangeBadge({ metricKey, value }: { metricKey: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null
  const colorCls = pctChangeColor(metricKey, value)
  const good = colorCls.includes('emerald')
  const sign = value > 0 ? '+' : ''
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold whitespace-nowrap px-1.5 py-px rounded-full', colorCls, good ? 'bg-emerald-50' : 'bg-red-50')}>
      {good ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {sign}{typeof value === 'number' ? value.toFixed(2) : value}%
    </span>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-3 text-left text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.08em]', className)}>{children}</th>
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-[13px] text-[#3D4852] tabular-nums', className)}>{children}</td>
}

type SortDir = 'asc' | 'desc'
function SortTh({ col, label, sortKey, sortDir, onSort, className }: {
  col: string; label: string; sortKey: string; sortDir: SortDir; onSort: (col: string) => void; className?: string
}) {
  const active = sortKey === col
  return (
    <th
      onClick={() => onSort(col)}
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors',
        'hover:bg-gray-100 whitespace-nowrap',
        active ? 'text-blue-600 bg-blue-50' : 'text-gray-500',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col leading-none">
          <span className={cn('text-[8px]', active && sortDir === 'asc' ? 'text-blue-600' : 'text-gray-300')}>▲</span>
          <span className={cn('text-[8px]', active && sortDir === 'desc' ? 'text-blue-600' : 'text-gray-300')}>▼</span>
        </span>
      </span>
    </th>
  )
}

function sortRows<T extends Record<string, unknown>>(data: T[], key: string, dir: SortDir): T[] {
  return [...data].sort((a, b) => {
    const av = a[key]; const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1; if (bv == null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'desc' ? -cmp : cmp
  })
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button onClick={onClick} className={cn(
      'flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-full whitespace-nowrap transition-all',
      active ? 'bg-[#3E5F58] text-white shadow-sm' : 'text-[#6B7680] hover:bg-[#EEF2F0] hover:text-[#3D4852]'
    )}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function EmptyDim({ note }: { note?: string } = {}) {
  return (
    <div className="text-center py-12 text-gray-400">
      <BarChart2 className="w-10 h-10 mx-auto mb-2 text-gray-200" />
      <p className="text-sm">ไม่มีข้อมูล — กด Sync & Refresh</p>
      {note && <p className="text-xs text-gray-300 mt-2 max-w-md mx-auto leading-relaxed">{note}</p>}
    </div>
  )
}

function MetricBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return <div className="w-16 h-1.5 bg-[#EEF2F0] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#5B9E92,#A9CCC4)' }} /></div>
}

// ── Funnel step ───────────────────────────────────────────────────────────────
function FunnelStep({ label, value, prev, color }: { label: string; value: number; prev?: number; color: string }) {
  const rate = prev && prev > 0 ? ((value / prev) * 100).toFixed(2) : null
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn('w-full rounded-xl py-4 px-3 text-center', color)}>
        <p className="text-xl font-bold">{formatNumber(value)}</p>
        <p className="text-xs font-medium mt-0.5">{label}</p>
        {rate && <p className="text-[10px] mt-1 opacity-70">rate {rate}%</p>}
      </div>
      {prev && <div className="text-[10px] text-gray-400">↓ {rate}%</div>}
    </div>
  )
}

// ── Opening brief message from GG Expert after reading the report ─────────────

function buildOpeningBrief(nr: NarrativeReport, targetCPA: string): string {
  const cpaNum = Number(targetCPA) || 0
  const lines: string[] = []

  // Lead with verdict
  lines.push(`อ่าน report เรียบร้อยแล้วครับ`)
  lines.push('')
  lines.push(`**สรุปสิ่งที่เห็น:**`)
  lines.push(nr.headline)

  // Winners
  if (nr.winners) {
    lines.push('')
    lines.push(`**จุดที่น่าดีใจ:**`)
    lines.push(nr.winners)
  }

  // Concerns with urgency
  if (nr.concerns) {
    lines.push('')
    lines.push(`**จุดที่ต้องระวัง:**`)
    lines.push(nr.concerns)
  }

  // Top action
  if (nr.actions?.length) {
    lines.push('')
    lines.push(`**สิ่งที่ควรทำก่อนเลยคือ:**`)
    lines.push(`→ ${nr.actions[0]}`)
  }

  // Strategic context if available
  if (nr.strategicContext) {
    lines.push('')
    lines.push(`**บริบทเชิงกลยุทธ์:**`)
    lines.push(nr.strategicContext)
  }

  lines.push('')
  lines.push(cpaNum > 0
    ? `Target CPA ตั้งไว้ ฿${cpaNum.toLocaleString()} — ถามได้เลยครับว่าอยากรู้เรื่องไหนเพิ่ม จะช่วยอธิบายหรือเตรียม talking points สำหรับคุยกับลูกค้าก็ได้`
    : `ถามได้เลยครับ จะช่วยวิเคราะห์เพิ่ม หรือเตรียม talking points สำหรับคุยกับลูกค้าก็ได้`)

  return lines.join('\n')
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type DimTab = 'overview' | 'campaigns' | 'keywords' | 'search_terms' | 'text_ads' | 'audiences' | 'locations' | 'devices' | 'time' | 'conversions' | 'ecommerce'

interface TextAd {
  campaignName: string
  adGroupName: string
  adId: string
  type: string
  headlines: string[]
  descriptions: string[]
  finalUrl: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  adStrength?: string
}

export default function ReportsPage() {
  const [accounts, setAccounts]               = useState<GoogleAdsAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [selectedId, setSelectedId]           = useState('')
  const [dateRange, setDateRange]             = useState('LAST_30_DAYS')
  const [targetCPA, setTargetCPA]             = useState('500')
  const [kpiType, setKpiType]                 = useState<'CPA' | 'ROAS'>('CPA')   // แต่ละเว็บ KPI ไม่เหมือนกัน — เลือกได้
  const [targetROAS, setTargetROAS]           = useState('4')
  const [customStart, setCustomStart]         = useState('')
  const [customEnd, setCustomEnd]             = useState('')

  // Refs so async callbacks always see latest values without stale closures
  const selectedIdRef  = useRef(selectedId)
  const dateRangeRef   = useRef(dateRange)
  const targetCPARef   = useRef(targetCPA)
  useEffect(() => { selectedIdRef.current = selectedId },  [selectedId])
  useEffect(() => { dateRangeRef.current  = dateRange },   [dateRange])
  useEffect(() => { targetCPARef.current  = targetCPA },   [targetCPA])

  // Target CPA ต่อบัญชี — แต่ละเว็บ KPI ไม่เท่ากัน จำค่าล่าสุดของแต่ละ account ไว้
  useEffect(() => {
    if (!selectedId) return
    try {
      const saved = localStorage.getItem(`reports-tcpa:${selectedId}`)
      if (saved) setTargetCPA(saved)
      const savedKpi = localStorage.getItem(`reports-kpi:${selectedId}`)
      if (savedKpi === 'CPA' || savedKpi === 'ROAS') setKpiType(savedKpi)
      const savedRoas = localStorage.getItem(`reports-troas:${selectedId}`)
      if (savedRoas) setTargetROAS(savedRoas)
    } catch { /* private mode */ }
  }, [selectedId])
  const [report, setReport]                   = useState<WeeklyReport | null>(null)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState<string | null>(null)
  const [syncing, setSyncing]                 = useState(false)
  const [activeTab, setActiveTab]             = useState<DimTab>('overview')

  // Dimension data
  const [keywords, setKeywords]       = useState<DimKeyword[] | null>(null)
  const [audiences, setAudiences]     = useState<DimAudience[] | null>(null)
  const [locations, setLocations]     = useState<DimLocation[] | null>(null)
  const [devices, setDevices]         = useState<DimDevice[] | null>(null)
  const [searchTerms, setSearchTerms] = useState<DimSearchTerm[] | null>(null)
  const [timeData, setTimeData]       = useState<DimTime[] | null>(null)
  const [conversions, setConversions] = useState<{ actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null } | null>(null)
  const [textAds, setTextAds] = useState<TextAd[] | null>(null)
  const [ecommerce, setEcommerce]     = useState<{ actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null } | null>(null)
  const [dimLoading, setDimLoading]   = useState<Record<string, boolean>>({})

  // Text Ad inline edit state
  const [editingAdId, setEditingAdId] = useState<string | null>(null)
  const [editHeadlines, setEditHeadlines] = useState<string[]>([])
  const [editDescriptions, setEditDescriptions] = useState<string[]>([])
  const [pushingAdId, setPushingAdId] = useState<string | null>(null)
  const [pushAdResult, setPushAdResult] = useState<Record<string, 'ok' | 'error'>>({})

  function startEditAd(ad: TextAd) {
    setEditingAdId(ad.adId)
    setEditHeadlines([...ad.headlines])
    setEditDescriptions([...ad.descriptions])
    setPushAdResult(prev => { const n = { ...prev }; delete n[ad.adId]; return n })
  }

  function cancelEditAd() {
    setEditingAdId(null)
    setEditHeadlines([])
    setEditDescriptions([])
  }

  async function pushAdEdit(ad: TextAd) {
    if (!selectedId || !ad.adId) return
    const cid = selectedId.replace(/-/g, '')
    setPushingAdId(ad.adId)
    try {
      const res = await fetch(`/api/campaign-edit/ads?customerId=${cid}&adId=${ad.adId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headlines: editHeadlines.filter(h => h.trim()),
          descriptions: editDescriptions.filter(d => d.trim()),
          finalUrls: [ad.finalUrl],
        }),
      })
      if (res.ok) {
        // Update local state
        setTextAds(prev => prev ? prev.map(a => a.adId === ad.adId
          ? { ...a, headlines: editHeadlines.filter(h => h.trim()), descriptions: editDescriptions.filter(d => d.trim()) }
          : a
        ) : prev)
        setPushAdResult(prev => ({ ...prev, [ad.adId]: 'ok' }))
        setEditingAdId(null)
      } else {
        setPushAdResult(prev => ({ ...prev, [ad.adId]: 'error' }))
      }
    } catch {
      setPushAdResult(prev => ({ ...prev, [ad.adId]: 'error' }))
    } finally {
      setPushingAdId(null)
    }
  }

  // Narrative (loaded AFTER all data)
  const [narrative, setNarrative]             = useState<NarrativeReport | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)

  // Inline report chat
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput]       = useState('')
  const [chatLoading, setChatLoading]   = useState(false)
  const [chatBriefed, setChatBriefed]   = useState(false)
  const [chatOpen, setChatOpen]         = useState(true)
  const chatEndRef = useRef<HTMLDivElement>(null)
  // Email draft
  const [emailLang, setEmailLang]       = useState<'th' | 'en'>('th')
  const [emailDraft, setEmailDraft]     = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailOpen, setEmailOpen]       = useState(false)

  // ── เลือกข้อมูลที่จะใส่ในรายงาน (มีผลทั้ง Export HTML และเมล) ──
  const EXPORT_SECTIONS: { key: string; label: string }[] = [
    { key: 'kpi',         label: 'KPI Summary' },
    { key: 'charts',      label: 'กราฟ Spend / Device' },
    { key: 'funnel',      label: 'Marketing Funnel' },
    { key: 'marketShare', label: 'Market Share (Visibility)' },
    { key: 'campaigns',   label: 'Campaigns' },
    { key: 'keywords',    label: 'Keywords' },
    { key: 'searchTerms', label: 'Search Terms' },
    { key: 'audiences',   label: 'Audiences' },
    { key: 'locations',   label: 'Locations' },
    { key: 'devices',     label: 'Devices' },
    { key: 'conversions', label: 'Conversion Actions' },
    { key: 'textAds',     label: 'Text Ads' },
    { key: 'narrative',   label: 'บทวิเคราะห์ + คำแนะนำ' },
  ]
  const [exportSections, setExportSections] = useState<Record<string, boolean>>({})
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  const sec = (k: string) => exportSections[k] !== false
  useEffect(() => {
    try { const saved = localStorage.getItem('reports-export-sections'); if (saved) setExportSections(JSON.parse(saved)) } catch { /* noop */ }
  }, [])
  function saveSections(next: Record<string, boolean>) {
    setExportSections(next)
    try { localStorage.setItem('reports-export-sections', JSON.stringify(next)) } catch { /* noop */ }
  }
  const hiddenCount = EXPORT_SECTIONS.filter(x => exportSections[x.key] === false).length
  const [emailCopied, setEmailCopied]   = useState(false)

  // ── Sort state for each table ─────────────────────────────────────────────────
  const [campSortKey, setCampSortKey] = useState('cost')
  const [campSortDir, setCampSortDir] = useState<SortDir>('desc')
  const [kwSortKey,   setKwSortKey]   = useState('cost')
  const [kwSortDir,   setKwSortDir]   = useState<SortDir>('desc')
  const [stSortKey,   setStSortKey]   = useState('cost')
  const [stSortDir,   setStSortDir]   = useState<SortDir>('desc')
  const [audSortKey,  setAudSortKey]  = useState('cost')
  const [audSortDir,  setAudSortDir]  = useState<SortDir>('desc')
  const [locSortKey,  setLocSortKey]  = useState('cost')
  const [locSortDir,  setLocSortDir]  = useState<SortDir>('desc')

  const campSort = {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    sorted:  useMemo(() => report?.campaigns ? sortRows(report.campaigns as unknown as Record<string, unknown>[], campSortKey, campSortDir) : [], [report?.campaigns, campSortKey, campSortDir]),
    sortKey: campSortKey, sortDir: campSortDir,
    onSort:  (col: string) => { if (col === campSortKey) setCampSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setCampSortKey(col); setCampSortDir('desc') } },
  }
  const kwSort = {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    sorted:  useMemo(() => keywords ? sortRows(keywords as unknown as Record<string, unknown>[], kwSortKey, kwSortDir) : [], [keywords, kwSortKey, kwSortDir]),
    sortKey: kwSortKey, sortDir: kwSortDir,
    onSort:  (col: string) => { if (col === kwSortKey) setKwSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setKwSortKey(col); setKwSortDir('desc') } },
  }
  const stSort = {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    sorted:  useMemo(() => searchTerms ? sortRows(searchTerms as unknown as Record<string, unknown>[], stSortKey, stSortDir) : [], [searchTerms, stSortKey, stSortDir]),
    sortKey: stSortKey, sortDir: stSortDir,
    onSort:  (col: string) => { if (col === stSortKey) setStSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setStSortKey(col); setStSortDir('desc') } },
  }
  const audSort = {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    sorted:  useMemo(() => audiences ? sortRows(audiences as unknown as Record<string, unknown>[], audSortKey, audSortDir) : [], [audiences, audSortKey, audSortDir]),
    sortKey: audSortKey, sortDir: audSortDir,
    onSort:  (col: string) => { if (col === audSortKey) setAudSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setAudSortKey(col); setAudSortDir('desc') } },
  }
  const locSort = {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    sorted:  useMemo(() => locations ? sortRows(locations as unknown as Record<string, unknown>[], locSortKey, locSortDir) : [], [locations, locSortKey, locSortDir]),
    sortKey: locSortKey, sortDir: locSortDir,
    onSort:  (col: string) => { if (col === locSortKey) setLocSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setLocSortKey(col); setLocSortDir('desc') } },
  }

  // Load accounts
  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json() as Promise<{ accounts: GoogleAdsAccount[] }>)
      .then((d) => {
        setAccounts(d.accounts ?? [])
        if (d.accounts?.length > 0) setSelectedId(d.accounts[0].id)
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false))
  }, [])

  // Auto-load when account/dateRange changes
  useEffect(() => {
    if (selectedId) { loadReport() }
  }, [selectedId, dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  // All async functions read from refs — no stale closures, no circular deps
  const loadNarrative = useCallback(async (
    reportData: WeeklyReport,
    kw: DimKeyword[] | null,
    dev: DimDevice[] | null,
    loc: DimLocation[] | null,
    st: DimSearchTerm[] | null,
    convData?: { actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null } | null,
  ) => {
    setNarrativeLoading(true)
    setNarrative(null)
    setChatMessages([])
    setChatBriefed(false)
    try {
      // Detect ecommerce: sum conversion value from conversion actions
      const totalConvValue = (convData?.actions ?? []).reduce((a, c) => a + c.value, 0)
      const isEcommerce = totalConvValue > 0
      const totalCostForRoas = reportData.summary.totalCost
      const roas = isEcommerce && totalCostForRoas > 0 ? parseFloat((totalConvValue / totalCostForRoas).toFixed(2)) : undefined

      const res = await fetch('/api/reports/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRange: dateRangeRef.current,
          targetCPA: Number(targetCPARef.current),
          summary: reportData.summary,
          campaigns: reportData.campaigns.map((c) => ({
            campaignName: c.campaignName,
            cost: c.cost,
            conversions: c.conversions,
            cpa: c.cpa,
            ctr: c.ctr,
            clicks: c.clicks,
            changes: c.changes ? { cpa: c.changes.cpa } : undefined,
          })),
          keywords: kw?.map((k) => ({ keyword: k.keyword, cost: k.cost, conversions: k.conversions, cpa: k.cpa, qualityScore: k.qualityScore })),
          devices:  dev?.map((d) => ({ device: d.device, cost: d.cost, conversions: d.conversions, cpa: d.cpa, ctr: d.ctr })),
          locations: loc?.map((l) => ({ location: l.location, cost: l.cost, conversions: l.conversions, cpa: l.cpa })),
          searchTerms: st?.map((s) => ({ searchTerm: s.searchTerm, cost: s.cost, conversions: s.conversions, ctr: s.ctr })),
          recommendations: reportData.recommendations.map((r) => ({ priority: r.priority, title: r.title, action: r.action })),
          totalConversionValue: isEcommerce ? totalConvValue : undefined,
          roas,
          accountType: isEcommerce ? 'ecommerce' : 'general',
        }),
      })
      if (res.ok) {
        const nr = await res.json() as NarrativeReport
        setNarrative(nr)
        // Inject opening brief from GG Expert — summarise what was read, ready to discuss
        setChatBriefed(false)
        setChatMessages([{
          role: 'assistant',
          content: buildOpeningBrief(nr, targetCPARef.current),
        }])
      }
    } catch { /* silent */ } finally {
      setNarrativeLoading(false)
    }
  }, []) // refs, no deps needed

  const loadAllDimensions = useCallback(async (reportData?: WeeklyReport) => {
    const cid = selectedIdRef.current
    const dr  = dateRangeRef.current
    if (!cid) return

    // Mark all tabs loading
    const types = ['keywords', 'audiences', 'locations', 'devices', 'search_terms', 'time', 'conversions', 'ecommerce', 'text_ads']
    setDimLoading(Object.fromEntries(types.map((t) => [t, true])))

    try {
      // Fetch dimensions + text ads in parallel
      const [res, adsRes] = await Promise.all([
        fetch(`/api/reports/dimensions?customerId=${cid}&dateRange=${dr}&type=all`),
        fetch(`/api/reports/text-ads?customerId=${cid}&dateRange=${dr}`),
      ])
      if (!res.ok) return

      const json = await res.json() as Record<string, unknown>
      setKeywords(json.keywords     as DimKeyword[])
      setAudiences(json.audiences   as DimAudience[])
      setLocations(json.locations   as DimLocation[])
      setDevices(json.devices       as DimDevice[])
      setSearchTerms(json.search_terms as DimSearchTerm[])
      setTimeData(json.time         as DimTime[])
      setConversions(json.conversions as { actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null })
      setEcommerce(json.ecommerce   as { actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null })

      if (adsRes.ok) {
        const adsJson = await adsRes.json() as { ads: TextAd[] }
        setTextAds(adsJson.ads ?? [])
      }

      if (reportData) {
        loadNarrative(
          reportData,
          json.keywords     as DimKeyword[]    ?? null,
          json.devices      as DimDevice[]     ?? null,
          json.locations    as DimLocation[]   ?? null,
          json.search_terms as DimSearchTerm[] ?? null,
          json.conversions  as { actions: DimConversionAction[]; ecommerceFunnel: EcommerceFunnel | null } ?? null,
        )
      }
    } catch { /* silent */ } finally {
      setDimLoading(Object.fromEntries(types.map((t) => [t, false])))
    }
  }, [loadNarrative]) // stable: loadNarrative has [] deps

  const loadReport = useCallback(async () => {
    const cid = selectedIdRef.current
    const dr  = dateRangeRef.current
    const cpa = targetCPARef.current
    if (!cid) return
    setLoading(true); setError(null); setNarrative(null); setChatMessages([]); setChatBriefed(false)
    try {
      const res = await fetch(`/api/reports/weekly?customerId=${cid}&targetCPA=${cpa}&dateRange=${dr}`)
      if (!res.ok) throw new Error('โหลด report ไม่สำเร็จ')
      const data = await res.json() as WeeklyReport
      setReport(data)
      loadAllDimensions(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }, [loadAllDimensions])

  const syncData = async () => {
    if (!selectedId) return
    setSyncing(true)
    await fetch('/api/performance/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: selectedId, dateRange }) }).catch(() => {})
    setSyncing(false)
    loadReport()
  }

  // Client-safe context: raw data + performance analysis only — NO strategic/internal content
  function buildClientContext(): string {
    if (!report) return ''
    const parts: string[] = []
    if (report.summary) {
      const s = report.summary
      parts.push(`## Account Performance (${s.period})`)
      parts.push(`Spend: ฿${s.totalCost.toLocaleString()} | Conv: ${s.totalConversions} | CPA: ฿${s.blendedCPA.toFixed(0)} | CTR: ${s.blendedCTR.toFixed(2)}% | Target CPA: ฿${s.targetCPA}`)
      if (s.cpaVsTarget !== null) parts.push(`CPA vs Target: ${s.cpaVsTarget > 0 ? '+' : ''}${s.cpaVsTarget}%`)
      // KPI หลักของบัญชี + ข้อมูลยอดขายฝั่ง ecommerce — ให้ AI เล่าเรื่องด้วย metric ที่ผู้บริหารสนใจจริง
      const ctxConvValue = (conversions?.actions ?? []).reduce((a, c) => a + c.value, 0)
      if (kpiType === 'ROAS') {
        const liveRoas = ctxConvValue > 0 && s.totalCost > 0 ? (ctxConvValue / s.totalCost).toFixed(2) : 'N/A'
        parts.push(`PRIMARY KPI: ROAS (target ${targetROAS}x) | Conv. Value: ฿${Math.round(ctxConvValue).toLocaleString()} | Actual ROAS: ${liveRoas}x | AOV: ฿${s.totalConversions > 0 ? Math.round(ctxConvValue / s.totalConversions).toLocaleString() : 'N/A'}`)
      } else {
        parts.push(`PRIMARY KPI: CPA (target ฿${s.targetCPA}) — จำนวน conversions และต้นทุนต่อ conversion คือตัวชี้วัดหลัก`)
      }
      const fn = ecommerce?.ecommerceFunnel
      if (fn && fn.purchase > 0) {
        parts.push(`Ecommerce Funnel: View ${fn.view_item.toLocaleString()} → Add to Cart ${fn.add_to_cart.toLocaleString()} → Checkout ${fn.begin_checkout.toLocaleString()} → Purchase ${fn.purchase.toLocaleString()} | Revenue ฿${Math.round(fn.revenue).toLocaleString()} | Cart Abandon ${fn.cartAbandonRate.toFixed(1)}%`)
      }
      if (s.changes) {
        parts.push(`Changes vs prior: Cost ${s.changes.totalCost ?? 'N/A'}% | Conv ${s.changes.totalConversions ?? 'N/A'}% | CPA ${s.changes.blendedCPA ?? 'N/A'}% | CTR ${s.changes.blendedCTR ?? 'N/A'}%`)
      }
    }
    // เคารพตัวเลือก "เลือกข้อมูล" — section ที่ปิดไว้จะไม่ถูกส่งให้ AI เขียนเมล
    if (sec('campaigns') && report.campaigns?.length) {
      parts.push(`\n## Campaigns`)
      for (const c of report.campaigns) {
        const cpaChange = c.changes?.cpa != null ? ` | CPA change: ${c.changes.cpa > 0 ? '+' : ''}${c.changes.cpa}%` : ''
        parts.push(`- ${c.campaignName}: ฿${c.cost.toLocaleString()} spend | ${c.conversions} conv | CPA ฿${c.cpa.toFixed(0)} | CTR ${c.ctr.toFixed(2)}%${cpaChange}`)
      }
    }
    // Performance narrative — winners/concerns/wasted only (no strategic planner)
    if (sec('narrative') && narrative) {
      if (narrative.headline)      parts.push(`\n## Performance Headline\n${narrative.headline}`)
      if (narrative.clientSummary) parts.push(`\n## Summary\n${narrative.clientSummary}`)
      if (narrative.winners)       parts.push(`\n## Winners\n${narrative.winners}`)
      if (narrative.concerns)      parts.push(`\n## Concerns\n${narrative.concerns}`)
      if (narrative.wastedBudget)  parts.push(`\n## Wasted Budget\n${narrative.wastedBudget}`)
      if (narrative.deviceAnalysis)   parts.push(`\n## Device Analysis\n${narrative.deviceAnalysis}`)
      if (narrative.locationInsights) parts.push(`\n## Location Insights\n${narrative.locationInsights}`)
    }
    if (sec('keywords') && keywords?.length) {
      parts.push(`\n## Keywords (top by spend)`)
      for (const k of keywords.slice(0, 10)) {
        parts.push(`- "${k.keyword}" [${k.matchType}]: ฿${k.cost.toFixed(0)} | ${k.conversions} conv | QS ${k.qualityScore ?? 'N/A'} | CPA ฿${k.cpa.toFixed(0)}`)
      }
    }
    if (sec('searchTerms') && searchTerms?.length) {
      parts.push(`\n## Search Terms (top by spend)`)
      for (const s of searchTerms.slice(0, 10)) {
        parts.push(`- "${s.searchTerm}": ฿${s.cost.toFixed(0)} | ${s.conversions} conv | CTR ${s.ctr.toFixed(2)}%`)
      }
    }
    if (sec('devices') && devices?.length) {
      parts.push(`\n## Devices`)
      for (const d of devices) parts.push(`- ${d.device}: ฿${d.cost.toFixed(0)} | ${d.conversions} conv | CPA ฿${d.cpa.toFixed(0)}`)
    }
    if (sec('locations') && locations?.length) {
      parts.push(`\n## Locations (top 5)`)
      for (const l of locations.slice(0, 5)) parts.push(`- ${l.location}: ฿${l.cost.toFixed(0)} | ${l.conversions} conv | CPA ฿${l.cpa.toFixed(0)}`)
    }
    if (sec('narrative') && report.recommendations?.length) {
      parts.push(`\n## Recommendations`)
      for (const r of report.recommendations.slice(0, 6)) {
        parts.push(`- [${r.priority.toUpperCase()}] ${r.title}: ${r.action}`)
      }
    }
    return parts.join('\n')
  }

  // Full internal context: includes Strategic Planner — for team chat only
  function buildReportContext(): string {
    const base = buildClientContext()
    if (!narrative) return base
    const internal: string[] = []
    if (narrative.strategicContext)  internal.push(`\n## Strategic Context (Internal)\n${narrative.strategicContext}`)
    if (narrative.strategicNextStep) internal.push(`\n## Strategic Next Step (Internal)\n${narrative.strategicNextStep}`)
    if (narrative.clientTalkingPoints?.length) {
      internal.push(`\n## Client Talking Points (Internal)`)
      narrative.clientTalkingPoints.forEach((p) => internal.push(`- ${p}`))
    }
    return base + internal.join('\n')
  }

  async function sendChat() {
    const text = chatInput.trim()
    if (!text || chatLoading) return
    setChatInput('')
    const userMsg = { role: 'user' as const, content: text }
    setChatMessages((prev) => [...prev, userMsg])
    setChatLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chatMessages, userMsg],
          customerId: selectedId,
          accountName: selectedAccount?.descriptiveName ?? '',
          reportContext: buildReportContext(),
        }),
      })
      if (!res.ok) throw new Error('Chat failed')
      const data = await res.json() as { content: string }
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.content }])
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: 'ขอโทษครับ เกิดข้อผิดพลาด ลองใหม่อีกครั้งได้เลย' }])
    } finally {
      setChatLoading(false)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  async function generateEmail() {
    if (!narrative || emailLoading) return
    setEmailLoading(true)
    setEmailOpen(true)
    setEmailDraft('')
    const lang = emailLang === 'th' ? 'Thai' : 'English'
    let ctx  = buildClientContext()
    // Market Share เข้าเมลเมื่อถูกเลือกใน "เลือกข้อมูล"
    if (sec('marketShare') && selectedId) {
      try {
        const r = await fetch(`/api/reports/market-share?customerId=${selectedId}&dateRange=${dateRange}`)
        if (r.ok) {
          const ms = await r.json() as { overview?: { search?: { impressionShare: number; lostBudget: number; lostRank: number; topShare: number | null } | null; display?: { impressionShare: number } | null } }
          const sv = ms.overview?.search
          const p = (v: number | null | undefined) => v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`
          if (sv) ctx += `\n\n## Visibility Share (Impression Share)\nSearch IS: ${p(sv.impressionShare)} | Lost by Budget: ${p(sv.lostBudget)} | Lost by Rank: ${p(sv.lostRank)} | Top: ${p(sv.topShare)}${ms.overview?.display ? ` | Display IS: ${p(ms.overview.display.impressionShare)}` : ''}`
        }
      } catch { /* เมลต่อได้โดยไม่มี MS */ }
    }
    const acctName = selectedAccount?.descriptiveName ?? 'Client'
    const period   = rangeLabel(dateRange)
    const kpiHint = kpiType === 'ROAS'
      ? `KPI หลักของบัญชีนี้คือ ROAS (เป้า ${targetROAS}x) — เล่าเรื่องด้วยยอดขาย (Conv. Value), ROAS เทียบเป้า และ AOV เป็นหลัก · CPA/CTR เป็นตัวรองในตารางเท่านั้น`
      : `KPI หลักของบัญชีนี้คือ CPA — เล่าเรื่องด้วยจำนวน Conversions และต้นทุนต่อ conversion เทียบเป้าเป็นหลัก`
    const prompt = emailLang === 'th'
      ? `คุณคือ Head of Performance ของ agency ชั้นนำ เขียนอีเมลรายงานผลถึง "คณะผู้บริหาร" ของลูกค้า
ผู้อ่านคือ CEO/CMO ที่มีเวลา 2 นาที ไม่ใช่คนทำ ads — เขาสนใจ 3 อย่าง: ได้ผลลัพธ์อะไร คุ้มเงินไหม ต้องตัดสินใจอะไร

${kpiHint}

กฎเขียน (ห้ามละเมิด):
- ห้ามใช้ ** ## -- * > backtick และ Emoji ทุกชนิด · หัวข้อเป็นข้อความธรรมดาใส่หมายเลข · ตารางใช้ | และ - เท่านั้น
- ภาษาธุรกิจ ไม่ใช้ศัพท์เทคนิค ads ในเนื้อความ (Impressions/CTR/CPC/Quality Score อยู่ได้เฉพาะในตาราง) — แปลงทุกอย่างเป็น เงิน ยอดขาย จำนวนลูกค้า และ % เทียบเป้า
- ทุก claim มีตัวเลขจริงกำกับ ห้ามประดิษฐ์ตัวเลข ห้ามคำฟุ่มเฟือย ("เป็นที่น่ายินดี", "อย่างมีนัยสำคัญ" — ตัดทิ้ง)
- เนื้อความรวมไม่เกิน 350 คำ (ไม่นับตาราง) — สั้นแต่ชัดคือหัวใจ
- ความมั่นใจต้องตรงกับข้อมูล: ถ้าข้อมูลมีปัญหา (เช่น tracking เพี้ยน) บอกตรงๆ พร้อมผลกระทบ

โครงสร้าง (ตามนี้เป๊ะ):

Subject: ${acctName} — ผล Google Ads ${period}: [ผลลัพธ์ธุรกิจที่เด่นที่สุด 1 จุด สั้นๆ เช่น "ROAS 21.9x เกินเป้า 4 เท่า"]

เรียน คณะผู้บริหาร ${acctName}

สรุปสำหรับผู้บริหาร
- [3-5 bullets ตัวเลขธุรกิจล้วน: ใช้งบเท่าไร ได้อะไรกลับมา เทียบเป้าเป็น % · ปิดด้วย 1 bullet "สิ่งที่ขอให้พิจารณาในเมลนี้: ..."]

1. ผลลัพธ์เทียบเป้าหมาย

[ตาราง KPI 4-6 แถว — เลือกเฉพาะ metric ที่ผู้บริหารต้องเห็นตาม KPI หลักของบัญชี ไม่ต้องใส่ทุกตัว]:

ตัวชี้วัด | ผลจริง | เป้า | เทียบเป้า
----------|--------|------|----------

[1-2 ประโยคใต้ตาราง: บรรทัดเดียวที่ผู้บริหารต้องจำจากช่วงนี้]

2. อะไรขับเคลื่อนผลลัพธ์

[2-3 ประโยค: แคมเปญ/สินค้ากลุ่มไหนทำเงินมากสุด พร้อมตัวเลข · แล้ว 1 ประโยค: ตัวไหนถ่วงผลงานและกำลังทำอะไรกับมัน]

3. ความเสี่ยงที่ต้องทราบ

[สูงสุด 3 ข้อ ข้อละ 1-2 ประโยค พร้อมผลกระทบเป็นตัวเลข — ถ้าข้อมูล tracking มีปัญหาให้เป็นข้อแรกเสมอ · ไม่มีความเสี่ยงจริงก็เขียน "ไม่พบความเสี่ยงที่กระทบเป้าหมายในช่วงนี้"]

4. ข้อเสนอเพื่อพิจารณา

[2-3 ข้อ แต่ละข้อ: ทำอะไร → คาดผลอะไรเป็นตัวเลข → ต้องการอะไรจากผู้บริหาร (อนุมัติงบ/รับทราบ/ตัดสินใจ) — เรียงตาม impact]

5. แผน 30 วันข้างหน้า

[4-5 bullets สั้นๆ ทีมทำเองไม่ต้องรออนุมัติ]

ทีมยินดีนำเสนอรายละเอียดเพิ่มเติมในประชุมครั้งถัดไป หรือตอบทุกคำถามทางอีเมลครับ/ค่ะ

ขอแสดงความนับถือ
ทีม Account Management

---

ใช้เฉพาะตัวเลขจากข้อมูลด้านล่างเท่านั้น:

${ctx}`
      : `You are the Head of Performance at a leading agency writing to the CLIENT'S EXECUTIVE TEAM (CEO/CMO). They have 2 minutes and do not run ads — they care about three things: what results, was it worth the money, what decisions are needed.

${kpiHint}

Strict rules:
- No ** ## -- * > backticks or emoji · plain numbered headings · tables use | and - only
- Business language in prose — no ads jargon (Impressions/CTR/CPC/Quality Score allowed inside tables only). Translate everything into money, sales, customers, and % vs target
- Every claim carries a real number. Never invent figures. Cut filler words entirely
- Prose under 300 words total (tables excluded) — short and sharp
- Match confidence to the data: if tracking is unreliable, say so first with the impact

Structure (exactly):

Subject: ${acctName} — Google Ads ${period}: [single most important business result, e.g. "ROAS 21.9x, 4x above target"]

Dear ${acctName} Executive Team,

Executive Summary
- [3-5 bullets, business numbers only: spend, what it returned, % vs target · final bullet: "Decision requested in this email: ..."]

1. Results vs Target

[KPI table, 4-6 rows — only metrics executives need given the account's primary KPI]:

Metric | Actual | Target | vs Target
-------|--------|--------|----------

[1-2 sentences: the one line the executive should remember]

2. What Drove the Results

[2-3 sentences: top revenue/conversion drivers with numbers · 1 sentence: the drag on performance and what is being done]

3. Risks You Should Know

[Max 3 items, 1-2 sentences each with quantified impact — tracking issues always come first · if none: "No risks affecting targets this period"]

4. For Your Decision

[2-3 proposals. Each: action → expected quantified outcome → what we need from you (budget approval / acknowledge / decide). Ordered by impact]

5. Next 30 Days

[4-5 short bullets the team will execute without approval]

We would be glad to walk through the details in our next call, or answer any questions by email.

Yours sincerely,
Account Management Team

---

Use only the numbers from the data below:

${ctx}`
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          customerId: selectedId,
          accountName: selectedAccount?.descriptiveName ?? '',
          reportContext: ctx,
        }),
      })
      if (!res.ok) throw new Error('Email generation failed')
      const data = await res.json() as { content: string }
      setEmailDraft(data.content)
    } catch {
      setEmailDraft('เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setEmailLoading(false)
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedId)
  const s = report?.summary
  const totalConvValue = (conversions?.actions ?? []).reduce((a, c) => a + c.value, 0)
  const isEcommerceAccount = totalConvValue > 0
  const accountRoas = isEcommerceAccount && s && s.totalCost > 0 ? parseFloat((totalConvValue / s.totalCost).toFixed(2)) : 0

  function exportCSV() {
    if (!report) return
    const rows = [['Campaign', 'Cost', 'Impressions', 'Clicks', 'Conv', 'CTR%', 'CPC', 'CPA'],
      ...(report.campaigns ?? []).map((c) => [c.campaignName, (c.cost ?? 0).toFixed(2), c.impressions, c.clicks, c.conversions, (c.ctr ?? 0).toFixed(2), (c.cpc ?? 0).toFixed(2), (c.cpa ?? 0).toFixed(2)])]
    const csv  = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `report-${selectedId}-${dateRange}.csv`
    a.click()
  }

  function exportAllCSV() {
    if (!report) return
    const acctName = (selectedAccount?.descriptiveName ?? selectedId).replace(/\s+/g, '_')
    const period   = dateRange

    // Helper to build and download a CSV blob
    function downloadCSV(filename: string, rows: (string | number)[][]) {
      const csv  = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    }

    // 1. Summary
    const s = report.summary
    downloadCSV(`${acctName}_${period}_summary.csv`, [
      ['Metric', 'Value', 'Change%'],
      ['Total Spend', s.totalCost.toFixed(2), s.changes?.totalCost ?? ''],
      ['Conversions', s.totalConversions.toFixed(2), s.changes?.totalConversions ?? ''],
      ['Blended CPA', s.blendedCPA.toFixed(2), s.changes?.blendedCPA ?? ''],
      ['Clicks', s.totalClicks, s.changes?.totalClicks ?? ''],
      ['Impressions', s.totalImpressions, s.changes?.totalImpressions ?? ''],
      ['CTR%', s.blendedCTR.toFixed(2), s.changes?.blendedCTR ?? ''],
      ['Target CPA', s.targetCPA, ''],
      ['CPA vs Target%', s.cpaVsTarget ?? '', ''],
      ['Period', s.period, ''],
    ])

    // 2. Campaigns
    downloadCSV(`${acctName}_${period}_campaigns.csv`, [
      ['Campaign', 'Cost', 'Impressions', 'Clicks', 'Conv', 'CTR%', 'CPC', 'CPA', 'ConvRate%'],
      ...(report.campaigns ?? []).map((c) => [c.campaignName, c.cost.toFixed(2), c.impressions, c.clicks, c.conversions.toFixed(2), c.ctr.toFixed(2), c.cpc.toFixed(2), c.cpa.toFixed(2), c.conversionRate.toFixed(2)]),
    ])

    // 3. Keywords
    if (keywords && keywords.length > 0) {
      downloadCSV(`${acctName}_${period}_keywords.csv`, [
        ['Keyword', 'Match Type', 'Quality Score', 'Impressions', 'Clicks', 'Cost', 'Conv', 'CTR%', 'CPC', 'CPA'],
        ...keywords.map((k) => [k.keyword, k.matchType, k.qualityScore ?? '', k.impressions, k.clicks, k.cost.toFixed(2), k.conversions.toFixed(2), k.ctr.toFixed(2), k.cpc.toFixed(2), k.cpa.toFixed(2)]),
      ])
    }

    // 4. Search Terms
    if (searchTerms && searchTerms.length > 0) {
      downloadCSV(`${acctName}_${period}_search_terms.csv`, [
        ['Search Term', 'Matched Keyword', 'Impressions', 'Clicks', 'Cost', 'Conv', 'CTR%', 'CPC', 'CPA'],
        ...searchTerms.map((s) => [s.searchTerm, s.matchedKeyword, s.impressions, s.clicks, s.cost.toFixed(2), s.conversions.toFixed(2), s.ctr.toFixed(2), s.cpc.toFixed(2), s.cpa.toFixed(2)]),
      ])
    }

    // 5. Audiences
    if (audiences && audiences.length > 0) {
      downloadCSV(`${acctName}_${period}_audiences.csv`, [
        ['Audience', 'Type', 'Impressions', 'Clicks', 'Cost', 'Conv', 'CTR%', 'CPC', 'CPA'],
        ...audiences.map((a) => [a.audienceName, a.type, a.impressions, a.clicks, a.cost.toFixed(2), a.conversions.toFixed(2), a.ctr.toFixed(2), a.cpc.toFixed(2), a.cpa.toFixed(2)]),
      ])
    }

    // 6. Locations
    if (locations && locations.length > 0) {
      downloadCSV(`${acctName}_${period}_locations.csv`, [
        ['Location', 'Impressions', 'Clicks', 'Cost', 'Conv', 'CTR%', 'CPC', 'CPA'],
        ...locations.map((l) => [l.location, l.impressions, l.clicks, l.cost.toFixed(2), l.conversions.toFixed(2), l.ctr.toFixed(2), l.cpc.toFixed(2), l.cpa.toFixed(2)]),
      ])
    }

    // 7. Devices
    if (devices && devices.length > 0) {
      downloadCSV(`${acctName}_${period}_devices.csv`, [
        ['Device', 'Impressions', 'Clicks', 'Cost', 'Conv', 'CTR%', 'CPC', 'CPA'],
        ...devices.map((d) => [d.device, d.impressions, d.clicks, d.cost.toFixed(2), d.conversions.toFixed(2), d.ctr.toFixed(2), d.cpc.toFixed(2), d.cpa.toFixed(2)]),
      ])
    }

    // 8. Time series
    if (timeData && timeData.length > 0) {
      downloadCSV(`${acctName}_${period}_time.csv`, [
        ['Date', 'Impressions', 'Clicks', 'Cost', 'Conv'],
        ...timeData.map((t) => [t.date, t.impressions, t.clicks, t.cost.toFixed(2), t.conversions.toFixed(2)]),
      ])
    }

    // 9. Conversions
    if (conversions && conversions.actions.length > 0) {
      downloadCSV(`${acctName}_${period}_conversions.csv`, [
        ['Conversion Action', 'Category', 'Conversions', 'Value', 'All Conversions', 'View-Through Conv'],
        ...conversions.actions.map((a) => [a.conversionName, a.category, a.conversions.toFixed(2), a.value.toFixed(2), a.allConversions.toFixed(1), a.viewThroughConversions.toFixed(1)]),
      ])
    }
  }

  function exportPDF() {
    if (!report) return
    window.print()
  }

  interface MSExportData {
    overview: { search: { impressionShare: number; lostBudget: number; lostRank: number; topShare: number | null; absTopShare: number | null } | null; display: { impressionShare: number } | null } | null
    campaigns: { name: string; channel: string; impressions: number; impressionShare: number | null; lostBudget: number | null; lostRank: number | null }[]
    aiSummary: string
  }

  async function exportHTML() {
    try {
      // Market Share ดึงสดเฉพาะตอนถูกเลือก (component ในหน้า fetch แยกของมันเอง)
      let msData: MSExportData | null = null
      if (sec('marketShare') && selectedId) {
        try {
          const r = await fetch(`/api/reports/market-share?customerId=${selectedId}&dateRange=${dateRange}`)
          if (r.ok) msData = await r.json() as MSExportData
        } catch { /* export ต่อโดยไม่มี MS */ }
      }
      exportHTMLInner(msData)
    } catch (e) {
      console.error('[exportHTML]', e)
      const stack = e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 5).join('\n') : ''
      alert(`Export ล้มเหลว: ${e instanceof Error ? e.message : e}\n\n${stack}`)
    }
  }

  function exportHTMLInner(msData: MSExportData | null = null) {
    if (!report) { alert('ยังไม่มีข้อมูล report — กด Sync & Refresh ก่อน'); return }
    const acctName = selectedAccount?.descriptiveName ?? selectedId
    const period   = rangeLabel(dateRange)
    const generatedDate = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    const s = report.summary
    const nr = narrative

    const fmt = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    const fmtConv = (n: number) => n.toFixed(2)
    const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`

    // ── Muted chart helpers for the standalone report (no JS libs — pure SVG/CSS) ──
    const MUTEDX = ['#5B9E92', '#DD8E63', '#8FA3B0', '#C9AF6E', '#A48EB8', '#84AE8C', '#D08C8C', '#A9CCC4']
    // Donut pie: SVG stroke segments + side legend with value/%
    const donutChartHtml = (slices: { name: string; value: number }[], centerLabel: string, fmtVal: (v: number) => string) => {
      const total = slices.reduce((t, x) => t + x.value, 0)
      if (total <= 0) return ''
      const R = 15.9155, C = 2 * Math.PI * R
      let offset = 0
      const segs = slices.map((sl, i) => {
        const frac = sl.value / total
        const seg = `<circle r="${R}" cx="21" cy="21" fill="transparent" stroke="${MUTEDX[i % MUTEDX.length]}" stroke-width="7.5" stroke-dasharray="${(frac * C).toFixed(3)} ${(C - frac * C).toFixed(3)}" stroke-dashoffset="${(-offset * C).toFixed(3)}" stroke-linecap="butt"></circle>`
        offset += frac
        return seg
      }).join('')
      const legend = slices.map((sl, i) => `
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${MUTEDX[i % MUTEDX.length]};flex-shrink:0"></span>
          <span style="flex:1;color:#3D4852;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sl.name}</span>
          <b style="color:#3D4852;font-variant-numeric:tabular-nums;white-space:nowrap">${fmtVal(sl.value)}</b>
          <span style="color:#A3ADB8;min-width:44px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">${((sl.value / total) * 100).toFixed(1)}%</span>
        </div>`).join('')
      return `
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <div style="position:relative;width:150px;height:150px;flex-shrink:0;margin:0 auto">
            <svg viewBox="0 0 42 42" style="width:100%;height:100%;transform:rotate(-90deg)">${segs}</svg>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <b style="font-size:16px;color:#3D4852;font-variant-numeric:tabular-nums">${fmtVal(total)}</b>
              <span style="font-size:10px;color:#A3ADB8">${centerLabel}</span>
            </div>
          </div>
          <div style="flex:1;min-width:220px">${legend}</div>
        </div>`
    }
    // Marketing funnel: กรวย trapezoid แบบเดียวกับ Sales Funnel หน้าเว็บ (FunnelBars)
    // — ไล่แคบ 100% → 42% ด้วย clip-path + guard เคส rate > 100% (tracking ขั้นก่อนไม่ครบ)
    const funnelHtml = (stages: { label: string; value: number; note?: string }[], fmtVal: (v: number) => string) => {
      const n = stages.length
      if (n === 0) return ''
      const step = n > 1 ? 58 / (n - 1) : 0
      const widthPct = (i: number) => 100 - i * step
      return stages.map((st, i) => {
        const prev = i > 0 ? stages[i - 1].value : null
        const rate = prev && prev > 0 ? (st.value / prev) * 100 : null
        const w = widthPct(i)
        const wNext = i < n - 1 ? widthPct(i + 1) : Math.max(w - step, 30)
        const inset = ((1 - wNext / w) / 2) * 100
        const color = MUTEDX[i % MUTEDX.length]
        return `
          ${rate !== null ? (rate <= 100 ? `<div style="display:flex;justify-content:center;gap:14px;font-size:11px;padding:4px 0">
            <span style="color:#5B9E92;font-weight:700">↓ ผ่านต่อ ${rate.toFixed(1)}%</span>
            <span style="color:#D08C8C">หลุด ${(100 - rate).toFixed(1)}%</span>
          </div>` : `<div style="display:flex;justify-content:center;font-size:11px;padding:4px 0">
            <span style="color:#C9AF6E;font-weight:700">↑ ${rate.toFixed(0)}% ของขั้นก่อน — ขั้นก่อนอาจ track ไม่ครบ</span>
          </div>`) : ''}
          <div style="width:${w.toFixed(2)}%;margin:0 auto">
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 24px;color:#fff;background:linear-gradient(135deg,${color},${color}CC);clip-path:polygon(0 0, 100% 0, ${(100 - inset).toFixed(2)}% 100%, ${inset.toFixed(2)}% 100%)">
              <span style="font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap">${fmtVal(st.value)}</span>
              <span style="font-size:11.5px;font-weight:600;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${st.label}${st.note ? ` · ${st.note}` : ''}</span>
            </div>
          </div>`
      }).join('')
    }

    // Horizontal bar chart — value bar (+optional secondary metric chip) per row
    const hbarHtml = (rows: { label: string; value: number; chip?: string }[], fmtVal: (v: number) => string, color = '#5B9E92') => {
      const maxV = Math.max(1, ...rows.map(r => r.value))
      return rows.map((r, i) => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
          <div style="width:min(190px,34%);font-size:11.5px;color:#3D4852;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${r.label}</div>
          <div style="flex:1;height:20px;background:#F3F5F4;border-radius:7px;overflow:hidden">
            <div style="width:${Math.max((r.value / maxV) * 100, 3).toFixed(1)}%;height:100%;border-radius:7px;background:linear-gradient(90deg,${MUTEDX[i % MUTEDX.length] ?? color},${(MUTEDX[i % MUTEDX.length] ?? color)}B3)"></div>
          </div>
          <div style="width:86px;font-size:11.5px;font-weight:700;color:#3D4852;font-variant-numeric:tabular-nums;flex-shrink:0">${fmtVal(r.value)}</div>
          ${r.chip ? `<div style="width:96px;font-size:10.5px;color:#93A1AB;font-variant-numeric:tabular-nums;flex-shrink:0">${r.chip}</div>` : ''}
        </div>`).join('')
    }
    const chartBlock = (title: string, inner: string) => inner ? `
      <div style="background:#FBFCFB;border:1px solid #EEF1F0;border-radius:12px;padding:16px;margin-bottom:14px">
        <p style="font-size:10.5px;font-weight:700;color:#93A1AB;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">${title}</p>
        ${inner}
      </div>` : ''

    // ── Market Share (Visibility Share) block — ใส่เมื่อถูกเลือกและมีข้อมูล ──
    const msPct = (v: number | null | undefined) => v == null ? 'N/A' : v <= 0.1 && v >= 0.0999 ? '< 10%' : `${(v * 100).toFixed(1)}%`
    const msS = msData?.overview?.search
    const msD = msData?.overview?.display
    const buildMsBlock = () => (msS || msD) ? `
      <div class="kpi4" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px">
        ${[
          { label: 'Search Impr. Share', value: msPct(msS?.impressionShare), color: '#5B9E92' },
          { label: 'Lost IS (Budget)', value: msPct(msS?.lostBudget), color: '#DD8E63' },
          { label: 'Lost IS (Rank)', value: msPct(msS?.lostRank), color: '#D08C8C' },
          { label: 'Top / Abs.Top', value: `${msPct(msS?.topShare)} / ${msPct(msS?.absTopShare)}`, color: '#8FA3B0' },
        ].map(m => `<div style="background:#FBFCFB;border:1px solid #EEF1F0;border-radius:12px;padding:14px 16px">
          <p style="font-size:10.5px;font-weight:700;color:#93A1AB;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px">${m.label}</p>
          <p style="font-size:22px;font-weight:800;color:${m.color};font-variant-numeric:tabular-nums">${m.value}</p>
        </div>`).join('')}
      </div>
      ${(msData?.campaigns ?? []).length > 0 ? tableWrap(`
        <thead><tr>
          <th style="padding:9px 14px;text-align:left;font-size:10.5px;color:#93A1AB;text-transform:uppercase">Campaign</th>
          <th style="padding:9px 14px;text-align:right;font-size:10.5px;color:#93A1AB;text-transform:uppercase">Impr. Share</th>
          <th style="padding:9px 14px;text-align:right;font-size:10.5px;color:#93A1AB;text-transform:uppercase">Lost (Budget)</th>
          <th style="padding:9px 14px;text-align:right;font-size:10.5px;color:#93A1AB;text-transform:uppercase">Lost (Rank)</th>
        </tr></thead>
        <tbody>
          ${(msData?.campaigns ?? []).slice(0, 10).map(c => `<tr style="border-top:1px solid #F3F5F4">
            <td style="padding:9px 14px;font-size:12px;color:#3D4852">${c.name}</td>
            <td style="padding:9px 14px;text-align:right;font-weight:700;color:#5B9E92">${msPct(c.impressionShare)}</td>
            <td style="padding:9px 14px;text-align:right;color:#DD8E63">${msPct(c.lostBudget)}</td>
            <td style="padding:9px 14px;text-align:right;color:#D08C8C">${msPct(c.lostRank)}</td>
          </tr>`).join('')}
        </tbody>
      `) : ''}
      ${msData?.aiSummary ? `<p style="font-size:13px;color:#3D4852;line-height:1.7;background:#F7FAF9;border:1px solid #DFEAE7;border-radius:10px;padding:14px 16px;margin-top:12px">${msData.aiSummary}</p>` : ''}
      <p style="font-size:10px;color:#A3ADB8;margin-top:8px">* Visibility Share จาก Google Ads Impression Share — ไม่ใช่ส่วนแบ่งตลาดจริงของธุรกิจ · PMax ไม่รายงานค่านี้</p>
    ` : ''

    // ── per-section chart data (ดึงจากตารางเดียวกับที่ export) ──
    const campBar = hbarHtml([...report.campaigns].sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map(c => ({ label: c.campaignName.replace(/^\(?CVC\)?\s*-?\s*/i, ''), value: c.cost, chip: `${fmtConv(c.conversions)} conv` })), (v) => fmt(v))
    const kwBar = hbarHtml((keywords ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map(k => ({ label: k.keyword, value: k.cost, chip: `${fmtConv(k.conversions)} conv` })), (v) => fmt(v))
    const stBar = hbarHtml((searchTerms ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map(t => ({ label: t.searchTerm, value: t.cost, chip: `${fmtConv(t.conversions)} conv` })), (v) => fmt(v))
    const audienceRows = (audiences ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10).map((a) => `
      <tr>
        <td style="padding:9px 14px;font-weight:500;color:#111827">${a.audienceName}</td>
        <td style="padding:9px 14px"><span style="font-size:10px;padding:1px 7px;border-radius:20px;font-weight:600;background:#EDF4F2;color:#5B9E92">${a.type}</span></td>
        <td style="padding:9px 14px;text-align:right">${fmt(a.cost)}</td>
        <td style="padding:9px 14px;text-align:right;color:#059669;font-weight:600">${fmtConv(a.conversions)}</td>
        <td style="padding:9px 14px;text-align:right">${a.cpa > 0 ? fmt(a.cpa) : '—'}</td>
        <td style="padding:9px 14px;text-align:right">${a.ctr.toFixed(2)}%</td>
      </tr>`).join('')
    const audBar = hbarHtml((audiences ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map(a => ({ label: a.audienceName, value: a.cost, chip: `${fmtConv(a.conversions)} conv` })), (v) => fmt(v))

    const textAdCards = (textAds ?? []).slice().sort((a, b) => b.conversions - a.conversions).slice(0, 10).map((ad) => `
      <div style="border:1px solid #ECEFEE;border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fff">
        <div style="font-size:10px;color:#93A1AB;margin-bottom:3px">${ad.campaignName} › ${ad.adGroupName}${ad.adStrength ? ` · <b style="color:${ad.adStrength === 'EXCELLENT' ? '#5B9E92' : ad.adStrength === 'GOOD' ? '#84AE8C' : '#C9AF6E'}">Ad Strength: ${ad.adStrength}</b>` : ''}</div>
        <div style="font-size:11px;color:#5B9E92">Ad · ${(ad.finalUrl || '').replace(/^https?:\/\//, '').split('/')[0]}</div>
        <div style="font-size:14.5px;color:#1a0dab;font-weight:600;line-height:1.4">${(ad.headlines ?? []).filter(Boolean).slice(0, 3).join(' | ')}</div>
        <div style="font-size:12px;color:#4B5563;margin-top:2px;line-height:1.5">${(ad.descriptions ?? []).filter(Boolean).slice(0, 2).join(' ')}</div>
        <div style="font-size:11px;color:#93A1AB;margin-top:7px">${formatNumber(ad.impressions)} impr · ${formatNumber(ad.clicks)} clicks · CTR <b>${ad.ctr.toFixed(2)}%</b> · ${fmt(ad.cost)} · <b style="color:#5B9E92">${fmtConv(ad.conversions)} conv</b>${ad.cpa > 0 ? ` · CPA ${fmt(ad.cpa)}` : ''}</div>
      </div>`).join('')

    const locSlices = (locations ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 6)
      .map(l => ({ name: l.location, value: l.cost })).filter(x => x.value > 0)
    const locBar = hbarHtml((locations ?? []).slice().sort((a, b) => b.conversions - a.conversions).slice(0, 8)
      .map(l => ({ label: l.location, value: l.conversions, chip: l.cpa > 0 ? `CPA ${fmt(l.cpa)}` : '' })), (v) => fmtConv(v))
    const devBar = hbarHtml((devices ?? []).map(d => ({ label: ({ MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'TV' } as Record<string, string>)[d.device] ?? d.device, value: d.cost, chip: `${fmtConv(d.conversions)} conv` })), (v) => fmt(v))
    const convSlices = (conversions?.actions ?? []).slice().sort((a, b) => b.conversions - a.conversions).slice(0, 6)
      .map(a => ({ name: a.conversionName, value: a.conversions })).filter(x => x.value > 0)

    // Spend share slices (top 5 + อื่นๆ)
    const spendSorted = [...report.campaigns].sort((a, b) => b.cost - a.cost)
    const spendSlices = [
      ...spendSorted.slice(0, 5).map(c => ({ name: c.campaignName.replace(/^\(?CVC\)?\s*-?\s*/i, ''), value: c.cost })),
      ...(spendSorted.slice(5).reduce((t, c) => t + c.cost, 0) > 0 ? [{ name: 'อื่นๆ', value: spendSorted.slice(5).reduce((t, c) => t + c.cost, 0) }] : []),
    ].filter(x => x.value > 0)
    const deviceSlices = (devices ?? []).map(d => ({ name: ({ MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'TV' } as Record<string, string>)[d.device] ?? d.device, value: d.impressions })).filter(x => x.value > 0)

    // Marketing funnel: ad journey → (ecommerce ต่อท้ายด้วย view→purchase)
    const ecoF = ecommerce?.ecommerceFunnel
    const funnelStages = ecoF && ecoF.view_item > 0
      ? [
          { label: 'Impressions', value: s.totalImpressions },
          { label: 'Clicks', value: s.totalClicks, note: `CTR ${s.blendedCTR.toFixed(2)}%` },
          { label: 'View Item', value: ecoF.view_item },
          { label: 'Add to Cart', value: ecoF.add_to_cart },
          { label: 'Begin Checkout', value: ecoF.begin_checkout },
          { label: 'Purchase', value: ecoF.purchase, note: `Revenue ${fmt(ecoF.revenue)}` },
        ]
      : [
          { label: 'Impressions', value: s.totalImpressions },
          { label: 'Clicks', value: s.totalClicks, note: `CTR ${s.blendedCTR.toFixed(2)}%` },
          { label: 'Conversions', value: Math.round(s.totalConversions), note: `CPA ${fmt(s.blendedCPA)}` },
        ]
    const cpaBadge = s.cpaVsTarget !== null
      ? `<span style="font-size:12px;padding:2px 10px;border-radius:20px;font-weight:700;background:${s.cpaVsTarget > 10 ? '#fef2f2' : '#ecfdf5'};color:${s.cpaVsTarget > 10 ? '#dc2626' : '#059669'}">${s.cpaVsTarget > 0 ? '+' + s.cpaVsTarget + '% เกินเป้า' : Math.abs(s.cpaVsTarget) + '% ต่ำกว่าเป้า'}</span>`
      : ''

    const campaignRows = [...report.campaigns].sort((a, b) => b.cost - a.cost).slice(0, 10).map((c) => `
      <tr>
        <td style="padding:10px 14px;font-weight:600;color:#111827">${c.campaignName}</td>
        <td style="padding:10px 14px;text-align:right">${fmt(c.cost)}</td>
        <td style="padding:10px 14px;text-align:right">${formatNumber(c.impressions)}</td>
        <td style="padding:10px 14px;text-align:right">${c.clicks.toLocaleString()}</td>
        <td style="padding:10px 14px;text-align:right;color:#059669;font-weight:600">${fmtConv(c.conversions)}</td>
        <td style="padding:10px 14px;text-align:right">${c.ctr.toFixed(2)}%</td>
        <td style="padding:10px 14px;text-align:right">${fmt(c.cpc)}</td>
        <td style="padding:10px 14px;text-align:right;font-weight:600;color:${c.cpa > s.targetCPA * 1.1 ? '#dc2626' : '#374151'}">${c.cpa > 0 ? fmt(c.cpa) : '—'}</td>
      </tr>`).join('')

    const keywordRows = (keywords ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10).map((k) => `
      <tr>
        <td style="padding:9px 14px;font-weight:500;color:#111827">${k.keyword}</td>
        <td style="padding:9px 14px"><span style="font-size:11px;padding:1px 7px;border-radius:4px;font-weight:600;background:${k.matchType === 'EXACT' ? '#dcfce7' : k.matchType === 'PHRASE' ? '#f3e8ff' : '#dbeafe'};color:${k.matchType === 'EXACT' ? '#15803d' : k.matchType === 'PHRASE' ? '#7e22ce' : '#1d4ed8'}">${MATCH_LABEL[k.matchType] ?? k.matchType}</span></td>
        <td style="padding:9px 14px;text-align:center;font-weight:700;color:${k.qualityScore !== null && k.qualityScore >= 7 ? '#059669' : k.qualityScore !== null && k.qualityScore <= 4 ? '#dc2626' : '#6b7280'}">${k.qualityScore ?? '—'}</td>
        <td style="padding:9px 14px;text-align:right">${fmt(k.cost)}</td>
        <td style="padding:9px 14px;text-align:right;color:#059669;font-weight:600">${fmtConv(k.conversions)}</td>
        <td style="padding:9px 14px;text-align:right">${k.cpa > 0 ? fmt(k.cpa) : '—'}</td>
        <td style="padding:9px 14px;text-align:right">${k.ctr.toFixed(2)}%</td>
      </tr>`).join('')

    const searchTermRows = (searchTerms ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10).map((st) => `
      <tr>
        <td style="padding:9px 14px;font-weight:500;color:#111827">${st.searchTerm}</td>
        <td style="padding:9px 14px;font-size:12px;color:#6b7280;font-family:monospace">${st.matchedKeyword || '—'}</td>
        <td style="padding:9px 14px;text-align:right">${formatNumber(st.impressions)}</td>
        <td style="padding:9px 14px;text-align:right">${st.clicks}</td>
        <td style="padding:9px 14px;text-align:right">${fmt(st.cost)}</td>
        <td style="padding:9px 14px;text-align:right;color:${st.conversions > 0 ? '#059669' : '#d1d5db'};font-weight:${st.conversions > 0 ? '600' : '400'}">${st.conversions > 0 ? fmtConv(st.conversions) : '0'}</td>
        <td style="padding:9px 14px;text-align:right">${st.ctr.toFixed(2)}%</td>
      </tr>`).join('')

    const locationRows = (locations ?? []).slice().sort((a, b) => b.cost - a.cost).slice(0, 10).map((l) => `
      <tr>
        <td style="padding:9px 14px;font-weight:500;color:#111827">${l.location}</td>
        <td style="padding:9px 14px;text-align:right">${formatNumber(l.impressions)}</td>
        <td style="padding:9px 14px;text-align:right">${fmt(l.cost)}</td>
        <td style="padding:9px 14px;text-align:right;color:#059669;font-weight:600">${fmtConv(l.conversions)}</td>
        <td style="padding:9px 14px;text-align:right">${l.cpa > 0 ? fmt(l.cpa) : '—'}</td>
        <td style="padding:9px 14px;text-align:right">${l.ctr.toFixed(2)}%</td>
      </tr>`).join('')

    const deviceRows = (devices ?? []).map((d) => `
      <tr>
        <td style="padding:9px 14px;font-weight:600;color:#111827">${{ MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'Connected TV' }[d.device] ?? d.device}</td>
        <td style="padding:9px 14px;text-align:right">${formatNumber(d.impressions)}</td>
        <td style="padding:9px 14px;text-align:right">${formatNumber(d.clicks)}</td>
        <td style="padding:9px 14px;text-align:right">${fmt(d.cost)}</td>
        <td style="padding:9px 14px;text-align:right;color:#059669;font-weight:600">${fmtConv(d.conversions)}</td>
        <td style="padding:9px 14px;text-align:right">${d.ctr.toFixed(2)}%</td>
        <td style="padding:9px 14px;text-align:right">${d.cpa > 0 ? fmt(d.cpa) : '—'}</td>
      </tr>`).join('')

    const thStyle = `style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;background:#f9fafb"`
    const thRight = `style="padding:9px 14px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;background:#f9fafb"`

    const tableWrap = (content: string) => `
      <div style="overflow-x:auto;border-radius:10px;border:1px solid #e5e7eb;margin-top:16px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
          ${content}
        </table>
      </div>`

    const sectionCard = (title: string, titleColor: string, accentColor: string, body: string) => `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-bottom:24px">
        <div style="height:3px;background:${accentColor}"></div>
        <div style="padding:20px 24px 4px">
          <p style="font-size:11px;font-weight:700;color:${titleColor};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px">${title}</p>
        </div>
        <div style="padding:4px 24px 20px">${body}</div>
      </div>`

    const actionsList = nr ? nr.actions.map((a, i) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 14px;background:#f9fafb;border-radius:8px;border:1px solid #f3f4f6;margin-bottom:8px">
        <span style="min-width:22px;height:22px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</span>
        <span style="font-size:13px;color:#374151;line-height:1.6">${a}</span>
      </div>`).join('') : ''

    const insightsList = nr?.keyInsights ? nr.keyInsights.map((ins, i) => `
      <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 14px;background:#fff;border-radius:8px;border:1px solid #e0f2fe;margin-bottom:8px">
        <span style="min-width:22px;height:22px;border-radius:50%;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</span>
        <span style="font-size:13px;color:#374151;line-height:1.6">${ins}</span>
      </div>`).join('') : ''

    const conversionRows = conversions?.actions?.length ? conversions.actions.map((a) => `
      <tr>
        <td style="padding:9px 14px;font-weight:500;color:#111827">${a.conversionName}</td>
        <td style="padding:9px 14px;font-size:12px;color:#6b7280">${a.category}</td>
        <td style="padding:9px 14px;text-align:right;font-weight:600;color:#059669">${fmtConv(a.conversions)}</td>
        <td style="padding:9px 14px;text-align:right">${fmt(a.value)}</td>
        <td style="padding:9px 14px;text-align:right;color:#6b7280">${fmtConv(a.allConversions)}</td>
      </tr>`).join('') : ''

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Report — ${acctName} · ${period}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', sans-serif; background: #f8fafc; color: #374151; line-height: 1.6; }
    a { color: inherit; text-decoration: none; }
    svg, img { max-width: 100%; }
    /* grid item default = min-width:auto ทำให้เนื้อหายาวดันการ์ดทะลุขอบขวา — บังคับให้หดได้ */
    div[style*="display:grid"] > * { min-width: 0; }
    div[style*="display:flex"] > * { min-width: 0; }
    @media (max-width: 760px) {
      .grid2, .grid3, .grid4 { grid-template-columns: 1fr !important; }
      .kpi4 { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
    }
    @media print {
      body { background: white; }
      .no-print { display: none !important; }
      .page-wrap { max-width: 100% !important; padding: 0 !important; }
      div[style*="border-radius"] { break-inside: avoid; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { margin: 1.5cm; size: A4 portrait; }
    }
  </style>
</head>
<body>
<div class="page-wrap" style="max-width:960px;margin:0 auto;padding:32px 24px 60px">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #e5e7eb">
    <div>
      <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Google Ads Performance Report</p>
      <h1 style="font-size:26px;font-weight:800;color:#111827;line-height:1.2">${acctName}</h1>
      <p style="font-size:14px;color:#6b7280;margin-top:4px">ช่วงเวลา: <strong style="color:#374151">${period}</strong> &nbsp;·&nbsp; จัดทำเมื่อ ${generatedDate}</p>
    </div>
    <div style="text-align:right">
      <p style="font-size:11px;color:#9ca3af">Account ID</p>
      <p style="font-size:14px;font-weight:700;font-family:monospace;color:#374151">${selectedId}</p>
      ${s.targetCPA > 0 ? `<p style="font-size:11px;color:#9ca3af;margin-top:4px">Target CPA: <strong style="color:#374151">${fmt(s.targetCPA)}</strong></p>` : ''}
    </div>
  </div>

  <!-- KPI Summary Strip -->
  ${sec('kpi') ? `
  <div class="kpi4" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:24px">
    ${[
      { label: 'Total Spend', value: fmt(s.totalCost), sub: period, color: '#5B9E92', bg: '#EDF4F2' },
      { label: 'Conversions', value: fmtConv(s.totalConversions), sub: `Conv Rate ${((s.totalConversions / Math.max(1, s.totalClicks)) * 100).toFixed(2)}%`, color: '#84AE8C', bg: '#F0F6F1' },
      { label: 'Blended CPA', value: fmt(s.blendedCPA), sub: s.cpaVsTarget !== null ? (s.cpaVsTarget > 0 ? `+${s.cpaVsTarget}% vs target` : `${Math.abs(s.cpaVsTarget)}% below target`) : `Target ${fmt(s.targetCPA)}`, color: s.cpaVsTarget !== null && s.cpaVsTarget > 10 ? '#D08C8C' : '#84AE8C', bg: s.cpaVsTarget !== null && s.cpaVsTarget > 10 ? '#FAF0F0' : '#F0F6F1' },
      { label: 'CTR', value: `${s.blendedCTR.toFixed(2)}%`, sub: `${s.totalClicks.toLocaleString()} clicks`, color: '#A48EB8', bg: '#F5F2F8' },
    ].map((m) => `
      <div style="background:${m.bg};border-radius:12px;padding:16px 18px">
        <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${m.label}</p>
        <p style="font-size:26px;font-weight:800;color:${m.color};line-height:1">${m.value}</p>
        <p style="font-size:12px;color:#9ca3af;margin-top:4px">${m.sub}</p>
      </div>`).join('')}
  </div>
  ${cpaBadge ? `<div style="margin-bottom:24px;display:flex;align-items:center;gap:10px"><span style="font-size:13px;color:#6b7280">CPA vs Target:</span>${cpaBadge}</div>` : ''}
  ` : ''}

  <!-- Charts row: spend share + device split donuts -->
  ${sec('charts') ? `
  <div class="grid2" style="display:grid;grid-template-columns:${deviceSlices.length > 0 ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)'};gap:16px;margin-bottom:24px">
    ${spendSlices.length > 0 ? `<div style="background:#fff;border:1px solid #ECEFEE;border-radius:16px;padding:20px">
      <p style="font-size:11px;font-weight:700;color:#93A1AB;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px">Spend Share by Campaign</p>
      ${donutChartHtml(spendSlices, 'Total Spend', (v) => fmt(v))}
    </div>` : ''}
    ${deviceSlices.length > 0 ? `<div style="background:#fff;border:1px solid #ECEFEE;border-radius:16px;padding:20px">
      <p style="font-size:11px;font-weight:700;color:#93A1AB;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px">Impressions by Device</p>
      ${donutChartHtml(deviceSlices, 'Impressions', (v) => formatNumber(v))}
    </div>` : ''}
  </div>
  ` : ''}

  ${sec('funnel') ? sectionCard('Marketing Funnel', '#5B9E92', 'linear-gradient(90deg,#5B9E92,#A9CCC4)', `
    <div style="max-width:640px;margin:8px auto">${funnelHtml(funnelStages, (v) => formatNumber(v))}</div>
    ${ecoF && ecoF.view_item > 0 ? `<div class="grid4" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px">
      ${[
        { label: 'Revenue', value: fmt(ecoF.revenue) },
        { label: 'ROAS', value: ecoF.roas > 0 ? `${Number(ecoF.roas).toFixed(2)}x` : '—' },
        { label: 'AOV', value: fmt(ecoF.aov) },
        { label: 'Cart Abandon', value: `${Number(ecoF.cartAbandonRate).toFixed(1)}%` },
      ].map(m => `<div style="background:#F6F8F7;border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#5B9E92;font-variant-numeric:tabular-nums">${m.value}</div>
        <div style="font-size:11px;color:#93A1AB;font-weight:600">${m.label}</div>
      </div>`).join('')}
    </div>` : ''}
  `) : ''}

  <!-- Market Share (Visibility Share) -->
  ${sec('marketShare') ? (() => { const b = buildMsBlock(); return b ? sectionCard('Market Share (Visibility Share)', '#374151', 'linear-gradient(90deg,#5B9E92,#8FA3B0)', b) : '' })() : ''}

  <!-- Campaign Performance Table -->
  ${sec('campaigns') ? sectionCard('Campaign Performance · Top 10 by Spend', '#374151', 'linear-gradient(90deg,#5B9E92,#84AE8C)', `
    ${chartBlock('Top 10 Campaigns by Spend', campBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Campaign</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Impressions</th>
          <th ${thRight}>Clicks</th>
          <th ${thRight}>Conversions</th>
          <th ${thRight}>CTR</th>
          <th ${thRight}>CPC</th>
          <th ${thRight}>CPA</th>
        </tr>
      </thead>
      <tbody>${campaignRows}</tbody>
      <tfoot>
        <tr style="background:#f9fafb;font-weight:700">
          <td style="padding:10px 14px;color:#374151">รวมทั้งหมด</td>
          <td style="padding:10px 14px;text-align:right;color:#2563eb">${fmt(s.totalCost)}</td>
          <td style="padding:10px 14px;text-align:right">${formatNumber(s.totalImpressions)}</td>
          <td style="padding:10px 14px;text-align:right">${s.totalClicks.toLocaleString()}</td>
          <td style="padding:10px 14px;text-align:right;color:#059669">${fmtConv(s.totalConversions)}</td>
          <td style="padding:10px 14px;text-align:right">${s.blendedCTR.toFixed(2)}%</td>
          <td style="padding:10px 14px;text-align:right">—</td>
          <td style="padding:10px 14px;text-align:right">${fmt(s.blendedCPA)}</td>
        </tr>
      </tfoot>
    `)}
  `) : ''}

  ${sec('keywords') && keywordRows ? sectionCard('Keywords · Top 10 by Spend', '#374151', 'linear-gradient(90deg,#A48EB8,#8FA3B0)', `
    ${chartBlock('Top 10 Keywords by Spend', kwBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Keyword</th>
          <th ${thStyle}>Match</th>
          <th ${thRight}>QS</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Conv.</th>
          <th ${thRight}>CPA</th>
          <th ${thRight}>CTR</th>
        </tr>
      </thead>
      <tbody>${keywordRows}</tbody>
    `)}
  `) : ''}

  ${sec('searchTerms') && searchTermRows ? sectionCard('Search Terms · Top 10 by Spend', '#374151', 'linear-gradient(90deg,#C9AF6E,#DD8E63)', `
    ${chartBlock('Top 10 Search Terms by Spend', stBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Search Term</th>
          <th ${thStyle}>Matched Keyword</th>
          <th ${thRight}>Impressions</th>
          <th ${thRight}>Clicks</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Conv.</th>
          <th ${thRight}>CTR</th>
        </tr>
      </thead>
      <tbody>${searchTermRows}</tbody>
    `)}
  `) : ''}

  ${sec('audiences') && audienceRows ? sectionCard('Audiences · Top 10 by Spend', '#374151', 'linear-gradient(90deg,#84AE8C,#5B9E92)', `
    ${chartBlock('Top 10 Audiences by Spend', audBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Audience</th>
          <th ${thStyle}>Type</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Conv.</th>
          <th ${thRight}>CPA</th>
          <th ${thRight}>CTR</th>
        </tr>
      </thead>
      <tbody>${audienceRows}</tbody>
    `)}
  `) : ''}

  ${sec('locations') && locationRows ? sectionCard('Location Performance · Top 10', '#374151', 'linear-gradient(90deg,#C9AF6E,#84AE8C)', `
    ${locSlices.length > 1 ? chartBlock('Spend Share by Location', donutChartHtml(locSlices, 'Spend', (v) => fmt(v))) : ''}
    ${chartBlock('Conversions by Location', locBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Location</th>
          <th ${thRight}>Impressions</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Conv.</th>
          <th ${thRight}>CPA</th>
          <th ${thRight}>CTR</th>
        </tr>
      </thead>
      <tbody>${locationRows}</tbody>
    `)}
  `) : ''}

  ${sec('devices') && deviceRows ? sectionCard('Device Split', '#374151', 'linear-gradient(90deg,#8FA3B0,#A48EB8)', `
    ${chartBlock('Spend & Conversions by Device', devBar)}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Device</th>
          <th ${thRight}>Impressions</th>
          <th ${thRight}>Clicks</th>
          <th ${thRight}>Spend</th>
          <th ${thRight}>Conv.</th>
          <th ${thRight}>CTR</th>
          <th ${thRight}>CPA</th>
        </tr>
      </thead>
      <tbody>${deviceRows}</tbody>
    `)}
  `) : ''}

  ${sec('conversions') && conversionRows ? sectionCard('Conversion Actions', '#374151', 'linear-gradient(90deg,#5B9E92,#84AE8C)', `
    ${convSlices.length > 1 ? chartBlock('Conversions by Action', donutChartHtml(convSlices, 'Conversions', (v) => fmtConv(v))) : ''}
    ${tableWrap(`
      <thead>
        <tr>
          <th ${thStyle}>Conversion Action</th>
          <th ${thStyle}>Category</th>
          <th ${thRight}>Conversions</th>
          <th ${thRight}>Value</th>
          <th ${thRight}>All Conv.</th>
        </tr>
      </thead>
      <tbody>${conversionRows}</tbody>
    `)}
  `) : ''}


  ${sec('textAds') && textAdCards ? sectionCard('Text Ads · Top 10 by Conversions', '#374151', 'linear-gradient(90deg,#5B9E92,#A48EB8)', textAdCards) : ''}

  ${sec('narrative') && nr ? `
  <!-- Performance Report (บทวิเคราะห์) — อธิบายตัวเลขด้านบน -->
  <div style="margin:36px 0 20px;text-align:center">
    <p style="display:inline-block;font-size:12px;font-weight:800;color:#5B9E92;text-transform:uppercase;letter-spacing:0.15em;border-top:2px solid #5B9E92;border-bottom:2px solid #5B9E92;padding:8px 22px">Performance Report · บทวิเคราะห์</p>
  </div>
  ${sectionCard('Performance Summary', '#2563eb', 'linear-gradient(90deg,#5B9E92,#A9CCC4)', `
    <h2 style="font-size:19px;font-weight:800;color:#111827;line-height:1.35;margin-bottom:16px">${nr.headline}</h2>
    ${nr.clientSummary ? `<p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:14px">${nr.clientSummary}</p>` : ''}
    ${nr.performance ? `<div style="border-top:1px solid #f3f4f6;padding-top:14px;margin-top:4px"><p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Performance Analysis</p><p style="font-size:14px;color:#374151;line-height:1.7">${nr.performance}</p></div>` : ''}
    ${nr.executiveSummary ? `<div style="background:#f8fafc;border-radius:10px;padding:16px;margin-top:16px;border:1px solid #e5e7eb"><p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Executive Summary</p><p style="font-size:14px;color:#374151;line-height:1.7">${nr.executiveSummary}</p></div>` : ''}
  `)}

  <!-- Winners & Concerns -->
  <div class="grid2" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-bottom:24px">
    <div style="background:#fff;border:1px solid #bbf7d0;border-radius:14px;overflow:hidden">
      <div style="height:3px;background:#4ade80"></div>
      <div style="padding:18px 20px">
        <p style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">จุดเด่น · Winners</p>
        <p style="font-size:14px;color:#374151;line-height:1.7">${nr.winners}</p>
      </div>
    </div>
    <div style="background:#fff;border:1px solid #fecdd3;border-radius:14px;overflow:hidden">
      <div style="height:3px;background:#f87171"></div>
      <div style="padding:18px 20px">
        <p style="font-size:11px;font-weight:700;color:#be123c;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">จุดเสี่ยง · Concerns</p>
        <p style="font-size:14px;color:#374151;line-height:1.7">${nr.concerns}</p>
      </div>
    </div>
  </div>

  ${insightsList ? sectionCard('Key Data Insights', '#0369a1', 'linear-gradient(90deg,#8FA3B0,#A9CCC4)', `<div style="background:#f0f9ff;border-radius:10px;padding:16px">${insightsList}</div>`) : ''}

  ${(nr.deviceAnalysis || nr.locationInsights || nr.wastedBudget) ? `
  <div class="grid3" style="display:grid;grid-template-columns:repeat(${[nr.deviceAnalysis, nr.locationInsights, nr.wastedBudget].filter(Boolean).length},minmax(0,1fr));gap:14px;margin-bottom:24px">
    ${nr.deviceAnalysis ? `<div style="background:#fff;border:1px solid #ddd6fe;border-radius:12px;padding:18px"><p style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Device Analysis</p><p style="font-size:13px;color:#374151;line-height:1.7">${nr.deviceAnalysis}</p></div>` : ''}
    ${nr.locationInsights ? `<div style="background:#fff;border:1px solid #fde68a;border-radius:12px;padding:18px"><p style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Location Insights</p><p style="font-size:13px;color:#374151;line-height:1.7">${nr.locationInsights}</p></div>` : ''}
    ${nr.wastedBudget ? `<div style="background:#fff;border:1px solid #fecdd3;border-radius:12px;padding:18px"><p style="font-size:11px;font-weight:700;color:#be123c;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Wasted Budget</p><p style="font-size:13px;color:#374151;line-height:1.7">${nr.wastedBudget}</p></div>` : ''}
  </div>` : ''}

  ${actionsList ? sectionCard('Action Items · แผนงาน 30 วัน', '#374151', 'linear-gradient(90deg,#94a3b8,#cbd5e1)', actionsList) : ''}

  ${nr.outlook ? `
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:18px 20px;margin-bottom:24px;display:flex;gap:14px;align-items:flex-start">
    <div style="min-width:32px;height:32px;border-radius:50%;background:#0ea5e9;display:flex;align-items:center;justify-content:center">
      <span style="color:white;font-size:14px">↗</span>
    </div>
    <div>
      <p style="font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Outlook</p>
      <p style="font-size:14px;color:#0c4a6e;line-height:1.7">${nr.outlook}</p>
    </div>
  </div>` : ''}
  ` : ''}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
    <p style="font-size:12px;color:#9ca3af">รายงานนี้จัดทำโดยทีม Account Management · ${generatedDate}</p>
    <p style="font-size:12px;color:#d1d5db">${acctName} · ${period}</p>
  </div>

</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `${(acctName).replace(/\s+/g, '_')}_Report_${dateRange}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const maxCostKw  = Math.max(1, ...(keywords ?? []).map((k) => k.cost))
  const maxCostLoc = Math.max(1, ...(locations ?? []).map((l) => l.cost))
  const maxImpDev  = Math.max(1, ...(devices ?? []).map((d) => d.impressions))

  return (
    <AppShell>
    <div className={cn('space-y-5 text-[#3D4852] [font-variant-numeric:tabular-nums]', notoThai.className)}>

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-[#5B9E92]" />Reports
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Google Ads Performance — ข้อมูลจริงจาก API</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {/* Account */}
          <div className="relative flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-sm min-w-[200px]">
            <Users className="w-4 h-4 text-gray-400 shrink-0" />
            {accountsLoading ? <span className="text-sm text-gray-400 flex-1">Loading...</span> : (
              <AccountSelect
                accounts={accounts}
                value={selectedId}
                onChange={setSelectedId}
                emptyLabel="ไม่พบ account"
                className="flex-1 bg-transparent text-sm text-gray-700 font-medium outline-none cursor-pointer"
              />
            )}
          </div>
          {/* Date range */}
          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-sm">
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <select value={dateRange.startsWith('CUSTOM_') ? 'CUSTOM' : dateRange}
              onChange={(e) => {
                if (e.target.value === 'CUSTOM') {
                  const end = new Date(); const start = new Date(Date.now() - 29 * 86400000)
                  const iso = (d: Date) => d.toISOString().slice(0, 10)
                  setCustomStart((p) => p || iso(start)); setCustomEnd((p) => p || iso(end))
                  setDateRange(`CUSTOM_${customStart || iso(start)}_${customEnd || iso(end)}`)
                } else setDateRange(e.target.value)
              }}
              className="text-sm text-gray-700 bg-transparent outline-none cursor-pointer">
              {DATE_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {dateRange.startsWith('CUSTOM_') && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-sm">
              <input type="date" value={customStart} max={customEnd || undefined}
                onChange={(e) => { setCustomStart(e.target.value); if (e.target.value && customEnd) setDateRange(`CUSTOM_${e.target.value}_${customEnd}`) }}
                className="text-xs text-gray-700 bg-transparent outline-none" />
              <span className="text-xs text-gray-400">–</span>
              <input type="date" value={customEnd} min={customStart || undefined}
                onChange={(e) => { setCustomEnd(e.target.value); if (customStart && e.target.value) setDateRange(`CUSTOM_${customStart}_${e.target.value}`) }}
                className="text-xs text-gray-700 bg-transparent outline-none" />
            </div>
          )}
          {/* KPI — เลือกชนิดได้ (CPA/ROAS) แต่ละเว็บไม่เหมือนกัน */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-sm">
            <select value={kpiType}
              onChange={(e) => {
                const v = e.target.value as 'CPA' | 'ROAS'
                setKpiType(v)
                try { localStorage.setItem(`reports-kpi:${selectedId}`, v) } catch { /* private mode */ }
              }}
              className="text-xs text-gray-500 bg-transparent outline-none cursor-pointer">
              <option value="CPA">Target CPA ฿</option>
              <option value="ROAS">Target ROAS</option>
            </select>
            {kpiType === 'CPA' ? (
              <input type="number" value={targetCPA}
                onChange={(e) => { setTargetCPA(e.target.value); try { localStorage.setItem(`reports-tcpa:${selectedId}`, e.target.value) } catch { /* private mode */ } }}
                onBlur={loadReport}
                className="w-16 text-sm font-medium text-gray-700 bg-transparent outline-none" />
            ) : (
              <span className="flex items-center gap-0.5">
                <input type="number" step="0.5" value={targetROAS}
                  onChange={(e) => { setTargetROAS(e.target.value); try { localStorage.setItem(`reports-troas:${selectedId}`, e.target.value) } catch { /* private mode */ } }}
                  className="w-12 text-sm font-medium text-gray-700 bg-transparent outline-none" />
                <span className="text-xs text-gray-400">x</span>
              </span>
            )}
          </div>
          {/* เลือกข้อมูลที่จะใส่ในรายงาน — มีผลทั้ง Export HTML และเมล */}
          <div className="relative">
            <button onClick={() => setSectionPickerOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50">
              เลือกข้อมูล{hiddenCount > 0 ? ` (ซ่อน ${hiddenCount})` : ''} ▾
            </button>
            {sectionPickerOpen && (
              <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-3 space-y-1">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-1">
                  <p className="text-xs font-semibold text-gray-600">ใส่ในรายงาน (Export + เมล)</p>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={() => saveSections(Object.fromEntries(EXPORT_SECTIONS.map(x => [x.key, true])))} className="text-blue-600 hover:underline">เลือกทั้งหมด</button>
                    <button onClick={() => saveSections(Object.fromEntries(EXPORT_SECTIONS.map(x => [x.key, x.key === 'kpi'])))} className="text-gray-400 hover:underline">เอาออกทั้งหมด</button>
                  </div>
                </div>
                {EXPORT_SECTIONS.map(x => (
                  <label key={x.key} className="flex items-center gap-2.5 px-1.5 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={sec(x.key)}
                      onChange={() => saveSections({ ...exportSections, [x.key]: !sec(x.key) })}
                      className="w-3.5 h-3.5 text-blue-600 rounded" />
                    <span className="text-xs text-gray-700">{x.label}</span>
                  </label>
                ))}
                <p className="text-[10px] text-gray-300 pt-1.5 border-t border-gray-100">ระบบจำตัวเลือกไว้ให้ · ติ๊กออก = ไม่ใส่ทั้งใน Export HTML และเมลรายงาน</p>
              </div>
            )}
          </div>
          {/* Export — ปุ่มหลักบน header กดได้ตลอด (เดิมซ่อนใน Email Draft ต้องกดขยายก่อน) */}
          <button onClick={exportHTML} disabled={!report}
            title={!report ? 'รอข้อมูลโหลดก่อน' : 'ดาวน์โหลดรายงาน HTML ฉบับส่งลูกค้า'}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-[#5B9E92] rounded-xl shadow-sm hover:bg-[#4A8A7E] disabled:opacity-40 transition-colors">
            <Download className="w-3.5 h-3.5" />
            Export Report
          </button>
          {/* Sync */}
          <button onClick={syncData} disabled={syncing || !selectedId}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing...' : 'Sync & Refresh'}
          </button>
        </div>
      </div>

      {/* Account badge */}
      {selectedAccount && !accountsLoading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-sm">
          <span className="w-2 h-2 bg-blue-500 rounded-full" />
          <span className="font-medium text-blue-800">{selectedAccount.descriptiveName}</span>
          <span className="text-blue-400 font-mono text-xs">{selectedAccount.id}</span>
          <span className="text-blue-400">·</span>
          <span className="text-blue-600 text-xs">{selectedAccount.currencyCode}</span>
          {selectedAccount.testAccount && <span className="ml-auto text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">Test Account</span>}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {/* ── Market Share / Visibility Share (โมดูลแยก — ไม่กระทบ report เดิม) ── */}
      {selectedId && !loading && (
        <MarketShareSection customerId={selectedId} dateRange={dateRange} />
      )}

      {/* ── Dimension Tabs ── */}
      {selectedId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Tab bar */}
          <div className="flex gap-1 p-2 border-b border-gray-100 overflow-x-auto">
            <TabBtn active={activeTab === 'overview'}     onClick={() => setActiveTab('overview')}     icon={BarChart2}    label="Overview" />
            <TabBtn active={activeTab === 'campaigns'}    onClick={() => setActiveTab('campaigns')}    icon={Layers}       label="Campaigns" />
            <TabBtn active={activeTab === 'keywords'}     onClick={() => setActiveTab('keywords')}     icon={Search}       label="Keywords" />
            <TabBtn active={activeTab === 'search_terms'} onClick={() => setActiveTab('search_terms')} icon={Search}       label="Search Terms" />
            <TabBtn active={activeTab === 'text_ads'}     onClick={() => setActiveTab('text_ads')}     icon={FileText}     label="Text Ads" />
            <TabBtn active={activeTab === 'audiences'}    onClick={() => setActiveTab('audiences')}    icon={Users}        label="Audiences" />
            <TabBtn active={activeTab === 'locations'}    onClick={() => setActiveTab('locations')}    icon={MapPin}       label="Locations" />
            <TabBtn active={activeTab === 'devices'}      onClick={() => setActiveTab('devices')}      icon={Monitor}      label="Devices" />
            <TabBtn active={activeTab === 'time'}         onClick={() => setActiveTab('time')}         icon={Clock}        label="Time" />
            <TabBtn active={activeTab === 'conversions'}  onClick={() => setActiveTab('conversions')}  icon={Target}       label="Conversions" />
            <TabBtn active={activeTab === 'ecommerce'}    onClick={() => setActiveTab('ecommerce')}    icon={ShoppingCart} label="E-commerce" />
          </div>

          <div className="p-0">

            {/* OVERVIEW — long-form single-page view */}
            {activeTab === 'overview' && (
              <div className="divide-y divide-gray-100">
                {!s ? <EmptyDim /> : (
                  <>
                    {/* 1. Performance Summary — 6 metric cards */}
                    <div className="p-5 space-y-3">
                      <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em]">Performance Summary</p>
                      <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', isEcommerceAccount ? 'xl:grid-cols-8' : 'xl:grid-cols-6')}>
                        {[
                          { label: 'Total Spend',   value: formatCurrency(s.totalCost),          changeKey: 'cost',        changeVal: s.changes?.totalCost,        accent: '#5B9E92', soft: '#EDF4F2' },
                          { label: 'Conversions',   value: formatConversions(s.totalConversions), changeKey: 'conversions', changeVal: s.changes?.totalConversions,  accent: '#84AE8C', soft: '#F0F6F1' },
                          ...(isEcommerceAccount ? [
                            { label: 'Conv. Value', value: formatCurrency(totalConvValue), changeKey: 'conversions', changeVal: null as number | null, accent: '#5B9E92', soft: '#EDF4F2' },
                            { label: 'ROAS',        value: `${accountRoas.toFixed(2)}x`,   changeKey: 'ctr',         changeVal: null as number | null, accent: accountRoas >= 3 ? '#84AE8C' : accountRoas >= 1 ? '#C9AF6E' : '#D08C8C', soft: '#F0F6F1' },
                          ] : []),
                          ...(kpiType === 'ROAS' ? [
                            { label: 'ROAS vs Target', value: `${accountRoas.toFixed(2)}x`, changeKey: 'ctr', changeVal: null as number | null, accent: accountRoas >= Number(targetROAS) ? '#84AE8C' : '#D08C8C', soft: accountRoas >= Number(targetROAS) ? '#F0F6F1' : '#FAF0F0' },
                          ] : [
                            { label: 'CPA vs Target', value: formatCurrency(s.blendedCPA), changeKey: 'cpa', changeVal: s.changes?.blendedCPA, accent: s.cpaVsTarget !== null && s.cpaVsTarget > 20 ? '#D08C8C' : '#84AE8C', soft: s.cpaVsTarget !== null && s.cpaVsTarget > 20 ? '#FAF0F0' : '#F0F6F1' },
                          ]),
                          { label: 'CTR',           value: `${s.blendedCTR.toFixed(2)}%`,        changeKey: 'ctr',         changeVal: s.changes?.blendedCTR,        accent: '#A48EB8', soft: '#F5F2F8' },
                          { label: 'Clicks',        value: formatNumber(s.totalClicks),          changeKey: 'clicks',      changeVal: s.changes?.totalClicks,       accent: '#C9AF6E', soft: '#F9F6EE' },
                          { label: 'Impressions',   value: formatNumber(s.totalImpressions),     changeKey: 'impressions', changeVal: s.changes?.totalImpressions,  accent: '#8FA3B0', soft: '#F1F4F6' },
                        ].map((m) => (
                          <div key={m.label} className="rounded-2xl p-3.5 space-y-1.5 border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)]">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.accent }} />
                              <p className="text-[10px] font-semibold text-[#93A1AB] uppercase tracking-wide truncate">{m.label}</p>
                            </div>
                            <p className="text-xl font-bold tabular-nums" style={{ color: m.accent }}>{m.value}</p>
                            {m.label === 'ROAS vs Target' && (
                              <p className="text-[10px] font-semibold rounded-full inline-block px-2 py-0.5" style={{ background: m.soft, color: m.accent }}>
                                {Number(targetROAS) > 0
                                  ? (accountRoas >= Number(targetROAS)
                                      ? `+${(((accountRoas - Number(targetROAS)) / Number(targetROAS)) * 100).toFixed(1)}% ถึงเป้า ${targetROAS}x`
                                      : `${(((accountRoas - Number(targetROAS)) / Number(targetROAS)) * 100).toFixed(1)}% ต่ำกว่าเป้า ${targetROAS}x`)
                                  : `เป้า ${targetROAS}x`}
                              </p>
                            )}
                            {m.label === 'CPA vs Target' && s.cpaVsTarget !== null && (
                              <p className="text-[10px] font-semibold rounded-full inline-block px-2 py-0.5" style={{ background: m.soft, color: m.accent }}>{s.cpaVsTarget > 0 ? `+${s.cpaVsTarget}% เกินเป้า` : `${s.cpaVsTarget}% ต่ำกว่าเป้า`}</p>
                            )}
                            <ChangeBadge metricKey={m.changeKey} value={m.changeVal} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 1.5 Charts row — spend share donut + top campaigns bars */}
                    {(report?.campaigns?.length ?? 0) > 0 && (
                      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4">
                          <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em] mb-3">Spend Share by Campaign</p>
                          <DonutChart
                            centerLabel="Total Spend"
                            format={(v) => `฿${Math.round(v).toLocaleString()}`}
                            data={(() => {
                              const sorted = [...(report?.campaigns ?? [])].sort((a, b) => b.cost - a.cost)
                              const top = sorted.slice(0, 5).map(c => ({ name: c.campaignName.replace(/^CVC\s*-\s*/, ''), value: c.cost }))
                              const rest = sorted.slice(5).reduce((sum, c) => sum + c.cost, 0)
                              return rest > 0 ? [...top, { name: 'อื่นๆ', value: rest }] : top
                            })()} />
                        </div>
                        <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4">
                          <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em] mb-3">Spend vs Conversions — Top Campaigns</p>
                          <CampaignBarChart data={[...(report?.campaigns ?? [])].sort((a, b) => b.cost - a.cost).slice(0, 6).map(c => ({
                            name: c.campaignName.replace(/^CVC\s*-\s*/, '').slice(0, 14),
                            spend: c.cost, conv: c.conversions,
                          }))} />
                        </div>
                      </div>
                    )}

                    {/* 2. Campaign Table — full inline */}
                    <div>
                      <div className="px-5 py-3 flex items-center justify-between">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Campaigns ({report?.campaigns?.length ?? 0})</p>
                        <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                          <Download className="w-3.5 h-3.5" />CSV
                        </button>
                      </div>
                      {!report?.campaigns?.length ? <EmptyDim /> : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-100">
                              <tr>
                                <SortTh col="campaignName" label="Campaign" {...campSort} />
                                <SortTh col="cost"        label="Spend"  {...campSort} className="text-right" />
                                <SortTh col="conversions" label="Conv."  {...campSort} className="text-right" />
                                <SortTh col="cpa"         label="CPA"    {...campSort} className="text-right" />
                                <SortTh col="clicks"      label="Clicks" {...campSort} className="text-right" />
                                <SortTh col="ctr"         label="CTR"    {...campSort} className="text-right" />
                                <SortTh col="cpc"         label="CPC"    {...campSort} className="text-right" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {(campSort.sorted as unknown as CampaignRow[]).map((c, i) => (
                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                  <Td><span className="font-medium text-gray-900">{c.campaignName}</span></Td>
                                  <Td className="text-right">
                                    <div className="font-medium">{formatCurrency(c.cost)}</div>
                                    <ChangeBadge metricKey="cost" value={c.changes?.cost} />
                                  </Td>
                                  <Td className="text-right">
                                    <div className="font-semibold text-emerald-600">{formatConversions(c.conversions)}</div>
                                    <ChangeBadge metricKey="conversions" value={c.changes?.conversions} />
                                  </Td>
                                  <Td className="text-right">
                                    <div className={cn('font-semibold', c.cpa > 0 ? (c.cpa > (s?.blendedCPA ?? 0) * 1.3 ? 'text-red-500' : c.cpa < (s?.blendedCPA ?? 0) * 0.8 ? 'text-emerald-600' : 'text-gray-700') : 'text-gray-300')}>{c.cpa > 0 ? formatCurrency(c.cpa) : '—'}</div>
                                    <ChangeBadge metricKey="cpa" value={c.changes?.cpa} />
                                  </Td>
                                  <Td className="text-right">
                                    <div>{formatNumber(c.clicks)}</div>
                                    <ChangeBadge metricKey="clicks" value={c.changes?.clicks} />
                                  </Td>
                                  <Td className="text-right">
                                    <div className={cn('font-semibold', metricValueColor('ctr', c.ctr ?? 0))}>{(c.ctr ?? 0).toFixed(2)}%</div>
                                    <ChangeBadge metricKey="ctr" value={c.changes?.ctr} />
                                  </Td>
                                  <Td className="text-right">
                                    <div className={cn(c.cpc > 0 ? 'text-gray-700' : 'text-gray-300')}>{formatCurrency(c.cpc)}</div>
                                    <ChangeBadge metricKey="cpc" value={c.changes?.cpc} />
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50 border-t border-gray-200">
                              <tr>
                                <td className="px-4 py-2.5 text-xs font-bold text-gray-500">รวมทั้งหมด</td>
                                <td className="px-4 py-2.5 text-sm font-bold text-right">{formatCurrency(s.totalCost)}</td>
                                <td className="px-4 py-2.5 text-sm font-bold text-right">{s.totalConversions.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-sm font-bold text-right">{s.blendedCPA > 0 ? formatCurrency(s.blendedCPA) : '—'}</td>
                                <td className="px-4 py-2.5 text-sm font-bold text-right">{formatNumber(s.totalClicks)}</td>
                                <td className="px-4 py-2.5 text-sm font-bold text-right">{s.blendedCTR.toFixed(2)}%</td>
                                <td className="px-4 py-2.5" />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 3. Top Keywords by Spend */}
                    <div>
                      <div className="px-5 py-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Top Keywords by Spend (top 10)</p>
                      </div>
                      {!keywords?.length ? (
                        <div className="px-5 pb-4 text-sm text-gray-400">ไม่มีข้อมูล keyword</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-100">
                              <tr><Th>Keyword</Th><Th>Match</Th><Th className="text-right">Spend</Th><Th className="text-right">Conv.</Th><Th className="text-right">CPA</Th><Th className="text-right">CTR</Th><Th>Volume</Th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {[...keywords].sort((a, b) => b.cost - a.cost).slice(0, 10).map((k, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                  <Td><span className="font-medium text-gray-900">{k.keyword}</span></Td>
                                  <Td><span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', MATCH_COLOR[k.matchType] ?? 'bg-gray-100 text-gray-600')}>{MATCH_LABEL[k.matchType] ?? k.matchType}</span></Td>
                                  <Td className="text-right font-medium">{formatCurrency(k.cost)}</Td>
                                  <Td className="text-right font-semibold text-emerald-600">{formatConversions(k.conversions)}</Td>
                                  <Td className={cn('text-right font-semibold', k.cpa > 0 ? 'text-gray-700' : 'text-gray-300')}>{k.cpa > 0 ? formatCurrency(k.cpa) : '—'}</Td>
                                  <Td className={cn('text-right font-semibold', metricValueColor('ctr', k.ctr ?? 0))}>{(k.ctr ?? 0).toFixed(2)}%</Td>
                                  <Td><MetricBar value={k.cost} max={maxCostKw} /></Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 4. Device Split */}
                    <div>
                      <div className="px-5 py-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Device Split</p>
                      </div>
                      {!devices?.length ? (
                        <div className="px-5 pb-4 text-sm text-gray-400">ไม่มีข้อมูล device</div>
                      ) : (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                          {devices.map((d, i) => (
                            <div key={i} className="bg-gray-50 rounded-xl p-4 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-gray-800 text-sm">{DEVICE_LABEL[d.device] ?? d.device}</span>
                                <span className="text-xs text-gray-400">{maxImpDev > 0 ? Math.round((d.impressions / maxImpDev) * 100) : 0}%</span>
                              </div>
                              <MetricBar value={d.impressions} max={maxImpDev} />
                              <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                                <span>Spend: <b className="text-gray-800">{formatCurrency(d.cost)}</b></span>
                                <span>Clicks: <b className="text-gray-800">{formatNumber(d.clicks)}</b></span>
                                <span>Conv: <b className="text-emerald-600">{formatConversions(d.conversions)}</b></span>
                                <span>CPA: <b className="text-gray-800">{d.cpa > 0 ? formatCurrency(d.cpa) : '—'}</b></span>
                                <span>CTR: <b className="text-gray-800">{(d.ctr ?? 0).toFixed(2)}%</b></span>
                                <span>CPC: <b className="text-gray-800">{formatCurrency(d.cpc)}</b></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 5. Location Top 5 */}
                    <div>
                      <div className="px-5 py-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Top Locations (top 5)</p>
                      </div>
                      {!locations?.length ? (
                        <div className="px-5 pb-4 text-sm text-gray-400">ไม่มีข้อมูล location</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-100">
                              <tr><Th>Location</Th><Th className="text-right">Impressions</Th><Th className="text-right">Clicks</Th><Th className="text-right">Spend</Th><Th className="text-right">Conv.</Th><Th className="text-right">CPA</Th><Th>Share</Th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {[...locations].sort((a, b) => b.cost - a.cost).slice(0, 5).map((l, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                  <Td><span className="font-medium text-gray-900">{l.location}</span></Td>
                                  <Td className="text-right">{formatNumber(l.impressions)}</Td>
                                  <Td className="text-right">{formatNumber(l.clicks)}</Td>
                                  <Td className="text-right font-medium">{formatCurrency(l.cost)}</Td>
                                  <Td className="text-right font-semibold text-emerald-600">{formatConversions(l.conversions)}</Td>
                                  <Td className={cn('text-right font-semibold', l.cpa > 0 ? 'text-gray-700' : 'text-gray-300')}>{l.cpa > 0 ? formatCurrency(l.cpa) : '—'}</Td>
                                  <Td><MetricBar value={l.cost} max={maxCostLoc} /></Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 6. AI Recommendations grouped by priority */}
                    {report?.recommendations && report.recommendations.length > 0 && (
                      <div className="p-5 space-y-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Recommendations ({report.recommendations.length})</p>
                        {(['critical', 'high', 'medium', 'low'] as const).map((priority) => {
                          const recs = report.recommendations.filter((r) => r.priority === priority)
                          if (!recs.length) return null
                          return (
                            <div key={priority} className="space-y-2">
                              <p className={cn('text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full w-fit', PRIORITY_COLOR[priority])}>
                                {PRIORITY_LABEL[priority]} ({recs.length})
                              </p>
                              {recs.map((rec, i) => (
                                <div key={i} className={cn('rounded-xl border px-4 py-3 flex items-start gap-3', PRIORITY_COLOR[priority])}>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold">{rec.title}</p>
                                    <p className="text-xs opacity-80 mt-0.5">{rec.detail}</p>
                                    <p className="text-xs font-medium mt-1.5">→ {rec.action}</p>
                                    {rec.estimatedImpact && <p className="text-xs mt-0.5 opacity-70">✦ {rec.estimatedImpact}</p>}
                                  </div>
                                  <span className="shrink-0 text-[10px] opacity-60">{rec.campaignName === 'All Campaigns' ? 'ทุก campaign' : rec.campaignName.slice(0, 22)}</span>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* CAMPAIGNS */}
            {activeTab === 'campaigns' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Campaign Performance</span>
                  <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                    <Download className="w-3.5 h-3.5" />Export CSV
                  </button>
                </div>
                {!report?.campaigns?.length ? <EmptyDim /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <SortTh col="campaignName" label="Campaign" {...campSort} />
                          <SortTh col="cost"        label="Spend"    {...campSort} className="text-right" />
                          <SortTh col="conversions" label="Conv."    {...campSort} className="text-right" />
                          <SortTh col="cpa"         label="CPA"      {...campSort} className="text-right" />
                          <SortTh col="clicks"      label="Clicks"   {...campSort} className="text-right" />
                          <SortTh col="ctr"         label="CTR"      {...campSort} className="text-right" />
                          <SortTh col="cpc"         label="CPC"      {...campSort} className="text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(campSort.sorted as unknown as typeof report.campaigns).map((c, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            <Td><span className="font-medium text-gray-900">{c.campaignName}</span></Td>
                            <Td className="text-right">
                              <div className="font-medium">{formatCurrency(c.cost)}</div>
                              <ChangeBadge metricKey="cost" value={c.changes?.cost} />
                            </Td>
                            <Td className="text-right">
                              <div className="font-semibold text-emerald-600">{formatConversions(c.conversions)}</div>
                              <ChangeBadge metricKey="conversions" value={c.changes?.conversions} />
                            </Td>
                            <Td className="text-right">
                              <div className={cn('font-semibold', c.cpa > 0 ? (c.cpa > (s?.blendedCPA ?? 0) * 1.3 ? 'text-red-500' : c.cpa < (s?.blendedCPA ?? 0) * 0.8 ? 'text-emerald-600' : 'text-gray-700') : 'text-gray-300')}>{c.cpa > 0 ? formatCurrency(c.cpa) : '—'}</div>
                              <ChangeBadge metricKey="cpa" value={c.changes?.cpa} />
                            </Td>
                            <Td className="text-right">
                              <div>{formatNumber(c.clicks)}</div>
                              <ChangeBadge metricKey="clicks" value={c.changes?.clicks} />
                            </Td>
                            <Td className="text-right">
                              <div className={cn('font-semibold', metricValueColor('ctr', c.ctr ?? 0))}>{(c.ctr ?? 0).toFixed(2)}%</div>
                              <ChangeBadge metricKey="ctr" value={c.changes?.ctr} />
                            </Td>
                            <Td className="text-right">
                              <div className={cn(c.cpc > 0 ? 'text-gray-700' : 'text-gray-300')}>{formatCurrency(c.cpc)}</div>
                              <ChangeBadge metricKey="cpc" value={c.changes?.cpc} />
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr>
                          <td className="px-4 py-2.5 text-xs font-bold text-gray-500">รวมทั้งหมด</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-right">{s ? formatCurrency(s.totalCost) : '—'}</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-right">{s?.totalConversions.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-right">{s && s.blendedCPA > 0 ? formatCurrency(s.blendedCPA) : '—'}</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-right">{s ? formatNumber(s.totalClicks) : '—'}</td>
                          <td className="px-4 py-2.5 text-sm font-bold text-right">{s?.blendedCTR.toFixed(2)}%</td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* KEYWORDS */}
            {activeTab === 'keywords' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Keywords ({keywords?.length ?? 0})</span>
                  {dimLoading.keywords && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                </div>
                {!keywords?.length ? <EmptyDim /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <SortTh col="keyword"      label="Keyword" {...kwSort} />
                          <SortTh col="matchType"    label="Match"   {...kwSort} />
                          <SortTh col="qualityScore" label="QS"      {...kwSort} className="text-right" />
                          <SortTh col="cost"         label="Spend"   {...kwSort} className="text-right" />
                          <SortTh col="conversions"  label="Conv."   {...kwSort} className="text-right" />
                          <SortTh col="cpa"          label="CPA"     {...kwSort} className="text-right" />
                          <SortTh col="ctr"          label="CTR"     {...kwSort} className="text-right" />
                          <Th>Volume</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(kwSort.sorted as unknown as typeof keywords).map((k, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-medium text-gray-900">{k.keyword}</span></Td>
                            <Td><span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', MATCH_COLOR[k.matchType] ?? 'bg-gray-100 text-gray-600')}>{MATCH_LABEL[k.matchType] ?? k.matchType}</span></Td>
                            <Td className="text-right">
                              {k.qualityScore !== null ? (
                                <span className={cn('font-bold text-sm', metricValueColor('quality_score', k.qualityScore))}>{k.qualityScore}</span>
                              ) : <span className="text-gray-300">—</span>}
                            </Td>
                            <Td className="text-right font-medium">{formatCurrency(k.cost)}</Td>
                            <Td className="text-right font-semibold text-emerald-600">{formatConversions(k.conversions)}</Td>
                            <Td className={cn('text-right font-semibold', k.cpa > 0 ? 'text-gray-700' : 'text-gray-300')}>{k.cpa > 0 ? formatCurrency(k.cpa) : '—'}</Td>
                            <Td className={cn('text-right font-semibold', metricValueColor('ctr', k.ctr ?? 0))}>{(k.ctr ?? 0).toFixed(2)}%</Td>
                            <Td><MetricBar value={k.cost} max={maxCostKw} /></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* SEARCH TERMS */}
            {activeTab === 'search_terms' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Search Terms ({searchTerms?.length ?? 0})</span>
                  {dimLoading.search_terms && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                </div>
                {!searchTerms?.length ? <EmptyDim /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <SortTh col="searchTerm"    label="Search Term"      {...stSort} />
                          <SortTh col="matchedKeyword" label="Matched Keyword" {...stSort} />
                          <SortTh col="impressions"   label="Impressions"      {...stSort} className="text-right" />
                          <SortTh col="clicks"        label="Clicks"           {...stSort} className="text-right" />
                          <SortTh col="cost"          label="Spend"            {...stSort} className="text-right" />
                          <SortTh col="conversions"   label="Conv."            {...stSort} className="text-right" />
                          <SortTh col="ctr"           label="CTR"              {...stSort} className="text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(stSort.sorted as unknown as typeof searchTerms).map((st, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-medium text-gray-900">{st.searchTerm}</span></Td>
                            <Td><span className="text-xs text-gray-500 font-mono">{st.matchedKeyword || '—'}</span></Td>
                            <Td className="text-right">{formatNumber(st.impressions)}</Td>
                            <Td className="text-right">{st.clicks}</Td>
                            <Td className="text-right">{formatCurrency(st.cost)}</Td>
                            <Td className="text-right">{st.conversions > 0 ? <span className="font-semibold text-emerald-600">{formatConversions(st.conversions)}</span> : <span className="text-gray-300">0.00</span>}</Td>
                            <Td className={cn('text-right font-semibold', metricValueColor('ctr', st.ctr ?? 0))}>{(st.ctr ?? 0).toFixed(2)}%</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TEXT ADS */}
            {activeTab === 'text_ads' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Text Ads ({textAds?.length ?? 0})</span>
                  {dimLoading.text_ads && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                </div>
                {!textAds?.length ? <EmptyDim /> : (
                  <div className="divide-y divide-gray-50">
                    {textAds.map((ad, i) => {
                      const hasConv = ad.conversions > 0
                      const isGoodCtr = ad.ctr >= 5
                      const isGoodConv = ad.conversions >= 5
                      const isEditing = editingAdId === ad.adId
                      const isPushing = pushingAdId === ad.adId
                      const pushResult = pushAdResult[ad.adId]
                      return (
                        <div key={i} className={cn('px-4 py-4', hasConv && 'bg-emerald-50/30', isEditing && 'bg-blue-50/40')}>
                          {/* Campaign / Ad Group */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{ad.campaignName}</span>
                            <ChevronRight className="w-3 h-3 text-gray-300" />
                            <span className="text-[10px] text-gray-400">{ad.adGroupName}</span>
                            {ad.adStrength && (
                              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                                ad.adStrength === 'EXCELLENT' ? 'bg-emerald-100 text-emerald-700' :
                                ad.adStrength === 'GOOD' ? 'bg-blue-100 text-blue-700' :
                                ad.adStrength === 'AVERAGE' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-500'
                              )}>Ad Strength: {ad.adStrength}</span>
                            )}
                            <div className="ml-auto flex items-center gap-1.5">
                              {pushResult === 'ok' && (
                                <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Push สำเร็จ
                                </span>
                              )}
                              {pushResult === 'error' && (
                                <span className="text-[10px] text-red-500 font-semibold flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" /> Push ไม่สำเร็จ
                                </span>
                              )}
                              {isEditing ? (
                                <button onClick={cancelEditAd} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button onClick={() => startEditAd(ad)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors">
                                  <Edit2 className="w-3 h-3" /> แก้ไข
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Ad Preview (read-only) */}
                          {!isEditing && (
                            <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
                              <div className="text-[10px] text-green-600 font-medium mb-0.5">Ad · {ad.finalUrl?.split('/')[2] ?? 'example.com'}</div>
                              <div className="text-sm font-semibold text-blue-700 leading-snug mb-1">
                                {ad.headlines.slice(0, 3).join(' | ')}
                              </div>
                              <div className="text-xs text-gray-600 leading-snug">
                                {ad.descriptions.slice(0, 2).join(' ')}
                              </div>
                            </div>
                          )}

                          {/* Inline Edit Panel */}
                          {isEditing && (
                            <div className="mb-3 bg-white border border-blue-200 rounded-lg p-3 space-y-3">
                              {/* Headlines */}
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Headlines (≤30 ตัวอักษร)</span>
                                  {editHeadlines.length < 15 && (
                                    <button onClick={() => setEditHeadlines(prev => [...prev, ''])} className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                                      <Plus className="w-3 h-3" /> เพิ่ม
                                    </button>
                                  )}
                                </div>
                                <div className="space-y-1.5">
                                  {editHeadlines.map((h, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                      <input
                                        value={h}
                                        maxLength={30}
                                        onChange={e => setEditHeadlines(prev => prev.map((v, j) => j === idx ? e.target.value : v))}
                                        className={cn('flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400',
                                          h.length > 30 ? 'border-red-400' : 'border-gray-200'
                                        )}
                                        placeholder={`Headline ${idx + 1}`}
                                      />
                                      <span className={cn('text-[10px] w-6 text-right', h.length > 30 ? 'text-red-500' : 'text-gray-400')}>{h.length}</span>
                                      {editHeadlines.length > 3 && (
                                        <button onClick={() => setEditHeadlines(prev => prev.filter((_, j) => j !== idx))} className="text-gray-300 hover:text-red-400">
                                          <Trash className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Descriptions */}
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Descriptions (≤90 ตัวอักษร)</span>
                                  {editDescriptions.length < 4 && (
                                    <button onClick={() => setEditDescriptions(prev => [...prev, ''])} className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
                                      <Plus className="w-3 h-3" /> เพิ่ม
                                    </button>
                                  )}
                                </div>
                                <div className="space-y-1.5">
                                  {editDescriptions.map((d, idx) => (
                                    <div key={idx} className="flex items-start gap-1.5">
                                      <textarea
                                        value={d}
                                        maxLength={90}
                                        rows={2}
                                        onChange={e => setEditDescriptions(prev => prev.map((v, j) => j === idx ? e.target.value : v))}
                                        className={cn('flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none',
                                          d.length > 90 ? 'border-red-400' : 'border-gray-200'
                                        )}
                                        placeholder={`Description ${idx + 1}`}
                                      />
                                      <div className="flex flex-col items-end gap-1 pt-1">
                                        <span className={cn('text-[10px]', d.length > 90 ? 'text-red-500' : 'text-gray-400')}>{d.length}</span>
                                        {editDescriptions.length > 2 && (
                                          <button onClick={() => setEditDescriptions(prev => prev.filter((_, j) => j !== idx))} className="text-gray-300 hover:text-red-400">
                                            <Trash className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Push Button */}
                              <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                                <span className="text-[10px] text-gray-400">การแก้ไขจะ push ขึ้น Google Ads ทันที</span>
                                <button
                                  onClick={() => pushAdEdit(ad)}
                                  disabled={isPushing || editHeadlines.filter(h => h.trim()).length < 3 || editDescriptions.filter(d => d.trim()).length < 2}
                                  className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                                    isPushing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' :
                                    'bg-blue-600 text-white hover:bg-blue-700'
                                  )}
                                >
                                  {isPushing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                  {isPushing ? 'กำลัง Push...' : 'Push to Google Ads'}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Metrics */}
                          <div className="flex flex-wrap gap-3 text-xs">
                            <div className="flex items-center gap-1 text-gray-500">
                              <Eye className="w-3 h-3" />
                              <span>{formatNumber(ad.impressions)} impr</span>
                            </div>
                            <div className="flex items-center gap-1 text-gray-500">
                              <MousePointer className="w-3 h-3" />
                              <span>{ad.clicks} clicks</span>
                            </div>
                            <div className={cn('flex items-center gap-1 font-semibold', isGoodCtr ? 'text-emerald-600' : 'text-amber-600')}>
                              CTR {ad.ctr.toFixed(2)}%
                              {isGoodCtr ? <TrendingUp className="w-3 h-3" /> : null}
                            </div>
                            <div className="flex items-center gap-1 text-gray-500">
                              Spend {formatCurrency(ad.cost)}
                            </div>
                            {hasConv ? (
                              <>
                                <div className={cn('flex items-center gap-1 font-semibold', isGoodConv ? 'text-emerald-700' : 'text-gray-700')}>
                                  <Zap className="w-3 h-3" />
                                  {formatConversions(ad.conversions)} conv
                                </div>
                                <div className="text-gray-500">CPA {formatCurrency(ad.cpa)}</div>
                              </>
                            ) : (
                              <div className="text-gray-300">0 conversion</div>
                            )}
                          </div>

                          {/* Insight badge */}
                          {isGoodConv && (
                            <div className="mt-2 text-[10px] bg-emerald-100 text-emerald-700 rounded px-2 py-1 inline-flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              Ad นี้ conv ดี — ใช้เป็น control ก่อน pause ad อื่น
                            </div>
                          )}
                          {!hasConv && ad.cost > 500 && (
                            <div className="mt-2 text-[10px] bg-amber-100 text-amber-700 rounded px-2 py-1 inline-flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Spend ฿{ad.cost.toFixed(2)} แต่ยังไม่มี conv — ลอง refresh headline หรือ description
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* AUDIENCES */}
            {activeTab === 'audiences' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Audiences ({audiences?.length ?? 0})</span>
                </div>
                {!audiences?.length ? <EmptyDim note="ข้อมูลนี้มาจาก audience ที่ผูกกับแคมเปญ Search/Display (targeting หรือ observation) — แคมเปญ Performance Max ไม่รายงานผลราย audience ผ่าน Google API (audience ใน PMax เป็นเพียง signal) ถ้าบัญชีเป็น PMax ทั้งหมด ตารางนี้จะว่าง" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <SortTh col="audienceName" label="Audience"    {...audSort} />
                          <SortTh col="type"         label="Type"        {...audSort} />
                          <SortTh col="impressions"  label="Impressions" {...audSort} className="text-right" />
                          <SortTh col="clicks"       label="Clicks"      {...audSort} className="text-right" />
                          <SortTh col="cost"         label="Spend"       {...audSort} className="text-right" />
                          <SortTh col="conversions"  label="Conv."       {...audSort} className="text-right" />
                          <SortTh col="cpa"          label="CPA"         {...audSort} className="text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(audSort.sorted as unknown as typeof audiences).map((a, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-medium text-gray-900">{a.audienceName}</span></Td>
                            <Td><span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">{a.type.replace('_', ' ')}</span></Td>
                            <Td className="text-right">{formatNumber(a.impressions)}</Td>
                            <Td className="text-right">{formatNumber(a.clicks)}</Td>
                            <Td className="text-right font-medium">{formatCurrency(a.cost)}</Td>
                            <Td className="text-right font-semibold text-emerald-600">{formatConversions(a.conversions)}</Td>
                            <Td className={cn('text-right font-semibold', a.cpa > 0 ? 'text-gray-700' : 'text-gray-300')}>{a.cpa > 0 ? formatCurrency(a.cpa) : '—'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* LOCATIONS */}
            {activeTab === 'locations' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Locations ({locations?.length ?? 0})</span>
                </div>
                {!locations?.length ? <EmptyDim /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <SortTh col="location"    label="Location"    {...locSort} />
                          <SortTh col="impressions" label="Impressions" {...locSort} className="text-right" />
                          <SortTh col="clicks"      label="Clicks"      {...locSort} className="text-right" />
                          <SortTh col="cost"        label="Spend"       {...locSort} className="text-right" />
                          <SortTh col="conversions" label="Conv."       {...locSort} className="text-right" />
                          <SortTh col="cpa"         label="CPA"         {...locSort} className="text-right" />
                          <Th>Share</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(locSort.sorted as unknown as typeof locations).map((l, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-medium text-gray-900">{l.location}</span></Td>
                            <Td className="text-right">{formatNumber(l.impressions)}</Td>
                            <Td className="text-right">{formatNumber(l.clicks)}</Td>
                            <Td className="text-right font-medium">{formatCurrency(l.cost)}</Td>
                            <Td className="text-right font-semibold text-emerald-600">{formatConversions(l.conversions)}</Td>
                            <Td className={cn('text-right font-semibold', l.cpa > 0 ? 'text-gray-700' : 'text-gray-300')}>{l.cpa > 0 ? formatCurrency(l.cpa) : '—'}</Td>
                            <Td><MetricBar value={l.cost} max={maxCostLoc} /></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* DEVICES */}
            {activeTab === 'devices' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Devices</span>
                </div>
                {!devices?.length ? <EmptyDim /> : (
                  <>
                  <div className="p-4 pb-0">
                    <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4 max-w-xl">
                      <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em] mb-3">Impressions by Device</p>
                      <DonutChart centerLabel="Impressions"
                        format={(v) => formatNumber(v)}
                        data={devices.map(d => ({ name: DEVICE_LABEL[d.device] ?? d.device, value: d.impressions }))} />
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {devices.map((d, i) => (
                      <div key={i} className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-800 text-sm">{DEVICE_LABEL[d.device] ?? d.device}</span>
                          <span className="text-xs text-gray-400">{maxImpDev > 0 ? Math.round((d.impressions / maxImpDev) * 100) : 0}%</span>
                        </div>
                        <MetricBar value={d.impressions} max={maxImpDev} />
                        <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                          <span>Spend: <b className="text-gray-800">{formatCurrency(d.cost)}</b></span>
                          <span>Clicks: <b className="text-gray-800">{formatNumber(d.clicks)}</b></span>
                          <span>Conv: <b className="text-emerald-600">{formatConversions(d.conversions)}</b></span>
                          <span>CPA: <b className="text-gray-800">{d.cpa > 0 ? formatCurrency(d.cpa) : '—'}</b></span>
                          <span>CTR: <b className="text-gray-800">{(d.ctr ?? 0).toFixed(2)}%</b></span>
                          <span>CPC: <b className="text-gray-800">{formatCurrency(d.cpc)}</b></span>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                )}
              </div>
            )}

            {/* TIME */}
            {activeTab === 'time' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Daily Performance ({timeData?.length ?? 0} days)</span>
                </div>
                {!timeData?.length ? <EmptyDim /> : (
                  <>
                  <div className="p-4 pb-2">
                    <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4">
                      <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em] mb-3">Spend & Conversions Trend</p>
                      <TrendChart data={[...timeData].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ date: d.date.slice(5), cost: d.cost, conv: d.conversions }))} />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr><Th>Date</Th><Th className="text-right">Impressions</Th><Th className="text-right">Clicks</Th><Th className="text-right">Spend</Th><Th className="text-right">Conv.</Th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {timeData.map((t, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-mono text-xs text-gray-600">{t.date}</span></Td>
                            <Td className="text-right">{formatNumber(t.impressions)}</Td>
                            <Td className="text-right">{formatNumber(t.clicks)}</Td>
                            <Td className="text-right font-medium">{formatCurrency(t.cost)}</Td>
                            <Td className="text-right">{t.conversions > 0 ? <span className="font-semibold text-emerald-600">{formatConversions(t.conversions)}</span> : '—'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            )}

            {/* CONVERSIONS */}
            {activeTab === 'conversions' && (
              <div>
                <div className="px-4 py-3 border-b border-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Conversion Actions</span>
                </div>
                {!conversions?.actions?.length ? <EmptyDim /> : (
                  <>
                  <div className="p-4 pb-2">
                    <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4 max-w-xl">
                      <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em] mb-3">Conversions by Action</p>
                      <DonutChart centerLabel="Conversions"
                        format={(v) => formatConversions(v)}
                        data={[...conversions.actions].sort((a, b) => b.conversions - a.conversions).slice(0, 6)
                          .map(a => ({ name: a.conversionName, value: a.conversions })).filter(x => x.value > 0)} />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr><Th>Conversion Action</Th><Th>Category</Th><Th className="text-right">Conversions</Th><Th className="text-right">All Conv.</Th><Th className="text-right">View-through</Th><Th className="text-right">Value (฿)</Th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {conversions.actions.map((a, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <Td><span className="font-medium text-gray-900 font-mono text-xs">{a.conversionName}</span></Td>
                            <Td><span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">{a.category}</span></Td>
                            <Td className="text-right font-bold text-emerald-600">{formatConversions(a.conversions)}</Td>
                            <Td className="text-right text-gray-500">{formatConversions(a.allConversions)}</Td>
                            <Td className="text-right text-gray-400">{formatConversions(a.viewThroughConversions)}</Td>
                            <Td className="text-right">{a.value > 0 ? formatCurrency(a.value) : '—'}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            )}

            {/* ECOMMERCE */}
            {activeTab === 'ecommerce' && (
              <div className="p-4 space-y-4">
                {!ecommerce ? <EmptyDim /> : (
                  <>
                    {/* Funnel */}
                    {ecommerce.ecommerceFunnel ? (
                      <div className="space-y-3">
                        <p className="text-[10px] font-bold text-[#93A1AB] uppercase tracking-[0.1em]">Sales Funnel</p>
                        <div className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-4">
                          <FunnelBars stages={[
                            { label: 'View Item',      value: ecommerce.ecommerceFunnel.view_item },
                            { label: 'Add to Cart',    value: ecommerce.ecommerceFunnel.add_to_cart },
                            { label: 'Begin Checkout', value: ecommerce.ecommerceFunnel.begin_checkout },
                            { label: 'Purchase',       value: ecommerce.ecommerceFunnel.purchase },
                          ]} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                          {[
                            { label: 'Revenue', value: formatCurrency(ecommerce.ecommerceFunnel.revenue) },
                            // API บางบัญชีคืน roas=0 ทั้งที่มี revenue — fallback คำนวณ revenue/spend เอง
                            { label: 'ROAS', value: (() => {
                              const f = ecommerce.ecommerceFunnel
                              const r = f.roas > 0 ? Number(f.roas) : (s && s.totalCost > 0 && f.revenue > 0 ? f.revenue / s.totalCost : 0)
                              return r > 0 ? `${r.toFixed(2)}x` : '—'
                            })() },
                            { label: 'AOV', value: formatCurrency(ecommerce.ecommerceFunnel.aov) },
                            { label: 'Cart Abandon', value: `${Number(ecommerce.ecommerceFunnel.cartAbandonRate).toFixed(2)}%` },
                          ].map((m) => (
                            <div key={m.label} className="rounded-2xl border border-[#ECEFEE] bg-white shadow-[0_1px_3px_rgba(61,72,82,0.04)] p-3 text-center">
                              <p className="text-xl font-bold tabular-nums text-[#5B9E92]">{m.value}</p>
                              <p className="text-[11px] text-[#93A1AB] mt-0.5 font-medium">{m.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-400 text-sm">ไม่พบ E-commerce conversion actions — ติดตั้ง purchase tracking ก่อน</div>
                    )}
                    {/* Conversion action table */}
                    {ecommerce.actions.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr><Th>Conversion</Th><Th className="text-right">Count</Th><Th className="text-right">Revenue</Th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {ecommerce.actions.map((a, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <Td><span className="font-mono text-xs text-gray-700">{a.conversionName}</span></Td>
                                <Td className="text-right font-bold text-emerald-600">{formatConversions(a.conversions)}</Td>
                                <Td className="text-right">{a.value > 0 ? formatCurrency(a.value) : '—'}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {!loading && !report && !error && selectedId && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <BarChart2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">กำลังโหลดข้อมูลจาก Google Ads API...</p>
        </div>
      )}

      {/* ── Performance Report ── (loads after all data is ready) */}
      {(narrativeLoading || narrative) && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Performance Report</span>
            {narrativeLoading && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />}
          </div>

          {narrativeLoading ? (
            <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border border-blue-100 rounded-2xl p-6 space-y-3 animate-pulse">
              <div className="h-6 bg-blue-100 rounded-lg w-3/4" />
              <div className="h-4 bg-blue-100 rounded w-full" />
              <div className="h-4 bg-blue-100 rounded w-5/6" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-20 bg-emerald-100 rounded-xl" />
                <div className="h-20 bg-red-100 rounded-xl" />
              </div>
              <div className="space-y-2">
                {[1,2,3,4,5].map((i) => <div key={i} className="h-3 bg-blue-100 rounded w-full" />)}
              </div>
              <p className="text-center text-xs text-blue-400 italic">กำลังวิเคราะห์ข้อมูลและเขียนรายงาน...</p>
            </div>
          ) : narrative && (
            <>
              {/* ══════════════════════════════════════════════════════════
                  PERFORMANCE REPORT CARD — redesigned
              ══════════════════════════════════════════════════════════ */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

                {/* gradient accent */}
                <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />

                {/* ── Header ── */}
                <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4 flex-wrap border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Performance Report · Strategic Analysis</p>
                      {isEcommerceAccount && <span className="text-[9px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-bold">E-commerce</span>}
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 leading-snug">{narrative.headline}</h2>
                    {/* status badge */}
                    {s && s.cpaVsTarget !== null && (
                      <span className={cn(
                        'mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
                        s.cpaVsTarget > 10
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', s.cpaVsTarget > 10 ? 'bg-red-500' : 'bg-emerald-500')} />
                        {s.cpaVsTarget > 10
                          ? `CPA เกินเป้า ${s.cpaVsTarget}%`
                          : `ดีมาก · CPA ต่ำกว่าเป้า ${Math.abs(s.cpaVsTarget)}%`}
                      </span>
                    )}
                  </div>
                  {s && (
                    <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-xs text-gray-500 font-medium">
                      {DATE_RANGES.find((r) => r.value === dateRange)?.label}
                    </div>
                  )}
                </div>

                {/* ── KPI Cards ── */}
                {s && (
                  <>
                  <div className={cn('grid gap-px bg-gray-100', isEcommerceAccount ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4')}>
                    {[
                      {
                        label: 'Total Spend',
                        value: formatCurrency(s.totalCost),
                        helper: `${formatNumber(s.totalImpressions)} impressions`,
                        color: 'text-blue-600',
                        changeKey: 'cost',
                        changeVal: s.changes?.totalCost,
                        eco: false,
                      },
                      {
                        label: 'Conversions',
                        value: formatConversions(s.totalConversions),
                        helper: `Conv Rate ${((s.totalConversions / Math.max(1, s.totalClicks)) * 100).toFixed(2)}%`,
                        color: 'text-emerald-600',
                        changeKey: 'conversions',
                        changeVal: s.changes?.totalConversions,
                        eco: false,
                      },
                      ...(isEcommerceAccount ? [
                        {
                          label: 'Conv. Value',
                          value: formatCurrency(totalConvValue),
                          helper: 'ยอดขายรวมจากโฆษณา',
                          color: 'text-emerald-700',
                          changeKey: 'conversions',
                          changeVal: null as null,
                          eco: true,
                        },
                        {
                          label: 'ROAS',
                          value: `${accountRoas.toFixed(2)}x`,
                          helper: accountRoas >= 3 ? 'ดีมาก — พร้อม scale' : accountRoas >= 1 ? 'คุ้มทุน — ยังปรับได้' : 'ต่ำกว่าคุ้มทุน',
                          color: accountRoas >= 3 ? 'text-emerald-600' : accountRoas >= 1 ? 'text-yellow-600' : 'text-red-500',
                          changeKey: 'ctr',
                          changeVal: null as null,
                          eco: true,
                        },
                      ] : []),
                      {
                        label: isEcommerceAccount ? 'Cost/Purchase' : 'Avg. CPA',
                        value: formatCurrency(s.blendedCPA),
                        helper: s.targetCPA > 0 ? `Target ฿${s.targetCPA.toLocaleString('th-TH')}` : undefined,
                        color: s.cpaVsTarget !== null && s.cpaVsTarget > 10 ? 'text-red-500' : 'text-emerald-600',
                        changeKey: 'cpa',
                        changeVal: s.changes?.blendedCPA,
                        eco: false,
                      },
                      {
                        label: 'CTR',
                        value: `${s.blendedCTR.toFixed(2)}%`,
                        helper: `${formatNumber(s.totalClicks)} clicks`,
                        color: 'text-violet-600',
                        changeKey: 'ctr',
                        changeVal: s.changes?.blendedCTR,
                        eco: false,
                      },
                    ].map((m) => (
                      <div key={m.label} className={cn('px-5 py-4 space-y-1', m.eco ? 'bg-emerald-50' : 'bg-white')}>
                        <p className={cn('text-[11px] font-semibold uppercase tracking-wide', m.eco ? 'text-emerald-600' : 'text-gray-400')}>{m.label}</p>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
                          <ChangeBadge metricKey={m.changeKey} value={m.changeVal} />
                        </div>
                        {m.helper && <p className={cn('text-[11px]', m.eco ? 'text-emerald-500' : 'text-gray-400')}>{m.helper}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Trend line chart — cost + conversions over time */}
                  {timeData && timeData.length > 1 && (
                    <div className="px-5 pt-5 pb-2">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Trend — Cost & Conversions</p>
                      <TrendChart data={[...timeData].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
                        date: d.date.slice(5),
                        cost: parseFloat(d.cost.toFixed(0)),
                        conv: parseFloat(d.conversions.toFixed(2)),
                      }))} />
                      <div className="flex items-center gap-4 mt-1 justify-center">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-blue-400 rounded" /><span className="text-[10px] text-gray-400">Cost</span></div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-emerald-400 rounded" /><span className="text-[10px] text-gray-400">Conversions</span></div>
                      </div>
                    </div>
                  )}
                  </>
                )}

                {/* ── Executive Summary — 4-section structured layout ── */}
                <div className="border-t border-gray-100">
                  <div className="px-6 pt-5 pb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Executive Summary</p>
                  </div>

                  <div className="px-6 pb-6 space-y-3">

                    {/* 1 · Performance Summary */}
                    {s && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Performance Summary</p>
                          {isEcommerceAccount && <span className="text-[9px] bg-emerald-200 text-emerald-800 rounded-full px-1.5 py-0.5 font-bold">E-commerce</span>}
                        </div>
                        {isEcommerceAccount ? (
                          <p className="text-sm leading-relaxed text-gray-800">
                            ในช่วง{' '}<span className="font-semibold text-gray-900">{DATE_RANGES.find(r => r.value === dateRange)?.label ?? dateRange}</span>{' '}
                            account ใช้งบ{' '}<span className="font-semibold text-gray-900">฿{Math.round(s.totalCost).toLocaleString('th-TH')}</span>{' '}
                            และสร้างยอดขายได้{' '}<span className="font-semibold text-emerald-700">฿{Math.round(totalConvValue).toLocaleString('th-TH')}</span>{' '}
                            ROAS{' '}<span className={cn('font-semibold', accountRoas >= 3 ? 'text-emerald-700' : accountRoas >= 1 ? 'text-yellow-600' : 'text-red-500')}>{accountRoas.toFixed(2)}x</span>{' '}
                            — ทุก ฿1 ที่ลงโฆษณาสร้างยอดขาย ฿{accountRoas.toFixed(2)}{' '}
                            {accountRoas >= 3 ? 'ถือว่าดีมาก มีโอกาส scale ต่อได้' : accountRoas >= 1 ? 'คุ้มทุนแล้ว แต่ยังมีช่องว่างปรับปรุง' : 'ยังต่ำกว่าคุ้มทุน ต้องปรับ strategy'}{' '}
                            จำนวน Conversion ทั้งหมด{' '}<span className="font-semibold text-gray-900">{formatConversions(s.totalConversions)}</span>{' '}รายการ
                          </p>
                        ) : (
                          <p className="text-sm leading-relaxed text-gray-800">
                            ในช่วง{' '}<span className="font-semibold text-gray-900">{DATE_RANGES.find(r => r.value === dateRange)?.label ?? dateRange}</span>{' '}
                            account ใช้งบทั้งหมด{' '}
                            <span className="font-semibold text-gray-900">฿{Math.round(s.totalCost).toLocaleString('th-TH')}</span>{' '}
                            และสร้างได้{' '}
                            <span className="font-semibold text-gray-900">{formatConversions(s.totalConversions)} conversions</span>{' '}
                            โดยมี CPA เฉลี่ยอยู่ที่{' '}
                            <span className="font-semibold text-gray-900">฿{Math.round(s.blendedCPA).toLocaleString('th-TH')}</span>
                            {s.targetCPA > 0 && (
                              <> ซึ่ง{s.cpaVsTarget !== null && s.cpaVsTarget < 0 ? 'ต่ำกว่า' : 'สูงกว่า'}เป้าหมาย <span className="font-semibold text-gray-900">฿{s.targetCPA.toLocaleString('th-TH')}</span>
                              {s.cpaVsTarget !== null && s.cpaVsTarget < 0 && (
                                <> ประมาณ <span className="font-semibold text-emerald-700">{Math.abs(s.cpaVsTarget)}%</span></>
                              )}</>
                            )}{' '}
                            {s.cpaVsTarget !== null && s.cpaVsTarget <= 0
                              ? 'โดยรวมถือว่าประสิทธิภาพดีมาก และยังมีโอกาส scale ต่อได้'
                              : 'ควรปรับ bid strategy เพื่อลด CPA ให้เข้าเป้า'
                            }
                          </p>
                        )}
                      </div>
                    )}

                    {/* 2 · Best Performing Campaign */}
                    {narrative.winners && (
                      <div className="rounded-xl bg-white border border-gray-200 px-5 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Best Performing Campaign</p>
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center mt-0.5">
                            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 leading-snug">{narrative.winners}</p>
                            {s && (() => {
                              const best = report?.campaigns?.filter(c => c.conversions > 0).sort((a,b) => a.cpa - b.cpa)[0]
                              return best ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    CPA ฿{Math.round(best.cpa).toLocaleString('th-TH')}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                    {Math.round(best.conversions)} Conversions
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200">
                                    เหมาะสำหรับ scale งบ
                                  </span>
                                </div>
                              ) : null
                            })()}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3 · Optimization Opportunity */}
                    {narrative.wastedBudget && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 flex items-start gap-3">
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center mt-0.5">
                          <svg className="w-4 h-4 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1.5">Optimization Opportunity</p>
                          <p className="text-sm text-amber-900 leading-relaxed">{narrative.wastedBudget}</p>
                          <p className="mt-1.5 text-[11px] text-amber-700 font-medium">ควรเพิ่มเป็น Negative Keywords เพื่อลดค่าใช้จ่ายที่ไม่จำเป็น</p>
                        </div>
                      </div>
                    )}

                    {/* 4 · Next Step */}
                    {(narrative.strategicNextStep || (narrative.actions && narrative.actions.length > 0)) && (
                      <div className="rounded-xl bg-blue-50 border border-blue-200 px-5 py-4 flex items-start gap-3">
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-200 flex items-center justify-center mt-0.5">
                          <svg className="w-4 h-4 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-1.5">Next Step</p>
                          <p className="text-sm text-blue-900 leading-relaxed">
                            {narrative.strategicNextStep || narrative.actions[0]}
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

              </div>

              {/* ── BLOCK 3: Key Insights — horizontal scroll chips ── */}
              {narrative.keyInsights && narrative.keyInsights.length > 0 && (
                <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5">
                  <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wide mb-3">Key Data Insights</p>
                  <div className="space-y-2">
                    {narrative.keyInsights.map((insight, i) => (
                      <div key={i} className="flex items-start gap-3 bg-white rounded-xl px-4 py-3 border border-sky-100 shadow-sm">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-sky-100 text-sky-600 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <span className="text-sm text-gray-700 leading-relaxed">{insight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── BLOCK 4: Performance Overview + Winners/Concerns ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Winners */}
                <div className="bg-white border border-emerald-200 rounded-2xl overflow-hidden">
                  <div className="h-0.5 bg-emerald-400" />
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">จุดเด่น · Winners</p>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{narrative.winners}</p>
                  </div>
                </div>
                {/* Concerns */}
                <div className="bg-white border border-rose-200 rounded-2xl overflow-hidden">
                  <div className="h-0.5 bg-rose-400" />
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-rose-400" />
                      <p className="text-[11px] font-bold text-rose-600 uppercase tracking-wide">จุดเสี่ยง · Concerns</p>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{narrative.concerns}</p>
                  </div>
                </div>
              </div>


              {/* ── BLOCK 5: Campaign Bar Chart ── */}
              {report && report.campaigns.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Campaign Spend vs Conversions</p>
                  </div>
                  <div className="px-5 py-4">
                    <CampaignBarChart data={[...report.campaigns].sort((a, b) => b.cost - a.cost).slice(0, 6).map((c) => ({
                      name: c.campaignName.length > 18 ? c.campaignName.slice(0, 18) + '…' : c.campaignName,
                      spend: parseFloat(c.cost.toFixed(0)),
                      conv: parseFloat(c.conversions.toFixed(2)),
                    }))} />
                    <div className="flex items-center gap-4 mt-1 justify-center">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded bg-blue-200" /><span className="text-[10px] text-gray-400">Spend</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-2.5 rounded bg-emerald-300" /><span className="text-[10px] text-gray-400">Conversions</span></div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── BLOCK 6: Device / Location / Wasted — light pills ── */}
              {(narrative.deviceAnalysis || narrative.locationInsights || narrative.wastedBudget) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {narrative.deviceAnalysis && (
                    <div className="bg-white border border-violet-200 rounded-xl p-4">
                      <p className="text-[11px] font-bold text-violet-600 uppercase tracking-wide mb-2">Device Analysis</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{narrative.deviceAnalysis}</p>
                    </div>
                  )}
                  {narrative.locationInsights && (
                    <div className="bg-white border border-amber-200 rounded-xl p-4">
                      <p className="text-[11px] font-bold text-amber-600 uppercase tracking-wide mb-2">Location Insights</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{narrative.locationInsights}</p>
                    </div>
                  )}
                  {narrative.wastedBudget && (
                    <div className="bg-white border border-rose-200 rounded-xl p-4">
                      <p className="text-[11px] font-bold text-rose-600 uppercase tracking-wide mb-2">Wasted Budget</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{narrative.wastedBudget}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── BLOCK 7: Strategic Planner ── */}
              {(narrative.strategicContext || narrative.strategicNextStep || (narrative.clientTalkingPoints && narrative.clientTalkingPoints.length > 0)) && (
                <div className="bg-white border border-indigo-200 rounded-2xl overflow-hidden">
                  <div className="h-0.5 bg-gradient-to-r from-indigo-400 to-violet-400" />
                  <div className="px-5 py-4 border-b border-indigo-50">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-indigo-500" />
                      <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">Strategic Planner · สำหรับทีมอธิบายลูกค้า</p>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    {narrative.strategicContext && (
                      <div>
                        <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-1.5">Situation Analysis — ทำไมตัวเลขถึงเป็นแบบนี้</p>
                        <p className="text-sm text-gray-700 leading-relaxed bg-indigo-50 rounded-xl px-4 py-3 border border-indigo-100">{narrative.strategicContext}</p>
                      </div>
                    )}
                    {narrative.strategicNextStep && (
                      <div>
                        <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide mb-1.5">Strategic Priority · 30 วันข้างหน้า</p>
                        <p className="text-sm text-gray-700 leading-relaxed bg-violet-50 rounded-xl px-4 py-3 border border-violet-100">{narrative.strategicNextStep}</p>
                      </div>
                    )}
                    {narrative.clientTalkingPoints && narrative.clientTalkingPoints.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-2">Client Talking Points · ประโยคที่พูดกับลูกค้าได้เลย</p>
                        <div className="space-y-2">
                          {narrative.clientTalkingPoints.map((point, i) => (
                            <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                              <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                              <span className="text-sm text-gray-700 leading-relaxed">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── BLOCK 8: Action Items ── */}
              {narrative.actions.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Action Items · สิ่งที่ต้องทำ</p>
                  <ol className="space-y-2">
                    {narrative.actions.map((action, i) => (
                      <li key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <span className="text-sm text-gray-700 leading-relaxed">{action}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* ── BLOCK 9: Summary Snapshot ── */}
              {s && (
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="h-0.5 bg-gradient-to-r from-blue-400 to-emerald-400" />
                  <div className="px-5 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">สรุปภาพรวม · Summary Snapshot</p>
                      {isEcommerceAccount && <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-semibold">E-commerce Mode</span>}
                    </div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {/* Metric row */}
                    <div className={cn('grid gap-px bg-gray-100', isEcommerceAccount ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4')}>
                      {[
                        { label: 'Total Spend',   value: formatCurrency(s.totalCost),          color: 'text-blue-600',    eco: false },
                        { label: 'Conversions',   value: formatConversions(s.totalConversions), color: 'text-emerald-600', eco: false },
                        ...(isEcommerceAccount ? [
                          { label: 'Conv. Value', value: formatCurrency(totalConvValue),        color: 'text-emerald-700', eco: true },
                          { label: 'ROAS',        value: `${accountRoas.toFixed(2)}x`,          color: accountRoas >= 3 ? 'text-emerald-600' : accountRoas >= 1 ? 'text-yellow-600' : 'text-red-500', eco: true },
                        ] : []),
                        { label: isEcommerceAccount ? 'Cost/Purchase' : 'Blended CPA', value: formatCurrency(s.blendedCPA), color: s.cpaVsTarget !== null && s.cpaVsTarget > 10 ? 'text-red-500' : 'text-emerald-600', eco: false },
                        { label: 'CTR',           value: `${s.blendedCTR.toFixed(2)}%`,        color: 'text-violet-600',  eco: false },
                      ].map((m) => (
                        <div key={m.label} className={cn('px-5 py-4 text-center space-y-1', m.eco ? 'bg-emerald-50' : 'bg-white')}>
                          <p className={cn('text-[11px] font-medium', m.eco ? 'text-emerald-500' : 'text-gray-400')}>{m.label}</p>
                          <p className={cn('text-xl font-bold', m.color)}>{m.value}</p>
                        </div>
                      ))}
                    </div>
                    {/* CPA vs target bar */}
                    {s.cpaVsTarget !== null && (
                      <div className="px-5 py-4 flex items-center gap-4">
                        <div className="shrink-0 text-sm font-medium text-gray-700">
                          CPA vs Target
                        </div>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', s.cpaVsTarget > 10 ? 'bg-red-400' : 'bg-emerald-400')}
                            style={{ width: `${Math.min(100, Math.abs(s.cpaVsTarget))}%` }}
                          />
                        </div>
                        <div className={cn('shrink-0 text-sm font-bold', s.cpaVsTarget > 10 ? 'text-red-500' : 'text-emerald-600')}>
                          {s.cpaVsTarget > 0 ? `+${s.cpaVsTarget}% เกินเป้า` : `${Math.abs(s.cpaVsTarget)}% ต่ำกว่าเป้า`}
                        </div>
                      </div>
                    )}
                    {/* Executive Summary paragraph */}
                    {narrative.executiveSummary && (
                      <div className="px-5 py-4 space-y-1.5">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Executive Summary</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{narrative.executiveSummary}</p>
                      </div>
                    )}
                    {/* Outlook */}
                    <div className="px-5 py-4 flex items-start gap-3 bg-sky-50">
                      <TrendingUp className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-bold text-sky-600 uppercase tracking-widest">Outlook</p>
                        <p className="text-sm text-sky-800 leading-relaxed">{narrative.outlook}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Email Draft ── */}
      {report && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* Header — language toggle visible always in header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white">
            <button
              onClick={() => setEmailOpen((v) => !v)}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            >
              <Mail className="w-4 h-4 text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">เขียนเมลรายงานให้ลูกค้า</p>
                <p className="text-xs text-gray-400">สร้างอีเมลสรุป performance พร้อมดาวน์โหลดตารางและ PDF แนบ</p>
              </div>
            </button>
            {/* Language toggle — always visible in header */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setEmailLang('th')}
                className={cn('px-3 py-1.5 font-medium transition-colors', emailLang === 'th' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
              >ไทย</button>
              <button
                onClick={() => setEmailLang('en')}
                className={cn('px-3 py-1.5 font-medium transition-colors border-l border-gray-200', emailLang === 'en' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
              >EN</button>
            </div>
            <button
              onClick={generateEmail}
              disabled={emailLoading || !narrative}
              title={!narrative ? 'รอ Report โหลดก่อน' : ''}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
            >
              {emailLoading
                ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> กำลังเขียน</>
                : <><Mail className="w-3 h-3" /> สร้างอีเมล</>
              }
            </button>
            <button onClick={() => setEmailOpen((v) => !v)} className="shrink-0">
              {emailOpen
                ? <ChevronUp className="w-4 h-4 text-slate-400" />
                : <ChevronDown className="w-4 h-4 text-slate-400" />
              }
            </button>
          </div>

          {emailOpen && (
            <div className="px-5 py-4 space-y-4">
              {/* Download buttons */}
              <div className="flex items-center gap-2 flex-wrap p-3 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mr-1">แนบไฟล์:</p>
                <button
                  onClick={exportAllCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700 transition-colors font-medium"
                >
                  <Download className="w-3.5 h-3.5" />ดาวน์โหลดตารางทั้งหมด (CSV)
                </button>
                <button
                  onClick={exportPDF}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 hover:border-red-300 hover:text-red-700 transition-colors font-medium"
                >
                  <Download className="w-3.5 h-3.5" />ดาวน์โหลด PDF Report
                </button>
                <button
                  onClick={exportHTML}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors font-medium"
                >
                  <Download className="w-3.5 h-3.5" />ดาวน์โหลด HTML Report
                </button>
                <p className="text-[10px] text-gray-400 ml-auto">
                  {[
                    report.campaigns.length > 0 && 'Campaigns',
                    keywords && keywords.length > 0 && 'Keywords',
                    searchTerms && searchTerms.length > 0 && 'Search Terms',
                    audiences && audiences.length > 0 && 'Audiences',
                    locations && locations.length > 0 && 'Locations',
                    devices && devices.length > 0 && 'Devices',
                    timeData && timeData.length > 0 && 'Time',
                    conversions && conversions.actions.length > 0 && 'Conversions',
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {emailDraft && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(emailDraft)
                      setEmailCopied(true)
                      setTimeout(() => setEmailCopied(false), 2000)
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {emailCopied ? <><Check className="w-3.5 h-3.5 text-green-500" /> คัดลอกแล้ว</> : <><Copy className="w-3.5 h-3.5" /> คัดลอกอีเมล</>}
                  </button>
                )}
              </div>

              {emailDraft && (
                <textarea
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 leading-relaxed bg-white focus:outline-none focus:border-blue-300 transition-colors resize-y"
                  rows={24}
                  spellCheck={false}
                />
              )}
            </div>
          )}
        </div>
      )}


    </div>
    </AppShell>
  )
}
