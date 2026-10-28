'use client'

/**
 * แผง "สร้างรูปด้วย Mars" ของ SEO SME Review — หน้าตา/ปุ่ม/ข้อความเหมือนแผงของ Upload Article
 * แยกไฟล์เป็นของ SME เอง (ไม่แตะหน้า Upload) ต่างกันที่ API (/api/articles/{id}/images) และข้อความอธิบาย
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DEFAULT_UPLOAD_IMAGE_DEFAULTS, UPLOAD_MAX_INLINE_IMAGES } from '@/lib/upload-article/types'
import { readArticleImageSettings } from '@/lib/article-settings'
import { countSmeGeneratedFigures } from '@/lib/sme-articles/article-images'

export type SmeArticleUpdate = { id: string; htmlContent: string; coverImageUrl: string | null; coverAlt?: string | null; status?: string }

type Busy = '' | 'cover' | 'inline' | 'remove'

function TextToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
      {[{ v: true, l: 'มีตัวหนังสือ' }, { v: false, l: 'ภาพล้วน' }].map(o => (
        <button key={String(o.v)} type="button" disabled={disabled} onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 ${value === o.v ? 'bg-brand-blue text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-40`}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

/** ค่าเริ่มต้นรูปจาก Project.themeColors.imageSettings (ไม่มี = ค่าเดียวกับ Upload) */
function imageDefaultsFromTheme(themeColors: string | undefined | null) {
  let raw: unknown = null
  try { raw = themeColors ? (JSON.parse(themeColors) as Record<string, unknown>)?.imageSettings : null } catch { /* ใช้ค่าเริ่มต้น */ }
  const s = readArticleImageSettings(raw)
  return {
    coverWithText: s.coverWithText,
    inlineWithText: s.inlineWithText,
    inlineCount: s.inlineCount ?? DEFAULT_UPLOAD_IMAGE_DEFAULTS.inlineCount,
  }
}

