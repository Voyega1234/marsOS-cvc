'use client'

/**
 * Optimization Log — ประวัติการปรับแคมเปญจาก Google Ads Change History
 * + AI อธิบายรายรายการ + สรุปรวมแบบ client-friendly
 */

import { useState, useEffect, useCallback, Fragment } from 'react'
import AppShell from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'
import {
  FileClock, Loader2, AlertTriangle, Sparkles, Copy, CheckCircle2,
  ChevronDown, ChevronUp, RefreshCw, Inbox,
} from 'lucide-react'

interface LogEntry {
  id: string
  dateTime: string
  campaign: string | null
  adGroup: string | null
  resourceType: string
  operation: string
  changedBy: string
  clientType: string
  changes: { field: string; before: string; after: string }[]
  impact: 'LOW' | 'MEDIUM' | 'HIGH'
  detail: string
  count?: number
}
interface GadsAccount { id: string; name: string }

const DATE_PRESETS = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'LAST_7_DAYS', label: 'Last 7 Days' },
  { value: 'LAST_14_DAYS', label: 'Last 14 Days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 Days' },
  { value: 'LAST_MONTH', label: 'Last Month' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'CUSTOM', label: 'กำหนดเอง...' },
]

const IMPACT_STYLE: Record<string, string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-gray-50 text-gray-500 border-gray-200',
}
const IMPACT_LABEL: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ } }}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
    >
      {copied ? <><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> {label}</>}
    </button>
  )
}

