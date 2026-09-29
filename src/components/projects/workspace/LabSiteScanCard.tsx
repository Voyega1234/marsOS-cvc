'use client'

import { Check, ChevronDown, ChevronRight, Globe, Loader2, ScanSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { ArticleElementStyles } from '@/lib/articleTheme'
import type { UploadComponentFinding, UploadSiteScan, UploadTheme, UploadThemeDetail } from '@/lib/upload-article/types'

/** ค่าที่สแกนแล้วเอาไปใส่ในหน้า Article Lab ได้ */
export interface LabScanApply {
  articleTheme: string
  accentColor: string
  colors: { background: string; theme: string; text: string; border: string; accent: string }
  elements: ArticleElementStyles
  projectContext: string
  styleGuide: string
  forbiddenWords: string[]
  /** หน้าตา FAQ card / ตาราง ละเอียด จากผลสแกนเว็บปลายทาง (ไม่บังคับ — ไม่มี = ไม่แตะ) */
  detail?: UploadThemeDetail | null
  /** สีพื้นหน้าเว็บด้านหลังบทความ (จากการสแกน) — ใช้แสดงตัวอย่างเท่านั้น */
  pageBackground?: string
  /** true = บทความพื้นโปร่งใส (คำนวณจาก CSS จริงว่าเว็บนี้ไม่ใส่พื้นให้กล่องบทความ) */
  transparentBackground?: boolean
  fonts?: { body?: string; heading?: string }
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

interface Evidence {
  pages: Array<{ url: string; title: string; h1: string; words: number }>
  stylesheets: string[]
  topColors: Array<{ hex: string; count: number }>
  fonts: Array<{ name: string; count: number }>
  navLabels: string[]
  /** web_search = เว็บกันเซิร์ฟเวอร์ ใช้ผลค้นหาแทน — ไม่มีสี/ฟอนต์จริงจาก CSS */
  source?: 'site' | 'web_search'
}

/** ผลสแกนละเอียด (เหมือน Upload Article) — สีจาก CSS จริง, platform/plugins, TOC/FAQ/CTA auto-insert */
interface SiteScanPart {
  scan: UploadSiteScan
  suggestedTheme: Partial<UploadTheme> | null
  detail: UploadThemeDetail | null
}

interface ScanResult {
  url: string
  suggestion: Suggestion | null
  evidence: Evidence | null
  warnings: string[]
  siteScan: SiteScanPart | null
  siteScanError?: string
}

/** ผลสแกนละเอียดล่าสุดที่เคยบันทึกไว้ (โหลดตอนเปิดหน้า) */
interface LastScan {
  siteScan: UploadSiteScan | null
  excludeCards: { toc?: boolean; faq?: boolean; cta?: boolean } | null
}

type PartKey = 'look' | 'context' | 'styleGuide' | 'forbidden'

const PART_LABELS: Record<PartKey, string> = {
  look: 'ธีม สี และฟอนต์',
  context: 'บริบทธุรกิจ (Project Context)',
  styleGuide: 'Style Guide (.md)',
  forbidden: 'คำต้องห้าม',
}

const COMPONENT_LABEL: Record<'toc' | 'faq' | 'cta', string> = { toc: 'สารบัญ (TOC)', faq: 'FAQ', cta: 'CTA' }

/** ข้อความ/สีของ badge บอกที่มาของ TOC/FAQ/CTA — คำเดียวกับ Upload Article (SiteScanPanel) */
function statusOf(f: UploadComponentFinding): { text: string; cls: string } {
  if (f.where === 'auto') return { text: 'ปลั๊กอิน/ธีมใส่ให้ทุกบทความเอง — ไม่ใส่ของเราซ้ำ', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
  if (f.where === 'some-posts') return { text: 'ผู้เขียนเขียนเองในเนื้อหา (ไม่ใช่ปลั๊กอิน) — ใส่ของเราตามปกติ', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  if (f.where === 'site') return { text: 'เจอนอกบทความ (เช่น หน้าแรก/เมนู) — ใส่ของเราตามปกติ', cls: 'bg-gray-50 text-gray-600 border-gray-200' }
  return { text: 'ไม่พบ — ใส่ของเราตามปกติ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

/** ตัด 'inherit'/ว่าง ออก — ไม่ใช่ชื่อฟอนต์ที่ใช้ได้จริง */
function normalizeFont(v: string | undefined): string | undefined {
  if (!v) return undefined
  const s = v.trim()
  return s && s.toLowerCase() !== 'inherit' ? s : undefined
}

/**
 * สแกนเว็บไซต์ลูกค้าแล้วเติมค่าหน้า Article Lab ให้อัตโนมัติ
 * ผลที่ได้เป็นข้อเสนอ ทีมเลือกได้ว่าจะรับส่วนไหน แล้วยังแก้ต่อได้ก่อนกดบันทึก
 * สแกน 2 แบบพร้อมกัน: (1) ธีม/บริบทธุรกิจ/style guide (2) สแกนละเอียด — สีจาก CSS จริง,
 * platform/ปลั๊กอิน, ตรวจว่าเว็บใส่ TOC/FAQ/CTA ให้ทุกบทความเองไหม (ผลนี้บันทึกลง DB ให้อัตโนมัติ)
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
  const [sampleUrl, setSampleUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [parts, setParts] = useState<Record<PartKey, boolean>>({
    look: true, context: true, styleGuide: true, forbidden: true,
  })
  const [showDetail, setShowDetail] = useState(false)
  const [showPlugins, setShowPlugins] = useState(false)
  const [openComp, setOpenComp] = useState<Record<string, boolean>>({})

  // โหลดผลสแกนละเอียดล่าสุดที่เคยบันทึกไว้ — โชว์ไว้ก่อนกดสแกนใหม่
  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/lab-scan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setLastScan(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId])

  async function scan() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/lab-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() || undefined, sampleUrl: sampleUrl.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
      const scanned = body as ScanResult
      setResult(scanned)
      // สี/ฟอนต์จากผลค้นหาเป็นแค่ค่าตั้งต้น — ไม่ติ๊กไว้ก่อน กันทับค่าจริงที่ทีมตั้งไว้
      setParts((p) => ({ ...p, look: scanned.evidence?.source !== 'web_search' }))
      setShowDetail(true)
      const auto = (['toc', 'faq', 'cta'] as const).filter((k) => scanned.siteScan?.scan.components[k]?.where === 'auto')
      const autoMsg = auto.length
        ? ` — เว็บมีปลั๊กอิน/ธีมใส่ ${auto.map((k) => COMPONENT_LABEL[k]).join(', ')} ให้แล้ว ระบบจะไม่ใส่ของเราซ้ำตอน push`
        : ''
      toast.success(`สแกนเสร็จแล้ว${autoMsg} — ตรวจค่าที่เสนอก่อนกดนำไปใส่`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function apply() {
    if (!result) return
    const s = result.suggestion
    const site = result.siteScan
    const siteTheme = site?.suggestedTheme ?? null
    const elements: ArticleElementStyles = {}
    let colors: LabScanApply['colors'] = { background: '', theme: '', text: '', border: '', accent: '' }
    let transparentBackground: boolean | undefined
    let pageBackground: string | undefined
    let fonts: LabScanApply['fonts']
    let detail: UploadThemeDetail | null | undefined

    if (parts.look) {
      const base = s?.colors ?? { background: '', theme: '', text: '', border: '', accent: '' }
      // สีที่คำนวณจาก CSS จริงของเว็บ (ถ้ามี) ชนะสีที่ AI เดา
      colors = {
        background: siteTheme?.background !== undefined ? siteTheme.background : base.background,
        theme: siteTheme?.theme || base.theme,
        text: siteTheme?.text || base.text,
        border: siteTheme?.border || base.border,
        accent: siteTheme?.accent || base.accent,
      }
      if (colors.background === '') transparentBackground = true
      if (siteTheme?.pageBackground) pageBackground = siteTheme.pageBackground
      detail = site?.detail ?? null

      const fontBody = normalizeFont(siteTheme?.fontFamily) || s?.fonts.body
      const fontHeading = normalizeFont(siteTheme?.headingFont) || s?.fonts.heading
      if (fontBody || fontHeading) fonts = { body: fontBody, heading: fontHeading }

      for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        elements[h] = { font: fontHeading, color: h === 'h1' ? colors.theme : undefined }
      }
      elements.body = { font: fontBody, color: colors.text }
      elements.link = { color: colors.accent }
      elements.author = { font: fontBody }
      elements.faq = { font: fontBody }
    }

    onApply({
      articleTheme: parts.look ? (s?.articleTheme ?? '') : '',
      accentColor: parts.look ? (colors.accent || s?.accentColor || '') : '',
      colors,
      elements,
      projectContext: parts.context ? (s?.projectContext ?? '') : '',
      styleGuide: parts.styleGuide ? (s?.styleGuide ?? '') : '',
      forbiddenWords: parts.forbidden ? (s?.forbiddenWords ?? []) : [],
      detail,
      pageBackground,
      transparentBackground,
      fonts,
    })
    toast.success('ใส่ค่าลงฟอร์มแล้ว — ตรวจ แก้ได้ตามต้องการ แล้วกดบันทึก')
  }

  const s = result?.suggestion ?? null
  // ผลสแกนละเอียดที่โชว์: ของรอบสแกนสด ๆ ก่อน ไม่มีค่อยโชว์ผลล่าสุดที่เคยบันทึกไว้
  const fresh = result?.siteScan ?? null
  const siteScanShown: UploadSiteScan | null = fresh?.scan ?? lastScan?.siteScan ?? null
  const isFreshSiteScan = Boolean(fresh)
  const hasApplyTarget = Boolean(s || fresh)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <ScanSearch size={13} className="text-gray-400" />
        <span className="text-xs font-semibold text-gray-800">สแกนเว็บไซต์</span>
      </div>
      <p className="text-[10px] text-gray-400 leading-relaxed mb-2">
        ระบบจะอ่านเว็บลูกค้า แล้วเสนอธีม สี ฟอนต์ บริบทธุรกิจ Style Guide คำต้องห้าม และตรวจว่าเว็บมีปลั๊กอิน/ธีมใส่สารบัญ FAQ CTA ให้เองไหม ทีมแก้ต่อได้ทุกช่อง
      </p>
      <div className="space-y-1.5">
        <div className="relative">
          <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full h-8 pl-7 pr-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-brand-blue"
          />
        </div>
        <div className="flex gap-1.5">
          <input
            value={sampleUrl}
            onChange={(e) => setSampleUrl(e.target.value)}
            placeholder="ลิงก์บทความตัวอย่าง (ไม่บังคับ)"
            className="flex-1 h-8 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-brand-blue"
          />
          <button
            onClick={scan}
            disabled={busy}
            className="h-8 px-3 rounded-lg bg-brand-blue text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1.5 shrink-0"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
            {busy ? 'กำลังสแกน' : 'สแกน'}
          </button>
        </div>
        <p className="text-[10px] text-gray-400">ลิงก์บทความตัวอย่าง (ไม่บังคับ) — ช่วยให้สีและหน้าตา FAQ ตรงกับบทความจริงของเว็บนี้มากขึ้น</p>
      </div>
      {busy && (
        <p className="mt-2 text-[10px] text-gray-400">อ่านหน้าเว็บและ CSS อยู่ ใช้เวลาประมาณ 1-2 นาที</p>
      )}

      {result && s && (
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
        </div>
      )}

      {result && !s && (
        <p className="mt-3 text-[11px] text-amber-600">
          เสนอธีม/บริบทธุรกิจไม่สำเร็จ — ยังใช้ผลสแกนสี/หน้าตาจากเว็บด้านล่างได้ตามปกติ
        </p>
      )}

      {hasApplyTarget && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            {(Object.keys(PART_LABELS) as PartKey[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={parts[k]}
                  onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))}
                />
                {PART_LABELS[k]}
                {k === 'look' && result?.evidence?.source === 'web_search' && (
                  <span className="text-amber-600">(อ่านจากเว็บไม่ได้ — เป็นค่าตั้งต้น)</span>
                )}
                {k === 'forbidden' && s && <span className="text-gray-400">({s.forbiddenWords.length} คำ)</span>}
                {k === 'context' && s && <span className="text-gray-400">({s.projectContext.length} ตัวอักษร)</span>}
                {k === 'styleGuide' && s && <span className="text-gray-400">({s.styleGuide.length} ตัวอักษร)</span>}
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

          {result && (
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="w-full text-[10px] text-gray-400 hover:text-gray-600"
            >
              {showDetail ? 'ซ่อนหลักฐาน' : 'ดูหลักฐานที่สแกนได้'}
            </button>
          )}
        </div>
      )}

      {showDetail && result && s && result.evidence && (
        <div className="mt-2 rounded-lg bg-gray-50 p-2 space-y-1.5 text-[10px] text-gray-600">
          {s.rationale && <p className="leading-relaxed">{s.rationale}</p>}
          <div>
            <span className="font-semibold">หน้าที่อ่าน ({result.evidence.pages.length}):</span>
            <ul className="mt-0.5 space-y-0.5">
              {result.evidence.pages.map((p) => (
                <li key={p.url} className="truncate">· {p.title || p.url} {p.words > 0 && <span className="text-gray-400">({p.words} คำ)</span>}</li>
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

      {siteScanShown && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2 text-xs">
          <p className="text-[11px] text-gray-400">
            {isFreshSiteScan ? 'ผลสแกนละเอียด' : 'ผลสแกนล่าสุด'} {siteScanShown.target} · {new Date(siteScanShown.scannedAt).toLocaleString('th-TH')} · ดู {siteScanShown.checked.join(', ')}
          </p>

          <div className="rounded-lg bg-gray-50 border border-gray-100 p-2 space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <div><span className="text-gray-500">ระบบเว็บ:</span> <b>{siteScanShown.platform.cms}</b></div>
              <div>
                <span className="text-gray-500">ธีม:</span> <b>{siteScanShown.platform.theme || 'ไม่ทราบ'}</b>
                {siteScanShown.platform.childTheme && <span className="text-gray-500"> (child: {siteScanShown.platform.childTheme})</span>}
              </div>
              <div><span className="text-gray-500">ตัวสร้างหน้า:</span> <b>{siteScanShown.platform.builders.join(', ') || '—'}</b></div>
            </div>
            {siteScanShown.platform.plugins.length > 0 && (
              <div>
                <button onClick={() => setShowPlugins((v) => !v)} className="text-gray-500 hover:text-brand-navy flex items-center gap-1">
                  {showPlugins ? <ChevronDown size={11} /> : <ChevronRight size={11} />} ปลั๊กอินที่เห็นจากหน้าเว็บ ({siteScanShown.platform.plugins.length})
                </button>
                {showPlugins && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {siteScanShown.platform.plugins.map((p) => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-600">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            {(['toc', 'faq', 'cta'] as const).map((k) => {
              const f = siteScanShown.components[k]
              const st = statusOf(f)
              return (
                <div key={k} className="border border-gray-100 rounded-lg">
                  <button onClick={() => setOpenComp((o) => ({ ...o, [k]: !o[k] }))} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
                    {openComp[k] ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                    <span className="font-semibold text-brand-navy w-24 shrink-0">{COMPONENT_LABEL[k]}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${st.cls}`}>{st.text}</span>
                    {f.source && <span className="text-gray-500 truncate">· {f.source}</span>}
                  </button>
                  {openComp[k] && f.evidence.length > 0 && (
                    <ul className="px-8 pb-2 list-disc text-[11px] text-gray-500 space-y-0.5">
                      {f.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-gray-400">ตั้งค่าตัด TOC/FAQ/CTA ตอน Push ให้อัตโนมัติแล้ว</p>

          {siteScanShown.faqSummary && (
            <div className="rounded-lg border border-brand-blue/20 bg-brand-mist/30 p-3">
              <p className="font-semibold text-brand-navy mb-1">หน้าตา FAQ / บทความบนเว็บนี้</p>
              <p className="text-gray-600 leading-relaxed">{siteScanShown.faqSummary}</p>
              {fresh?.detail?.source && <p className="text-[10px] text-gray-400 mt-1">อ้างอิง: {fresh.detail.source}</p>}
            </div>
          )}

          {fresh?.suggestedTheme && (
            <div className="rounded-lg border border-gray-100 p-2.5 space-y-1.5">
              <p className="font-semibold text-brand-navy text-[11px]">สีที่คำนวณจาก CSS จริงของเว็บนี้</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['theme', 'accent', 'text', 'border'] as const).map((k) => {
                  const v = fresh.suggestedTheme?.[k]
                  if (!v) return null
                  return (
                    <span key={k} className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                      <span className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ backgroundColor: v }} />
                      {k}
                    </span>
                  )
                })}
              </div>
              {/* พรีวิวเล็ก ๆ — ตัวอักษรบนพื้นหน้าเว็บ (พื้นบทความเองอาจโปร่งใส เห็นพื้นเว็บทะลุ) */}
              <div
                className="rounded-md px-2.5 py-2 text-[11px]"
                style={{
                  backgroundColor: fresh.suggestedTheme.pageBackground || '#ffffff',
                  color: fresh.suggestedTheme.text || '#1c1c1c',
                }}
              >
                ตัวอย่างตัวอักษรบนพื้นหน้าเว็บ
              </div>
              {fresh.suggestedTheme.background === '' && (
                <p className="text-[10px] text-gray-400">พื้นบทความ: โปร่งใส (ใช้พื้นของเว็บ)</p>
              )}
            </div>
          )}

          {result?.siteScanError && (
            <p className="text-[11px] text-amber-600">สแกนละเอียดไม่สำเร็จ: {result.siteScanError}</p>
          )}
          {isFreshSiteScan && siteScanShown.warnings.length > 0 && (
            <ul className="text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
              {siteScanShown.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
