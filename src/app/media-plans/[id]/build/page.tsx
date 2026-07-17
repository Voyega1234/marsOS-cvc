'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AppShell from '@/components/layout/AppShell'
import AdTextEditor from '@/components/campaigns/AdTextEditor'
import { buildImagePool, withPooledImages } from '@/lib/campaigns/image-pool'
import PolicyCheckSection from '@/components/campaigns/PolicyCheckSection'
import Link from 'next/link'
import {
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  Check,
  Save,
  ThumbsUp,
  AlertTriangle,
  Download,
  X,
  Edit3,
  RefreshCw,
  Send,
  Eye,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  FileText,
  Users,
  Target,
  BarChart3,
  Zap,
  Sparkles,
  Trash2,
  Plus,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CampaignBlueprintItem, CampaignMixItem, MediaPlanJson } from '@/types'
import KeywordPlannerEmbed from '@/components/keyword-planner/KeywordPlannerEmbed'
import type { EmbedKeywordResult } from '@/components/keyword-planner/KeywordPlannerEmbed'
import AudienceSignalBuilder from '@/components/media-plan/AudienceSignalBuilder'
import type { PMaxSignal } from '@/types'
import { AccountSelect } from '@/components/ui/AccountSelect'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface KeywordResult {
  keyword: string
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH'
  suggestedCpc: number
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  selected: boolean
  isNegative?: boolean
}

interface AudienceSegment {
  name: string
  type: 'RLSA' | 'IN_MARKET' | 'CUSTOM_INTENT' | 'AFFINITY' | 'SIMILAR' | 'CUSTOMER_LIST'
  size?: number
  description: string
  selected: boolean
}

interface Forecast {
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cost: number
}

interface CampaignStructureItem {
  id: string
  type: CampaignMixItem['type']
  theme?: string
  name: string
  objective: string
  recommendedPct: number
  selected: boolean
  dailyBudget: number
  monthlyBudget: number
  keywords?: KeywordResult[]
  searchThemes?: string[]          // PMax only — max 25 search themes
  pmaxSignal?: import('@/types').PMaxSignal  // PMax audience signals
  audiences?: AudienceSegment[]
  forecast?: Forecast
  researchDone: boolean
  audienceDone: boolean            // separate flag for audience step
}

interface QACheck {
  id: string
  category: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  editable?: boolean
  fieldKey?: string
  fieldValue?: string
}

type BuildStep = 'brief' | 'structure' | 'research' | 'audience' | 'mediaplan' | 'adcopy' | 'review' | 'qa' | 'push'

interface StrategySearchCampaign {
  name: string
  theme?: string
  keywordThemes?: string[]
  adGroups?: string[]
  monthlyBudget?: number
  budgetPct?: number
}
interface StrategyPmaxCampaign {
  name: string
  audienceSignals?: string[]
  assetGroups?: string[]
  monthlyBudget?: number
  budgetPct?: number
}
interface StrategyRemarketingCampaign {
  name: string
  audience?: string
  lookbackWindow?: number
  messageAngle?: string
  monthlyBudget?: number
  budgetPct?: number
}
interface StrategyDemandGenCampaign {
  name: string
  audience?: string
  creativeAngle?: string
  funnelStage?: string
  monthlyBudget?: number
  budgetPct?: number
}
interface MediaPlanStrategyRecord {
  campaignStructure?: {
    search?: StrategySearchCampaign[]
    pmax?: StrategyPmaxCampaign[]
    remarketing?: StrategyRemarketingCampaign[]
    demandGen?: StrategyDemandGenCampaign[]
  }
  [key: string]: unknown
}

interface MediaPlanRecord {
  id: string
  title: string
  objective: string
  monthlyBudget: number
  planJson: string
  strategyJson?: string | null
  status: string
  brief?: {
    businessName?: string
    productService?: string
    targetLocation?: string
    objective?: string
    language?: string
    websiteUrl?: string
    targetAudience?: string
    usp?: string
  } | null
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  SEARCH:          'bg-blue-100 text-blue-700',
  PERFORMANCE_MAX: 'bg-orange-100 text-orange-700',
  DISPLAY:         'bg-purple-100 text-purple-700',
  VIDEO:           'bg-pink-100 text-pink-700',
  YOUTUBE:         'bg-red-100 text-red-700',
  SHOPPING:        'bg-emerald-100 text-emerald-700',
  DEMAND_GEN:      'bg-teal-100 text-teal-700',
  APP_CAMPAIGN:    'bg-indigo-100 text-indigo-700',
}

const TYPE_LABEL: Record<string, string> = {
  SEARCH: 'Search',
  PERFORMANCE_MAX: 'PMax',
  DISPLAY: 'Display',
  VIDEO: 'Video',
  YOUTUBE: 'YouTube',
  SHOPPING: 'Shopping',
  DEMAND_GEN: 'Demand Gen',
  APP_CAMPAIGN: 'App',
}

const COMPETITION_COLORS: Record<string, string> = {
  LOW:    'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH:   'bg-red-100 text-red-700',
}

const STEPS: { key: BuildStep; label: string }[] = [
  { key: 'brief',     label: 'Brief' },
  { key: 'structure', label: 'Campaign Structure' },
  { key: 'research',  label: 'Keyword Research' },
  { key: 'audience',  label: 'Audience' },
  { key: 'mediaplan', label: 'Media Plan & Budget' },
  { key: 'adcopy',    label: 'Ad Copy' },
  { key: 'qa',        label: 'QA' },
  { key: 'review',    label: 'Review & Draft' },
  { key: 'push',      label: 'Push' },
]

// ─── Step Progress Bar ──────────────────────────────────────────────────────────

