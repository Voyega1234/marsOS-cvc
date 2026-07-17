'use client'

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import NewRuleButton from '@/components/automation/NewRuleButton'
import {
  Bot, ToggleLeft, ToggleRight, Play, PlayCircle,
  Trash2, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, Bell, ChevronDown, ChevronUp, ShieldAlert, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { conditionSentence, actionSentence, HIGH_IMPACT_TYPES as HI_TYPES } from '@/lib/automation/labels'

// ── Types ──────────────────────────────────────────────────────────────────

interface AutomationRule {
  id:             string
  name:           string
  type:           string
  conditionJson:  string
  actionJson:     string
  enabled:        boolean
  lastRunAt:      string | null
  lastRunResult:  string | null
  lastRunMessage: string | null
  createdAt:      string
}

interface AutomationAlert {
  id:           string
  severity:     string
  title:        string
  message:      string
  campaignName: string
  status:       string
  createdAt:    string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const RULE_TYPE_LABELS: Record<string, string> = {
  keyword_pause:  'Keyword',
  budget_adjust:  'Budget',
  alert:          'Alert',
  bid_adjust:     'Bid',
  campaign_pause: 'Campaign',
  label:          'Label',
}

const RULE_TYPE_COLORS: Record<string, string> = {
  keyword_pause:  'bg-purple-100 text-purple-700',
  budget_adjust:  'bg-blue-100 text-blue-700',
  alert:          'bg-yellow-100 text-yellow-700',
  bid_adjust:     'bg-orange-100 text-orange-700',
  campaign_pause: 'bg-red-100 text-red-700',
  label:          'bg-gray-100 text-gray-600',
}

const RESULT_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  triggered: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-emerald-600', label: 'เงื่อนไขเข้า — ทำงานแล้ว' },
  no_match:  { icon: <Clock className="w-3.5 h-3.5" />,        color: 'text-gray-400',    label: 'เงื่อนไขยังไม่เข้า' },
  error:     { icon: <XCircle className="w-3.5 h-3.5" />,      color: 'text-red-500',     label: 'ผิดพลาด' },
}

function fmtTime(iso: string | null): string {
  if (!iso) return 'ยังไม่เคยรัน'
  const d = new Date(iso)
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

interface Account { id: string; descriptiveName?: string }

// ── Main component ─────────────────────────────────────────────────────────

export default function AutomationPage() {
  const [accounts,    setAccounts]   = useState<Account[]>([])
  const [customerId,  setCustomerId] = useState('')

  const [rules,  setRules]  = useState<AutomationRule[]>([])
  const [alerts, setAlerts] = useState<AutomationAlert[]>([])
  const [loading, setLoading]       = useState(true)
  const [runningId, setRunningId]         = useState<string | null>(null)
  const [runningAll, setRunningAll]       = useState(false)
  const [pendingApproval, setPendingApproval] = useState<AutomationRule | null>(null)
  const [mutateEnabled, setMutateEnabled] = useState(false)

  const HIGH_IMPACT_TYPES = HI_TYPES
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runAllMsg, setRunAllMsg]   = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const [rRes, aRes] = await Promise.all([
      fetch('/api/automation/rules?withMeta=1'),
      fetch('/api/automation/alerts'),
    ])
    if (rRes.ok) {
      const d = await rRes.json() as { rules: AutomationRule[]; mutateEnabled: boolean }
      setRules(d.rules ?? [])
      setMutateEnabled(!!d.mutateEnabled)
    }
    if (aRes.ok) {
      const data = await aRes.json() as { alerts?: AutomationAlert[] } | AutomationAlert[]
      setAlerts(Array.isArray(data) ? data : (data.alerts ?? []))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  // Load Google Ads accounts for account selector
  useEffect(() => {
    fetch('/api/google-ads/accounts')
      .then((r) => r.ok ? r.json() : { accounts: [] })
      .then((d: { accounts?: Account[] } | Account[]) => {
        const list = Array.isArray(d) ? d : (d.accounts ?? [])
        setAccounts(list)
        if (list.length && !customerId) setCustomerId(list[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleRule(id: string, enabled: boolean) {
    await fetch(`/api/automation/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r))
  }

  async function deleteRule(id: string) {
    if (!confirm('ลบ rule นี้?')) return
    setDeletingId(id)
    await fetch(`/api/automation/rules/${id}`, { method: 'DELETE' })
    setRules((prev) => prev.filter((r) => r.id !== id))
    setDeletingId(null)
  }

  function requestRunRule(rule: AutomationRule) {
    if (!customerId) { alert('กรุณาเลือก Google Ads account ก่อน'); return }
    if (HIGH_IMPACT_TYPES.includes(rule.type)) {
      setPendingApproval(rule)
      return
    }
    void runRule(rule.id)
  }

  async function runRule(id: string) {
    if (!customerId) { alert('กรุณาเลือก Google Ads account ก่อน'); return }
    setRunningId(id)
    const res = await fetch(`/api/automation/rules/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId }),
    })
    const data = await res.json() as { result: string; message: string }
    setRules((prev) => prev.map((r) => r.id === id ? {
      ...r,
      lastRunAt:      new Date().toISOString(),
      lastRunResult:  data.result,
      lastRunMessage: data.message,
    } : r))
    setRunningId(null)
    setExpandedId(id)
    // Reload alerts in case new ones were created
    void loadData()
  }

  async function runAll() {
    if (!customerId) { alert('กรุณาเลือก Google Ads account ก่อน'); return }
    setRunningAll(true)
    setRunAllMsg(null)
    const res = await fetch('/api/automation/run-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId }),
    })
    const data = await res.json() as { ran: number; triggered: number }
    setRunAllMsg(`รัน ${data.ran} กฎ — triggered ${data.triggered ?? 0} กฎ`)
    setRunningAll(false)
    void loadData()
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </AppShell>
    )
  }

  const enabledCount  = rules.filter((r) => r.enabled).length
  const openAlerts    = alerts.filter((a) => a.status === 'open').length

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automation Center</h1>
          <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
            {enabledCount} rules active · {openAlerts} open alerts
            {mutateEnabled ? (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-700 border border-red-200">โหมดจริง — rule แก้ค่าใน Google Ads ได้</span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-600 border border-blue-100">โหมดจำลอง — รายงานผลอย่างเดียว ไม่แก้ค่าจริง</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Account selector */}
          {accounts.length > 0 && (
            <AccountSelect
              accounts={accounts}
              value={customerId}
              onChange={setCustomerId}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
            />
          )}
          {!customerId && (
            <span className="text-xs text-amber-600 font-medium px-2 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
              ⚠️ ยังไม่เลือก account
            </span>
          )}
          <button
            onClick={runAll}
            disabled={runningAll || !rules.length}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {runningAll
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <PlayCircle className="w-4 h-4" />
            }
            Run All
          </button>
          <NewRuleButton />
        </div>
      </div>

      {runAllMsg && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {runAllMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Rules list ── */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="font-semibold text-gray-900">Automation Rules ({rules.length})</h2>

          {rules.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <Bot className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-600">ยังไม่มี Automation Rule</p>
              <p className="text-xs text-gray-400 mt-1">กด &ldquo;New Rule&rdquo; เพื่อสร้างกฎแรก</p>
            </div>
          ) : (
            rules.map((rule) => {
              const res = rule.lastRunResult ? RESULT_CONFIG[rule.lastRunResult] : null
              const isExpanded = expandedId === rule.id
              return (
                <div key={rule.id} className={cn(
                  'bg-white rounded-xl border transition-all',
                  rule.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'
                )}>
                  <div className="flex items-start gap-3 p-4">
                    {/* Toggle */}
                    <button
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                      className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
                      title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      {rule.enabled
                        ? <ToggleRight className="w-7 h-7 text-blue-600" />
                        : <ToggleLeft  className="w-7 h-7 text-gray-300" />
                      }
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1.5 mb-1">
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', RULE_TYPE_COLORS[rule.type] ?? 'bg-gray-100 text-gray-600')}>
                          {RULE_TYPE_LABELS[rule.type] ?? rule.type}
                        </span>
                        {rule.enabled
                          ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">เปิดใช้</span>
                          : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">ปิดอยู่</span>
                        }
                        {HIGH_IMPACT_TYPES.includes(rule.type) && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="รันจริงต้องกดยืนยันก่อนทุกครั้ง">⚡ แก้ค่าจริง</span>
                        )}
                        {res && (
                          <span className={cn('flex items-center gap-0.5 text-[10px] font-medium', res.color)}>
                            {res.icon}{res.label}
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-medium text-gray-900">{rule.name}</p>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        <span className="text-gray-400">ถ้า</span> <span className="font-medium">{conditionSentence(rule.conditionJson)}</span>
                        <span className="text-gray-400"> ให้ระบบ</span> <span className="font-medium text-blue-700">{actionSentence(rule.actionJson)}</span>
                      </p>

                      {/* Last run info */}
                      <p className="text-[11px] text-gray-400 mt-1">
                        Last run: {fmtTime(rule.lastRunAt)}
                      </p>

                      {/* Expanded last run message */}
                      {isExpanded && rule.lastRunMessage && (
                        <div className={cn(
                          'mt-2 px-3 py-2 rounded-lg text-xs',
                          rule.lastRunResult === 'triggered' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                          rule.lastRunResult === 'error'     ? 'bg-red-50 text-red-600 border border-red-100' :
                          'bg-gray-50 text-gray-500 border border-gray-100'
                        )}>
                          {rule.lastRunMessage}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
                        title="Show last run detail"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => requestRunRule(rule)}
                        disabled={runningId === rule.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 transition-colors"
                        title={HIGH_IMPACT_TYPES.includes(rule.type) ? 'Run (ต้อง approve ก่อน)' : 'Run now'}
                      >
                        {runningId === rule.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Play className="w-3.5 h-3.5" />
                        }
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        disabled={deletingId === rule.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 transition-colors"
                        title="Delete rule"
                      >
                        {deletingId === rule.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* ── Alerts panel ── */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">
            Alerts ({openAlerts} open)
          </h2>
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-xs text-gray-400">ยังไม่มี Alert</p>
              </div>
            ) : (
              alerts.slice(0, 20).map((a) => (
                <div key={a.id} className={cn(
                  'rounded-xl border p-3',
                  a.severity === 'critical' ? 'bg-red-50 border-red-100' :
                  a.severity === 'warning'  ? 'bg-amber-50 border-amber-100' :
                  'bg-blue-50 border-blue-100'
                )}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0',
                      a.severity === 'critical' ? 'text-red-500' :
                      a.severity === 'warning'  ? 'text-amber-500' : 'text-blue-500'
                    )} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800 leading-snug">{a.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed line-clamp-3">{a.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{a.campaignName}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Execution note */}
          <div className="mt-4 bg-gray-50 rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-600 mb-1.5">วิธีใช้ (อ่าน 20 วินาที)</p>
            <ul className="space-y-1.5 text-[11px] text-gray-500">
              <li className="flex gap-1.5"><span className="text-blue-500 font-bold">1.</span>เลือก account ด้านบน แล้วกด ▶ ที่ rule เพื่อลองรันทันที (หรือ Run All รันทุกกฎ)</li>
              <li className="flex gap-1.5"><span className="text-emerald-500 font-bold">2.</span>ผลรันจะบอกว่า &quot;เงื่อนไขเข้า&quot; หรือ &quot;ยังไม่เข้า&quot; พร้อมรายละเอียด — กด ▼ ดูได้</li>
              <li className="flex gap-1.5"><span className="text-amber-500 font-bold">3.</span>rule ที่มีป้าย <strong>⚡ แก้ค่าจริง</strong> จะถามยืนยันก่อน execute ทุกครั้ง</li>
              <li className="flex gap-1.5"><span className="text-gray-400 font-bold">4.</span>{mutateEnabled ? 'ตอนนี้อยู่โหมดจริง — เงื่อนไขเข้าเมื่อไหร่ ระบบแก้ค่าใน Google Ads ทันที' : 'ตอนนี้อยู่โหมดจำลอง — ระบบจะบอกว่า \'จะทำอะไร\' แต่ยังไม่แก้ค่าจริง (ให้ทีม dev เปิดโหมดจริงเมื่อพร้อม)'}</li>
            </ul>
          </div>
        </div>
      </div>
    {/* Human Approval Modal for high-impact rules */}
    {pendingApproval && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-amber-900">ต้องการ Approval</h2>
              <p className="text-xs text-amber-700 mt-0.5">Rule นี้มีผลต่อ campaign จริง — ต้องยืนยันก่อน execute</p>
            </div>
            <button onClick={() => setPendingApproval(null)} className="ml-auto text-amber-400 hover:text-amber-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5 text-sm">
              <p><span className="text-gray-500">Rule:</span> <strong>{pendingApproval.name}</strong></p>
              <p><span className="text-gray-500">Type:</span> <strong>{RULE_TYPE_LABELS[pendingApproval.type] ?? pendingApproval.type}</strong></p>
              <p><span className="text-gray-500">Account:</span> <strong>{customerId || '(ไม่ระบุ)'}</strong></p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
              ⚠️ Rule ประเภท <strong>{RULE_TYPE_LABELS[pendingApproval.type]}</strong> จะแก้ไข budget / bid / status ของ campaign จริงใน Google Ads
            </div>
          </div>
          <div className="px-6 pb-5 flex gap-3">
            <button onClick={() => setPendingApproval(null)} className="flex-1 px-4 py-2.5 border border-gray-300 text-sm text-gray-700 rounded-xl hover:bg-gray-50">
              ยกเลิก
            </button>
            <button
              onClick={() => { const id = pendingApproval.id; setPendingApproval(null); void runRule(id) }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700"
            >
              <Play className="w-4 h-4" />
              อนุมัติ & Execute
            </button>
          </div>
        </div>
      </div>
    )}
    </AppShell>
  )
}
