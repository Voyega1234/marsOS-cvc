'use client'

import AppShell from '@/components/layout/AppShell'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader, Plus, Edit2, Image as ImageIcon, Upload, Check,
  ChevronDown, ChevronRight, Sparkles, AlertCircle, CheckCircle2, Target,
  Layers, RefreshCw, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountSelect } from '@/components/ui/AccountSelect'

// ── Types ──────────────────────────────────────────────────────────────────────
interface GoogleAdsAccount { id: string; descriptiveName?: string; name?: string }

interface ExistingCampaign {
  id: string
  resourceName: string
  name: string
  campaignType: string
  status: string
  budgetAmountMicros?: string
  adGroups?: ExistingAdGroup[]
  assetGroups?: ExistingAssetGroup[]
}

interface ExistingAdGroup {
  id: string
  resourceName: string
  name: string
  status: string
  ads?: ExistingAd[]
}

interface ExistingAd {
  id: string
  resourceName: string
  type: string
  headlines?: string[]
  descriptions?: string[]
  finalUrls?: string[]
}

interface ExistingAssetGroup {
  id: string
  resourceName: string
  name: string
  status: string
}

type AdjustMode = 'add_pmax_asset_group' | 'edit_text_ads' | 'gdn_adgroup' | 'gdn_image' | null

const MODE_LABELS: Record<string, string> = {
  add_pmax_asset_group: 'เพิ่ม Asset Group ใน PMax',
  edit_text_ads:        'แก้ไข Text Ads',
  gdn_adgroup:          'เพิ่ม Ad Group / Targeting ใน GDN',
  gdn_image:            'เปลี่ยนรูป GDN',
}

const CAMPAIGN_TYPE_COLORS: Record<string, string> = {
  PERFORMANCE_MAX: 'bg-orange-100 text-orange-700 border-orange-200',
  SEARCH:          'bg-blue-100 text-blue-700 border-blue-200',
  DISPLAY:         'bg-purple-100 text-purple-700 border-purple-200',
  VIDEO:           'bg-red-100 text-red-700 border-red-200',
  SHOPPING:        'bg-green-100 text-green-700 border-green-200',
  DEMAND_GEN:      'bg-teal-100 text-teal-700 border-teal-200',
}

// ── Char counter ───────────────────────────────────────────────────────────────
function CharCounter({ value, max }: { value: string; max: number }) {
  const over = value.length > max
  return (
    <span className={cn('text-[10px] ml-auto', over ? 'text-red-500 font-semibold' : 'text-gray-400')}>
      {value.length}/{max}
    </span>
  )
}