export default function SmeAiImagesPanel({ articleId, themeColors, html, hasCover, locked, editing, coverBusy, onUpdated, onBusyChange }: {
  articleId?: string
  themeColors?: string | null
  html: string
  hasCover: boolean
  locked: boolean
  /** กำลังแก้ข้อความในหน้า Review — server เขียนทับ HTML ได้ ต้องบันทึก/ยกเลิกก่อน */
  editing: boolean
  /** กำลังอัปโหลด/ลบปก/บันทึก alt — รอให้เสร็จก่อน ไม่งั้นปกในหน้าจอกับ DB อาจไม่ตรงกัน */
  coverBusy: boolean
  onUpdated: (a: SmeArticleUpdate) => void
  /** แจ้งหน้าแม่ตอนเริ่ม/จบงาน — ไว้ล็อกปุ่มอื่นที่เขียน HTML ทับกันได้ */
  onBusyChange?: (busy: boolean) => void
}) {
  const defaults = imageDefaultsFromTheme(themeColors)
  const [coverWithText, setCoverWithText] = useState(defaults.coverWithText)
  const [inlineWithText, setInlineWithText] = useState(defaults.inlineWithText)
  const [inlineCount, setInlineCount] = useState(Math.max(1, defaults.inlineCount || 1))
  const [busy, setBusy] = useState<Busy>('')

  // ค่าเริ่มต้นเปลี่ยนใน Project Setting → ใช้ค่าใหม่
  useEffect(() => {
    setCoverWithText(defaults.coverWithText)
    setInlineWithText(defaults.inlineWithText)
    setInlineCount(Math.max(1, defaults.inlineCount || 1))
  }, [defaults.coverWithText, defaults.inlineWithText, defaults.inlineCount])

  const isBusy = !!busy
  useEffect(() => { onBusyChange?.(isBusy) }, [isBusy]) // eslint-disable-line react-hooks/exhaustive-deps

  const genCount = countSmeGeneratedFigures(html)
  const disabledReason = !articleId || !html ? 'กำลังโหลดบทความ...'
    : editing ? 'บันทึกหรือยกเลิกการแก้ไขก่อน'
    : coverBusy ? 'กำลังบันทึกภาพปก...'
    : undefined
  const off = locked || !!disabledReason

  async function run(kind: 'cover' | 'inline') {
    if (!articleId) return
    setBusy(kind)
    try {
      const r = await fetch(`/api/articles/${articleId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'cover' ? { kind, withText: coverWithText } : { kind, withText: inlineWithText, count: inlineCount }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(d?.error === 'CONTENT_ENGINE_NOT_CONFIGURED'
          ? 'ยังไม่ได้ตั้ง Image Prompt ใน Project Setting > Content Engine'
          : d?.error || 'สร้างรูปไม่สำเร็จ')
        return
      }
      onUpdated(d.article)
      const cost = `ต้นทุน $${(Number(d.costUsd) || 0).toFixed(3)}`
      const generated = Number(d.generated) || 0
      const failed = Number(d.failed) || 0
      if (kind === 'cover') toast.success(`สร้างรูปปกแล้ว (${cost})`)
      else if (failed) toast.warning(`สร้างรูปประกอบได้ ${generated} รูป ไม่สำเร็จ ${failed} รูป (${cost})`)
      else toast.success(`สร้างรูปประกอบ ${generated} รูปแล้ว (${cost})`)
    } catch (e) {
      toast.error(`สร้างรูปไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!articleId) return
    setBusy('remove')
    try {
      const r = await fetch(`/api/articles/${articleId}/images?kind=inline`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'ลบรูปไม่สำเร็จ'); return }
      onUpdated(d.article)
      toast.success('เอารูปประกอบที่ Mars สร้างออกแล้ว')
    } catch {
      toast.error('ลบรูปไม่สำเร็จ')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><Sparkles size={12} /> สร้างรูปด้วย Mars</p>
      <p className="text-[11px] text-gray-500">ใช้ Image Prompt + ภาพตัวอย่างจาก Content Engine ของลูกค้านี้ · ใช้เวลาประมาณ 1-2 นาที</p>
      {disabledReason && <p className="text-[11px] text-amber-600">{disabledReason}</p>}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-gray-600">รูปปก</p>
        <TextToggle value={coverWithText} onChange={setCoverWithText} disabled={!!busy || off} />
        <Button size="sm" variant="outline" className="w-full" disabled={!!busy || off} onClick={() => run('cover')}>
          {busy === 'cover' ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wand2 size={12} className="mr-1" />}
          {hasCover ? 'สร้างรูปปกใหม่' : 'สร้างรูปปก'}
        </Button>
      </div>

      <div className="space-y-1.5 pt-2 border-t border-gray-100">
        <p className="text-[11px] font-semibold text-gray-600">รูปประกอบในบทความ {genCount > 0 && <span className="font-normal text-gray-400">(ตอนนี้มี {genCount} รูปจาก Mars)</span>}</p>
        <TextToggle value={inlineWithText} onChange={setInlineWithText} disabled={!!busy || off} />
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[11px] text-gray-500 mr-1">จำนวน</span>
          {Array.from({ length: UPLOAD_MAX_INLINE_IMAGES }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" disabled={!!busy || off} onClick={() => setInlineCount(n)}
              className={`w-7 h-7 rounded-md border text-[11px] ${inlineCount === n ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {n}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="w-full" disabled={!!busy || off} onClick={() => run('inline')}>
          {busy === 'inline' ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wand2 size={12} className="mr-1" />}
          {genCount > 0 ? `สร้างรูปประกอบใหม่ ${inlineCount} รูป (แทนชุดเดิม)` : `สร้างรูปประกอบ ${inlineCount} รูป`}
        </Button>
        {genCount > 0 && (
          <Button size="sm" variant="ghost" className="w-full text-rose-600" disabled={!!busy || off} onClick={remove}>
            <Trash2 size={12} className="mr-1" /> เอารูปประกอบที่ Mars สร้างออก
          </Button>
        )}
        <p className="text-[10px] text-gray-400">วางใต้หัวข้อ H2 กระจายทั้งบทความ ไม่วางในส่วน FAQ · แทนรูปประกอบเดิมที่ Mars สร้างตอนเขียน</p>
      </div>
    </div>
  )
}
