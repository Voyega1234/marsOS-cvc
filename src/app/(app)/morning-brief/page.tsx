'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { MorningBrief } from '@/lib/mock-data/morning-brief'
import {
  AlertTriangle, CheckCircle2, XCircle, ChevronRight, Clock, Zap, Info,
  Newspaper, TrendingUp, RefreshCw, ExternalLink,
} from 'lucide-react'

const LEVEL_CONFIG = {
  critical: {
    border: 'border-red-200 bg-red-50/40',
    icon: XCircle,
    iconColor: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    border: 'border-amber-200 bg-amber-50/20',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    badge: 'bg-amber-100 text-amber-700',
  },
  ok: {
    border: 'border-emerald-200 bg-emerald-50/10',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
  },
}

// ─── Mars News types ────────────────────────────────────────────────────────

interface NewsCategory {
  category_id: string
  category_name: string
  category_name_th: string
  status: string
  news_title: string
  source: string
  reference_url: string
  published: string
  trend_signal: string
  why_it_matters: string
  content_angle: string[]
  suitable_sites: { site_key: string; client_name: string; url: string }[]
  suggested_title?: string
  suggested_keyword?: string
}

interface SeoUpdate { title: string; source: string; link: string; age: string }

interface MarsNewsData {
  date: string
  date_iso: string
  sources_checked: string[]
  categories: NewsCategory[]
  seo_updates: { items: SeoUpdate[]; has_meaningful: boolean }
  empty_categories: string[]
  available_dates: string[]
  error?: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  strong_opportunity:  { label: 'โอกาสสูง',         color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
  refresh_opportunity: { label: 'ควร Refresh',      color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200' },
  watch:               { label: 'Watch',             color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200' },
  human_review:        { label: 'ตรวจสอบเอง',        color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200' },
}

const CATEGORY_EMOJI: Record<string, string> = {
  beauty_personal_care: '🌸', food_beverage: '🍽️', baby_kids_maternity: '🍼',
  household_products: '🧼', consumer_electronics: '💻', games: '🎮',
  health: '🏥', home_improvement: '🏡', education: '🎓', financial_services: '💰',
  app_software_websites: '🧩', pets: '🐶', business_services: '🏢',
  travel_transportation: '✈️', vehicles: '🚗', fintech: '🏦',
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.watch
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {cfg.label}
    </span>
  )
}

function NewsCard({ cat, defaultOpen = false }: { cat: NewsCategory; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const emoji = CATEGORY_EMOJI[cat.category_id] ?? '📰'
  const cfg = STATUS_CONFIG[cat.status] ?? STATUS_CONFIG.watch

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${cfg.border}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
      >
        <span className="text-xl shrink-0 mt-0.5">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-gray-900">{cat.category_name_th || cat.category_name}</span>
            <StatusPill status={cat.status} />
            {cat.published && <span className="text-[10px] text-gray-400">{cat.published}</span>}
          </div>
          <p className="text-xs text-gray-600 line-clamp-2 leading-4">{cat.news_title}</p>
        </div>
        <ChevronRight size={14} className={`shrink-0 text-gray-400 mt-1 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className={`px-4 pb-4 border-t ${cfg.border} pt-3 space-y-3 ${cfg.bg}`}>
          {cat.reference_url ? (
            <a href={cat.reference_url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-2 text-sm font-medium text-blue-700 hover:text-blue-900 transition-colors">
              <ExternalLink size={13} className="shrink-0 mt-0.5" />
              <span>{cat.news_title}</span>
            </a>
          ) : (
            <p className="text-sm font-medium text-gray-800">{cat.news_title}</p>
          )}
          {cat.source && <div className="text-xs text-gray-500">{cat.source}</div>}

          {cat.why_it_matters && (
            <div className="bg-white/70 rounded-lg p-3 border border-white">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">ทำไมถึงสำคัญ</div>
              <ul className="space-y-1">
                {cat.why_it_matters.split(' · ').filter(Boolean).map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700 leading-5">
                    <span className="text-blue-400 shrink-0 mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cat.trend_signal && (
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <TrendingUp size={12} className="shrink-0 mt-0.5 text-blue-400" />
              <span>{cat.trend_signal}</span>
            </div>
          )}

          {cat.content_angle?.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">แนะนำทำ</div>
              <ul className="space-y-1">
                {cat.content_angle.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="text-emerald-500 shrink-0 mt-0.5">›</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(cat.suggested_title || cat.suggested_keyword) && (
            <div className="bg-gray-900/5 rounded-lg p-3 space-y-1.5 border border-gray-200">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">แนะนำสำหรับ Content Studio</div>
              {cat.suggested_title && (
                <div className="text-xs">
                  <span className="text-gray-400 mr-1">Title:</span>
                  <span className="font-medium text-gray-800">{cat.suggested_title}</span>
                </div>
              )}
              {cat.suggested_keyword && (
                <div className="text-xs">
                  <span className="text-gray-400 mr-1">Keyword:</span>
                  <span className="font-medium text-blue-700">{cat.suggested_keyword}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Link
              href={`/content-studio?title=${encodeURIComponent(cat.suggested_title ?? cat.news_title)}&keyword=${encodeURIComponent(cat.suggested_keyword ?? cat.category_name)}`}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              ✍️ เขียนใน Content Studio
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function MorningBriefPage() {
  const [brief, setBrief] = useState<MorningBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(true)
  const [marsData, setMarsData] = useState<MarsNewsData | null>(null)
  const [marsLoading, setMarsLoading] = useState(true)
  const [marsError, setMarsError] = useState<string | null>(null)
  const [newsFilter, setNewsFilter] = useState<string>('all')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    setBriefLoading(true)
    fetch('/api/morning-brief')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBrief(d) })
      .catch(() => {})
      .finally(() => setBriefLoading(false))
  }, [])

  const fetchMarsNews = useCallback(async (date?: string) => {
    setMarsLoading(true)
    setMarsError(null)
    try {
      const url = `/api/mars/news${date ? `?date=${date}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.error && !data.categories?.length) setMarsError(data.error)
      else setMarsData(data)
    } catch (e: unknown) {
      setMarsError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setMarsLoading(false)
    }
  }, [])

  useEffect(() => { fetchMarsNews(selectedDate || undefined) }, [selectedDate, fetchMarsNews])

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const res = await fetch('/api/mars/generate', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setGenerateResult({
          ok: true,
          message: `✅ สร้างเสร็จ ${data.date} · พบ ${data.categories_found} หมวด · Trending TH: ${data.trending_count} คำ · ${(data.elapsed_ms / 1000).toFixed(1)}s`,
        })
        await fetchMarsNews(undefined)
      } else {
        setGenerateResult({ ok: false, message: data.error ?? 'เกิดข้อผิดพลาด' })
      }
    } catch (e) {
      setGenerateResult({ ok: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' })
    } finally {
      setGenerating(false)
    }
  }

  if (briefLoading) return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center space-y-2">
        <RefreshCw size={24} className="text-gray-300 animate-spin mx-auto" />
        <p className="text-sm text-gray-400">กำลังโหลด Morning Brief...</p>
      </div>
    </div>
  )

  if (!brief) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-sm text-gray-400">ไม่สามารถโหลดข้อมูลได้ ลองรีเฟรชหน้า</p>
    </div>
  )

  const time = new Date(brief.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  const date = new Date(brief.generatedAt).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const filteredCategories = marsData?.categories.filter(c => newsFilter === 'all' || c.status === newsFilter) ?? []
  const priorityCounts = marsData?.categories.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1; return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Zap size={15} className="text-amber-500" />
          <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Morning Brief</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{date}</h1>
        <div className="flex items-center gap-2 mt-1">
          <Clock size={12} className="text-gray-400" />
          <p className="text-sm text-gray-500">สร้างโดย Mars AI เวลา {time} · อัตโนมัติทุกวัน 07:00</p>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-red-600 tabular-nums">{brief.criticalCount}</div>
          <div className="text-xs text-red-600 font-medium mt-0.5">Critical</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-600 tabular-nums">{brief.warningCount}</div>
          <div className="text-xs text-amber-600 font-medium mt-0.5">Warning</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-emerald-600 tabular-nums">{brief.alerts.filter(a => a.level === 'ok').length}</div>
          <div className="text-xs text-emerald-600 font-medium mt-0.5">On track</div>
        </div>
      </div>

      {/* AI Summary */}
      <div className="bg-gray-950 text-gray-100 rounded-2xl px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Info size={13} className="text-gray-400 shrink-0" />
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">AI Summary</span>
        </div>
        <p className="text-sm leading-6">{brief.aiSummary}</p>
        <p className="text-[10px] text-gray-500 mt-2">แหล่งข้อมูล: {brief.source}</p>
      </div>

      {/* Alert cards */}
      <div className="space-y-3">
        {brief.alerts.map(alert => {
          const cfg = LEVEL_CONFIG[alert.level]
          const Icon = cfg.icon
          return (
            <div key={alert.id} className={`rounded-2xl border ${cfg.border} overflow-hidden`}>
              <div className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <Icon size={16} className={`${cfg.iconColor} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{alert.project}</span>
                      {alert.metric && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                          {alert.metric}{alert.metricDelta && ` · ${alert.metricDelta}`}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-5">{alert.detail}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Link href={alert.href}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-900 hover:text-gray-600 transition-colors">
                    {alert.action} <ChevronRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ══════════════════════════════════════════
          MARS SEO NEWS INTELLIGENCE
          ══════════════════════════════════════════ */}
      <div className="border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Newspaper size={16} className="text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900">Mars SEO News Intelligence</h2>
            {marsData?.date && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{marsData.date}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {marsData?.available_dates && marsData.available_dates.length > 1 && (
              <select
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
              >
                <option value="">วันล่าสุด</option>
                {marsData.available_dates.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <button onClick={() => fetchMarsNews(selectedDate || undefined)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="Refresh">
              <RefreshCw size={13} />
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generating ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
              {generating ? 'กำลังสร้าง...' : 'Generate Today'}
            </button>
            <Link href="/refresh"
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium">
              Content Refresh →
            </Link>
          </div>
        </div>

        {generateResult && (
          <div className={`rounded-xl px-4 py-3 text-xs font-medium mb-2 ${generateResult.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {generateResult.message}
          </div>
        )}

        {marsLoading && (
          <div className="text-center py-10 text-sm text-gray-400">
            <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-gray-300" />
            กำลังโหลดข้อมูล Mars Intelligence...
          </div>
        )}

        {marsError && !marsLoading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-amber-700 mb-1">⚠️ ไม่พบข้อมูล Mars</div>
            <div className="text-xs text-amber-600">{marsError}</div>
            <div className="text-xs text-amber-500 mt-2">ตรวจสอบว่า mars-seo-intelligence-free-trends รัน run_morning.py แล้ว</div>
          </div>
        )}

        {marsData && !marsLoading && (
          <div className="space-y-4">
            {/* Sources */}
            {marsData.sources_checked?.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-400">
                <span className="font-medium text-gray-500">แหล่งข้อมูล:</span>
                {marsData.sources_checked.map(s => (
                  <span key={s} className="bg-gray-100 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
            )}

            {/* Priority counts */}
            <div className="grid grid-cols-4 gap-2">
              {([
                { status: 'human_review',        icon: '🚨', label: 'ตรวจสอบเอง' },
                { status: 'strong_opportunity',   icon: '🟢', label: 'โอกาสสูง' },
                { status: 'refresh_opportunity',  icon: '🔵', label: 'Refresh' },
                { status: 'watch',                icon: '🟡', label: 'Watch' },
              ] as const).map(({ status, icon, label }) => {
                const count = priorityCounts[status] ?? 0
                const cfg = STATUS_CONFIG[status]
                return (
                  <button key={status}
                    onClick={() => setNewsFilter(newsFilter === status ? 'all' : status)}
                    className={`rounded-xl border p-3 text-center transition-all ${newsFilter === status ? `${cfg?.border} ${cfg?.bg}` : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  >
                    <div className="text-lg mb-0.5">{icon}</div>
                    <div className={`text-xl font-bold tabular-nums ${count > 0 ? cfg?.color : 'text-gray-300'}`}>{count}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
                  </button>
                )
              })}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1.5 flex-wrap">
              {(['all', 'strong_opportunity', 'refresh_opportunity', 'watch', 'human_review'] as const).map(f => (
                <button key={f}
                  onClick={() => setNewsFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${newsFilter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {f === 'all' ? `ทั้งหมด (${marsData.categories?.length ?? 0})` : STATUS_CONFIG[f]?.label}
                </button>
              ))}
            </div>

            {/* Cards grouped by priority */}
            {(['human_review', 'strong_opportunity', 'refresh_opportunity', 'watch'] as const).map(status => {
              const cats = filteredCategories.filter(c => c.status === status)
              if (!cats.length) return null
              const cfg = STATUS_CONFIG[status]
              const icon = status === 'human_review' ? '🚨' : status === 'strong_opportunity' ? '🟢' : status === 'refresh_opportunity' ? '🔵' : '🟡'
              return (
                <div key={status}>
                  <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider mb-2 ${cfg.color}`}>
                    <span>{icon}</span><span>{cfg.label} ({cats.length})</span>
                  </div>
                  <div className="space-y-2">
                    {cats.map(cat => (
                      <NewsCard key={cat.category_id} cat={cat} defaultOpen={status === 'strong_opportunity' && cats.length <= 2} />
                    ))}
                  </div>
                </div>
              )
            })}

            {filteredCategories.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-400">ไม่มีข้อมูลในหมวดนี้</div>
            )}

            {/* SEO Updates */}
            {marsData.seo_updates?.has_meaningful && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 mb-3 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <span>🔍</span> SEO &amp; Google Updates
                </div>
                <div className="space-y-2">
                  {marsData.seo_updates.items.map((item, i) => (
                    <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-colors group">
                      <ExternalLink size={13} className="shrink-0 mt-0.5 text-gray-400 group-hover:text-blue-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 group-hover:text-blue-700 line-clamp-2">{item.title}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                          <span>{item.source}</span><span>·</span><span>{item.age}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Empty categories */}
            {marsData.empty_categories?.length > 0 && (
              <div className="text-[10px] text-gray-400 bg-gray-50 rounded-xl p-3">
                <span className="font-medium">ตรวจสอบแล้ว ไม่มีอัปเดตใหม่:</span>{' '}
                {marsData.empty_categories.join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
