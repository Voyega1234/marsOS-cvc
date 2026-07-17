'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Zap, Bot, Pencil, ChevronRight, CheckCircle2, Loader2, Circle,
  AlertCircle, ShieldAlert, AlertTriangle, ChevronDown, ChevronUp,
  X, FileText, Globe, Search, Wrench, ShieldCheck, Rocket, Tag,
  Sparkles, RefreshCw, StopCircle,
} from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { cn } from '@/lib/utils'
import { briefSchema, type BriefInput } from '@/lib/validation/brief'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Account {
  id: string
  name: string
  currencyCode?: string
  summary?: { spend?: number; conversions?: number } | null
}

interface CampaignConflict {
  type: 'campaign_name' | 'keyword' | 'business_name'
  severity: 'block' | 'warn'
  detail: string
  existingStatus?: string
  mediaPlanId?: string
}

interface StepEvent {
  step?: number
  status?: string
  done?: boolean
  success?: boolean
  message?: string
  error?: string
  blocked?: boolean
  conflicts?: CampaignConflict[]
  summary?: string
  blockingCount?: number
  warningCount?: number
  proposedCampaigns?: unknown[]
  proposedKeywordsCount?: number
  hasConflicts?: boolean
  reason?: string
  hasGtm?: boolean
  hasGa4?: boolean
  trackingEvents?: number
  gtmTags?: number
  scanError?: string
  campaigns?: unknown
  keywords?: number
  audiences?: number
  adGroups?: number
  conversionActionsCount?: number
  score?: number
  passed?: number
  warnings?: number
  failed?: number
  totalCampaigns?: number
  qaScore?: number
  pushJobId?: string
  trackingReadyForAds?: boolean
  conversionActionsCount2?: number
  blueprintId?: string
  mediaPlanId?: string
  conversionActions?: string[]
}

const STEPS = [
  { n: 0, label: 'ตรวจสอบ Campaign/Keyword ซ้ำ',       icon: ShieldAlert },
  { n: 1, label: 'บันทึก Brief',                         icon: FileText },
  { n: 2, label: 'Scan เว็บ & วาง Tracking Plan',        icon: Globe },
  { n: 3, label: 'สร้าง Media Plan',                      icon: Zap },
  { n: 4, label: 'วางแผน Keywords & Audiences',          icon: Search },
  { n: 5, label: 'สร้าง Campaign Blueprint',             icon: Wrench },
  { n: 6, label: 'ตรวจสอบ QA',                           icon: ShieldCheck },
  { n: 7, label: 'Push เข้า Google Ads (PAUSED)',        icon: Rocket },
]

type StepStatus = 'idle' | 'running' | 'done' | 'skipped' | 'error' | 'conflict'

interface StepState {
  status: StepStatus
  detail?: string
  extra?: Record<string, unknown>
}

// ── Conflict Modal ────────────────────────────────────────────────────────────

