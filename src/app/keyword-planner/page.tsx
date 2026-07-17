'use client'

import React, { useState, useRef, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import {
  Search, Sparkles, Download, Copy, CheckCircle2, RefreshCw,
  ChevronDown, Plus, X, FileDown, Trash2, Check, TrendingUp,
  MousePointerClick, Eye, Wallet, BarChart3, Zap, ArrowLeft,
  Target, AlertTriangle, Users, ThumbsUp, ThumbsDown, Info, Building2,
  Smartphone, Monitor, Tablet, Loader2,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'
import type { ResearchKeyword as BaseResearchKeyword } from '@/app/api/keyword-research/generate/route'

// Standalone planner extends the shared type with 'negative' group (local-only)
type ResearchKeyword = Omit<BaseResearchKeyword, 'group'> & {
  group: BaseResearchKeyword['group'] | 'negative'
}
import type { MarketAnalysis, CompetitorInfo } from '@/app/api/keyword-research/analyze/route'

// ── Types & Constants ─────────────────────────────────────────────────────────

type Group = 'all' | 'brand' | 'product' | 'service' | 'generic' | 'competitor' | 'negative'

const GROUP_LABELS: Record<Group, string> = {
  all:       'ทั้งหมด',
  brand:     'Brand',
  product:   'Product',
  service:   'Service',
  generic:   'Generic',
  competitor:'Competitor',
  negative:  'Negative',
}

const GROUP_COLORS: Record<string, string> = {
  brand:     'bg-blue-100 text-blue-700',
  product:   'bg-emerald-100 text-emerald-700',
  service:   'bg-violet-100 text-violet-700',
  generic:   'bg-yellow-100 text-yellow-700',
  competitor:'bg-purple-100 text-purple-700',
  negative:  'bg-red-100 text-red-600',
}

const MATCH_COLORS: Record<string, string> = {
  PHRASE: 'bg-blue-50 text-blue-600',
  BROAD:  'bg-orange-50 text-orange-600',
  EXACT:  'bg-red-50 text-red-500',  // should not appear — shown in red as warning
}

const COMP_COLORS: Record<string, string> = {
  LOW:    'text-emerald-600',
  MEDIUM: 'text-yellow-600',
  HIGH:   'text-red-500',
}

const VOLUME_COLORS: Record<string, string> = {
  'สูง':  'text-emerald-600 font-medium',
  'กลาง': 'text-yellow-600',
  'ต่ำ':  'text-gray-400',
}

// Format search volume as Google Ads Keyword Planner range buckets
function fmtVolume(n: number): string {
  if (n === 0)         return '0'
  if (n < 10)          return '< 10'
  if (n < 100)         return '10–100'
  if (n < 1000)        return '100–1K'
  if (n < 10_000)      return `${Math.round(n/1000)}K`
  if (n < 100_000)     return `${Math.round(n/1000)}K`
  if (n < 1_000_000)   return `${Math.round(n/1000)}K`
  return `${(n/1_000_000).toFixed(1)}M`
}

// ── Export helpers ────────────────────────────────────────────────────────────

function toCSV(keywords: ResearchKeyword[], businessName: string): string {
  const header = 'Keyword,Match Type,กลุ่ม,Intent,Volume,Competition,CPC ประมาณ (฿)'
  const rows = keywords
    .filter((k) => k.selected && k.group !== 'negative')
    .map((k) => `"${k.keyword}","${k.matchType}","${GROUP_LABELS[k.group as Group] ?? k.group}","${k.intent}","${k.volume}","${k.competition}","${k.cpcEst}"`)
  const negRows = keywords
    .filter((k) => k.selected && k.group === 'negative')
    .map((k) => `"${k.keyword}","${k.matchType}","Negative","","","","0"`)
  return [
    `"Keyword Research — ${businessName}"`,
    `"Export Date: ${new Date().toLocaleDateString('th-TH')}"`,
    '',
    header,
    ...rows,
    '',
    '"=== Negative Keywords ==="',
    ...negRows,
  ].join('\n')
}

function toClipboard(keywords: ResearchKeyword[]): string {
  const selected = keywords.filter((k) => k.selected && k.group !== 'negative')
  const negatives = keywords.filter((k) => k.selected && k.group === 'negative')

  const groups: Partial<Record<Group, ResearchKeyword[]>> = {}
  for (const k of selected) {
    const g = k.group as Group
    if (!groups[g]) groups[g] = []
    groups[g]!.push(k)
  }

  const lines: string[] = []
  for (const [group, kws] of Object.entries(groups)) {
    lines.push(`=== ${GROUP_LABELS[group as Group] ?? group} ===`)
    for (const k of kws!) {
      lines.push(`[${k.matchType}] ${k.keyword}`)
    }
    lines.push('')
  }

  if (negatives.length > 0) {
    lines.push('=== Negative Keywords ===')
    for (const k of negatives) lines.push(`-${k.keyword}`)
  }

  return lines.join('\n')
}

// ── Main page ─────────────────────────────────────────────────────────────────

function KeywordPlannerContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sourcePlanId   = searchParams.get('planId')
  const sourceCampaign = searchParams.get('campaign') // campaign name passed from media plan

  // Account state
  interface KwAccount { id: string; descriptiveName: string }
  const [accounts,    setAccounts]    = useState<KwAccount[]>([])
  const [selectedCid, setSelectedCid] = useState('')

  // Form state
  const [businessName,   setBusinessName]   = useState('')
  const [productService, setProductService] = useState(sourceCampaign ?? '')
  const [location,       setLocation]       = useState('กรุงเทพมหานคร')
  const [objective,      setObjective]      = useState('leads')
  const [competitors,    setCompetitors]    = useState('')

  // Results state
  const [keywords,      setKeywords]      = useState<ResearchKeyword[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [dataMeta,      setDataMeta]      = useState<{ realCount: number; total: number; source: string } | null>(null)
  const [analysis,      setAnalysis]      = useState<MarketAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [activeTab,     setActiveTab]     = useState<Group>('all')
  const [copied,    setCopied]    = useState(false)
  const [newKw,     setNewKw]     = useState('')
  const [newKwGroup, setNewKwGroup] = useState<Group>('product')
  const [showAddRow, setShowAddRow] = useState(false)
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [exportingSheets, setExportingSheets] = useState(false)
  const [exportingSlides, setExportingSlides] = useState(false)
  const [exportResult, setExportResult] = useState<{ type: 'sheets' | 'slides'; url: string } | null>(null)
  const [savingToPlan, setSavingToPlan] = useState(false)
  const [savedToPlan,  setSavedToPlan]  = useState(false)

  // Save-to-plan modal state
  const [showSavePlanModal, setShowSavePlanModal] = useState(false)
  const [savePlanAction, setSavePlanAction] = useState<'existing' | 'new'>('existing')
  const [existingPlans, setExistingPlans] = useState<Array<{ id: string; title: string }>>([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newPlanName, setNewPlanName] = useState('')
  const [newPlanBudget, setNewPlanBudget] = useState(30000)
  const [savingModal, setSavingModal] = useState(false)
  const [savedModal, setSavedModal] = useState<{ planId: string; count: number } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const hasResults = keywords.length > 0

  // ── Draft auto-save/restore ───────────────────────────────────────────────

  // Load accounts on mount so Planner can use a real sub-account CID (not MCC)
  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json() as Promise<{ accounts: KwAccount[] }>)
      .then((d) => {
        const accs = (d.accounts ?? []).filter((a) => !(a as { manager?: boolean }).manager)
        setAccounts(accs)
        if (accs.length > 0) setSelectedCid(accs[0].id)
      })
      .catch(() => {})
  }, [])

  const DRAFT_KEY = 'kw-planner-draft'

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.keywords?.length > 0) {
        setBusinessName(d.businessName ?? '')
        setProductService(d.productService ?? '')
        setLocation(d.location ?? 'กรุงเทพมหานคร')
        setObjective(d.objective ?? 'leads')
        setCompetitors(d.competitors ?? '')
        setKeywords(d.keywords)
        if (d.analysis) setAnalysis(d.analysis)
        setShowDraftBanner(true)
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (keywords.length === 0) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        businessName, productService, location, objective, competitors, keywords, analysis,
        savedAt: Date.now(),
      }))
    } catch { /* ignore */ }
  }, [keywords, analysis, businessName, productService, location, objective, competitors])

  // Load AI market analysis separately after keywords are ready
  async function loadAnalysis(kws: ResearchKeyword[]) {
    setAnalysisLoading(true)
    setAnalysis(null)
    try {
      const res = await fetch('/api/keyword-research/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ keywords: kws, businessName, productService, location, objective, competitors }),
      })
      if (res.ok) {
        const data = await res.json() as MarketAnalysis
        setAnalysis(data)
        // Add new negative keywords from analysis (dedup)
        const existingNegs = new Set(kws.filter(k => k.group === 'negative').map(k => k.keyword.toLowerCase()))
        if (data.negativeAdvice) {
          const rawNegs = data.negativeAdvice
            .split(/[,，\n•\-–]+/)
            .map(s => s.replace(/["""'']/g, '').trim())
            .filter(s => s.length > 1 && s.length < 50)
          const extras: ResearchKeyword[] = []
          for (const neg of rawNegs) {
            if (!existingNegs.has(neg.toLowerCase())) {
              existingNegs.add(neg.toLowerCase())
              extras.push({ keyword: neg, matchType: 'PHRASE', group: 'negative', intent: 'low', volume: 'ต่ำ', competition: 'LOW', cpcEst: 0, selected: true, dataSource: 'ai_estimate' })
            }
          }
          if (extras.length > 0) setKeywords(prev => [...prev, ...extras])
        }
      }
    } catch { /* silent */ } finally {
      setAnalysisLoading(false)
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    setKeywords([])
    setBusinessName('')
    setProductService('')
    setLocation('กรุงเทพมหานคร')
    setObjective('leads')
    setCompetitors('')
    setShowDraftBanner(false)
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  async function generate() {
    if (!businessName.trim() || !productService.trim()) return
    setLoading(true)
    setError('')
    setKeywords([])
    setAnalysis(null)
    setActiveTab('all')
    setShowDraftBanner(false)
    try {
      const res = await fetch('/api/keyword-research/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ businessName, productService, location, objective, competitors, customerId: selectedCid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generate failed')
      setKeywords(data.keywords)
      setDataMeta(data.meta ?? null)
      // Start AI analysis in background after keywords are ready
      loadAnalysis(data.keywords)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  // ── Keyword ops ───────────────────────────────────────────────────────────

  function toggle(idx: number) {
    setKeywords((prev) => prev.map((k, i) => i === idx ? { ...k, selected: !k.selected } : k))
  }

  function toggleAll(group: Group) {
    const visible = filtered
    const allSelected = visible.every((k) => k.selected)
    const visibleSet = new Set(visible.map((k) => keywords.indexOf(k)))
    setKeywords((prev) => prev.map((k, i) => visibleSet.has(i) ? { ...k, selected: !allSelected } : k))
  }

  function changeMatchType(idx: number, mt: ResearchKeyword['matchType']) {
    setKeywords((prev) => prev.map((k, i) => i === idx ? { ...k, matchType: mt } : k))
  }

  function moveToNegative(idx: number) {
    setKeywords((prev) => prev.map((k, i) => i === idx ? { ...k, group: 'negative', selected: true } : k))
  }

  function removeKeyword(idx: number) {
    setKeywords((prev) => prev.filter((_, i) => i !== idx))
  }

  function addKeyword() {
    const kw = newKw.trim()
    if (!kw) return
    setKeywords((prev) => [...prev, {
      keyword:    kw,
      matchType:  newKwGroup === 'negative' ? 'PHRASE' : 'PHRASE',
      group:      newKwGroup === 'all' ? 'product' : newKwGroup,
      intent:     newKwGroup === 'negative' ? 'low' : 'high',
      volume:     'ต่ำ',
      competition:'MEDIUM',
      cpcEst:     0,
      selected:   true,
    }])
    setNewKw('')
    inputRef.current?.focus()
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const filtered = activeTab === 'all'
    ? keywords
    : keywords.filter((k) => k.group === activeTab)

  const counts = Object.fromEntries(
    (['all', 'brand', 'product', 'service', 'generic', 'competitor', 'negative'] as Group[]).map((g) => [
      g,
      g === 'all' ? keywords.length : keywords.filter((k) => k.group === g).length,
    ])
  )

  const selectedNonNeg = keywords.filter((k) => k.selected && k.group !== 'negative')
  const selectedNeg    = keywords.filter((k) => k.selected && k.group === 'negative')
  const totalCPCEst    = selectedNonNeg.reduce((a, k) => a + k.cpcEst, 0)
  const avgCPCEst      = selectedNonNeg.length > 0 ? totalCPCEst / selectedNonNeg.length : 0

  // ── Forecast calculation ──────────────────────────────────────────────────
  const [dailyBudgetStr, setDailyBudgetStr] = useState('500')
  const dailyBudget = Math.max(1, Number(dailyBudgetStr) || 1)

  const forecast = useMemo(() => {
    if (selectedNonNeg.length === 0) return null
    const cpc = avgCPCEst > 0 ? avgCPCEst : 25

    const VOL_FALLBACK: Record<string, number> = { สูง: 1500, กลาง: 400, ต่ำ: 80 }
    const COMP_CTR: Record<string, number>     = { LOW: 0.07, MEDIUM: 0.05, HIGH: 0.035 }
    const MATCH_MULT: Record<string, number>   = { EXACT: 1, PHRASE: 1.4, BROAD: 2.2 }

    let monthlyImpressions = 0
    let monthlyClicks = 0
    for (const kw of selectedNonNeg) {
      const baseSearches = kw.avgMonthlySearches ?? VOL_FALLBACK[kw.volume] ?? 200
      const imp = baseSearches * (MATCH_MULT[kw.matchType] ?? 1)
      const ctr = COMP_CTR[kw.competition] ?? 0.05
      monthlyImpressions += imp
      monthlyClicks += imp * ctr
    }

    const monthlyBudget     = dailyBudget * 30
    const maxClicksByBudget = monthlyBudget / cpc
    const actualClicks      = Math.min(monthlyClicks, maxClicksByBudget)

    const CVR: Record<string, number> = {
      leads: 0.04, sales: 0.025, awareness: 0.005, app: 0.015,
      calls: 0.06, store_visit: 0.05, quote: 0.035,
      ecomm_purchase: 0.03, ecomm_cart: 0.07, ecomm_remarketing: 0.08,
      brand_search: 0.008, consideration: 0.012,
      app_engage: 0.10, video_view: 0.002,
      local_service: 0.055, appointment: 0.045, real_estate: 0.015,
      education: 0.03, healthcare: 0.04, finance: 0.02,
      travel: 0.025, automotive: 0.018,
    }
    const cvr         = CVR[objective] ?? 0.04
    const conversions = actualClicks * cvr
    const cpa         = conversions > 0 ? (actualClicks * cpc) / conversions : 0
    const actualSpend = actualClicks * cpc
    const ctr         = monthlyImpressions > 0 ? (actualClicks / monthlyImpressions) * 100 : 0

    // ── Device breakdown — Thai market benchmark (mobile-heavy)
    const devices = [
      { label: 'Mobile', icon: 'mobile', pct: 68, clicks: Math.round(actualClicks * 0.68), conv: Math.round(conversions * 0.58) },
      { label: 'Desktop', icon: 'desktop', pct: 26, clicks: Math.round(actualClicks * 0.26), conv: Math.round(conversions * 0.36) },
      { label: 'Tablet', icon: 'tablet', pct: 6, clicks: Math.round(actualClicks * 0.06), conv: Math.round(conversions * 0.06) },
    ]

    // ── Location breakdown — Bangkok-heavy for Thai market
    const locations = [
      { label: 'กรุงเทพฯ', pct: 20 },
      { label: 'ชลบุรี',   pct: 7  },
      { label: 'ปทุมธานี', pct: 5  },
      { label: 'เชียงใหม่', pct: 5  },
      { label: 'นครราชสีมา', pct: 4 },
      { label: 'อื่นๆ',    pct: 59 },
    ]

    // ── Budget curve: clicks at different daily budget levels (logarithmic saturation)
    const budgetSteps = [50, 100, 200, 300, 400, 500, 700, 1000, 1500, 2000]
    const budgetCurve = budgetSteps.map(b => {
      const bMonthly   = b * 30
      const capClicks  = Math.min(monthlyClicks, bMonthly / cpc)
      const capConv    = capClicks * cvr
      return { budget: b, clicks: Math.round(capClicks), conversions: Math.round(capConv), spend: Math.round(capClicks * cpc) }
    })

    return {
      dailyBudget,
      monthlyBudget,
      monthlyImpressions: Math.round(monthlyImpressions),
      monthlyClicks:      Math.round(actualClicks),
      conversions:        Math.round(conversions),
      cpc:                Math.round(cpc),
      cpa:                Math.round(cpa),
      cvr:                (cvr * 100).toFixed(2),
      ctr:                ctr.toFixed(2),
      actualSpend:        Math.round(actualSpend),
      budgetUtilized:     Math.min(100, Math.round((actualSpend / monthlyBudget) * 100)),
      devices,
      locations,
      budgetCurve,
    }
  }, [selectedNonNeg, avgCPCEst, dailyBudget, objective])

  // ── Save keywords back to Media Plan ────────────────────────────────────────

  async function saveToMediaPlan() {
    if (!sourcePlanId) return
    // Positive keywords only — negatives go to Google Ads directly, not to media plan
    const selected = keywords.filter((k) => k.selected && k.group !== 'negative')
    if (!selected.length) return
    setSavingToPlan(true)
    try {
      // Group by keyword group → each group becomes its own campaign/ad group
      const groups: Record<string, typeof selected> = {}
      for (const k of selected) {
        const g = k.group || 'general'
        if (!groups[g]) groups[g] = []
        groups[g].push(k)
      }

      // POST each group separately so they land in distinct campaigns in the media plan
      await Promise.all(
        Object.entries(groups).map(([group, kws]) => {
          const campaignLabel: Record<string, string> = {
            brand:      'Brand',
            product:    'Product',
            service:    'Service',
            generic:    'Generic',
            competitor: 'Competitor',
          }
          const campaignName = sourceCampaign
            ? `${sourceCampaign} — ${campaignLabel[group] ?? group}`
            : `${campaignLabel[group] ?? group}`
          return fetch(`/api/keyword-audience/${sourcePlanId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignName,
              keywords: kws.map((k) => ({
                keyword:            k.keyword,
                matchType:          k.matchType,
                intent:             k.group,
                avgMonthlySearches: k.avgMonthlySearches,
                competition:        k.competition,
                lowTopOfPageBid:    k.lowTopBid,
                highTopOfPageBid:   k.highTopBid,
              })),
            }),
          })
        })
      )
      setSavedToPlan(true)
      setTimeout(() => router.push(`/media-plans/${sourcePlanId}`), 1200)
    } finally {
      setSavingToPlan(false)
    }
  }

  // ── Save to any Media Plan (modal) ──────────────────────────────────────────

  async function openSavePlanModal() {
    setShowSavePlanModal(true)
    setSavedModal(null)
    setSavePlanAction('existing')
    try {
      const res = await fetch('/api/media-plans')
      if (res.ok) {
        const data = await res.json() as Array<{ id: string; title: string }>
        setExistingPlans(data)
        if (data.length > 0) setSelectedPlanId(data[0].id)
        else setSavePlanAction('new')
      }
    } catch { /* ignore */ }
  }

  async function saveToPlanFromModal() {
    const selected = keywords.filter(k => k.selected && k.group !== 'negative')
    if (!selected.length) return
    setSavingModal(true)
    try {
      const payload = savePlanAction === 'existing'
        ? { action: 'existing', mediaPlanId: selectedPlanId, campaignName: newCampaignName || businessName || 'Keywords', keywords: selected }
        : { action: 'new', businessName: businessName || newPlanName, productService, location, objective, monthlyBudget: newPlanBudget, keywords: selected }

      const res = await fetch('/api/keyword-research/save-to-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { planId?: string; count?: number; error?: string }
      if (data.planId) {
        setSavedModal({ planId: data.planId, count: data.count ?? 0 })
      } else {
        alert(data.error ?? 'Failed to save')
      }
    } finally {
      setSavingModal(false)
    }
  }

  // ── Campaign Builder handoff ──────────────────────────────────────────────

  function goToCampaignBuilder() {
    const positive = keywords.filter((k) => k.selected && k.group !== 'negative')
    const negative = keywords.filter((k) => k.selected && k.group === 'negative')
    localStorage.setItem('kw-to-campaign', JSON.stringify({
      businessName,
      productService,
      location,
      keywords: positive.map((k) => `[${k.matchType}] ${k.keyword}`),
      negativeKeywords: negative.map((k) => k.keyword),
      avgCpc: avgCPCEst,
      savedAt: Date.now(),
    }))
    router.push('/campaign-builder')
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function exportCSV() {
    const csv  = toCSV(keywords, businessName)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `keyword-research-${businessName.replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(toClipboard(keywords))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function exportToSheets() {
    setExportingSheets(true)
    setExportResult(null)
    try {
      const payload = {
        businessName, productService, location, objective,
        keywords,
        forecast: forecast ? {
          monthlyImpressions: forecast.monthlyImpressions,
          monthlyClicks: forecast.monthlyClicks,
          ctr: forecast.ctr,
          cpc: forecast.cpc,
          actualSpend: forecast.actualSpend,
          budgetUtilized: forecast.budgetUtilized,
          devices: forecast.devices,
          locations: forecast.locations,
        } : null,
        analysis,
      }
      const res  = await fetch('/api/keyword-research/export-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) setExportResult({ type: 'sheets', url: data.url })
      else throw new Error(data.error ?? 'Export failed')
    } catch (e) {
      alert(`Export to Sheets failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setExportingSheets(false)
    }
  }

  function exportHTML() {
    const sortedByVol = (kws: ResearchKeyword[]) =>
      [...kws].sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0))

    const positiveKws = keywords.filter(k => k.group !== 'negative')
    const negKws      = keywords.filter(k => k.group === 'negative')
    const byGroup: Record<string, ResearchKeyword[]> = {}
    for (const k of positiveKws) {
      if (!byGroup[k.group]) byGroup[k.group] = []
      byGroup[k.group].push(k)
    }
    const GROUP_ORDER_LIST = ['brand', 'product', 'service', 'generic', 'competitor']
    const orderedGroups = [
      ...GROUP_ORDER_LIST.filter(g => byGroup[g]?.length),
      ...Object.keys(byGroup).filter(g => !GROUP_ORDER_LIST.includes(g)),
    ]

    const compBadge = (c: string) => {
      const map: Record<string, string> = { HIGH: '#fee2e2;color:#991b1b', MEDIUM: '#fef3c7;color:#92400e', LOW: '#d1fae5;color:#065f46' }
      return `<span style="background:${map[c] ?? '#f3f4f6;color:#374151'};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">${c}</span>`
    }
    const matchBadge = (m: string) => {
      const map: Record<string, string> = { PHRASE: '#dbeafe;color:#1d4ed8', BROAD: '#fff7ed;color:#c2410c', EXACT: '#fee2e2;color:#991b1b' }
      return `<span style="background:${map[m] ?? '#f3f4f6;color:#374151'};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">${m}</span>`
    }
    const groupBadge = (g: string) => {
      const map: Record<string, string> = {
        brand: '#dbeafe;color:#1e40af', product: '#d1fae5;color:#065f46',
        service: '#ede9fe;color:#5b21b6', generic: '#fef9c3;color:#854d0e',
        competitor: '#fae8ff;color:#701a75', negative: '#fee2e2;color:#991b1b',
      }
      return `<span style="background:${map[g] ?? '#f3f4f6;color:#374151'};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">${GROUP_LABELS[g as Group] ?? g}</span>`
    }

    const kwRows = (kws: ResearchKeyword[]) => sortedByVol(kws).map(k => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px;font-weight:500;color:#111827">${k.keyword}</td>
        <td style="padding:10px 12px;text-align:center">${matchBadge(k.matchType)}</td>
        <td style="padding:10px 12px;text-align:center">${groupBadge(k.group)}</td>
        <td style="padding:10px 12px;text-align:right;font-size:13px;color:#374151;font-weight:500">${k.avgMonthlySearches ? k.avgMonthlySearches.toLocaleString() : '—'}</td>
        <td style="padding:10px 12px;text-align:center">${compBadge(k.competition)}</td>
        <td style="padding:10px 12px;text-align:right;font-size:13px;color:#374151">${k.cpcEst > 0 ? `฿${k.cpcEst}` : '—'}</td>
      </tr>`).join('')

    const forecastSection = forecast ? `
      <section style="margin-bottom:32px">
        <h2 style="font-size:18px;font-weight:700;color:#1e3a5f;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #3b82f6">Forecast</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
          ${[
            ['Impressions/เดือน', forecast.monthlyImpressions.toLocaleString()],
            ['Clicks/เดือน', forecast.monthlyClicks.toLocaleString()],
            ['CTR', `${forecast.ctr}%`],
            ['Avg. CPC', `฿${forecast.cpc}`],
            ['Est. Spend/เดือน', `฿${forecast.actualSpend.toLocaleString()}`],
            ['Budget Utilized', `${forecast.budgetUtilized}%`],
          ].map(([label, val]) => `
            <div style="background:#f0f7ff;border-radius:12px;padding:14px 16px">
              <div style="font-size:22px;font-weight:700;color:#1e40af">${val}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:4px">${label}</div>
            </div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Devices</h3>
            ${forecast.devices.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:12px;color:#374151">${d.label}</span>
                <span style="font-size:12px;font-weight:600;color:#1e40af">${d.pct}% · ${d.clicks.toLocaleString()} clicks</span>
              </div>`).join('')}
          </div>
          <div>
            <h3 style="font-size:13px;font-weight:600;color:#374151;margin:0 0 8px">Top Locations</h3>
            ${forecast.locations.map(loc => `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:12px;color:#374151">${loc.label}</span>
                <span style="font-size:12px;font-weight:600;color:#1e40af">${loc.pct}%</span>
              </div>`).join('')}
          </div>
        </div>
      </section>` : ''

    const analysisSection = analysis ? (() => {
      const a = analysis as {
        summary?: string; marketOverview?: string; buyerJourney?: string; uniqueAngle?: string
        opportunityScore?: number; difficultyScore?: number; marketTrend?: string
        budgetAdvice?: string; matchTypeAdvice?: string; negativeAdvice?: string
        strategyTips?: string[]; doList?: string[]; dontList?: string[]
        topKeywords?: string[]
        competitors?: Array<{ name: string; type: string; strength: string; weakness?: string; bidStrategy?: string }>
        marketSignals?: Array<{ icon: string; label: string; value: string; detail: string }>
      }
      const block = (title: string, body: string, accent = '#1e3a5f') =>
        `<div style="margin-bottom:20px">
          <h3 style="font-size:13px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">${title}</h3>
          <p style="font-size:13px;color:#374151;line-height:1.6;margin:0">${body}</p>
        </div>`
      const listBlock = (title: string, items: string[], bullet: string, accent = '#374151') =>
        `<div style="margin-bottom:20px">
          <h3 style="font-size:13px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">${title}</h3>
          ${items.map(i => `<div style="display:flex;gap:8px;margin-bottom:6px"><span>${bullet}</span><span style="font-size:13px;color:#374151;line-height:1.5">${i}</span></div>`).join('')}
        </div>`

      return `
      <section style="margin-bottom:32px">
        <h2 style="font-size:18px;font-weight:700;color:#1e3a5f;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #3b82f6">Market Analysis</h2>
        ${(a.opportunityScore || a.difficultyScore || a.marketTrend) ? `
          <div style="display:flex;gap:16px;margin-bottom:20px">
            ${a.opportunityScore ? `<div style="background:#f0fdf4;border-radius:10px;padding:12px 16px;text-align:center"><div style="font-size:20px;font-weight:700;color:#065f46">${a.opportunityScore}/10</div><div style="font-size:11px;color:#6b7280;margin-top:2px">Opportunity</div></div>` : ''}
            ${a.difficultyScore ? `<div style="background:#fff1f2;border-radius:10px;padding:12px 16px;text-align:center"><div style="font-size:20px;font-weight:700;color:#9f1239">${a.difficultyScore}/10</div><div style="font-size:11px;color:#6b7280;margin-top:2px">Difficulty</div></div>` : ''}
            ${a.marketTrend ? `<div style="background:#eff6ff;border-radius:10px;padding:12px 16px;text-align:center"><div style="font-size:14px;font-weight:700;color:#1d4ed8">${a.marketTrend}</div><div style="font-size:11px;color:#6b7280;margin-top:2px">Market Trend</div></div>` : ''}
          </div>` : ''}
        ${a.summary ? block('Summary', a.summary) : ''}
        ${a.marketOverview ? block('Market Overview', a.marketOverview) : ''}
        ${a.buyerJourney ? block('Buyer Journey', a.buyerJourney) : ''}
        ${a.uniqueAngle ? block('Winning Angle ⚡', a.uniqueAngle, '#92400e') : ''}
        ${a.budgetAdvice ? block('Budget Advice', a.budgetAdvice) : ''}
        ${a.matchTypeAdvice ? block('Match Type Strategy', a.matchTypeAdvice) : ''}
        ${a.negativeAdvice ? block('Negative Keyword Advice', a.negativeAdvice) : ''}
        ${a.topKeywords?.length ? listBlock('Top Keywords ที่ควร Bid สูง', a.topKeywords, '🎯', '#1e40af') : ''}
        ${(a.doList?.length || a.dontList?.length) ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
            ${a.doList?.length ? `<div>
              <h3 style="font-size:13px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">✅ ควรทำ</h3>
              ${a.doList.map(i => `<div style="display:flex;gap:8px;margin-bottom:6px"><span>•</span><span style="font-size:13px;color:#065f46;line-height:1.5">${i}</span></div>`).join('')}
            </div>` : ''}
            ${a.dontList?.length ? `<div>
              <h3 style="font-size:13px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">❌ ห้ามทำ</h3>
              ${a.dontList.map(i => `<div style="display:flex;gap:8px;margin-bottom:6px"><span>•</span><span style="font-size:13px;color:#991b1b;line-height:1.5">${i}</span></div>`).join('')}
            </div>` : ''}
          </div>` : ''}
        ${a.strategyTips?.length ? listBlock('Strategy Tips — 30 วันแรก', a.strategyTips.map((t, i) => `${i+1}. ${t}`), '→') : ''}
        ${a.competitors?.length ? `
          <div style="margin-bottom:20px">
            <h3 style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">Competitors</h3>
            ${a.competitors.map(c => `
              <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin-bottom:8px">
                <div style="font-weight:600;font-size:13px;color:#111827;margin-bottom:6px">${c.name} <span style="font-size:11px;color:#6b7280;font-weight:400">(${c.type === 'direct' ? 'คู่แข่งตรง' : 'ทางอ้อม'})</span></div>
                <div style="font-size:12px;color:#065f46;margin-bottom:2px">💪 ${c.strength}</div>
                ${c.weakness ? `<div style="font-size:12px;color:#991b1b;margin-bottom:2px">⚠️ ${c.weakness}</div>` : ''}
                ${c.bidStrategy ? `<div style="font-size:12px;color:#1e40af">💡 ${c.bidStrategy}</div>` : ''}
              </div>`).join('')}
          </div>` : ''}
      </section>`
    })() : ''

    const kwSection = `
      <section style="margin-bottom:32px">
        <h2 style="font-size:18px;font-weight:700;color:#1e3a5f;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #3b82f6">
          Keywords (${positiveKws.length} positive · ${negKws.length} negative)
        </h2>
        ${orderedGroups.map(group => `
          <div style="margin-bottom:24px">
            <h3 style="font-size:14px;font-weight:600;color:#374151;margin:0 0 10px">${GROUP_LABELS[group as Group] ?? group} (${byGroup[group].length})</h3>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
              <thead><tr style="background:#f9fafb">
                <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280">Keyword</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6b7280">Match</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6b7280">Group</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#6b7280">Searches/mo</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:600;color:#6b7280">Competition</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#6b7280">CPC Est.</th>
              </tr></thead>
              <tbody>${kwRows(byGroup[group])}</tbody>
            </table>
          </div>`).join('')}
        ${negKws.length > 0 ? `
          <div style="margin-bottom:24px">
            <h3 style="font-size:14px;font-weight:600;color:#991b1b;margin:0 0 10px">Negative Keywords (${negKws.length})</h3>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${sortedByVol(negKws).map(k => `<span style="background:#fee2e2;color:#991b1b;padding:4px 12px;border-radius:9999px;font-size:12px">${k.keyword} [${k.matchType}]</span>`).join('')}
            </div>
          </div>` : ''}
      </section>`

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keyword Research — ${businessName}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', 'Segoe UI', sans-serif; background: #f8fafc; color: #111827; margin: 0; padding: 0; }
  @media print { body { background: #fff; } .no-print { display: none; } }
</style>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
<div style="max-width:900px;margin:0 auto;padding:40px 24px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);border-radius:16px;padding:32px 40px;margin-bottom:32px;color:#fff">
    <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;opacity:.7;margin-bottom:8px">Keyword Research Report</div>
    <h1 style="font-size:28px;font-weight:700;margin:0 0 8px">${businessName}</h1>
    <p style="margin:0;opacity:.85;font-size:14px">${productService} · ${location}</p>
    <p style="margin:6px 0 0;opacity:.7;font-size:12px">Objective: ${objective} · ${new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' })}</p>
  </div>

  ${forecastSection}
  ${analysisSection}
  ${kwSection}

  <div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:11px">
    สร้างโดย Mercy · ${new Date().toLocaleDateString('th-TH')}
  </div>
</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `keyword-research-${businessName.replace(/\s+/g, '-')}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportToSlides() {
    setExportingSlides(true)
    setExportResult(null)
    try {
      const payload = {
        businessName, productService, location, objective,
        keywords,
        forecast: forecast ? {
          monthlyImpressions: forecast.monthlyImpressions,
          monthlyClicks: forecast.monthlyClicks,
          ctr: forecast.ctr,
          cpc: forecast.cpc,
          actualSpend: forecast.actualSpend,
          budgetUtilized: forecast.budgetUtilized,
          devices: forecast.devices,
          locations: forecast.locations,
        } : null,
        analysis,
      }
      const res  = await fetch('/api/keyword-research/export-slides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) setExportResult({ type: 'slides', url: data.url })
      else throw new Error(data.error ?? 'Export failed')
    } catch (e) {
      alert(`Export to Slides failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setExportingSlides(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {sourcePlanId && (
              <button
                onClick={() => router.push(`/media-plans/${sourcePlanId}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <ArrowLeft className="w-4 h-4" />
                กลับ Media Plan
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900">Keyword Research</h1>
              {sourceCampaign
                ? <p className="text-sm text-blue-600 mt-0.5 font-medium">→ {sourceCampaign}</p>
                : <p className="text-sm text-gray-500 mt-0.5">วิเคราะห์และจัดกลุ่ม keyword เพื่อส่งให้ลูกค้า</p>
              }
            </div>
          </div>

          {/* Add to Plan button — shown when came from media plan and have selected keywords */}
          {sourcePlanId && sourceCampaign && keywords.length > 0 && (
            <button
              onClick={saveToMediaPlan}
              disabled={savingToPlan || savedToPlan || keywords.filter(k => k.selected && k.group !== 'negative').length === 0}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                savedToPlan
                  ? 'bg-green-100 text-green-700 border border-green-300'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              {savedToPlan ? (
                <><Check className="w-4 h-4" /> บันทึกแล้ว — กำลังกลับ...</>
              ) : savingToPlan ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Plus className="w-4 h-4" /> Add {keywords.filter(k => k.selected && k.group !== 'negative').length} keywords to &ldquo;{sourceCampaign}&rdquo;</>
              )}
            </button>
          )}
        </div>

        {/* ── Campaign context banner ── */}
        {sourcePlanId && sourceCampaign && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <Target className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Research keywords สำหรับ Campaign</p>
              <p className="text-xs text-blue-600 mt-0.5 font-mono">{sourceCampaign}</p>
            </div>
            <p className="text-xs text-blue-500">เลือก keywords แล้วกด &ldquo;Add to Plan&rdquo; ด้านบน</p>
          </div>
        )}

        {/* ── Draft restore banner ── */}
        {showDraftBanner && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">มี draft ที่บันทึกไว้</p>
              <p className="text-xs text-amber-600 mt-0.5">ระบบโหลด keyword list ล่าสุดให้อัตโนมัติ — แก้ไขหรือ generate ใหม่ได้เลย</p>
            </div>
            <button
              onClick={clearDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              เริ่มใหม่
            </button>
          </div>
        )}

        {/* ── Input form ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {/* Account selector row */}
          {accounts.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Google Ads Account</label>
              <AccountSelect
                accounts={accounts}
                value={selectedCid}
                onChange={setSelectedCid}
                className="flex-1 max-w-xs px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white"
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">ชื่อธุรกิจ / แบรนด์ *</label>
              <p className="text-[11px] text-gray-400 mb-1.5">ชื่อที่ลูกค้ารู้จัก — ใช้สร้าง brand keywords</p>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="เช่น ชื่อธุรกิจของคุณ"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">บริการ / สินค้าหลัก *</label>
              <p className="text-[11px] text-gray-400 mb-1.5">สิ่งที่ต้องการให้คนค้นหา — ยิ่งเจาะจงยิ่งดี</p>
              <input
                value={productService}
                onChange={(e) => setProductService(e.target.value)}
                placeholder="เช่น บริการยื่นวีซ่า Schengen, ติดตั้งโซลาร์เซลล์บ้าน"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">พื้นที่ / Location</label>
              <p className="text-[11px] text-gray-400 mb-1.5">จังหวัด หรือ ทั่วประเทศไทย</p>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="กรุงเทพมหานคร"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Objective</label>
              <p className="text-[11px] text-gray-400 mb-1.5">ส่งผลต่อ match type และ keyword intent</p>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 bg-white"
              >
                <optgroup label="─ Direct Response ─">
                  <option value="leads">Leads / สอบถาม / ลงทะเบียน</option>
                  <option value="sales">Sales / ซื้อสินค้า Online</option>
                  <option value="calls">Phone Calls / โทรหาธุรกิจ</option>
                  <option value="store_visit">Store Visit / เข้าร้าน</option>
                  <option value="quote">ขอใบเสนอราคา / Request Quote</option>
                </optgroup>
                <optgroup label="─ E-commerce ─">
                  <option value="ecomm_purchase">E-commerce Purchase</option>
                  <option value="ecomm_cart">Add to Cart / Checkout</option>
                  <option value="ecomm_remarketing">Remarketing / Cart Abandon</option>
                </optgroup>
                <optgroup label="─ Brand & Awareness ─">
                  <option value="awareness">Awareness / การรับรู้แบรนด์</option>
                  <option value="brand_search">Brand Search Volume</option>
                  <option value="consideration">Consideration / ค้นหาข้อมูล</option>
                </optgroup>
                <optgroup label="─ App & Digital ─">
                  <option value="app">App Install / Download</option>
                  <option value="app_engage">App Engagement / Re-engage</option>
                  <option value="video_view">Video Views / YouTube</option>
                </optgroup>
                <optgroup label="─ Local & Service ─">
                  <option value="local_service">Local Service / บริการท้องถิ่น</option>
                  <option value="appointment">นัดหมาย / Booking</option>
                  <option value="real_estate">อสังหาริมทรัพย์</option>
                  <option value="education">ลงทะเบียนเรียน / Education</option>
                  <option value="healthcare">นัดแพทย์ / Healthcare</option>
                  <option value="finance">สมัครสินเชื่อ / บัตร / Finance</option>
                  <option value="travel">จองท่องเที่ยว / Travel</option>
                  <option value="automotive">ทดลองขับ / Automotive</option>
                </optgroup>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">คู่แข่ง (คั่นด้วย ,)</label>
              <p className="text-[11px] text-gray-400 mb-1.5">ถ้าไม่ใส่ AI จะหาให้เองจากอุตสาหกรรม</p>
              <input
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder="เช่น VisaHQ, VFS Global, iVisa — หรือเว้นว่างให้ AI หาให้"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={generate}
              disabled={loading || !businessName.trim() || !productService.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? <><RefreshCw className="w-4 h-4 animate-spin" />กำลังวิเคราะห์...</>
                : <><Sparkles className="w-4 h-4" />วิเคราะห์ Keyword</>
              }
            </button>
            {hasResults && (
              <button
                onClick={generate}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />วิเคราะห์ใหม่
              </button>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        </div>

        {/* ── AI Market Analysis ── loads after keywords ── */}
        {(analysisLoading || analysis) && hasResults && (
          <div className="space-y-4">
            {/* Header bar */}
            <div className="flex items-center gap-2">
              <Sparkles className={cn('w-4 h-4 text-indigo-500', analysisLoading && 'animate-pulse')} />
              <h3 className="font-semibold text-gray-900 text-sm">AI Market Analysis</h3>
              {analysisLoading && (
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              {analysisLoading && <span className="text-xs text-gray-400 italic">AI กำลังวิเคราะห์ตลาด...</span>}
            </div>

            {analysisLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-32 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl animate-pulse" />
                <div className="h-32 bg-gray-50 rounded-xl animate-pulse border border-gray-100" />
                <div className="h-24 bg-amber-50 rounded-xl animate-pulse border border-amber-100" />
                <div className="h-24 bg-emerald-50 rounded-xl animate-pulse border border-emerald-100" />
              </div>
            ) : analysis && (
              <>
                {/* ── MARKET OVERVIEW ── */}
                <div className="space-y-3">
                  {/* Header row: summary + scores */}
                  <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1">
                        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1.5">Strategic Summary</p>
                        <p className="text-sm text-indigo-900 font-medium leading-relaxed">{analysis.summary}</p>
                      </div>
                      {/* Scores */}
                      {(analysis.opportunityScore || analysis.difficultyScore) && (
                        <div className="flex gap-2 flex-shrink-0">
                          <div className="bg-white/70 rounded-lg px-3 py-2 text-center min-w-[56px]">
                            <p className="text-[10px] text-gray-400 mb-0.5">โอกาส</p>
                            <p className="text-lg font-bold text-emerald-600 leading-none">{analysis.opportunityScore}</p>
                            <p className="text-[10px] text-gray-400">/10</p>
                          </div>
                          <div className="bg-white/70 rounded-lg px-3 py-2 text-center min-w-[56px]">
                            <p className="text-[10px] text-gray-400 mb-0.5">ความยาก</p>
                            <p className="text-lg font-bold text-red-500 leading-none">{analysis.difficultyScore}</p>
                            <p className="text-[10px] text-gray-400">/10</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Market trend badge */}
                    {(analysis as {marketTrend?: string}).marketTrend && (
                      <div className="flex items-center gap-2 mb-3">
                        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full',
                          (analysis as {marketTrend?: string}).marketTrend === 'growing'   ? 'bg-emerald-100 text-emerald-700' :
                          (analysis as {marketTrend?: string}).marketTrend === 'declining'  ? 'bg-red-100 text-red-600' :
                          (analysis as {marketTrend?: string}).marketTrend === 'seasonal'   ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        )}>
                          {(analysis as {marketTrend?: string}).marketTrend === 'growing'  ? '📈 Growing Market' :
                           (analysis as {marketTrend?: string}).marketTrend === 'declining' ? '📉 Declining Market' :
                           (analysis as {marketTrend?: string}).marketTrend === 'seasonal'  ? '🌊 Seasonal Market' :
                           '➡️ Stable Market'}
                        </span>
                      </div>
                    )}

                    {/* Market overview paragraph */}
                    {analysis.marketOverview && (
                      <div className="bg-white/60 rounded-lg p-3 mb-3">
                        <p className="text-xs font-semibold text-indigo-600 mb-1.5 flex items-center gap-1">
                          <Info className="w-3 h-3" />MARKET OVERVIEW
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed">{analysis.marketOverview}</p>
                      </div>
                    )}

                    {/* Buyer journey */}
                    {(analysis as {buyerJourney?: string}).buyerJourney && (
                      <div className="bg-white/60 rounded-lg p-3 mb-3">
                        <p className="text-xs font-semibold text-purple-600 mb-1.5 flex items-center gap-1">
                          🛒 BUYER JOURNEY
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed">{(analysis as {buyerJourney?: string}).buyerJourney}</p>
                      </div>
                    )}

                    {/* Unique angle */}
                    {(analysis as {uniqueAngle?: string}).uniqueAngle && (
                      <div className="bg-amber-50/80 border border-amber-100 rounded-lg p-3">
                        <p className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1">
                          ⚡ WINNING ANGLE สำหรับธุรกิจนี้
                        </p>
                        <p className="text-sm text-amber-900 leading-relaxed font-medium">{(analysis as {uniqueAngle?: string}).uniqueAngle}</p>
                      </div>
                    )}
                  </div>

                  {/* Market Signals grid */}
                  {(analysis as {marketSignals?: Array<{icon:string; label:string; value:string; detail:string; color:string}>}).marketSignals?.length ? (
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Market Signals</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {(analysis as {marketSignals?: Array<{icon:string; label:string; value:string; detail:string; color:string}>}).marketSignals!.map((sig, i) => (
                          <div key={i} className={cn('rounded-xl border p-3',
                            sig.color === 'green'  ? 'bg-emerald-50 border-emerald-100' :
                            sig.color === 'red'    ? 'bg-red-50 border-red-100' :
                            sig.color === 'yellow' ? 'bg-amber-50 border-amber-100' :
                            sig.color === 'purple' ? 'bg-purple-50 border-purple-100' :
                            'bg-blue-50 border-blue-100'
                          )}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-base leading-none">{sig.icon}</span>
                              <span className={cn('text-[10px] font-bold uppercase tracking-wide',
                                sig.color === 'green'  ? 'text-emerald-600' :
                                sig.color === 'red'    ? 'text-red-500' :
                                sig.color === 'yellow' ? 'text-amber-600' :
                                sig.color === 'purple' ? 'text-purple-600' :
                                'text-blue-600'
                              )}>{sig.label}</span>
                            </div>
                            <p className={cn('text-sm font-bold mb-0.5',
                              sig.color === 'green'  ? 'text-emerald-700' :
                              sig.color === 'red'    ? 'text-red-600' :
                              sig.color === 'yellow' ? 'text-amber-700' :
                              sig.color === 'purple' ? 'text-purple-700' :
                              'text-blue-700'
                            )}>{sig.value}</p>
                            <p className="text-[11px] text-gray-500 leading-relaxed">{sig.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Top Keywords + Budget + Match Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Target className="w-3 h-3" />TOP KEYWORDS ที่ควร Bid สูง</p>
                    <ul className="space-y-1.5">
                      {analysis.topKeywords.map((kw, i) => (
                        <li key={i} className="text-sm text-gray-800 flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center flex-shrink-0">{i+1}</span>
                          {kw}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <p className="text-xs font-semibold text-gray-500 mb-1">BUDGET ADVICE</p>
                      {forecast ? (
                        <div className="space-y-2">
                          {/* Live computed rows — always matches งบ/วัน input */}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">งบ/วัน ปัจจุบัน</span>
                            <span className="font-semibold text-gray-900">฿{dailyBudget.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">งบ/เดือน</span>
                            <span className="font-semibold text-blue-600">฿{(dailyBudget * 30).toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">คลิกที่คาดได้/เดือน</span>
                            <span className="font-semibold text-gray-900">{forecast.monthlyClicks.toLocaleString()} clicks</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Avg. CPC</span>
                            <span className="font-semibold text-gray-900">฿{forecast.cpc.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Budget utilized</span>
                            <span className={cn('font-semibold', forecast.budgetUtilized >= 90 ? 'text-emerald-600' : forecast.budgetUtilized >= 50 ? 'text-amber-600' : 'text-red-500')}>
                              {forecast.budgetUtilized}%
                            </span>
                          </div>
                          {forecast.budgetUtilized < 80 && (
                            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-1">
                              งบยังใช้ไม่เต็ม — keyword pool มีไม่พอหรือ CPC สูงเกิน ลองเพิ่ม keyword หรือลด budget เป็น ฿{Math.max(1, Math.round(forecast.actualSpend / 30)).toLocaleString()}/วัน
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">เลือก keyword ก่อนเพื่อดู budget advice</p>
                      )}
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <p className="text-xs font-semibold text-gray-500 mb-1">MATCH TYPE STRATEGY</p>
                      <p className="text-sm text-gray-800 leading-relaxed">{analysis.matchTypeAdvice}</p>
                    </div>
                  </div>
                </div>

                {/* Do / Don't + Negative Keywords */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {analysis.doList?.length > 0 && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                      <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1.5"><ThumbsUp className="w-3 h-3" />ควรทำ</p>
                      <ul className="space-y-1.5">
                        {analysis.doList.map((d, i) => <li key={i} className="text-xs text-emerald-800 flex gap-1.5"><span className="mt-0.5 text-emerald-500">✓</span>{d}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.dontList?.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                      <p className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1.5"><ThumbsDown className="w-3 h-3" />ไม่ควรทำ</p>
                      <ul className="space-y-1.5">
                        {analysis.dontList.map((d, i) => <li key={i} className="text-xs text-red-700 flex gap-1.5"><span className="mt-0.5">✕</span>{d}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <p className="text-xs font-semibold text-amber-600 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />NEGATIVE KEYWORDS</p>
                    <p className="text-xs text-amber-800 leading-relaxed">{analysis.negativeAdvice}</p>
                  </div>
                </div>

                {/* Competitors */}
                {analysis.competitors?.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-1.5"><Users className="w-3 h-3" />คู่แข่งในตลาด</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {analysis.competitors.map((c: CompetitorInfo, i: number) => (
                        <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', c.type === 'direct' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600')}>
                              {c.type === 'direct' ? 'คู่แข่งตรง' : 'ทางอ้อม'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed"><span className="font-medium text-emerald-700">แข็ง:</span> {c.strength}</p>
                          {c.weakness && <p className="text-xs text-gray-600 mt-0.5"><span className="font-medium text-red-600">อ่อน:</span> {c.weakness}</p>}
                          {c.bidStrategy && <p className="text-xs text-blue-600 mt-1 italic">{c.bidStrategy}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strategy Tips */}
                {analysis.strategyTips?.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Zap className="w-3 h-3 text-yellow-500" />STRATEGY TIPS</p>
                    <ul className="space-y-1.5">
                      {analysis.strategyTips.map((tip, i) => (
                        <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-yellow-500 mt-0.5">•</span>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Results ── */}
        {hasResults && (
          <>
            {/* Summary bar */}
            <div className="flex flex-wrap items-center gap-4 bg-white rounded-xl border border-gray-200 px-5 py-3">
              <div className="flex items-center gap-5 flex-1">
                <div>
                  <p className="text-xs text-gray-400">เลือกแล้ว</p>
                  <p className="font-bold text-gray-900">{selectedNonNeg.length} keywords</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Negative</p>
                  <p className="font-bold text-red-600">{selectedNeg.length} keywords</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Avg CPC</p>
                  <p className="font-bold text-gray-900">฿{avgCPCEst.toFixed(0)}</p>
                </div>
                {dataMeta && (
                  <div className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                    dataMeta.source === 'google_ads_keyword_planner'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  )}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', dataMeta.source === 'google_ads_keyword_planner' ? 'bg-green-500' : 'bg-yellow-400')} />
                    {dataMeta.source === 'google_ads_keyword_planner'
                      ? `Real data · ${dataMeta.realCount}/${dataMeta.total} kw`
                      : 'AI Estimate'}
                  </div>
                )}
              </div>
              {/* Export buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={copyToClipboard}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors',
                    copied
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={exportCSV}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
                >
                  <FileDown className="w-4 h-4" />
                  Export CSV
                </button>
                {/* Save to Media Plan — shown when not coming from an existing plan */}
                {!sourcePlanId && (
                  <button
                    onClick={openSavePlanModal}
                    disabled={keywords.filter(k => k.selected && k.group !== 'negative').length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    บันทึกไปยัง Media Plan
                  </button>
                )}
              </div>
            </div>

            {/* ── Forecast Panel ── */}
            {forecast && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />
                    <h3 className="font-semibold text-gray-900">Forecast</h3>
                    <span className="text-xs text-gray-400">{selectedNonNeg.length} keywords selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-500">งบ/วัน</label>
                    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                      <span className="px-3 py-1.5 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">฿</span>
                      <input
                        type="number"
                        value={dailyBudgetStr}
                        onChange={(e) => setDailyBudgetStr(e.target.value)}
                        onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setDailyBudgetStr(String(v)) }}
                        className="w-24 px-3 py-1.5 text-sm text-gray-800 font-medium focus:outline-none"
                        step={100} min={1}
                      />
                    </div>
                    <span className="text-xs text-gray-400">= ฿{(dailyBudget * 30).toLocaleString()}/เดือน</span>
                  </div>
                </div>

                {/* Key metrics — Impressions, Clicks, CTR, Avg.CPC, Keywords Selected */}
                <div className="grid grid-cols-3 md:grid-cols-5 divide-x divide-gray-100 border-b border-gray-100">
                  {[
                    { label: 'Impressions',      value: forecast.monthlyImpressions >= 1000 ? `${(forecast.monthlyImpressions/1000).toFixed(1)}K` : forecast.monthlyImpressions.toLocaleString(), sub: 'ต่อเดือน' },
                    { label: 'Clicks',           value: forecast.monthlyClicks.toLocaleString(),  sub: 'ต่อเดือน' },
                    { label: 'CTR',              value: `${Number(forecast.ctr).toFixed(2)}%`,    sub: 'avg. click-through rate' },
                    { label: 'Avg. CPC',         value: `฿${forecast.cpc.toLocaleString()}`,      sub: 'ต่อคลิก' },
                    { label: 'Keywords',         value: selectedNonNeg.length.toString(),          sub: `${selectedNeg.length} negatives` },
                  ].map(({ label, value, sub }) => (
                    <div key={label} className="px-4 py-3">
                      <p className="text-[11px] text-gray-400 mb-1">{label}</p>
                      <p className="text-lg font-bold text-gray-900 leading-none">{value}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* Budget curve chart */}
                <div className="px-5 pt-4 pb-2">
                  <p className="text-xs font-semibold text-gray-500 mb-3">Clicks vs. Daily Budget</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={forecast.budgetCurve} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <XAxis dataKey="budget" tickFormatter={v => `฿${v}`} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(v: number) => [v.toLocaleString(), 'Clicks']}
                        labelFormatter={(l: number) => `฿${l}/วัน`}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <Line type="monotone" dataKey="clicks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <ReferenceDot x={dailyBudget} y={forecast.monthlyClicks} r={4} fill="#3b82f6" stroke="white" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-5 h-0.5 bg-blue-500 inline-block rounded"/>Clicks</span>
                  </div>
                </div>

                {/* Device + Location breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-gray-100">
                  {/* Devices */}
                  <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-3">Devices</p>
                    <div className="space-y-2.5">
                      {forecast.devices.map((d) => {
                        const Icon = d.icon === 'mobile' ? Smartphone : d.icon === 'desktop' ? Monitor : Tablet
                        return (
                          <div key={d.label} className="flex items-center gap-3">
                            <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-600">{d.label}</span>
                                <span className="text-xs font-medium text-gray-700">{d.pct}% · {d.clicks.toLocaleString()} clicks</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', d.icon === 'mobile' ? 'bg-blue-500' : d.icon === 'desktop' ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${d.pct}%` }} />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {/* Locations */}
                  <div className="px-5 py-4">
                    <p className="text-xs font-semibold text-gray-500 mb-3">Top Locations (Clicks Est.)</p>
                    <div className="space-y-1.5">
                      {forecast.locations.map((loc, i) => (
                        <div key={loc.label} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ['#3b82f6','#ec4899','#f59e0b','#10b981','#8b5cf6','#06b6d4'][i] }} />
                          <span className="text-xs text-gray-600 flex-1">{loc.label}</span>
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-300" style={{ width: `${(loc.pct / 59) * 100}%` }} />
                          </div>
                          <span className="text-xs font-medium text-gray-700 w-8 text-right">{loc.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Budget utilization */}
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                    <span>Budget utilization</span>
                    <span>{forecast.budgetUtilized}% · ฿{forecast.actualSpend.toLocaleString()} / ฿{forecast.monthlyBudget.toLocaleString()}/เดือน</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', forecast.budgetUtilized >= 95 ? 'bg-green-500' : forecast.budgetUtilized >= 60 ? 'bg-blue-500' : 'bg-yellow-400')} style={{ width: `${forecast.budgetUtilized}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    {forecast.budgetUtilized < 60
                      ? '⚠️ งบเหลือมาก — keyword มีน้อยหรือ volume ต่ำ ลองเพิ่ม keyword หรือเปลี่ยน match type เป็น BROAD'
                      : forecast.budgetUtilized >= 95
                      ? '✅ งบถูกใช้เต็มประสิทธิภาพ'
                      : '📊 งบถูกใช้ในระดับดี'}
                  </p>
                </div>
              </div>
            )}

            {/* Group tabs */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-0 border-b border-gray-100 px-1 pt-1 overflow-x-auto">
                {(['all', 'brand', 'product', 'service', 'generic', 'competitor', 'negative'] as Group[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setActiveTab(g)}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                      activeTab === g
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    )}
                  >
                    {GROUP_LABELS[g]}
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full font-medium',
                      activeTab === g ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    )}>
                      {counts[g]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="py-3 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && filtered.every((k) => k.selected)}
                          onChange={() => toggleAll(activeTab)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="text-left py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Keyword</th>
                      <th className="text-center py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Match Type</th>
                      <th className="text-center py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide hidden md:table-cell">กลุ่ม</th>
                      <th className="text-center py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Avg. Monthly Searches</th>
                      <th className="text-center py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide hidden md:table-cell">Competition</th>
                      <th className="text-right py-3 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide hidden md:table-cell">Top of Page Bid (฿)</th>
                      <th className="py-3 px-4 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((kw, fi) => {
                      const realIdx = keywords.indexOf(kw)
                      return (
                        <tr
                          key={realIdx}
                          className={cn(
                            'border-b border-gray-50 transition-colors',
                            kw.selected ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 opacity-60 hover:opacity-80'
                          )}
                        >
                          {/* Checkbox */}
                          <td className="py-3 px-4">
                            <input
                              type="checkbox"
                              checked={kw.selected}
                              onChange={() => toggle(realIdx)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>

                          {/* Keyword */}
                          <td className="py-3 px-3 font-medium text-gray-900">{kw.keyword}</td>

                          {/* Match type — clickable cycle */}
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => {
                                const cycle: ResearchKeyword['matchType'][] = ['PHRASE','BROAD']
                                const idx = cycle.indexOf(kw.matchType as 'PHRASE' | 'BROAD')
                                const next = cycle[(idx < 0 ? 0 : idx + 1) % 2]
                                changeMatchType(realIdx, next)
                              }}
                              className={cn('px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity', MATCH_COLORS[kw.matchType])}
                              title="คลิกเพื่อเปลี่ยน match type"
                            >
                              {kw.matchType}
                            </button>
                          </td>

                          {/* Group */}
                          <td className="py-3 px-3 text-center hidden md:table-cell">
                            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', GROUP_COLORS[kw.group] ?? 'bg-gray-100 text-gray-600')}>
                              {GROUP_LABELS[kw.group as Group] ?? kw.group}
                            </span>
                          </td>

                          {/* Search Volume — Google Ads Keyword Planner range format */}
                          <td className="py-3 px-3 text-center hidden md:table-cell">
                            {kw.group === 'negative' ? (
                              <span className="text-xs text-gray-300">—</span>
                            ) : kw.avgMonthlySearches !== undefined && kw.dataSource === 'google_ads' ? (
                              <span className="text-xs font-semibold text-gray-900">
                                {fmtVolume(kw.avgMonthlySearches)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>

                          {/* Competition — index bar like Google Ads UI */}
                          <td className="py-3 px-3 text-center hidden md:table-cell">
                            {kw.group === 'negative' ? (
                              <span className="text-xs text-gray-300">—</span>
                            ) : kw.competitionIndex !== undefined && kw.dataSource === 'google_ads' ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={cn('h-full rounded-full', kw.competitionIndex >= 67 ? 'bg-red-400' : kw.competitionIndex >= 34 ? 'bg-amber-400' : 'bg-emerald-400')}
                                    style={{ width: `${kw.competitionIndex}%` }} />
                                </div>
                                <span className={cn('text-[11px] font-medium', COMP_COLORS[kw.competition])}>{kw.competition}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>

                          {/* CPC — top of page bid range like Google Ads Keyword Planner */}
                          <td className="py-3 px-3 text-right text-xs hidden md:table-cell">
                            {kw.group === 'negative' ? (
                              <span className="text-gray-300">—</span>
                            ) : kw.lowTopBid !== undefined && kw.highTopBid !== undefined && kw.dataSource === 'google_ads' ? (
                              <span className="font-semibold text-gray-900">
                                ฿{kw.lowTopBid.toLocaleString()}–฿{kw.highTopBid.toLocaleString()}
                              </span>
                            ) : kw.cpcEst > 0 ? (
                              <span className="text-gray-400">฿{kw.cpcEst}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1 justify-end">
                              {kw.group !== 'negative' && (
                                <button
                                  onClick={() => moveToNegative(realIdx)}
                                  title="ย้ายไป Negative"
                                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => removeKeyword(realIdx)}
                                title="ลบออก"
                                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                    {/* Add keyword row */}
                    {showAddRow ? (
                      <tr className="border-b border-gray-100 bg-blue-50">
                        <td className="py-2 px-4" />
                        <td className="py-2 px-3" colSpan={2}>
                          <input
                            ref={inputRef}
                            value={newKw}
                            onChange={(e) => setNewKw(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(); if (e.key === 'Escape') setShowAddRow(false) }}
                            placeholder="พิมพ์ keyword..."
                            autoFocus
                            className="w-full px-2 py-1.5 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <select
                            value={newKwGroup}
                            onChange={(e) => setNewKwGroup(e.target.value as Group)}
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none"
                          >
                            {(['brand','product','service','generic','competitor','negative'] as Group[]).map((g) => (
                              <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3" colSpan={3} />
                        <td className="py-2 px-4">
                          <div className="flex gap-1">
                            <button onClick={addKeyword} className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setShowAddRow(false)} className="p-1 rounded text-gray-400 hover:bg-gray-100 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-2 px-4">
                          <button
                            onClick={() => { setShowAddRow(true); setNewKwGroup(activeTab === 'all' || activeTab === 'negative' ? 'product' : activeTab) }}
                            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 py-1"
                          >
                            <Plus className="w-3.5 h-3.5" />เพิ่ม keyword
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom export bar */}
            <div className="bg-gray-900 rounded-xl px-5 py-4 space-y-3">
              {exportResult && (
                <div className="flex items-center gap-3 bg-emerald-900/40 border border-emerald-700 rounded-lg px-4 py-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <p className="text-emerald-300 text-sm flex-1">
                    Export สำเร็จ —{' '}
                    <a href={exportResult.url} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                      เปิด Google {exportResult.type === 'sheets' ? 'Sheets' : 'Slides'}
                    </a>
                  </p>
                  <button onClick={() => setExportResult(null)} className="text-emerald-600 hover:text-emerald-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">พร้อมใช้งาน</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {selectedNonNeg.length} keywords · {selectedNeg.length} negatives · avg CPC ฿{avgCPCEst.toFixed(0)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={copyToClipboard}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      copied ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    )}
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-600 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    CSV
                  </button>
                  <button
                    onClick={exportHTML}
                    disabled={keywords.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <FileDown className="w-4 h-4" />
                    HTML
                  </button>
                  <button
                    onClick={exportToSheets}
                    disabled={exportingSheets || keywords.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {exportingSheets ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                    Google Sheets
                  </button>
                  <button
                    onClick={exportToSlides}
                    disabled={exportingSlides || keywords.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {exportingSlides ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                    Google Slides
                  </button>
                  <button
                    onClick={goToCampaignBuilder}
                    disabled={selectedNonNeg.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    Build Campaign
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!hasResults && !loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Search className="w-10 h-10 mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 font-medium">ใส่ข้อมูลธุรกิจแล้วกด &quot;วิเคราะห์ Keyword&quot;</p>
            <p className="text-gray-400 text-sm mt-1">AI จะสร้าง keyword list แบ่งเป็นกลุ่มพร้อม volume และ CPC ประมาณ</p>
          </div>
        )}

      </div>

      {/* ── Save-to-Media-Plan Modal ── */}
      {showSavePlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 text-base">บันทึก Keywords ไปยัง Media Plan</h2>
              <button onClick={() => { setShowSavePlanModal(false); setSavedModal(null) }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {savedModal ? (
              /* Success state */
              <div className="px-6 py-8 text-center space-y-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <p className="font-semibold text-gray-900">บันทึกสำเร็จ!</p>
                <p className="text-sm text-gray-500">เพิ่ม {savedModal.count} keywords เรียบร้อยแล้ว</p>
                <div className="flex gap-3 justify-center pt-2">
                  <button
                    onClick={() => router.push(`/media-plans/${savedModal.planId}`)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                  >
                    ดู Media Plan
                  </button>
                  <button
                    onClick={() => { setShowSavePlanModal(false); setSavedModal(null) }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200"
                  >
                    ปิด
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-5">
                {/* Action toggle */}
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-sm">
                  <button
                    className={cn('flex-1 py-2.5 font-medium transition-colors', savePlanAction === 'existing' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
                    onClick={() => setSavePlanAction('existing')}
                  >
                    Media Plan เดิม
                  </button>
                  <button
                    className={cn('flex-1 py-2.5 font-medium transition-colors', savePlanAction === 'new' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
                    onClick={() => setSavePlanAction('new')}
                  >
                    สร้าง Plan ใหม่
                  </button>
                </div>

                {savePlanAction === 'existing' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">เลือก Media Plan</label>
                      {existingPlans.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">ไม่พบ media plan — เลือก &quot;สร้าง Plan ใหม่&quot;</p>
                      ) : (
                        <select
                          value={selectedPlanId}
                          onChange={e => setSelectedPlanId(e.target.value)}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {existingPlans.map(p => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">ชื่อ Campaign</label>
                      <input
                        type="text"
                        value={newCampaignName}
                        onChange={e => setNewCampaignName(e.target.value)}
                        placeholder={businessName || 'ชื่อ campaign...'}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">ชื่อธุรกิจ</label>
                      <input
                        type="text"
                        value={newPlanName}
                        onChange={e => setNewPlanName(e.target.value)}
                        placeholder={businessName || 'ชื่อธุรกิจ...'}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">งบ/เดือน (฿)</label>
                      <input
                        type="number"
                        value={newPlanBudget}
                        onChange={e => setNewPlanBudget(Number(e.target.value))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  จะบันทึก {keywords.filter(k => k.selected && k.group !== 'negative').length} keywords ที่เลือกอยู่
                </p>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowSavePlanModal(false)}
                    className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={saveToPlanFromModal}
                    disabled={savingModal || (savePlanAction === 'existing' && !selectedPlanId)}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {savingModal ? <><Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก...</> : 'บันทึก'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}

export default function KeywordPlannerPage() {
  return (
    <Suspense>
      <KeywordPlannerContent />
    </Suspense>
  )
}
