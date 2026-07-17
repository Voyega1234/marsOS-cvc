'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { FileUpload, UploadedFile } from '@/components/ui/FileUpload'
import {
  ChevronDown, ChevronRight, Pencil, X, Plus, Sparkles,
  Save, CheckCircle2, AlertCircle, RefreshCw, Loader2,
  Search, Zap, Monitor, ShoppingBag, Video, Globe, LayoutGrid,
  ToggleLeft, ToggleRight, DollarSign, Image as ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CampaignSummary } from '@/app/api/campaign-edit/campaigns/route'
import type { AssetGroup } from '@/app/api/campaign-edit/asset-groups/route'
import type { ProductGroup } from '@/app/api/campaign-edit/shopping-products/route'
import { AccountSelect } from '@/components/ui/AccountSelect'

// ─── Constants ─────────────────────────────────────────────────────────────────
const HEADLINE_MAX = 30
const DESC_MAX = 90
const HEADLINE_MIN = 3
const HEADLINE_MAX_COUNT = 15
const DESC_MIN = 2
const DESC_MAX_COUNT = 4

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LiveAd {
  adId: string
  adGroupId: string
  adGroupName: string
  adType: 'RSA' | 'RESPONSIVE_DISPLAY' | 'PMAX_ASSET_GROUP'
  headlines: { text: string; pinned_field?: 'HEADLINE_1' | 'HEADLINE_2' | 'HEADLINE_3' }[]
  descriptions: { text: string }[]
  finalUrls: string[]
  status: 'ENABLED' | 'PAUSED'
  metrics?: { impressions: number; clicks: number; ctr: number; conversions: number }
}

interface Account { id: string; name: string; currencyCode?: string }

interface EditState {
  headlines: string[]
  descriptions: string[]
  finalUrls: string[]
}

interface PendingChange {
  adId: string
  editState: EditState
}

interface AISuggestResult {
  headlines: string[]
  descriptions: string[]
  rationale: string
}

interface BulkSaveResult {
  ok: number
  fail: number
  error?: string
}

// ─── Char counter input ────────────────────────────────────────────────────────

function CharInput({
  value, onChange, maxLen, placeholder, className,
}: {
  value: string
  onChange: (v: string) => void
  maxLen: number
  placeholder?: string
  className?: string
}) {
  const len = value.length
  const over = len > maxLen
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLen + 10}
        className={cn(
          'w-full px-3 py-2 pr-14 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors',
          over ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-gray-200 bg-white',
          className
        )}
      />
      <span className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-mono tabular-nums',
        over ? 'text-red-500 font-bold' : len > maxLen * 0.85 ? 'text-amber-500' : 'text-gray-300'
      )}>
        {len}/{maxLen}
      </span>
    </div>
  )
}

// ─── AI Suggest Panel ──────────────────────────────────────────────────────────