function ConflictModal({
  conflicts, summary, blockingCount, warningCount, onForce, onCancel,
}: {
  conflicts: CampaignConflict[]
  summary: string
  blockingCount: number
  warningCount: number
  onForce: () => void
  onCancel: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? conflicts : conflicts.slice(0, 5)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-start gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-gray-900">พบ Campaign/Keyword ซ้ำ</h2>
            <p className="text-sm text-gray-500 mt-0.5">{summary}</p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="flex gap-3 px-6 py-4 border-b border-gray-100">
          {blockingCount > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm font-semibold text-red-700">{blockingCount} Blocking</span>
            </div>
          )}
          {warningCount > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm font-semibold text-amber-700">{warningCount} Warning</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
          {shown.map((c, i) => (
            <div key={i} className={cn('rounded-xl border p-3.5',
              c.severity === 'block' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
            )}>
              <div className="flex items-start gap-2.5">
                {c.severity === 'block'
                  ? <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                      c.type === 'campaign_name' && 'bg-purple-100 text-purple-700',
                      c.type === 'keyword'       && 'bg-blue-100 text-blue-700',
                      c.type === 'business_name' && 'bg-orange-100 text-orange-700',
                    )}>
                      {c.type === 'campaign_name' ? 'Campaign' : c.type === 'keyword' ? 'Keyword' : 'Business'}
                    </span>
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase',
                      c.severity === 'block' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {c.existingStatus}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 font-medium">{c.detail}</p>
                  {c.mediaPlanId && (
                    <a href={`/review/${c.mediaPlanId}`} target="_blank"
                      className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
                      ดู Blueprint →
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          {conflicts.length > 5 && (
            <button onClick={() => setShowAll((v) => !v)}
              className="w-full text-xs text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1 py-2">
              {showAll ? <><ChevronUp className="w-3 h-3" /> ย่อ</> : <><ChevronDown className="w-3 h-3" /> แสดงทั้งหมด {conflicts.length} รายการ</>}
            </button>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 space-y-2">
          {blockingCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 text-xs text-amber-800">
              <strong>Force Override:</strong> จะสร้าง campaign ใหม่แม้ซ้ำกับรายการที่มีอยู่ — ใช้เฉพาะกรณีต้องการ rebuild หรือทำ A/B test
            </div>
          )}
          <div className="flex gap-2.5">
            <button onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors">
              ยกเลิก / แก้ไข Brief
            </button>
            {blockingCount > 0 ? (
              <button onClick={onForce}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                Force Override & ดำเนินต่อ
              </button>
            ) : (
              <button onClick={onForce}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                รับทราบ & ดำเนินต่อ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Confirm Launch Modal ──────────────────────────────────────────────────────

function ConfirmModal({
  data, accountName, aiMode, onConfirm, onCancel,
}: {
  data: BriefInput
  accountName: string
  aiMode: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const OBJ_LABELS: Record<string, string> = {
    LEADS: 'Lead Generation', SALES: 'Sales', TRAFFIC: 'Website Traffic',
    AWARENESS: 'Brand Awareness', APP_INSTALLS: 'App Installs',
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">ยืนยันก่อนเริ่ม Automation</h2>
              <p className="text-sm text-gray-500 mt-0.5">ตรวจสอบข้อมูลด้านล่างก่อนระบบเริ่มทำงาน</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          {aiMode && (
            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 text-xs rounded-lg px-3 py-2">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
              ข้อมูลนี้ AI กรอกจากข้อมูล account — ตรวจสอบก่อนยืนยัน
            </div>
          )}

          <div className="space-y-2 text-sm">
            <Row label="Account" value={accountName} />
            <Row label="ธุรกิจ" value={data.businessName} />
            <Row label="Website" value={data.websiteUrl} mono />
            <Row label="บริการ" value={data.productService} />
            <Row label="Objective" value={OBJ_LABELS[data.objective] ?? data.objective} />
            <Row label="งบ/วัน" value={`฿${Number(data.monthlyBudget).toLocaleString()}`} highlight />
            <Row label="พื้นที่" value={data.targetLocation} />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-2.5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors">
            แก้ไข
          </button>
          <button onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            <Zap className="w-4 h-4" />
            เริ่มเลย
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-24 flex-shrink-0 text-gray-400">{label}</span>
      <span className={cn(
        'flex-1 font-medium truncate',
        mono && 'font-mono text-xs text-gray-500',
        highlight && 'text-blue-700',
        !mono && !highlight && 'text-gray-800',
      )}>{value}</span>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface MediaPlanForBuilder {
  id: string
  title: string
  brief?: {
    businessName?: string
    websiteUrl?: string
    productService?: string
    objective?: string
    monthlyBudget?: number
    targetLocation?: string
    language?: string
    targetAudience?: string
    conversionGoal?: string
    brandTone?: string
  } | null
}

function CampaignBuilderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const planId = searchParams.get('planId')

  // Media Plan prefill
  const [sourcePlan, setSourcePlan] = useState<MediaPlanForBuilder | null>(null)

  // Mode
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')

  // Accounts
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  // AI Prefill
  const [prefilling, setPrefilling] = useState(false)
  const [aiRationale, setAiRationale] = useState<string | null>(null)
  const [prefillContext, setPrefillContext] = useState<string[]>([])
  const [prefillDone, setPrefillDone] = useState(false)

  // Keyword Planner handoff
  const [kwHandoff, setKwHandoff] = useState<{ keywords: string[]; negativeKeywords: string[]; avgCpc: number } | null>(null)
  const [kwHandoffExpired, setKwHandoffExpired] = useState(false)

  // Confirm modal
  const [confirmData, setConfirmData] = useState<BriefInput | null>(null)

  // Pipeline
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form')
  const [steps, setSteps] = useState<Record<number, StepState>>({})
  const [result, setResult] = useState<StepEvent | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [conflictData, setConflictData] = useState<StepEvent | null>(null)
  const [pendingFormData, setPendingFormData] = useState<BriefInput | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<BriefInput>({
    resolver: zodResolver(briefSchema),
    defaultValues: { currency: 'THB', language: 'th' },
  })

  // Load from Media Plan if planId provided
  useEffect(() => {
    if (!planId) return
    fetch(`/api/media-plans/${planId}`)
      .then((r) => r.json())
      .then((data: MediaPlanForBuilder) => {
        setSourcePlan(data)
        setMode('manual') // skip AI prefill; use plan data
        const b = data.brief
        if (!b) return
        const fields: { key: keyof BriefInput; val: unknown }[] = [
          { key: 'businessName',    val: b.businessName },
          { key: 'websiteUrl',      val: b.websiteUrl },
          { key: 'productService',  val: b.productService },
          { key: 'objective',       val: b.objective },
          { key: 'monthlyBudget',   val: b.monthlyBudget },
          { key: 'targetLocation',  val: b.targetLocation },
          { key: 'language',        val: b.language },
          { key: 'targetAudience',  val: b.targetAudience },
          { key: 'conversionGoal',  val: b.conversionGoal },
          { key: 'brandTone',       val: b.brandTone },
        ]
        fields.forEach(({ key, val }) => {
          if (val !== undefined && val !== null) setValue(key, val as never)
        })
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId])

  // Load keywords from Keyword Planner handoff
  useEffect(() => {
    if (planId) return // media plan takes priority
    try {
      const raw = localStorage.getItem('kw-to-campaign')
      if (!raw) return
      const data = JSON.parse(raw) as {
        businessName?: string
        productService?: string
        location?: string
        keywords: string[]
        negativeKeywords: string[]
        avgCpc: number
        savedAt: number
      }
      // Ignore if older than 30 minutes — show warning so user knows keywords were discarded
      if (Date.now() - (data.savedAt ?? 0) > 30 * 60 * 1000) {
        localStorage.removeItem('kw-to-campaign')
        setKwHandoffExpired(true)
        return
      }
      setKwHandoff({ keywords: data.keywords, negativeKeywords: data.negativeKeywords, avgCpc: data.avgCpc })
      setMode('manual')
      if (data.businessName) setValue('businessName', data.businessName)
      if (data.productService) setValue('productService', data.productService)
      if (data.location) setValue('targetLocation', data.location)
      // Put keywords into notes field
      const kwBlock = [
        'Keywords ที่เลือก:',
        ...data.keywords,
        '',
        'Negative Keywords:',
        ...data.negativeKeywords.map((k) => `-${k}`),
      ].join('\n')
      setValue('notes', kwBlock)
      localStorage.removeItem('kw-to-campaign')
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId])

  // Load accounts
  useEffect(() => {
    fetch('/api/clients')
      .then((r) => {
        // Middleware redirects unauthenticated requests to /auth/signin
        if (r.redirected || r.url.includes('/auth/signin')) {
          window.location.href = '/auth/signin'
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        if (!d) return
        const list: Account[] = (d.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
          currencyCode: a.currencyCode as string | undefined,
          summary: a.summary as Account['summary'],
        }))
        setAccounts(list)
        if (list.length > 0) setSelectedAccount(list[0])
        else if (list.length === 0) console.warn('[campaign-builder] No accounts returned', d)
      })
      .catch((err) => console.error('[campaign-builder] Failed to load accounts:', err))
      .finally(() => setLoadingAccounts(false))
  }, [])

  // Auto-prefill when account selected in AI mode
  const runPrefill = useCallback(async (account: Account) => {
    setPrefilling(true)
    setPrefillDone(false)
    setAiRationale(null)
    setPrefillContext([])
    try {
      const res = await fetch('/api/campaign-builder/prefill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: account.id, accountName: account.name }),
      })
      const data = await res.json()
      if (data.prefill) {
        const p = data.prefill as Record<string, unknown>
        // Fill form fields
        const fields: (keyof BriefInput)[] = [
          'businessName', 'websiteUrl', 'productService', 'objective',
          'monthlyBudget', 'targetLocation', 'language',
          'targetAudience', 'conversionGoal', 'brandTone',
        ]
        fields.forEach((f) => {
          if (p[f] !== undefined) setValue(f, p[f] as never)
        })
        if (p.aiRationale) setAiRationale(String(p.aiRationale))
        if (Array.isArray(data.context)) setPrefillContext(data.context)
        setPrefillDone(true)
      }
    } catch {
      // silently fail, user can fill manually
    } finally {
      setPrefilling(false)
    }
  }, [setValue])

  // When account changes in AI mode
  useEffect(() => {
    if (mode === 'ai' && selectedAccount) {
      runPrefill(selectedAccount)
    }
  }, [selectedAccount, mode, runPrefill])

  // When switching to AI mode
  const switchToAI = () => {
    setMode('ai')
    if (selectedAccount) runPrefill(selectedAccount)
  }

  const switchToManual = () => {
    setMode('manual')
    reset({ currency: 'THB', language: 'th' })
    setAiRationale(null)
    setPrefillDone(false)
  }

  const setStep = (n: number, status: StepStatus, detail?: string, extra?: Record<string, unknown>) =>
    setSteps((prev) => ({ ...prev, [n]: { status, detail, extra } }))

  const cancelPipeline = () => {
    abortRef.current?.()
    abortRef.current = null
    setPhase('form')
    setSteps({})
    setResult(null)
    setFatalError(null)
    setConflictData(null)
  }

  const runPipeline = async (data: BriefInput, forceOverride = false) => {
    setPhase('running')
    setSteps({})
    setResult(null)
    setFatalError(null)
    setConflictData(null)

    let cancelled = false
    abortRef.current = () => { cancelled = true }

    try {
      const res = await fetch('/api/automation/run-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          customerId: selectedAccount?.id,
          forceOverride,
        }),
      })

      if (!res.ok || !res.body) throw new Error('API request failed')

      const reader = res.body.getReader()
      abortRef.current = () => { cancelled = true; reader.cancel() }
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done || cancelled) break

        const text = decoder.decode(value)
        const lines = text.split('\n').filter((l) => l.startsWith('data: '))

        for (const line of lines) {
          try {
            const evt: StepEvent = JSON.parse(line.slice(6))

            if (evt.blocked) {
              setConflictData(evt)
              setStep(0, 'conflict', evt.summary)
              continue
            }

            if (evt.done) {
              setResult(evt)
              setPhase('done')
              continue
            }

            if (evt.step !== undefined && evt.status) {
              if (evt.status === 'running') {
                setStep(evt.step, 'running')
              } else if (evt.status === 'done') {
                let detail = ''
                if (evt.step === 0) {
                  detail = evt.hasConflicts
                    ? `${evt.blockingCount ?? 0} blocking · ${evt.warningCount ?? 0} warnings · ${evt.proposedCampaigns?.length ?? 0} campaigns`
                    : `ไม่พบซ้ำ · ${evt.proposedCampaigns?.length ?? 0} campaigns · ${evt.proposedKeywordsCount ?? 0} keywords`
                }
                if (evt.step === 2) {
                  const parts = []
                  if (evt.hasGtm) parts.push('GTM ✓')
                  if (evt.hasGa4) parts.push('GA4 ✓')
                  if (!evt.hasGtm) parts.push('GTM ✗')
                  if (!evt.hasGa4) parts.push('GA4 ✗')
                  parts.push(`${evt.trackingEvents ?? 0} events · ${evt.gtmTags ?? 0} tags`)
                  if (evt.scanError) parts.push(`⚠ ${evt.scanError.slice(0, 30)}`)
                  detail = parts.join(' · ')
                }
                if (evt.step === 3) detail = `${evt.campaigns} campaigns · ฿${((evt as Record<string, unknown>).budget as number)?.toLocaleString() ?? 0}/วัน`
                if (evt.step === 4) detail = `${evt.keywords ?? 0} keywords · ${evt.audiences ?? 0} audiences`
                if (evt.step === 5) detail = `${evt.adGroups ?? 0} ad groups · ${evt.conversionActionsCount ?? 0} conversion actions`
                if (evt.step === 6) detail = `Score ${evt.score}/100 · Pass ${evt.passed} · Warn ${evt.warnings} · Fail ${evt.failed}`
                if (evt.step === 7 && Array.isArray(evt.campaigns)) detail = `${evt.campaigns.length} campaigns PAUSED ✓`
                setStep(evt.step, 'done', detail, evt as Record<string, unknown>)
              } else if (evt.status === 'skipped') {
                setStep(evt.step, 'skipped', evt.reason)
              }
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
      setPhase('done')
    }
  }

  const onSubmit = (data: BriefInput) => {
    setPendingFormData(data)
    setConfirmData(data)
  }

  const runAfterConfirm = () => {
    if (!pendingFormData) return
    setConfirmData(null)
    runPipeline(pendingFormData, false)
  }

  const handleForceOverride = () => {
    if (pendingFormData) {
      setConflictData(null)
      runPipeline(pendingFormData, true)
    }
  }

  const handleCancelConflict = () => {
    setConflictData(null)
    setPhase('form')
    setSteps({})
  }

  // ── Running / Done Phase ──────────────────────────────────────────────────────

  if (phase !== 'form') {
    return (
      <AppShell>
        {confirmData && (
          <ConfirmModal
            data={confirmData}
            accountName={selectedAccount?.name ?? ''}
            aiMode={mode === 'ai'}
            onConfirm={runAfterConfirm}
            onCancel={() => setConfirmData(null)}
          />
        )}
        {conflictData && (
          <ConflictModal
            conflicts={conflictData.conflicts ?? []}
            summary={conflictData.summary ?? conflictData.message ?? ''}
            blockingCount={conflictData.blockingCount ?? 0}
            warningCount={conflictData.warningCount ?? 0}
            onForce={handleForceOverride}
            onCancel={handleCancelConflict}
          />
        )}

        <div className="max-w-xl mx-auto">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {conflictData
                  ? 'พบ Campaign ซ้ำ — รอการยืนยัน'
                  : phase === 'running'
                  ? 'กำลังสร้าง Campaign...'
                  : result?.success ? 'สร้างสำเร็จ! 🎉' : 'เกิดข้อผิดพลาด'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {phase === 'running' && !conflictData
                  ? 'ระบบกำลังทำงาน กรุณารอสักครู่...'
                  : result?.success
                  ? result.message
                  : result?.error ?? fatalError ?? 'กรุณาลองใหม่อีกครั้ง'}
              </p>
            </div>
            {phase === 'running' && (
              <button
                onClick={cancelPipeline}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors flex-shrink-0"
              >
                <StopCircle className="w-4 h-4" />
                ยกเลิก
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {STEPS.map((s) => {
              const state = steps[s.n]
              const status: StepStatus = state?.status ?? 'idle'

              return (
                <div key={s.n} className="flex items-start gap-4 px-5 py-4">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    status === 'done'     && 'bg-emerald-100',
                    status === 'running'  && 'bg-blue-100',
                    status === 'skipped'  && 'bg-amber-50',
                    status === 'error'    && 'bg-red-100',
                    status === 'conflict' && 'bg-red-100',
                    status === 'idle'     && 'bg-gray-100',
                  )}>
                    {status === 'done'     && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    {status === 'running'  && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                    {status === 'skipped'  && <AlertCircle className="w-4 h-4 text-amber-500" />}
                    {status === 'error'    && <AlertCircle className="w-4 h-4 text-red-500" />}
                    {status === 'conflict' && <ShieldAlert className="w-4 h-4 text-red-600" />}
                    {status === 'idle'     && <Circle className="w-4 h-4 text-gray-300" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium',
                      status === 'done'     && 'text-gray-900',
                      status === 'running'  && 'text-blue-700',
                      status === 'skipped'  && 'text-amber-600',
                      status === 'conflict' && 'text-red-700',
                      status === 'error'    && 'text-red-600',
                      status === 'idle'     && 'text-gray-400',
                    )}>
                      {s.label}
                    </p>
                    {state?.detail && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{state.detail}</p>
                    )}
                  </div>

                  <span className="text-xs text-gray-300 flex-shrink-0 mt-1">
                    {s.n === 0 ? '00' : `0${s.n}`}
                  </span>
                </div>
              )
            })}
          </div>

          {phase === 'done' && result?.success && (
            <div className={cn(
              'mt-4 rounded-xl border p-4',
              result.trackingReadyForAds ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
            )}>
              <div className="flex items-center gap-2 mb-2">
                <Tag className={cn('w-4 h-4', result.trackingReadyForAds ? 'text-emerald-600' : 'text-amber-600')} />
                <span className={cn('text-sm font-semibold',
                  result.trackingReadyForAds ? 'text-emerald-700' : 'text-amber-700')}>
                  Tracking Blueprint {result.trackingReadyForAds ? '— พร้อมใช้งาน ✓' : '— ต้องติดตั้งก่อน launch'}
                </span>
              </div>
              {result.conversionActions && result.conversionActions.length > 0 && (
                <div className="space-y-1">
                  {result.conversionActions.map((ca, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                      {ca}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="mt-5 flex gap-3">
              {result?.success ? (
                <>
                  <button
                    onClick={() => router.push(`/push-log/${result.blueprintId}`)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                  >
                    <Rocket className="w-4 h-4" />
                    ดู Push Log
                  </button>
                  <button
                    onClick={() => router.push(`/creatives/${result.mediaPlanId}`)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    สร้าง Ad Copy
                  </button>
                  <button
                    onClick={() => router.push(`/media-plans/${result.mediaPlanId}`)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    ดู Media Plan
                  </button>
                </>
              ) : (
                <>
                  {result?.blueprintId && (
                    <button
                      onClick={() => router.push(`/review/${result.mediaPlanId}`)}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors"
                    >
                      แก้ไข QA Issues
                    </button>
                  )}
                  <button
                    onClick={() => { setPhase('form'); setSteps({}); setResult(null) }}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    ลองใหม่
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </AppShell>
    )
  }

  // ── Form Phase ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {confirmData && (
        <ConfirmModal
          data={confirmData}
          accountName={selectedAccount?.name ?? ''}
          aiMode={mode === 'ai'}
          onConfirm={runAfterConfirm}
          onCancel={() => setConfirmData(null)}
        />
      )}
      <div className="max-w-2xl mx-auto">
        {/* Media Plan source banner */}
        {sourcePlan && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <Zap className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <p className="text-sm text-blue-700 flex-1">
              กำลังสร้าง campaign จาก Media Plan:{' '}
              <a href={`/media-plans/${sourcePlan.id}`} className="font-semibold underline hover:text-blue-900">
                {sourcePlan.title}
              </a>
            </p>
            <a href={`/media-plans/${sourcePlan.id}`} className="text-xs text-blue-500 hover:text-blue-700 flex-shrink-0">
              ← กลับ
            </a>
          </div>
        )}

        {/* Expired keyword handoff warning */}
        {kwHandoffExpired && (
          <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-amber-500 flex-shrink-0 mt-0.5 text-base">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">Keywords หมดอายุ</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Keywords ที่เลือกไว้จาก Keyword Research หมดอายุแล้ว (เกิน 30 นาที) กรุณากลับไปเลือกใหม่
              </p>
            </div>
            <button
              type="button"
              onClick={() => setKwHandoffExpired(false)}
              className="text-amber-400 hover:text-amber-600 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Keyword Planner handoff banner */}
        {kwHandoff && (
          <div className="mb-4 flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <Search className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800">
                ใช้ keywords จาก Keyword Research
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                {kwHandoff.keywords.length} keywords · {kwHandoff.negativeKeywords.length} negatives · avg CPC ฿{kwHandoff.avgCpc.toFixed(0)} — ใส่ใน Notes แล้ว AI จะนำไปใช้สร้าง campaign
              </p>
            </div>
            <button
              type="button"
              onClick={() => setKwHandoff(null)}
              className="text-emerald-400 hover:text-emerald-600 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Header */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-full mb-3">
            <Zap className="w-3.5 h-3.5" /> Campaign Builder · 8-step Pipeline
          </div>
          <h1 className="text-xl font-bold text-gray-900">สร้าง Campaign ใหม่</h1>
          <p className="text-sm text-gray-500 mt-1">
            เลือก account แล้วให้ AI กรอกข้อมูลให้อัตโนมัติ หรือกรอกเองแบบ Manual
          </p>
        </div>

        {/* Pipeline steps preview */}
        <div className="flex items-center gap-1 mb-6 flex-wrap">
          {STEPS.map((s, i) => (
            <span key={s.n} className="flex items-center gap-1">
              <span className={cn(
                'flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1',
                s.n === 0
                  ? 'bg-amber-50 border border-amber-200 text-amber-700'
                  : 'bg-gray-50 border border-gray-200 text-gray-400'
              )}>
                <s.icon className="w-3 h-3" />
                {s.label}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
            </span>
          ))}
        </div>

        {/* Mode Selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              <button
                onClick={switchToAI}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                  mode === 'ai'
                    ? 'bg-white shadow-sm text-blue-700 border border-blue-100'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <Bot className="w-3.5 h-3.5" />
                AI Mode
              </button>
              <button
                onClick={switchToManual}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                  mode === 'manual'
                    ? 'bg-white shadow-sm text-gray-700 border border-gray-200'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <Pencil className="w-3.5 h-3.5" />
                Manual
              </button>
            </div>

            <div className="flex-1">
              {loadingAccounts ? (
                <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ) : accounts.length === 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-500">ไม่พบ account — </span>
                  <button
                    type="button"
                    onClick={() => { window.location.href = '/auth/signin' }}
                    className="text-sm text-blue-600 underline"
                  >
                    Login ใหม่
                  </button>
                </div>
              ) : (
                <AccountSelect
                  accounts={accounts}
                  value={selectedAccount?.id ?? ''}
                  onChange={(id) => {
                    const found = accounts.find((a) => a.id === id)
                    if (found) {
                      setSelectedAccount(found)
                      setPrefillDone(false)
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              )}
            </div>

            {mode === 'ai' && selectedAccount && (
              <button
                type="button"
                onClick={() => runPrefill(selectedAccount)}
                disabled={prefilling}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', prefilling && 'animate-spin')} />
                Re-fill
              </button>
            )}
          </div>

          {/* AI Mode status */}
          {mode === 'ai' && (
            <div className="mt-3">
              {prefilling && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  AI กำลังวิเคราะห์ account และกรอกข้อมูล...
                </div>
              )}
              {!prefilling && prefillDone && aiRationale && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3.5 py-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-blue-700 mb-1">AI Analysis</p>
                      <p className="text-xs text-blue-600 leading-relaxed">{aiRationale}</p>
                      {prefillContext.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-blue-400 hover:text-blue-600 cursor-pointer">
                            ดูข้อมูลที่ใช้ ({prefillContext.length} รายการ)
                          </summary>
                          <ul className="mt-1.5 space-y-0.5">
                            {prefillContext.map((c, i) => (
                              <li key={i} className="text-xs text-blue-500 pl-2 border-l border-blue-200">{c}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {!prefilling && !prefillDone && mode === 'ai' && (
                <p className="text-xs text-gray-400">เลือก account เพื่อให้ AI กรอกข้อมูลอัตโนมัติ</p>
              )}
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">ข้อมูลธุรกิจ</h2>
              {mode === 'ai' && prefillDone && (
                <span className="flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> AI กรอกให้แล้ว — แก้ได้
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อธุรกิจ</label>
              <input {...register('businessName')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="เช่น ชื่อธุรกิจของคุณ" />
              {errors.businessName && <p className="text-xs text-red-500 mt-1">{errors.businessName.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Website URL</label>
              <input {...register('websiteUrl')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://www.example.com" />
              {errors.websiteUrl && <p className="text-xs text-red-500 mt-1">{errors.websiteUrl.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">สินค้า / บริการ</label>
              <textarea {...register('productService')} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="อธิบายสินค้าหรือบริการอย่างน้อย 10 ตัวอักษร" />
              {errors.productService && <p className="text-xs text-red-500 mt-1">{errors.productService.message}</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">ตั้งค่าแคมเปญ</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">วัตถุประสงค์</label>
                <select {...register('objective')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="LEADS">Lead Generation</option>
                  <option value="SALES">Sales</option>
                  <option value="TRAFFIC">Website Traffic</option>
                  <option value="AWARENESS">Brand Awareness</option>
                  <option value="APP_INSTALLS">App Installs</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">งบประมาณรายเดือน (THB)</label>
                <input {...register('monthlyBudget', { valueAsNumber: true })} type="number"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000" />
                {errors.monthlyBudget && <p className="text-xs text-red-500 mt-1">{errors.monthlyBudget.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">พื้นที่เป้าหมาย</label>
                <input {...register('targetLocation')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Thailand" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ภาษา</label>
                <select {...register('language')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="th">ภาษาไทย</option>
                  <option value="en">English</option>
                  <option value="th,en">ไทย + English</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">กลุ่มเป้าหมาย & Conversion</h2>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">กลุ่มเป้าหมาย</label>
              <textarea {...register('targetAudience')} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="อธิบายกลุ่มเป้าหมาย อายุ ความสนใจ พฤติกรรม..." />
              {errors.targetAudience && <p className="text-xs text-red-500 mt-1">{errors.targetAudience.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Conversion Goal</label>
              <input {...register('conversionGoal')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Form submit / LINE click / Phone call" />
              {errors.conversionGoal && <p className="text-xs text-red-500 mt-1">{errors.conversionGoal.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">โปรโมชัน (optional)</label>
                <input {...register('promotion')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ลด 20% เฉพาะเดือนนี้..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Brand Tone (optional)</label>
                <input {...register('brandTone')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Professional, Friendly..." />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={mode === 'ai' && prefilling}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Zap className="w-4 h-4" />
              เริ่ม Full Automation
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}

export default function CampaignBuilderPageWrapper() {
  return <Suspense><CampaignBuilderPage /></Suspense>
}
