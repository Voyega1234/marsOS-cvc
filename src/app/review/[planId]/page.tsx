'use client'

import AppShell from '@/components/layout/AppShell'
import FlowProgressBar from '@/components/workflow/FlowProgressBar'
import QAScoreCard from '@/components/qa/QAScoreCard'
import QACheckList from '@/components/qa/QACheckList'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import { QAResult } from '@/types'
import {
  Loader, Sparkles, Send, ChevronDown, ChevronUp, ArrowLeft,
  CheckSquare, Square, AlertTriangle, CheckCircle2, Clock,
  RefreshCw, Eye, EyeOff, Upload, ImageIcon, CheckCircle, ShieldAlert, X,
  FileDown, Tag, Globe, Settings2, FileText, ExternalLink, Copy,
  ClipboardCheck, CheckCheck, UserCheck, Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'

interface QAData {
  result: QAResult
  blueprintId: string
}

interface Campaign {
  campaignName: string
  campaignType: string
  budget: number
  bidStrategy: string
  status?: string
  adGroups?: unknown[]
  assetGroups?: unknown[]
}

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  SEARCH: 'Search', DISPLAY: 'Display', PERFORMANCE_MAX: 'Performance Max',
  SHOPPING: 'Shopping', YOUTUBE: 'YouTube', DEMAND_GEN: 'Demand Gen', APP_CAMPAIGN: 'App',
}

const TYPE_COLOR: Record<string, string> = {
  SEARCH: 'bg-blue-100 text-blue-700',
  DISPLAY: 'bg-purple-100 text-purple-700',
  PERFORMANCE_MAX: 'bg-orange-100 text-orange-700',
  SHOPPING: 'bg-green-100 text-green-700',
  YOUTUBE: 'bg-red-100 text-red-700',
  DEMAND_GEN: 'bg-pink-100 text-pink-700',
  APP_CAMPAIGN: 'bg-teal-100 text-teal-700',
}

// Campaign-level QA issues
function campaignIssues(c: Campaign): string[] {
  const issues: string[] = []
  if (c.campaignType === 'PERFORMANCE_MAX') {
    const ag = c.assetGroups?.[0] as Record<string, unknown> | undefined
    if (!ag) { issues.push('ไม่มี Asset Group'); return issues }
    const hl = (ag.headlines as string[] | undefined) ?? []
    const lh = (ag.longHeadlines as string[] | undefined) ?? []
    const ds = (ag.descriptions as string[] | undefined) ?? []
    const imgs = (ag.imageAssets as unknown[] | undefined) ?? []
    if (hl.length < 15) issues.push(`Headlines ${hl.length}/15`)
    if (lh.length < 5) issues.push(`Long Headlines ${lh.length}/5`)
    if (ds.length < 4) issues.push(`Descriptions ${ds.length}/4`)
    if (imgs.length === 0) issues.push('ยังไม่มีรูป — รอ upload')
  }
  if (c.campaignType === 'SEARCH') {
    const ags = (c.adGroups as Array<Record<string, unknown>> | undefined) ?? []
    for (const ag of ags) {
      const ads = (ag.ads as unknown[] | undefined) ?? []
      if (ads.length < 2) issues.push(`Ad Group "${ag.adGroupName}" — ต้องมี 2+ ads`)
    }
  }
  return issues
}

type ReviewTab = 'qa' | 'export' | 'tracking'
type PlanStatus = 'draft' | 'pending_approval' | 'approved' | 'pushed'