function AISuggestPanel({
  onApplyAll, onInsertHeadline, onInsertDescription, onClose, businessName,
}: {
  onApplyAll: (result: AISuggestResult) => void
  onInsertHeadline: (text: string) => void
  onInsertDescription: (text: string) => void
  onClose: () => void
  businessName: string
}) {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AISuggestResult | null>(null)
  const [error, setError] = useState('')

  async function generate() {
    if (!instruction.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/campaign-edit/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adType: 'RSA',
          currentHeadlines: [],
          currentDescriptions: [],
          businessContext: { businessName, productService: businessName, brandTone: 'professional', objective: 'conversion' },
          instruction,
          language: 'th',
        }),
      })
      const data = await res.json() as AISuggestResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'AI error')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500"/>
          <span className="font-semibold text-gray-900 text-sm">AI Suggest</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <X className="w-4 h-4 text-gray-400"/>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">บอก AI ว่าต้องการอะไร</label>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="เช่น: เน้นราคา, เพิ่มความเร่งด่วน, เขียนแบบ friendly"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
        </div>
        <button
          onClick={generate}
          disabled={loading || !instruction.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
          {loading ? 'กำลังสร้าง...' : 'Generate →'}
        </button>
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}
        {result && (
          <div className="space-y-4">
            {result.rationale && (
              <div className="p-3 bg-purple-50 rounded-lg">
                <p className="text-[11px] text-purple-600 font-medium mb-1">กลยุทธ์ AI</p>
                <p className="text-xs text-purple-700">{result.rationale}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Headlines ({result.headlines.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {result.headlines.map((h, i) => (
                  <button key={i} onClick={() => onInsertHeadline(h)} title="คลิกเพื่อแทรก"
                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-full border border-blue-200 transition-colors text-left">
                    {h}<span className="ml-1 text-[10px] text-blue-400">({h.length})</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Descriptions ({result.descriptions.length})</p>
              <div className="space-y-1.5">
                {result.descriptions.map((d, i) => (
                  <button key={i} onClick={() => onInsertDescription(d)} title="คลิกเพื่อแทรก"
                    className="w-full text-left px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs rounded-lg border border-emerald-200 transition-colors">
                    {d}<span className="ml-1 text-[10px] text-emerald-400">({d.length})</span>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => onApplyAll(result)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              <CheckCircle2 className="w-4 h-4"/>Apply all
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Ad Card (RSA / Display) ───────────────────────────────────────────────────

function AdCard({
  ad, pendingChange, onSave, onChangePending,
}: {
  ad: LiveAd
  pendingChange: PendingChange | null
  onSave: (adId: string, state: EditState) => Promise<void>
  onChangePending: (change: PendingChange | null, removeAdId?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editState, setEditState] = useState<EditState>({
    headlines: ad.headlines.map(h => h.text),
    descriptions: ad.descriptions.map(d => d.text),
    finalUrls: [...ad.finalUrls],
  })
  const [showAI, setShowAI] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [focusedField, setFocusedField] = useState<{ type: 'headline' | 'description'; index: number } | null>(null)

  const isDirty = pendingChange?.adId === ad.adId

  function startEdit() {
    setEditState({
      headlines: ad.headlines.map(h => h.text),
      descriptions: ad.descriptions.map(d => d.text),
      finalUrls: [...ad.finalUrls],
    })
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setShowAI(false)
    if (isDirty) onChangePending(null, ad.adId)
  }

  function updateHeadline(i: number, val: string) {
    const next = [...editState.headlines]
    next[i] = val
    const nextState = { ...editState, headlines: next }
    setEditState(nextState)
    onChangePending({ adId: ad.adId, editState: nextState })
  }

  function updateDescription(i: number, val: string) {
    const next = [...editState.descriptions]
    next[i] = val
    const nextState = { ...editState, descriptions: next }
    setEditState(nextState)
    onChangePending({ adId: ad.adId, editState: nextState })
  }

  function addHeadline() {
    if (editState.headlines.length >= HEADLINE_MAX_COUNT) return
    const nextState = { ...editState, headlines: [...editState.headlines, ''] }
    setEditState(nextState)
    onChangePending({ adId: ad.adId, editState: nextState })
  }

  function removeHeadline(i: number) {
    const next = editState.headlines.filter((_, idx) => idx !== i)
    const nextState = { ...editState, headlines: next }
    setEditState(nextState)
    onChangePending({ adId: ad.adId, editState: nextState })
  }

  const filledHeadlines = editState.headlines.filter(h => h.trim().length > 0)
  const filledDescs     = editState.descriptions.filter(d => d.trim().length > 0)
  const overLimitH      = editState.headlines.some(h => h.length > HEADLINE_MAX)
  const overLimitD      = editState.descriptions.some(d => d.length > DESC_MAX)
  const tooFewH         = filledHeadlines.length < HEADLINE_MIN
  const tooFewD         = filledDescs.length < DESC_MIN
  const saveBlocked     = tooFewH || tooFewD || overLimitH || overLimitD

  const validationError = tooFewH
    ? `ต้องมี Headlines อย่างน้อย ${HEADLINE_MIN} รายการ (ปัจจุบัน ${filledHeadlines.length})`
    : tooFewD
      ? `ต้องมี Descriptions อย่างน้อย ${DESC_MIN} รายการ (ปัจจุบัน ${filledDescs.length})`
      : overLimitH ? 'Headline บางรายการยาวเกิน 30 ตัวอักษร'
      : overLimitD ? 'Description บางรายการยาวเกิน 90 ตัวอักษร'
      : ''

  async function handleSave() {
    if (saveBlocked) return
    setSaving(true)
    try {
      await onSave(ad.adId, editState)
      setSaveOk(true)
      setEditing(false)
      setShowAI(false)
      onChangePending(null, ad.adId)
      setTimeout(() => setSaveOk(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  function handleApplyAll(result: AISuggestResult) {
    const nextState: EditState = {
      ...editState,
      headlines: result.headlines.slice(0, HEADLINE_MAX_COUNT),
      descriptions: result.descriptions.slice(0, DESC_MAX_COUNT),
    }
    setEditState(nextState)
    onChangePending({ adId: ad.adId, editState: nextState })
  }

  function handleInsertHeadline(text: string) {
    if (focusedField?.type === 'headline') {
      updateHeadline(focusedField.index, text)
    } else if (editState.headlines.length < HEADLINE_MAX_COUNT) {
      const nextState = { ...editState, headlines: [...editState.headlines, text] }
      setEditState(nextState)
      onChangePending({ adId: ad.adId, editState: nextState })
    }
  }

  function handleInsertDescription(text: string) {
    if (focusedField?.type === 'description') {
      updateDescription(focusedField.index, text)
    } else if (editState.descriptions.length < DESC_MAX_COUNT) {
      const nextState = { ...editState, descriptions: [...editState.descriptions, text] }
      setEditState(nextState)
      onChangePending({ adId: ad.adId, editState: nextState })
    }
  }

  return (
    <div className={cn(
      'border rounded-xl transition-all',
      isDirty && !editing ? 'border-amber-300 bg-amber-50/40' : 'border-gray-100 bg-white',
      editing ? 'border-blue-200 bg-blue-50/20 shadow-md' : 'shadow-sm'
    )}>
      <div className="px-4 py-3 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-600 rounded-full">{ad.adGroupName}</span>
            <span className={cn('px-2 py-0.5 text-[11px] font-semibold rounded-full', ad.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
              {ad.status}
            </span>
            {isDirty && !editing && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="มีการเปลี่ยนแปลงที่ยังไม่บันทึก"/>}
            {saveOk && <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3"/>บันทึกแล้ว</span>}
          </div>
          {ad.metrics && (
            <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
              <span><span className="font-medium text-gray-700">{ad.metrics.impressions.toLocaleString()}</span> impr.</span>
              <span><span className="font-medium text-gray-700">{ad.metrics.clicks.toLocaleString()}</span> clicks</span>
              <span><span className="font-medium text-gray-700">{ad.metrics.ctr.toFixed(1)}%</span> CTR</span>
              <span><span className="font-medium text-gray-700">{ad.metrics.conversions}</span> conv.</span>
            </div>
          )}
        </div>
        {!editing && (
          <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors flex-shrink-0">
            <Pencil className="w-3 h-3"/>Edit
          </button>
        )}
      </div>

      {!editing && (
        <div className="px-4 pb-4 space-y-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Headlines</p>
            <div className="flex flex-wrap gap-1.5">
              {ad.headlines.map((h, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700">
                  {h.text}<span className="text-[10px] text-gray-400">({h.text.length})</span>
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Descriptions</p>
            <div className="space-y-1">
              {ad.descriptions.map((d, i) => (
                <div key={i} className="flex items-start justify-between gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg">
                  <span className="text-xs text-gray-700 flex-1">{d.text}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">({d.text.length})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="flex gap-0">
          <div className="flex-1 px-4 pb-4 space-y-4 min-w-0">
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Headlines
                  <span className={cn('ml-1.5 font-bold tabular-nums', tooFewH ? 'text-red-500' : filledHeadlines.length >= HEADLINE_MIN ? 'text-emerald-600' : 'text-amber-500')}>
                    {filledHeadlines.length}/{HEADLINE_MAX_COUNT}
                  </span>
                </p>
                <span className="text-[10px] text-gray-400">ขั้นต่ำ {HEADLINE_MIN} · สูงสุด {HEADLINE_MAX_COUNT} · ≤{HEADLINE_MAX} ตัวอักษร</span>
              </div>
              <div className="space-y-2">
                {editState.headlines.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <CharInput value={h} onChange={v => updateHeadline(i, v)} maxLen={HEADLINE_MAX} placeholder={`Headline ${i + 1}${i < HEADLINE_MIN ? ' *' : ''}`} className="text-sm"/>
                    </div>
                    <button onClick={() => { setFocusedField({ type: 'headline', index: i }); setShowAI(true) }}
                      className="p-1.5 rounded text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors flex-shrink-0" title="AI suggest">
                      <Sparkles className="w-3.5 h-3.5"/>
                    </button>
                    <button onClick={() => removeHeadline(i)} disabled={filledHeadlines.length <= HEADLINE_MIN && h.trim().length > 0}
                      className="p-1.5 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                      <X className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                ))}
              </div>
              {tooFewH && <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0"/>ต้องมี Headlines อย่างน้อย {HEADLINE_MIN} รายการ ก่อนบันทึก</p>}
              {editState.headlines.length < HEADLINE_MAX_COUNT && (
                <button onClick={addHeadline} className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  <Plus className="w-3 h-3"/>Add headline
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Descriptions
                  <span className={cn('ml-1.5 font-bold tabular-nums', tooFewD ? 'text-red-500' : filledDescs.length >= DESC_MIN ? 'text-emerald-600' : 'text-amber-500')}>
                    {filledDescs.length}/{DESC_MAX_COUNT}
                  </span>
                </p>
                <span className="text-[10px] text-gray-400">ขั้นต่ำ {DESC_MIN} · สูงสุด {DESC_MAX_COUNT} · ≤{DESC_MAX} ตัวอักษร</span>
              </div>
              <div className="space-y-2">
                {editState.descriptions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1">
                      <CharInput value={d} onChange={v => updateDescription(i, v)} maxLen={DESC_MAX} placeholder={`Description ${i + 1}${i < DESC_MIN ? ' *' : ''}`}/>
                    </div>
                    <button onClick={() => { setFocusedField({ type: 'description', index: i }); setShowAI(true) }}
                      className="p-1.5 rounded text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors flex-shrink-0 mt-1" title="AI suggest">
                      <Sparkles className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                ))}
              </div>
              {tooFewD && <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0"/>ต้องมี Descriptions อย่างน้อย {DESC_MIN} รายการ ก่อนบันทึก</p>}
            </div>

            {validationError && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
                <p className="text-xs text-red-600 font-medium">{validationError}</p>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleSave} disabled={saving || saveBlocked} title={saveBlocked ? validationError : undefined}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={() => { setShowAI(v => !v); setFocusedField(null) }}
                className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors',
                  showAI ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600')}>
                <Sparkles className="w-4 h-4"/>AI Suggest
              </button>
              <button onClick={cancelEdit} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
            </div>
          </div>
          {showAI && (
            <div className="w-80 flex-shrink-0 border-l border-purple-100 bg-purple-50/30">
              <AISuggestPanel onApplyAll={handleApplyAll} onInsertHeadline={handleInsertHeadline} onInsertDescription={handleInsertDescription} onClose={() => setShowAI(false)} businessName="Campaign"/>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Campaign type badge ───────────────────────────────────────────────────────

const TYPE_META: Record<CampaignSummary['type'], { label: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  SEARCH: { label: 'Search', color: 'bg-blue-100 text-blue-700', Icon: Search },
  PERFORMANCE_MAX: { label: 'PMax', color: 'bg-purple-100 text-purple-700', Icon: Zap },
  DISPLAY: { label: 'Display', color: 'bg-teal-100 text-teal-700', Icon: Monitor },
  VIDEO: { label: 'Video', color: 'bg-red-100 text-red-700', Icon: Video },
  SHOPPING: { label: 'Shopping', color: 'bg-orange-100 text-orange-700', Icon: ShoppingBag },
  DEMAND_GEN: { label: 'Demand Gen', color: 'bg-pink-100 text-pink-700', Icon: Globe },
  LOCAL: { label: 'Local', color: 'bg-green-100 text-green-700', Icon: LayoutGrid },
  UNKNOWN: { label: 'Other', color: 'bg-gray-100 text-gray-600', Icon: LayoutGrid },
}

function TypeBadge({ type }: { type: CampaignSummary['type'] }) {
  const meta = TYPE_META[type]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full', meta.color)}>
      <meta.Icon className="w-3 h-3"/>
      {meta.label}
    </span>
  )
}

// ─── PMax Asset Group Editor ───────────────────────────────────────────────────

function PMaxAssetGroupCard({
  group, customerId, onSaved,
}: {
  group: AssetGroup
  customerId: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [headlines, setHeadlines] = useState<string[]>(group.headlines)
  const [longHeadlines, setLongHeadlines] = useState<string[]>(group.longHeadlines)
  const [descriptions, setDescriptions] = useState<string[]>(group.descriptions)
  const [businessName, setBusinessName] = useState(group.businessName)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [error, setError] = useState('')
  const [uploadFiles, setUploadFiles] = useState<UploadedFile[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadedAssets, setUploadedAssets] = useState<{ resourceName: string; name: string }[]>([])
  const [showUpload, setShowUpload] = useState(false)

  const filledH = headlines.filter(h => h.trim()).length
  const filledD = descriptions.filter(d => d.trim()).length
  const overH = headlines.some(h => h.length > HEADLINE_MAX)
  const overD = descriptions.some(d => d.length > DESC_MAX)
  const overBN = businessName.length > 25
  const saveBlocked = filledH < HEADLINE_MIN || filledD < DESC_MIN || overH || overD || overBN

  async function handleSave() {
    if (saveBlocked) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/campaign-edit/pmax-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          assetGroupResourceName: group.assetGroupResourceName,
          headlines: headlines.filter(h => h.trim()),
          longHeadlines: longHeadlines.filter(h => h.trim()),
          descriptions: descriptions.filter(d => d.trim()),
          businessName,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setSaveOk(true)
      setEditing(false)
      onSaved()
      setTimeout(() => setSaveOk(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadImage() {
    if (!uploadFiles.length) return
    setUploadingImage(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', uploadFiles[0].file)
      formData.append('customerId', customerId)
      const res = await fetch('/api/google-ads/upload-logo', { method: 'POST', body: formData })
      const data = await res.json() as { resourceName?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setUploadedAssets(prev => [...prev, { resourceName: data.resourceName ?? '', name: uploadFiles[0].file.name }])
      setUploadFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ')
    } finally {
      setUploadingImage(false)
    }
  }

  function updateItem(arr: string[], setArr: (v: string[]) => void, i: number, val: string) {
    const next = [...arr]
    next[i] = val
    setArr(next)
  }

  function removeItem(arr: string[], setArr: (v: string[]) => void, i: number) {
    setArr(arr.filter((_, idx) => idx !== i))
  }

  function addItem(arr: string[], setArr: (v: string[]) => void, max: number) {
    if (arr.length >= max) return
    setArr([...arr, ''])
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-900">{group.name}</span>
          <span className={cn('px-2 py-0.5 text-[11px] font-semibold rounded-full', group.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
            {group.status}
          </span>
          {saveOk && <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3"/>บันทึกแล้ว</span>}
        </div>
        <div className="flex items-center gap-2">
          {group.finalUrls[0] && <span className="text-[11px] text-gray-400 truncate max-w-[200px]">{group.finalUrls[0]}</span>}
          {!editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors">
              <Pencil className="w-3 h-3"/>Edit
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0"/>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Image grid */}
      {(group.images.length > 0 || group.logos.length > 0) && (
        <div className="px-4 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Images & Logos</p>
          <div className="flex flex-wrap gap-2">
            {[...group.images, ...group.logos].map((img, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.assetName} className="w-full h-full object-cover"/>
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-300"/>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                  <p className="text-[9px] text-white truncate">{img.fieldType.replace('_', ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Text fields - view mode */}
      {!editing && (
        <div className="px-4 py-3 space-y-3">
          {headlines.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Headlines ({headlines.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {headlines.map((h, i) => <span key={i} className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700">{h}<span className="ml-1 text-[10px] text-gray-400">({h.length})</span></span>)}
              </div>
            </div>
          )}
          {descriptions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Descriptions ({descriptions.length})</p>
              <div className="space-y-1">
                {descriptions.map((d, i) => <div key={i} className="px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs text-gray-700">{d}</div>)}
              </div>
            </div>
          )}
          {businessName && <p className="text-xs text-gray-500">Business Name: <span className="font-medium text-gray-900">{businessName}</span></p>}
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="p-4 space-y-4">
          {/* Headlines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Headlines
                <span className={cn('ml-1.5 font-bold', filledH < HEADLINE_MIN ? 'text-red-500' : 'text-emerald-600')}>{filledH}/{HEADLINE_MAX_COUNT}</span>
              </p>
              <span className="text-[10px] text-gray-400">≤{HEADLINE_MAX} chars · min {HEADLINE_MIN}</span>
            </div>
            <div className="space-y-2">
              {headlines.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1"><CharInput value={h} onChange={v => updateItem(headlines, setHeadlines, i, v)} maxLen={HEADLINE_MAX} placeholder={`Headline ${i + 1}${i < HEADLINE_MIN ? ' *' : ''}`}/></div>
                  <button onClick={() => removeItem(headlines, setHeadlines, i)} className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors"><X className="w-3.5 h-3.5"/></button>
                </div>
              ))}
            </div>
            {headlines.length < HEADLINE_MAX_COUNT && <button onClick={() => addItem(headlines, setHeadlines, HEADLINE_MAX_COUNT)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium"><Plus className="w-3 h-3"/>Add headline</button>}
          </div>

          {/* Long Headlines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Long Headlines <span className="font-normal text-gray-400">({longHeadlines.length}/5)</span></p>
              <span className="text-[10px] text-gray-400">≤90 chars</span>
            </div>
            <div className="space-y-2">
              {longHeadlines.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1"><CharInput value={h} onChange={v => updateItem(longHeadlines, setLongHeadlines, i, v)} maxLen={90} placeholder={`Long Headline ${i + 1}`}/></div>
                  <button onClick={() => removeItem(longHeadlines, setLongHeadlines, i)} className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors"><X className="w-3.5 h-3.5"/></button>
                </div>
              ))}
            </div>
            {longHeadlines.length < 5 && <button onClick={() => addItem(longHeadlines, setLongHeadlines, 5)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium"><Plus className="w-3 h-3"/>Add long headline</button>}
          </div>

          {/* Descriptions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Descriptions
                <span className={cn('ml-1.5 font-bold', filledD < DESC_MIN ? 'text-red-500' : 'text-emerald-600')}>{filledD}/{DESC_MAX_COUNT}</span>
              </p>
              <span className="text-[10px] text-gray-400">≤{DESC_MAX} chars · min {DESC_MIN}</span>
            </div>
            <div className="space-y-2">
              {descriptions.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1"><CharInput value={d} onChange={v => updateItem(descriptions, setDescriptions, i, v)} maxLen={DESC_MAX} placeholder={`Description ${i + 1}${i < DESC_MIN ? ' *' : ''}`}/></div>
                  <button onClick={() => removeItem(descriptions, setDescriptions, i)} className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors"><X className="w-3.5 h-3.5"/></button>
                </div>
              ))}
            </div>
            {descriptions.length < DESC_MAX_COUNT && <button onClick={() => addItem(descriptions, setDescriptions, DESC_MAX_COUNT)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium"><Plus className="w-3 h-3"/>Add description</button>}
          </div>

          {/* Business name */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Business Name <span className="font-normal text-gray-400">(≤25 chars)</span></p>
            <CharInput value={businessName} onChange={setBusinessName} maxLen={25} placeholder="ชื่อธุรกิจ"/>
          </div>

          {/* Image upload */}
          <div>
            <button onClick={() => setShowUpload(v => !v)} className="flex items-center gap-1.5 text-xs text-blue-600 font-medium mb-2">
              <ImageIcon className="w-3 h-3"/>
              {showUpload ? 'ซ่อน Image Upload' : 'อัปโหลด Image ใหม่'}
            </button>
            {showUpload && (
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-3">
                <FileUpload
                  title=""
                  accept="image/*"
                  acceptLabel="JPG, PNG, WebP"
                  maxSizeMB={5}
                  files={uploadFiles}
                  onAdd={f => setUploadFiles(f)}
                  onRemove={() => setUploadFiles([])}
                  onUpload={handleUploadImage}
                  onCancel={() => setUploadFiles([])}
                />
                {uploadingImage && <div className="flex items-center gap-2 text-xs text-blue-600"><Loader2 className="w-3 h-3 animate-spin"/>กำลังอัปโหลด...</div>}
                {uploadedAssets.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">อัปโหลดแล้ว:</p>
                    {uploadedAssets.map((a, i) => (
                      <div key={i} className="text-[11px] text-gray-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500"/>{a.name} → <span className="font-mono text-gray-400 truncate">{a.resourceName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleSave} disabled={saving || saveBlocked}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button onClick={() => { setEditing(false); setError('') }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Shopping Product Groups Panel ────────────────────────────────────────────

function ShoppingProductsPanel({ customerId, campaignId }: { customerId: string; campaignId: string }) {
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/campaign-edit/shopping-products?customerId=${customerId}&campaignId=${campaignId}`)
      .then(r => r.json())
      .then((d: { productGroups?: ProductGroup[]; error?: string }) => {
        if (d.error) throw new Error(d.error)
        setProductGroups(d.productGroups ?? [])
      })
      .catch(err => setError(err instanceof Error ? err.message : 'โหลดไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [customerId, campaignId])

  async function toggleStatus(pg: ProductGroup) {
    const newStatus: 'ENABLED' | 'PAUSED' = pg.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'
    setToggling(pg.resourceName)
    try {
      const res = await fetch('/api/campaign-edit/shopping-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, resourceName: pg.resourceName, status: newStatus }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Toggle failed')
      setProductGroups(prev => prev.map(p => p.resourceName === pg.resourceName ? { ...p, status: newStatus } : p))
    } catch {
      // silently keep old status on failure
    } finally {
      setToggling(null)
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-8 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin"/>โหลด Product Groups...</div>
  if (error) return <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>

  return (
    <div>
      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-xs text-amber-700">Shopping campaigns: แก้ไข creative ไม่ได้ผ่าน API — ต้องทำผ่าน Google Merchant Center โดยตรง สามารถ Enable/Pause product groups ได้ที่นี่</p>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ad Group</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Product Group</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</th>
              <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productGroups.map((pg) => (
              <tr key={pg.resourceName} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-xs text-gray-600">{pg.adGroupName}</td>
                <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{pg.caseValue}</td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full">{pg.listingGroupType}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => toggleStatus(pg)}
                    disabled={toggling === pg.resourceName}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border"
                    style={{ minWidth: '80px' }}
                  >
                    {toggling === pg.resourceName
                      ? <Loader2 className="w-3 h-3 animate-spin mx-auto"/>
                      : pg.status === 'ENABLED'
                        ? <><ToggleRight className="w-3.5 h-3.5 text-emerald-500"/>Enabled</>
                        : <><ToggleLeft className="w-3.5 h-3.5 text-gray-400"/>Paused</>
                    }
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {productGroups.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">ไม่พบ Product Groups</div>
        )}
      </div>
    </div>
  )
}

// ─── Per-campaign Editor Panel ─────────────────────────────────────────────────

function CampaignEditorPanel({
  campaign, customerId,
}: {
  campaign: CampaignSummary
  customerId: string
}) {
  const [ads, setAds] = useState<LiveAd[]>([])
  const [adsLoading, setAdsLoading] = useState(false)
  const [adsError, setAdsError] = useState('')
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([])
  const [agLoading, setAgLoading] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [savingAll, setSavingAll] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkSaveResult | null>(null)
  const bulkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (campaign.type === 'PERFORMANCE_MAX') {
      setAgLoading(true)
      fetch(`/api/campaign-edit/asset-groups?customerId=${customerId}&campaignId=${campaign.campaignId}`)
        .then(r => r.json())
        .then((d: { assetGroups?: AssetGroup[]; error?: string }) => {
          if (d.error) throw new Error(d.error)
          setAssetGroups(d.assetGroups ?? [])
        })
        .catch(err => setAdsError(err instanceof Error ? err.message : 'โหลดไม่สำเร็จ'))
        .finally(() => setAgLoading(false))
      return
    }

    if (campaign.type === 'SHOPPING' || campaign.type === 'VIDEO') return

    setAdsLoading(true)
    setAdsError('')
    fetch(`/api/campaign-edit/ads?customerId=${customerId}&campaignId=${campaign.campaignId}`)
      .then(r => r.json())
      .then((d: { ads?: LiveAd[]; error?: string }) => {
        if (d.error) throw new Error(d.error)
        setAds(d.ads ?? [])
      })
      .catch(err => setAdsError(err instanceof Error ? err.message : 'โหลดโฆษณาไม่สำเร็จ'))
      .finally(() => setAdsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.campaignId, campaign.type, customerId])

  async function saveAd(adId: string, state: EditState) {
    const res = await fetch(
      `/api/campaign-edit/ads?customerId=${customerId}&adId=${adId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines: state.headlines, descriptions: state.descriptions, finalUrls: state.finalUrls }),
      }
    )
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      throw new Error(d.error ?? 'Save failed')
    }
    setAds(prev => prev.map(a => a.adId === adId ? {
      ...a,
      headlines: state.headlines.map(text => ({ text })),
      descriptions: state.descriptions.map(text => ({ text })),
      finalUrls: state.finalUrls,
    } : a))
  }

  function handleChangePending(change: PendingChange | null, removeAdId?: string) {
    if (!change) {
      // null means "cancel / clear" for the given ad — remove it from pending list.
      if (removeAdId) {
        setPendingChanges(prev => prev.filter(p => p.adId !== removeAdId))
      }
      return
    }
    setPendingChanges(prev => {
      const without = prev.filter(p => p.adId !== change.adId)
      return [...without, change]
    })
  }

  async function saveAll() {
    if (!pendingChanges.length) return
    setSavingAll(true)
    let ok = 0, fail = 0
    for (const change of pendingChanges) {
      try {
        await saveAd(change.adId, change.editState)
        ok++
      } catch {
        fail++
      }
    }
    setPendingChanges([])
    setSavingAll(false)
    setBulkResult({ ok, fail })
    if (bulkTimerRef.current) clearTimeout(bulkTimerRef.current)
    bulkTimerRef.current = setTimeout(() => setBulkResult(null), 4000)
  }

  const adGroups = ads.reduce<Record<string, LiveAd[]>>((acc, ad) => {
    const key = ad.adGroupName
    if (!acc[key]) acc[key] = []
    acc[key].push(ad)
    return acc
  }, {})

  // VIDEO: read-only
  if (campaign.type === 'VIDEO') {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <div className="flex items-start gap-3">
          <Video className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"/>
          <div>
            <p className="font-semibold">Video Campaign</p>
            <p className="mt-1 text-xs">แก้ไข Video Ads ต้องทำผ่าน YouTube Studio โดยตรง — ไม่สามารถแก้ไข video creative ผ่าน API ได้</p>
          </div>
        </div>
      </div>
    )
  }

  // SHOPPING
  if (campaign.type === 'SHOPPING') {
    return <ShoppingProductsPanel customerId={customerId} campaignId={campaign.campaignId}/>
  }

  // PERFORMANCE_MAX
  if (campaign.type === 'PERFORMANCE_MAX') {
    if (agLoading) return <div className="flex items-center gap-2 py-8 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin"/>โหลด Asset Groups...</div>
    if (adsError) return <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{adsError}</div>
    if (!assetGroups.length) return <div className="py-8 text-center text-gray-400 text-sm">ไม่พบ Asset Groups</div>
    return (
      <div className="space-y-4">
        {assetGroups.map(group => (
          <PMaxAssetGroupCard key={group.assetGroupId} group={group} customerId={customerId} onSaved={() => {}}/>
        ))}
      </div>
    )
  }

  // SEARCH / DISPLAY / DEMAND_GEN — ad-based editor
  const loading = adsLoading
  const error = adsError

  return (
    <div className="space-y-4">
      {loading && <div className="flex items-center gap-2 py-8 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin"/>โหลด ads...</div>}
      {error && <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}
      {!loading && !error && !ads.length && (
        <div className="py-8 text-center text-gray-400 text-sm">ไม่พบ ads ใน campaign นี้</div>
      )}

      {Object.entries(adGroups).map(([groupName, groupAds]) => (
        <div key={groupName} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-900">{groupName}</span>
            <span className="px-2 py-0.5 text-[11px] bg-gray-200 text-gray-600 rounded-full">{groupAds.length} ads</span>
          </div>
          <div className="p-4 space-y-3">
            {groupAds.map(ad => (
              <AdCard
                key={ad.adId}
                ad={ad}
                pendingChange={pendingChanges.find(p => p.adId === ad.adId) ?? null}
                onSave={saveAd}
                onChangePending={handleChangePending}
              />
            ))}
          </div>
        </div>
      ))}

      {pendingChanges.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <span className="text-xs text-amber-700 font-medium">{pendingChanges.length} รายการรอบันทึก</span>
          <div className="flex items-center gap-3">
            {bulkResult && (
              bulkResult.error
                ? <span className="text-xs text-red-600">{bulkResult.error}</span>
                : <span className="text-xs text-emerald-600">บันทึกแล้ว {bulkResult.ok} รายการ{bulkResult.fail > 0 ? ` (ผิดพลาด ${bulkResult.fail})` : ''}</span>
            )}
            <button onClick={saveAll} disabled={savingAll}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-xs font-semibold rounded-lg transition-colors">
              {savingAll ? <Loader2 className="w-3 h-3 animate-spin"/> : <Save className="w-3 h-3"/>}
              บันทึกทั้งหมด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Budget Modal ──────────────────────────────────────────────────────────────

function BudgetModal({
  campaigns, onClose, onApply,
}: {
  campaigns: CampaignSummary[]
  onClose: () => void
  onApply: (dailyBudgetMicros: number) => Promise<void>
}) {
  const [budgetBaht, setBudgetBaht] = useState('')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  async function apply() {
    const baht = parseFloat(budgetBaht)
    if (!baht || baht <= 0) { setError('กรุณาระบุงบประมาณที่ถูกต้อง'); return }
    setApplying(true)
    setError('')
    try {
      await onApply(Math.round(baht * 1_000_000))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ตั้งค่างบประมาณไม่สำเร็จ')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">ปรับงบประมาณรายวัน</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400"/></button>
        </div>
        <div className="text-xs text-gray-500">
          จะตั้งงบประมาณเดียวกันให้ {campaigns.length} campaigns:<br/>
          {campaigns.map(c => c.campaignName).join(', ')}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">งบประมาณรายวัน (บาท)</label>
          <input
            type="number"
            min="1"
            value={budgetBaht}
            onChange={e => setBudgetBaht(e.target.value)}
            placeholder="เช่น 500"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={apply} disabled={applying}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors">
            {applying ? <Loader2 className="w-4 h-4 animate-spin"/> : <DollarSign className="w-4 h-4"/>}
            ตั้งค่า
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">ยกเลิก</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function CampaignEditorPage() {
  const searchParams = useSearchParams()
  const initCustomerId = searchParams.get('customerId') ?? ''

  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState(initCustomerId)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [statusTogglingIds, setStatusTogglingIds] = useState<Set<string>>(new Set())
  const [statusResult, setStatusResult] = useState<{ message: string; ok: boolean } | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load accounts
  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then((d: { accounts?: Array<{ id: string; descriptiveName?: string; name?: string; currencyCode?: string }> }) => {
        const list: Account[] = (d.accounts ?? []).map(a => ({
          id: a.id, name: a.descriptiveName ?? a.name ?? a.id, currencyCode: a.currencyCode,
        }))
        setAccounts(list)
        if (!selectedCustomer && list.length > 0) setSelectedCustomer(list[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load campaigns
  const loadCampaigns = useCallback(async (customerId: string) => {
    if (!customerId) return
    setCampaignsLoading(true)
    setSelectedIds(new Set())
    setActiveTabId(null)
    try {
      const res = await fetch(`/api/campaign-edit/campaigns?customerId=${customerId}`)
      const data = await res.json() as { campaigns?: CampaignSummary[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setCampaigns(data.campaigns ?? [])
    } catch {
      setCampaigns([])
    } finally {
      setCampaignsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCustomer) loadCampaigns(selectedCustomer)
  }, [selectedCustomer, loadCampaigns])

  // Selection helpers
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (activeTabId === id) setActiveTabId(next.size > 0 ? Array.from(next)[0] : null)
      } else {
        next.add(id)
        if (!activeTabId) setActiveTabId(id)
      }
      return next
    })
  }

  function selectAll() {
    const ids = campaigns.map(c => c.campaignId)
    setSelectedIds(new Set(ids))
    if (ids.length > 0 && !activeTabId) setActiveTabId(ids[0])
  }

  function deselectAll() {
    setSelectedIds(new Set())
    setActiveTabId(null)
  }

  const selectedCampaigns = campaigns.filter(c => selectedIds.has(c.campaignId))

  // Status toggle for selected campaigns — all requests fire in parallel
  async function toggleStatusForSelected(status: 'ENABLED' | 'PAUSED') {
    if (!selectedCampaigns.length) return
    const ids = new Set(selectedCampaigns.map(c => c.campaignId))
    setStatusTogglingIds(ids)

    const results = await Promise.allSettled(
      selectedCampaigns.map(campaign =>
        fetch('/api/campaign-adjustments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'edit_campaign_status',
            customerId: selectedCustomer,
            campaignResourceName: campaign.campaignResourceName,
            status,
          }),
        }).then(res => {
          if (!res.ok) throw new Error('failed')
          // Update state for this campaign immediately on success
          setCampaigns(prev => prev.map(c => c.campaignId === campaign.campaignId ? { ...c, status } : c))
        })
      )
    )

    const ok   = results.filter(r => r.status === 'fulfilled').length
    const fail = results.filter(r => r.status === 'rejected').length
    setStatusTogglingIds(new Set())
    setStatusResult({ message: `${status === 'ENABLED' ? 'เปิด' : 'หยุด'} ${ok} campaigns${fail > 0 ? ` (ผิดพลาด ${fail})` : ''}`, ok: fail === 0 })
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusResult(null), 4000)
  }

  // Budget update for selected campaigns — all requests fire in parallel
  async function applyBudgetToSelected(dailyBudgetMicros: number) {
    const campaignsWithBudget = selectedCampaigns.filter(c => c.budgetResourceName)

    const results = await Promise.allSettled(
      campaignsWithBudget.map(campaign =>
        fetch('/api/campaign-adjustments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'edit_campaign_budget',
            customerId: selectedCustomer,
            budgetResourceName: campaign.budgetResourceName,
            dailyBudgetMicros,
          }),
        }).then(async res => {
          if (!res.ok) {
            const d = await res.json() as { error?: string }
            throw new Error(d.error ?? 'Budget update failed')
          }
          setCampaigns(prev => prev.map(c => c.campaignId === campaign.campaignId ? { ...c, dailyBudgetMicros } : c))
        })
      )
    )

    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed) throw failed.reason
  }

  return (
    <AppShell>
      <div className="space-y-5 pb-24">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campaign Adjustment</h1>
          <p className="text-xs text-gray-400 mt-0.5">แก้ไข campaigns ทุกประเภทใน Google Ads</p>
        </div>

        {/* Account selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Account</label>
            <AccountSelect
              accounts={accounts}
              value={selectedCustomer}
              onChange={id => setSelectedCustomer(id)}
              placeholder="-- เลือก Account --"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <button
            onClick={() => selectedCustomer && loadCampaigns(selectedCustomer)}
            disabled={campaignsLoading || !selectedCustomer}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', campaignsLoading && 'animate-spin')}/>รีเฟรช
          </button>
        </div>

        {/* Campaign checklist */}
        {selectedCustomer && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-gray-900">Campaigns</span>
                {campaigns.length > 0 && <span className="px-2 py-0.5 text-[11px] bg-gray-100 text-gray-500 rounded-full">{campaigns.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Select All</button>
                <span className="text-gray-300">·</span>
                <button onClick={deselectAll} className="text-xs text-gray-500 hover:text-gray-700">Deselect All</button>
              </div>
            </div>

            {campaignsLoading && (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin"/>กำลังโหลด campaigns...
              </div>
            )}

            {!campaignsLoading && campaigns.length === 0 && selectedCustomer && (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">ไม่พบ campaigns</div>
            )}

            <div className="divide-y divide-gray-50">
              {campaigns.map(c => {
                const selected = selectedIds.has(c.campaignId)
                const toggling = statusTogglingIds.has(c.campaignId)
                return (
                  <label key={c.campaignId} className={cn('flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors', selected && 'bg-blue-50/40')}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(c.campaignId)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900">{c.campaignName}</span>
                    </span>
                    <TypeBadge type={c.type}/>
                    <span className={cn('px-2 py-0.5 text-[11px] font-semibold rounded-full', c.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                      {toggling ? <Loader2 className="w-3 h-3 animate-spin inline"/> : c.status}
                    </span>
                    <span className="text-[11px] text-gray-400">฿{(c.dailyBudgetMicros / 1_000_000).toLocaleString()}/day</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedCampaigns.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600 font-medium">
              เลือก {selectedCampaigns.length} campaigns:
            </span>
            <div className="flex flex-wrap gap-2 flex-1">
              {selectedCampaigns.map(c => (
                <span key={c.campaignId} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-full">
                  {c.campaignName}
                  <button onClick={() => toggleSelect(c.campaignId)} className="hover:text-blue-900 ml-0.5"><X className="w-3 h-3"/></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {statusResult && (
                <span className={cn('text-xs font-medium', statusResult.ok ? 'text-emerald-600' : 'text-red-600')}>{statusResult.message}</span>
              )}
              <button
                onClick={() => toggleStatusForSelected('ENABLED')}
                disabled={statusTogglingIds.size > 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <ToggleRight className="w-3.5 h-3.5"/>Enable All
              </button>
              <button
                onClick={() => toggleStatusForSelected('PAUSED')}
                disabled={statusTogglingIds.size > 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <ToggleLeft className="w-3.5 h-3.5"/>Pause All
              </button>
              <button
                onClick={() => setShowBudgetModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5"/>Adjust Budget
              </button>
            </div>
          </div>
        )}

        {/* Campaign tabs + editors */}
        {selectedCampaigns.length > 0 && (
          <div className="space-y-4">
            {/* Tab bar */}
            <div className="flex flex-wrap gap-1 border-b border-gray-200">
              {selectedCampaigns.map(c => (
                <button
                  key={c.campaignId}
                  onClick={() => setActiveTabId(c.campaignId)}
                  className={cn(
                    'px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px',
                    activeTabId === c.campaignId
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {(() => { const meta = TYPE_META[c.type]; return <meta.Icon className="w-3.5 h-3.5"/>})()}
                    <span className="truncate max-w-[140px]">{c.campaignName}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Active tab content */}
            {activeTabId && (() => {
              const campaign = selectedCampaigns.find(c => c.campaignId === activeTabId)
              if (!campaign) return null
              return (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <TypeBadge type={campaign.type}/>
                    <span className="font-semibold text-gray-900">{campaign.campaignName}</span>
                    <span className={cn('px-2 py-0.5 text-[11px] font-semibold rounded-full', campaign.status === 'ENABLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                      {campaign.status}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">฿{(campaign.dailyBudgetMicros / 1_000_000).toLocaleString()}/day</span>
                  </div>
                  <CampaignEditorPanel campaign={campaign} customerId={selectedCustomer}/>
                </div>
              )
            })()}
          </div>
        )}

      </div>

      {/* Budget modal */}
      {showBudgetModal && (
        <BudgetModal
          campaigns={selectedCampaigns}
          onClose={() => setShowBudgetModal(false)}
          onApply={applyBudgetToSelected}
        />
      )}
    </AppShell>
  )
}

export default function CampaignEditorPageWrapper() {
  return <Suspense><CampaignEditorPage /></Suspense>
}