export default function OptimizationLogPage() {
  const [accounts, setAccounts] = useState<GadsAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [preset, setPreset] = useState('LAST_7_DAYS')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [rangeLabel, setRangeLabel] = useState('')
  const [clamped, setClamped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [aiText, setAiText] = useState<Record<string, string>>({})
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/clients').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return
      setAccounts((d.accounts ?? []).map((a: Record<string, unknown>) => ({
        id: a.id as string,
        name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
      })))
    }).catch(() => {})
  }, [])

  const dateRange = preset === 'CUSTOM'
    ? (customStart && customEnd ? `CUSTOM_${customStart}_${customEnd}` : '')
    : preset

  const load = useCallback(async () => {
    if (!accountId || !dateRange) return
    setLoading(true); setError(null); setSummary(''); setAiText({}); setExpanded(new Set())
    try {
      const res = await fetch(`/api/optimization-log?customerId=${accountId}&dateRange=${dateRange}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setEntries(d.entries ?? [])
      setRangeLabel(d.rangeLabel ?? '')
      setClamped(!!d.clamped)
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [accountId, dateRange])

  useEffect(() => { if (accountId && dateRange) load() }, [accountId, dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const accountName = accounts.find(a => a.id === accountId)?.name ?? ''

  async function generateSummary() {
    if (entries.length === 0 || summaryLoading) return
    setSummaryLoading(true)
    try {
      const res = await fetch('/api/optimization-log/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'summary', entries, rangeLabel, accountName }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSummary(d.text ?? '')
    } catch {
      setSummary('สร้างสรุปไม่สำเร็จ — ลองใหม่อีกครั้ง')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function explainEntry(e: LogEntry) {
    if (aiLoading[e.id] || aiText[e.id]) return
    setAiLoading(p => ({ ...p, [e.id]: true }))
    try {
      const res = await fetch('/api/optimization-log/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'explain', entry: e, accountName }),
      })
      const d = await res.json()
      setAiText(p => ({ ...p, [e.id]: res.ok ? (d.text ?? '') : 'อธิบายไม่สำเร็จ — ลองใหม่' }))
    } catch {
      setAiText(p => ({ ...p, [e.id]: 'อธิบายไม่สำเร็จ — ลองใหม่' }))
    } finally {
      setAiLoading(p => ({ ...p, [e.id]: false }))
    }
  }

  const impactCount = (lv: string) => entries.filter(e => e.impact === lv).length

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileClock className="w-5 h-5 text-blue-500" /> Optimization Log
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            ประวัติการปรับแคมเปญจาก Google Ads Change History + AI สรุปสำหรับอธิบายลูกค้า
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              placeholder="— เลือก Google Ads Account —"
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-72 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              onClick={load}
              disabled={!accountId || !dateRange || loading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                  preset === p.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                )}
              >
                {p.label}
              </button>
            ))}
            {preset === 'CUSTOM' && (
              <span className="flex items-center gap-2 text-xs">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
                –
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
              </span>
            )}
          </div>
          {clamped && (
            <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Google Ads เก็บ Change History ย้อนหลังได้สูงสุด ~30 วัน — แสดงเฉพาะช่วงที่มีข้อมูล
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 border border-red-200 bg-red-50 rounded-xl p-4 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <Loader2 className="w-7 h-7 animate-spin text-blue-400" />
            <p className="text-sm">กำลังดึง Change History จาก Google Ads...</p>
          </div>
        )}

        {/* Empty states */}
        {!loading && !error && !accountId && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl">
            <Inbox className="w-8 h-8 text-gray-200" />
            <p className="text-sm">เลือก Google Ads Account เพื่อดูประวัติการปรับแคมเปญ</p>
          </div>
        )}
        {!loading && !error && accountId && loaded && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl">
            <Inbox className="w-8 h-8 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">ไม่มีการปรับแคมเปญในช่วง {rangeLabel}</p>
            <p className="text-xs">ลองขยายช่วงวันที่ หรือเช็คว่าเลือก account ถูกต้อง (Google เก็บ log ย้อนหลัง ~30 วัน)</p>
          </div>
        )}

        {/* Summary + table */}
        {!loading && entries.length > 0 && (
          <>
            {/* Summary section */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-gray-800">สรุปภาพรวม · {rangeLabel}</p>
                  <span className="text-xs text-gray-400">{entries.length} รายการ{entries.length >= 2000 ? ' (แสดง 2,000 ล่าสุด — ช่วงนี้มีมากกว่านั้น)' : ''}</span>
                  <span className="flex gap-1.5">
                    {(['HIGH', 'MEDIUM', 'LOW'] as const).map(lv => impactCount(lv) > 0 && (
                      <span key={lv} className={cn('px-2 py-0.5 text-[10px] font-bold rounded-full border', IMPACT_STYLE[lv])}>
                        {IMPACT_LABEL[lv]} {impactCount(lv)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {summary && <CopyBtn text={summary} label="Copy Summary" />}
                  <button
                    onClick={generateSummary}
                    disabled={summaryLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {summaryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {summary ? 'สรุปใหม่' : 'ให้ AI สรุปทั้งช่วง'}
                  </button>
                </div>
              </div>
              {summaryLoading && <p className="text-xs text-gray-400">กำลังอ่าน log ทั้งหมดและเรียบเรียง...</p>}
              {summary && (
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-blue-50/50 border border-blue-100 rounded-lg p-4">{summary}</p>
              )}
              {!summary && !summaryLoading && (
                <p className="text-xs text-gray-400">กดปุ่มเพื่อให้ AI รวม log ทั้งหมดเป็นเรื่องเดียว — ใช้แปะในรายงานหรืออธิบายลูกค้าได้เลย</p>
              )}
            </div>

            {/* Log table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[11px] text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2.5">วันที่/เวลา</th>
                      <th className="px-4 py-2.5">Campaign / Ad Group</th>
                      <th className="px-4 py-2.5">Change</th>
                      <th className="px-4 py-2.5">Changed By</th>
                      <th className="px-4 py-2.5">Impact</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entries.map(e => {
                      const open = expanded.has(e.id)
                      return (
                        <Fragment key={e.id}>
                          <tr
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => {
                              const next = new Set(expanded)
                              if (open) next.delete(e.id)
                              else { next.add(e.id); explainEntry(e) }
                              setExpanded(next)
                            }}
                          >
                            <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-mono">{e.dateTime.slice(0, 16)}</td>
                            <td className="px-4 py-3 max-w-[240px]">
                              <p className="text-xs font-semibold text-gray-800 truncate">{e.campaign ?? '(ระดับบัญชี)'}</p>
                              {e.adGroup && <p className="text-[11px] text-gray-400 truncate">{e.adGroup}</p>}
                            </td>
                            <td className="px-4 py-3 max-w-[320px]">
                              <p className="text-[11px] text-gray-400">
                                {e.resourceType} · {e.operation}
                                {(e.count ?? 1) > 1 && <span className="ml-1.5 px-1.5 py-px text-[10px] font-bold bg-blue-50 text-blue-600 rounded-full">×{(e.count ?? 1).toLocaleString()}</span>}
                              </p>
                              <p className="text-xs text-gray-700 truncate">{e.detail}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{e.changedBy}</td>
                            <td className="px-4 py-3">
                              <span className={cn('px-2 py-0.5 text-[10px] font-bold rounded-full border', IMPACT_STYLE[e.impact])}>{IMPACT_LABEL[e.impact]}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-300">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/60">
                              <td colSpan={6} className="px-6 py-4 space-y-3">
                                {e.changes.length > 0 && (
                                  <div className="text-xs space-y-1">
                                    {e.changes.map((c, i) => (
                                      <p key={i} className="text-gray-600">
                                        <span className="font-mono text-gray-400">{c.field}</span>: <span className="text-red-500 line-through">{c.before}</span> → <span className="text-emerald-600 font-semibold">{c.after}</span>
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <div className="border border-blue-100 bg-white rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[11px] font-bold text-blue-600 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Explanation (สำหรับอธิบายลูกค้า)</p>
                                    {aiText[e.id] && <CopyBtn text={aiText[e.id]} label="Copy Client Explanation" />}
                                  </div>
                                  {aiLoading[e.id]
                                    ? <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> กำลังวิเคราะห์...</p>
                                    : <p className="text-xs text-gray-700 leading-relaxed">{aiText[e.id] ?? '—'}</p>}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