export default function ReviewPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const planId = params.planId as string

  const [activeTab, setActiveTab]       = useState<ReviewTab>('qa')
  const [qaData, setQaData]             = useState<QAData | null>(null)
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [selected, setSelected]         = useState<Set<string>>(new Set())
  const [loading, setLoading]           = useState(true)
  const [running, setRunning]           = useState(false)
  const [pushing, setPushing]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [expandedCamp, setExpandedCamp] = useState<Set<string>>(new Set())
  const [blueprintId, setBlueprintId]   = useState<string>('')
  const [customerId, setCustomerId]     = useState<string>('')
  const [accounts, setAccounts]         = useState<{ id: string; name: string }[]>([])
  const [showPushConfirm, setShowPushConfirm] = useState(false)
  const [logoUploading, setLogoUploading]   = useState(false)
  const [logoResourceName, setLogoResourceName] = useState<string>('')
  const [logoPreview, setLogoPreview]       = useState<string>('')
  const [marketingUploading, setMarketingUploading] = useState(false)
  const [marketingResourceName, setMarketingResourceName] = useState<string>('')
  const [marketingPreview, setMarketingPreview] = useState<string>('')
  const [assetError, setAssetError]         = useState<string | null>(null)

  // Approval workflow
  const [planStatus, setPlanStatus]     = useState<PlanStatus>('draft')
  const [planTitle, setPlanTitle]       = useState<string>('')
  const [approvalNote, setApprovalNote] = useState<string>('')
  const [savingStatus, setSavingStatus] = useState(false)
  const [exportCopied, setExportCopied] = useState(false)

  // GTM Tracking
  const [gtmAccounts, setGtmAccounts]   = useState<{ accountId: string; name: string }[]>([])
  const [gtmContainers, setGtmContainers] = useState<{ containerId: string; name: string; publicId: string }[]>([])
  const [gtmAccountId, setGtmAccountId] = useState<string>('')
  const [gtmContainerId, setGtmContainerId] = useState<string>('')
  const [loadingGtmAccounts, setLoadingGtmAccounts] = useState(false)
  const [loadingGtmContainers, setLoadingGtmContainers] = useState(false)
  const [remarketingId, setRemarketingId] = useState<string>('')
  const [loadingRemarketingId, setLoadingRemarketingId] = useState(false)
  const [gtmPushing, setGtmPushing]     = useState(false)
  const [gtmPublishing, setGtmPublishing] = useState(false)
  const [gtmWorkspaceId, setGtmWorkspaceId] = useState<string>('')
  const [gtmLog, setGtmLog]             = useState<string[]>([])
  const [gtmError, setGtmError]         = useState<string | null>(null)

  // GA4
  const [ga4Properties, setGa4Properties] = useState<{ propertyId: string; displayName: string }[]>([])
  const [ga4PropertyId, setGa4PropertyId] = useState<string>('')
  const [loadingGa4, setLoadingGa4]     = useState(false)

  // Load accounts — do NOT auto-select, user must explicitly pick target account
  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((d) => {
        const accs = d.accounts ?? []
        setAccounts(accs)
        // Never auto-select — user must choose the target account explicitly
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchExisting = useCallback(async () => {
    try {
      const [bpRes, planRes] = await Promise.all([
        fetch(`/api/campaign-blueprints/${planId}`),
        fetch(`/api/media-plans/${planId}`),
      ])

      if (planRes.ok) {
        const plan = await planRes.json()
        const briefCustomerId = plan.brief?.googleAdsCustomerId as string | undefined
        if (briefCustomerId && !customerId) setCustomerId(briefCustomerId.replace(/-/g, ''))
        setPlanStatus((plan.status as PlanStatus) ?? 'draft')
        setPlanTitle(plan.title ?? '')
      }

      if (bpRes.ok) {
        const bp = await bpRes.json()
        setBlueprintId(bp.id)
        const parsed = bp.blueprintJson ? JSON.parse(bp.blueprintJson) : null
        const cams: Campaign[] = parsed?.campaigns ?? []
        setCampaigns(cams)
        setSelected(new Set(cams.map((c: Campaign) => c.campaignName)))

        if (bp.qaChecks && bp.qaChecks.length > 0) {
          const result: QAResult = {
            score: bp.qaScore || 88,
            totalChecks: bp.qaChecks.length,
            passed:   bp.qaChecks.filter((c: { status: string }) => c.status === 'pass').length,
            failed:   bp.qaChecks.filter((c: { status: string }) => c.status === 'fail').length,
            warnings: bp.qaChecks.filter((c: { status: string }) => c.status === 'warning').length,
            checks:   bp.qaChecks,
            summary:  'QA ผ่านแล้ว',
            readyToPush: (bp.qaScore || 88) >= 70,
          }
          setQaData({ result, blueprintId: bp.id })
        }
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [planId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load GTM accounts from user's session
  useEffect(() => {
    if (!session) return
    setLoadingGtmAccounts(true)
    fetch('/api/integrations/gtm')
      .then(r => r.json())
      .then((d: { accounts?: { accountId: string; name: string }[] }) => setGtmAccounts(d.accounts ?? []))
      .catch(() => {})
      .finally(() => setLoadingGtmAccounts(false))
  }, [session])

  // Load GTM containers when account selected
  useEffect(() => {
    if (!gtmAccountId) { setGtmContainers([]); setGtmContainerId(''); return }
    setLoadingGtmContainers(true)
    fetch(`/api/integrations/gtm?accountId=${gtmAccountId}`)
      .then(r => r.json())
      .then((d: { containers?: { containerId: string; name: string; publicId: string }[] }) => setGtmContainers(d.containers ?? []))
      .catch(() => {})
      .finally(() => setLoadingGtmContainers(false))
  }, [gtmAccountId])

  // Load GA4 properties
  useEffect(() => {
    if (!session) return
    setLoadingGa4(true)
    fetch('/api/integrations/ga4')
      .then(r => r.json())
      .then((d: { data?: { propertyId: string; displayName: string }[] }) => setGa4Properties(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingGa4(false))
  }, [session])

  // Fetch remarketing ID from Google Ads account when customerId is set
  useEffect(() => {
    if (!customerId) { setRemarketingId(''); return }
    setLoadingRemarketingId(true)
    fetch(`/api/google-ads/customer-info?customerId=${customerId}`)
      .then(r => r.json())
      .then((d: { remarketingId?: string }) => setRemarketingId(d.remarketingId ?? ''))
      .catch(() => {})
      .finally(() => setLoadingRemarketingId(false))
  }, [customerId])

  useEffect(() => { fetchExisting() }, [fetchExisting])

  async function updatePlanStatus(newStatus: PlanStatus) {
    setSavingStatus(true)
    try {
      await fetch(`/api/media-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      setPlanStatus(newStatus)
    } catch { /* ignore */ }
    setSavingStatus(false)
  }

  function getExportUrl(format: string) {
    const p = new URLSearchParams({ mediaPlanId: planId, format })
    if (blueprintId) p.set('blueprintId', blueprintId)
    if (format === 'html') return `/api/export/html?${p.toString()}`
    return `/api/export/text-ads?${p.toString()}`
  }

  async function copyExportLink() {
    const url = `${window.location.origin}/export/text-ads?mediaPlanId=${planId}&blueprintId=${blueprintId}`
    await navigator.clipboard.writeText(url)
    setExportCopied(true)
    setTimeout(() => setExportCopied(false), 2000)
  }

  async function pushGtmTracking() {
    const token = (session as unknown as { accessToken?: string })?.accessToken
    if (!token || !gtmAccountId || !gtmContainerId) return
    setGtmPushing(true); setGtmError(null); setGtmLog([])
    try {
      const res = await fetch('/api/tracking/push-to-gtm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-token': token },
        body: JSON.stringify({
          accountId: gtmAccountId,
          containerId: gtmContainerId,
          workspaceId: '1',  // GTM default workspace — reuse always, never create new
          workspace: { tags: [], triggers: [] },
          googleAdsConversionId: remarketingId,
          googleAdsRemarketingId: remarketingId,
          pushRemarketing: true,
          pushConversionLinker: true,
        }),
      })
      const data = await res.json() as {
        success?: boolean
        workspaceId?: string
        publishedVersionId?: string
        log?: string[]
        error?: string
      }
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Push failed')
      setGtmLog(data.log ?? [])
      setGtmWorkspaceId(data.workspaceId ?? '')
    } catch (e) {
      setGtmError(e instanceof Error ? e.message : 'Push failed')
    } finally { setGtmPushing(false) }
  }

  async function publishGtmVersion() {
    const token = (session as unknown as { accessToken?: string })?.accessToken
    if (!token || !gtmAccountId || !gtmContainerId || !gtmWorkspaceId) return
    setGtmPublishing(true); setGtmError(null)
    try {
      const res = await fetch('/api/tracking/publish-gtm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-token': token },
        body: JSON.stringify({ accountId: gtmAccountId, containerId: gtmContainerId, workspaceId: gtmWorkspaceId }),
      })
      const data = await res.json() as { success?: boolean; versionId?: string; error?: string }
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Publish failed')
      setGtmLog(prev => [...prev, `✓ Published! Version: ${data.versionId}`])
    } catch (e) {
      setGtmError(e instanceof Error ? e.message : 'Publish failed')
    } finally { setGtmPublishing(false) }
  }

  function toggleCampaign(name: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === campaigns.length) setSelected(new Set())
    else setSelected(new Set(campaigns.map(c => c.campaignName)))
  }

  function toggleExpand(name: string) {
    setExpandedCamp(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function uploadAsset(file: File): Promise<string> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('customerId', customerId)
    const res = await fetch('/api/google-ads/upload-logo', { method: 'POST', body: fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload failed')
    return data.resourceName as string
  }

  async function handleLogoUpload(file: File) {
    if (!customerId) { setAssetError('เลือก Google Ads Account ก่อน'); return }
    setLogoUploading(true); setAssetError(null)
    try {
      setLogoPreview(URL.createObjectURL(file))
      setLogoResourceName(await uploadAsset(file))
    } catch (e) {
      setLogoPreview('')
      setAssetError(e instanceof Error ? e.message : 'Upload failed')
    } finally { setLogoUploading(false) }
  }

  async function handleMarketingUpload(file: File) {
    if (!customerId) { setAssetError('เลือก Google Ads Account ก่อน'); return }
    setMarketingUploading(true); setAssetError(null)
    try {
      setMarketingPreview(URL.createObjectURL(file))
      setMarketingResourceName(await uploadAsset(file))
    } catch (e) {
      setMarketingPreview('')
      setAssetError(e instanceof Error ? e.message : 'Upload failed')
    } finally { setMarketingUploading(false) }
  }

  async function runQA() {
    if (!accountSelected) { setError('กรุณาเลือก Google Ads Account ก่อน'); return }
    setRunning(true); setError(null)
    try {
      const bpRes = await fetch(`/api/campaign-blueprints/${planId}`)
      if (!bpRes.ok) throw new Error('Blueprint not found')
      const bp = await bpRes.json()
      const res = await fetch('/api/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprintId: bp.id }),
      })
      if (!res.ok) throw new Error('Failed to run QA')
      const data = await res.json()
      setQaData({ result: data.qaResult, blueprintId: bp.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error running QA')
    } finally { setRunning(false) }
  }

  async function pushSelected() {
    if (!accountSelected) { setError('กรุณาเลือก Google Ads Account ก่อน'); return }
    if (selected.size === 0) return
    setPushing(true); setError(null)
    try {
      const selectedNames = Array.from(selected)
      const hasPMax = selectedCampaigns.some(c => c.campaignType === 'PERFORMANCE_MAX')
      const res = await fetch('/api/google-ads/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprintId,
          customerId: customerId || process.env.NEXT_PUBLIC_DEFAULT_CUSTOMER_ID || '',
          mode: 'PAUSED',
          campaignNames: selectedNames,
          ...(hasPMax && logoResourceName ? {
            pmaxImageAssets: {
              logoResourceName,
              ...(marketingResourceName ? { marketingImageResourceName: marketingResourceName } : {}),
            },
          } : {}),
        }),
      })
      if (!res.ok) throw new Error('Push failed')
      router.push(`/push-log/${planId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed')
    } finally { setPushing(false) }
  }

  const selectedCampaigns = campaigns.filter(c => selected.has(c.campaignName))
  const selectedHasIssues = selectedCampaigns.some(c => campaignIssues(c).length > 0)
  const accountSelected = customerId.length > 0
  const selectedHasPMax = selectedCampaigns.some(c => c.campaignType === 'PERFORMANCE_MAX')
  const pmaxLogoReady = !selectedHasPMax || !!logoResourceName
  const canPush = qaData?.result.readyToPush && selected.size > 0 && !selectedHasIssues && accountSelected && pmaxLogoReady

  const STATUS_CONFIG: Record<PlanStatus, { label: string; color: string; next?: PlanStatus; nextLabel?: string }> = {
    draft:            { label: 'Draft',            color: 'bg-gray-100 text-gray-600', next: 'pending_approval', nextLabel: 'ส่งลูกค้าตรวจ' },
    pending_approval: { label: 'รอ Approve',        color: 'bg-amber-100 text-amber-700', next: 'approved', nextLabel: 'Approve แผน' },
    approved:         { label: 'Approved',          color: 'bg-emerald-100 text-emerald-700', next: 'pushed', nextLabel: 'Push to Google Ads' },
    pushed:           { label: 'Pushed',            color: 'bg-blue-100 text-blue-700' },
  }

  return (
    <AppShell>
      <FlowProgressBar planId={planId as string} currentStep="qa" />

      <div className="max-w-4xl mx-auto">
        <div className="mb-6 mt-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={() => router.push(`/campaign-builder/${planId}`)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Ad Copy
                </button>
              </div>
              <h1 className="text-xl font-bold text-gray-900">Review & Push</h1>
              <p className="text-sm text-gray-500 mt-0.5">QA → Export → Approve → Tracking → Push</p>
            </div>
            {/* Status badge + advance button */}
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', STATUS_CONFIG[planStatus].color)}>
                {STATUS_CONFIG[planStatus].label}
              </span>
              {STATUS_CONFIG[planStatus].next && planStatus !== 'approved' && (
                <button
                  onClick={() => updatePlanStatus(STATUS_CONFIG[planStatus].next!)}
                  disabled={savingStatus}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingStatus ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                  {STATUS_CONFIG[planStatus].nextLabel}
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4">
            {([
              { id: 'qa',       label: 'QA & Push',    icon: Sparkles },
              { id: 'export',   label: 'Export / ส่งลูกค้า', icon: FileDown },
              { id: 'tracking', label: 'GTM Tracking', icon: Tag },
            ] as { id: ReviewTab; label: string; icon: typeof Sparkles }[]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all',
                  activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Account selector — REQUIRED, always visible */}
          <div className={cn(
            'rounded-xl border p-4 mb-4',
            !accountSelected ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-200'
          )}>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className={cn('block text-xs font-semibold mb-1', !accountSelected ? 'text-amber-800' : 'text-blue-800')}>
                  {!accountSelected ? '⚠ กรุณาเลือก Google Ads Account ก่อน' : 'Google Ads Account ปลายทาง'}
                </label>
                <p className={cn('text-xs mb-2', !accountSelected ? 'text-amber-700' : 'text-blue-700')}>
                  {!accountSelected
                    ? 'ต้องเลือก account ทุกครั้ง — ป้องกันการ push ไปผิด account ของลูกค้าคนอื่น'
                    : `Campaign จะถูกสร้างใน account: ${accounts.find(a => a.id === customerId)?.name ?? customerId}`}
                </p>
                <AccountSelect
                  accounts={accounts}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="— เลือก Account —"
                  className={cn(
                    'text-sm border rounded-lg px-3 py-2 bg-white focus:outline-none w-full max-w-sm',
                    !accountSelected
                      ? 'border-amber-400 focus:border-amber-600 text-gray-500'
                      : 'border-blue-300 focus:border-blue-500 text-gray-800 font-medium'
                  )}
                />
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={runQA} disabled={running || !accountSelected}
                  title={!accountSelected ? 'เลือก Account ก่อน' : ''}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                  {running ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {running ? 'กำลัง QA...' : 'Run QA'}
                </button>
                {selected.size > 0 && (
                  <button onClick={() => canPush && setShowPushConfirm(true)} disabled={pushing || !canPush}
                    title={!accountSelected ? 'เลือก Account ก่อน' : selectedHasIssues ? 'บางแคมเปญที่เลือกยังมีปัญหา' : !qaData?.result.readyToPush ? 'ต้อง QA ผ่านก่อน' : ''}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap',
                      canPush ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'
                    )}>
                    {pushing ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Push {selected.size} แคมเปญ
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Export Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'export' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <FileDown className="w-4 h-4 text-blue-500" /> Export สำหรับส่งลูกค้า
              </h2>
              <p className="text-xs text-gray-500 mb-4">ดาวน์โหลดหรือส่งลิงก์ให้ลูกค้าตรวจก่อน Push จริง</p>

              <div className="space-y-3">
                {/* Preview link */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <Globe className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Preview หน้าเว็บ</p>
                    <p className="text-xs text-gray-500">เปิดลิงก์ให้ลูกค้าดูแผนทั้งหมด (Media Plan + Keywords + Text Ads)</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={copyExportLink}
                      className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-100">
                      {exportCopied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {exportCopied ? 'Copied!' : 'Copy Link'}
                    </button>
                    <a href={`/export/text-ads?mediaPlanId=${planId}&blueprintId=${blueprintId}`} target="_blank"
                      className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-300 rounded-lg px-2.5 py-1.5 hover:bg-blue-50">
                      <ExternalLink className="w-3.5 h-3.5" /> เปิด
                    </a>
                  </div>
                </div>

                {/* Download HTML Preview */}
                <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <Monitor className="w-5 h-5 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Download HTML — Ad Preview</p>
                    <p className="text-xs text-gray-500">Preview โฆษณาแบบสวยงาม เหมือนเห็นใน Google Ads UI — ส่งให้ลูกค้าได้เลย</p>
                  </div>
                  <button onClick={() => { window.location.href = getExportUrl('html') }}
                    className="shrink-0 flex items-center gap-1.5 text-xs text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-100 font-medium bg-white">
                    <FileDown className="w-3.5 h-3.5" /> HTML
                  </button>
                </div>

                {/* Download CSV */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Download CSV — Text Ads</p>
                    <p className="text-xs text-gray-500">Headlines, Descriptions, Keywords ทุก campaign ในไฟล์เดียว</p>
                  </div>
                  <a href={getExportUrl('csv')} download
                    className="shrink-0 flex items-center gap-1.5 text-xs text-emerald-700 border border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-50 font-medium">
                    <FileDown className="w-3.5 h-3.5" /> CSV
                  </a>
                </div>

                {/* Download JSON */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <Settings2 className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Download JSON — Full Blueprint</p>
                    <p className="text-xs text-gray-500">ข้อมูล blueprint ทั้งหมดในรูปแบบ JSON (สำหรับ dev/audit)</p>
                  </div>
                  <a href={getExportUrl('json')} download
                    className="shrink-0 flex items-center gap-1.5 text-xs text-purple-700 border border-purple-300 rounded-lg px-3 py-1.5 hover:bg-purple-50 font-medium">
                    <FileDown className="w-3.5 h-3.5" /> JSON
                  </a>
                </div>
              </div>
            </div>

            {/* Approval workflow */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-emerald-500" /> สถานะ Approval
              </h2>
              <p className="text-xs text-gray-500 mb-4">บันทึกสถานะ approval ของลูกค้า ก่อน push ขึ้น Google Ads</p>

              <div className="flex gap-2 flex-wrap mb-4">
                {(['draft', 'pending_approval', 'approved'] as PlanStatus[]).map(s => (
                  <button key={s} onClick={() => updatePlanStatus(s)} disabled={savingStatus}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold rounded-full border transition-all',
                      planStatus === s
                        ? STATUS_CONFIG[s].color + ' border-current'
                        : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                    )}>
                    {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>

              {planStatus === 'pending_approval' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1">รอลูกค้าตรวจสอบ</p>
                  <p className="text-xs text-amber-700">ส่งลิงก์ Preview ด้านบนให้ลูกค้า เมื่อลูกค้า OK แล้วให้กด Approve</p>
                  <button onClick={() => updatePlanStatus('approved')} disabled={savingStatus}
                    className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 px-3 py-1.5 rounded-lg hover:bg-emerald-100">
                    <UserCheck className="w-3.5 h-3.5" /> Approve แผนนี้
                  </button>
                </div>
              )}

              {planStatus === 'approved' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <p className="text-xs text-emerald-800 font-medium">Approved — พร้อม Push ขึ้น Google Ads ได้แล้ว</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tracking Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'tracking' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Tag className="w-4 h-4 text-purple-500" /> GTM Tracking Setup
              </h2>
              <p className="text-xs text-gray-500 mb-4">สร้าง Remarketing + Conversion Linker tags ใน GTM และ Publish ได้เลย</p>

              {/* Remarketing ID from account */}
              <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-xs font-semibold text-gray-700 mb-1">Google Ads Conversion ID (Remarketing)</p>
                {loadingRemarketingId ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400"><Loader className="w-3.5 h-3.5 animate-spin" /> กำลังดึงจาก account...</div>
                ) : remarketingId ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">{remarketingId}</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-emerald-700">ดึงจาก account {customerId}</span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    {customerId ? 'ไม่พบ Conversion ID — ตรวจสอบ account permissions' : 'เลือก Google Ads Account ก่อน (ใน tab QA & Push)'}
                  </p>
                )}
              </div>

              {/* GTM Account + Container */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                    GTM Account
                    {loadingGtmAccounts && <Loader className="w-3 h-3 animate-spin text-gray-400" />}
                  </label>
                  <select value={gtmAccountId} onChange={e => setGtmAccountId(e.target.value)}
                    disabled={loadingGtmAccounts}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50">
                    <option value="">{loadingGtmAccounts ? 'กำลังโหลด...' : '— เลือก GTM Account —'}</option>
                    {gtmAccounts.map(a => (
                      <option key={a.accountId} value={a.accountId}>{a.name}</option>
                    ))}
                  </select>
                  {!loadingGtmAccounts && gtmAccounts.length === 0 && (
                    <p className="text-[10px] text-amber-600 mt-1">ไม่พบ GTM Account — ตรวจสอบว่า login ด้วย email ที่มีสิทธิ์ GTM</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                    GTM Container
                    {loadingGtmContainers && <Loader className="w-3 h-3 animate-spin text-gray-400" />}
                  </label>
                  <select value={gtmContainerId} onChange={e => setGtmContainerId(e.target.value)}
                    disabled={!gtmAccountId || loadingGtmContainers || gtmContainers.length === 0}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-100">
                    <option value="">{loadingGtmContainers ? 'กำลังโหลด...' : '— เลือก Container —'}</option>
                    {gtmContainers.map(c => (
                      <option key={c.containerId} value={c.containerId}>{c.name} ({c.publicId})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* GA4 Property */}
              <div className="mb-4">
                <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                  GA4 Property (สำหรับ cross-reference)
                  {loadingGa4 && <Loader className="w-3 h-3 animate-spin text-gray-400" />}
                </label>
                <select value={ga4PropertyId} onChange={e => setGa4PropertyId(e.target.value)}
                  disabled={loadingGa4}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50">
                  <option value="">{loadingGa4 ? 'กำลังโหลด...' : ga4Properties.length === 0 ? 'ไม่พบ GA4 Property' : '— เลือก GA4 Property (optional) —'}</option>
                  {ga4Properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.displayName} (GA4-{p.propertyId})</option>
                  ))}
                </select>
                {!loadingGa4 && ga4Properties.length === 0 && (
                  <p className="text-[10px] text-gray-400 mt-1">ต้องมี Google Analytics scope — ลอง sign out แล้ว sign in ใหม่</p>
                )}
              </div>

              {/* Tags that will be created */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-blue-800 mb-2">Tags ที่จะสร้างใน GTM:</p>
                {[
                  { name: 'CVC - Conversion Linker', trigger: 'Initialization - All Pages', type: 'awcl', color: 'bg-blue-100 text-blue-700' },
                  { name: 'CVC - Google Ads Remarketing', trigger: 'Initialization - All Pages', type: remarketingId || 'AW-XXXXXXXXX', color: 'bg-purple-100 text-purple-700' },
                ].map(t => (
                  <div key={t.name} className="flex items-center gap-2 text-xs">
                    <span className={cn('px-1.5 py-0.5 rounded font-mono font-semibold text-[10px]', t.color)}>{t.type}</span>
                    <span className="font-medium text-blue-900">{t.name}</span>
                    <span className="text-blue-600 ml-auto">→ {t.trigger}</span>
                  </div>
                ))}
              </div>

              {/* Push + Publish buttons */}
              <div className="flex gap-3">
                <button
                  onClick={pushGtmTracking}
                  disabled={gtmPushing || !gtmAccountId || !gtmContainerId}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {gtmPushing ? <Loader className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  Push Tags to GTM
                </button>

                {gtmWorkspaceId && (
                  <button
                    onClick={publishGtmVersion}
                    disabled={gtmPublishing}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-gray-300 transition-colors"
                  >
                    {gtmPublishing ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Publish GTM Version
                  </button>
                )}
              </div>

              {gtmError && (
                <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {gtmError}
                </div>
              )}

              {gtmLog.length > 0 && (
                <div className="mt-3 bg-gray-900 rounded-xl p-4 overflow-auto max-h-48">
                  {gtmLog.map((line, i) => (
                    <p key={i} className={cn('text-xs font-mono', line.startsWith('✓') ? 'text-emerald-400' : line.startsWith('⚠') ? 'text-amber-400' : 'text-gray-300')}>
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── QA Tab ───────────────────────────────────────────────────────── */}
        {activeTab === 'qa' && <>

        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">

            {/* Campaign Selection */}
            {campaigns.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <button onClick={toggleAll} className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors">
                    {selected.size === campaigns.length
                      ? <CheckSquare className="w-4 h-4 text-blue-600" />
                      : <Square className="w-4 h-4 text-gray-400" />}
                    เลือกทั้งหมด ({campaigns.length} แคมเปญ)
                  </button>
                  <span className="ml-auto text-xs text-gray-400">เลือก {selected.size}/{campaigns.length}</span>
                </div>

                <div className="divide-y divide-gray-100">
                  {campaigns.map((camp) => {
                    const issues = campaignIssues(camp)
                    const isSelected = selected.has(camp.campaignName)
                    const isExpanded = expandedCamp.has(camp.campaignName)

                    return (
                      <div key={camp.campaignName}
                        className={cn('transition-colors', isSelected ? 'bg-blue-50/40' : 'bg-white')}>
                        <div className="flex items-center gap-3 px-4 py-3">
                          <button onClick={() => toggleCampaign(camp.campaignName)} className="flex-shrink-0">
                            {isSelected
                              ? <CheckSquare className="w-4 h-4 text-blue-600" />
                              : <Square className="w-4 h-4 text-gray-300" />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900 truncate">{camp.campaignName}</p>
                              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', TYPE_COLOR[camp.campaignType] ?? 'bg-gray-100 text-gray-600')}>
                                {CAMPAIGN_TYPE_LABELS[camp.campaignType] ?? camp.campaignType}
                              </span>
                              {issues.length === 0
                                ? <span className="flex items-center gap-0.5 text-[10px] text-green-600"><CheckCircle2 className="w-3 h-3" />พร้อม Push</span>
                                : <span className="flex items-center gap-0.5 text-[10px] text-amber-600"><Clock className="w-3 h-3" />{issues.length} ปัญหา</span>}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              ฿{camp.budget?.toLocaleString()}/วัน · {camp.bidStrategy}
                              {(camp.adGroups as unknown[] | undefined)?.length
                                ? ` · ${(camp.adGroups as unknown[]).length} ad groups`
                                : ''}
                            </p>
                          </div>

                          <button onClick={() => toggleExpand(camp.campaignName)}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors">
                            {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>

                        {/* Issues */}
                        {issues.length > 0 && (
                          <div className="px-11 pb-2 space-y-1">
                            {issues.map((issue, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1">
                                <AlertTriangle className="w-3 h-3 flex-shrink-0" />{issue}
                              </div>
                            ))}
                            {camp.campaignType === 'PERFORMANCE_MAX' && (
                              <p className="text-[10px] text-gray-400 px-1">สามารถ push แคมเปญอื่นก่อน แล้วค่อย push PMax เมื่อรูปพร้อม</p>
                            )}
                          </div>
                        )}

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="px-11 pb-3">
                            {camp.campaignType === 'PERFORMANCE_MAX' && camp.assetGroups && (
                              <div className="mt-2 space-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                                <p className="font-medium text-gray-700 mb-1">Asset Groups</p>
                                {(camp.assetGroups as Array<Record<string, unknown>>).map((ag, i) => (
                                  <div key={i}>
                                    <span className="font-mono text-gray-500">{String(ag.assetGroupName ?? `Group ${i+1}`)}</span>
                                    {' — '}
                                    {(ag.headlines as string[] | undefined)?.length ?? 0} headlines,{' '}
                                    {(ag.longHeadlines as string[] | undefined)?.length ?? 0} long headlines,{' '}
                                    {(ag.descriptions as string[] | undefined)?.length ?? 0} descriptions
                                  </div>
                                ))}
                              </div>
                            )}
                            {camp.campaignType === 'SEARCH' && camp.adGroups && (
                              <div className="mt-2 space-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                                <p className="font-medium text-gray-700 mb-1">Ad Groups</p>
                                {(camp.adGroups as Array<Record<string, unknown>>).map((ag, i) => (
                                  <div key={i}>
                                    <span className="font-mono text-gray-500">{String(ag.adGroupName ?? `Group ${i+1}`)}</span>
                                    {' — '}
                                    {(ag.keywords as string[] | undefined)?.length ?? 0} keywords,{' '}
                                    {(ag.ads as unknown[] | undefined)?.length ?? 0} ads
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* PMax Brand Assets */}
            {campaigns.some(c => c.campaignType === 'PERFORMANCE_MAX') && (
              <div className="bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-orange-100 bg-orange-50">
                  <ImageIcon className="w-4 h-4 text-orange-600" />
                  <h2 className="text-sm font-semibold text-orange-800">PMax Brand Assets</h2>
                  <span className="ml-auto text-[10px] text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                    {logoResourceName ? '✓ Logo พร้อม' : 'ต้องอัพโหลดก่อน Push PMax'}
                  </span>
                </div>
                <div className="p-4 space-y-4">
                  <p className="text-xs text-gray-500">
                    อัพโหลดรูปก่อน push — ระบบจะ link เข้า PMax campaign อัตโนมัติ
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Square Logo */}
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1.5">
                        Square Logo <span className="text-red-500">*</span>
                        <span className="font-normal text-gray-400 ml-1">1:1 · ขั้นต่ำ 128×128px</span>
                      </p>
                      {logoResourceName ? (
                        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                          {logoPreview && <img src={logoPreview} alt="Logo" className="w-10 h-10 object-cover rounded border border-emerald-300 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                              <CheckCircle className="w-3.5 h-3.5" />อัพโหลดแล้ว
                            </div>
                          </div>
                          <label className="cursor-pointer text-[10px] text-emerald-600 hover:underline flex-shrink-0">
                            เปลี่ยน<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }} />
                          </label>
                        </div>
                      ) : (
                        <label className={cn(
                          'flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors text-center',
                          !customerId ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                            : logoUploading ? 'border-orange-300 bg-orange-50'
                            : 'border-orange-300 bg-orange-50/50 hover:border-orange-400 hover:bg-orange-50'
                        )}>
                          {logoUploading ? <Loader className="w-5 h-5 text-orange-500 animate-spin" /> : <Upload className="w-5 h-5 text-orange-400" />}
                          <span className="text-xs font-medium text-gray-700">{logoUploading ? 'กำลังอัพโหลด...' : 'คลิกอัพโหลด Logo'}</span>
                          <span className="text-[10px] text-gray-400">JPG, PNG, WebP · max 5MB</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!customerId || logoUploading}
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }} />
                        </label>
                      )}
                    </div>

                    {/* Marketing Image */}
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1.5">
                        Marketing Image
                        <span className="font-normal text-gray-400 ml-1">1.91:1 landscape</span>
                      </p>
                      {marketingResourceName ? (
                        <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                          {marketingPreview && <img src={marketingPreview} alt="Marketing" className="w-10 h-7 object-cover rounded border border-emerald-300 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                              <CheckCircle className="w-3.5 h-3.5" />อัพโหลดแล้ว
                            </div>
                          </div>
                          <label className="cursor-pointer text-[10px] text-emerald-600 hover:underline flex-shrink-0">
                            เปลี่ยน<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleMarketingUpload(f) }} />
                          </label>
                        </div>
                      ) : (
                        <label className={cn(
                          'flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors text-center',
                          !customerId ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                            : marketingUploading ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 bg-gray-50/50 hover:border-gray-300 hover:bg-gray-50'
                        )}>
                          {marketingUploading ? <Loader className="w-5 h-5 text-blue-500 animate-spin" /> : <Upload className="w-5 h-5 text-gray-400" />}
                          <span className="text-xs font-medium text-gray-700">{marketingUploading ? 'กำลังอัพโหลด...' : 'คลิกอัพโหลด'}</span>
                          <span className="text-[10px] text-gray-400">JPG, PNG, WebP · max 5MB</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!customerId || marketingUploading}
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleMarketingUpload(f) }} />
                        </label>
                      )}
                    </div>
                  </div>

                  {assetError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{assetError}
                    </div>
                  )}

                  {selected.has(campaigns.find(c => c.campaignType === 'PERFORMANCE_MAX')?.campaignName ?? '') && !logoResourceName && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      PMax ถูก select อยู่ — ต้องอัพโหลด Square Logo ก่อนถึงจะ push ได้
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* QA Results */}
            {!qaData ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                <RefreshCw className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-gray-700 mb-1">ยังไม่ได้ Run QA</h3>
                <p className="text-xs text-gray-400 mb-4">กด Run QA เพื่อตรวจสอบ Blueprint ก่อน push</p>
                <button onClick={runQA} disabled={running}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                  <Sparkles className="w-4 h-4" />Run QA Check
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <QAScoreCard
                  score={qaData.result.score}
                  totalChecks={qaData.result.totalChecks}
                  passed={qaData.result.passed}
                  failed={qaData.result.failed}
                  warnings={qaData.result.warnings}
                  readyToPush={qaData.result.readyToPush}
                  summary={qaData.result.summary}
                />
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="font-semibold text-gray-900 mb-3 text-sm">QA Checks ({qaData.result.totalChecks})</h2>
                  <QACheckList checks={qaData.result.checks} />
                </div>

                {qaData.result.readyToPush && selected.size > 0 && (
                  <div className={cn(
                    'rounded-xl border p-4 flex items-center justify-between',
                    selectedHasIssues ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                  )}>
                    <div>
                      <h3 className={cn('font-semibold text-sm', selectedHasIssues ? 'text-amber-800' : 'text-emerald-800')}>
                        {selectedHasIssues
                          ? `${selectedCampaigns.filter(c => campaignIssues(c).length > 0).length} แคมเปญยังมีปัญหา`
                          : `พร้อม Push ${selected.size} แคมเปญ`}
                      </h3>
                      <p className={cn('text-xs mt-0.5', selectedHasIssues ? 'text-amber-700' : 'text-emerald-700')}>
                        {selectedHasIssues
                          ? 'ยกเลิก select แคมเปญที่มีปัญหา หรือแก้ไขก่อน push'
                          : `ทุกแคมเปญที่เลือกจะสร้างเป็น PAUSED บน Google Ads`}
                      </p>
                    </div>
                    <button onClick={() => !selectedHasIssues && accountSelected && setShowPushConfirm(true)} disabled={pushing || selectedHasIssues || !accountSelected}
                      title={!accountSelected ? 'เลือก Account ก่อน' : ''}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors',
                        selectedHasIssues || !accountSelected ? 'bg-gray-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                      )}>
                      {pushing ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Push Now
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </>}
      </div>

      {/* ── Push Safety Confirmation Modal ──────────────────────────────── */}
      {showPushConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-red-50 border-b border-red-100 px-6 py-4 flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-red-600 shrink-0" />
              <div>
                <h2 className="text-base font-bold text-red-900">ยืนยันการ Push Campaign จริง</h2>
                <p className="text-xs text-red-700 mt-0.5">การกระทำนี้จะสร้าง campaign จริงใน Google Ads และใช้งบโฆษณาจริง</p>
              </div>
              <button onClick={() => setShowPushConfirm(false)} className="ml-auto text-red-400 hover:text-red-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                <p className="font-semibold text-amber-900 mb-2">สรุปสิ่งที่จะเกิดขึ้น:</p>
                <ul className="space-y-1.5 text-amber-800">
                  <li>• สร้าง <strong>{selected.size} campaign</strong> ใน Google Ads (สถานะ PAUSED)</li>
                  <li>• Account: <strong>{accounts.find(a => a.id === customerId)?.name ?? customerId}</strong> ({customerId})</li>
                  <li>• Campaign จะสร้างแบบ PAUSED — ต้อง enable เองใน Google Ads</li>
                  <li>• ไม่มี rollback อัตโนมัติ — ต้องลบ/pause ด้วยตนเองถ้าต้องการยกเลิก</li>
                </ul>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Campaigns ที่จะ push:</p>
                <ul className="space-y-0.5">
                  {Array.from(selected).map(name => (
                    <li key={name} className="text-xs text-gray-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-gray-500 text-center">
                กด <strong>ยืนยัน Push</strong> เพื่อดำเนินการ หรือ <strong>ยกเลิก</strong> เพื่อกลับไปแก้ไข
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setShowPushConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => { setShowPushConfirm(false); pushSelected() }}
                disabled={pushing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:bg-gray-300 transition-colors"
              >
                {pushing ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                ยืนยัน Push จริง
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
