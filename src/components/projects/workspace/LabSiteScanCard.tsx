'use client'

import { Check, Globe, Loader2, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { ArticleElementStyles } from '@/lib/articleTheme'

/** ค่าที่สแกนแล้วเอาไปใส่ในหน้า Article Lab ได้ */
export interface LabScanApply {
  articleTheme: string
  accentColor: string
  colors: { background: string; theme: string; text: string; border: string; accent: string }
  elements: ArticleElementStyles
  projectContext: string
  styleGuide: string
  forbiddenWords: string[]
}

interface Suggestion {
  businessName: string
  industry: string
  articleTheme: string
  accentColor: string
  colors: LabScanApply['colors']
  fonts: { heading: string; body: string }
  projectContext: string
  styleGuide: string
  forbiddenWords: string[]
  rationale: string
}

interface ScanResult {
  url: string
  suggestion: Suggestion
  evidence: {
    pages: Array<{ url: string; title: string; h1: string; words: number }>
    stylesheets: string[]
    topColors: Array<{ hex: string; count: number }>
    fonts: Array<{ name: string; count: number }>
    navLabels: string[]
  }
  warnings: string[]
}

type PartKey = 'look' | 'context' | 'styleGuide' | 'forbidden'

const PART_LABELS: Record<PartKey, string> = {
  look: 'ธีม สี และฟอนต์',
  context: 'บริบทธุรกิจ (Project Context)',
  styleGuide: 'Style Guide (.md)',
  forbidden: 'คำต้องห้าม',
}

/**
 * สแกนเว็บไซต์ลูกค้าแล้วเติมค่าหน้า Article Lab ให้อัตโนมัติ
 * ผลที่ได้เป็นข้อเสนอ ทีมเลือกได้ว่าจะรับส่วนไหน แล้วยังแก้ต่อได้ก่อนกดบันทึก
 */
export function LabSiteScanCard({
  projectId,
  defaultUrl,
  onApply,
}: {
  projectId: string
  defaultUrl?: string | null
  onApply: (apply: LabScanApply) => void
}) {
  const [url, setUrl] = useState(defaultUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [parts, setParts] = useState<Record<PartKey, boolean>>({
    look: true, context: true, styleGuide: true, forbidden: true,
  })
  const [showDetail, setShowDetail] = useState(false)

  async function scan() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/lab-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
      setResult(body as ScanResult)
      setShowDetail(true)
      toast.success('สแกนเสร็จแล้ว — ตรวจค่าที่เสนอก่อนกดนำไปใส่')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function apply() {
    if (!result) return
    const s = result.suggestion
    const elements: ArticleElementStyles = {}
    if (parts.look) {
      for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        elements[h] = { font: s.fonts.heading, color: h === 'h1' ? s.colors.theme : undefined }
      }
      elements.body = { font: s.fonts.body, color: s.colors.text }
      elements.link = { color: s.colors.accent }
      elements.author = { font: s.fonts.body }
      elements.faq = { font: s.fonts.body }
    }
    onApply({
      articleTheme: parts.look ? s.articleTheme : '',
      accentColor: parts.look ? s.accentColor : '',
      colors: parts.look ? s.colors : { background: '', theme: '', text: '', border: '', accent: '' },
      elements,
      projectContext: parts.context ? s.projectContext : '',
      styleGuide: parts.styleGuide ? s.styleGuide : '',
      forbiddenWords: parts.forbidden ? s.forbiddenWords : [],
    })
    toast.success('ใส่ค่าลงฟอร์มแล้ว — ตรวจ แก้ได้ตามต้องการ แล้วกดบันทึก')
  }

  const s = result?.suggestion

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <ScanSearch size={13} className="text-gray-400" />
        <span className="text-xs font-semibold text-gray-800">สแกนเว็บไซต์</span>
      </div>
      <p className="text-[10px] text-gray-400 leading-relaxed mb-2">
        ระบบจะอ่านเว็บลูกค้า แล้วเสนอธีม สี ฟอนต์ บริบทธุรกิจ Style Guide และคำต้องห้ามให้ ทีมแก้ต่อได้ทุกช่อง
      </p>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full h-8 pl-7 pr-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-brand-blue"
          />
        </div>
        <button
          onClick={scan}
          disabled={busy}
          className="h-8 px-3 rounded-lg bg-brand-blue text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
          {busy ? 'กำลังสแกน' : 'สแกน'}
        </button>
      </div>
      {busy && (
        <p className="mt-2 text-[10px] text-gray-400">อ่านหน้าเว็บและ CSS อยู่ ใช้เวลาประมาณ 1-2 นาที</p>
      )}

      {s && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          <div className="text-xs font-semibold text-brand-navy">
            {s.businessName || 'ไม่ระบุชื่อธุรกิจ'}
            {s.industry && <span className="text-[10px] font-normal text-gray-400"> · {s.industry}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['theme', 'accent', 'text', 'background', 'border'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ backgroundColor: s.colors[k] }} />
                {k}
              </span>
            ))}
            <span className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
              ธีม: {s.articleTheme}
            </span>
            <span className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
              ฟอนต์: {s.fonts.heading} / {s.fonts.body}
            </span>
          </div>

          <div className="space-y-1">
            {(Object.keys(PART_LABELS) as PartKey[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={parts[k]}
                  onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))}
                />
                {PART_LABELS[k]}
                {k === 'forbidden' && <span className="text-gray-400">({s.forbiddenWords.length} คำ)</span>}
                {k === 'context' && <span className="text-gray-400">({s.projectContext.length} ตัวอักษร)</span>}
                {k === 'styleGuide' && <span className="text-gray-400">({s.styleGuide.length} ตัวอักษร)</span>}
              </label>
            ))}
          </div>

          <button
            onClick={apply}
            className="w-full h-8 rounded-lg border border-brand-blue text-brand-blue text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-gray-50"
          >
            <Check size={12} />
            นำค่าที่เลือกไปใส่ในฟอร์ม
          </button>

          <button
            onClick={() => setShowDetail((v) => !v)}
            className="w-full text-[10px] text-gray-400 hover:text-gray-600"
          >
            {showDetail ? 'ซ่อนหลักฐาน' : 'ดูหลักฐานที่สแกนได้'}
          </button>

          {showDetail && result && (
            <div className="rounded-lg bg-gray-50 p-2 space-y-1.5 text-[10px] text-gray-600">
              {s.rationale && <p className="leading-relaxed">{s.rationale}</p>}
              <div>
                <span className="font-semibold">หน้าที่อ่าน ({result.evidence.pages.length}):</span>
                <ul className="mt-0.5 space-y-0.5">
                  {result.evidence.pages.map((p) => (
                    <li key={p.url} className="truncate">· {p.title || p.url} <span className="text-gray-400">({p.words} คำ)</span></li>
                  ))}
                </ul>
              </div>
              {result.evidence.fonts.length > 0 && (
                <p><span className="font-semibold">ฟอนต์ที่เว็บใช้จริง:</span> {result.evidence.fonts.slice(0, 6).map((f) => f.name).join(', ')}</p>
              )}
              {result.evidence.topColors.length > 0 && (
                <p className="break-all"><span className="font-semibold">สีที่นับได้:</span> {result.evidence.topColors.slice(0, 10).map((c) => c.hex).join(' ')}</p>
              )}
              {result.warnings.length > 0 && (
                <p className="text-amber-600"><span className="font-semibold">ข้อควรทราบ:</span> {result.warnings.join(' · ')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