// ── Multi-text field ───────────────────────────────────────────────────────────
function MultiTextField({
  label, values, onChange, maxChar, minItems, maxItems, placeholder,
}: {
  label: string; values: string[]; onChange: (v: string[]) => void
  maxChar: number; minItems: number; maxItems: number; placeholder: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className={cn('text-[11px]', values.length < minItems ? 'text-red-400' : 'text-gray-400')}>
          {values.length}/{maxItems} {values.length < minItems && `(ขั้นต่ำ ${minItems})`}
        </span>
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={v}
              onChange={e => { const n = [...values]; n[i] = e.target.value; onChange(n) }}
              placeholder={placeholder}
              className={cn(
                'flex-1 px-2.5 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                v.length > maxChar ? 'border-red-400' : 'border-gray-300'
              )}
            />
            <CharCounter value={v} max={maxChar} />
            {values.length > minItems && (
              <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {values.length < maxItems && (
        <button
          onClick={() => onChange([...values, ''])}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          <Plus className="w-3.5 h-3.5" /> เพิ่ม {label.split(' ')[0]}
        </button>
      )}
    </div>
  )
}

// ── Image uploader ─────────────────────────────────────────────────────────────
function ImageUploadSlot({
  label, size, onUploaded,
}: { label: string; size: string; onUploaded: (url: string, resourceName: string) => void }) {
  const [preview, setPreview] = useState('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true); setErr('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; resourceName?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setPreview(data.url ?? '')
      onUploaded(data.url ?? '', data.resourceName ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div
        className="relative h-32 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => ref.current?.click()}
      >
        {preview ? (
          <>
            <img src={preview} alt={label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
              <Upload className="w-6 h-6 text-white" />
            </div>
            <div className="absolute top-1.5 right-1.5 bg-green-500 rounded-full p-0.5">
              <Check className="w-3 h-3 text-white" />
            </div>
          </>
        ) : uploading ? (
          <Loader className="w-5 h-5 text-gray-400 animate-spin" />
        ) : (
          <>
            <ImageIcon className="w-6 h-6 text-gray-300 mb-1" />
            <span className="text-xs text-gray-400">คลิกเพื่ออัปโหลด</span>
          </>
        )}
        <input ref={ref} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </div>
      <div className="px-3 py-2 bg-white">
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className="text-[10px] text-gray-400">{size}</p>
        {err && <p className="text-[10px] text-red-500">{err}</p>}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CampaignAdjustmentPage() {
  const params = useParams()
  const router = useRouter()
  const planId = params.planId as string

  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [campaigns, setCampaigns] = useState<ExistingCampaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<ExistingCampaign | null>(null)
  const [selectedAdGroup, setSelectedAdGroup] = useState<ExistingAdGroup | null>(null)
  const [selectedAd, setSelectedAd] = useState<ExistingAd | null>(null)
  const [mode, setMode] = useState<AdjustMode>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Form states for each mode
  const [headlines, setHeadlines] = useState<string[]>(['', '', ''])
  const [longHeadlines, setLongHeadlines] = useState<string[]>([''])
  const [descriptions, setDescriptions] = useState<string[]>(['', ''])
  const [businessName, setBusinessName] = useState('')
  const [finalUrl, setFinalUrl] = useState('')
  const [assetGroupName, setAssetGroupName] = useState('')
  const [adGroupName, setAdGroupName] = useState('')
  const [gdnTargetKeywords, setGdnTargetKeywords] = useState('')
  const [gdnPlacements, setGdnPlacements] = useState('')
  const [imageResourceName, setImageResourceName] = useState('')
  const [logoResourceName, setLogoResourceName] = useState('')

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => setAccounts(d.accounts ?? []))
      .catch(() => {})
  }, [])

  async function loadCampaigns() {
    if (!selectedAccountId) return
    setLoadingCampaigns(true)
    setCampaigns([])
    setSelectedCampaign(null)
    setMode(null)
    try {
      const res = await fetch(`/api/clients/${selectedAccountId}/campaigns/list-with-ads`)
      if (res.ok) {
        const data = await res.json() as { campaigns?: ExistingCampaign[] }
        setCampaigns(data.campaigns ?? [])
      } else {
        const data = await res.json() as { error?: string }
        console.error('Failed to load campaigns:', data.error)
      }
    } catch {}
    setLoadingCampaigns(false)
  }

  function selectCampaign(c: ExistingCampaign) {
    setSelectedCampaign(c)
    setSelectedAdGroup(null)
    setSelectedAd(null)
    setMode(null)
    setResult(null)
    // Pre-fill finalUrl from campaign
    setAssetGroupName(`Asset Group - ${new Date().toLocaleDateString('th')}`)
    setAdGroupName(`Ad Group - ${new Date().toLocaleDateString('th')}`)
    // Choose default mode by campaign type
    if (c.campaignType === 'PERFORMANCE_MAX') setMode('add_pmax_asset_group')
    else if (c.campaignType === 'SEARCH') setMode('edit_text_ads')
    else if (c.campaignType === 'DISPLAY') setMode('gdn_adgroup')
  }

  function availableModes(c: ExistingCampaign): AdjustMode[] {
    if (c.campaignType === 'PERFORMANCE_MAX') return ['add_pmax_asset_group']
    if (c.campaignType === 'SEARCH') return ['edit_text_ads']
    if (c.campaignType === 'DISPLAY') return ['gdn_adgroup', 'gdn_image']
    return []
  }

  async function submit() {
    if (!selectedCampaign || !mode) return
    setSubmitting(true)
    setResult(null)
    try {
      let body: Record<string, unknown> = {
        customerId: selectedAccountId,
        action: mode,
      }

      if (mode === 'add_pmax_asset_group') {
        body = {
          ...body,
          campaignResourceName: selectedCampaign.resourceName,
          assetGroupName,
          finalUrl,
          headlines: headlines.filter(Boolean),
          longHeadlines: longHeadlines.filter(Boolean),
          descriptions: descriptions.filter(Boolean),
          businessName,
          imageResourceNames: imageResourceName ? [imageResourceName] : [],
        }
      } else if (mode === 'edit_text_ads') {
        if (!selectedAd) throw new Error('กรุณาเลือก Ad ที่ต้องการแก้ไข')
        body = {
          ...body,
          adGroupAdResourceName: selectedAd.resourceName,
          headlines: headlines.filter(Boolean),
          descriptions: descriptions.filter(Boolean),
          finalUrl,
        }
      } else if (mode === 'gdn_adgroup') {
        body = {
          ...body,
          campaignResourceName: selectedCampaign.resourceName,
          adGroupName,
          targeting: {
            keywords: gdnTargetKeywords.split('\n').map(s => s.trim()).filter(Boolean),
            placements: gdnPlacements.split('\n').map(s => s.trim()).filter(Boolean),
          },
          ads: [{
            headlines: headlines.filter(Boolean),
            longHeadline: longHeadlines[0] ?? '',
            descriptions: descriptions.filter(Boolean),
            businessName,
            finalUrl,
            imageResourceName: imageResourceName || undefined,
            logoResourceName: logoResourceName || undefined,
          }],
        }
      } else if (mode === 'gdn_image') {
        if (!selectedAd) throw new Error('กรุณาเลือก Ad ที่ต้องการเปลี่ยนรูป')
        if (!imageResourceName) throw new Error('กรุณาอัปโหลดรูปก่อน')
        body = {
          ...body,
          adGroupAdResourceName: selectedAd.resourceName,
          imageResourceName,
          imageAssetType: 'MARKETING_IMAGE',
        }
      }

      const res = await fetch('/api/campaign-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { success?: boolean; message?: string; error?: string; mock?: boolean }
      if (res.ok && data.success) {
        setResult({ ok: true, message: data.message ?? `${MODE_LABELS[mode]} สำเร็จ${data.mock ? ' (Mock)' : ''}` })
      } else {
        setResult({ ok: false, message: data.error ?? 'เกิดข้อผิดพลาด' })
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Error' })
    } finally {
      setSubmitting(false)
    }
  }

  const isPMax = selectedCampaign?.campaignType === 'PERFORMANCE_MAX'
  const isSearch = selectedCampaign?.campaignType === 'SEARCH'
  const isDisplay = selectedCampaign?.campaignType === 'DISPLAY'

  return (
    <AppShell>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push(`/media-plans/${planId}`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" />กลับ
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-500" />
            Campaign Adjustment
          </h1>
          <p className="text-sm text-gray-500">แก้ไข / เพิ่มใน campaigns ที่มีอยู่แล้วใน Google Ads</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* ── Left: Select account + campaign ── */}
        <div className="col-span-1 space-y-4">
          {/* Account picker */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">1. เลือก Account</p>
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={id => { setSelectedAccountId(id); setCampaigns([]); setSelectedCampaign(null) }}
              placeholder="เลือก account"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={loadCampaigns}
              disabled={!selectedAccountId || loadingCampaigns}
              className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
            >
              {loadingCampaigns ? <><Loader className="w-3.5 h-3.5 animate-spin" />กำลังโหลด...</> : <><RefreshCw className="w-3.5 h-3.5" />โหลด Campaigns</>}
            </button>
          </div>

          {/* Campaign list */}
          {campaigns.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">2. เลือก Campaign ({campaigns.length})</p>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {campaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => selectCampaign(c)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all',
                      selectedCampaign?.id === c.id
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border',
                        CAMPAIGN_TYPE_COLORS[c.campaignType] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                      )}>
                        {c.campaignType === 'PERFORMANCE_MAX' ? 'PMAX' : c.campaignType.slice(0, 6)}
                      </span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', c.status === 'ENABLED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {c.status}
                      </span>
                    </div>
                    <p className="font-medium text-gray-800 text-xs leading-tight truncate">{c.name}</p>
                    {c.budgetAmountMicros && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        ฿{(parseInt(c.budgetAmountMicros) / 1_000_000).toLocaleString()}/day
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Adjustment form ── */}
        <div className="col-span-2 space-y-4">
          {!selectedCampaign ? (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-20 text-center">
              <Layers className="w-12 h-12 text-gray-200 mb-3" />
              <p className="text-gray-400 text-sm">เลือก Account และ Campaign ก่อน</p>
              <p className="text-gray-300 text-xs mt-1">ระบบจะโหลดรายการ campaigns จาก Google Ads</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Campaign header */}
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{selectedCampaign.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded border',
                        CAMPAIGN_TYPE_COLORS[selectedCampaign.campaignType] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                      )}>
                        {selectedCampaign.campaignType === 'PERFORMANCE_MAX' ? 'Performance Max' : selectedCampaign.campaignType}
                      </span>
                      <span className={cn('text-xs', selectedCampaign.status === 'ENABLED' ? 'text-green-600' : 'text-gray-400')}>
                        {selectedCampaign.status}
                      </span>
                    </div>
                  </div>

                  {/* Mode selector */}
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {availableModes(selectedCampaign).map(m => (
                      <button
                        key={m}
                        onClick={() => { setMode(m); setResult(null) }}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                          mode === m
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400 hover:text-orange-600'
                        )}
                      >
                        {m === 'add_pmax_asset_group' && <><Plus className="w-3 h-3 inline mr-1" />Asset Group</>}
                        {m === 'edit_text_ads' && <><Edit2 className="w-3 h-3 inline mr-1" />Edit Ads</>}
                        {m === 'gdn_adgroup' && <><Plus className="w-3 h-3 inline mr-1" />Ad Group</>}
                        {m === 'gdn_image' && <><ImageIcon className="w-3 h-3 inline mr-1" />เปลี่ยนรูป</>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Result banner */}
              {result && (
                <div className={cn('flex items-center gap-3 px-4 py-3 rounded-xl border text-sm',
                  result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
                )}>
                  {result.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                  {result.message}
                </div>
              )}

              {/* ── Mode: Add PMax Asset Group ── */}
              {mode === 'add_pmax_asset_group' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                  <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                    <Plus className="w-4 h-4 text-orange-500" />
                    <p className="font-semibold text-gray-900">เพิ่ม Asset Group ใหม่</p>
                    <span className="text-xs text-gray-400 ml-auto">Performance Max</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">ชื่อ Asset Group</label>
                    <input value={assetGroupName} onChange={e => setAssetGroupName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="เช่น Asset Group - โปรโมชั่น มิถุนายน" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Final URL</label>
                    <input value={finalUrl} onChange={e => setFinalUrl(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="https://www.yoursite.com/landing" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Name (≤25 ตัวอักษร)</label>
                    <div className="flex items-center gap-2">
                      <input value={businessName} onChange={e => setBusinessName(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="ชื่อธุรกิจ" maxLength={25} />
                      <CharCounter value={businessName} max={25} />
                    </div>
                  </div>

                  <MultiTextField label="Headlines (≤30)" values={headlines} onChange={setHeadlines}
                    maxChar={30} minItems={3} maxItems={15} placeholder="หัวข้อโฆษณา" />
                  <MultiTextField label="Long Headlines (≤90)" values={longHeadlines} onChange={setLongHeadlines}
                    maxChar={90} minItems={1} maxItems={5} placeholder="หัวข้อยาว" />
                  <MultiTextField label="Descriptions (≤90)" values={descriptions} onChange={setDescriptions}
                    maxChar={90} minItems={2} maxItems={4} placeholder="คำอธิบาย" />

                  {/* Images */}
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">รูปภาพ (ถ้ามี)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <ImageUploadSlot label="Landscape (1200×628)" size="อัตราส่วน 1.91:1" onUploaded={(_, rn) => setImageResourceName(rn)} />
                      <ImageUploadSlot label="Logo (1200×1200)" size="สี่เหลี่ยม" onUploaded={(_, rn) => setLogoResourceName(rn)} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Mode: Edit Text Ads ── */}
              {mode === 'edit_text_ads' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                  <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                    <Edit2 className="w-4 h-4 text-blue-500" />
                    <p className="font-semibold text-gray-900">แก้ไข Text Ads</p>
                    <span className="text-xs text-gray-400 ml-auto">Search Campaign</span>
                  </div>

                  {/* Select ad group + ad */}
                  {selectedCampaign.adGroups && selectedCampaign.adGroups.length > 0 && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Ad Group</label>
                        <select
                          value={selectedAdGroup?.id ?? ''}
                          onChange={e => {
                            const ag = selectedCampaign.adGroups?.find(g => g.id === e.target.value) ?? null
                            setSelectedAdGroup(ag)
                            setSelectedAd(null)
                          }}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        >
                          <option value="">เลือก Ad Group</option>
                          {selectedCampaign.adGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>

                      {selectedAdGroup?.ads && selectedAdGroup.ads.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">Ad ที่ต้องการแก้ไข</label>
                          <div className="space-y-1.5">
                            {selectedAdGroup.ads.map(ad => (
                              <button
                                key={ad.id}
                                onClick={() => {
                                  setSelectedAd(ad)
                                  setHeadlines(ad.headlines && ad.headlines.length > 0 ? ad.headlines : ['', '', ''])
                                  setDescriptions(ad.descriptions && ad.descriptions.length > 0 ? ad.descriptions : ['', ''])
                                  setFinalUrl(ad.finalUrls?.[0] ?? '')
                                }}
                                className={cn(
                                  'w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-all',
                                  selectedAd?.id === ad.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                                )}
                              >
                                <p className="text-blue-700 font-medium">{ad.headlines?.slice(0,3).join(' | ')}</p>
                                <p className="text-gray-500 mt-0.5">{ad.descriptions?.[0]}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(!selectedCampaign.adGroups || selectedCampaign.adGroups.length === 0) && (
                    <p className="text-sm text-gray-400 text-center py-4">ไม่พบข้อมูล Ad Groups — ระบบจะ fetch จาก Google Ads เมื่อ push</p>
                  )}

                  <MultiTextField label="Headlines (≤30)" values={headlines} onChange={setHeadlines}
                    maxChar={30} minItems={3} maxItems={15} placeholder="หัวข้อโฆษณา" />
                  <MultiTextField label="Descriptions (≤90)" values={descriptions} onChange={setDescriptions}
                    maxChar={90} minItems={2} maxItems={4} placeholder="คำอธิบาย" />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Final URL</label>
                    <input value={finalUrl} onChange={e => setFinalUrl(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="https://www.yoursite.com" />
                  </div>
                </div>
              )}

              {/* ── Mode: GDN Add Ad Group ── */}
              {mode === 'gdn_adgroup' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                  <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                    <Plus className="w-4 h-4 text-purple-500" />
                    <p className="font-semibold text-gray-900">เพิ่ม Ad Group ใน GDN</p>
                    <span className="text-xs text-gray-400 ml-auto">Display Campaign</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">ชื่อ Ad Group</label>
                    <input value={adGroupName} onChange={e => setAdGroupName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="เช่น Remarketing - Bangkok Visitors" />
                  </div>

                  {/* Targeting */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Targeting (ใส่บรรทัดละ 1 รายการ)</p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Keywords (contextual)</label>
                      <textarea value={gdnTargetKeywords} onChange={e => setGdnTargetKeywords(e.target.value)}
                        rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="คลินิกเสริมความงาม&#10;บริการทำฟัน&#10;ทันตกรรม" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Placements (URL)</label>
                      <textarea value={gdnPlacements} onChange={e => setGdnPlacements(e.target.value)}
                        rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="www.healthsite.com&#10;m.pantip.com" />
                    </div>
                  </div>

                  {/* Ad content */}
                  <p className="text-sm font-semibold text-gray-700">Ad Content</p>
                  <MultiTextField label="Headlines (≤30)" values={headlines} onChange={setHeadlines}
                    maxChar={30} minItems={1} maxItems={5} placeholder="หัวข้อ" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Long Headline (≤90)</label>
                    <div className="flex items-center gap-2">
                      <input value={longHeadlines[0] ?? ''} onChange={e => setLongHeadlines([e.target.value])}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="หัวข้อยาวสำหรับ Display" maxLength={90} />
                      <CharCounter value={longHeadlines[0] ?? ''} max={90} />
                    </div>
                  </div>
                  <MultiTextField label="Descriptions (≤90)" values={descriptions} onChange={setDescriptions}
                    maxChar={90} minItems={1} maxItems={5} placeholder="คำอธิบาย" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Name (≤25)</label>
                    <div className="flex items-center gap-2">
                      <input value={businessName} onChange={e => setBusinessName(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        maxLength={25} placeholder="ชื่อธุรกิจ" />
                      <CharCounter value={businessName} max={25} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Final URL</label>
                    <input value={finalUrl} onChange={e => setFinalUrl(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="https://www.yoursite.com" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <ImageUploadSlot label="Marketing Image (1200×628)" size="อัตราส่วน 1.91:1"
                      onUploaded={(_, rn) => setImageResourceName(rn)} />
                    <ImageUploadSlot label="Logo (1200×1200)" size="สี่เหลี่ยม"
                      onUploaded={(_, rn) => setLogoResourceName(rn)} />
                  </div>
                </div>
              )}

              {/* ── Mode: GDN change image ── */}
              {mode === 'gdn_image' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
                  <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
                    <ImageIcon className="w-4 h-4 text-purple-500" />
                    <p className="font-semibold text-gray-900">เปลี่ยนรูป GDN</p>
                  </div>

                  {selectedCampaign.adGroups && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Ad Group</label>
                        <select
                          value={selectedAdGroup?.id ?? ''}
                          onChange={e => {
                            const ag = selectedCampaign.adGroups?.find(g => g.id === e.target.value) ?? null
                            setSelectedAdGroup(ag); setSelectedAd(null)
                          }}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        >
                          <option value="">เลือก Ad Group</option>
                          {selectedCampaign.adGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                      {selectedAdGroup?.ads && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">Ad</label>
                          <select
                            value={selectedAd?.id ?? ''}
                            onChange={e => setSelectedAd(selectedAdGroup.ads?.find(a => a.id === e.target.value) ?? null)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                          >
                            <option value="">เลือก Ad</option>
                            {selectedAdGroup.ads.map(a => (
                              <option key={a.id} value={a.id}>{a.headlines?.[0] ?? a.id}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  <ImageUploadSlot label="Marketing Image ใหม่ (1200×628)" size="อัตราส่วน 1.91:1"
                    onUploaded={(_, rn) => setImageResourceName(rn)} />
                </div>
              )}

              {/* Submit */}
              {mode && (
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors disabled:bg-orange-300"
                >
                  {submitting ? (
                    <><Loader className="w-4 h-4 animate-spin" />กำลัง Push...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" />{MODE_LABELS[mode]}</>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
