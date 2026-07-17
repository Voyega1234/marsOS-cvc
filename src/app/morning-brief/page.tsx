'use client'

import AppShell from '@/components/layout/AppShell'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, CheckCircle2, XCircle, ChevronRight,
  Clock, Zap, RefreshCw, Info, Tag, BarChart2, FileText, Shield,
  TrendingUp, Users, Pause, Activity, Sparkles, Target,
  Wallet, MousePointer, Search, Megaphone, ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency, formatConversions } from '@/lib/utils'
import type { MorningBriefData, BriefAlert, AccountHealth } from '@/app/api/morning-brief/route'
import type { AISummaryResult, AccountRecommendation, RecommendationAction } from '@/app/api/morning-brief/ai-summary/route'
import Link from 'next/link'

const LEVEL_CONFIG = {
  critical: { border: 'border-red-200 bg-red-50/60',     icon: XCircle,       iconColor: 'text-red-500',     badge: 'bg-red-100 text-red-700',     label: 'Critical' },
  warning:  { border: 'border-amber-200 bg-amber-50/40', icon: AlertTriangle,  iconColor: 'text-amber-500',   badge: 'bg-amber-100 text-amber-700', label: 'Warning' },
  ok:       { border: 'border-emerald-200 bg-emerald-50/30', icon: CheckCircle2, iconColor: 'text-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'On Track' },
}

const HEALTH_CONFIG = {
  healthy:  { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', label: 'Healthy',  text: 'text-emerald-700' },
  warning:  { bg: 'bg-amber-50 border-amber-200',     dot: 'bg-amber-400',   label: 'Warning',  text: 'text-amber-700' },
  critical: { bg: 'bg-red-50 border-red-200',         dot: 'bg-red-500',     label: 'Critical', text: 'text-red-700' },
  paused:   { bg: 'bg-gray-50 border-gray-200',       dot: 'bg-gray-400',    label: 'Paused',   text: 'text-gray-500' },
}

const PRIORITY_CONFIG = {
  high:   { bar: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200',       label: 'ด่วน' },
  medium: { bar: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'แนะนำ' },
  low:    { bar: 'bg-blue-400',   badge: 'bg-blue-50 text-blue-700 border-blue-200',    label: 'เพิ่มเติม' },
}

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  budget:   Wallet,
  bidding:  Target,
  keywords: Search,
  tracking: Tag,
  creative: Megaphone,
  general:  Info,
  qa:       Shield,
  performance: Zap,
  copy:     FileText,
}

const CAT_ICON_FALLBACK = Info

function AlertCard({ alert }: { alert: BriefAlert }) {
  const cfg    = LEVEL_CONFIG[alert.level]
  const Icon   = cfg.icon
  const CatIcon = CAT_ICON[alert.category] ?? CAT_ICON_FALLBACK
  return (
    <div className={cn('rounded-xl border p-4', cfg.border)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', cfg.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cfg.badge)}>{cfg.label}</span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><CatIcon className="w-3 h-3" />{alert.category}</span>
            <span className="text-xs font-medium text-gray-700">{alert.accountName ?? alert.campaignName}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{alert.detail}</p>
        </div>
        {alert.accountId && (
          <Link href={`/clients/${alert.accountId}`} className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1.5 rounded-lg">
            ดู <ChevronRight className="w-3 h-3" />
          </Link>
        )}
        {!alert.accountId && alert.mediaPlanId && (
          <Link href={`/review/${alert.mediaPlanId}`} className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1.5 rounded-lg">
            แก้ไข <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-white/60 text-xs text-gray-600 font-medium flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
        {alert.action}
      </div>
    </div>
  )
}

function RecommendationCard({ rec }: { rec: AccountRecommendation }) {
  const [expanded, setExpanded] = useState(true)
  const cfg = HEALTH_CONFIG[rec.status]

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
          <span className="text-sm font-semibold text-gray-900">{rec.accountName}</span>
          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', cfg.bg, cfg.text)}>{cfg.label}</span>
          <span className="text-xs text-gray-400">{rec.actions.length} recommendations</span>
        </div>
        <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="divide-y divide-gray-50">
          {rec.actions.map((action) => (
            <ActionRow key={action.id} action={action} accountId={rec.accountId} />
          ))}
        </div>
      )}
    </div>
  )
}

function ActionRow({ action, accountId }: { action: RecommendationAction; accountId: string }) {
  const pcfg   = PRIORITY_CONFIG[action.priority]
  const CatIcon = CAT_ICON[action.category] ?? CAT_ICON_FALLBACK
  const url    = action.actionUrl ?? `/clients/${accountId}`

  return (
    <div className="flex items-start gap-0 px-4 py-3 hover:bg-gray-50 transition-colors group">
      {/* Priority bar */}
      <div className={cn('w-1 self-stretch rounded-full mr-3 flex-shrink-0', pcfg.bar)} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', pcfg.badge)}>{pcfg.label}</span>
          <CatIcon className="w-3 h-3 text-gray-400" />
          <span className="text-xs font-semibold text-gray-900">{action.title}</span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{action.detail}</p>
      </div>

      <Link
        href={url}
        className="flex-shrink-0 ml-3 flex items-center gap-1 text-xs text-blue-600 font-medium bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
      >
        {action.actionLabel}<ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  )
}

function AccountCard({ health }: { health: AccountHealth }) {
  const cfg = HEALTH_CONFIG[health.status]
  return (
    <Link href={`/clients/${health.accountId}`} className={cn('block rounded-xl border p-4 hover:shadow-sm transition-all', cfg.bg)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={cn('mt-1 w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
          <div>
            <p className="text-sm font-semibold text-gray-900">{health.accountName}</p>
            <p className="text-xs text-gray-400 font-mono">{health.accountId}</p>
          </div>
        </div>
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', cfg.bg, cfg.text)}>{cfg.label}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-sm font-bold text-gray-900">{formatCurrency(health.spend30d)}</p>
          <p className="text-[10px] text-gray-400">30d Spend</p>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{formatConversions(health.conversions)}</p>
          <p className="text-[10px] text-gray-400">Conv.</p>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{health.activeCampaigns}</p>
          <p className="text-[10px] text-gray-400">Active</p>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{health.cpa > 0 ? formatCurrency(health.cpa) : '—'}</p>
          <p className="text-[10px] text-gray-400">CPA</p>
        </div>
      </div>
      {health.alerts.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-white/40">
          <p className="text-xs text-gray-600">⚠ {health.alerts[0]}</p>
        </div>
      )}
    </Link>
  )
}

export default function MorningBriefPage() {
  const [brief, setBrief]           = useState<MorningBriefData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [aiResult, setAiResult]     = useState<AISummaryResult | null>(null)
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState(false)
  const [acctFilter, setAcctFilter] = useState('')
  const router = useRouter()

  const loadAI = async (data: MorningBriefData) => {
    if (!data.accountHealths?.length) return
    setAiLoading(true); setAiError(false)
    try {
      const res = await fetch('/api/morning-brief/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountHealths: data.accountHealths, alerts: data.alerts }),
      })
      if (res.ok) setAiResult(await res.json() as AISummaryResult)
      else setAiError(true)
    } catch { setAiError(true) } finally {
      setAiLoading(false)
    }
  }

  const loadBrief = async () => {
    setLoading(true); setError(null); setAiResult(null); setAiError(false)
    try {
      const res = await fetch('/api/morning-brief')
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Server error ${res.status}`)
      }
      const data = await res.json() as MorningBriefData
      setBrief(data)
      loadAI(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally { setLoading(false) }
  }

  useEffect(() => { loadBrief() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const filteredHealths = useMemo(() => {
    const healths = brief?.accountHealths ?? []
    const q = acctFilter.trim().toLowerCase()
    if (!q) return healths
    return healths.filter((h) => h.accountName.toLowerCase().includes(q) || h.accountId.includes(q))
  }, [brief?.accountHealths, acctFilter])

  const now  = new Date()
  const date = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Morning Brief</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{date}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3 h-3 text-gray-400" />
              <p className="text-xs text-gray-400">อัปเดต {time} · {brief?.source ?? '...'}</p>
            </div>
          </div>
          <button onClick={loadBrief} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />รีเฟรช
          </button>
        </div>

        {loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[0,1,2].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
            <div className="h-28 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[0,1,2,3].map((i) => <div key={i} className="h-32 bg-gray-50 rounded-xl animate-pulse border border-gray-100" />)}
            </div>
            <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" /> กำลังดึงข้อมูล Google Ads...
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-white border border-red-100 rounded-2xl p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-red-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-700 mb-1">โหลด Morning Brief ไม่สำเร็จ</p>
            <p className="text-xs text-red-500 font-mono bg-red-50 rounded px-3 py-1.5 max-w-sm mx-auto mt-2 break-all">{error}</p>
            <div className="mt-4 flex flex-col gap-2 items-center">
              <button onClick={loadBrief} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
                <RefreshCw className="w-3 h-3 inline mr-1" />ลองใหม่
              </button>
              <a href="/integrations" className="text-xs text-blue-600 hover:underline">ตรวจสอบ Integration →</a>
            </div>
          </div>
        )}

        {brief && !loading && (
          <>
            {/* Summary counts */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
                <div className="text-2xl font-bold text-red-600">{brief.criticalCount}</div>
                <div className="text-xs text-red-600 font-medium mt-0.5">Critical</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{brief.warningCount}</div>
                <div className="text-xs text-amber-600 font-medium mt-0.5">Warning</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{brief.accountHealths?.filter((h) => h.status === 'healthy').length ?? 0}</div>
                <div className="text-xs text-emerald-600 font-medium mt-0.5">Healthy Accounts</div>
              </div>
            </div>

            {/* AI Summary — loads after data */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className={cn('w-3.5 h-3.5 text-blue-500', aiLoading && 'animate-pulse')} />
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">AI Summary</span>
                {aiLoading && (
                  <div className="flex gap-1 ml-1">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
              {aiLoading ? (
                <p className="text-sm text-blue-400 italic">กำลังวิเคราะห์ข้อมูลทุก account...</p>
              ) : aiError ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-red-500">โหลด AI Summary ไม่สำเร็จ</p>
                  <button onClick={() => brief && loadAI(brief)} className="flex-shrink-0 text-xs text-blue-600 hover:underline flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />ลองใหม่
                  </button>
                </div>
              ) : aiResult?.summary ? (
                <p className="text-sm text-gray-700 leading-relaxed">{aiResult.summary}</p>
              ) : (
                <p className="text-sm text-gray-500">กำลังรอข้อมูล...</p>
              )}
            </div>

            {/* Account Health Grid */}
            {brief.accountHealths && brief.accountHealths.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />Account Health ({brief.accountHealths.length})
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {(['healthy','warning','critical','paused'] as const).map((s) => (
                      <span key={s} className="flex items-center gap-1">
                        <span className={cn('w-1.5 h-1.5 rounded-full', HEALTH_CONFIG[s].dot)} />
                        {brief.accountHealths.filter((h) => h.status === s).length} {s}
                      </span>
                    ))}
                  </div>
                </div>
                {brief.accountHealths.length > 4 && (
                  <div className="relative mb-3">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={acctFilter}
                      onChange={(e) => setAcctFilter(e.target.value)}
                      placeholder="ค้นหาด้วยชื่อ หรือ CID..."
                      className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                    />
                  </div>
                )}
                {filteredHealths.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredHealths.map((h) => <AccountCard key={h.accountId} health={h} />)}
                  </div>
                ) : (
                  <p className="text-center text-xs text-gray-400 py-6">ไม่พบ account ที่ตรงกับ &quot;{acctFilter}&quot;</p>
                )}
              </div>
            )}

            {/* AI Recommendations per account — แบบ Google Ads */}
            {(aiLoading || (aiResult?.recommendations && aiResult.recommendations.length > 0)) && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className={cn('w-4 h-4 text-indigo-500', aiLoading && 'animate-pulse')} />
                  <h2 className="text-sm font-semibold text-gray-900">AI Recommendations</h2>
                  {aiLoading && <span className="text-xs text-gray-400 italic">กำลังวิเคราะห์...</span>}
                </div>
                {aiLoading ? (
                  <div className="space-y-3">
                    {[0,1,2].map((i) => <div key={i} className="h-24 bg-gray-50 rounded-xl animate-pulse border border-gray-100" />)}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {aiResult!.recommendations.map((rec) => (
                      <RecommendationCard key={rec.accountId} rec={rec} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Alert cards */}
            {brief.alerts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-red-500" />Alerts ({brief.alerts.length})
                </h2>
                <div className="space-y-3">
                  {brief.alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}
                </div>
              </div>
            )}

            {brief.alerts.length === 0 && (brief.accountHealths?.length ?? 0) === 0 && (
              <div className="text-center py-12 text-gray-400">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-300" />
                <p className="text-sm font-medium">ทุกอย่างปกติดี</p>
                <p className="text-xs mt-1">ยังไม่มี campaigns ที่ต้อง review</p>
                <button onClick={() => router.push('/automation/run')} className="mt-4 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  สร้าง Campaign แรก
                </button>
              </div>
            )}

            {/* Quick nav */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { href: '/clients',    icon: Users,       label: 'My Clients' },
                { href: '/reports',    icon: TrendingUp,  label: 'Reports' },
                { href: '/automation', icon: Pause,       label: 'Automation' },
              ].map((n) => (
                <Link key={n.href} href={n.href}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white border border-gray-200 text-gray-600 hover:border-blue-200 hover:text-blue-600 transition-colors text-xs font-medium">
                  <n.icon className="w-4 h-4" />{n.label}
                </Link>
              ))}
            </div>
          </>
        )}

      </div>
    </AppShell>
  )
}
