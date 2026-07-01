"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import {
  Search, BarChart2, Target, Globe, Activity,
  TrendingUp, TrendingDown, Minus, CheckCircle, X,
  ChevronUp, ChevronDown, Link2, Cpu, RefreshCw,
  DollarSign, Zap, FlaskConical, Download, ExternalLink,
  Eye, EyeOff,
} from "lucide-react"
import { DEMO_BRIEF } from "@/data/seoIntelligenceMockData"

type Tab = "overview" | "keywords" | "competitors" | "rankings" | "backlinks" | "audit" | "ai-visibility"

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview",      label: "Overview",      icon: <Zap size={12} /> },
  { id: "keywords",      label: "Keywords",      icon: <Search size={12} /> },
  { id: "competitors",   label: "Competitors",   icon: <Target size={12} /> },
  { id: "rankings",      label: "Rankings",      icon: <BarChart2 size={12} /> },
  { id: "backlinks",     label: "Backlinks",     icon: <Link2 size={12} /> },
  { id: "audit",         label: "Site Audit",    icon: <Activity size={12} /> },
  { id: "ai-visibility", label: "AI Visibility", icon: <Cpu size={12} /> },
]

// ── Types ─────────────────────────────────────────────────────────────────────
interface KwRow { keyword: string; volume: number; cpc: number; competition: string; competitionIndex: number; difficulty: number; intent: string }
interface RankRow { keyword: string; position: number | null; url: string; top3: { domain: string; title: string; url: string; rank: number }[] }
interface BLSummary { backlinks: number; referringDomains: number; newBacklinks: number; lostBacklinks: number; brokenBacklinks: number; rank: number }
interface BLDomain { domain: string; rank: number; backlinks: number; isNew: boolean; isLost: boolean; firstSeen: string }
interface AuditIssue { issue: string; severity: "High" | "Medium" | "Low"; detail: string; fix: string }
interface AuditResult { url: string; title: string; description: string; h1: string; wordCount: number; loadTime: number; isHttps: boolean; issues: AuditIssue[] }
interface CompetitorResult { domain: string; organicKeywords: number; estimatedTraffic: number; top10: number }
interface CostSummary { totalCost: number; totalCalls: number; todayCost: number; byType: Record<string, { cost: number; calls: number; count: number }> }
interface TrendPoint { month: string; value: number }
interface SerpResult { rank: number; title: string; description: string; url: string; domain: string }
interface AIVisResult { prompt: string; answer: string; mentioned: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────
function SeverityBadge({ s }: { s: string }) {
  const c = s === "High" ? "bg-red-50 text-red-700 border-red-200" : s === "Medium" ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-gray-100 text-gray-500 border-gray-200"
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c}`}>{s}</span>
}
function IntentBadge({ v }: { v: string }) {
  const c: Record<string, string> = { Transactional: "bg-purple-50 text-purple-700", Informational: "bg-blue-50 text-blue-700", Commercial: "bg-orange-50 text-orange-700", Navigational: "bg-green-50 text-green-700", navigational: "bg-green-50 text-green-700" }
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c[v] ?? "bg-gray-100 text-gray-500"}`}>{v}</span>
}
function DiffBar({ v }: { v: number }) {
  const c = v >= 60 ? "bg-red-400" : v >= 40 ? "bg-yellow-400" : "bg-green-400"
  return <div className="flex items-center gap-1.5"><div className="w-14 h-1.5 bg-gray-200 rounded-full"><div className={`h-full rounded-full ${c}`} style={{ width: `${v}%` }} /></div><span className="text-xs text-gray-600">{v}</span></div>
}
function CompBadge({ v }: { v: string }) {
  const c = v === "High" ? "bg-red-50 text-red-600" : v === "Medium" ? "bg-yellow-50 text-yellow-600" : "bg-green-50 text-green-600"
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c}`}>{v}</span>
}
function Spinner() { return <RefreshCw size={13} className="animate-spin inline-block" /> }
function CostBadge({ cost }: { cost: number | null }) {
  if (cost === null) return null
  return <span className="flex items-center gap-0.5 text-[10px] text-gray-400 font-mono"><DollarSign size={9} />{cost.toFixed(4)}</span>
}
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
      <CheckCircle size={15} className="text-green-400 shrink-0" />{msg}
      <button onClick={onClose}><X size={13} /></button>
    </div>
  )
}

// ── Mini sparkline chart (SVG) ────────────────────────────────────────────────
function TrendsChart({ data, keyword }: { data: TrendPoint[]; keyword: string }) {
  if (!data.length) return null
  const W = 480; const H = 100; const PAD = 8
  const max = Math.max(...data.map(d => d.value), 1)
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
    const y = H - PAD - (d.value / max) * (H - PAD * 2)
    return `${x},${y}`
  })
  const polyline = pts.join(" ")
  // Area fill
  const area = `${PAD},${H - PAD} ${polyline} ${W - PAD},${H - PAD}`
  const recent = data.slice(-3)
  const prev = data.slice(-6, -3)
  const avgRecent = recent.reduce((a, b) => a + b.value, 0) / recent.length
  const avgPrev = prev.reduce((a, b) => a + b.value, 0) / prev.length
  const trend = avgRecent > avgPrev ? "up" : avgRecent < avgPrev ? "down" : "flat"

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-gray-900">Search Trends — {keyword}</p>
          <p className="text-[10px] text-gray-400">12 months · Google Trends (DataForSEO)</p>
        </div>
        <div className="flex items-center gap-1.5">
          {trend === "up" && <><TrendingUp size={13} className="text-green-500" /><span className="text-xs text-green-600 font-semibold">Rising</span></>}
          {trend === "down" && <><TrendingDown size={13} className="text-red-500" /><span className="text-xs text-red-600 font-semibold">Declining</span></>}
          {trend === "flat" && <><Minus size={13} className="text-gray-400" /><span className="text-xs text-gray-500 font-semibold">Stable</span></>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#trendGrad)" />
          <polyline points={polyline} fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {data.map((d, i) => {
            const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
            const y = H - PAD - (d.value / max) * (H - PAD * 2)
            return <circle key={i} cx={x} cy={y} r="2.5" fill="#16a34a" />
          })}
        </svg>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-gray-400 flex-wrap">
        {data.slice(-6).map((d, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="font-mono">{d.month}</span>
            <span className="font-bold text-gray-700">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SERP Analysis panel ───────────────────────────────────────────────────────
function SerpPanel({ results, keyword, onClose }: { results: SerpResult[]; keyword: string; onClose: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div>
          <p className="text-xs font-bold text-gray-900">SERP Analysis — {results.length} organic results</p>
          <p className="text-[10px] text-gray-400">"{keyword}"</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg"><X size={13} className="text-gray-400" /></button>
      </div>
      <div className="divide-y divide-gray-50">
        {results.map((r, i) => (
          <div key={i} className="px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-start gap-3">
              <span className={`text-xs font-bold shrink-0 w-5 text-center mt-0.5 ${i < 3 ? "text-green-600" : "text-gray-400"}`}>#{r.rank}</span>
              <div className="min-w-0 flex-1">
                <a href={r.url} target="_blank" rel="noopener" className="text-xs font-semibold text-blue-700 hover:underline truncate block">{r.title}</a>
                <p className="text-[10px] text-green-700 font-mono truncate">{r.domain}</p>
                <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{r.description}</p>
              </div>
              <a href={r.url} target="_blank" rel="noopener" className="shrink-0 p-1 text-gray-300 hover:text-gray-500">
                <ExternalLink size={11} />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Demo Brief Modal ──────────────────────────────────────────────────────────
function DemoBriefModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div><h2 className="text-base font-bold text-gray-900">{DEMO_BRIEF.title}</h2><span className="text-[10px] text-gray-400">Demo Only</span></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="space-y-3 text-sm text-gray-700">
          <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Topic</p><p className="font-medium text-gray-900">{DEMO_BRIEF.topic}</p></div>
          <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Target Intent</p><p>{DEMO_BRIEF.intent}</p></div>
          <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Suggested H1</p><p className="font-medium bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{DEMO_BRIEF.suggestedH1}</p></div>
          <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Sections</p><ol className="space-y-1 pl-4 list-decimal text-gray-700">{DEMO_BRIEF.sections.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">{DEMO_BRIEF.note}</div>
        </div>
        <button onClick={onClose} className="w-full py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700">Close</button>
      </div>
    </div>
  )
}

// ── Cost Panel ────────────────────────────────────────────────────────────────
function CostPanel({ data }: { data: CostSummary | null }) {
  if (!data) return null
  const TYPE_LABEL: Record<string, string> = {
    SEO_LAB_KEYWORDS: "Keywords", SEO_LAB_COMPETITORS: "Competitors",
    SEO_LAB_RANKINGS: "Rankings", SEO_LAB_BACKLINKS: "Backlinks",
    SEO_LAB_AUDIT: "Site Audit", SEO_LAB_TRENDS: "Trends",
    SEO_LAB_SERP: "SERP Analysis", SEO_LAB_AI_VISIBILITY: "AI Visibility",
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <DollarSign size={13} className="text-gray-400" />
        <p className="text-xs font-bold text-gray-700">DataForSEO Cost Tracker</p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div><p className="text-lg font-bold text-gray-900">${data.totalCost.toFixed(4)}</p><p className="text-[10px] text-gray-400">Total spent</p></div>
        <div><p className="text-lg font-bold text-gray-900">${data.todayCost.toFixed(4)}</p><p className="text-[10px] text-gray-400">Today</p></div>
        <div><p className="text-lg font-bold text-gray-900">{data.totalCalls}</p><p className="text-[10px] text-gray-400">API calls</p></div>
      </div>
      {Object.keys(data.byType).length > 0 && (
        <div className="space-y-1 border-t border-gray-100 pt-2">
          {Object.entries(data.byType).map(([t, v]) => (
            <div key={t} className="flex items-center justify-between text-xs text-gray-600">
              <span>{TYPE_LABEL[t] ?? t}</span>
              <span className="font-mono text-gray-900">${v.cost.toFixed(4)} <span className="text-gray-400">({v.calls})</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Export CSV util ───────────────────────────────────────────────────────────
function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n")
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SEOIntelligenceLabClient() {
  const [tab, setTab]           = useState<Tab>("overview")
  const [showBrief, setShowBrief] = useState(false)
  const [toast, setToast]       = useState<string | null>(null)
  const [domain, setDomain]     = useState("")
  const [kwSeeds, setKwSeeds]   = useState("")

  // Keywords
  const [kwRows, setKwRows]         = useState<KwRow[]>([])
  const [kwLoading, setKwLoading]   = useState(false)
  const [kwCost, setKwCost]         = useState<number | null>(null)
  const [kwSearch, setKwSearch]     = useState("")
  const [kwIntent, setKwIntent]     = useState("All")
  const [kwSort, setKwSort]         = useState<"volume" | "difficulty">("volume")
  const [kwDir, setKwDir]           = useState<"desc" | "asc">("desc")
  // Trends
  const [trendsKw, setTrendsKw]     = useState("")
  const [trendsData, setTrendsData] = useState<TrendPoint[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  // SERP analysis
  const [serpKw, setSerpKw]         = useState("")
  const [serpResults, setSerpResults] = useState<SerpResult[]>([])
  const [serpLoading, setSerpLoading] = useState(false)
  const [serpCost, setSerpCost]     = useState<number | null>(null)
  const [showSerp, setShowSerp]     = useState(false)

  // Competitors
  const [compTarget, setCompTarget]   = useState<CompetitorResult | null>(null)
  const [compList, setCompList]       = useState<CompetitorResult[]>([])
  const [compLoading, setCompLoading] = useState(false)
  const [compCost, setCompCost]       = useState<number | null>(null)
  const [compDomains, setCompDomains] = useState("")

  // Rankings
  const [rankRows, setRankRows]       = useState<RankRow[]>([])
  const [rankLoading, setRankLoading] = useState(false)
  const [rankCost, setRankCost]       = useState<number | null>(null)
  const [rankKws, setRankKws]         = useState("")

  // Backlinks
  const [blSummary, setBlSummary]   = useState<BLSummary | null>(null)
  const [blDomains, setBlDomains]   = useState<BLDomain[]>([])
  const [blLoading, setBlLoading]   = useState(false)
  const [blCost, setBlCost]         = useState<number | null>(null)

  // Audit
  const [auditUrl, setAuditUrl]       = useState("")
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditCost, setAuditCost]     = useState<number | null>(null)

  // AI Visibility
  const [aiBrand, setAiBrand]         = useState("")
  const [aiPrompts, setAiPrompts]     = useState("")
  const [aiResults, setAiResults]     = useState<AIVisResult[]>([])
  const [aiScore, setAiScore]         = useState<number | null>(null)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiCost, setAiCost]           = useState<number | null>(null)
  const [showAnswers, setShowAnswers] = useState<Record<number, boolean>>({})

  // Cost summary
  const [costData, setCostData] = useState<CostSummary | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const fetchCost = useCallback(async () => {
    const r = await fetch("/api/seo-lab/cost"); if (r.ok) setCostData(await r.json())
  }, [])
  useEffect(() => { fetchCost() }, [fetchCost])

  // ── Keywords ────────────────────────────────────────────────────────────────
  const runKeywords = async () => {
    if (!kwSeeds.trim()) return showToast("ใส่ keywords ก่อน")
    setKwLoading(true); setKwRows([])
    const seeds = kwSeeds.split(",").map(s => s.trim()).filter(Boolean)
    const r = await fetch("/api/seo-lab/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seeds }) })
    const d = await r.json()
    if (r.ok) { setKwRows(d.keywords); setKwCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setKwLoading(false)
  }

  // ── Trends ──────────────────────────────────────────────────────────────────
  const runTrends = async (kw?: string) => {
    const keyword = kw ?? trendsKw.trim() ?? kwSeeds.split(",")[0]?.trim()
    if (!keyword) return showToast("ใส่ keyword ก่อน")
    setTrendsLoading(true); setTrendsData([])
    const r = await fetch("/api/seo-lab/trends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword }) })
    const d = await r.json()
    if (r.ok) { setTrendsData(d.timeline); setTrendsKw(keyword); fetchCost() }
    else showToast(d.error ?? "Error")
    setTrendsLoading(false)
  }

  // ── SERP Analysis ───────────────────────────────────────────────────────────
  const runSerp = async (kw?: string) => {
    const keyword = kw ?? serpKw.trim()
    if (!keyword) return showToast("ใส่ keyword ก่อน")
    setSerpLoading(true); setSerpResults([]); setShowSerp(false)
    const r = await fetch("/api/seo-lab/serp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword }) })
    const d = await r.json()
    if (r.ok) { setSerpResults(d.results); setSerpKw(keyword); setSerpCost(d.cost); setShowSerp(true); fetchCost() }
    else showToast(d.error ?? "Error")
    setSerpLoading(false)
  }

  // ── Competitors ─────────────────────────────────────────────────────────────
  const runCompetitors = async () => {
    if (!domain.trim()) return showToast("ใส่ domain ก่อน")
    setCompLoading(true); setCompTarget(null); setCompList([])
    const competitors = compDomains.split(",").map(s => s.trim()).filter(Boolean)
    const r = await fetch("/api/seo-lab/competitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: domain.trim(), competitors }) })
    const d = await r.json()
    if (r.ok) { setCompTarget(d.target); setCompList(d.competitors); setCompCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setCompLoading(false)
  }

  // ── Rankings ────────────────────────────────────────────────────────────────
  const runRankings = async () => {
    if (!rankKws.trim()) return showToast("ใส่ keywords ก่อน")
    setRankLoading(true); setRankRows([])
    const keywords = rankKws.split(",").map(s => s.trim()).filter(Boolean)
    const r = await fetch("/api/seo-lab/rankings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, domain: domain.trim() }) })
    const d = await r.json()
    if (r.ok) { setRankRows(d.rankings); setRankCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setRankLoading(false)
  }

  // ── Backlinks ───────────────────────────────────────────────────────────────
  const runBacklinks = async () => {
    if (!domain.trim()) return showToast("ใส่ domain ก่อน")
    setBlLoading(true); setBlSummary(null); setBlDomains([])
    const r = await fetch("/api/seo-lab/backlinks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: domain.trim() }) })
    const d = await r.json()
    if (r.ok) { setBlSummary(d.summary); setBlDomains(d.referringDomains); setBlCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setBlLoading(false)
  }

  // ── Audit ────────────────────────────────────────────────────────────────────
  const runAudit = async () => {
    const url = auditUrl.trim() || domain.trim()
    if (!url) return showToast("ใส่ URL ก่อน")
    setAuditLoading(true); setAuditResult(null)
    const r = await fetch("/api/seo-lab/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
    const d = await r.json()
    if (r.ok) { setAuditResult(d); setAuditCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setAuditLoading(false)
  }

  // ── AI Visibility ────────────────────────────────────────────────────────────
  const runAiVisibility = async () => {
    const brand = aiBrand.trim() || domain.trim()
    if (!brand) return showToast("ใส่ Brand name หรือ domain ก่อน")
    setAiLoading(true); setAiResults([]); setAiScore(null)
    const customPrompts = aiPrompts.split("\n").map(s => s.trim()).filter(Boolean)
    const r = await fetch("/api/seo-lab/ai-visibility", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, domain: domain.trim(), prompts: customPrompts.length ? customPrompts : undefined }),
    })
    const d = await r.json()
    if (r.ok) { setAiResults(d.results); setAiScore(d.visibilityScore); setAiCost(d.cost); fetchCost() }
    else showToast(d.error ?? "Error")
    setAiLoading(false)
  }

  // ── Keyword filter/sort ──────────────────────────────────────────────────────
  const allIntents = ["All", ...Array.from(new Set(kwRows.map(k => k.intent)))]
  const filtered = useMemo(() => {
    let rows = kwRows.filter(k => {
      const ms = k.keyword.toLowerCase().includes(kwSearch.toLowerCase())
      const mi = kwIntent === "All" || k.intent === kwIntent
      return ms && mi
    })
    return [...rows].sort((a, b) => {
      const v = kwSort === "volume" ? b.volume - a.volume : b.difficulty - a.difficulty
      return kwDir === "desc" ? v : -v
    })
  }, [kwRows, kwSearch, kwIntent, kwSort, kwDir])

  const toggleSort = (col: "volume" | "difficulty") => {
    if (kwSort === col) setKwDir(d => d === "desc" ? "asc" : "desc")
    else { setKwSort(col); setKwDir("desc") }
  }
  const SortIcon = ({ col }: { col: "volume" | "difficulty" }) =>
    kwSort !== col ? <ChevronDown size={11} className="text-gray-300" />
    : kwDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />

  const DomainBar = () => (
    <div className="relative">
      <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com"
        className="pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400 w-52" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-16">
      {showBrief && <DemoBriefModal onClose={() => setShowBrief(false)} />}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <FlaskConical size={17} className="text-gray-500" />
              <h1 className="text-lg font-bold text-gray-900">SEO Intelligence Lab</h1>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 uppercase tracking-wide">Live Data</span>
            </div>
            <button onClick={() => setShowBrief(true)} className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Demo Brief</button>
          </div>

          {/* Global domain */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
            <p className="text-xs text-gray-500 font-medium shrink-0">Domain:</p>
            <div className="relative">
              <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="example.com (ใช้ร่วมกันทุก tab)"
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400 w-64" />
            </div>
            <p className="text-[10px] text-gray-400">ใส่ครั้งเดียว ใช้ได้กับ Competitors / Rankings / Backlinks / AI Visibility</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${tab === t.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-5 space-y-5">

        {/* OVERVIEW */}
        {tab === "overview" && (
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><Zap size={14} />เริ่มใช้งาน</p>
                <p className="text-xs text-gray-500 leading-relaxed">1. ใส่ domain ในช่องด้านบน → 2. เลือก tab → 3. กด Analyze</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Keyword Research",  icon: <Search size={14}/>,  tab: "keywords" as Tab,      desc: "Ideas + Volume + Trends + SERP" },
                  { label: "Competitors",       icon: <Target size={14}/>,  tab: "competitors" as Tab,   desc: "Domain traffic + keyword gaps" },
                  { label: "Rank Tracking",     icon: <BarChart2 size={14}/>,tab: "rankings" as Tab,     desc: "Live SERP positions" },
                  { label: "Backlinks",         icon: <Link2 size={14}/>,   tab: "backlinks" as Tab,     desc: "Referring domains + quality" },
                  { label: "Site Audit",        icon: <Activity size={14}/>,tab: "audit" as Tab,         desc: "Technical on-page issues" },
                  { label: "AI Visibility",     icon: <Cpu size={14}/>,     tab: "ai-visibility" as Tab, desc: "Brand presence in AI answers" },
                ].map(c => (
                  <button key={c.tab} onClick={() => setTab(c.tab)}
                    className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-900 hover:shadow-sm transition-all space-y-2">
                    <div className="text-gray-500">{c.icon}</div>
                    <p className="text-xs font-semibold text-gray-900">{c.label}</p>
                    <p className="text-[10px] text-gray-400">{c.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <CostPanel data={costData} />
          </div>
        )}

        {/* KEYWORDS */}
        {tab === "keywords" && (
          <div className="space-y-4">
            {/* Input */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Keyword Research</p>
                {kwRows.length > 0 && (
                  <button onClick={() => exportCSV(`keywords-${Date.now()}.csv`,
                    ["Keyword", "Volume", "CPC", "Competition", "Difficulty", "Intent"],
                    filtered.map(k => [k.keyword, k.volume, k.cpc, k.competition, k.difficulty, k.intent])
                  )} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    <Download size={11} /> Export CSV
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-48">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={kwSeeds} onChange={e => setKwSeeds(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runKeywords()}
                    placeholder="seo, รับทำ seo, local seo (คั่นด้วย ,)"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                </div>
                <button onClick={runKeywords} disabled={kwLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {kwLoading ? <Spinner /> : <Search size={12} />} Search
                </button>
              </div>
              <p className="text-[10px] text-gray-400">สูงสุด 5 seed keywords · DataForSEO Labs keyword_ideas</p>
            </div>

            {/* Search Trends input */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Search Trends</p>
              <div className="flex gap-2">
                <input value={trendsKw} onChange={e => setTrendsKw(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runTrends()}
                  placeholder="keyword เดียว เช่น รับทำ seo"
                  className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                {kwRows.length > 0 && (
                  <select onChange={e => e.target.value && runTrends(e.target.value)}
                    className="px-2 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none">
                    <option value="">จาก results ↑</option>
                    {kwRows.slice(0, 10).map(k => <option key={k.keyword} value={k.keyword}>{k.keyword}</option>)}
                  </select>
                )}
                <button onClick={() => runTrends()} disabled={trendsLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {trendsLoading ? <Spinner /> : <TrendingUp size={12} />} Trends
                </button>
              </div>
              {trendsData.length > 0 && <TrendsChart data={trendsData} keyword={trendsKw} />}
            </div>

            {/* SERP Analysis input */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-700">SERP Analysis</p>
              <div className="flex gap-2">
                <input value={serpKw} onChange={e => setSerpKw(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runSerp()}
                  placeholder="keyword เดียวเพื่อดู top 10 SERP"
                  className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                {kwRows.length > 0 && (
                  <select onChange={e => e.target.value && runSerp(e.target.value)}
                    className="px-2 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none">
                    <option value="">จาก results ↑</option>
                    {kwRows.slice(0, 10).map(k => <option key={k.keyword} value={k.keyword}>{k.keyword}</option>)}
                  </select>
                )}
                <button onClick={() => runSerp()} disabled={serpLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {serpLoading ? <Spinner /> : <Search size={12} />} SERP
                </button>
              </div>
              {showSerp && serpResults.length > 0 && (
                <SerpPanel results={serpResults} keyword={serpKw} onClose={() => setShowSerp(false)} />
              )}
              {serpCost && <div className="flex justify-end"><CostBadge cost={serpCost} /></div>}
            </div>

            {/* Keywords table */}
            {kwRows.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 items-center justify-between">
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={kwSearch} onChange={e => setKwSearch(e.target.value)}
                        placeholder="Filter..." className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white outline-none w-40" />
                    </div>
                    <select value={kwIntent} onChange={e => setKwIntent(e.target.value)}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white outline-none">
                      {allIntents.map(i => <option key={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{filtered.length} keywords</span>
                    <CostBadge cost={kwCost} />
                  </div>
                </div>
                <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                      <th className="text-left px-4 py-3 font-medium">Keyword</th>
                      <th className="text-right px-4 py-3 font-medium">
                        <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("volume")}>Vol <SortIcon col="volume" /></button>
                      </th>
                      <th className="text-right px-4 py-3 font-medium">CPC</th>
                      <th className="text-center px-4 py-3 font-medium">Comp.</th>
                      <th className="text-left px-4 py-3 font-medium">
                        <button className="flex items-center gap-1" onClick={() => toggleSort("difficulty")}>Difficulty <SortIcon col="difficulty" /></button>
                      </th>
                      <th className="text-center px-4 py-3 font-medium">Intent</th>
                      <th className="text-center px-4 py-3 font-medium">Actions</th>
                    </tr></thead>
                    <tbody>
                      {filtered.map((k, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 group">
                          <td className="px-4 py-3 font-medium text-gray-900">{k.keyword}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{k.volume.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-gray-600">${k.cpc.toFixed(2)}</td>
                          <td className="px-4 py-3 text-center"><CompBadge v={k.competition} /></td>
                          <td className="px-4 py-3"><DiffBar v={k.difficulty} /></td>
                          <td className="px-4 py-3 text-center"><IntentBadge v={k.intent} /></td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => runTrends(k.keyword)} title="Trends"
                                className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded">
                                <TrendingUp size={11} />
                              </button>
                              <button onClick={() => runSerp(k.keyword)} title="SERP"
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                <Search size={11} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่พบผลลัพธ์</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* COMPETITORS */}
        {tab === "competitors" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Competitor Analysis</p>
                {(compTarget || compList.length > 0) && (
                  <button onClick={() => exportCSV(`competitors-${Date.now()}.csv`,
                    ["Domain", "Organic Keywords", "Est. Traffic", "Top 10 Keywords"],
                    [compTarget, ...compList].filter(Boolean).map(c => [c!.domain, c!.organicKeywords, c!.estimatedTraffic, c!.top10])
                  )} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    <Download size={11} /> Export CSV
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <DomainBar />
                <div className="relative flex-1 min-w-48">
                  <input value={compDomains} onChange={e => setCompDomains(e.target.value)}
                    placeholder="competitor1.com, competitor2.com (optional)"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                </div>
                <button onClick={runCompetitors} disabled={compLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {compLoading ? <Spinner /> : <Target size={12} />} Analyze
                </button>
              </div>
            </div>
            {(compTarget || compList.length > 0) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">Domain Overview</p>
                  <CostBadge cost={compCost} />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[compTarget, ...compList].filter(Boolean).map((c, i) => c && (
                    <div key={i} className={`bg-white border rounded-xl p-4 space-y-3 ${i === 0 ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"}`}>
                      <div className="flex items-center gap-2">
                        <Globe size={12} className="text-gray-400 shrink-0" />
                        <p className="text-xs font-bold text-gray-900 truncate">{c.domain}</p>
                        {i === 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full shrink-0">You</span>}
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-gray-500">Organic KWs</span><span className="font-bold text-gray-900">{c.organicKeywords.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Est. Traffic</span><span className="font-bold text-gray-900">{c.estimatedTraffic.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Top 10 KWs</span><span className="font-bold text-gray-900">{c.top10.toLocaleString()}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* RANKINGS */}
        {tab === "rankings" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Rank Tracking</p>
                {rankRows.length > 0 && (
                  <button onClick={() => exportCSV(`rankings-${Date.now()}.csv`,
                    ["Keyword", "Position", "URL"],
                    rankRows.map(r => [r.keyword, r.position ?? "Not found", r.url])
                  )} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    <Download size={11} /> Export CSV
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <DomainBar />
                <div className="relative flex-1 min-w-48">
                  <input value={rankKws} onChange={e => setRankKws(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runRankings()}
                    placeholder="รับทำ seo, seo คืออะไร (คั่นด้วย ,)"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                </div>
                <button onClick={runRankings} disabled={rankLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {rankLoading ? <Spinner /> : <BarChart2 size={12} />} Check
                </button>
              </div>
            </div>
            {rankRows.length > 0 && (
              <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-700">SERP Positions</p>
                  <CostBadge cost={rankCost} />
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                    <th className="text-left px-4 py-3 font-medium">Keyword</th>
                    <th className="text-center px-4 py-3 font-medium">Position</th>
                    <th className="text-left px-4 py-3 font-medium">Your URL</th>
                    <th className="text-left px-4 py-3 font-medium">Top 3</th>
                    <th className="text-center px-4 py-3 font-medium">SERP</th>
                  </tr></thead>
                  <tbody>
                    {rankRows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.keyword}</td>
                        <td className="px-4 py-3 text-center">
                          {r.position
                            ? <span className={`font-bold text-sm ${r.position <= 3 ? "text-green-600" : r.position <= 10 ? "text-blue-600" : "text-gray-500"}`}>#{r.position}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-blue-600 truncate max-w-[180px] font-mono text-[10px]">{r.url || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {r.top3.map((t, j) => (
                              <div key={j} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                                <span className="font-bold text-gray-700">#{t.rank}</span>
                                <span className="truncate max-w-[120px]">{t.domain}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => runSerp(r.keyword)} className="p-1 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded" title="SERP Analysis">
                            <Search size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showSerp && serpResults.length > 0 && (
              <SerpPanel results={serpResults} keyword={serpKw} onClose={() => setShowSerp(false)} />
            )}
          </div>
        )}

        {/* BACKLINKS */}
        {tab === "backlinks" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Backlink Intelligence</p>
                {blDomains.length > 0 && (
                  <button onClick={() => exportCSV(`backlinks-${Date.now()}.csv`,
                    ["Domain", "Rank", "Backlinks", "Status", "First Seen"],
                    blDomains.map(d => [d.domain, d.rank, d.backlinks, d.isNew ? "New" : d.isLost ? "Lost" : "Existing", d.firstSeen])
                  )} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    <Download size={11} /> Export CSV
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <DomainBar />
                <button onClick={runBacklinks} disabled={blLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {blLoading ? <Spinner /> : <Link2 size={12} />} Analyze
                </button>
              </div>
            </div>
            {blSummary && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">Summary — {domain}</p>
                  <CostBadge cost={blCost} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { l: "Backlinks",        v: blSummary.backlinks },
                    { l: "Ref. Domains",     v: blSummary.referringDomains },
                    { l: "New",              v: blSummary.newBacklinks },
                    { l: "Lost",             v: blSummary.lostBacklinks },
                    { l: "Broken",           v: blSummary.brokenBacklinks },
                    { l: "Domain Rank",      v: blSummary.rank },
                  ].map(s => (
                    <div key={s.l} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-gray-900">{s.v.toLocaleString()}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{s.l}</p>
                    </div>
                  ))}
                </div>
                {blDomains.length > 0 && (
                  <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
                    <p className="text-xs font-semibold text-gray-700 px-4 py-3 border-b border-gray-100">Top Referring Domains</p>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                        <th className="text-left px-4 py-3 font-medium">Domain</th>
                        <th className="text-center px-4 py-3 font-medium">Rank</th>
                        <th className="text-center px-4 py-3 font-medium">Backlinks</th>
                        <th className="text-center px-4 py-3 font-medium">Status</th>
                        <th className="text-left px-4 py-3 font-medium">First Seen</th>
                      </tr></thead>
                      <tbody>
                        {blDomains.map((d, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{d.domain}</td>
                            <td className="px-4 py-3 text-center font-bold text-gray-700">{d.rank}</td>
                            <td className="px-4 py-3 text-center text-gray-600">{d.backlinks}</td>
                            <td className="px-4 py-3 text-center">
                              {d.isNew  && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">New</span>}
                              {d.isLost && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700">Lost</span>}
                              {!d.isNew && !d.isLost && <span className="text-[10px] text-gray-400">Active</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-400 font-mono text-[10px]">{d.firstSeen}</td>
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

        {/* SITE AUDIT */}
        {tab === "audit" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Site Audit — Instant Page Analysis</p>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-48">
                  <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={auditUrl} onChange={e => setAuditUrl(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runAudit()}
                    placeholder={domain ? `${domain}` : "https://example.com"}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                </div>
                <button onClick={runAudit} disabled={auditLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {auditLoading ? <Spinner /> : <Activity size={12} />} Audit
                </button>
              </div>
            </div>
            {auditResult && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">{auditResult.issues.length} issues — {auditResult.url}</p>
                  <div className="flex items-center gap-2">
                    <CostBadge cost={auditCost} />
                    {auditResult.issues.length > 0 && (
                      <button onClick={() => exportCSV(`audit-${Date.now()}.csv`,
                        ["Issue", "Severity", "Detail", "Fix"],
                        auditResult.issues.map(a => [a.issue, a.severity, a.detail, a.fix])
                      )} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                        <Download size={11} /> Export
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400">Title</p>
                    <p className="text-xs font-medium text-gray-900 truncate mt-0.5">{auditResult.title || "—"}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400">H1</p>
                    <p className="text-xs font-medium text-gray-900 truncate mt-0.5">{auditResult.h1 || "—"}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400">Word Count</p>
                    <p className="text-lg font-bold text-gray-900">{auditResult.wordCount}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    <p className="text-[10px] text-gray-400">Load Time</p>
                    <p className={`text-lg font-bold ${auditResult.loadTime > 3 ? "text-red-600" : auditResult.loadTime > 1 ? "text-yellow-600" : "text-green-600"}`}>{auditResult.loadTime}s</p>
                  </div>
                </div>
                {auditResult.issues.length > 0 ? (
                  <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                        <th className="text-left px-4 py-3 font-medium">Issue</th>
                        <th className="text-center px-4 py-3 font-medium">Severity</th>
                        <th className="text-left px-4 py-3 font-medium">Detail</th>
                        <th className="text-left px-4 py-3 font-medium">Fix</th>
                      </tr></thead>
                      <tbody>
                        {auditResult.issues.map((a, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{a.issue}</td>
                            <td className="px-4 py-3 text-center"><SeverityBadge s={a.severity} /></td>
                            <td className="px-4 py-3 text-gray-600">{a.detail}</td>
                            <td className="px-4 py-3 text-gray-600">{a.fix}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-3">
                    <CheckCircle size={18} className="text-green-500 shrink-0" />
                    <p className="text-sm text-green-700 font-medium">ไม่พบ issues — หน้านี้ผ่าน on-page checks ทั้งหมด</p>
                  </div>
                )}
              </>
            )}
            {!auditResult && !auditLoading && (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center space-y-1">
                <Activity size={24} className="text-gray-300 mx-auto" />
                <p className="text-sm text-gray-500">ใส่ URL แล้วกด Audit</p>
              </div>
            )}
          </div>
        )}

        {/* AI VISIBILITY */}
        {tab === "ai-visibility" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-700">AI Visibility — Brand Presence in AI Answers</p>
                <p className="text-[10px] text-gray-400 mt-0.5">ทดสอบว่า Brand ของคุณปรากฏใน AI answers หรือไม่ (Claude Haiku)</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <DomainBar />
                <input value={aiBrand} onChange={e => setAiBrand(e.target.value)}
                  placeholder="Brand name เช่น Mars SEO (ถ้าว่างใช้ domain)"
                  className="flex-1 min-w-48 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400" />
                <button onClick={runAiVisibility} disabled={aiLoading}
                  className="px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                  {aiLoading ? <Spinner /> : <Cpu size={12} />} Test
                </button>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Custom Prompts (แต่ละบรรทัดคือ 1 prompt — ไม่ใส่ใช้ default)</label>
                <textarea value={aiPrompts} onChange={e => setAiPrompts(e.target.value)}
                  rows={3} placeholder={"What are the best SEO agencies in Thailand?\nRecommend SEO tools for small businesses"}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-gray-400 resize-none font-mono" />
              </div>
            </div>

            {aiScore !== null && (
              <>
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">AI Visibility Score</p>
                      <p className={`text-4xl font-bold mt-1 ${aiScore >= 60 ? "text-green-600" : aiScore >= 30 ? "text-yellow-600" : "text-red-500"}`}>{aiScore}%</p>
                      <p className="text-[10px] text-gray-400 mt-1">Brand mentioned in {aiResults.filter(r => r.mentioned).length} of {aiResults.length} AI responses</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <CostBadge cost={aiCost} />
                      <div className={`w-24 h-24 rounded-full border-8 flex items-center justify-center ${aiScore >= 60 ? "border-green-400" : aiScore >= 30 ? "border-yellow-400" : "border-red-400"}`}>
                        <span className="text-lg font-bold text-gray-700">{aiScore}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-700">AI Response Detail</p>
                  {aiResults.map((r, i) => (
                    <div key={i} className={`bg-white border rounded-xl p-4 space-y-2 ${r.mentioned ? "border-green-200" : "border-gray-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          {r.mentioned
                            ? <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
                            : <X size={14} className="text-red-400 mt-0.5 shrink-0" />}
                          <p className="text-xs text-gray-700 font-medium">{r.prompt}</p>
                        </div>
                        <button onClick={() => setShowAnswers(prev => ({ ...prev, [i]: !prev[i] }))}
                          className="p-1 text-gray-400 hover:text-gray-600 shrink-0">
                          {showAnswers[i] ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                      {showAnswers[i] && (
                        <div className="ml-5 pl-3 border-l-2 border-gray-100">
                          <p className="text-[11px] text-gray-600 leading-relaxed">{r.answer}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {aiScore === null && !aiLoading && (
              <div className="bg-white border border-gray-200 rounded-xl p-10 text-center space-y-3">
                <Cpu size={32} className="text-gray-200 mx-auto" />
                <p className="text-sm font-semibold text-gray-600">ทดสอบ AI Visibility ของ Brand คุณ</p>
                <p className="text-xs text-gray-400 max-w-sm mx-auto">ระบบจะส่ง prompts ไปยัง Claude AI แล้วตรวจสอบว่า Brand ของคุณถูกกล่าวถึงหรือไม่</p>
              </div>
            )}
          </div>
        )}

        {/* Cost panel */}
        {tab !== "overview" && costData && (
          <div className="pt-2">
            <CostPanel data={costData} />
          </div>
        )}
      </div>
    </div>
  )
}