function StepProgressBar({ current, onGoTo }: { current: BuildStep; onGoTo?: (s: BuildStep) => void }) {
  const currentIdx = STEPS.findIndex(s => s.key === current)

  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const isDone    = i < currentIdx
        const isCurrent = i === currentIdx
        const clickable = isDone && !!onGoTo

        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center min-w-0 flex-1">
              <div
                onClick={() => clickable && onGoTo(step.key)}
                className={cn(
                  'w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors shrink-0',
                  isDone    ? 'bg-emerald-500 border-emerald-500 text-white'
                  : isCurrent ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-400',
                  clickable && 'cursor-pointer hover:opacity-80'
                )}
              >
                {isDone
                  ? <Check className="w-4 h-4" />
                  : <span className="text-xs font-bold">{i + 1}</span>
                }
              </div>
              <p
                onClick={() => clickable && onGoTo(step.key)}
                className={cn(
                  'text-xs font-medium mt-1 text-center leading-tight',
                  isDone    ? 'text-emerald-700'
                  : isCurrent ? 'text-blue-700'
                  : 'text-gray-400',
                  clickable && 'cursor-pointer hover:underline'
                )}
              >
                {step.label}
              </p>
            </div>

            {i < STEPS.length - 1 && (
              <div className={cn(
                'h-0.5 flex-1 mx-2 mt-[-12px] transition-colors',
                isDone ? 'bg-emerald-400' : 'bg-gray-200'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', TYPE_BG[type] ?? 'bg-gray-100 text-gray-600')}>
      {TYPE_LABEL[type] ?? type}
    </span>
  )
}

// ─── Step 1: Brief ─────────────────────────────────────────────────────────────

function StepBrief({
  plan,
  onNext,
}: {
  plan: MediaPlanRecord
  onNext: () => void
}) {
  const b = plan.brief ?? {}
  const fields = [
    { label: 'ชื่อธุรกิจ', value: b.businessName },
    { label: 'สินค้า/บริการ', value: b.productService },
    { label: 'เป้าหมาย', value: plan.objective ?? b.objective },
    { label: 'Target Location', value: b.targetLocation },
    { label: 'Target Audience', value: b.targetAudience },
    { label: 'USP / จุดเด่น', value: b.usp },
    { label: 'เว็บไซต์', value: b.websiteUrl },
    { label: 'งบประมาณ/เดือน', value: `฿${plan.monthlyBudget.toLocaleString()}` },
    { label: 'ภาษา', value: b.language },
  ].filter(f => f.value)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Brief สรุปโปรเจค</h2>
        <p className="text-sm text-gray-500 mt-0.5">ตรวจสอบข้อมูลโปรเจคก่อนเริ่มสร้าง campaign</p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wide">{plan.title}</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {fields.map(f => (
            <div key={f.label}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{f.label}</p>
              <p className="text-sm font-medium text-gray-900">{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          ยืนยัน Brief — ต่อไป
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: Campaign Structure ─────────────────────────────────────────────────

const CAMPAIGN_TYPES: CampaignMixItem['type'][] = [
  'SEARCH', 'PERFORMANCE_MAX', 'DISPLAY', 'DEMAND_GEN', 'VIDEO', 'SHOPPING', 'APP_CAMPAIGN',
]

function StepStructure({
  items,
  totalBudget,
  onToggle,
  onUpdate,
  onAdd,
  onRemove,
  onNext,
}: {
  items: CampaignStructureItem[]
  totalBudget: number
  onToggle: (id: string) => void
  onUpdate: (id: string, patch: Partial<CampaignStructureItem>) => void
  onAdd: (item: CampaignStructureItem) => void
  onRemove: (id: string) => void
  onNext: () => void
}) {
  const selected = items.filter(c => c.selected)
  const totalSelected = selected.reduce((s, c) => s + c.monthlyBudget, 0)
  const over = totalBudget > 0 && totalSelected > totalBudget * 1.05
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newType, setNewType] = useState<CampaignMixItem['type']>('SEARCH')
  const [newName, setNewName] = useState('')
  const [newMonthly, setNewMonthly] = useState('')

  function addCampaign() {
    if (!newName.trim()) return
    const monthly = Number(newMonthly) || Math.round(totalBudget / (items.length + 1))
    const newItem: CampaignStructureItem = {
      id: String(Date.now()),
      type: newType,
      name: newName.trim(),
      objective: 'Lead Generation',
      recommendedPct: 0,
      selected: true,
      dailyBudget: Math.round(monthly / 30),
      monthlyBudget: monthly,
      researchDone: false,
      audienceDone: false,
    }
    onAdd(newItem)
    setNewName(''); setNewMonthly(''); setShowAdd(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Campaign Structure</h2>
          <p className="text-sm text-gray-500 mt-0.5">เลือก เพิ่ม ลบ และแก้งบแต่ละ campaign</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-gray-400 text-xs">งบที่ตั้งไว้</p>
          <p className="font-bold text-gray-900">฿{totalBudget.toLocaleString()}/เดือน</p>
          {over && <p className="text-xs text-red-500 font-semibold">เกิน! รวม ฿{totalSelected.toLocaleString()}</p>}
        </div>
      </div>

      <div className="space-y-2">
        {items.map(item => {
          const isEditing = editingId === item.id
          return (
            <div
              key={item.id}
              className={cn(
                'border rounded-xl transition-all',
                item.selected ? 'border-blue-300 bg-blue-50/20' : 'border-gray-200 bg-white opacity-60'
              )}
            >
              {/* Main row */}
              <div className="flex items-center gap-3 p-3">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => onToggle(item.id)}
                  className="w-4 h-4 text-blue-600 rounded shrink-0"
                />
                <TypeBadge type={item.type} />
                <span className="flex-1 text-sm font-medium text-gray-800 truncate min-w-0">{item.name}</span>
                <div className="text-right text-sm shrink-0">
                  <p className="font-semibold text-gray-900">฿{item.monthlyBudget.toLocaleString()}<span className="text-xs font-normal text-gray-400">/เดือน</span></p>
                  <p className="text-xs text-gray-400">฿{item.dailyBudget.toLocaleString()}/วัน</p>
                </div>
                <button
                  onClick={() => setEditingId(isEditing ? null : item.id)}
                  className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
                  title="แก้ไข"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onRemove(item.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                  title="ลบ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Inline edit */}
              {isEditing && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 mb-1 block">Campaign Name</label>
                      <input
                        defaultValue={item.name}
                        onBlur={e => onUpdate(item.id, { name: e.target.value })}
                        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 mb-1 block">Campaign Type</label>
                      <select
                        value={item.type}
                        onChange={e => onUpdate(item.id, { type: e.target.value as CampaignMixItem['type'] })}
                        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none"
                      >
                        {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 mb-1 block">Monthly Budget (฿)</label>
                      <input
                        type="number"
                        defaultValue={item.monthlyBudget}
                        onBlur={e => {
                          const monthly = Number(e.target.value) || 0
                          onUpdate(item.id, { monthlyBudget: monthly, dailyBudget: Math.round(monthly / 30) })
                        }}
                        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 mb-1 block">Objective</label>
                      <input
                        defaultValue={item.objective}
                        onBlur={e => onUpdate(item.id, { objective: e.target.value })}
                        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </div>
                  </div>
                  <button onClick={() => setEditingId(null)} className="text-xs text-blue-600 font-semibold">✓ เสร็จแล้ว</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add campaign panel */}
      {showAdd ? (
        <div className="border-2 border-dashed border-blue-200 rounded-xl p-4 bg-blue-50/20 space-y-3">
          <p className="text-sm font-semibold text-gray-700">เพิ่ม Campaign ใหม่</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block">Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value as CampaignMixItem['type'])}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none">
                {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-gray-500 mb-1 block">Campaign Name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="เช่น CVC - SEM - Brand - ConvertCake - Lead"
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block">Monthly Budget (฿)</label>
              <input type="number" value={newMonthly} onChange={e => setNewMonthly(e.target.value)}
                placeholder="เช่น 15000"
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addCampaign} disabled={!newName.trim()}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors">
              + เพิ่ม
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">ยกเลิก</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/20 transition-all justify-center">
          <Plus className="w-4 h-4" /> เพิ่ม Campaign
        </button>
      )}

      {over && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          งบรวม ฿{totalSelected.toLocaleString()} เกิน ฿{totalBudget.toLocaleString()} — ปรับลด budget แต่ละ campaign
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={onNext}
          disabled={selected.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ยืนยัน Structure — เริ่ม Research
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Keyword & Audience Research ───────────────────────────────────────

function StepResearch({
  items,
  brief,
  totalBudget,
  onResearchLoad,
  onKeywordToggle,
  onNext,
  autoStarted,
}: {
  items: CampaignStructureItem[]
  brief: MediaPlanRecord['brief']
  totalBudget: number
  onResearchLoad: (id: string, data: Partial<CampaignStructureItem>) => void
  onKeywordToggle: (campaignId: string, kwIdx: number) => void
  onNext: () => void
  autoStarted: boolean
}) {
  void totalBudget; void onKeywordToggle; void autoStarted

  // SEARCH = required keyword research
  // PERFORMANCE_MAX = optional, uses search themes (max 25)
  // Everything else (DISPLAY, VIDEO, etc.) = skip, auto-done
  const searchCampaigns = items.filter(c => c.selected && c.type === 'SEARCH')
  const pmaxCampaigns   = items.filter(c => c.selected && c.type === 'PERFORMANCE_MAX')
  const embedCampaigns  = [...searchCampaigns, ...pmaxCampaigns]

  // SEARCH done = has keywords. PMax done = has searchThemes OR explicitly skipped
  const searchDone = searchCampaigns.every(c => c.researchDone)
  const pmaxDone   = pmaxCampaigns.every(c => c.researchDone)
  const allDone    = searchDone && pmaxDone

  function handleApply(campaignId: string, keywords: EmbedKeywordResult[], searchThemes?: string[]) {
    const campaign = items.find(c => c.id === campaignId)
    if (!campaign) return

    if (campaign.type === 'PERFORMANCE_MAX') {
      // PMax: store as search themes (max 25), no match types
      const themes = (searchThemes ?? keywords.map(k => k.keyword)).slice(0, 25)
      onResearchLoad(campaignId, {
        searchThemes: themes,
        forecast: {
          impressions: themes.length * 1000,
          clicks:      themes.length * 35,
          ctr:         3.5,
          cpc:         0,
          cost:        0,
        },
        researchDone: true,
      })
    } else {
      // SEARCH: store as keywords with match types
      const kws: KeywordResult[] = keywords.map(k => ({
        keyword:            k.keyword,
        avgMonthlySearches: k.avgMonthlySearches,
        competition:        k.competition,
        suggestedCpc:       k.suggestedCpc,
        matchType:          k.matchType,
        selected:           true,
      }))
      const avgCpc   = kws.length ? kws.reduce((s, k) => s + k.suggestedCpc, 0) / kws.length : 0
      const totalVol = kws.reduce((s, k) => s + k.avgMonthlySearches, 0)
      onResearchLoad(campaignId, {
        keywords: kws,
        forecast: {
          impressions: totalVol,
          clicks:      Math.round(totalVol * 0.035),
          ctr:         3.5,
          cpc:         avgCpc,
          cost:        Math.round(totalVol * 0.035 * avgCpc),
        },
        researchDone: true,
      })
    }
  }

  function handleSkipPmax(campaignId: string) {
    onResearchLoad(campaignId, { searchThemes: [], researchDone: true })
  }

  // Auto-done for campaign types that don't use keywords (Display, Video, etc.)
  useEffect(() => {
    items
      .filter(c => c.selected && c.type !== 'SEARCH' && c.type !== 'PERFORMANCE_MAX' && !c.researchDone)
      .forEach(c => {
        const monthlyBudget = c.monthlyBudget > 0 ? c.monthlyBudget : 3000
        onResearchLoad(c.id, {
          forecast: {
            impressions: Math.round(monthlyBudget * 40),
            clicks:      Math.round(monthlyBudget * 40 * 0.005),
            ctr:         0.5, cpc: 2.5, cost: monthlyBudget,
          },
          researchDone: true,
        })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-load keywords/search-themes already saved on the plan so the embed shows them
  // as done and the user never has to re-research.
  const initialApplied: Record<string, EmbedKeywordResult[]> = {}
  embedCampaigns.forEach(c => {
    if (c.type === 'PERFORMANCE_MAX') {
      const themes = c.searchThemes ?? []
      if (themes.length > 0) {
        initialApplied[c.id] = themes.map(t => ({
          keyword: t, matchType: 'BROAD', avgMonthlySearches: 0, competition: 'MEDIUM', suggestedCpc: 0, selected: true,
        }))
      }
    } else {
      const kws = (c.keywords ?? []).filter(k => k.selected)
      if (kws.length > 0) {
        initialApplied[c.id] = kws.map(k => ({
          keyword: k.keyword, matchType: k.matchType, avgMonthlySearches: k.avgMonthlySearches,
          competition: k.competition, suggestedCpc: k.suggestedCpc, selected: true,
        }))
      }
    }
  })

  return (
    <KeywordPlannerEmbed
      campaigns={embedCampaigns.map(c => ({ id: c.id, name: c.name, type: c.type }))}
      brief={brief ?? null}
      initialApplied={initialApplied}
      onApply={handleApply}
      onSkipPmax={handleSkipPmax}
      onNext={onNext}
      allDone={allDone}
    />
  )
}

// ─── Step 4: Audience Research (manual trigger) ────────────────────────────────

const AUDIENCE_TYPE_BADGE: Record<string, string> = {
  RLSA:          'bg-blue-100 text-blue-700',
  IN_MARKET:     'bg-green-100 text-green-700',
  CUSTOM_INTENT: 'bg-purple-100 text-purple-700',
  SIMILAR:       'bg-gray-100 text-gray-600',
  CUSTOMER_LIST: 'bg-orange-100 text-orange-700',
}

// API returns AudienceSegmentItem.type values; map to local UI AudienceSegment['type']
function mapAudienceType(apiType: string): AudienceSegment['type'] {
  switch (apiType) {
    case 'REMARKETING':   return 'RLSA'
    case 'IN_MARKET':     return 'IN_MARKET'
    case 'CUSTOM_INTENT': return 'CUSTOM_INTENT'
    case 'SIMILAR':       return 'SIMILAR'
    case 'CUSTOMER_LIST': return 'CUSTOMER_LIST'
    default:              return 'IN_MARKET'
  }
}

function makePmaxSignalShell(campaignName: string): PMaxSignal {
  return {
    campaignName,
    audienceSignals: { customIntent: [], searchThemes: [], customerList: [], remarketing: [], inMarket: [], demographics: {} },
    assetSuggestions: { headlines: [], descriptions: [], imageThemes: [] },
  }
}

function StepAudience({
  items,
  plan,
  onResearchLoad,
  onAudienceToggle,
  onNext,
}: {
  items: CampaignStructureItem[]
  plan: MediaPlanRecord
  onResearchLoad: (id: string, data: Partial<CampaignStructureItem>) => void
  onAudienceToggle: (campaignId: string, audIdx: number) => void
  onNext: () => void
}) {
  void onAudienceToggle
  const selected = items.filter(c => c.selected)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [errors,  setErrors]  = useState<Record<string, string>>({})

  // ── PMax: generate Audience Signals via audience-signal API ──────────────────
  async function generatePmaxSignal(campaign: CampaignStructureItem) {
    setLoading(prev => ({ ...prev, [campaign.id]: true }))
    setErrors(prev => ({ ...prev, [campaign.id]: '' }))
    try {
      const b = plan.brief ?? {}
      const res = await fetch('/api/audience-signal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName:   campaign.name,
          businessName:   b.businessName ?? '',
          productService: b.productService ?? '',
          targetAudience: b.targetAudience ?? '',
          objective:      b.objective ?? '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Signal generation failed')
      const signal: PMaxSignal = {
        campaignName:     campaign.name,
        audienceSignals:  data.signal as PMaxSignal['audienceSignals'],
        assetSuggestions: { headlines: [], descriptions: [], imageThemes: [] },
      }
      onResearchLoad(campaign.id, { pmaxSignal: signal, audienceDone: true })
    } catch (err) {
      setErrors(prev => ({ ...prev, [campaign.id]: err instanceof Error ? err.message : 'Signal generation failed' }))
    } finally {
      setLoading(prev => ({ ...prev, [campaign.id]: false }))
    }
  }

  // ── Display/DemandGen: generate audience segments (RLSA, In-Market) ──────────
  async function generateDisplayAudience(campaign: CampaignStructureItem) {
    setLoading(prev => ({ ...prev, [campaign.id]: true }))
    setErrors(prev => ({ ...prev, [campaign.id]: '' }))
    try {
      const res = await fetch('/api/keyword-audience/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Audience generation failed')
      const segments: Array<{ campaignName: string; name: string; type: string; description?: string }> =
        data.keywordAudiencePlan?.audienceSegments ?? []
      const cName = campaign.name.trim().toLowerCase()
      const matched = segments.filter(s => (s.campaignName ?? '').trim().toLowerCase() === cName)
      const source = matched.length > 0 ? matched : segments
      const audiences: AudienceSegment[] = source.map(s => ({
        name: s.name, type: mapAudienceType(s.type), description: s.description ?? '', selected: true,
      }))
      onResearchLoad(campaign.id, { audiences, audienceDone: true })
    } catch (err) {
      setErrors(prev => ({ ...prev, [campaign.id]: err instanceof Error ? err.message : 'Audience generation failed' }))
    } finally {
      setLoading(prev => ({ ...prev, [campaign.id]: false }))
    }
  }

  // ── Determine if we can proceed ───────────────────────────────────────────────
  const pmaxCampaigns    = selected.filter(c => c.type === 'PERFORMANCE_MAX')
  const displayCampaigns = selected.filter(c => c.type === 'DISPLAY' || c.type === 'DEMAND_GEN')
  // SEARCH / VIDEO / etc. are skippable — auto-mark done
  const skipTypes = ['SEARCH', 'VIDEO', 'YOUTUBE', 'SHOPPING', 'APP_CAMPAIGN']
  const pmaxDone    = pmaxCampaigns.every(c => c.audienceDone)
  const displayDone = displayCampaigns.length === 0 || displayCampaigns.some(c => c.audienceDone)
  const canNext     = pmaxDone && displayDone

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Audience Research</h2>
        <p className="text-sm text-gray-500 mt-0.5">ตั้งค่า audience ตาม campaign type — PMax ใช้ Audience Signals, Display ใช้ RLSA/In-Market</p>
      </div>

      <div className="space-y-4">
        {selected.map(campaign => {
          const isLoading = loading[campaign.id]
          const err       = errors[campaign.id]
          const isPmax    = campaign.type === 'PERFORMANCE_MAX'
          const isDisplay = campaign.type === 'DISPLAY' || campaign.type === 'DEMAND_GEN'
          const isSkip    = skipTypes.includes(campaign.type)

          // ── SKIP types (SEARCH, VIDEO, etc.) ─────────────────────────────
          if (isSkip) {
            return (
              <div key={campaign.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                  <TypeBadge type={campaign.type} />
                  <span className="text-sm font-semibold text-gray-700 truncate flex-1">{campaign.name}</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full font-medium">ข้ามได้ — ไม่ต้องตั้งค่า audience</span>
                </div>
                <div className="px-4 py-3 text-xs text-gray-400">
                  {campaign.type === 'SEARCH'
                    ? 'Search campaign ใช้ keyword targeting แทน audience — ไม่จำเป็นต้องตั้งค่าที่นี่'
                    : campaign.type === 'SHOPPING'
                    ? 'Shopping campaign ใช้ product feed targeting — audience เป็น observation เท่านั้น'
                    : 'Campaign type นี้ไม่ต้องตั้งค่า audience ในขั้นตอนนี้'}
                </div>
              </div>
            )
          }

          // ── PERFORMANCE_MAX → Audience Signals ───────────────────────────
          if (isPmax) {
            const signal = campaign.pmaxSignal ?? makePmaxSignalShell(campaign.name)
            const hasSig = campaign.audienceDone
            return (
              <div key={campaign.id} className="border border-orange-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-orange-50 border-b border-orange-100">
                  <TypeBadge type={campaign.type} />
                  <span className="text-sm font-semibold text-orange-900 truncate flex-1">{campaign.name}</span>
                  <span className="text-[10px] text-orange-600 font-bold flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Audience Signals — บังคับ
                  </span>
                  <button
                    onClick={() => generatePmaxSignal(campaign)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition-colors shrink-0"
                  >
                    {isLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />กำลังสร้าง...</>
                      : <><Sparkles className="w-3.5 h-3.5" />{hasSig ? 'Re-generate' : 'Generate Signals'}</>}
                  </button>
                </div>
                <div className="p-4">
                  {err && (
                    <div className="mb-3 flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0" />{err}
                    </div>
                  )}
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400">
                      <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
                      <p className="text-sm">กำลังสร้าง Audience Signals สำหรับ {campaign.name}...</p>
                    </div>
                  ) : hasSig ? (
                    <AudienceSignalBuilder
                      campaignName={campaign.name}
                      signal={signal}
                      onChange={updated => onResearchLoad(campaign.id, { pmaxSignal: updated })}
                      briefContext={{
                        businessName:   plan.brief?.businessName,
                        productService: plan.brief?.productService,
                        targetAudience: plan.brief?.targetAudience,
                        objective:      plan.brief?.objective,
                      }}
                    />
                  ) : (
                    <div className="text-center py-8 text-gray-400 text-sm flex flex-col items-center gap-2">
                      <Zap className="w-6 h-6 text-orange-200" />
                      <p>กด Generate Signals เพื่อสร้าง Audience Signals สำหรับ PMax</p>
                      <p className="text-xs text-gray-300">PMax ใช้ Audience Signals เพื่อบอก Google AI ว่าควรหาลูกค้ากลุ่มไหน</p>
                    </div>
                  )}
                </div>
              </div>
            )
          }

          // ── DISPLAY / DEMAND_GEN → RLSA + In-Market segments ─────────────
          if (isDisplay) {
            const auds   = campaign.audiences ?? []
            const hasAuds = campaign.audienceDone
            return (
              <div key={campaign.id} className="border border-purple-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 border-b border-purple-100">
                  <TypeBadge type={campaign.type} />
                  <span className="text-sm font-semibold text-purple-900 truncate flex-1">{campaign.name}</span>
                  <span className="text-[10px] text-purple-600 font-medium">RLSA / In-Market / Custom Intent</span>
                  <button
                    onClick={() => generateDisplayAudience(campaign)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-60 transition-colors shrink-0"
                  >
                    {isLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />กำลังสร้าง...</>
                      : <><Sparkles className="w-3.5 h-3.5" />{hasAuds ? 'Re-generate' : 'Generate Audience'}</>}
                  </button>
                </div>
                <div className="p-4">
                  {err && (
                    <div className="mb-3 flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0" />{err}
                    </div>
                  )}
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-gray-400">
                      <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                      <p className="text-sm">กำลังสร้าง audience สำหรับ {campaign.name}...</p>
                    </div>
                  ) : hasAuds ? (
                    <div className="space-y-2">
                      {auds.map((aud, ai) => (
                        <div key={ai} className={cn(
                          'flex items-start gap-3 p-3 rounded-xl border',
                          aud.selected ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'
                        )}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-semibold text-gray-900">{aud.name}</span>
                              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', AUDIENCE_TYPE_BADGE[aud.type] ?? 'bg-gray-100 text-gray-600')}>
                                {aud.type}
                              </span>
                            </div>
                            {aud.description && <p className="text-[11px] text-gray-500">{aud.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400 text-sm flex flex-col items-center gap-2">
                      <Users className="w-6 h-6 text-gray-300" />
                      กด Generate Audience เพื่อสร้าง RLSA และ In-Market audiences
                    </div>
                  )}
                </div>
              </div>
            )
          }

          return null
        })}
      </div>

      <div className="flex justify-between items-center pt-2">
        <p className="text-sm text-gray-400">
          {pmaxCampaigns.length > 0 && !pmaxDone && (
            <span className="text-orange-500 font-medium">⚡ PMax ต้องมี Audience Signals ก่อนดำเนินการต่อ</span>
          )}
        </p>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ต่อไป: Media Plan & Budget
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Funnel / KPI helpers ──────────────────────────────────────────────────────

function getCampaignFunnel(type: string, name: string): string {
  switch (type) {
    case 'SEARCH':          return 'Conversion'
    case 'PERFORMANCE_MAX': return 'Conversion'
    case 'SHOPPING':        return 'Conversion'
    case 'DISPLAY':         return /remarketing/i.test(name) ? 'Retention' : 'Consideration'
    case 'VIDEO':
    case 'YOUTUBE':         return 'Awareness'
    case 'DEMAND_GEN':      return 'Consideration'
    default:                return 'Conversion'
  }
}

function getCampaignKPI(type: string): string {
  switch (type) {
    case 'SEARCH':          return 'CVR, CPA'
    case 'PERFORMANCE_MAX': return 'ROAS, Conv. Value'
    case 'SHOPPING':        return 'ROAS, Revenue'
    case 'DISPLAY':         return 'CTR, Assisted Conv.'
    case 'VIDEO':
    case 'YOUTUBE':         return 'View Rate, CPV'
    case 'DEMAND_GEN':      return 'Engagement, Micro-Conv.'
    default:                return 'CVR, CPA'
  }
}

// ─── Step 5: Media Plan & Budget ───────────────────────────────────────────────

function StepMediaPlan({
  items,
  totalBudget,
  plan,
  onDailyChange,
  onNext,
}: {
  items: CampaignStructureItem[]
  totalBudget: number
  plan: MediaPlanRecord
  onDailyChange: (id: string, daily: number) => void
  onNext: () => void
}) {
  const selected = items.filter(c => c.selected)
  const totalDaily    = selected.reduce((s, c) => s + c.dailyBudget, 0)
  const totalMonthly  = totalDaily * 30
  const totalClicks   = selected.reduce((s, c) => s + (c.forecast?.clicks ?? 0), 0)
  const totalImpr     = selected.reduce((s, c) => s + (c.forecast?.impressions ?? 0), 0)
  const over = totalBudget > 0 && totalMonthly > totalBudget * 1.05
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)

  function handleExportHTML() {
    const b = plan.brief ?? {}
    const html = buildExportHTML({ plan, items: selected })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `MediaPlan-${b.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportModal(false)
  }

  function handleExportCSV() {
    const escapeCSV = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v
    const header = ['Campaign Name', 'Type', 'Funnel', 'Daily Budget', 'Monthly Budget', 'KPI', 'Est. Clicks', 'Impressions']
    const rows = selected.map(c => [
      escapeCSV(c.name),
      escapeCSV(c.type),
      escapeCSV(getCampaignFunnel(c.type, c.name)),
      String(c.dailyBudget),
      String(c.monthlyBudget),
      escapeCSV(getCampaignKPI(c.type)),
      String(c.forecast?.clicks ?? 0),
      String(c.forecast?.impressions ?? 0),
    ])
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `MediaPlan-${plan.brief?.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportModal(false)
  }

  async function handleCopySummary() {
    const b = plan.brief ?? {}
    const lines: string[] = [
      `Media Plan — ${b.businessName ?? plan.title}`,
      `Budget: ฿${totalMonthly.toLocaleString()}/เดือน`,
      '',
      ...selected.map(c =>
        `• ${c.name} [${c.type}] — Funnel: ${getCampaignFunnel(c.type, c.name)}\n  ฿${c.monthlyBudget.toLocaleString()}/เดือน (฿${c.dailyBudget.toLocaleString()}/วัน) | KPI: ${getCampaignKPI(c.type)}`
      ),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 2000)
    } catch { /* fallback silent */ }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Media Plan & Budget Allocation</h2>
          <p className="text-sm text-gray-500 mt-0.5">ปรับงบ daily budget ของแต่ละ campaign</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySummary}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copiedSummary ? <Check className="w-4 h-4 text-emerald-500" /> : <MessageSquare className="w-4 h-4" />}
            {copiedSummary ? 'Copied!' : 'Copy Summary'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExportModal(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Plan
              <ChevronDown className="w-3 h-3" />
            </button>
            {showExportModal && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
                <button
                  onClick={handleExportHTML}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                >
                  <FileText className="w-4 h-4 text-blue-500" />
                  Export HTML
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                >
                  <Download className="w-4 h-4 text-emerald-500" />
                  Export CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Campaigns', value: String(selected.length), unit: '' },
          { label: 'Total Daily', value: `฿${totalDaily.toLocaleString()}`, unit: '/วัน', warn: over },
          { label: 'Total Monthly', value: `฿${totalMonthly.toLocaleString()}`, unit: '/เดือน', warn: over },
          { label: 'Est. Clicks', value: totalClicks.toLocaleString(), unit: '/เดือน' },
        ].map(kpi => (
          <div key={kpi.label} className={cn('border rounded-xl p-3', kpi.warn ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{kpi.label}</p>
            <p className={cn('text-lg font-bold', kpi.warn ? 'text-red-700' : 'text-gray-900')}>
              {kpi.value}<span className="text-xs font-normal text-gray-400 ml-0.5">{kpi.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {over && (
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          งบรวมเกิน ฿{totalBudget.toLocaleString()} — กรุณาปรับลด daily budget
        </div>
      )}

      {/* Campaign budget table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaign</th>
              <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
              <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Funnel</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Budget/Month</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily</th>
              <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">KPI</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</th>
            </tr>
          </thead>
          <tbody>
            {selected.map(c => {
              const isExpanded = expandedId === c.id
              return (
                <>
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <p className="text-sm font-medium text-gray-800 truncate max-w-[180px]">{c.name}</p>
                      <p className="text-[11px] text-gray-400">{c.objective}</p>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <TypeBadge type={c.type} />
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs font-medium text-gray-700">{getCampaignFunnel(c.type, c.name)}</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <DailyBudgetInput value={c.monthlyBudget} onChange={v => onDailyChange(c.id, Math.round(v / 30))} suffix="/เดือน" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <DailyBudgetInput value={c.dailyBudget} onChange={v => onDailyChange(c.id, v)} suffix="/วัน" />
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs text-gray-500">{getCampaignKPI(c.type)}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mx-auto"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${c.id}-detail`} className="bg-blue-50/30 border-b border-gray-100">
                      <td colSpan={7} className="px-4 py-4">
                        <CampaignDetailExpand campaign={c} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 border-gray-200">
              <td className="py-3 px-4 text-xs font-bold text-gray-700" colSpan={2}>รวม ({selected.length})</td>
              <td />
              <td className="py-3 px-3 text-right">
                <span className={cn('text-sm font-bold', over ? 'text-red-600' : 'text-gray-900')}>
                  ฿{totalMonthly.toLocaleString()}
                </span>
              </td>
              <td className="py-3 px-3 text-right">
                <span className={cn('text-sm font-bold', over ? 'text-red-600' : 'text-gray-900')}>
                  ฿{totalDaily.toLocaleString()}/วัน
                </span>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {totalImpr > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">
            <BarChart3 className="inline w-3.5 h-3.5 mr-1" />
            Monthly Forecast (all campaigns)
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-blue-500">Impressions</p>
              <p className="text-base font-bold text-blue-900">
                {totalImpr >= 1000000 ? `${(totalImpr / 1000000).toFixed(1)}M`
                  : totalImpr >= 1000 ? `${(totalImpr / 1000).toFixed(0)}K`
                  : totalImpr.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-blue-500">Clicks</p>
              <p className="text-base font-bold text-blue-900">{totalClicks.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-blue-500">Total Budget</p>
              <p className="text-base font-bold text-blue-900">฿{totalMonthly.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          ต่อไป: Ad Copy
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// Campaign expanded detail inside Media Plan table
function CampaignDetailExpand({ campaign: c }: { campaign: CampaignStructureItem }) {
  return (
    <div className="grid grid-cols-2 gap-6 text-xs">
      {/* Keywords */}
      {c.keywords && c.keywords.length > 0 && (
        <div>
          <p className="font-semibold text-gray-600 uppercase tracking-wide mb-2">
            <Target className="inline w-3 h-3 mr-1" />
            Keywords ({c.keywords.filter(k => k.selected).length} selected)
          </p>
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {c.keywords.filter(k => k.selected).map((kw, i) => (
              <div key={i} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2 py-1.5">
                <span className="flex-1 text-gray-800">{kw.keyword}</span>
                <span className="text-gray-400 shrink-0">{kw.matchType}</span>
                <span className={cn('px-1 py-0.5 rounded text-[9px] font-bold shrink-0', COMPETITION_COLORS[kw.competition])}>
                  {kw.competition}
                </span>
                <span className="text-gray-500 shrink-0">฿{kw.suggestedCpc.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audiences */}
      {c.audiences && c.audiences.length > 0 && (
        <div>
          <p className="font-semibold text-gray-600 uppercase tracking-wide mb-2">
            <Users className="inline w-3 h-3 mr-1" />
            Audiences ({c.audiences.filter(a => a.selected).length} selected)
          </p>
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {c.audiences.filter(a => a.selected).map((aud, i) => (
              <div key={i} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2 py-1.5">
                <span className="flex-1 text-gray-800">{aud.name}</span>
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0',
                  aud.type === 'RLSA' ? 'bg-blue-100 text-blue-700' :
                  aud.type === 'IN_MARKET' ? 'bg-green-100 text-green-700' :
                  'bg-purple-100 text-purple-700'
                )}>
                  {aud.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast */}
      {c.forecast && (
        <div className="col-span-2">
          <p className="font-semibold text-gray-600 uppercase tracking-wide mb-2">Forecast</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Impressions', value: c.forecast.impressions.toLocaleString() },
              { label: 'Clicks', value: c.forecast.clicks.toLocaleString() },
              { label: 'CTR', value: `${c.forecast.ctr}%` },
              { label: 'Avg CPC', value: `฿${c.forecast.cpc.toFixed(2)}` },
            ].map(f => (
              <div key={f.label} className="bg-white border border-gray-100 rounded-lg p-2 text-center">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">{f.label}</p>
                <p className="font-bold text-gray-800 mt-0.5">{f.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DailyBudgetInput({ value, onChange, suffix = '/วัน' }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft)
          if (!isNaN(n) && n >= 0) onChange(n)
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { const n = Number(draft); if (!isNaN(n) && n >= 0) onChange(n); setEditing(false) }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-28 px-2 py-1 text-sm font-semibold text-right border border-blue-400 rounded-lg ring-2 ring-blue-200 outline-none bg-white"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(String(value)); setEditing(true) }}
      title="คลิกเพื่อแก้ไข"
      className="px-2 py-1 text-sm font-semibold text-gray-900 hover:bg-blue-50 rounded-lg cursor-pointer text-right w-full transition-colors group"
    >
      ฿{value.toLocaleString()}<span className="text-gray-400 font-normal">{suffix}</span>
      <span className="ml-1 text-[10px] text-gray-300 group-hover:text-blue-400">✎</span>
    </button>
  )
}

// ─── Ad Strength helpers ───────────────────────────────────────────────────────

type AdStrengthLevel = 'Poor' | 'Fair' | 'Good' | 'Excellent'

function calcStrength(count: number): AdStrengthLevel {
  if (count >= 15) return 'Excellent'
  if (count >= 12) return 'Good'
  if (count >= 8)  return 'Fair'
  return 'Poor'
}

const STRENGTH_COLOR: Record<AdStrengthLevel, string> = {
  Poor:      'bg-red-500',
  Fair:      'bg-amber-400',
  Good:      'bg-blue-500',
  Excellent: 'bg-emerald-500',
}

const STRENGTH_TEXT: Record<AdStrengthLevel, string> = {
  Poor:      'text-red-600',
  Fair:      'text-amber-600',
  Good:      'text-blue-600',
  Excellent: 'text-emerald-600',
}

const EMOTION_COLORS: Record<string, string> = {
  CTA:           'bg-blue-100 text-blue-700',
  Sale:          'bg-red-100 text-red-700',
  Inspirational: 'bg-purple-100 text-purple-700',
  Informational: 'bg-gray-100 text-gray-700',
}

function detectEmotion(text: string): string {
  const t = text.toLowerCase()
  if (/ส่วนลด|ลด|ฟรี|โปรโมชั่น|sale|discount|off|free/i.test(t)) return 'Sale'
  if (/ติดต่อ|โทร|สมัคร|ลงทะเบียน|contact|call|sign up|register|get started/i.test(t)) return 'CTA'
  if (/แรงบันดาล|เปลี่ยน|ดีขึ้น|inspire|transform|better|achieve|dream/i.test(t)) return 'Inspirational'
  return 'Informational'
}

// ─── Step 6: Ad Copy ───────────────────────────────────────────────────────────

function StepAdCopy({
  items,
  blueprints,
  plan,
  onBlueprintChange,
  onNext,
}: {
  items: CampaignStructureItem[]
  blueprints: Record<string, CampaignBlueprintItem>
  plan: MediaPlanRecord
  onBlueprintChange: (id: string, updated: CampaignBlueprintItem) => void
  onNext: () => void
}) {
  const selected = items.filter(c => c.selected)
  const [activeId, setActiveId] = useState<string>(selected[0]?.id ?? '')
  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [genError, setGenError] = useState<Record<string, string>>({})
  const active = selected.find(c => c.id === activeId)
  const autoTriggered = useRef<Record<string, boolean>>({})

  async function generateAdCopy(c: CampaignStructureItem) {
    setGenerating(p => ({ ...p, [c.id]: true }))
    setGenError(p => ({ ...p, [c.id]: '' }))
    try {
      const b = plan.brief ?? {}
      const res = await fetch('/api/adcopy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName:    c.name,
          campaignType:    c.type,
          objective:       c.objective,
          dailyBudget:     c.dailyBudget,
          businessName:    b.businessName ?? '',
          productService:  b.productService ?? '',
          targetAudience:  b.targetAudience ?? '',
          websiteUrl:      b.websiteUrl ?? '',
          language:        b.language ?? 'th',
          promotion:       (b as Record<string, unknown>).promotion as string ?? '',
          brandTone:       (b as Record<string, unknown>).brandTone as string ?? '',
          keywords:        (c.keywords ?? []).filter(k => k.selected).map(k => k.keyword),
          audiences:       (c.audiences ?? []).filter(a => a.selected).map(a => ({ name: a.name, type: a.type })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const bp: CampaignBlueprintItem = data.blueprint ?? data
      onBlueprintChange(c.id, bp)
    } catch (err) {
      setGenError(p => ({ ...p, [c.id]: err instanceof Error ? err.message : 'Generate failed' }))
    } finally {
      setGenerating(p => ({ ...p, [c.id]: false }))
    }
  }

  const hasContent = (id: string) => {
    const bp = blueprints[id]
    if (!bp) return false
    const hasAds   = bp.adGroups?.some(ag => ag.ads?.some(ad => ad.rsa?.headlines?.some(Boolean) || ad.display?.headlines?.some(Boolean))) ?? false
    const hasAssets = bp.assetGroups?.some(ag => ag.headlines?.some(Boolean)) ?? false
    return hasAds || hasAssets
  }

  useEffect(() => {
    selected.forEach(c => {
      if (!hasContent(c.id) && !generating[c.id] && !autoTriggered.current[c.id]) {
        autoTriggered.current[c.id] = true
        generateAdCopy(c)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Headline editor for RSA campaigns ──────────────────────────────────────
  function RsaHeadlineEditor({ campaign, bp }: { campaign: CampaignStructureItem; bp: CampaignBlueprintItem }) {
    const ag   = bp.adGroups?.[0]
    const ad   = ag?.ads?.[0]
    const rawHeadlines: string[] = ad?.rsa?.headlines ?? [ad?.headline1 ?? '', ad?.headline2 ?? '', ad?.headline3 ?? '']
    const rawDescs: string[]     = ad?.rsa?.descriptions ?? [ad?.description1 ?? '', ad?.description2 ?? '']

    const [headlines, setHeadlines]     = useState<string[]>(rawHeadlines.length >= 3 ? rawHeadlines : [...rawHeadlines, ...Array(Math.max(0, 3 - rawHeadlines.length)).fill('')])
    const [descriptions, setDescriptions] = useState<string[]>(rawDescs)

    function syncBp(newHeadlines: string[], newDescs: string[]) {
      if (!ag || !ad) return
      const updatedBp: CampaignBlueprintItem = {
        ...bp,
        adGroups: bp.adGroups!.map((g, gi) =>
          gi === 0 ? {
            ...g,
            ads: g.ads.map((a, ai) =>
              ai === 0 ? {
                ...a,
                rsa: {
                  adType: 'RSA' as const,
                  finalUrl: a.rsa?.finalUrl ?? a.finalUrl ?? '',
                  displayPath1: a.rsa?.displayPath1,
                  displayPath2: a.rsa?.displayPath2,
                  pinnedHeadlines: a.rsa?.pinnedHeadlines,
                  headlines: newHeadlines,
                  descriptions: newDescs,
                },
              } : a
            ),
          } : g
        ),
      }
      onBlueprintChange(campaign.id, updatedBp)
    }

    function setHeadline(i: number, v: string) {
      const next = headlines.map((h, hi) => hi === i ? v : h)
      setHeadlines(next)
      syncBp(next, descriptions)
    }

    function removeHeadline(i: number) {
      const next = headlines.filter((_, hi) => hi !== i)
      setHeadlines(next)
      syncBp(next, descriptions)
    }

    function addHeadline() {
      if (headlines.length >= 15) return
      const next = [...headlines, '']
      setHeadlines(next)
      syncBp(next, descriptions)
    }

    const filledHeadlines  = headlines.filter(Boolean)
    const strength         = calcStrength(filledHeadlines.length)
    const strengthLevels   = ['Poor', 'Fair', 'Good', 'Excellent'] as AdStrengthLevel[]
    const strengthIdx      = strengthLevels.indexOf(strength)
    const emotionCounts    = filledHeadlines.reduce<Record<string, number>>((acc, h) => {
      const e = detectEmotion(h)
      acc[e] = (acc[e] ?? 0) + 1
      return acc
    }, {})
    const dominantEmotion  = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Informational'
    const allEmotions      = ['CTA', 'Sale', 'Inspirational', 'Informational'] as const
    const preview3         = filledHeadlines.slice(0, 3)
    const b                = plan.brief ?? {}
    const displayUrl       = (b.websiteUrl ?? 'www.example.com').replace(/^https?:\/\//, '').replace(/\/$/, '')

    return (
      <div className="space-y-4">
        {/* Ad Strength */}
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <div className="flex gap-1">
            {strengthLevels.map((l, i) => (
              <div key={l} className={cn('h-2 w-8 rounded-full transition-colors', i <= strengthIdx ? STRENGTH_COLOR[strength] : 'bg-gray-200')} />
            ))}
          </div>
          <span className={cn('text-xs font-semibold', STRENGTH_TEXT[strength])}>Ad Strength: {strength}</span>
          <span className="ml-auto text-xs text-gray-500 flex items-center gap-1">
            <Zap className="w-3 h-3 text-yellow-500" />
            ยึดจาก emotion: <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold', EMOTION_COLORS[dominantEmotion] ?? 'bg-gray-100 text-gray-600')}>{dominantEmotion}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Left: headline inputs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                HEADLINES {filledHeadlines.length}/15
              </p>
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {headlines.map((h, i) => {
                const len  = h.length
                const over = len > 30
                const warn = !over && len > 25
                const em   = h ? detectEmotion(h) : null
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                    <div className="flex-1 relative">
                      <input
                        value={h}
                        onChange={e => setHeadline(i, e.target.value)}
                        maxLength={35}
                        placeholder={`Headline ${i + 1}`}
                        className={cn(
                          'w-full text-sm px-3 py-2 pr-16 border rounded-lg outline-none focus:ring-2 transition-colors',
                          over  ? 'border-red-400 bg-red-50 focus:ring-red-300'
                          : warn ? 'border-amber-300 bg-amber-50 focus:ring-amber-300'
                          : 'border-gray-200 bg-white focus:ring-blue-200'
                        )}
                      />
                      <span className={cn(
                        'absolute right-8 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                        over ? 'bg-red-100 text-red-600' : warn ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'
                      )}>{len}/30</span>
                    </div>
                    {em && (
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0', EMOTION_COLORS[em] ?? 'bg-gray-100 text-gray-600')}>{em}</span>
                    )}
                    <button onClick={() => removeHeadline(i)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
              {headlines.length < 15 && (
                <button
                  onClick={addHeadline}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 mt-1 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  + เพิ่ม Headline
                </button>
              )}
            </div>

            {/* Descriptions */}
            <div className="pt-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">DESCRIPTIONS {descriptions.filter(Boolean).length}/4</p>
              <div className="space-y-2">
                {descriptions.map((d, i) => {
                  const len  = d.length
                  const over = len > 90
                  return (
                    <div key={i} className="relative">
                      <textarea
                        value={d}
                        onChange={e => {
                          const next = descriptions.map((x, xi) => xi === i ? e.target.value : x)
                          setDescriptions(next)
                          syncBp(headlines, next)
                        }}
                        maxLength={95}
                        rows={2}
                        placeholder={`Description ${i + 1}`}
                        className={cn(
                          'w-full text-sm px-3 py-2 pr-14 border rounded-lg outline-none focus:ring-2 resize-none transition-colors',
                          over ? 'border-red-400 bg-red-50 focus:ring-red-300' : 'border-gray-200 bg-white focus:ring-blue-200'
                        )}
                      />
                      <span className={cn('absolute right-2 bottom-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full', over ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500')}>{len}/90</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right: Ad Preview */}
          <div className="space-y-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">PREVIEW — GOOGLE SEARCH</p>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold text-white">G</span>
                </div>
                <div>
                  <p className="text-[11px] text-gray-700 leading-none">{b.businessName ?? ''}</p>
                  <p className="text-[10px] text-green-700">{displayUrl}</p>
                </div>
                <span className="ml-auto text-[9px] border border-gray-300 text-gray-500 px-1 rounded">Ad</span>
              </div>
              <p className="text-base font-medium text-blue-700 leading-snug mb-1.5">
                {preview3.length > 0 ? preview3.join(' | ') : 'Headline 1 | Headline 2 | Headline 3'}
              </p>
              {descriptions.filter(Boolean).slice(0, 2).map((d, i) => (
                <p key={i} className="text-sm text-gray-600 leading-relaxed">{d}</p>
              ))}
            </div>

            {/* Emotion Coverage */}
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Emotion Coverage</p>
              <div className="flex gap-2 flex-wrap">
                {allEmotions.map(em => {
                  const covered = !!emotionCounts[em]
                  return (
                    <span key={em} className={cn(
                      'text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors',
                      covered ? EMOTION_COLORS[em] + ' border-transparent' : 'bg-gray-50 text-gray-300 border-gray-200'
                    )}>
                      {covered ? '✓ ' : ''}{em}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Headlines list */}
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">ALL HEADLINES</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filledHeadlines.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-5 text-right shrink-0">{i + 1}.</span>
                    <span className="flex-1 text-gray-700">{h}</span>
                    <span className="text-gray-400 shrink-0">{h.length}/30</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          ← Campaign Details
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">Ad Copy Builder</h2>
        </div>
        {active && (
          <button
            onClick={() => generateAdCopy(active)}
            disabled={generating[active.id]}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {generating[active.id]
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              : <><RefreshCw className="w-4 h-4" /> Re-generate</>
            }
          </button>
        )}
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Next: QA Review
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Campaign tabs */}
      <div className="flex gap-2 flex-wrap">
        {selected.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveId(c.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              activeId === c.id
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            <TypeBadge type={c.type} />
            <span className="max-w-[140px] truncate">{c.name.replace(/^CVC\s*-\s*/i, '').replace(/-[^-]*$/, '').trim() || c.name}</span>
            {hasContent(c.id) && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
          </button>
        ))}
      </div>

      {active && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Campaign header card */}
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <TypeBadge type={active.type} />
            <span className="text-sm font-bold text-gray-900 flex-1 truncate">{active.name}</span>
            <Edit3 className="w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600" />
            <button className="text-xs font-semibold text-purple-600 border border-purple-200 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors">
              CVC Format
            </button>
          </div>
          <div className="px-5 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-3 text-xs text-gray-600">
            <span>Budget: ฿{active.dailyBudget.toLocaleString()}/วัน</span>
            <span>·</span>
            <span>Bid: MAXIMIZE_CLICKS</span>
            <span>·</span>
            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">PAUSED</span>
          </div>

          <div className="p-5">
            {genError[active.id] && (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm mb-4">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {genError[active.id]}
              </div>
            )}

            {generating[active.id] ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                <p className="text-sm">กำลังสร้าง Ad Copy สำหรับ {active.name}...</p>
                <p className="text-xs text-gray-300">ใช้เวลาประมาณ 15-30 วินาที</p>
              </div>
            ) : blueprints[active.id] ? (
              <>
                {active.type === 'SEARCH' ? (
                  <RsaHeadlineEditor campaign={active} bp={blueprints[active.id]} />
                ) : (
                  <AdTextEditor
                    campaign={blueprints[active.id]}
                    onChange={updated => onBlueprintChange(active.id, updated)}
                  />
                )}
                <ExtensionsEditor bp={blueprints[active.id]} onChange={(b) => onBlueprintChange(active.id, b)} />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                <Sparkles className="w-8 h-8 text-purple-200" />
                <p className="text-sm">กด Re-generate เพื่อสร้าง Ad Copy</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 7: Review (comprehensive client review) ──────────────────────────────

function StepReview({
  items,
  blueprints,
  plan,
  status,
  saving,
  onApprove,
  onNext,
}: {
  items: CampaignStructureItem[]
  blueprints: Record<string, CampaignBlueprintItem>
  plan: MediaPlanRecord
  status: string
  saving: boolean
  onApprove: () => void
  onNext: () => void
}) {
  const selected = items.filter(c => c.selected)
  const totalMonthly = selected.reduce((s, c) => s + c.monthlyBudget, 0)
  const b = plan.brief ?? {}
  const reviewDate = new Date().toLocaleDateString('th-TH')
  const [copiedSummary, setCopiedSummary] = useState(false)

  async function handleExportHTML() {
    // Embed uploaded images as base64 so the file is self-contained, then use the full
    // review builder (keywords + audience + ad copy + previews), not the summary-only one.
    const allImgUrls = new Set<string>()
    Object.values(blueprints).forEach(bp => {
      ;(bp.assetGroups ?? []).forEach(ag => (ag.imageAssets ?? []).forEach(img => { if (img.imageUrl?.startsWith('/')) allImgUrls.add(img.imageUrl) }))
      ;(bp.adGroups ?? []).forEach(ag => ag.ads?.forEach(ad => ((ad.display?.imageAssets ?? []) as { imageUrl?: string }[]).forEach(img => { if (img.imageUrl?.startsWith('/')) allImgUrls.add(img.imageUrl!) })))
    })
    const imgMap: Record<string, string> = {}
    await Promise.all(Array.from(allImgUrls).map(async relUrl => {
      try {
        const res = await fetch(relUrl); if (!res.ok) return
        const blob = await res.blob()
        await new Promise<void>(resolve => {
          const r = new FileReader()
          r.onload = () => { imgMap[relUrl] = r.result as string; resolve() }
          r.readAsDataURL(blob)
        })
      } catch { /* skip */ }
    }))
    const html = buildReviewHTML({ plan, items: selected, blueprints, imgMap })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `MediaPlan-${plan.brief?.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.html`
    a.click(); URL.revokeObjectURL(url)
  }

  function handleExportCSV() {
    const esc = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v
    const header = ['Campaign Name', 'Type', 'Funnel', 'Daily Budget', 'Monthly Budget', 'KPI', 'Est. Clicks', 'Impressions', 'Keywords', 'Audiences', 'Headlines', 'Long Headlines', 'Descriptions', 'Sitelinks', 'Callouts', 'Snippets', 'Images']
    const rows = selected.map(c => {
      const bp = blueprints[c.id]
      const kws = (c.keywords ?? []).filter(k => k.selected).map(k => `[${k.matchType.charAt(0)}] ${k.keyword}`).join(' | ')
      const sig = c.pmaxSignal?.audienceSignals
      const auds = c.type === 'PERFORMANCE_MAX'
        ? [...(sig?.customIntent ?? []), ...(sig?.inMarket ?? []), ...(sig?.remarketing ?? []), ...(sig?.searchThemes ?? [])].join(' | ')
        : (c.audiences ?? []).filter(a => a.selected).map(a => a.name).join(' | ')
      // Collect ad text across every shape: RSA + Display/DemandGen + PMax asset groups
      const allAds = (bp?.adGroups ?? []).flatMap(ag => ag.ads ?? [])
      const ags = bp?.assetGroups ?? []
      const headlines = [
        ...allAds.flatMap(ad => ad.rsa?.headlines ?? ad.display?.headlines ?? [ad.headline1, ad.headline2, ad.headline3]),
        ...ags.flatMap(ag => ag.headlines ?? []),
      ].filter(Boolean).join(' | ')
      const longHeadlines = [
        ...allAds.flatMap(ad => ad.display?.longHeadlines ?? []),
        ...ags.flatMap(ag => ag.longHeadlines ?? []),
      ].filter(Boolean).join(' | ')
      const descriptions = [
        ...allAds.flatMap(ad => ad.rsa?.descriptions ?? ad.display?.descriptions ?? [ad.description1, ad.description2]),
        ...ags.flatMap(ag => ag.descriptions ?? []),
      ].filter(Boolean).join(' | ')
      const sitelinks = (bp?.sitelinks ?? []).filter(x => x.text).map(x => x.text).join(' | ')
      const callouts  = (bp?.callouts ?? []).filter(Boolean).join(' | ')
      const snippets  = (bp?.structuredSnippets ?? []).map(x => `${x.header}: ${(x.values ?? []).join('/')}`).join(' | ')
      const imgCount  = [
        ...ags.flatMap(ag => ag.imageAssets ?? []),
        ...allAds.flatMap(ad => (ad.display?.imageAssets ?? []) as { imageUrl?: string }[]),
      ].filter(a => a.imageUrl).length
      return [
        esc(c.name), esc(c.type), esc(getCampaignFunnel(c.type, c.name)),
        String(c.dailyBudget), String(c.monthlyBudget), esc(getCampaignKPI(c.type)),
        String(c.forecast?.clicks ?? 0), String(c.forecast?.impressions ?? 0),
        esc(kws), esc(auds), esc(headlines), esc(longHeadlines), esc(descriptions),
        esc(sitelinks), esc(callouts), esc(snippets), String(imgCount),
      ]
    })
    const csv  = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
    // BOM so Excel opens Thai text correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `MediaPlan-${plan.brief?.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  async function handleCopySummary() {
    const b = plan.brief ?? {}
    const lines = [
      `Media Plan — ${b.businessName ?? plan.title}`,
      `Budget: ฿${selected.reduce((s, c) => s + c.monthlyBudget, 0).toLocaleString()}/เดือน`,
      '',
      ...selected.map(c =>
        `• ${c.name} [${c.type}]\n  ฿${c.monthlyBudget.toLocaleString()}/เดือน (฿${c.dailyBudget.toLocaleString()}/วัน) | KPI: ${getCampaignKPI(c.type)}`
      ),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 2000)
    } catch { /* silent */ }
  }


  async function handleExport() {
    // Collect all relative /uploads/... image URLs from blueprints
    const allImgUrls = new Set<string>()
    Object.values(blueprints).forEach(bp => {
      ;(bp.assetGroups ?? []).forEach(ag => {
        ;(ag.imageAssets ?? []).forEach(img => { if (img.imageUrl?.startsWith('/')) allImgUrls.add(img.imageUrl) })
      })
      ;(bp.adGroups ?? []).forEach(ag => {
        ag.ads?.forEach(ad => {
          ;((ad.display?.imageAssets ?? []) as {imageUrl?: string}[]).forEach(img => { if (img.imageUrl?.startsWith('/')) allImgUrls.add(img.imageUrl!) })
        })
      })
    })

    // Fetch and convert each relative URL to base64 data URL
    const imgMap: Record<string, string> = {}
    await Promise.all(Array.from(allImgUrls).map(async (relUrl) => {
      try {
        const res = await fetch(relUrl)
        if (!res.ok) return
        const blob = await res.blob()
        const reader = new FileReader()
        await new Promise<void>(resolve => {
          reader.onload = () => { imgMap[relUrl] = reader.result as string; resolve() }
          reader.readAsDataURL(blob)
        })
      } catch { /* skip if fetch fails */ }
    }))

    const html = buildReviewHTML({ plan, items: selected, blueprints, imgMap })
    const blobHtml = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blobHtml)
    const a = document.createElement('a')
    a.href = url
    a.download = `Review-${b.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Review & Draft</h2>
          <p className="text-sm text-gray-500 mt-0.5">ตรวจสอบภาพรวมทั้งหมดก่อนส่งลูกค้าหรือ push</p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export สำหรับลูกค้า
        </button>
      </div>

      {/* Summary header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide opacity-80">Business</p>
            <p className="text-xl font-bold">{b.businessName ?? plan.title}</p>
            {b.websiteUrl && <p className="text-xs opacity-70 mt-0.5">{b.websiteUrl}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide opacity-80">Total Monthly Budget</p>
            <p className="text-xl font-bold">฿{totalMonthly.toLocaleString()}</p>
          </div>
        </div>
        <div className="flex gap-6 mt-4 text-sm opacity-90 flex-wrap">
          <span>{selected.length} campaigns</span>
          <span>{reviewDate}</span>
          {b.objective && <span>Objective: {b.objective}</span>}
        </div>
      </div>

      {/* Per-campaign sections */}
      {selected.map(c => {
        const bp = blueprints[c.id]
        const selKws = (c.keywords ?? []).filter(k => k.selected)
        const selAud = (c.audiences ?? []).filter(a => a.selected)
        const isSearch = c.type === 'SEARCH'
        const isPmax = c.type === 'PERFORMANCE_MAX'
        const isDisplay = c.type === 'DISPLAY' || c.type === 'DEMAND_GEN'

        // Collect all ad groups with ads for search/display
        const adGroupsWithAds = bp?.adGroups?.filter(ag => ag.ads?.length) ?? []

        return (
          <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <TypeBadge type={c.type} />
              <span className="text-base font-bold text-gray-900 flex-1 min-w-0 truncate">{c.name}</span>
              <div className="text-right text-xs text-gray-600">
                <p className="font-semibold text-gray-800">฿{c.monthlyBudget.toLocaleString()}/เดือน</p>
                <p>฿{c.dailyBudget.toLocaleString()}/วัน · {bp?.bidStrategy ?? 'MAXIMIZE_CLICKS'}</p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Targeting */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Targeting</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-lg">
                    Locations: {(bp?.locationTargets ?? [b.targetLocation ?? 'Thailand']).join(', ')}
                  </span>
                  <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-lg">
                    Languages: {(bp?.languageTargets ?? [b.language ?? 'th']).join(', ')}
                  </span>
                </div>
              </div>

              {/* Keywords */}
              {(isSearch || isPmax) && selKws.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Keywords ({selKws.length})</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-400">
                          <th className="text-left py-1.5 px-2 font-semibold uppercase">Keyword</th>
                          <th className="text-center py-1.5 px-2 font-semibold uppercase">Match</th>
                          <th className="text-right py-1.5 px-2 font-semibold uppercase">Vol/mo</th>
                          <th className="text-right py-1.5 px-2 font-semibold uppercase">CPC</th>
                          <th className="text-center py-1.5 px-2 font-semibold uppercase">Competition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selKws.map((kw, i) => (
                          <tr key={i} className="border-t border-gray-50">
                            <td className="py-1.5 px-2 text-gray-800">{kw.keyword}</td>
                            <td className="py-1.5 px-2 text-center text-gray-500">{kw.matchType}</td>
                            <td className="py-1.5 px-2 text-right text-gray-600">
                              {kw.avgMonthlySearches >= 1000 ? `${(kw.avgMonthlySearches / 1000).toFixed(1)}K` : kw.avgMonthlySearches}
                            </td>
                            <td className="py-1.5 px-2 text-right text-gray-600">฿{kw.suggestedCpc.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-center">
                              <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', COMPETITION_COLORS[kw.competition])}>
                                {kw.competition}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Audiences */}
              {selAud.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Audiences ({selAud.length})</p>
                  <div className="space-y-1.5">
                    {selAud.map((aud, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5', AUDIENCE_TYPE_BADGE[aud.type] ?? 'bg-gray-100 text-gray-600')}>
                          {aud.type}
                        </span>
                        <div className="min-w-0">
                          <span className="font-semibold text-gray-800">{aud.name}</span>
                          {aud.description && <span className="text-gray-500"> — {aud.description}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Text Ads (Search / Display / Demand Gen) ── */}
              {(isSearch || isDisplay) && adGroupsWithAds.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Text Ads ({adGroupsWithAds.length} ad group{adGroupsWithAds.length > 1 ? 's' : ''})
                  </p>
                  <div className="space-y-4">
                    {adGroupsWithAds.map((ag, gi) => {
                      const ad = ag.ads[0]
                      const isRsa = isSearch
                      const headlines    = isRsa
                        ? (ad.rsa?.headlines?.filter(Boolean) ?? [ad.headline1, ad.headline2, ad.headline3].filter(Boolean))
                        : (ad.display?.headlines?.filter(Boolean) ?? [ad.headline1, ad.headline2].filter(Boolean))
                      const longHeadlines = isRsa ? [] : (ad.display?.longHeadlines?.filter(Boolean) ?? [ad.headline3].filter(Boolean))
                      const descriptions  = isRsa
                        ? (ad.rsa?.descriptions?.filter(Boolean) ?? [ad.description1, ad.description2].filter(Boolean))
                        : (ad.display?.descriptions?.filter(Boolean) ?? [ad.description1].filter(Boolean))
                      const path1 = ad.rsa?.displayPath1 ?? ''
                      const path2 = ad.rsa?.displayPath2 ?? ''
                      const displayUrl = [b.websiteUrl ?? 'www.example.com', path1, path2].filter(Boolean).join(' › ')
                      const businessName = ad.display?.businessName ?? b.businessName ?? ''

                      return (
                        <div key={gi} className="rounded-xl border border-gray-200 overflow-hidden">
                          {/* Ad group label */}
                          <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex items-center gap-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Ad Group</span>
                            <span className="text-xs font-semibold text-gray-700">{ag.adGroupName}</span>
                          </div>

                          <div className="p-4 space-y-4">
                            {/* Google Search Ad Preview */}
                            {isRsa && (
                              <div>
                                <p className="text-[10px] text-gray-400 mb-2 uppercase tracking-wide font-semibold">Preview (Google Search)</p>
                                <div className="bg-white border border-gray-200 rounded-lg p-4 max-w-lg shadow-sm">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                                      <span className="text-[8px] font-bold text-white">G</span>
                                    </div>
                                    <div>
                                      <p className="text-[11px] text-gray-700 leading-none">{b.businessName ?? ''}</p>
                                      <p className="text-[10px] text-green-700">{displayUrl}</p>
                                    </div>
                                    <span className="ml-auto text-[9px] border border-gray-300 text-gray-500 px-1 rounded">Ad</span>
                                  </div>
                                  <p className="text-base font-medium text-blue-700 leading-snug mb-1">
                                    {headlines.slice(0, 3).join(' · ') || 'Headline'}
                                  </p>
                                  {descriptions.map((d, di) => (
                                    <p key={di} className="text-sm text-gray-700 leading-relaxed">{d}</p>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Display Ad Preview Card */}
                            {isDisplay && (
                              <div>
                                <p className="text-[10px] text-gray-400 mb-2 uppercase tracking-wide font-semibold">Preview (Display Banner)</p>
                                <div className="flex gap-4 flex-wrap">
                                  {/* 300×250 style card */}
                                  <div className="w-[300px] h-[250px] rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col bg-gradient-to-br from-blue-600 to-blue-800 text-white relative">
                                    <div className="flex-1 p-4 flex flex-col justify-between">
                                      <div>
                                        {businessName && (
                                          <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-2">{businessName}</p>
                                        )}
                                        <p className="text-lg font-bold leading-tight">
                                          {longHeadlines[0] ?? headlines[0] ?? 'Headline'}
                                        </p>
                                        {headlines[1] && (
                                          <p className="text-sm opacity-90 mt-1">{headlines[1]}</p>
                                        )}
                                      </div>
                                      <div>
                                        {descriptions[0] && (
                                          <p className="text-xs opacity-80 leading-relaxed mb-3">{descriptions[0]}</p>
                                        )}
                                        <div className="inline-block bg-white text-blue-700 text-xs font-bold px-4 py-1.5 rounded-full">
                                          เรียนรู้เพิ่มเติม
                                        </div>
                                      </div>
                                    </div>
                                    <div className="bg-black/20 px-4 py-1.5">
                                      <p className="text-[9px] opacity-60 truncate">{b.websiteUrl ?? 'www.example.com'}</p>
                                    </div>
                                  </div>
                                  {/* Leaderboard 728×90 style */}
                                  <div className="w-full max-w-lg h-[70px] rounded-lg overflow-hidden border border-gray-200 shadow-sm flex items-center bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 gap-4">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold truncate">{headlines[0] ?? 'Headline'}</p>
                                      {descriptions[0] && <p className="text-[11px] opacity-80 truncate">{descriptions[0]}</p>}
                                    </div>
                                    <div className="shrink-0 bg-white text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full">
                                      สมัครเลย
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Full headlines list */}
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                Headlines ({headlines.length}{longHeadlines.length > 0 ? ` + ${longHeadlines.length} long` : ''})
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {headlines.map((h, hi) => (
                                  <span key={hi} className="bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-md border border-blue-100">
                                    {hi + 1}. {h}
                                  </span>
                                ))}
                                {longHeadlines.map((h, hi) => (
                                  <span key={`long-${hi}`} className="bg-purple-50 text-purple-800 text-xs px-2 py-1 rounded-md border border-purple-100">
                                    Long {hi + 1}. {h}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Full descriptions list */}
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                Descriptions ({descriptions.length})
                              </p>
                              <div className="space-y-1">
                                {descriptions.map((d, di) => (
                                  <div key={di} className="flex gap-2 text-xs">
                                    <span className="text-gray-400 shrink-0 w-4 text-right">{di + 1}.</span>
                                    <span className="text-gray-700">{d}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── PMax Asset Groups ── */}
              {isPmax && bp?.assetGroups && bp.assetGroups.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Asset Groups ({bp.assetGroups.length})
                  </p>
                  <div className="space-y-4">
                    {bp.assetGroups.map((ag, gi) => {
                      const headlines     = (ag.headlines ?? []).filter(Boolean)
                      const longHeadlines = (ag.longHeadlines ?? []).filter(Boolean)
                      const descriptions  = (ag.descriptions ?? []).filter(Boolean)
                      const businessName  = ag.businessName ?? b.businessName ?? ''

                      return (
                        <div key={gi} className="rounded-xl border border-orange-200 overflow-hidden">
                          <div className="bg-orange-50 border-b border-orange-100 px-4 py-2 flex items-center gap-2">
                            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wide">Asset Group</span>
                            <span className="text-xs font-semibold text-gray-700">{ag.assetGroupName}</span>
                          </div>

                          <div className="p-4 space-y-4">
                            {/* PMax Preview Card */}
                            <div>
                              <p className="text-[10px] text-gray-400 mb-2 uppercase tracking-wide font-semibold">Preview (Performance Max)</p>
                              <div className="bg-white border border-gray-200 rounded-lg p-4 max-w-lg shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                                    <span className="text-[8px] font-bold text-white">G</span>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-gray-700 leading-none">{businessName}</p>
                                    <p className="text-[10px] text-green-700">{b.websiteUrl ?? 'www.example.com'}</p>
                                  </div>
                                  <span className="ml-auto text-[9px] border border-gray-300 text-gray-500 px-1 rounded">Ad</span>
                                </div>
                                <p className="text-base font-medium text-blue-700 leading-snug mb-1">
                                  {headlines.slice(0, 3).join(' · ') || 'Headline'}
                                </p>
                                {longHeadlines[0] && (
                                  <p className="text-sm text-gray-800 font-medium mb-1">{longHeadlines[0]}</p>
                                )}
                                {descriptions.slice(0, 2).map((d, di) => (
                                  <p key={di} className="text-sm text-gray-700 leading-relaxed">{d}</p>
                                ))}
                              </div>
                            </div>

                            {/* Headlines */}
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                Headlines ({headlines.length}) + Long Headlines ({longHeadlines.length})
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {headlines.map((h, hi) => (
                                  <span key={hi} className="bg-orange-50 text-orange-800 text-xs px-2 py-1 rounded-md border border-orange-100">
                                    {hi + 1}. {h}
                                  </span>
                                ))}
                                {longHeadlines.map((h, hi) => (
                                  <span key={`long-${hi}`} className="bg-purple-50 text-purple-800 text-xs px-2 py-1 rounded-md border border-purple-100 w-full">
                                    Long {hi + 1}. {h}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Descriptions */}
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                Descriptions ({descriptions.length})
                              </p>
                              <div className="space-y-1">
                                {descriptions.map((d, di) => (
                                  <div key={di} className="flex gap-2 text-xs">
                                    <span className="text-gray-400 shrink-0 w-4 text-right">{di + 1}.</span>
                                    <span className="text-gray-700">{d}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Image assets */}
                            {ag.imageAssets && ag.imageAssets.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                                  Image Assets ({ag.imageAssets.length})
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {ag.imageAssets.map((img, ii) => (
                                    <div key={ii} className="bg-gray-100 rounded-lg px-3 py-2 text-xs text-gray-600">
                                      <p className="font-semibold text-gray-700">{img.assetType}</p>
                                      <p className="text-gray-500">{img.description}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Audience signals */}
                            {ag.audienceSignals && (
                              <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Audience Signals</p>
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {ag.audienceSignals.customIntent && (
                                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md">Custom Intent</span>
                                  )}
                                  {ag.audienceSignals.remarketing && (
                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md">Remarketing</span>
                                  )}
                                  {ag.audienceSignals.inMarket && (
                                    <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded-md">In-Market</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* No ad copy yet */}
              {!bp && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
                  ยังไม่มี ad copy สำหรับ campaign นี้ — กลับไปขั้นตอน Ad Copy เพื่อ generate
                </div>
              )}

              {/* Forecast */}
              {c.forecast && (
                <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-lg p-3">
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Clicks/mo</p>
                    <p className="text-sm font-bold text-gray-900">{c.forecast.clicks.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Est. Cost/mo</p>
                    <p className="text-sm font-bold text-gray-900">฿{c.forecast.cost.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Avg CPC</p>
                    <p className="text-sm font-bold text-gray-900">฿{c.forecast.cpc.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* ── Export / ส่งลูกค้า ── */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-4">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-500" /> Export / ส่งลูกค้า
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleExportHTML} className="flex flex-col items-center justify-center gap-2 border border-gray-200 rounded-xl p-6 hover:bg-gray-50 hover:border-blue-300 transition-colors group">
            <FileText className="w-8 h-8 text-blue-400 group-hover:text-blue-600" />
            <span className="text-sm font-semibold text-gray-700">Download HTML</span>
            <span className="text-xs text-gray-400">สำหรับส่งลูกค้า approve — text ads + preview + comment กลับได้</span>
          </button>
          <button onClick={handleExportCSV} className="flex flex-col items-center justify-center gap-2 border border-gray-200 rounded-xl p-6 hover:bg-gray-50 hover:border-emerald-300 transition-colors group">
            <Download className="w-8 h-8 text-emerald-400 group-hover:text-emerald-600" />
            <span className="text-sm font-semibold text-gray-700">Download CSV</span>
            <span className="text-xs text-gray-400">Budget, KPI, Forecast</span>
          </button>
        </div>
        <button
          onClick={handleCopySummary}
          className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
        >
          {copiedSummary ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Copied!</> : <><MessageSquare className="w-4 h-4" /> Copy Summary ไปยัง Clipboard</>}
        </button>
      </div>

      {/* ── Approve — ยืนยัน Draft ก่อนไปขั้น Push ── */}
      <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-900">Approve Plan</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            {status === 'approved' ? 'แผนถูก Approve แล้ว — ไปขั้น Push ได้เลย' : 'ยืนยันแผน + ad copy ทั้งหมด (ขั้น Push จะปลดล็อกหลัง Approve)'}
          </p>
        </div>
        <button
          onClick={onApprove}
          disabled={saving || status === 'approved'}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors shrink-0"
        >
          <ThumbsUp className="w-4 h-4" />
          {status === 'approved' ? '✓ Approved' : 'Approve Plan'}
        </button>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          ไปขั้น Push
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Review HTML Export Builder ────────────────────────────────────────────────

function buildReviewHTML({
  plan,
  items,
  blueprints,
  imgMap = {},
}: {
  plan: MediaPlanRecord
  items: CampaignStructureItem[]
  blueprints: Record<string, CampaignBlueprintItem>
  imgMap?: Record<string, string>
}): string {
  // Resolve image URL: use base64 embed if available, otherwise keep as-is (data: URLs pass through)
  function resolveImg(url?: string): string {
    if (!url) return ''
    if (imgMap[url]) return imgMap[url]      // relative → base64
    return url                                // data: or https: pass through
  }

  const b = plan.brief ?? {}
  const totalMonthly = items.reduce((s, c) => s + c.monthlyBudget, 0)
  const date = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const clientLabel = String(b.businessName ?? plan.title).replace(/['"\\\n\r]/g, ' ').trim()

  const campaignBlocks = items.map(c => {
    const bp = blueprints[c.id]
    const selKws = (c.keywords ?? []).filter(k => k.selected)
    const selAud = (c.audiences ?? []).filter(a => a.selected)

    // Image assets helpers — resolve via imgMap for file:// compatibility
    const allImgAssets: { assetType: string; imageUrl?: string }[] =
      bp?.assetGroups?.flatMap(ag => ag.imageAssets ?? []) ?? []
    const landscapeImg = resolveImg(allImgAssets.find(a => a.assetType === 'MARKETING_IMAGE' && a.imageUrl)?.imageUrl)
    const squareImg    = resolveImg(allImgAssets.find(a => a.assetType === 'SQUARE_MARKETING_IMAGE' && a.imageUrl)?.imageUrl)
    const logoImg      = resolveImg(allImgAssets.find(a => (a.assetType === 'LOGO' || a.assetType === 'SQUARE_LOGO') && a.imageUrl)?.imageUrl)
    const displayImg   = resolveImg(bp?.adGroups?.flatMap(ag => ag.ads ?? [])
      .flatMap(ad => (ad.display?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[])
      .find(a => a.imageUrl)?.imageUrl)

    const adPreview = (() => {
      // ── SEARCH: Google SERP style ──
      if (c.type === 'SEARCH' && bp?.adGroups?.some(ag => ag.ads?.length)) {
        return bp.adGroups.filter(ag => ag.ads?.length).slice(0, 2).map(ag => {
          const ad = ag.ads[0]
          const headlines = (ad.rsa?.headlines?.filter(Boolean) ?? [ad.headline1, ad.headline2, ad.headline3].filter(Boolean))
          const descriptions = (ad.rsa?.descriptions?.filter(Boolean) ?? [ad.description1, ad.description2].filter(Boolean))
          const path = [ad.rsa?.displayPath1, ad.rsa?.displayPath2].filter(Boolean).join(' › ')
          const displayUrl = (b.websiteUrl ?? 'www.example.com').replace(/^https?:\/\//, '').replace(/\/$/, '')
          return `<div class="serp-preview">
            <div class="serp-top">
              <div class="serp-favicon">G</div>
              <div>
                <div class="serp-domain">${displayUrl}${path ? ' › ' + path : ''}</div>
                <div class="serp-adlabel">Sponsored</div>
              </div>
            </div>
            <div class="serp-title">${headlines.slice(0, 3).map(h => `<span>${h}</span>`).join('<span class="serp-sep"> | </span>')}</div>
            <div class="serp-desc">${descriptions.slice(0, 2).join(' ')}</div>
          </div>`
        }).join('')
      }

      // ── PERFORMANCE MAX: Google Ads PMax style ──
      if (c.type === 'PERFORMANCE_MAX' && bp?.assetGroups?.length) {
        return bp.assetGroups.slice(0, 1).map(ag => {
          const hs = (ag.headlines ?? []).filter(Boolean)
          const lhs = (ag.longHeadlines ?? []).filter(Boolean)
          const ds = (ag.descriptions ?? []).filter(Boolean)
          const biz = ag.businessName || b.businessName || plan.title
          const url = (ag.finalUrl || b.websiteUrl || 'www.example.com').replace(/^https?:\/\//, '').replace(/\/$/, '')
          const agImgs: { assetType: string; imageUrl?: string }[] = ag.imageAssets ?? []
          const agLandscape = resolveImg(agImgs.find(a => a.assetType === 'MARKETING_IMAGE' && a.imageUrl)?.imageUrl) || landscapeImg
          const agSquare    = resolveImg(agImgs.find(a => a.assetType === 'SQUARE_MARKETING_IMAGE' && a.imageUrl)?.imageUrl) || squareImg
          const agLogo      = resolveImg(agImgs.find(a => (a.assetType === 'LOGO' || a.assetType === 'SQUARE_LOGO') && a.imageUrl)?.imageUrl) || logoImg

          const h3 = hs.slice(0, 3)
          const longH = lhs[0] ?? ''
          const desc2 = ds.slice(0, 2)

          // Responsive Search Ad format (text overlay on image)
          const imagePreviewBlock = agLandscape ? `
            <div class="pmax-img-wrap">
              <img src="${agLandscape}" class="pmax-landscape" alt="Landscape" />
              ${agSquare ? `<img src="${agSquare}" class="pmax-square" alt="Square" />` : ''}
              <div class="pmax-img-overlay">
                <div class="pmax-overlay-title">${longH || h3.join(' · ')}</div>
                <div class="pmax-overlay-desc">${desc2[0] ?? ''}</div>
              </div>
            </div>` : ''

          // Display ad card
          const displayCard = `
            <div class="pmax-display-card">
              ${agSquare ? `<div class="pmax-card-img-wrap"><img src="${agSquare}" class="pmax-card-img" alt="" /></div>` : '<div class="pmax-card-placeholder"></div>'}
              <div class="pmax-card-body">
                ${agLogo ? `<img src="${agLogo}" class="pmax-logo" alt="Logo" />` : `<div class="pmax-logo-fallback">${biz.charAt(0).toUpperCase()}</div>`}
                <div class="pmax-card-title">${hs[0] ?? ''}</div>
                <div class="pmax-card-desc">${desc2[0] ?? ''}</div>
                <div class="pmax-card-cta">เรียนรู้เพิ่มเติม</div>
              </div>
            </div>`

          // Search ad format
          const searchCard = `
            <div class="serp-preview" style="margin-top:12px">
              <div class="serp-top">
                ${agLogo ? `<img src="${agLogo}" class="serp-logo" alt="Logo" />` : `<div class="serp-favicon">${biz.charAt(0).toUpperCase()}</div>`}
                <div>
                  <div class="serp-domain">${url}</div>
                  <div class="serp-adlabel">Sponsored</div>
                </div>
              </div>
              <div class="serp-title">${h3.map(h => `<span>${h}</span>`).join('<span class="serp-sep"> | </span>')}</div>
              <div class="serp-desc">${desc2.join(' ')}</div>
            </div>`

          return `<div class="pmax-preview-wrap">
            <div class="pmax-format-label">Performance Max — ตัวอย่าง Ad Formats</div>
            ${imagePreviewBlock}
            <div class="pmax-cards-row">
              ${displayCard}
              ${searchCard}
            </div>
            <div class="asset-summary">
              <span class="asset-count">${hs.length} Headlines</span>
              <span class="asset-count">${lhs.length} Long Headlines</span>
              <span class="asset-count">${ds.length} Descriptions</span>
              <span class="asset-count">${agImgs.filter(a => a.imageUrl).length} Images</span>
            </div>
          </div>`
        }).join('')
      }

      // ── DISPLAY / DEMAND GEN: Banner preview ──
      if ((c.type === 'DISPLAY' || c.type === 'DEMAND_GEN') && bp?.adGroups?.some(ag => ag.ads?.length)) {
        return bp.adGroups.filter(ag => ag.ads?.length).slice(0, 1).map(ag => {
          const ad = ag.ads[0]
          const headline  = ad.display?.headlines?.filter(Boolean)?.[0] ?? ad.headline1 ?? ''
          const longH     = ad.display?.longHeadlines?.filter(Boolean)?.[0] ?? ad.headline3 ?? ''
          const desc      = ad.display?.descriptions?.filter(Boolean)?.[0] ?? ad.description1 ?? ''
          const biz       = ad.display?.businessName || b.businessName || plan.title
          const adImgs    = (ad.display?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[]
          const bgImg     = adImgs.find(a => a.imageUrl)?.imageUrl ?? displayImg
          const url       = (b.websiteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

          return `<div class="display-preview-wrap">
            <div class="pmax-format-label">Display Ad — ตัวอย่าง</div>
            ${bgImg ? `
            <div class="display-banner">
              <img src="${bgImg}" class="display-bg" alt="" />
              <div class="display-overlay">
                <div class="display-title">${longH || headline}</div>
                <div class="display-desc">${desc}</div>
                <div class="display-cta">เรียนรู้เพิ่มเติม</div>
              </div>
            </div>` : ''}
            <div class="serp-preview" style="margin-top:12px">
              <div class="serp-top">
                <div class="serp-favicon">${biz.charAt(0).toUpperCase()}</div>
                <div>
                  <div class="serp-domain">${url}</div>
                  <div class="serp-adlabel">Sponsored</div>
                </div>
              </div>
              <div class="serp-title"><span>${headline || longH}</span></div>
              <div class="serp-desc">${desc}</div>
            </div>
          </div>`
        }).join('')
      }
      return ''
    })()

    // Full ad text (every headline + description) so the client can approve the copy
    const adText = (() => {
      const groups: { hs: string[]; ds: string[] }[] = []
      if (c.type === 'PERFORMANCE_MAX') {
        ;(bp?.assetGroups ?? []).forEach(ag => {
          const hs = [...(ag.headlines ?? []), ...(ag.longHeadlines ?? [])].filter(Boolean)
          const ds = (ag.descriptions ?? []).filter(Boolean)
          if (hs.length || ds.length) groups.push({ hs, ds })
        })
      } else if (c.type === 'DISPLAY' || c.type === 'DEMAND_GEN') {
        ;(bp?.adGroups ?? []).forEach(ag => (ag.ads ?? []).forEach(ad => {
          const d = ad.display
          const hs = [...(d?.headlines ?? []), ...(d?.longHeadlines ?? [])].filter(Boolean)
          const ds = (d?.descriptions ?? []).filter(Boolean)
          if (hs.length || ds.length) groups.push({ hs, ds })
        }))
      } else {
        ;(bp?.adGroups ?? []).forEach(ag => (ag.ads ?? []).forEach(ad => {
          const hs = (ad.rsa?.headlines ?? [ad.headline1, ad.headline2, ad.headline3]).filter(Boolean)
          const ds = (ad.rsa?.descriptions ?? [ad.description1, ad.description2]).filter(Boolean)
          if (hs.length || ds.length) groups.push({ hs, ds })
        }))
      }
      if (!groups.length) return ''
      return `<div class="section"><h4>Ad Text — สำหรับ Approve</h4>${groups.map(g => `
        <div class="adtext-block">
          ${g.hs.length ? `<div class="adtext-col"><div class="adtext-label">Headlines (${g.hs.length})</div><ol class="adtext-list">${g.hs.map(h => `<li>${h}</li>`).join('')}</ol></div>` : ''}
          ${g.ds.length ? `<div class="adtext-col"><div class="adtext-label">Descriptions (${g.ds.length})</div><ol class="adtext-list">${g.ds.map(dd => `<li>${dd}</li>`).join('')}</ol></div>` : ''}
        </div>`).join('')}</div>`
    })()

    // Every creative image (asset groups + display ads) for client approval
    const IMG_LABEL: Record<string, string> = { LOGO: 'Logo', SQUARE_LOGO: 'Logo', MARKETING_IMAGE: 'Landscape 1200\u00d7628', SQUARE_MARKETING_IMAGE: 'Square 1200\u00d71200', PORTRAIT_MARKETING_IMAGE: 'Portrait 960\u00d71200' }
    const galleryImgs = [
      ...allImgAssets,
      ...((bp?.adGroups ?? []).flatMap(ag => ag.ads ?? []).flatMap(ad => (ad.display?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[])),
    ].filter(a => a.imageUrl)
    const imageGallery = galleryImgs.length > 0 ? `<div class="section"><h4>Creative Images (${galleryImgs.length})</h4>
      <div class="img-gallery">${galleryImgs.map(a => `<figure class="img-item"><img src="${resolveImg(a.imageUrl)}" alt="" /><figcaption>${IMG_LABEL[a.assetType] ?? a.assetType}</figcaption></figure>`).join('')}</div>
    </div>` : ''

    // Extensions — sitelinks / callouts / structured snippets for approval
    const slk = (bp?.sitelinks ?? []).filter(x => x.text)
    const cos = (bp?.callouts ?? []).filter(Boolean)
    const snp = (bp?.structuredSnippets ?? []).filter(x => x.header)
    const extensionsBlock = (slk.length + cos.length + snp.length) > 0 ? `<div class="section"><h4>Extensions</h4>
      ${slk.length ? `<div class="ext-block"><div class="adtext-label">Sitelinks (${slk.length})</div><ul class="ext-list">${slk.map(x => `<li><strong>${x.text}</strong>${x.description1 ? ` — ${x.description1}` : ''}${x.finalUrl ? ` <span class="ext-url">${x.finalUrl}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${cos.length ? `<div class="ext-block"><div class="adtext-label">Callouts (${cos.length})</div><div class="sig-chips">${cos.map(x => `<span class="sig-chip">${x}</span>`).join('')}</div></div>` : ''}
      ${snp.length ? `<div class="ext-block"><div class="adtext-label">Structured Snippets</div>${snp.map(x => `<div class="snippet-row"><strong>${x.header}</strong>: ${(x.values ?? []).join(' \u00b7 ')}</div>`).join('')}</div>` : ''}
    </div>` : ''

    return `<div class="campaign-block">
      <div class="campaign-header">
        <span class="badge badge-${c.type.toLowerCase().replace('_', '-')}">${TYPE_LABEL[c.type] ?? c.type}</span>
        <strong>${c.name}</strong>
        <span class="budget-tag">฿${c.monthlyBudget.toLocaleString()}/เดือน (฿${c.dailyBudget.toLocaleString()}/วัน)</span>
      </div>
      <div class="section">
        <h4>Targeting</h4>
        <p class="targeting">Locations: ${(bp?.locationTargets ?? [b.targetLocation ?? 'Thailand']).join(', ')} &nbsp;·&nbsp; Languages: ${(bp?.languageTargets ?? [b.language ?? 'th']).join(', ')} &nbsp;·&nbsp; Bid: ${bp?.bidStrategy ?? 'MAXIMIZE_CLICKS'}</p>
      </div>
      ${selKws.length > 0 ? `<div class="section">
        <h4>Keywords (${selKws.length})</h4>
        <table class="kw-table">
          <thead><tr><th>Keyword</th><th>Match</th><th>Vol/mo</th><th>CPC</th><th>Competition</th></tr></thead>
          <tbody>${selKws.map(kw => `<tr>
            <td>${kw.keyword}</td>
            <td><span class="match-type">${kw.matchType}</span></td>
            <td>${kw.avgMonthlySearches >= 1000 ? (kw.avgMonthlySearches / 1000).toFixed(1) + 'K' : kw.avgMonthlySearches}</td>
            <td>฿${kw.suggestedCpc.toFixed(2)}</td>
            <td><span class="comp comp-${kw.competition.toLowerCase()}">${kw.competition}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : ''}
      ${c.type === 'PERFORMANCE_MAX' && c.pmaxSignal ? (() => {
        const sig = c.pmaxSignal.audienceSignals
        const rows = [
          ...(sig.customIntent ?? []).slice(0, 5).map(s => `<span class="sig-chip sig-intent">${s}</span>`),
          ...(sig.inMarket ?? []).slice(0, 3).map(s => `<span class="sig-chip sig-inmarket">${s}</span>`),
          ...(sig.remarketing ?? []).slice(0, 3).map(s => `<span class="sig-chip sig-remarketing">${s}</span>`),
          ...(sig.searchThemes ?? []).slice(0, 3).map(s => `<span class="sig-chip sig-theme">${s}</span>`),
        ]
        return rows.length > 0 ? `<div class="section"><h4>Audience Signals</h4><div class="sig-chips">${rows.join('')}</div></div>` : ''
      })() : selAud.length > 0 ? `<div class="section">
        <h4>Audiences (${selAud.length})</h4>
        <div class="aud-list">${selAud.map(aud => `<div class="aud-item">
          <span class="aud-type aud-${aud.type.toLowerCase()}">${aud.type}</span>
          <span class="aud-name">${aud.name}</span>
          ${aud.description ? `<span class="aud-desc">${aud.description}</span>` : ''}
        </div>`).join('')}</div>
      </div>` : ''}
      ${adText}
      ${extensionsBlock}
      ${adPreview ? `<div class="section"><h4>Ad Preview</h4>${adPreview}</div>` : ''}
      ${imageGallery}
      ${c.forecast ? `<div class="section forecast">
        <h4>Forecast</h4>
        <div class="forecast-grid">
          <div><span class="label">Clicks/mo</span><strong>${c.forecast.clicks.toLocaleString()}</strong></div>
          <div><span class="label">Est. Cost/mo</span><strong>฿${c.forecast.cost.toLocaleString()}</strong></div>
          <div><span class="label">Avg CPC</span><strong>฿${c.forecast.cpc.toFixed(2)}</strong></div>
        </div>
      </div>` : ''}
      <div class="section comment-section">
        <h4>💬 Comment ลูกค้า — ${c.name}</h4>
        <textarea class="cust-comment" data-campaign="${c.name.replace(/"/g, '&quot;')}" placeholder="พิมพ์ความเห็น / จุดที่อยากแก้สำหรับ campaign นี้ (ถ้ามี)..."></textarea>
      </div>
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Media Plan Review — ${b.businessName ?? plan.title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1f2937; background: #f8fafc; padding: 24px; }
  .page { max-width: 900px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden; }
  .img-gallery { display: flex; flex-wrap: wrap; gap: 10px; }
  .img-item { margin: 0; width: 130px; }
  .img-item img { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; display: block; }
  .img-item figcaption { font-size: 10px; color: #6b7280; text-align: center; margin-top: 3px; }
  .ext-block { margin-bottom: 10px; }
  .ext-list { margin: 4px 0 0 18px; padding: 0; font-size: 12px; color: #374151; }
  .ext-list li { margin-bottom: 3px; }
  .ext-url { color: #2563eb; font-size: 11px; word-break: break-all; }
  .snippet-row { font-size: 12px; color: #374151; margin-top: 4px; }
  .header { background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: white; padding: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .header .sub { font-size: 13px; opacity: .85; }
  .summary-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px 24px; border-bottom: 1px solid #e5e7eb; }
  .summary-kpi { text-align: center; }
  .summary-kpi .num { font-size: 24px; font-weight: 800; color: #1d4ed8; }
  .summary-kpi .label { font-size: 11px; color: #6b7280; }
  .campaigns { padding: 0 24px 24px; }
  .campaign-block { border: 1px solid #e5e7eb; border-radius: 10px; margin: 16px 0; overflow: hidden; }
  .campaign-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
  .section { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
  .section:last-child { border-bottom: none; }
  .section h4 { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .targeting { font-size: 12px; color: #374151; }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .badge-search { background: #dbeafe; color: #1d4ed8; }
  .badge-performance-max { background: #fed7aa; color: #c2410c; }
  .badge-display { background: #e9d5ff; color: #7c3aed; }
  .badge-video, .badge-youtube { background: #fce7f3; color: #be185d; }
  .badge-demand-gen { background: #ccfbf1; color: #0f766e; }
  .budget-tag { margin-left: auto; font-size: 12px; font-weight: 600; color: #059669; }
  .kw-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .kw-table th { text-align: left; padding: 4px 8px; background: #f9fafb; color: #9ca3af; font-weight: 600; text-transform: uppercase; font-size: 10px; }
  .kw-table td { padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
  .match-type { background: #f3f4f6; color: #374151; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
  .comp { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 20px; }
  .comp-low { background: #d1fae5; color: #065f46; }
  .comp-medium { background: #fef3c7; color: #92400e; }
  .comp-high { background: #fee2e2; color: #991b1b; }
  .aud-list { display: flex; flex-direction: column; gap: 6px; }
  .aud-item { display: flex; align-items: center; gap: 8px; }
  .aud-type { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 20px; background: #dbeafe; color: #1e40af; }
  .aud-type.aud-in_market { background: #dcfce7; color: #166534; }
  .aud-type.aud-custom_intent { background: #ede9fe; color: #5b21b6; }
  .aud-type.aud-similar { background: #f3f4f6; color: #4b5563; }
  .aud-type.aud-customer_list { background: #fed7aa; color: #c2410c; }
  .aud-name { font-size: 12px; font-weight: 600; }
  .aud-desc { font-size: 11px; color: #6b7280; }
  /* ── Google Search Ad preview ── */
  .serp-preview { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; max-width: 560px; margin-bottom: 10px; font-family: arial,sans-serif; }
  .serp-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .serp-favicon { width: 28px; height: 28px; border-radius: 50%; background: #4285f4; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; }
  .serp-logo { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .serp-domain { font-size: 13px; color: #202124; font-weight: 500; }
  .serp-adlabel { font-size: 10px; color: #006621; background: #e6f4ea; border: 1px solid #9ac498; border-radius: 3px; padding: 0px 4px; display: inline-block; margin-top: 1px; }
  .serp-title { font-size: 18px; color: #1a0dab; font-weight: 400; line-height: 1.35; margin-bottom: 5px; }
  .serp-sep { color: #70757a; font-weight: 300; }
  .serp-desc { font-size: 13px; color: #4d5156; line-height: 1.55; }
  /* ── Performance Max preview ── */
  .pmax-preview-wrap { max-width: 680px; }
  .pmax-format-label { font-size: 10px; font-weight: 700; color: #c2410c; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
  .pmax-img-wrap { position: relative; border-radius: 12px; overflow: hidden; margin-bottom: 12px; }
  .pmax-landscape { width: 100%; max-height: 280px; object-fit: cover; display: block; }
  .pmax-square { position: absolute; bottom: 10px; right: 10px; width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .pmax-img-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 28px 16px 16px; background: linear-gradient(transparent, rgba(0,0,0,.65)); }
  .pmax-overlay-title { font-size: 16px; font-weight: 700; color: white; text-shadow: 0 1px 3px rgba(0,0,0,.4); margin-bottom: 4px; }
  .pmax-overlay-desc { font-size: 12px; color: rgba(255,255,255,.9); text-shadow: 0 1px 2px rgba(0,0,0,.3); }
  .pmax-cards-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .pmax-display-card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .pmax-card-img-wrap { height: 140px; overflow: hidden; }
  .pmax-card-img { width: 100%; height: 100%; object-fit: cover; }
  .pmax-card-placeholder { height: 140px; background: linear-gradient(135deg, #fed7aa, #fbbf24); }
  .pmax-card-body { padding: 12px; }
  .pmax-logo { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-bottom: 8px; }
  .pmax-logo-fallback { width: 28px; height: 28px; border-radius: 50%; background: #ea580c; color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
  .pmax-card-title { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 4px; line-height: 1.3; }
  .pmax-card-desc { font-size: 11px; color: #555; margin-bottom: 10px; line-height: 1.45; }
  .pmax-card-cta { display: inline-block; background: #1d4ed8; color: white; font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 20px; }
  .asset-summary { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
  .asset-count { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: #fed7aa; color: #c2410c; }
  /* ── Display Ad preview ── */
  .display-preview-wrap { max-width: 560px; }
  .display-banner { position: relative; border-radius: 12px; overflow: hidden; max-height: 260px; }
  .display-bg { width: 100%; max-height: 260px; object-fit: cover; display: block; }
  .display-overlay { position: absolute; inset: 0; background: linear-gradient(to right, rgba(0,0,0,.6) 0%, rgba(0,0,0,.1) 100%); display: flex; flex-direction: column; justify-content: center; padding: 20px 24px; }
  .display-title { font-size: 18px; font-weight: 700; color: white; text-shadow: 0 1px 3px rgba(0,0,0,.4); margin-bottom: 6px; max-width: 280px; }
  .display-desc { font-size: 12px; color: rgba(255,255,255,.9); text-shadow: 0 1px 2px rgba(0,0,0,.3); margin-bottom: 12px; max-width: 260px; }
  .display-cta { display: inline-block; background: white; color: #1d4ed8; font-size: 12px; font-weight: 700; padding: 6px 16px; border-radius: 20px; }
  /* ── Audience Signals chips ── */
  .sig-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .sig-chip { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 20px; }
  .sig-intent { background: #ede9fe; color: #5b21b6; }
  .sig-inmarket { background: #dcfce7; color: #166534; }
  .sig-remarketing { background: #dbeafe; color: #1e40af; }
  .sig-theme { background: #fef3c7; color: #92400e; }
  /* ── Forecast ── */
  .forecast-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .forecast-grid div { background: #f0f7ff; border-radius: 8px; padding: 10px; }
  .forecast-grid .label { display: block; font-size: 10px; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
  .forecast-grid strong { font-size: 14px; color: #1e40af; }
  /* ── Ad Text (full copy for approval) ── */
  .adtext-block { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 10px; }
  .adtext-col { min-width: 0; }
  .adtext-label { font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; margin-bottom: 4px; }
  .adtext-list { margin: 0; padding-left: 18px; }
  .adtext-list li { font-size: 12px; color: #1f2937; padding: 2px 0; line-height: 1.4; }
  @media (max-width: 640px) { .adtext-block { grid-template-columns: 1fr; } }
  /* ── Client comments ── */
  .comment-section h4 { color: #b45309; }
  .cust-comment { width: 100%; min-height: 60px; border: 1px solid #fcd34d; background: #fffbeb; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; color: #1f2937; resize: vertical; }
  .cust-comment:focus { outline: none; border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,.15); }
  .comment-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #1e293b; color: white; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; flex-wrap: wrap; z-index: 50; box-shadow: 0 -2px 8px rgba(0,0,0,.15); }
  .comment-bar span { font-size: 12px; opacity: .85; }
  .comment-bar .cbtns { display: flex; gap: 8px; }
  .comment-bar button, .comment-bar a { font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; text-decoration: none; }
  .comment-bar .btn-copy { background: #3b82f6; color: white; }
  .comment-bar .btn-mail { background: #f59e0b; color: #1f2937; }
  .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
  @media print { body { background: white; padding: 0; } .page { box-shadow: none; } .campaign-block { page-break-inside: avoid; } .comment-bar { display: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${plan.title}</h1>
    <div class="sub">${b.businessName ?? ''} — จัดทำโดย Mercy &nbsp;|&nbsp; ${date}</div>
  </div>
  <div class="summary-bar">
    <div class="summary-kpi"><div class="num">${items.length}</div><div class="label">Campaigns</div></div>
    <div class="summary-kpi"><div class="num">฿${totalMonthly.toLocaleString()}</div><div class="label">Total Budget / Month</div></div>
    <div class="summary-kpi"><div class="num">${date}</div><div class="label">Date</div></div>
  </div>
  <div class="campaigns">${campaignBlocks}</div>
  <div class="footer">จัดทำโดย Mercy — Convert Cake &nbsp;|&nbsp; ${date} &nbsp;|&nbsp; เอกสารนี้เป็นความลับ ห้ามเผยแพร่</div>
  <div style="height:76px"></div>
</div>
<div class="comment-bar">
  <span>ลูกค้า: กรอก Comment ในแต่ละ campaign แล้วกดปุ่มเพื่อส่งกลับทีม</span>
  <div class="cbtns">
    <button class="btn-copy" onclick="copyComments()">📋 คัดลอก Comment</button>
    <a class="btn-mail" href="#" onclick="return emailComments()">✉️ ส่งอีเมล</a>
  </div>
</div>
<script>
function collectComments(){
  var out=[];
  document.querySelectorAll('.cust-comment').forEach(function(t){
    if(t.value.trim()) out.push('▪ '+t.dataset.campaign+':\\n'+t.value.trim());
  });
  return out;
}
function buildText(){
  var out=collectComments();
  return 'Media Plan Comments — ${clientLabel}\\n\\n'+(out.length?out.join('\\n\\n'):'(ไม่มี comment)');
}
function copyComments(){
  if(!collectComments().length){ alert('ยังไม่มี Comment — พิมพ์ในช่องของแต่ละ campaign ก่อน'); return; }
  var text=buildText();
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){alert('คัดลอกแล้ว! วางส่งกลับทีม (อีเมล/LINE) ได้เลย');},function(){window.prompt('คัดลอกข้อความนี้แล้วส่งกลับทีม:',text);});
  } else { window.prompt('คัดลอกข้อความนี้แล้วส่งกลับทีม:',text); }
}
function emailComments(){
  if(!collectComments().length){ alert('ยังไม่มี Comment — พิมพ์ในช่องของแต่ละ campaign ก่อน'); return false; }
  var text=buildText();
  // Always copy first so the comment is never lost even when no mail app is set up
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).catch(function(){}); }
  var subject=encodeURIComponent('Media Plan Comments — ${clientLabel}');
  var body=encodeURIComponent(text);
  var gmail='https://mail.google.com/mail/?view=cm&fs=1&tf=1&su='+subject+'&body='+body;
  var useGmail=confirm('เปิดอีเมลเพื่อส่ง Comment กลับ\\n\\nกด OK = เปิด Gmail (แนะนำ)\\nกด Cancel = ใช้โปรแกรมอีเมลในเครื่อง\\n\\n(Comment ถูกคัดลอกไว้แล้ว วางส่งทาง LINE ได้ด้วย)');
  if(useGmail){ window.open(gmail,'_blank'); }
  else { window.location.href='mailto:?subject='+subject+'&body='+body; }
  return false;
}
</script>
</body>
</html>`
}

// ─── GTM Tracking Panel ─────────────────────────────────────────────────────────

interface GtmContainer { accountId: string; accountName: string; containerId: string; containerName: string; publicId: string }
interface Ga4Property  { propertyId: string; displayName: string }

function GtmTrackingPanel({ plan }: { plan: MediaPlanRecord }) {
  const { data: session } = useSession()
  const accessToken = (session as Record<string, unknown> | null)?.accessToken as string | undefined

  const [containers,    setContainers]    = useState<GtmContainer[]>([])
  const [ga4Props,      setGa4Props]      = useState<Ga4Property[]>([])
  const [loadingGtm,    setLoadingGtm]    = useState(false)
  const [loadingGa4,    setLoadingGa4]    = useState(false)

  const [selContainer,  setSelContainer]  = useState<GtmContainer | null>(null)
  const [selGa4,        setSelGa4]        = useState<Ga4Property | null>(null)
  const [conversionId,  setConversionId]  = useState('')      // AW-XXXXXXXXX
  const [remarketingId, setRemarketingId] = useState('')      // optional separate ID
  const [thankyouUrl,   setThankyouUrl]   = useState('/thank-you')
  const [pushLinker,    setPushLinker]    = useState(true)
  const [pushRmkt,      setPushRmkt]      = useState(true)
  const [minimalMode,   setMinimalMode]   = useState(true)   // fewer GTM calls → avoids 429

  // Google Ads account → used to auto-pull the Conversion / Remarketing ID
  const [convAccounts,  setConvAccounts]  = useState<GadsAccount[]>([])
  const [convAcct,      setConvAcct]      = useState('')
  const [loadingConv,   setLoadingConv]   = useState(false)

  const [building,      setBuilding]      = useState(false)
  const [pushing,       setPushing]       = useState(false)
  const [log,           setLog]           = useState<string[]>([])
  const [result,        setResult]        = useState<{ ok: boolean; versionId?: string; error?: string } | null>(null)

  const noToken = !accessToken

  // Load GTM containers
  useEffect(() => {
    setLoadingGtm(true)
    const headers: Record<string, string> = {}
    if (accessToken) headers['x-access-token'] = accessToken
    fetch('/api/tracking/gtm-containers', { headers })
      .then(r => r.json())
      .then(d => {
        const list: GtmContainer[] = d.containers ?? []
        setContainers(list)
        if (list.length > 0) setSelContainer(list[0])
      })
      .catch(() => {})
      .finally(() => setLoadingGtm(false))
  }, [accessToken])

  // Load GA4 properties
  useEffect(() => {
    setLoadingGa4(true)
    fetch('/api/integrations/ga4')
      .then(r => r.json())
      .then(d => {
        const list: Ga4Property[] = d.data ?? []
        setGa4Props(list)
        if (list.length > 0) setSelGa4(list[0])
      })
      .catch(() => {})
      .finally(() => setLoadingGa4(false))
  }, [])

  // Pre-fill from plan brief
  useEffect(() => {
    const b = plan.brief
    const bAny = b as Record<string, unknown>
    if (bAny?.googleAdsConversionId) setConversionId(bAny.googleAdsConversionId as string)
    if (b?.websiteUrl) {
      const base = (b.websiteUrl as string).replace(/\/$/, '')
      setThankyouUrl(`${base}/thank-you`)
    }
  }, [plan])

  // Load Google Ads accounts for the conversion-ID lookup (default to the plan's account)
  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const list: GadsAccount[] = (d.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
          currencyCode: a.currencyCode as string | undefined,
        }))
        setConvAccounts(list)
        const briefAcct = (plan.brief as Record<string, unknown> | undefined)?.googleAdsCustomerId as string | undefined
        setConvAcct(briefAcct || list[0]?.id || '')
      })
      .catch(() => {})
  }, [plan])

  // Auto-pull Conversion / Remarketing ID from the selected account's conversion tracking setting
  useEffect(() => {
    if (!convAcct) return
    let cancelled = false
    setLoadingConv(true)
    fetch(`/api/google-ads/customer-info?customerId=${convAcct}`)
      .then(r => r.ok ? r.json() : null)
      .then(info => {
        if (cancelled || !info?.remarketingId) return
        setConversionId(info.remarketingId)
        setRemarketingId(info.remarketingId)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingConv(false) })
    return () => { cancelled = true }
  }, [convAcct])

  async function handlePushGtm() {
    if (!selContainer) return
    setPushing(true); setLog([]); setResult(null)

    try {
      // Step 1: generate GTM workspace via AI.
      // The endpoint expects { clientName, trackingPlan } — build a minimal tracking plan
      // with a Thank-You-page conversion event so it produces GA4 + conversion tags.
      setBuilding(true)
      const b = plan.brief ?? {}
      const now = new Date().toISOString()
      let thankPath = '/thank-you'
      try { thankPath = new URL(thankyouUrl).pathname || '/thank-you' } catch { /* keep default */ }
      const clientName = String(b.businessName ?? plan.title)
      const trackingPlan = {
        id:           plan.id,
        clientId:     plan.id,
        name:         `${clientName} — Tracking`,
        trackingType: 'WEB_LEAD',
        status:       'AI_READY',
        riskLevel:    'LOW',
        events: [{
          id:                    'evt_thankyou',
          clientId:              plan.id,
          eventName:             'Lead - Thank You',
          triggerType:           'page_view',
          triggerRule:           `Page URL contains ${thankPath}`,
          destination:           'BOTH',
          priority:              'PRIMARY',
          googleAdsConversionId: conversionId || undefined,
          isKeyEvent:            true,
          status:                'AI_READY',
          riskLevel:             'LOW',
          notes:                 `selector: thankyou | GA4: ${selGa4 ? `G-${selGa4.propertyId}` : ''}`,
          createdAt:             now,
        }],
        createdAt: now,
        updatedAt: now,
      }
      const genRes = await fetch('/api/tracking/generate-gtm-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          trackingPlan,
          existingGtmId: selContainer.publicId,
        }),
      })
      const genData = await genRes.json()
      setBuilding(false)
      if (!genRes.ok) throw new Error(genData.error ?? 'Build workspace failed')
      const workspace = genData.data

      // Step 2: push to GTM + publish
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (accessToken) headers['x-access-token'] = accessToken

      const pushRes = await fetch('/api/tracking/push-to-gtm', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          accountId:              selContainer.accountId,
          containerId:            selContainer.containerId,
          workspace,
          ga4MeasurementId:       selGa4 ? `G-${selGa4.propertyId}` : undefined,
          googleAdsConversionId:  conversionId || undefined,
          googleAdsRemarketingId: remarketingId || conversionId || undefined,
          pushConversionLinker:   pushLinker,
          pushRemarketing:        pushRmkt,
          minimal:                minimalMode,
        }),
      })
      const pushData = await pushRes.json()
      setLog(pushData.log ?? [])
      if (!pushRes.ok) throw new Error(pushData.error ?? 'Push failed')
      setResult({ ok: true, versionId: pushData.publishedVersionId })
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed'
      const friendly = /429|RESOURCE_EXHAUSTED|rateLimitExceeded/i.test(raw)
        ? 'GTM API quota เต็มชั่วคราว (ยิงถี่เกิน/เทสต์บ่อยวันนี้) — รอ 1-2 นาทีแล้วกด Push ใหม่อีกครั้ง ระบบ retry ให้อัตโนมัติแล้ว'
        : raw
      setResult({ ok: false, error: friendly })
    } finally {
      setPushing(false); setBuilding(false)
    }
  }

  const canPush = !!selContainer && !pushing

  return (
    <div className="space-y-4">
      {noToken && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>ยังไม่ได้ Login ด้วย Google — GTM push ต้องใช้ Google Account ที่มีสิทธิ์ GTM</span>
        </div>
      )}

      {/* GTM Container */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">GTM Container</p>
        {loadingGtm ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />กำลังโหลด containers...</div>
        ) : containers.length === 0 ? (
          <p className="text-sm text-gray-400">ไม่พบ GTM Container — ตรวจสอบสิทธิ์ Google account</p>
        ) : (
          <select
            value={selContainer?.containerId ?? ''}
            onChange={e => setSelContainer(containers.find(c => c.containerId === e.target.value) ?? null)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
          >
            {containers.map(c => (
              <option key={c.containerId} value={c.containerId}>
                {c.accountName} → {c.containerName} ({c.publicId})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* GA4 Property */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">GA4 Property</p>
        {loadingGa4 ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />กำลังโหลด GA4...</div>
        ) : ga4Props.length === 0 ? (
          <div>
            <p className="text-sm text-gray-400 mb-2">ไม่พบ GA4 Property อัตโนมัติ — กรอก Measurement ID เอง</p>
            <input placeholder="G-XXXXXXXXXX"
              onChange={e => setSelGa4({ propertyId: e.target.value.replace(/^G-/i, ''), displayName: 'Manual' })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        ) : (
          <select
            value={selGa4?.propertyId ?? ''}
            onChange={e => setSelGa4(ga4Props.find(p => p.propertyId === e.target.value) ?? null)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
          >
            <option value="">(ไม่เลือก GA4)</option>
            {ga4Props.map(p => (
              <option key={p.propertyId} value={p.propertyId}>{p.displayName} (G-{p.propertyId})</option>
            ))}
          </select>
        )}
      </div>

      {/* Google Ads IDs */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Google Ads Conversion</p>
        {convAccounts.length > 0 && (
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Account (ดึง Conversion ID อัตโนมัติ)</label>
            <AccountSelect
              accounts={convAccounts}
              value={convAcct}
              onChange={setConvAcct}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            />
            {loadingConv && <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> กำลังดึง Conversion ID...</p>}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Conversion ID (AW-XXXXXXXXX)</label>
            <input value={conversionId} onChange={e => setConversionId(e.target.value)}
              placeholder="AW-1234567890"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Remarketing ID (ถ้าต่างจาก Conversion)</label>
            <input value={remarketingId} onChange={e => setRemarketingId(e.target.value)}
              placeholder="AW-XXXXXXXXX (optional)"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Thank You Page URL</label>
          <input value={thankyouUrl} onChange={e => setThankyouUrl(e.target.value)}
            placeholder="/thank-you"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
      </div>

      {/* Options */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Tags ที่จะ Push</p>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked className="w-4 h-4" readOnly />
          GA4 Config Tag{minimalMode ? '' : ' + Thank You Page Event'} (เสมอ)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={pushLinker} onChange={e => setPushLinker(e.target.checked)} className="w-4 h-4" />
          Conversion Linker (แนะนำ)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={pushRmkt} onChange={e => setPushRmkt(e.target.checked)} className="w-4 h-4" />
          Google Ads Remarketing Tag
        </label>
        <label className="flex items-start gap-2 text-sm text-amber-800 cursor-pointer mt-1 pt-2 border-t border-gray-100">
          <input type="checkbox" checked={minimalMode} onChange={e => setMinimalMode(e.target.checked)} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="font-semibold">โหมดประหยัด quota</span> — push แค่ GA4 Config + Linker + Remarketing (ตัด Thank-You event) เพื่อเลี่ยง GTM 429
          </span>
        </label>
      </div>

      {/* Push button */}
      <button
        onClick={handlePushGtm}
        disabled={!canPush}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 rounded-xl transition-colors"
      >
        {pushing
          ? <><Loader2 className="w-4 h-4 animate-spin" />{building ? 'กำลัง Build Workspace...' : 'กำลัง Push & Publish GTM...'}</>
          : <><Send className="w-4 h-4" /> Push to GTM & Publish</>}
      </button>

      {/* Result */}
      {result && (
        <div className={cn('rounded-xl p-4 space-y-2', result.ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200')}>
          <div className="flex items-center gap-2">
            {result.ok
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              : <AlertTriangle className="w-4 h-4 text-red-500" />}
            <p className={cn('text-sm font-semibold', result.ok ? 'text-emerald-800' : 'text-red-700')}>
              {result.ok ? `✅ Push & Publish สำเร็จ! GTM Version: ${result.versionId}` : `❌ ${result.error}`}
            </p>
          </div>
          {result.ok && (
            <p className="text-xs text-emerald-600">Tags live แล้วใน container {selContainer?.publicId} — ตรวจสอบใน GTM Preview Mode</p>
          )}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 max-h-48 overflow-y-auto">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Push Log</p>
          {log.map((line, i) => (
            <p key={i} className={cn('text-[11px] font-mono', line.startsWith('✓') ? 'text-emerald-400' : line.startsWith('⚠') ? 'text-amber-400' : 'text-gray-300')}>
              {line}
            </p>
          ))}
        </div>
      )}

      <a href="/tracking-setup" className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
        <Send className="w-3.5 h-3.5" /> ตั้งค่า Tracking Setup แบบ Full →
      </a>
    </div>
  )
}

// ─── Step 8: QA ────────────────────────────────────────────────────────────────

interface GadsAccount { id: string; name: string; currencyCode?: string }

// รูปที่ Google บังคับต่อ campaign type — ใช้ gate ทั้ง QA และปุ่ม Push
function blueprintAssetGaps(type: string, bp?: CampaignBlueprintItem | null): string[] {
  const needLogo = type === 'PERFORMANCE_MAX' || type === 'DEMAND_GEN'
  const needImgs = needLogo || type === 'DISPLAY'
  if (!needImgs) return []
  if (!bp) return ['ยังไม่มี ad copy/blueprint — กด Generate ใน Ad Copy step']
  const imgs = [
    ...(bp.assetGroups?.flatMap(ag => ag.imageAssets ?? []) ?? []),
    ...(bp.adGroups ?? []).flatMap(ag => ag.ads ?? []).flatMap(ad => ([
      ...((ad.pmax?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[]),
      ...((ad.display?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[]),
    ])),
  ]
  const has = (types: string[]) => imgs.some(a => types.includes(a.assetType) && a.imageUrl)
  const gaps: string[] = []
  if (needLogo && !has(['LOGO', 'SQUARE_LOGO'])) gaps.push('รูป Logo (1200×1200)')
  if (!has(['MARKETING_IMAGE'])) gaps.push('รูป Landscape (1200×628)')
  if (!has(['SQUARE_MARKETING_IMAGE'])) gaps.push('รูป Square (1200×1200)')
  if (type === 'PERFORMANCE_MAX') {
    const biz = (bp.assetGroups ?? []).some(ag => ag.businessName)
      || (bp.adGroups ?? []).some(ag => (ag.ads ?? []).some(ad => ad.pmax?.businessName))
    if (!biz) gaps.push('Business Name')
  }
  return gaps
}

// Display/DemandGen: ใช้ audience จริงจาก media plan แทนชื่อที่ AI แต่งใน blueprint
// + แคมเปญ remarketing: ลบ ad group นอกแผน (In-Market prospecting ที่ AI แถม) ทิ้งก่อน push
function withPlanAudiences(c: CampaignStructureItem, bp: CampaignBlueprintItem): CampaignBlueprintItem {
  if (c.type !== 'DISPLAY' && c.type !== 'DEMAND_GEN') return bp
  let adGroups = bp.adGroups ?? []
  if (/remarket|rtg|retention/i.test(c.name) && adGroups.length > 0) {
    const looksRemarketing = (n: string) => /remarket|visitor|retention|rtg|converter|customer|cart/i.test(n)
    const kept = adGroups.filter(ag => looksRemarketing(ag.adGroupName))
    adGroups = (kept.length > 0 ? kept : [adGroups[0]]).map((ag, i) => ({
      ...ag,
      adGroupName: looksRemarketing(ag.adGroupName) ? ag.adGroupName : (i === 0 ? 'Remarketing - Website Visitors' : `Remarketing - ${i + 1}`),
    }))
  }
  const names = (c.audiences ?? []).filter(a => a.selected).map(a => a.name)
  return { ...bp, adGroups: adGroups.map(ag => ({ ...ag, audiences: names.length > 0 ? names : ag.audiences })) }
}

function StepQA({
  items,
  blueprints,
  plan,
  onPass,
  onRename,
}: {
  items: CampaignStructureItem[]
  blueprints: Record<string, CampaignBlueprintItem>
  plan: MediaPlanRecord
  onPass: () => void
  onRename?: (id: string, newName: string) => void
}) {
  const selected = items.filter(c => c.selected)
  const [checks, setChecks] = useState<QACheck[]>([])
  const [scanning, setScanning] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [accounts, setAccounts] = useState<GadsAccount[]>([])
  const [selectedAcct, setSelectedAcct] = useState<GadsAccount | null>(null)
  const [loadingAccts, setLoadingAccts] = useState(true)
  const [liveInfo, setLiveInfo] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const list: GadsAccount[] = (d.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
          currencyCode: a.currencyCode as string | undefined,
        }))
        setAccounts(list)
        // ห้าม auto-select account — เคยหลุด push ลงบัญชีลูกค้า (Villa Market) ต้องเลือกเองเสมอ
      })
      .catch(() => {})
      .finally(() => setLoadingAccts(false))
  }, [])

  async function runQA(overrideItems?: CampaignStructureItem[]) {
    setScanning(true)
    setLiveInfo(null)
    const results: QACheck[] = []
    const sourceItems = (overrideItems ?? items).filter(c => c.selected)
    // รูปแชร์ข้ามแคมเปญ: อัปโหลดที่แคมเปญไหนก็ได้ ตัวที่ขาดหยิบจาก pool อัตโนมัติ
    const imgPool = buildImagePool(sourceItems.map(c => blueprints[c.id]))

    sourceItems.forEach(c => {
      const bpRaw = blueprints[c.id]
      const bp = bpRaw ? withPooledImages(c.type, bpRaw, imgPool) : bpRaw

      // Campaign name check
      if (c.name.includes('|')) {
        results.push({ id: `${c.id}-pipe`, category: c.name, label: 'ชื่อ campaign', status: 'fail', message: 'ชื่อมี | (pipe) — ห้ามใช้ ให้ใช้ - แทน', editable: true, fieldKey: 'name', fieldValue: c.name })
      } else if (c.name.startsWith('CVC')) {
        results.push({ id: `${c.id}-name`, category: c.name, label: 'ชื่อ campaign', status: 'pass', message: 'ชื่อ campaign ถูกต้อง (CVC prefix)' })
      } else {
        results.push({ id: `${c.id}-name`, category: c.name, label: 'ชื่อ campaign', status: 'warn', message: 'ชื่อ campaign ควรขึ้นต้นด้วย CVC' })
      }

      // Budget check
      if (c.dailyBudget <= 0) {
        results.push({ id: `${c.id}-budget`, category: c.name, label: 'Daily Budget', status: 'fail', message: 'Daily budget = 0 — ต้องกำหนดงบ' })
      } else {
        results.push({ id: `${c.id}-budget`, category: c.name, label: 'Daily Budget', status: 'pass', message: `฿${c.dailyBudget.toLocaleString()}/วัน` })
      }

      // Keyword check for Search
      if (c.type === 'SEARCH') {
        const selectedKws = (c.keywords ?? []).filter(k => k.selected)
        if (selectedKws.length < 3) {
          results.push({ id: `${c.id}-kw`, category: c.name, label: 'Keywords', status: 'fail', message: `มีเพียง ${selectedKws.length} keyword — ควรมีอย่างน้อย 3` })
        } else {
          results.push({ id: `${c.id}-kw`, category: c.name, label: 'Keywords', status: 'pass', message: `${selectedKws.length} keywords selected` })
        }

        // RLSA only audience check
        const nonRlsa = (c.audiences ?? []).filter(a => a.selected && a.type !== 'RLSA')
        if (nonRlsa.length > 0) {
          results.push({ id: `${c.id}-aud-rule`, category: c.name, label: 'Audience Rule', status: 'fail', message: `Search campaign มี non-RLSA audience: ${nonRlsa.map(a => a.name).join(', ')}` })
        } else {
          results.push({ id: `${c.id}-aud-rule`, category: c.name, label: 'Audience Rule', status: 'pass', message: 'Audience ถูกต้อง (RLSA only)' })
        }
      }

      // PMax audience signals — stored in pmaxSignal.audienceSignals
      if (c.type === 'PERFORMANCE_MAX') {
        const sig = c.pmaxSignal?.audienceSignals
        const signalCount =
          (sig?.customIntent?.length ?? 0) +
          (sig?.searchThemes?.length ?? 0) +
          (sig?.remarketing?.length ?? 0) +
          (sig?.inMarket?.length ?? 0) +
          (sig?.customerList?.length ?? 0)
        if (!c.audienceDone || signalCount === 0) {
          results.push({ id: `${c.id}-pmax-aud`, category: c.name, label: 'Audience Signals', status: 'fail', message: 'PMax ต้องมี Audience Signals อย่างน้อย 1 รายการ' })
        } else {
          results.push({ id: `${c.id}-pmax-aud`, category: c.name, label: 'Audience Signals', status: 'pass', message: `${signalCount} audience signals (customIntent + searchThemes + remarketing + inMarket)` })
        }
      }

      // Ad copy check
      if (bp) {
        const hasAdCopy = bp.adGroups?.some(ag => ag.ads?.length > 0) || (bp.assetGroups?.length ?? 0) > 0
        if (!hasAdCopy) {
          results.push({ id: `${c.id}-adcopy`, category: c.name, label: 'Ad Copy', status: 'warn', message: 'ยังไม่มี ad copy — แนะนำให้เพิ่มก่อน push' })
        } else {
          results.push({ id: `${c.id}-adcopy`, category: c.name, label: 'Ad Copy', status: 'pass', message: 'มี ad copy แล้ว' })
        }

        // PMax required assets — Google Ads will reject if any of these are missing
        if (c.type === 'PERFORMANCE_MAX') {
          const allImgAssets = [
            ...(bp.assetGroups?.flatMap(ag => ag.imageAssets ?? []) ?? []),
            ...(bp.adGroups ?? []).flatMap(ag => ag.ads ?? []).flatMap(ad => (ad.pmax?.imageAssets ?? []) as { assetType: string; imageUrl?: string }[]),
          ]

          // Business name — required by Brand Guidelines
          const bizNameSources = [
            ...(bp.assetGroups?.map(ag => ag.businessName).filter(Boolean) ?? []),
            ...(bp.adGroups ?? []).flatMap(ag => ag.ads ?? []).map(ad => ad.pmax?.businessName).filter(Boolean),
          ]
          if (bizNameSources.length === 0) {
            results.push({ id: `${c.id}-pmax-bizname`, category: c.name, label: 'Business Name', status: 'fail', message: 'ขาด Business Name — กลับไปแก้ใน Ad Copy step แล้วกรอกชื่อธุรกิจ' })
          } else {
            results.push({ id: `${c.id}-pmax-bizname`, category: c.name, label: 'Business Name', status: 'pass', message: `Business Name: "${bizNameSources[0]}"` })
          }

          // Logo — required for Brand Guidelines
          const hasLogo = allImgAssets.some(a => (a.assetType === 'LOGO' || a.assetType === 'SQUARE_LOGO') && a.imageUrl)
          if (!hasLogo) {
            results.push({ id: `${c.id}-pmax-logo`, category: c.name, label: 'Brand Logo', status: 'fail', message: 'ขาดรูป Logo (1200×1200) — กลับไปอัปโหลดใน Ad Copy step (ช่อง Logo)' })
          } else {
            results.push({ id: `${c.id}-pmax-logo`, category: c.name, label: 'Brand Logo', status: 'pass', message: 'มี Logo image พร้อม Brand Guidelines' })
          }

          // Landscape image — required for PMax asset group
          const hasMarketingImg = allImgAssets.some(a => a.assetType === 'MARKETING_IMAGE' && a.imageUrl)
          if (!hasMarketingImg) {
            results.push({ id: `${c.id}-pmax-landscape`, category: c.name, label: 'Landscape Image', status: 'fail', message: 'ขาดรูป Landscape (1200×628 อัตราส่วน 1.91:1) — กลับไปอัปโหลดใน Ad Copy step' })
          } else {
            results.push({ id: `${c.id}-pmax-landscape`, category: c.name, label: 'Landscape Image', status: 'pass', message: 'มีรูป Landscape (1.91:1)' })
          }

          // Square image — required for PMax asset group
          const hasSquareImg = allImgAssets.some(a => a.assetType === 'SQUARE_MARKETING_IMAGE' && a.imageUrl)
          if (!hasSquareImg) {
            results.push({ id: `${c.id}-pmax-square`, category: c.name, label: 'Square Image', status: 'fail', message: 'ขาดรูป Square (1200×1200 อัตราส่วน 1:1) — กลับไปอัปโหลดใน Ad Copy step' })
          } else {
            results.push({ id: `${c.id}-pmax-square`, category: c.name, label: 'Square Image', status: 'pass', message: 'มีรูป Square (1:1)' })
          }
        }

        // Display / Demand Gen ก็มีรูปบังคับเหมือนกัน — ไม่งั้น push ผ่านแต่ได้ 0 ads
        if (c.type === 'DISPLAY' || c.type === 'DEMAND_GEN') {
          const gaps = blueprintAssetGaps(c.type, bp)
          if (gaps.length > 0) {
            results.push({ id: `${c.id}-img-req`, category: c.name, label: 'Required Images', status: 'fail', message: `ขาด ${gaps.join(', ')} — อัปโหลดใน Ad Copy step (ระบบ crop ให้อัตโนมัติ)` })
          } else {
            results.push({ id: `${c.id}-img-req`, category: c.name, label: 'Required Images', status: 'pass', message: 'รูปครบตามที่ Google บังคับ' })
          }
        }
      }
    })

    // ── เช็คกับแคมเปญที่รันอยู่จริงในบัญชี (ชื่อ/keyword/audience ซ้ำ) ──
    if (selectedAcct) {
      try {
        const payload = sourceItems.map(c => ({
          name: c.name,
          type: c.type,
          keywords: (c.keywords ?? []).filter(k => k.selected).map(k => k.keyword),
          audiences: c.type === 'PERFORMANCE_MAX'
            ? [...(c.pmaxSignal?.audienceSignals.remarketing ?? []), ...(c.pmaxSignal?.audienceSignals.inMarket ?? [])]
            : (c.audiences ?? []).filter(a => a.selected).map(a => a.name),
        }))
        const res = await fetch('/api/qa/live-conflicts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: selectedAcct.id, campaigns: payload }),
        })
        const d = await res.json()
        if (res.ok) {
          const conflicts = (d.conflicts ?? []) as { campaign: string; label: string; severity: 'fail' | 'warn'; message: string }[]
          sourceItems.forEach(c => {
            const mine = conflicts.filter(cf => cf.campaign === c.name)
            if (mine.length === 0) {
              results.push({ id: `${c.id}-live`, category: c.name, label: 'Live Account Check', status: 'pass', message: `ไม่ชนกับแคมเปญ ENABLED ${d.liveCampaigns ?? 0} ตัวในบัญชี` })
            } else {
              mine.forEach((cf, i) => results.push({ id: `${c.id}-live-${i}`, category: c.name, label: cf.label, status: cf.severity, message: cf.message }))
            }
          })
          setLiveInfo(`เทียบกับแคมเปญ ENABLED ${d.liveCampaigns ?? 0} ตัวใน ${selectedAcct.name}`)
        } else {
          sourceItems.forEach(c => results.push({ id: `${c.id}-live`, category: c.name, label: 'Live Account Check', status: 'warn', message: `เช็คกับบัญชีไม่สำเร็จ — ${(d.error ?? '').slice(0, 100)}` }))
        }
      } catch {
        sourceItems.forEach(c => results.push({ id: `${c.id}-live`, category: c.name, label: 'Live Account Check', status: 'warn', message: 'เช็คกับบัญชีไม่สำเร็จ (network)' }))
      }
    }

    setChecks(results)
    setScanning(false)
  }

  useEffect(() => { runQA() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const failCount  = checks.filter(c => c.status === 'fail').length
  const warnCount  = checks.filter(c => c.status === 'warn').length
  const passCount  = checks.filter(c => c.status === 'pass').length
  const totalChecks = checks.length
  const score      = totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 0
  const qaPassed   = totalChecks > 0 && failCount === 0

  // SVG circle gauge
  const radius = 40, circ = 2 * Math.PI * radius
  const dash   = circ * (score / 100)
  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'

  const grouped = selected.map(c => ({
    campaign: c,
    checks: checks.filter(ch => ch.category === c.name),
  }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">QA — ตรวจสอบก่อนส่ง</h2>
          <p className="text-xs text-gray-400 mt-0.5">เช็คความครบถ้วน + เทียบกับแคมเปญที่รันอยู่จริงในบัญชี · ผ่านแล้วไปขั้น Review &amp; Draft</p>
        </div>
        {qaPassed && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" /> QA ผ่านแล้ว
          </span>
        )}
      </div>

      <div className="space-y-4">
          {/* Account selector */}
          <div className={cn('border rounded-xl p-4 space-y-3', !selectedAcct ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                {!selectedAcct ? (
                  <>
                    <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> กรุณาเลือก Google Ads Account ก่อน
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">ต้องเลือก account ทุกครั้ง — ป้องกันการ push ไปผิด account ของลูกค้าคนอื่น</p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-gray-800">Google Ads Account</p>
                )}
                <div className="mt-2">
                  {loadingAccts ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...</div>
                  ) : (
                    <AccountSelect
                      accounts={accounts}
                      value={selectedAcct?.id ?? ''}
                      onChange={id => setSelectedAcct(accounts.find(a => a.id === id) ?? null)}
                      placeholder="— เลือก Account —"
                      className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-72 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0 items-end">
                <button
                  onClick={() => runQA()}
                  disabled={scanning || !selectedAcct}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Run QA
                </button>
                {liveInfo && <p className="text-[10px] text-gray-400">{liveInfo}</p>}
              </div>
            </div>
          </div>

          {/* Campaign checklist */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">แคมเปญที่จะตรวจ ({selected.length})</span>
              <span className="text-xs text-gray-400">push ได้ที่ขั้น Push (ขั้นสุดท้าย)</span>
            </div>
            <div className="divide-y divide-gray-100">
              {selected.map(c => {
                const campChecks = checks.filter(ch => ch.category === c.name)
                const hasFail    = campChecks.some(ch => ch.status === 'fail')
                const allPass    = campChecks.length > 0 && campChecks.every(ch => ch.status === 'pass')
                const adGroups   = blueprints[c.id]?.adGroups?.length ?? 0
                return (
                  <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.name}</span>
                        <TypeBadge type={c.type} />
                        {allPass && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-semibold">
                            <CheckCircle2 className="w-3 h-3" /> พร้อม Push
                          </span>
                        )}
                        {hasFail && (
                          <span className="flex items-center gap-1 text-[10px] text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full font-semibold">
                            <X className="w-3 h-3" /> มีข้อผิดพลาด
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        ฿{c.dailyBudget.toLocaleString()}/วัน · {blueprints[c.id]?.bidStrategy ?? 'MAXIMIZE_CLICKS'} · {adGroups} ad groups
                      </p>
                    </div>
                    <Eye className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
                  </div>
                )
              })}
            </div>
          </div>

          {/* QA Score + stats */}
          {checks.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-8">
                {/* Circle gauge */}
                <div className="relative shrink-0">
                  <svg width="100" height="100" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
                    <circle
                      cx="50" cy="50" r={radius} fill="none"
                      stroke={scoreColor} strokeWidth="10"
                      strokeDasharray={`${dash} ${circ}`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                      style={{ transition: 'stroke-dasharray 0.5s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold" style={{ color: scoreColor }}>{score}</span>
                    <span className="text-[10px] text-gray-400">/ 100</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-sm font-bold text-emerald-700">{passCount}</span>
                    <span className="text-sm text-gray-500">Passed</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-sm font-bold text-amber-600">{warnCount}</span>
                    <span className="text-sm text-gray-500">Warnings</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <X className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-sm font-bold text-red-600">{failCount}</span>
                    <span className="text-sm text-gray-500">Failed</span>
                  </div>
                  <div className="pt-1">
                    <span className={cn(
                      'text-xs font-semibold px-2.5 py-1 rounded-full border',
                      failCount === 0 && warnCount === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      failCount === 0 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-red-50 text-red-700 border-red-200'
                    )}>
                      {failCount === 0 && warnCount === 0 ? '✓ QA ผ่านแล้ว' :
                       failCount === 0 ? '⚠ Review Required' : '✗ มีข้อผิดพลาด'}
                    </span>
                  </div>
                </div>
              </div>

              {/* ไปขั้นถัดไปเมื่อผ่าน */}
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {qaPassed ? 'QA ผ่านแล้ว — ไปรีวิวและ Approve ที่ขั้น Review & Draft' : failCount > 0 ? `แก้ไข ${failCount} ข้อที่ fail ก่อน` : 'กด Run QA เพื่อตรวจ'}
                </p>
                <button
                  onClick={onPass}
                  disabled={!qaPassed}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  ไปขั้น Review &amp; Draft
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {scanning && (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
              <span className="text-sm">กำลัง scan...</span>
            </div>
          )}

          {/* Policy Check — advisory ไม่ block push (โมดูลแยก) */}
          <PolicyCheckSection
            customerId={selectedAcct?.id}
            campaigns={selected.map(c => {
              const bp = blueprints[c.id]
              const allAds = (bp?.adGroups ?? []).flatMap(ag => ag.ads ?? [])
              const ags = bp?.assetGroups ?? []
              return {
                name: c.name,
                type: c.type,
                finalUrl: bp?.finalUrl,
                headlines: [
                  ...allAds.flatMap(ad => ad.rsa?.headlines ?? ad.display?.headlines ?? []),
                  ...ags.flatMap(ag => ag.headlines ?? []),
                ].filter(Boolean).slice(0, 15),
                descriptions: [
                  ...allAds.flatMap(ad => ad.rsa?.descriptions ?? ad.display?.descriptions ?? []),
                  ...ags.flatMap(ag => ag.descriptions ?? []),
                ].filter(Boolean).slice(0, 5),
                keywords: (c.keywords ?? []).filter(k => k.selected).map(k => k.keyword).slice(0, 30),
              }
            })}
          />

          {/* QA checks detail */}
          {!scanning && checks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">QA Checks ({totalChecks})</p>
              <div className="space-y-3">
                {grouped.map(({ campaign, checks: campaignChecks }) => (
                  <div key={campaign.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <TypeBadge type={campaign.type} />
                      <span className="text-sm font-semibold text-gray-700 truncate flex-1">{campaign.name}</span>
                      {campaignChecks.every(c => c.status === 'pass') && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {campaignChecks.some(c => c.status === 'fail') && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                          {campaignChecks.filter(c => c.status === 'fail').length} fail
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-gray-50">
                      {campaignChecks.map(check => (
                        <div key={check.id} className={cn(
                          'flex items-start gap-3 px-4 py-3',
                          check.status === 'fail' ? 'bg-red-50/40' : check.status === 'warn' ? 'bg-amber-50/40' : ''
                        )}>
                          <div className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                            check.status === 'pass' ? 'bg-emerald-500' : check.status === 'warn' ? 'bg-amber-400' : 'bg-red-500'
                          )}>
                            {check.status === 'pass' ? <Check className="w-3 h-3 text-white" /> :
                             check.status === 'warn' ? <AlertTriangle className="w-3 h-3 text-white" /> :
                             <X className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-700">{check.label}</p>
                            {editingId === check.id ? (
                              <div className="flex items-center gap-2 mt-1">
                                <input value={editValue} onChange={e => setEditValue(e.target.value)}
                                  className="flex-1 text-xs px-2 py-1 border border-blue-400 rounded-lg outline-none ring-1 ring-blue-200" />
                                <button onClick={() => setEditingId(null)} className="text-[10px] text-gray-500 hover:text-gray-700">ยกเลิก</button>
                                <button
                                  onClick={() => {
                                    const campId = check.id.replace(/-pipe$|-name$/, '')
                                    const camp = selected.find(c => c.id === campId)
                                    if (camp && onRename) {
                                      onRename(camp.id, editValue)
                                      const updatedItems = items.map(c => c.id === camp.id ? { ...c, name: editValue } : c)
                                      setEditingId(null)
                                      setTimeout(() => runQA(updatedItems), 50)
                                    } else { setEditingId(null); setTimeout(() => runQA(), 50) }
                                  }}
                                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                                >บันทึก & Scan ใหม่</button>
                              </div>
                            ) : <p className="text-xs text-gray-500 mt-0.5">{check.message}</p>}
                          </div>
                          {check.editable && check.status === 'fail' && editingId !== check.id && (
                            <button onClick={() => { setEditingId(check.id); setEditValue(check.fieldValue ?? '') }}
                              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 shrink-0">
                              <Edit3 className="w-3 h-3" /> แก้ไข
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

    </div>
  )
}

// ─── Step 9: Push ──────────────────────────────────────────────────────────────

function StepPush({
  items,
  blueprints,
  plan,
  status,
  saving,
  onSaveDraft,
  onComplete,
}: {
  items: CampaignStructureItem[]
  blueprints: Record<string, CampaignBlueprintItem>
  plan: MediaPlanRecord
  status: string
  saving: boolean
  onSaveDraft: () => void
  onComplete: () => void
}) {
  const selected = items.filter(c => c.selected)
  const totalMonthly = selected.reduce((s, c) => s + c.monthlyBudget, 0)
  // gate: รูปบังคับต่อ type ต้องครบก่อน push (Dry Run ก็สร้างแคมเปญจริง)
  // รูปแชร์ข้ามแคมเปญผ่าน pool — อัปโหลดครั้งเดียวใช้ได้ทุกแคมเปญใน push นี้
  const imgPool = buildImagePool(selected.map(c => blueprints[c.id]))
  const assetGapList = selected
    .map(c => ({ name: c.name, gaps: blueprintAssetGaps(c.type, blueprints[c.id] ? withPooledImages(c.type, blueprints[c.id], imgPool) : blueprints[c.id]) }))
    .filter(x => x.gaps.length > 0)
  const blockedByAssets = assetGapList.length > 0
  const [comment, setComment] = useState('')
  const [showFullExport, setShowFullExport] = useState(false)

  // Account selection
  const [accounts, setAccounts]           = useState<GadsAccount[]>([])
  const [loadingAccts, setLoadingAccts]   = useState(true)
  const [selectedAcct, setSelectedAcct]   = useState<GadsAccount | null>(null)

  // Push state
  const [pushing, setPushing]       = useState(false)
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string; campaigns?: { campaignName: string; status: string; error?: string; adsCreated?: number; warnings?: string[] }[] } | null>(null)
  const [pushError, setPushError]   = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const list: GadsAccount[] = (d.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
          currencyCode: a.currencyCode as string | undefined,
        }))
        setAccounts(list)
        // ห้าม auto-select account — เคยหลุด push ลงบัญชีลูกค้า (Villa Market) ต้องเลือกเองเสมอ
      })
      .catch(() => {/* silent */})
      .finally(() => setLoadingAccts(false))
  }, [])

  async function handlePush(mode: 'dry_run' | 'live') {
    if (!selectedAcct) return
    setPushing(true); setPushError(null); setPushResult(null); setShowConfirm(false)
    try {
      // Always use c.name as campaignName — blueprint may have been generated before a QA rename
      const toPush = selected
        .map(c => {
          const bp = blueprints[c.id]
          if (!bp) return null
          return withPlanAudiences(c, withPooledImages(c.type, { ...bp, campaignName: c.name }, imgPool))
        })
        .filter((c): c is CampaignBlueprintItem => !!c)
      const accountSettings = { currency: selectedAcct.currencyCode ?? 'THB', timeZone: 'Asia/Bangkok', autoTagging: true }

      // push "ทีละแคมเปญ" — 1 request/แคมเปญ กัน timeout บน serverless (Vercel)
      // account ไม่มี conversion tracking → retry แคมเปญนั้นด้วย Maximize Clicks อัตโนมัติ
      const pushOne = async (c: CampaignBlueprintItem, force: boolean, append: boolean) => {
        const body = force ? { ...c, bidStrategy: 'MAXIMIZE_CLICKS' } : c
        const res = await fetch(`/api/media-plans/${plan.id}/push-blueprint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: selectedAcct.id, mode, append, blueprintJson: { campaigns: [body], accountSettings, conversionActions: [] } }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Push failed')
        return data
      }
      const allResults: NonNullable<NonNullable<typeof pushResult>['campaigns']> = []
      let usedMaxClicks = false
      for (let i = 0; i < toPush.length; i++) {
        let data = await pushOne(toPush[i], false, i > 0)
        let camp = data.result?.campaigns?.[0]
        if (JSON.stringify(camp ?? data).includes('Conversion tracking is not enabled')) {
          usedMaxClicks = true
          data = await pushOne(toPush[i], true, true)
          camp = data.result?.campaigns?.[0]
        }
        if (camp) allResults.push(camp)
        // อัปเดตผลสดระหว่าง push ให้เห็นทีละแคมเปญ
        setPushResult({ success: false, message: `กำลัง push... ${i + 1}/${toPush.length}`, campaigns: [...allResults] })
      }
      const created = allResults.filter(c => c.status === 'success').length
      const success = allResults.length > 0 && allResults.every(c => c.status === 'success')
      setPushResult({
        success,
        message: (mode === 'dry_run' ? 'Dry run เสร็จแล้ว — ไม่มีการสร้าง campaign จริง' : `Push สำเร็จ — ${created}/${toPush.length} campaigns สร้างแล้ว`)
          + (usedMaxClicks ? ' · ⚠ account ไม่มี conversion tracking → ใช้ Maximize Clicks อัตโนมัติ' : ''),
        campaigns: allResults,
      })
      if (success && mode === 'live') onComplete()
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  function handleExportFull() {
    const html = buildExportHTML({ plan, items: selected, blueprints, includeAdCopy: true, comment })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Final-MediaPlan-${plan.brief?.businessName ?? 'Plan'}-${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Push to Google Ads</h2>
        <p className="text-sm text-gray-500 mt-0.5">ตรวจสอบสุดท้ายและ approve ก่อน push จริง</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Campaigns</p>
          <p className="text-2xl font-bold text-gray-900">{selected.length}</p>
        </div>
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Monthly Budget</p>
          <p className="text-2xl font-bold text-gray-900">฿{totalMonthly.toLocaleString()}</p>
        </div>
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Status</p>
          <p className="text-sm font-bold text-amber-600">PAUSED (safe)</p>
        </div>
      </div>

      {/* Campaign list with ad preview */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Campaign Summary & Ad Preview</p>
          <button
            onClick={() => setShowFullExport(!showFullExport)}
            className="flex items-center gap-1 text-xs text-blue-600"
          >
            <Eye className="w-3 h-3" />
            {showFullExport ? 'ซ่อน' : 'ดู'} Full Export Preview
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {selected.map(c => {
            const bp = blueprints[c.id]
            return (
              <div key={c.id} className="px-4 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <TypeBadge type={c.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.objective}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p className="font-semibold text-gray-800">฿{c.monthlyBudget.toLocaleString()}/เดือน</p>
                    <p>฿{c.dailyBudget.toLocaleString()}/วัน</p>
                  </div>
                </div>

                {/* Keyword summary */}
                {c.keywords && c.keywords.filter(k => k.selected).length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Keywords</p>
                    <div className="flex flex-wrap gap-1">
                      {c.keywords.filter(k => k.selected).slice(0, 10).map((kw, i) => (
                        <span key={i} className="text-[10px] bg-blue-50 border border-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          [{kw.matchType.charAt(0)}] {kw.keyword}
                        </span>
                      ))}
                      {c.keywords.filter(k => k.selected).length > 10 && (
                        <span className="text-[10px] text-gray-400">+{c.keywords.filter(k => k.selected).length - 10} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Audience summary */}
                {c.audiences && c.audiences.filter(a => a.selected).length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Audiences</p>
                    <div className="flex flex-wrap gap-1">
                      {c.audiences.filter(a => a.selected).map((aud, i) => (
                        <span key={i} className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full border',
                          aud.type === 'RLSA' ? 'bg-blue-50 border-blue-100 text-blue-700' :
                          aud.type === 'IN_MARKET' ? 'bg-green-50 border-green-100 text-green-700' :
                          'bg-purple-50 border-purple-100 text-purple-700'
                        )}>
                          {aud.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ad copy preview */}
                {bp?.adGroups && bp.adGroups.length > 0 && bp.adGroups[0].ads?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Ad Preview</p>
                    <div className="bg-white border border-gray-200 rounded-lg p-3 max-w-md">
                      <p className="text-[11px] text-green-700 mb-0.5">{c.keywords?.[0] ? `${plan.brief?.websiteUrl ?? 'www.example.com'}` : 'www.example.com'}</p>
                      <p className="text-sm font-semibold text-blue-800 leading-tight">
                        {bp.adGroups[0].ads[0]?.headline1 ?? 'Headline 1'} | {bp.adGroups[0].ads[0]?.headline2 ?? 'Headline 2'}
                      </p>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        {bp.adGroups[0].ads[0]?.description1 ?? 'Ad description goes here...'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Customer comment */}
      <div className="border border-gray-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          Comment / หมายเหตุ (สำหรับลูกค้า)
        </p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          placeholder="เพิ่ม comment หรือหมายเหตุสำหรับส่งให้ลูกค้า..."
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </div>

      {/* Account Selector */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Target className="w-4 h-4 text-blue-500" />
          Google Ads Account (CID)
        </p>
        {loadingAccts ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด accounts...
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            ไม่พบ Google Ads account — ตรวจสอบการเชื่อมต่อใน Integrations
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map(acct => (
              <label
                key={acct.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                  selectedAcct?.id === acct.id
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                )}
              >
                <input
                  type="radio"
                  name="account"
                  checked={selectedAcct?.id === acct.id}
                  onChange={() => setSelectedAcct(acct)}
                  className="w-4 h-4 text-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{acct.name}</p>
                  <p className="text-xs text-gray-500 font-mono">CID: {acct.id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}</p>
                </div>
                {acct.currencyCode && (
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{acct.currencyCode}</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Push result */}
      {pushResult && (
        <div className={cn('border rounded-xl p-4 space-y-3', pushResult.success ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className={cn('w-4 h-4', pushResult.success ? 'text-emerald-600' : 'text-amber-600')} />
            <p className={cn('text-sm font-semibold', pushResult.success ? 'text-emerald-800' : 'text-amber-800')}>{pushResult.message}</p>
          </div>
          {pushResult.campaigns && (
            <div className="space-y-1.5">
              {pushResult.campaigns.map((c, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', c.status === 'success' ? 'bg-emerald-500' : 'bg-red-400')} />
                    <span className="font-medium text-gray-800">{c.campaignName}</span>
                    <span className={c.status === 'success' ? 'text-emerald-600' : 'text-red-500'}>{c.status}{typeof c.adsCreated === 'number' ? ` · ${c.adsCreated} ads` : ''}</span>
                    {c.error && <span className="text-red-500 truncate">{c.error}</span>}
                  </div>
                  {(c.warnings ?? []).map((w, j) => (
                    <div key={j} className="ml-4 mt-0.5 text-amber-700">⚠ {w}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {pushError && (
        <div className="flex items-start gap-2 border border-red-200 bg-red-50 rounded-xl p-4 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{pushError}</span>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && selectedAcct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-base font-bold text-gray-900">ยืนยันการ Push จริง</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              <p className="text-sm font-semibold text-amber-800">Account ที่จะ push:</p>
              <p className="text-sm text-amber-900">{selectedAcct.name}</p>
              <p className="text-xs font-mono text-amber-700">CID: {selectedAcct.id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}</p>
            </div>
            <p className="text-sm text-gray-600">
              Campaign จะถูกสร้างใน <strong>PAUSED status</strong> — ไม่ใช้งบจริงทันที ตรวจสอบใน Google Ads ก่อน Enable
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handlePush('live')}
                disabled={pushing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors"
              >
                {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Push จริง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export + Action buttons */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          onClick={handleExportFull}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Export Full Report
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={onSaveDraft}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </button>
          <button
            onClick={() => handlePush('dry_run')}
            disabled={pushing || !selectedAcct || blockedByAssets}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg transition-colors"
          >
            {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Dry Run
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={pushing || !selectedAcct || status !== 'approved' || blockedByAssets}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            <Zap className="w-4 h-4" />
            Push to Google Ads
          </button>
        </div>
      </div>

      {status !== 'approved' && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          ต้องกด Approve ที่ขั้น <strong>Review &amp; Draft</strong> ก่อนถึงจะ Push ได้
        </div>
      )}

      {/* รูปบังคับไม่ครบ — บล็อกทั้ง Dry Run และ Push */}
      {blockedByAssets && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> รูปบังคับยังไม่ครบ — push ไม่ได้ (Google จะ reject)
          </p>
          {assetGapList.map(x => (
            <p key={x.name} className="text-xs text-red-700 ml-6">
              <strong>{x.name}</strong>: ขาด {x.gaps.join(', ')} — อัปโหลดใน Ad Copy step (ระบบ crop ให้อัตโนมัติ)
            </p>
          ))}
        </div>
      )}

      {/* ── GTM Tracking — ติดตั้ง tracking หลัง push ── */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-500" /> GTM Tracking (หลัง Push)
        </p>
        <GtmTrackingPanel plan={plan} />
      </div>
    </div>
  )
}

// ─── HTML Export Builder ────────────────────────────────────────────────────────

function buildExportHTML({
  plan,
  items,
  blueprints,
  includeAdCopy = false,
  comment = '',
}: {
  plan: MediaPlanRecord
  items: CampaignStructureItem[]
  blueprints?: Record<string, CampaignBlueprintItem>
  includeAdCopy?: boolean
  comment?: string
}): string {
  const b = plan.brief ?? {}
  const totalMonthly = items.reduce((s, c) => s + c.monthlyBudget, 0)
  const totalClicks  = items.reduce((s, c) => s + (c.forecast?.clicks ?? 0), 0)
  const date = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Media Plan — ${b.businessName ?? plan.title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1f2937; background: #f8fafc; padding: 24px; }
  .page { max-width: 900px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden; }
  .header { background: linear-gradient(135deg, #1d4ed8, #3b82f6); color: white; padding: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .header .sub { font-size: 13px; opacity: .8; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; padding: 24px; background: #f0f7ff; border-bottom: 1px solid #dbeafe; }
  .meta-item .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .meta-item strong { font-size: 14px; color: #1f2937; }
  .summary-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px 24px; border-bottom: 1px solid #e5e7eb; }
  .summary-kpi { text-align: center; }
  .summary-kpi .num { font-size: 24px; font-weight: 800; color: #1d4ed8; }
  .summary-kpi .label { font-size: 11px; color: #6b7280; }
  .campaigns { padding: 0 24px 24px; }
  .campaigns h2 { font-size: 14px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: .05em; margin: 24px 0 12px; }
  .campaign-block { border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .campaign-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
  .objective { padding: 8px 16px; font-size: 12px; color: #6b7280; border-bottom: 1px solid #f3f4f6; }
  .section { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
  .section:last-child { border-bottom: none; }
  .section h4 { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .badge-search { background: #dbeafe; color: #1d4ed8; }
  .badge-performance-max { background: #fed7aa; color: #c2410c; }
  .badge-display { background: #e9d5ff; color: #7c3aed; }
  .badge-video, .badge-youtube { background: #fce7f3; color: #be185d; }
  .badge-demand-gen { background: #ccfbf1; color: #0f766e; }
  .budget-tag { margin-left: auto; font-size: 12px; font-weight: 600; color: #059669; }
  .kw-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .kw-table th { text-align: left; padding: 4px 8px; background: #f9fafb; color: #9ca3af; font-weight: 600; text-transform: uppercase; font-size: 10px; }
  .kw-table td { padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
  .match-type { background: #f3f4f6; color: #374151; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
  .comp { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 20px; }
  .comp-low { background: #d1fae5; color: #065f46; }
  .comp-medium { background: #fef3c7; color: #92400e; }
  .comp-high { background: #fee2e2; color: #991b1b; }
  .aud-list { display: flex; flex-direction: column; gap: 6px; }
  .aud-item { display: flex; align-items: center; gap: 8px; }
  .aud-type { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 20px; background: #dbeafe; color: #1e40af; }
  .aud-type.aud-in_market { background: #dcfce7; color: #166534; }
  .aud-type.aud-custom_intent { background: #ede9fe; color: #5b21b6; }
  .aud-name { font-size: 12px; font-weight: 600; }
  .aud-desc { font-size: 11px; color: #6b7280; }
  .forecast-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .forecast-grid div { background: #f0f7ff; border-radius: 8px; padding: 10px; }
  .forecast-grid .label { display: block; font-size: 10px; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
  .forecast-grid strong { font-size: 14px; color: #1e40af; }
  .ad-preview { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; max-width: 480px; margin-bottom: 8px; }
  .ad-url { font-size: 11px; color: #166534; margin-bottom: 2px; }
  .ad-headline { font-size: 14px; color: #1d4ed8; font-weight: 600; margin-bottom: 4px; }
  .ad-desc { font-size: 12px; color: #374151; line-height: 1.5; }
  .comment-box { margin: 0 24px 24px; padding: 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; }
  .comment-box h4 { font-size: 12px; font-weight: 700; color: #92400e; margin-bottom: 8px; }
  .comment-box p { font-size: 13px; color: #374151; white-space: pre-wrap; }
  .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${plan.title}</h1>
    <div class="sub">${b.businessName ?? ''} — สร้างโดย Mercy &nbsp;|&nbsp; ${date}</div>
  </div>

  <div class="meta-grid">
    ${[
      { label: 'Business', value: b.businessName },
      { label: 'Product/Service', value: b.productService },
      { label: 'Objective', value: plan.objective ?? b.objective },
      { label: 'Location', value: b.targetLocation },
      { label: 'Language', value: b.language },
      { label: 'Website', value: b.websiteUrl },
    ].filter(f => f.value).map(f => `
    <div class="meta-item">
      <div class="label">${f.label}</div>
      <strong>${f.value}</strong>
    </div>`).join('')}
  </div>

  <div class="summary-bar">
    <div class="summary-kpi">
      <div class="num">${items.length}</div>
      <div class="label">Campaigns</div>
    </div>
    <div class="summary-kpi">
      <div class="num">฿${totalMonthly.toLocaleString()}</div>
      <div class="label">Total Budget / Month</div>
    </div>
    <div class="summary-kpi">
      <div class="num">${totalClicks.toLocaleString()}</div>
      <div class="label">Est. Clicks / Month</div>
    </div>
  </div>

  ${comment ? `
  <div class="comment-box">
    <h4>Comment / หมายเหตุ</h4>
    <p>${comment}</p>
  </div>` : ''}

  <div class="footer">สร้างโดย Mercy — Convert Cake &nbsp;|&nbsp; ${date} &nbsp;|&nbsp; เอกสารนี้เป็นความลับ ห้ามเผยแพร่</div>
</div>
</body>
</html>`
}

// ─── Helper functions ──────────────────────────────────────────────────────────

function makeEmptyBlueprint(c: CampaignStructureItem): CampaignBlueprintItem {
  const type = c.type
  const isSearch  = type === 'SEARCH'
  const isPmax    = type === 'PERFORMANCE_MAX'
  const isDisplay = type === 'DISPLAY' || type === 'DEMAND_GEN'

  const emptyAdGroup = {
    adGroupName: 'Ad Group 1',
    defaultBid: 0,
    keywords: [],
    matchTypes: [],
    ads: [],
  }

  return {
    campaignName: c.name,
    campaignType: type,
    status: 'PAUSED',
    budget: c.dailyBudget,
    bidStrategy: 'MAXIMIZE_CLICKS',
    targetCPA: 0,
    locationTargets: ['Thailand'],
    languageTargets: ['th'],
    adGroups: (isSearch || isDisplay) ? [emptyAdGroup] : [],
    assetGroups: isPmax
      ? [{
          assetGroupName: 'Asset Group 1',
          headlines: ['', '', ''],
          longHeadlines: [''],
          descriptions: ['', ''],
          businessName: '',
          finalUrl: '',
          imageAssets: [],
        }]
      : undefined,
    sitelinks: [],
    callouts: [],
    structuredSnippets: [],
    phoneNumbers: [],
  }
}

// Asset Extensions editor — sitelinks / callouts / structured snippets ของ blueprint
// (ของที่จะถูก push จริงไป Google Ads) แก้ได้ตรงนี้เลยในขั้น Ad Copy
function ExtensionsEditor({ bp, onChange }: { bp: CampaignBlueprintItem; onChange: (b: CampaignBlueprintItem) => void }) {
  const [newCallout, setNewCallout] = useState('')
  const [newValue, setNewValue] = useState('')
  const sitelinks = bp.sitelinks ?? []
  const callouts = bp.callouts ?? []
  const snippet = bp.structuredSnippets?.[0]

  const upSitelink = (i: number, patch: Partial<NonNullable<CampaignBlueprintItem['sitelinks']>[0]>) =>
    onChange({ ...bp, sitelinks: sitelinks.map((x, j) => j === i ? { ...x, ...patch } : x) })
  const setSnippet = (patch: { header?: string; values?: string[] }) =>
    onChange({ ...bp, structuredSnippets: [{ header: snippet?.header ?? '', values: snippet?.values ?? [], ...patch }] })

  const counter = (n: number, target: number) => (
    <span className={`ml-1.5 text-[10px] font-bold ${n >= target ? 'text-emerald-600' : 'text-amber-500'}`}>{n}/{target}</span>
  )

  return (
    <div className="mt-4 border border-gray-200 rounded-2xl p-4 space-y-4 bg-white">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Asset Extensions — จะถูก push ไป Google Ads พร้อมแคมเปญ</p>

      {/* Sitelinks */}
      <div>
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Sitelinks{counter(sitelinks.filter(x => x.text?.trim()).length, 4)} <span className="text-gray-400 font-normal">· text ≤25 · desc ≤35</span></p>
        <div className="space-y-2">
          {sitelinks.map((sl, i) => (
            <div key={i} className="rounded-xl border border-gray-100 p-2 space-y-1.5">
              <div className="flex gap-2">
                <input value={sl.text} onChange={e => upSitelink(i, { text: e.target.value })} placeholder="ข้อความลิงก์"
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
                <input value={sl.finalUrl} onChange={e => upSitelink(i, { finalUrl: e.target.value })} placeholder="https://..."
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-200" />
                <button onClick={() => onChange({ ...bp, sitelinks: sitelinks.filter((_, j) => j !== i) })}
                  className="text-gray-300 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex gap-2">
                <input value={sl.description1} onChange={e => upSitelink(i, { description1: e.target.value })} placeholder="คำอธิบาย 1"
                  className="flex-1 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
                <input value={sl.description2} onChange={e => upSitelink(i, { description2: e.target.value })} placeholder="คำอธิบาย 2"
                  className="flex-1 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
              </div>
            </div>
          ))}
          <button onClick={() => onChange({ ...bp, sitelinks: [...sitelinks, { text: '', description1: '', description2: '', finalUrl: bp.finalUrl ?? '' }] })}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
            <Plus className="w-3 h-3" />เพิ่ม Sitelink
          </button>
        </div>
      </div>

      {/* Callouts */}
      <div>
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Callouts{counter(callouts.length, 4)} <span className="text-gray-400 font-normal">· ≤25 ตัว/อัน</span></p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {callouts.map((cText, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-full px-2.5 py-1 text-xs font-medium">
              {cText}
              <button onClick={() => onChange({ ...bp, callouts: callouts.filter((_, j) => j !== i) })} className="opacity-60 hover:opacity-100"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newCallout} onChange={e => setNewCallout(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newCallout.trim()) { onChange({ ...bp, callouts: [...callouts, newCallout.trim().slice(0, 25)] }); setNewCallout('') } }}
            placeholder="เช่น ปรึกษาฟรี แล้วกด Enter" maxLength={25}
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
        </div>
      </div>

      {/* Structured Snippet */}
      <div>
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Structured Snippet{counter((snippet?.values ?? []).length, 3)} <span className="text-gray-400 font-normal">· header + ค่า ≥3</span></p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={snippet?.header ?? ''} onChange={e => setSnippet({ header: e.target.value })}
            placeholder="Header เช่น บริการ" className="w-36 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
          {(snippet?.values ?? []).map((v, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 rounded-full px-2.5 py-1 text-xs font-medium">
              {v}
              <button onClick={() => setSnippet({ values: (snippet?.values ?? []).filter((_, j) => j !== i) })} className="opacity-60 hover:opacity-100"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
          <input value={newValue} onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newValue.trim()) { setSnippet({ values: [...(snippet?.values ?? []), newValue.trim()] }); setNewValue('') } }}
            placeholder="เพิ่มค่า + Enter"
            className="w-32 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200" />
        </div>
      </div>
    </div>
  )
}

function fromMixItem(c: CampaignMixItem, idx: number, totalBudget?: number): CampaignStructureItem {
  // Use the exact monthlyBudget saved on the plan (All Plans) as the source of truth.
  // Deriving from the rounded budgetPercent loses precision (e.g. ฿4,000 → 67% → ฿4,020),
  // so only fall back to percent × total when no explicit budget is stored.
  let monthly: number
  if (c.monthlyBudget && c.monthlyBudget > 0) {
    monthly = c.monthlyBudget
  } else if (totalBudget && totalBudget > 0 && c.budgetPercent > 0) {
    monthly = Math.round(totalBudget * c.budgetPercent / 100)
  } else {
    monthly = (c.dailyBudget ?? 0) * 30
  }
  const daily = c.dailyBudget && c.dailyBudget > 0 ? c.dailyBudget : Math.round(monthly / 30)

  // Pull keyword/audience data straight from the saved plan (All Plans) so the
  // Research/Audience steps are pre-filled and the user doesn't have to redo them.
  const keywords: KeywordResult[] = (c.keywords ?? []).map(k => ({
    keyword: k.keyword, matchType: k.matchType,
    avgMonthlySearches: k.avgMonthlySearches, competition: k.competition,
    suggestedCpc: k.suggestedCpc, selected: k.selected ?? true,
  }))
  const searchThemes = c.searchThemes ?? []
  const audienceCount = (c.remarketing?.length ?? 0) + (c.inMarket?.length ?? 0) + (c.customIntent?.length ?? 0)

  // Map the plan's audience data into the shapes the Audience step actually renders:
  // PMax → pmaxSignal.audienceSignals · Display/Remarketing/DemandGen → audiences[]
  const isPmaxType = c.type === 'PERFORMANCE_MAX'
  const pmaxSignal = isPmaxType && (audienceCount > 0 || searchThemes.length > 0)
    ? {
        campaignName: c.campaignName,
        audienceSignals: {
          customIntent: c.customIntent ?? [],
          searchThemes,
          customerList: [],
          remarketing:  c.remarketing ?? [],
          inMarket:     c.inMarket ?? [],
          demographics: {},
        },
        assetSuggestions: { headlines: [], descriptions: [], imageThemes: [] },
      } as import('@/types').PMaxSignal
    : undefined
  // Remarketing campaign (ดูจากชื่อ) = remarketing list เท่านั้น — ห้ามปน In-Market/Custom Intent
  const isRemarketingCamp = /remarket|rtg|retention/i.test(c.campaignName)
  const audiences: AudienceSegment[] | undefined = !isPmaxType && audienceCount > 0
    ? (isRemarketingCamp
        ? (c.remarketing ?? []).map((n) => ({ name: n, type: 'RLSA' as const, description: 'จาก Media Plan', selected: true }))
        : [
            ...(c.remarketing ?? []).map((n) => ({ name: n, type: 'RLSA' as const, description: 'จาก Media Plan', selected: true })),
            ...(c.inMarket ?? []).map((n) => ({ name: n, type: 'IN_MARKET' as const, description: 'จาก Media Plan', selected: true })),
            ...(c.customIntent ?? []).map((n) => ({ name: n, type: 'CUSTOM_INTENT' as const, description: 'จาก Media Plan', selected: true })),
          ])
    : undefined

  return {
    id: String(idx),
    type: c.type,
    theme: c.theme,
    name: c.campaignName,
    objective: c.objective,
    recommendedPct: c.budgetPercent || Math.round(100 / 3),
    selected: true,
    researchDone: keywords.length > 0 || searchThemes.length > 0,
    audienceDone: audienceCount > 0 || searchThemes.length > 0,
    dailyBudget: daily,
    monthlyBudget: monthly,
    keywords,
    searchThemes,
    pmaxSignal,
    audiences,
    forecast: estimateForecast(monthly, keywords, c.type),
  }
}

// Estimate a campaign forecast from the plan's budget + keyword data so exports and
// the Media Plan step always carry real numbers (instead of 0) even when the user
// didn't run the live research step.
function estimateForecast(monthly: number, keywords: KeywordResult[], type: CampaignMixItem['type']): Forecast {
  const totalVol = keywords.reduce((s, k) => s + (k.avgMonthlySearches ?? 0), 0)
  const avgCpc = keywords.length
    ? keywords.reduce((s, k) => s + (k.suggestedCpc ?? 0), 0) / keywords.length
    : 0

  if (totalVol > 0) {
    const clicks = Math.round(totalVol * 0.035)
    const cpc = avgCpc > 0 ? avgCpc : (clicks > 0 ? Math.round(monthly / clicks) : 0)
    return { impressions: totalVol, clicks, ctr: 3.5, cpc, cost: Math.min(monthly, Math.round(clicks * cpc)) || monthly }
  }

  // No search-volume data — estimate from budget and a typical CPC/CTR per channel.
  const cpc = avgCpc > 0 ? avgCpc : (type === 'SEARCH' ? 15 : 5)
  const ctr = type === 'SEARCH' ? 4 : 0.7
  const clicks = cpc > 0 ? Math.round(monthly / cpc) : 0
  const impressions = ctr > 0 ? Math.round(clicks / (ctr / 100)) : 0
  return { impressions, clicks, ctr, cpc, cost: monthly }
}

// ─── Main page ──────────────────────────────────────────────────────────────────

interface Props {
  params: { id: string }
}

export default function MediaPlanBuildPage({ params }: Props) {
  const router = useRouter()
  const planId = params.id

  const [plan, setPlan]       = useState<MediaPlanRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [step, setStep]             = useState<BuildStep>('brief')
  const [items, setItems]           = useState<CampaignStructureItem[]>([])
  const [blueprints, setBlueprints] = useState<Record<string, CampaignBlueprintItem>>({})
  const [saving, setSaving]         = useState(false)
  const [autoResearch, setAutoResearch] = useState(false)
  const [hydrated, setHydrated]     = useState(false)
  const [savedMsg, setSavedMsg]     = useState<string | null>(null)

  const STORAGE_KEY = `media-plan-build-${planId}`

  // ── Load plan + restore persisted progress ────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/media-plans/${planId}`)
        if (!res.ok) {
          if (res.status === 404) { router.replace('/media-plans'); return }
          throw new Error('Failed to fetch')
        }
        const data: MediaPlanRecord = await res.json()
        setPlan(data)

        const parsed: MediaPlanJson = JSON.parse(data.planJson)
        // Normalize budgetPercent so campaigns always sum to 100% before mapping
        const totalPct = parsed.campaignMix.reduce((s, c) => s + (c.budgetPercent || 0), 0)
        const normalizedMix = totalPct > 0 && Math.abs(totalPct - 100) > 1
          ? parsed.campaignMix.map(c => ({ ...c, budgetPercent: Math.round(c.budgetPercent / totalPct * 100) }))
          : parsed.campaignMix
        const freshItems = normalizedMix.map((c, i) => fromMixItem(c, i, data.monthlyBudget))

        // Merge keyword/audience data from strategyJson (saved in New Plan step 5)
        if (data.strategyJson) {
          try {
            const strategy: MediaPlanStrategyRecord = JSON.parse(data.strategyJson)
            const cs = strategy.campaignStructure
            if (cs) {
              // Build lookup by campaign name → strategy data
              const searchMap = new Map((cs.search ?? []).map(c => [c.name, c]))
              const pmaxMap   = new Map((cs.pmax ?? []).map(c => [c.name, c]))
              const remMap    = new Map((cs.remarketing ?? []).map(c => [c.name, c]))

              freshItems.forEach(item => {
                if (item.type === 'SEARCH') {
                  const sc = searchMap.get(item.name)
                  // Only fall back to strategy keywordThemes when the plan's campaignMix
                  // didn't already supply keywords (campaignMix data is richer).
                  if ((item.keywords?.length ?? 0) === 0 && sc?.keywordThemes && sc.keywordThemes.length > 0) {
                    item.keywords = sc.keywordThemes.map(kw => ({
                      keyword: kw,
                      avgMonthlySearches: 0,
                      competition: 'MEDIUM' as const,
                      suggestedCpc: 0,
                      matchType: 'BROAD' as const,
                      selected: true,
                    }))
                    item.researchDone = true
                  }
                } else if (item.type === 'PERFORMANCE_MAX') {
                  const pc = pmaxMap.get(item.name)
                  // campaignMix (fromMixItem) ให้ signal เต็มชุด (remarketing/inMarket/customIntent/themes)
                  // — strategyJson มีแค่ label กว้างๆ ใช้เป็น fallback เท่านั้น ห้ามเขียนทับ
                  if (!item.pmaxSignal && pc?.audienceSignals && pc.audienceSignals.length > 0) {
                    item.pmaxSignal = {
                      campaignName: item.name,
                      audienceSignals: {
                        customIntent: pc.audienceSignals,
                        searchThemes: [],
                        customerList: [],
                        remarketing: [],
                        inMarket: [],
                        demographics: {},
                      },
                      assetSuggestions: {
                        headlines: [],
                        descriptions: [],
                        imageThemes: [],
                      },
                    }
                    item.audienceDone = true
                  }
                } else if (item.type === 'DISPLAY' || item.type === 'DEMAND_GEN') {
                  const rc = remMap.get(item.name)
                  if ((item.audiences?.length ?? 0) === 0 && rc?.audience) {
                    item.audiences = [{
                      name: rc.audience,
                      type: 'RLSA',
                      description: rc.audience,
                      selected: true,
                    }]
                    item.audienceDone = true
                  }
                }
              })
            }
          } catch { /* strategyJson parse error — fall through */ }
        }

        // Restore persisted progress from localStorage
        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) {
            const { step: savedStep, items: savedItems, blueprints: savedBlueprints } = JSON.parse(saved) as {
              step?: BuildStep
              items?: CampaignStructureItem[]
              blueprints?: Record<string, CampaignBlueprintItem>
            }
            // Merge saved progress into fresh items (preserve campaign structure from API, restore progress fields)
            const merged = freshItems.map(fresh => {
              const prior = savedItems?.find(s => s.id === fresh.id || s.name === fresh.name)
              if (!prior) return fresh
              // The plan (All Plans) is the source of truth for budget + keyword/audience
              // research. Prefer fresh plan data; fall back to in-session localStorage only
              // when the plan didn't supply it — so users never have to redo research.
              const freshKw = fresh.keywords ?? []
              const freshThemes = fresh.searchThemes ?? []
              return {
                ...fresh,
                selected: prior.selected,
                keywords: freshKw.length > 0 ? freshKw : (prior.keywords ?? []),
                searchThemes: freshThemes.length > 0 ? freshThemes : (prior.searchThemes ?? []),
                pmaxSignal: fresh.pmaxSignal ?? prior.pmaxSignal,
                audiences: (fresh.audiences?.length ? fresh.audiences : prior.audiences),
                researchDone: fresh.researchDone || prior.researchDone,
                audienceDone: fresh.audienceDone || prior.audienceDone,
                forecast: prior.forecast ?? fresh.forecast,
              }
            })
            setItems(merged)
            if (savedStep) setStep(savedStep)
            const bps: Record<string, CampaignBlueprintItem> = {}
            merged.forEach(c => { bps[c.id] = savedBlueprints?.[c.id] ?? makeEmptyBlueprint(c) })
            setBlueprints(bps)
            setHydrated(true)
            return
          }
        } catch { /* localStorage unavailable or corrupt — fall through */ }

        setItems(freshItems)
        const bps: Record<string, CampaignBlueprintItem> = {}
        freshItems.forEach(c => { bps[c.id] = makeEmptyBlueprint(c) })
        setBlueprints(bps)
        setHydrated(true)
      } catch {
        setError('ไม่สามารถโหลดข้อมูลได้')
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, router])

  // ── Persist progress to localStorage whenever key state changes ───────────────
  useEffect(() => {
    if (!hydrated || items.length === 0) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, items, blueprints }))
    } catch { /* quota exceeded or unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, items, blueprints, hydrated])

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleToggle = useCallback((id: string) => {
    setItems(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected } : c))
  }, [])

  const handleUpdate = useCallback((id: string, patch: Partial<CampaignStructureItem>) => {
    setItems(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const handleAdd = useCallback((item: CampaignStructureItem) => {
    setItems(prev => [...prev, item])
    setBlueprints(prev => ({ ...prev, [item.id]: makeEmptyBlueprint(item) }))
  }, [])

  const handleRemove = useCallback((id: string) => {
    setItems(prev => prev.filter(c => c.id !== id))
    setBlueprints(prev => { const next = { ...prev }; delete next[id]; return next })
  }, [])

  const handleKeywordToggle = useCallback((campaignId: string, kwIdx: number) => {
    setItems(prev => prev.map(c => {
      if (c.id !== campaignId || !c.keywords) return c
      return { ...c, keywords: c.keywords.map((k, i) => i === kwIdx ? { ...k, selected: !k.selected } : k) }
    }))
  }, [])

  const handleAudienceToggle = useCallback((campaignId: string, audIdx: number) => {
    setItems(prev => prev.map(c => {
      if (c.id !== campaignId || !c.audiences) return c
      return { ...c, audiences: c.audiences.map((a, i) => i === audIdx ? { ...a, selected: !a.selected } : a) }
    }))
  }, [])

  const handleResearchLoad = useCallback((id: string, data: Partial<CampaignStructureItem>) => {
    setItems(prev => prev.map(c => c.id === id ? { ...c, ...data } : c))
  }, [])

  const handleDailyChange = useCallback((id: string, daily: number) => {
    setItems(prev => prev.map(c => c.id === id
      ? { ...c, dailyBudget: daily, monthlyBudget: daily * 30 }
      : c
    ))
  }, [])

  const handleBlueprintChange = useCallback((id: string, updated: CampaignBlueprintItem) => {
    setBlueprints(prev => ({ ...prev, [id]: updated }))
  }, [])

  function goToStep(s: BuildStep) {
    // Auto-save progress (fire-and-forget) every time user advances a step
    if (plan) {
      try {
        const planJson = buildUpdatedPlanJson()
        fetch(`/api/media-plans/${planId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: plan.status === 'approved' ? 'approved' : 'draft', planJson }),
        }).catch(() => {})
      } catch { /* ignore build errors during auto-save */ }
    }
    setStep(s)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    window.location.reload()
  }

  function handleStructureNext() {
    setAutoResearch(true)
    goToStep('research')
  }

  function buildUpdatedPlanJson(): string {
    const existingJson: MediaPlanJson = JSON.parse(plan!.planJson)
    const updatedJson: MediaPlanJson = {
      ...existingJson,
      campaignMix: items.filter(c => c.selected).map(c => {
        const existing = existingJson.campaignMix.find(m => m.campaignName === c.name) ?? existingJson.campaignMix[0]
        return {
          ...(existing ?? {}),
          campaignName: c.name,
          type: c.type,
          theme: c.theme,
          objective: c.objective,
          budgetPercent: c.recommendedPct,
          monthlyBudget: c.monthlyBudget,
          dailyBudget: c.dailyBudget,
          targetCPA: existing?.targetCPA ?? 0,
          expectedClicks: c.forecast?.clicks ?? existing?.expectedClicks ?? 0,
          expectedImpressions: c.forecast?.impressions ?? existing?.expectedImpressions ?? 0,
          expectedConversions: existing?.expectedConversions ?? 0,
          bidStrategy: existing?.bidStrategy ?? 'MAXIMIZE_CLICKS',
          networks: existing?.networks ?? [],
          targeting: existing?.targeting ?? { locations: ['Thailand'], languages: ['th'], devices: [] },
          keywords: (c.keywords ?? existing?.keywords ?? []).filter((k: KeywordResult) => k.selected).map((k: KeywordResult) => ({
            keyword: k.keyword, matchType: k.matchType,
            avgMonthlySearches: k.avgMonthlySearches, competition: k.competition,
            suggestedCpc: k.suggestedCpc, selected: true,
          })),
          searchThemes: existing?.searchThemes ?? [],
          remarketing: existing?.remarketing ?? [],
          inMarket: existing?.inMarket ?? [],
          customIntent: existing?.customIntent ?? [],
        } as CampaignMixItem
      }),
    }
    return JSON.stringify(updatedJson)
  }

  // Save without leaving the Campaign Generator — the user stays on this page and
  // gets an inline confirmation (with an opt-in link to All Plans) instead of being
  // bounced away, which was confusing.
  async function savePlan(newStatus?: string) {
    if (!plan) return
    setSaving(true); setSavedMsg(null)
    try {
      const status = newStatus ?? plan.status
      const planJson = buildUpdatedPlanJson()
      const res = await fetch(`/api/media-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, planJson }),
      })
      if (!res.ok) throw new Error('save failed')
      setPlan(p => p ? { ...p, status } : p)
      setSavedMsg(newStatus === 'approved' ? 'อนุมัติแผนแล้ว — บันทึกในระบบเรียบร้อย' : 'บันทึก draft แล้ว')
    } catch { setSavedMsg('บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง') }
    finally { setSaving(false) }
  }

  async function completePlan() {
    if (!plan) return
    setSaving(true); setSavedMsg(null)
    try {
      const planJson = buildUpdatedPlanJson()
      const res = await fetch(`/api/media-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', planJson }),
      })
      if (!res.ok) throw new Error('save failed')
      setPlan(p => p ? { ...p, status: 'active' } : p)
      setSavedMsg('🎉 เสร็จสมบูรณ์ — แผนถูกบันทึกและพร้อมใช้งานแล้ว')
    } catch { setSavedMsg('บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง') }
    finally { setSaving(false) }
  }

  // ─── Render ────────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <p className="text-red-500">{error}</p>
        </div>
      </AppShell>
    )
  }

  if (loading || !plan) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  const currentStepIdx = STEPS.findIndex(s => s.key === step)

  return (
    <AppShell>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/campaign-generator" className="hover:text-gray-700">Campaign Generator</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 font-medium truncate max-w-xs">{plan.title}</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campaign Generator</h1>
        <p className="text-gray-500 mt-1">{plan.title} — ฿{plan.monthlyBudget.toLocaleString()}/เดือน</p>
      </div>

      <StepProgressBar current={step} onGoTo={goToStep} />

      {savedMsg && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="text-sm font-semibold text-emerald-800 flex-1">{savedMsg}</span>
          <Link href="/media-plans" className="text-xs font-semibold text-emerald-700 underline hover:text-emerald-900 whitespace-nowrap">
            ดูใน All Plans →
          </Link>
          <button onClick={() => setSavedMsg(null)} className="text-emerald-400 hover:text-emerald-700 text-sm leading-none" aria-label="ปิด">✕</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        {step === 'brief' && (
          <StepBrief plan={plan} onNext={() => goToStep('structure')} />
        )}

        {step === 'structure' && (
          <StepStructure
            items={items}
            totalBudget={plan.monthlyBudget}
            onToggle={handleToggle}
            onUpdate={handleUpdate}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onNext={handleStructureNext}
          />
        )}

        {step === 'research' && (
          <StepResearch
            items={items}
            brief={plan.brief}
            totalBudget={plan.monthlyBudget}
            onResearchLoad={handleResearchLoad}
            onKeywordToggle={handleKeywordToggle}
            onNext={() => goToStep('audience')}
            autoStarted={autoResearch}
          />
        )}

        {step === 'audience' && (
          <StepAudience
            items={items}
            plan={plan}
            onResearchLoad={handleResearchLoad}
            onAudienceToggle={handleAudienceToggle}
            onNext={() => goToStep('mediaplan')}
          />
        )}

        {step === 'mediaplan' && (
          <StepMediaPlan
            items={items}
            totalBudget={plan.monthlyBudget}
            plan={plan}
            onDailyChange={handleDailyChange}
            onNext={() => goToStep('adcopy')}
          />
        )}

        {step === 'adcopy' && (
          <StepAdCopy
            items={items}
            blueprints={blueprints}
            plan={plan}
            onBlueprintChange={handleBlueprintChange}
            onNext={() => goToStep('qa')}
          />
        )}

        {step === 'qa' && (
          <StepQA
            items={items}
            blueprints={blueprints}
            plan={plan}
            onPass={() => goToStep('review')}
            onRename={(id, newName) => setItems(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c))}
          />
        )}

        {step === 'review' && (
          <StepReview
            items={items}
            blueprints={blueprints}
            plan={plan}
            status={plan.status}
            saving={saving}
            onApprove={() => savePlan('approved')}
            onNext={() => goToStep('push')}
          />
        )}

        {step === 'push' && (
          <StepPush
            items={items}
            blueprints={blueprints}
            plan={plan}
            status={plan.status}
            saving={saving}
            onSaveDraft={() => savePlan('draft')}
            onComplete={completePlan}
          />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        {step !== 'brief' ? (
          <button
            onClick={() => {
              if (currentStepIdx > 0) goToStep(STEPS[currentStepIdx - 1].key)
            }}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            ← ย้อนกลับ
          </button>
        ) : <div />}
        <button
          onClick={() => {
            if (window.confirm('ล้างข้อมูลทั้งหมดและเริ่มใหม่ตั้งแต่ต้น?')) clearProgress()
          }}
          className="text-xs text-gray-300 hover:text-red-400 transition-colors"
        >
          เริ่มใหม่
        </button>
      </div>
    </AppShell>
  )
}
