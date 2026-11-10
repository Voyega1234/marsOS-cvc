'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import {
  RefreshCw, Download, CheckCircle2, AlertTriangle, Image as ImageIcon, Save, X, FileText, Check,
} from 'lucide-react'
import ArticleFrame from '@/components/shared/ArticleFrame'
import ScopedEditable from '@/components/shared/ScopedEditable'
import EditorToolbar from '@/components/shared/EditorToolbar'
import { googleDocsResultNotice, isDriveExportConfigured, preloadGoogleDocsExport, sendToGoogleDocs } from '@/lib/google-docs-export'
import SmeAiImagesPanel, { type SmeArticleUpdate } from '@/components/projects/SmeAiImagesPanel'
import ArticleImagesPanel from '@/components/upload-article/shared/ArticleImagesPanel'
import { listH2Sections, insertFigureAfterH2 } from '@/components/upload-article/shared/htmlSections'
import { editBackground, EDIT_READABLE_CSS } from '@/components/shared/editTone'
import { getCoverAltFromHtml, MANUAL_FIGURE_ATTR } from '@/lib/sme-articles/article-images'
import { fileToDownscaledDataUrl } from '@/lib/imageDownscale'
import { boxKeyTakeaways } from '@/lib/article-structure'
import { applyFaqDisplay } from '@/lib/upload-article/theme-css'
import { exportFontCssDetailed } from '@/lib/upload-article/font-faces'
import { useProjectArticleLook } from '@/components/projects/useProjectArticleLook'
import type { ProjectData, TimelineEntry, ArticleJob } from '@/components/projects/sme-types'

// ─── Review Tab ───────────────────────────────────────────────────────────────

// ── SEO meta ที่แก้ในหน้า Review ต้องเป็นค่าเดียวกับที่ Push ขึ้นเว็บ ──────────
// กติกา: ยังไม่แก้ที่หน้านี้ = Push ใช้ค่าเดิมตามลำดับเดิม (meta block ในบทความ → DB
// → title) · แก้แล้ว = ค่าที่แก้ชนะทุกแหล่งเสมอ
// ทำได้โดยตอนบันทึกเขียนกลับทุกที่ที่ /api/push/publish อ่าน แล้วเก็บ override ไว้ที่
// timeline entry (reviewSeoTitle/reviewMetaDescription/slug) ซึ่ง PushTab ส่งไปกับ
// request — จุดนี้ไม่มี job อื่นในระบบเขียนทับ ต่อให้ DB/บทความถูกทับทีหลังก็ยังได้ของที่แก้
const SEO_META_KEYS = { title: 'meta_title', desc: 'meta_description', slug: 'en_slug' } as const

function readSeoMetaFromHtml(html: string) {
  const block = html.match(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i)?.[1] ?? ''
  const get = (key: string) => {
    const m = block.match(new RegExp(`${key}\\s*[:=]\\s*([^\\n]+)`, 'i'))
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  }
  let desc = get(SEO_META_KEYS.desc)
  if (!desc) desc = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ?? ''
  return { metaTitle: get(SEO_META_KEYS.title), metaDescription: desc, enSlug: get(SEO_META_KEYS.slug) }
}

/** slug ปลายทาง WordPress: a-z 0-9 ยัติภังค์ เท่านั้น (กติกาเดียวกับ /api/push/publish) */
function slugifyEnSlug(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

/** เขียน meta ที่แก้กลับเข้าตัวบทความ (comment block + <meta name="description">) */
function syncSeoMetaIntoHtml(html: string, v: { metaTitle: string; metaDescription: string; slug: string }) {
  const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
  const vals: [string, string][] = [
    [SEO_META_KEYS.title, oneLine(v.metaTitle)],
    [SEO_META_KEYS.desc, oneLine(v.metaDescription)],
    [SEO_META_KEYS.slug, oneLine(v.slug)],
  ]

  if (!/<!--\s*CONVERT_CAKE_SEO_META/i.test(html)) {
    const block = vals.filter(([, val]) => val).map(([k, val]) => `${k}: ${val}`).join('\n')
    return block ? `<!-- CONVERT_CAKE_SEO_META\n${block}\n-->\n${html}` : html
  }

  let out = html
  for (const [key, val] of vals) {
    if (!val) continue
    out = out.replace(/<!--\s*CONVERT_CAKE_SEO_META([\s\S]*?)-->/i, (full: string, inner: string) => {
      const re = new RegExp(`(^|\\n)([ \\t]*)${key}\\s*[:=]\\s*[^\\n]*`, 'i')
      const nextInner = re.test(inner)
        ? inner.replace(re, (_m: string, br: string, sp: string) => `${br}${sp}${key}: ${val}`)
        : `${inner.replace(/\s*$/, '')}\n${key}: ${val}\n`
      return full.replace(inner, () => nextInner)
    })
  }
  const desc = oneLine(v.metaDescription)
  if (desc) {
    out = out.replace(
      /(<meta\s+name=["']description["']\s+content=["'])([^"']*)(["'])/i,
      (_m: string, pre: string, _old: string, post: string) => `${pre}${desc.replace(/"/g, '&quot;')}${post}`
    )
  }
  return out
}

/** แถบวัดความยาวแบบ Yoast: สั้นไป = ส้ม, กำลังดี = เขียว, ยาวเกิน = แดง */
/**
 * รูปแรกในตัวบทความ — ใช้เป็น thumbnail ของ SERP preview ตอนที่ยังไม่มีภาพปก
 * (Google เองก็หยิบรูปในหน้ามาแสดงแบบนี้) รับเฉพาะ http(s) กับ data: กัน src แปลก ๆ
 */
function firstImageFromHtml(html: string): string {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  const src = m?.[1]?.trim() ?? ''
  return /^(https?:\/\/|data:image\/)/i.test(src) ? src : ''
}

function MetaLengthBar({ len, min, max }: { len: number; min: number; max: number }) {
  const color = len === 0 ? 'bg-gray-200' : len < min ? 'bg-amber-400' : len <= max ? 'bg-emerald-500' : 'bg-rose-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden mt-1.5">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(2, Math.min(100, (len / max) * 100))}%` }} />
    </div>
  )
}

/** ตัวอย่างผลการค้นหา Google (แบบปลั๊กอิน Yoast) — Mobile / Desktop */
function GoogleSerpPreview({ device, siteHost, siteName, slug, title, description, thumbnail, dateLabel }: {
  device: 'mobile' | 'desktop'
  siteHost: string
  siteName: string
  slug: string
  title: string
  description: string
  thumbnail: string
  dateLabel: string
}) {
  const isMobile = device === 'mobile'
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-3 shadow-sm ${isMobile ? 'max-w-[400px]' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
          {(siteName || siteHost || '?').trim().slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-gray-800 leading-tight truncate">{siteName || siteHost || 'เว็บไซต์ลูกค้า'}</p>
          <p className="text-[10px] text-gray-500 leading-tight truncate">
            {siteHost || 'example.com'}{slug ? ` › ${slug}` : ''}
          </p>
        </div>
      </div>
      {/* หัวข้อกินเต็มความกว้างเหมือนผลจริงบน Google — รูปอยู่ข้างคำอธิบายเท่านั้น */}
      <p className={`${isMobile ? 'text-[16px]' : 'text-[19px]'} text-[#1a0dab] leading-snug line-clamp-2`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        {title || 'ยังไม่มี SEO title'}
      </p>
      <div className="flex gap-3 mt-1.5">
        <p className="text-[12px] text-gray-600 leading-snug line-clamp-3 flex-1 min-w-0">
          <span className="text-gray-400">{dateLabel} — </span>
          {description || 'ยังไม่มี meta description — Google จะเลือกข้อความจากบทความมาแสดงเอง'}
        </p>
        {thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="w-[104px] h-[104px] rounded-lg object-contain bg-gray-50 border border-gray-200 shrink-0" />
        )}
      </div>
    </div>
  )
}

/** เพดานขนาด body ของ PATCH (Vercel ตัดที่ ~4.5MB) — เกินแล้วเซิร์ฟเวอร์ตอบ 413 เงียบ ๆ */
const MAX_PATCH_BYTES = 4_000_000
/** true = body ใหญ่เกิน ได้ toast เตือนแล้ว (ใช้หน้า SME Review ก่อน PATCH ทุกครั้ง) */
function patchTooBig(body: unknown): boolean {
  if (new Blob([JSON.stringify(body)]).size <= MAX_PATCH_BYTES) return false
  toast.error('ข้อมูลใหญ่เกิน 4MB — รูปอาจใหญ่ไป ลองย่อขนาดก่อนบันทึก')
  return true
}

interface ReviewComment { id: string; body: string; createdAt: string; user: { name: string | null; role: string } }

// สถานะในรายการ Review — แยกกันไม่ทับซ้อน ตรงกับป้ายในแถว
type ReviewListStatus = 'pending' | 'comments' | 'approved'
const REVIEW_LIST_STATUS_OPTIONS: { value: ReviewListStatus; label: string }[] = [
  { value: 'pending', label: 'รอ Review' },
  { value: 'comments', label: 'มี Comment' },
  { value: 'approved', label: 'Approved' },
]

export function SmeReviewTab({ project, timeline, setTimeline, jobs, setJobs, onAdjustRewrite, isClient = false }: {
  project: ProjectData
  timeline: TimelineEntry[]
  setTimeline: React.Dispatch<React.SetStateAction<TimelineEntry[]>>
  jobs: ArticleJob[]
  setJobs: React.Dispatch<React.SetStateAction<ArticleJob[]>>
  onAdjustRewrite: (entryIdx: number, note: string) => void
  /** โหมดลูกค้า: ดู + คอมเมนต์ + Approve เท่านั้น เครื่องมือของทีมถูกซ่อนทั้งหมด */
  isClient?: boolean
}) {
  const articleLook = useProjectArticleLook(project)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [loadingHtml, setLoadingHtml] = useState<number | null>(null)
  const [localJobHtml, setLocalJobHtml] = useState<Record<number, string>>({})
  // articleId cache: title → DB article id
  const [articleIds, setArticleIds] = useState<Record<number, string>>({})
  // comments per entryIdx loaded from DB
  const [comments, setComments] = useState<Record<number, ReviewComment[]>>({})
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({})
  const [savingComment, setSavingComment] = useState<Record<number, boolean>>({})
  const [rewriting, setRewriting] = useState<Record<number, boolean>>({})
  const [approving, setApproving] = useState<Record<number, boolean>>({})
  // โหมดดูบทความ: preview = หน้าตาจริง / text = อ่านเป็นตัวหนังสือ / edit = ลูกค้าแก้ข้อความตรงบนบทความ
  const [viewMode, setViewMode] = useState<'preview' | 'text' | 'edit'>('preview')
  const [editSaving, setEditSaving] = useState(false)
  const reviewEditorRef = useRef<HTMLDivElement>(null)
  // สีตอนแก้ไข (เฉพาะทีมงาน) — site = พื้นหลังหน้าเว็บของโปรเจกต์, readable = ตัวอักษรเข้มบนพื้นขาว · อยู่นอก editor ไม่ถูกบันทึก
  const [editTone, setEditTone] = useState<'site' | 'readable'>('site')
  // แทรกรูปหลัง H2 (เฉพาะทีมงาน)
  const [insertFile, setInsertFile] = useState<File | null>(null)
  const [insertAlt, setInsertAlt] = useState('')
  const [insertPos, setInsertPos] = useState<number | ''>('')
  const [inserting, setInserting] = useState(false)
  // ให้ Mars เสนอ Meta + Slug — เก็บ entryIdx ที่กำลังเรียก
  const [aiMetaBusy, setAiMetaBusy] = useState<number | null>(null)
  // insertPos เป็น offset ของ HTML ก้อนปัจจุบัน — HTML ถูกแทนที่ (บันทึก/แก้ alt/สลับบทความ) ต้องเคลียร์ทิ้ง ไม่งั้น offset เพี้ยน
  const expandedHtmlKey = expanded !== null ? (localJobHtml[expanded] ?? '') : ''
  useEffect(() => { setInsertPos('') }, [expanded, expandedHtmlKey])
  // ดาวน์โหลดบทความไปส่งลูกค้าตรวจ (Word / HTML) — เก็บ entryIdx ที่กำลังสร้างไฟล์ Word
  const [wordBusy, setWordBusy] = useState<number | null>(null)
  const [docsBusy, setDocsBusy] = useState<number | null>(null)
  function exportSource(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    // โหมดแก้ไข: ใช้เนื้อหาที่ยังไม่ได้บันทึกด้วย
    const src = viewMode === 'edit' && reviewEditorRef.current ? reviewEditorRef.current.innerHTML : html
    const coverSrc = job?.coverImage
      ? `data:${job.coverMimeType || 'image/webp'};base64,${job.coverImage}`
      : coverUrl[entryIdx]
    return {
      html: src,
      title: entry.title,
      coverSrc: coverSrc || undefined,
      coverAlt: entry.title,
    }
  }
  /** สร้างเอกสาร HTML เดี่ยว (CSS/ฟอนต์เดียวกับปุ่มดาวน์โหลด HTML) — ใช้ทั้งดาวน์โหลดและเปิดในแท็บใหม่ */
  async function buildHtmlBlob(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    const m = await import('@/lib/article-export')
    const o = exportSource(entryIdx, entry, job, html)
    const fileBase = m.articleFileName(entry.slug || entry.title)
    const { css: fontCss, skipped: fontsSkipped } = isClient ? { css: '', skipped: 0 } : await exportFontCssDetailed(articleLook.detail?.article)
    if (fontsSkipped > 0) toast.warning(`ไฟล์นี้ขาดฟอนต์ ${fontsSkipped} ไฟล์ เพราะดึงจากเว็บไม่ได้หรือไฟล์ใหญ่เกิน บทความบนเว็บจริงไม่กระทบ`)
    const doc = m.buildStandaloneArticleHtml({
      html: applyFaqDisplay(o.html, articleLook.detail?.faq), title: o.title, lang: project.language === 'en' ? 'en' : 'th',
      coverSrc: o.coverSrc, coverAlt: o.coverAlt, pageBackground: articleLook.pageBackground, fontCss,
    })
    return { m, blob: new Blob([doc], { type: 'text/html;charset=utf-8' }), name: `${fileBase}.html` }
  }
  async function downloadArticleHtml(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    try {
      const r = await buildHtmlBlob(entryIdx, entry, job, html)
      r.m.downloadBlob(r.blob, r.name)
    } catch (e) {
      toast.error('สร้างไฟล์ HTML ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  // เปิดดู HTML ในแท็บใหม่ (เฉพาะทีมงาน) — window.open ต้องเรียกตอนคลิก ก่อน await ไม่งั้นเบราว์เซอร์บล็อก popup
  async function openHtmlPreview(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    const tab = window.open('', '_blank')
    try {
      const r = await buildHtmlBlob(entryIdx, entry, job, html)
      if (!r.m.showBlobInTab(tab, r.blob)) {
        r.m.downloadBlob(r.blob, r.name)
        toast.info('เบราว์เซอร์บล็อกแท็บใหม่ — ดาวน์โหลดไฟล์ HTML ให้แทน')
      }
    } catch (e) {
      tab?.close()
      toast.error('เปิด HTML ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  async function downloadArticleWord(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    setWordBusy(entryIdx)
    try {
      const m = await import('@/lib/article-export')
      const o = exportSource(entryIdx, entry, job, html)
      const fileBase = m.articleFileName(entry.slug || entry.title)
      const blob = await m.buildArticleDocx({ html: o.html, title: o.title, coverSrc: o.coverSrc, coverAlt: o.coverAlt })
      m.downloadBlob(blob, `${fileBase}.docx`)
    } catch (e) {
      toast.error('สร้างไฟล์ Word ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setWordBusy(null)
    }
  }
  // ห้าม await ก่อน sendToGoogleDocs — popup ขอสิทธิ์ Google / แท็บใหม่ต้องเปิดในจังหวะคลิก
  async function exportArticleGoogleDocs(entryIdx: number, entry: TimelineEntry, job: ArticleJob | undefined, html: string) {
    const o = exportSource(entryIdx, entry, job, html)
    setDocsBusy(entryIdx)
    try {
      const r = await sendToGoogleDocs(o, async () => {
        const m = await import('@/lib/article-export')
        return m.buildArticleDocx({ html: o.html, title: o.title, coverSrc: o.coverSrc, coverAlt: o.coverAlt })
      })
      const n = googleDocsResultNotice(r)
      const action = n.action
      toast.success(n.message, action ? { duration: 15000, action: { label: action.label, onClick: () => window.open(action.url, '_blank', 'noopener') } } : undefined)
    } catch (e) {
      toast.error('ส่งไป Google Docs ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDocsBusy(null)
    }
  }
  // ── แผง Search appearance (ขวา): meta title / slug / meta description + ภาพปก ──
  const [seoDraft, setSeoDraft] = useState<Record<number, { seoTitle: string; metaDescription: string; slug: string }>>({})
  const [seoSaving, setSeoSaving] = useState<number | null>(null)
  const [seoSavedAt, setSeoSavedAt] = useState<Record<number, number>>({})
  const [serpDevice, setSerpDevice] = useState<'mobile' | 'desktop'>('mobile')
  const [coverBusy, setCoverBusy] = useState<number | null>(null)
  // ภาพปกที่บันทึกไว้ใน DB (Article.coverImageUrl) — ใช้ตอนเซสชันใหม่ที่ยังไม่มีรูปใน jobs
  const [coverUrl, setCoverUrl] = useState<Record<number, string>>({})
  // alt ของภาพปก (เก็บใน META block ของบทความ) + สถานะบทความใน DB (WRITING = ล็อกแผงสร้างรูป)
  const [coverAlt, setCoverAlt] = useState<Record<number, string>>({})
  const [articleStatus, setArticleStatus] = useState<Record<number, string>>({})
  // บทความที่แผงสร้างรูปกำลังทำงาน — ล็อกปุ่มแก้ไข/บันทึก SEO/ปก ไม่ให้เขียน HTML ทับกันระหว่างรอรูป
  const [imgBusy, setImgBusy] = useState<number | null>(null)
  // alt ตอนเริ่มพิมพ์ — บันทึกเฉพาะเมื่อค่าเปลี่ยนจริง
  const altAtFocus = useRef<string>('')

  const siteHost = (project.website ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const siteName = project.clientName || project.name || siteHost

  const reviewEntries: { entryIdx: number; entry: TimelineEntry; job: ArticleJob | undefined }[] = []
  timeline.forEach((entry, entryIdx) => {
    const job = jobs.find(j => j.entryIdx === entryIdx)
    const inReview = job?.status === 'review' || job?.status === 'approved' || entry.articleStatus === 'review' || entry.articleStatus === 'approved'
    if (inReview) reviewEntries.push({ entryIdx, entry, job })
  })

  async function fetchArticle(entryIdx: number, entry: TimelineEntry): Promise<{
    id: string; htmlContent: string; comments: ReviewComment[]
    seoTitle?: string | null; metaDescription?: string | null; slug?: string | null
    coverImageUrl?: string | null; status?: string
  } | null> {
    try {
      const base = `/api/articles/by-title?projectId=${encodeURIComponent(project.id)}`
      // รู้ id แถวแล้ว (เปิดครั้งก่อน/เพิ่งเขียน) ใช้ id ก่อน — ชื่อซ้ำกันหลายแถวจะไม่เปิดผิดแถว · ไม่เจอค่อยหาตามชื่อ
      const knownId = articleIds[entryIdx] || jobs.find(j => j.entryIdx === entryIdx)?.articleId
      if (knownId) {
        const byId = await fetch(`${base}&id=${encodeURIComponent(knownId)}`)
        if (byId.ok) return await byId.json()
      }
      const res = await fetch(`${base}&title=${encodeURIComponent(entry.title)}`)
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  async function expand(entryIdx: number, entry: TimelineEntry) {
    // รายการซ้ายเป็นตัวเลือก ไม่ใช่ปุ่มพับ — กดบทความที่เปิดอยู่ซ้ำไม่ต้องทำอะไร
    if (expanded === entryIdx) return
    setLoadingHtml(entryIdx)
    try {
      const data = await fetchArticle(entryIdx, entry)
      if (data) {
        if (data.id) setArticleIds(prev => ({ ...prev, [entryIdx]: data.id }))
        if (data.htmlContent) setLocalJobHtml(prev => ({ ...prev, [entryIdx]: data.htmlContent }))
        if (data.comments) setComments(prev => ({ ...prev, [entryIdx]: data.comments }))
        if (data.coverImageUrl) setCoverUrl(prev => ({ ...prev, [entryIdx]: data.coverImageUrl! }))
        if (data.status) setArticleStatus(prev => ({ ...prev, [entryIdx]: data.status! }))
        setCoverAlt(prev => ({ ...prev, [entryIdx]: getCoverAltFromHtml(data.htmlContent || '') || entry.title }))
        // เติมค่า SEO เริ่มต้น: DB ก่อน → ตกมาที่ meta block ในบทความ → ตกมาที่ title/slug ของ entry
        const htmlNow = data.htmlContent || jobs.find(j => j.entryIdx === entryIdx)?.html || ''
        const fromHtml = readSeoMetaFromHtml(htmlNow)
        setSeoDraft(prev => prev[entryIdx] ? prev : ({
          ...prev,
          [entryIdx]: {
            seoTitle: entry.reviewSeoTitle || data.seoTitle || fromHtml.metaTitle || entry.title || '',
            metaDescription: entry.reviewMetaDescription || data.metaDescription || fromHtml.metaDescription || '',
            slug: entry.slug || data.slug || fromHtml.enSlug || '',
          },
        }))
      }
    } finally {
      setLoadingHtml(null)
      setViewMode('preview')
      setInsertFile(null); setInsertAlt(''); setInsertPos('')
      setExpanded(entryIdx)
    }
  }

  /** save ที่ลูกค้าแก้ (contentEditable) กลับเข้า DB — innerHTML คือ HTML โครงเดิมครบ */
  async function saveEditedHtml(entryIdx: number, entry: TimelineEntry) {
    const el = reviewEditorRef.current
    if (!el) return
    const newHtml = el.innerHTML
    setEditSaving(true)
    try {
      let artId = articleIds[entryIdx]
      if (!artId) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) { artId = data.id; setArticleIds(prev => ({ ...prev, [entryIdx]: data.id })) }
      }
      if (!artId) { toast.error('ยังไม่พบบทความนี้ใน DB — ลองกดดูใหม่อีกครั้ง'); return }
      const patchBody = { htmlContent: newHtml }
      if (patchTooBig(patchBody)) return
      const r = await fetch(`/api/articles/${artId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string }
        toast.error(err?.error || 'บันทึกไม่สำเร็จ — ลองอีกครั้ง')
        return
      }
      setLocalJobHtml(prev => ({ ...prev, [entryIdx]: newHtml }))
      setViewMode('preview')
    } finally {
      setEditSaving(false)
    }
  }

  const htmlOf = (entryIdx: number) =>
    localJobHtml[entryIdx] || jobs.find(j => j.entryIdx === entryIdx)?.html || ''

  /**
   * บันทึก meta title / meta description / slug ที่แก้ในแผงขวา
   *
   * กติกา: "แก้ที่หน้า Review แล้ว Push ต้องได้ของที่แก้เสมอ"
   * เขียนครบ 4 ที่ ที่ปลายทาง Push อ่าน:
   *   1. timeline entry (reviewSeoTitle/reviewMetaDescription/slug) → PushTab ส่งไปเป็น
   *      override ที่ /api/push/publish ใช้ก่อนทุกแหล่ง · ไม่มี job อื่นเขียนทับที่นี่
   *   2. Article ใน DB      → dbSeoTitle / dbMetaDescription / dbSlug
   *   3. meta block ในบทความ → meta_title ตอนขึ้น Yoast
   *   4. jobs ในเซสชัน      → html + slug ที่ Push หยิบไปใช้ทันที
   * ถ้ายังไม่เคยแก้ที่หน้านี้ → ไม่มี override, Push ใช้ค่าเดิมตามลำดับเดิมทุกอย่าง
   */
  async function saveSeo(entryIdx: number, entry: TimelineEntry) {
    const draft = seoDraft[entryIdx]
    if (!draft) return
    setSeoSaving(entryIdx)
    try {
      let artId = articleIds[entryIdx]
      if (!artId) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) { artId = data.id; setArticleIds(prev => ({ ...prev, [entryIdx]: data.id })) }
      }
      if (!artId) { toast.error('ยังไม่พบบทความนี้ใน DB — ลองกด "ดู" ใหม่อีกครั้ง'); return }

      const draftSlug = slugifyEnSlug(draft.slug)
      const draftTitle = draft.seoTitle.trim()
      const draftMeta = draft.metaDescription.trim()
      const baseHtml = htmlOf(entryIdx)
      const draftHtml = baseHtml ? syncSeoMetaIntoHtml(baseHtml, { metaTitle: draftTitle, metaDescription: draftMeta, slug: draftSlug }) : ''
      const sentHtml = Boolean(draftHtml && draftHtml !== baseHtml)

      const seoBody = {
        seoTitle: draftTitle, metaDescription: draftMeta,
        ...(draftSlug ? { slug: draftSlug } : {}),
        ...(sentHtml ? { htmlContent: draftHtml } : {}),
      }
      if (patchTooBig(seoBody)) return
      const res = await fetch(`/api/articles/${artId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seoBody),
      })
      if (!res.ok) { toast.error('บันทึก SEO ไม่สำเร็จ — ลองอีกครั้ง'); return }
      // server แทนคำต้องห้ามของ Content Engine ให้แล้ว — ใช้ค่าที่บันทึกจริงต่อ (timeline override/Push ต้องตรงกับ DB)
      const saved = await res.json().catch(() => ({})) as { seoTitle?: string | null; metaDescription?: string | null; slug?: string | null; htmlContent?: string | null; restrictionWarnings?: string[] }
      const seoTitle = typeof saved.seoTitle === 'string' ? saved.seoTitle : draftTitle
      const metaDescription = typeof saved.metaDescription === 'string' ? saved.metaDescription : draftMeta
      const cleanSlug = draftSlug && typeof saved.slug === 'string' && saved.slug ? saved.slug : draftSlug
      const nextHtml = sentHtml && typeof saved.htmlContent === 'string' && saved.htmlContent ? saved.htmlContent : draftHtml
      if (seoTitle !== draftTitle || metaDescription !== draftMeta || cleanSlug !== draftSlug) {
        toast.info('แทนคำต้องห้ามตามข้อจำกัดของ Content Engine ให้แล้ว')
      }
      if (Array.isArray(saved.restrictionWarnings) && saved.restrictionWarnings.length) {
        toast.warning(saved.restrictionWarnings.join(' · '))
      }

      if (nextHtml && nextHtml !== baseHtml) {
        setLocalJobHtml(prev => ({ ...prev, [entryIdx]: nextHtml }))
        setJobs(prev => prev.map(j => j.entryIdx === entryIdx ? { ...j, html: nextHtml } : j))
      }
      setSeoDraft(prev => ({ ...prev, [entryIdx]: { seoTitle, metaDescription, slug: cleanSlug } }))
      // override ที่ Push ใช้ก่อนทุกแหล่ง (timeline auto-save ลง DB ให้เอง)
      setTimeline(prev => prev.map((e, i) => i === entryIdx ? {
        ...e,
        ...(cleanSlug ? { slug: cleanSlug } : {}),
        reviewSeoTitle: seoTitle,
        reviewMetaDescription: metaDescription,
        reviewMetaEditedAt: new Date().toISOString(),
      } : e))
      if (cleanSlug) setJobs(prev => prev.map(j => j.entryIdx === entryIdx ? { ...j, slug: cleanSlug } : j))
      setSeoSavedAt(prev => ({ ...prev, [entryIdx]: Date.now() }))
    } catch {
      toast.error('บันทึก SEO ไม่สำเร็จ — ลองอีกครั้ง')
    } finally {
      setSeoSaving(null)
    }
  }

  /**
   * เอาบทความที่ server ส่งกลับ (หลังสร้าง/ลบรูป/แก้ปก) ไปใส่ทุก state ที่หน้า Review ใช้แสดง/export/push
   * — localJobHtml (HTML ที่เห็น), coverUrl + jobs[].coverImage (ปกที่ชนะทุกที่), coverAlt
   */
  function applyArticleUpdate(entryIdx: number, entry: TimelineEntry, a: SmeArticleUpdate) {
    if (a.id) setArticleIds(prev => ({ ...prev, [entryIdx]: a.id }))
    if (a.status) setArticleStatus(prev => ({ ...prev, [entryIdx]: a.status! }))
    const nextHtml = typeof a.htmlContent === 'string' ? a.htmlContent : ''
    if (nextHtml) setLocalJobHtml(prev => ({ ...prev, [entryIdx]: nextHtml }))
    const cover = a.coverImageUrl || ''
    setCoverUrl(prev => {
      const n = { ...prev }
      if (cover) n[entryIdx] = cover; else delete n[entryIdx]
      return n
    })
    // job.coverImage ชนะ coverUrl เสมอ → ต้องตั้งให้ตรงกับปกใหม่ (https = เคลียร์ให้ coverUrl ชนะ)
    const m = /^data:([^;]+);base64,(.*)$/.exec(cover)
    const coverImage = m ? m[2] : ''
    const coverMimeType = m ? m[1] : 'image/webp'
    setJobs(prev => {
      if (prev.some(j => j.entryIdx === entryIdx)) {
        return prev.map(j => j.entryIdx === entryIdx
          ? { ...j, ...(nextHtml ? { html: nextHtml } : {}), coverImage, coverMimeType }
          : j)
      }
      return [...prev, {
        entryIdx, date: entry.date, keyword: entry.keyword, title: entry.title,
        status: 'review' as const, html: nextHtml || htmlOf(entryIdx),
        coverImage, coverMimeType,
        midImage: '', midMimeType: 'image/webp', error: '',
        slug: entry.slug, articleId: a.id,
      }]
    })
    setCoverAlt(prev => ({ ...prev, [entryIdx]: getCoverAltFromHtml(nextHtml) || a.coverAlt || prev[entryIdx] || entry.title }))
  }

  /** PATCH ปก/alt ของบทความ แล้วอัปเดตทุก state — คืน true เมื่อสำเร็จ */
  async function patchCover(entryIdx: number, entry: TimelineEntry, body: { coverImageUrl?: string | null; coverAlt?: string }): Promise<boolean> {
    const artId = articleIds[entryIdx]
    if (!artId) { toast.error('ยังไม่พบบทความนี้ใน DB — ลองกดดูใหม่อีกครั้ง'); return false }
    if (patchTooBig(body)) return false
    setCoverBusy(entryIdx)
    try {
      const r = await fetch(`/api/articles/${artId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'บันทึกภาพปกไม่สำเร็จ'); return false }
      applyArticleUpdate(entryIdx, entry, {
        id: artId,
        htmlContent: typeof d.htmlContent === 'string' ? d.htmlContent : '',
        coverImageUrl: 'coverImageUrl' in d ? (d.coverImageUrl ?? null) : (body.coverImageUrl !== undefined ? body.coverImageUrl : (coverUrl[entryIdx] ?? null)),
        coverAlt: body.coverAlt,
      })
      return true
    } catch {
      toast.error('บันทึกภาพปกไม่สำเร็จ')
      return false
    } finally {
      setCoverBusy(null)
    }
  }

  /**
   * PATCH งานแก้รูปในเนื้อหา (alt / ลิงก์ / แทรกรูป) แล้วอัปเดต state เหมือนบันทึก SEO — คืน true เมื่อสำเร็จ
   * server คำนวณ htmlContent ใหม่และแทนคำต้องห้ามของ CE เหมือนแก้มือ → ใช้ HTML ที่ server ส่งกลับ
   */
  async function patchContentHtml(entryIdx: number, body: Record<string, unknown>, fallbackHtml?: string): Promise<boolean> {
    const artId = articleIds[entryIdx]
    if (!artId) { toast.error('ยังไม่พบบทความนี้ใน DB — ลองกดดูใหม่อีกครั้ง'); return false }
    if (patchTooBig(body)) return false
    try {
      const r = await fetch(`/api/articles/${artId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({})) as { error?: string; htmlContent?: string | null; restrictionWarnings?: string[] }
      if (!r.ok) { toast.error(d?.error || 'บันทึกไม่สำเร็จ — ลองอีกครั้ง'); return false }
      const nextHtml = typeof d.htmlContent === 'string' && d.htmlContent ? d.htmlContent : (fallbackHtml ?? '')
      if (nextHtml) {
        setLocalJobHtml(prev => ({ ...prev, [entryIdx]: nextHtml }))
        setJobs(prev => prev.map(j => j.entryIdx === entryIdx ? { ...j, html: nextHtml } : j))
      }
      if (Array.isArray(d.restrictionWarnings) && d.restrictionWarnings.length) toast.warning(d.restrictionWarnings.join(' · '))
      return true
    } catch {
      toast.error('บันทึกไม่สำเร็จ — ลองอีกครั้ง')
      return false
    }
  }

  /** แทรก <figure> หลังหัวข้อ H2 ที่เลือก — ติดป้าย data-mars-manual กันถูกลบตอนสร้างรูปประกอบใหม่ แล้วบันทึกทางเดียวกับการแก้ htmlContent */
  async function insertImageAfterH2(entryIdx: number, entry: TimelineEntry) {
    if (!insertFile || insertPos === '') return
    const baseHtml = htmlOf(entryIdx)
    if (!baseHtml) return
    setInserting(true)
    try {
      const dataUrl = await fileToDownscaledDataUrl(insertFile, 1600)
      const altText = (insertAlt || entry.title).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const figureHtml = `<figure class="content-figure" ${MANUAL_FIGURE_ATTR}="1"><img src="${dataUrl}" alt="${altText}"></figure>`
      const newHtml = insertFigureAfterH2(baseHtml, insertPos, figureHtml)
      if (newHtml === baseHtml) { toast.error('แทรกรูปไม่สำเร็จ — ไม่พบหัวข้อ H2 ที่เลือก'); return }
      if (await patchContentHtml(entryIdx, { htmlContent: newHtml }, newHtml)) {
        toast.success('แทรกรูปในเนื้อหาแล้ว')
        setInsertFile(null); setInsertAlt(''); setInsertPos('')
      }
    } catch {
      toast.error('แทรกรูปไม่สำเร็จ')
    } finally {
      setInserting(false)
    }
  }

  /** ให้ Mars เสนอ Meta Title / Description / Slug — เสนออย่างเดียว ไม่เขียนลง DB ผู้ใช้ต้องกด "บันทึก SEO" เอง */
  async function suggestMeta(entryIdx: number) {
    const artId = articleIds[entryIdx]
    if (!artId) { toast.error('ยังไม่พบบทความนี้ใน DB — ลองกดดูใหม่อีกครั้ง'); return }
    setAiMetaBusy(entryIdx)
    try {
      const r = await fetch(`/api/articles/${artId}/meta-suggest`, { method: 'POST' })
      const d = await r.json().catch(() => ({})) as { error?: string; seoTitle?: string; metaDescription?: string; slug?: string; costUsd?: number; warning?: string }
      if (!r.ok) { toast.error(d?.error || 'Mars เขียน Meta ไม่สำเร็จ'); return }
      setSeoDraft(prev => {
        const cur = prev[entryIdx] ?? { seoTitle: '', metaDescription: '', slug: '' }
        return { ...prev, [entryIdx]: {
          seoTitle: d.seoTitle ?? cur.seoTitle,
          metaDescription: d.metaDescription ?? cur.metaDescription,
          slug: d.slug || cur.slug,
        } }
      })
      if (d.warning) toast.warning(d.warning)
      toast.success(`Mars เขียน Meta แล้ว — ตรวจแล้วกด "บันทึก SEO"${typeof d.costUsd === 'number' ? ` (ต้นทุน $${d.costUsd.toFixed(4)})` : ''}`)
    } catch (e) {
      toast.error(`Mars เขียน Meta ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAiMetaBusy(null)
    }
  }

  async function uploadCoverFile(entryIdx: number, entry: TimelineEntry, file: File) {
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, 1600)
      const ok = await patchCover(entryIdx, entry, { coverImageUrl: dataUrl, coverAlt: coverAlt[entryIdx] || entry.title })
      if (ok) toast.success('อัปโหลดภาพปกแล้ว')
    } catch {
      toast.error('อัปโหลดภาพปกไม่สำเร็จ')
    }
  }

  /** ดึงเนื้อหาเป็นตัวหนังสือล้วน (ตัด schema/style/แท็ก) ไว้โหมด Text */
  function htmlToPlainText(raw: string): string {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/(h1|h2|h3|h4|p|li|tr|div|summary|figcaption)>/gi, '\n')
      .replace(/<(br|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Approve = ต้องลง DB สำเร็จก่อนถึงจะเปลี่ยนสถานะบนหน้าจอ
   * เดิมอัปเดตหน้าจอทันทีแล้ว catch เงียบ ๆ ผู้ใช้จึงเห็น "Approved" ทั้งที่ DB ยังเป็น REVIEW
   * และพอโหลดใหม่ก็กลับไปเป็นรอ Review เหมือนเดิม
   */
  async function approve(entryIdx: number) {
    if (approving[entryIdx]) return
    const entry = timeline[entryIdx]
    setApproving(prev => ({ ...prev, [entryIdx]: true }))
    try {
      let artId = articleIds[entryIdx]
      if (!artId && entry) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) { artId = data.id; setArticleIds(prev => ({ ...prev, [entryIdx]: data.id })) }
      }
      if (!artId) {
        toast.error('ไม่พบบทความนี้ใน DB — Approve ไม่สำเร็จ (ต้องเขียนบทความให้เสร็จก่อน)')
        return
      }
      const res = isClient
        ? await fetch(`/api/articles/${artId}/client-review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', comment: (commentDraft[entryIdx] ?? '').trim() || undefined }),
          })
        : await fetch(`/api/articles/${artId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'APPROVED' }),
          })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (isClient) setCommentDraft(prev => ({ ...prev, [entryIdx]: '' }))
      // timeline เป็น updater form — ไม่ทับสถานะบทความอื่นที่เปลี่ยนระหว่างรอ PATCH
      setTimeline(prev => prev.map((e, i) => i === entryIdx ? { ...e, articleStatus: 'approved' as const } : e))
      toast.success('Approve แล้ว — บันทึกลงฐานข้อมูลเรียบร้อย')
    } catch (e) {
      toast.error(`Approve ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)} — สถานะยังเป็นรอ Review`)
    } finally {
      setApproving(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
    }
  }

  /** ลูกค้าขอแก้ไข: บันทึก comment + ตั้งสถานะ CLIENT_REVISION ให้ทีมเห็นว่าต้องแก้ */
  async function requestRevision(entryIdx: number, entry: TimelineEntry) {
    const body = (commentDraft[entryIdx] ?? '').trim()
    if (!body || savingComment[entryIdx]) return
    setSavingComment(prev => ({ ...prev, [entryIdx]: true }))
    try {
      let artId = articleIds[entryIdx]
      if (!artId) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) { artId = data.id; setArticleIds(prev => ({ ...prev, [entryIdx]: data.id })) }
      }
      if (!artId) { toast.error('ไม่พบบทความนี้ใน DB — ส่งคำขอแก้ไขไม่สำเร็จ'); return }
      const res = await fetch(`/api/articles/${artId}/client-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revision', comment: body }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const fresh = await fetchArticle(entryIdx, entry)
      if (fresh?.comments) setComments(prev => ({ ...prev, [entryIdx]: fresh.comments }))
      setCommentDraft(prev => ({ ...prev, [entryIdx]: '' }))
      toast.success('ส่งคำขอแก้ไขให้ทีมงานแล้ว')
    } catch (e) {
      toast.error(`ส่งคำขอแก้ไขไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingComment(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
    }
  }

  async function saveComment(entryIdx: number, entry: TimelineEntry) {
    const body = (commentDraft[entryIdx] ?? '').trim()
    if (!body) return
    setSavingComment(prev => ({ ...prev, [entryIdx]: true }))
    try {
      // ensure we have articleId — fetch from DB if not cached
      let artId = articleIds[entryIdx]
      if (!artId) {
        const data = await fetchArticle(entryIdx, entry)
        if (data?.id) {
          artId = data.id
          setArticleIds(prev => ({ ...prev, [entryIdx]: data.id }))
        }
        if (data?.comments) setComments(prev => ({ ...prev, [entryIdx]: data.comments }))
      }
      if (!artId) {
        toast.error('ไม่พบบทความใน DB — กรุณาสร้างบทความก่อนส่ง Comment')
        return
      }
      const res = await fetch(`/api/articles/${artId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const newComment = await res.json()
        setComments(prev => ({ ...prev, [entryIdx]: [...(prev[entryIdx] ?? []), newComment] }))
        setCommentDraft(prev => ({ ...prev, [entryIdx]: '' }))
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(`บันทึก Comment ไม่สำเร็จ: ${err?.error ?? res.status}`)
      }
    } catch (e) {
      toast.error(`เกิดข้อผิดพลาด: ${String(e)}`)
    } finally {
      setSavingComment(prev => ({ ...prev, [entryIdx]: false }))
    }
  }

  async function rewriteWithComments(entryIdx: number, entry: TimelineEntry) {
    const allComments = comments[entryIdx] ?? []
    if (!allComments.length && !(commentDraft[entryIdx] ?? '').trim()) return
    // Save draft comment first if any
    const draft = (commentDraft[entryIdx] ?? '').trim()
    if (draft) await saveComment(entryIdx, entry)
    // รวม comment ทั้งหมด + ที่เพิ่งพิมพ์ (state comments ในฟังก์ชันนี้ยังเป็นค่าก่อนบันทึก)
    const bodies = [...allComments.map(c => c.body), ...(draft ? [draft] : [])]
    const note = bodies.map((body, i) => `[Comment ${i + 1}] ${body}`).join('\n')
    setRewriting(prev => ({ ...prev, [entryIdx]: true }))
    setExpanded(null)
    setLocalJobHtml(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
    onAdjustRewrite(entryIdx, note)
    setTimeout(() => setRewriting(prev => ({ ...prev, [entryIdx]: false })), 3000)
  }

  /**
   * Re-generate แบบ Upload — SME ไม่มีไฟล์ต้นฉบับ จึงให้ AI เขียนใหม่ทั้งบทความจาก keyword/title เดิม (writer ตัวเดียวกับแท็บ Article)
   * เขียนเสร็จ = กลับมารอ Review ใหม่ · บทความบนเว็บไม่เปลี่ยนจนกว่าจะ Re-push
   */
  function regenerateArticle(entryIdx: number) {
    const pushed = ['POSTED', 'WORDPRESS_DRAFTED', 'PUBLISHED'].includes(articleStatus[entryIdx] ?? '')
    const msg = [
      'Generate บทความนี้ใหม่ทั้งบทความ?',
      'AI เขียนใหม่จาก keyword/title เดิม ใช้เวลาหลายนาที (มีค่า AI)',
      'ที่แก้มือ + รูปปก/รูปประกอบเดิมจะถูกแทนด้วยของที่เขียนใหม่',
      pushed ? 'บทความบนเว็บยังเป็นเวอร์ชันเดิมจนกว่าจะ Approve แล้วกด Re-push ที่หน้า Push' : '',
    ].filter(Boolean).join('\n')
    if (!confirm(msg)) return
    setExpanded(null)
    setViewMode('preview')
    // HTML ที่โหลดไว้เป็นของเก่า — ล้างทิ้ง ให้หน้า Review แสดงบทความใหม่ทันทีที่เขียนเสร็จ
    setLocalJobHtml(prev => { const n = { ...prev }; delete n[entryIdx]; return n })
    onAdjustRewrite(entryIdx, '')
  }

  // filter รายการซ้ายตามสถานะ (ตรงกับป้ายในแถว) — '' = ทุกสถานะ
  const [statusFilter, setStatusFilter] = useState<'' | ReviewListStatus>('')

  // เปิดแท็บมา = เลือกบทความแรกที่ยังรอ Review ให้เลย (เหมือน Upload Review) — ครั้งเดียวต่อการเปิดแท็บ
  const autoPicked = useRef(false)
  useEffect(() => {
    if (autoPicked.current || expanded !== null || !reviewEntries.length) return
    autoPicked.current = true
    const first = reviewEntries.find(({ entry, job }) => !(entry.articleStatus === 'approved' || job?.status === 'approved')) ?? reviewEntries[0]
    void expand(first.entryIdx, first.entry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewEntries.length])

  if (!reviewEntries.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
        <CheckCircle2 size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 text-sm font-medium">ยังไม่มีบทความรอ Review</p>
        <p className="text-gray-400 text-xs mt-1">เมื่อเขียนบทความเสร็จจากหน้า Articles บทความจะมาปรากฏที่นี่</p>
      </div>
    )
  }

  const pendingCount  = reviewEntries.filter(({ entry, job }) => !(entry.articleStatus === 'approved' || job?.status === 'approved')).length
  const approvedCount = reviewEntries.length - pendingCount

  const reviewItems = reviewEntries.map(({ entryIdx, entry, job }) => {
    const isApproved = entry.articleStatus === 'approved' || job?.status === 'approved'
    const html = localJobHtml[entryIdx] || job?.html || ''
    const entryComments = comments[entryIdx] ?? []
    const hasComments = entryComments.length > 0
    // writer/push กำลังทำงาน = ห้ามแก้รูป/ปก (รอบนั้นเซฟทับ) · แผงสร้างรูปทำงาน = ห้ามแก้ HTML/ปกซ้อน
    const rewritingNow = job?.status === 'writing' || job?.status === 'cover'
    const coverLocked = rewritingNow || articleStatus[entryIdx] === 'WRITING' || articleStatus[entryIdx] === 'PUSHING'
    const imagesRunning = imgBusy === entryIdx
    const coverControlsOff = coverLocked || imagesRunning || coverBusy === entryIdx || viewMode === 'edit'
    const status: ReviewListStatus = isApproved ? 'approved' : hasComments ? 'comments' : 'pending'

    // การ์ดภาพปก — ทีมงานเห็นในคอลัมน์ขวาใต้ Meta Description, ลูกค้าเห็นเหนือบทความ (ดูอย่างเดียว)
    const coverCard = (
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-brand-navy flex items-center gap-1.5"><ImageIcon size={12} /> 🖼 ภาพปกบทความ</p>
        {(job?.coverImage || coverUrl[entryIdx]) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job?.coverImage ? `data:${job.coverMimeType || 'image/webp'};base64,${job.coverImage}` : coverUrl[entryIdx]}
            alt={coverAlt[entryIdx] || entry.title}
            className="w-full h-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
          />
        ) : (
          <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">ยังไม่มีภาพปก</p>
        )}
        {!isClient && (
          <>
            <input type="file" accept="image/*" disabled={coverControlsOff}
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadCoverFile(entryIdx, entry, f); e.target.value = '' }}
              className="text-xs" />
            <input
              value={coverAlt[entryIdx] ?? entry.title}
              disabled={coverControlsOff}
              onFocus={e => { altAtFocus.current = e.target.value }}
              onChange={e => setCoverAlt(prev => ({ ...prev, [entryIdx]: e.target.value }))}
              onBlur={e => {
                const v = e.target.value
                if (v.trim() !== altAtFocus.current.trim() && !coverControlsOff) void patchCover(entryIdx, entry, { coverAlt: v })
              }}
              placeholder="Alt text ของภาพปก"
              className="w-full text-xs border border-gray-200 rounded-md px-3 py-2 disabled:bg-gray-50"
            />
            {(job?.coverImage || coverUrl[entryIdx]) && (
              <button
                disabled={coverControlsOff}
                onClick={() => void patchCover(entryIdx, entry, { coverImageUrl: null })}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                <X size={12} /> ลบภาพปก
              </button>
            )}
          </>
        )}
      </div>
    )

    const statusBadges = (
      <>
        {isApproved && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✅ Approved</span>}
        {hasComments && !isApproved && (
          <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">
            💬 {entryComments.length} Comment{entryComments.length > 1 ? 's' : ''}
          </span>
        )}
        {!hasComments && !isApproved && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">รอ Review</span>}
      </>
    )

    // แถวในรายการซ้าย — กดแล้วเปิดบทความตรงกลาง
    const row = (
      <button key={entryIdx} onClick={() => expand(entryIdx, entry)} disabled={loadingHtml === entryIdx}
        className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors disabled:opacity-60 ${expanded === entryIdx ? 'bg-brand-mist/40' : ''}`}>
        <p className="text-xs font-medium text-brand-navy line-clamp-2">{entry.title}</p>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-gray-400">{entry.date}</span>
          {statusBadges}
          {loadingHtml === entryIdx && <RefreshCw size={10} className="animate-spin text-gray-400" />}
        </div>
      </button>
    )
    if (expanded !== entryIdx) return { entryIdx, status, row, detail: null }

    // ตรงกลาง = บทความ · ขวา = Search appearance → สร้างรูปด้วย Mars → ภาพปก (เหมือน Upload Review)
    const detail = (
      <>
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-5 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs text-gray-400">{entry.date}</span>
                  {statusBadges}
                </div>
                <p className="text-sm font-semibold text-brand-navy">{entry.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{entry.keyword}</p>
                {hasComments && !isApproved && (
                  <p className="text-xs text-rose-600 mt-1.5 italic line-clamp-1">
                    💬 {entryComments[entryComments.length - 1].body}
                  </p>
                )}
              </div>
              {!isApproved && (
                <button onClick={() => approve(entryIdx)} disabled={!!approving[entryIdx]}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-60">
                  <CheckCircle2 size={12} /> {approving[entryIdx] ? 'กำลังบันทึก…' : 'Approve'}
                </button>
              )}
            </div>

            {isClient && coverCard}

            {/* Article viewer: Preview / Text / แก้ไข */}
            {html ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="text-xs font-semibold text-gray-500">📄 บทความ</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(isClient
                      ? ([['preview', '👁 Preview'], ['text', '📃 Text']] as const)
                      : ([['preview', '👁 Preview'], ['text', '📃 Text'], ['edit', '✏️ แก้ไข']] as const)
                    ).map(([m, label]) => (
                      <button key={m} onClick={() => setViewMode(m)}
                        disabled={m === 'edit' && (imagesRunning || rewritingNow)}
                        title={m === 'edit' && imagesRunning ? 'รอสร้างรูปให้เสร็จก่อน' : m === 'edit' && rewritingNow ? 'กำลังเขียนใหม่ — รอให้เสร็จก่อน' : undefined}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                          viewMode === m ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}>
                        {label}
                      </button>
                    ))}
                    {!isClient && (
                      <button onClick={() => regenerateArticle(entryIdx)} disabled={rewritingNow || imagesRunning || coverLocked || editSaving}
                        title="ให้ AI เขียนบทความนี้ใหม่ทั้งบทความ (keyword/title เดิม) — ที่แก้มือ/รูปเดิมจะถูกแทน"
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:text-brand-blue hover:bg-gray-50 disabled:opacity-50 transition-colors">
                        <RefreshCw size={11} className={rewritingNow ? 'animate-spin' : ''} /> {rewritingNow ? 'กำลังเขียนใหม่...' : 'Re-generate'}
                      </button>
                    )}
                    <button disabled={wordBusy !== null} onClick={() => downloadArticleWord(entryIdx, entry, job, html)}
                      title="ดาวน์โหลดเป็นไฟล์ Word ส่งให้ลูกค้าตรวจ"
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                      {wordBusy === entryIdx ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />} Word
                    </button>
                    <button disabled={docsBusy !== null} onClick={() => exportArticleGoogleDocs(entryIdx, entry, job, html)}
                      onPointerEnter={preloadGoogleDocsExport} onFocus={preloadGoogleDocsExport}
                      title={isDriveExportConfigured()
                        ? 'สร้างเป็น Google Doc ใน Drive ของคุณ แล้วเปิดให้ทันที'
                        : 'คัดลอกบทความ แล้วเปิด Google Docs ใหม่ให้กดวาง (⌘V / Ctrl+V)'}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                      {docsBusy === entryIdx ? <RefreshCw size={11} className="animate-spin" /> : <FileText size={11} />} Google Docs
                    </button>
                    <button onClick={() => downloadArticleHtml(entryIdx, entry, job, html)}
                      title="ดาวน์โหลดเป็นไฟล์ HTML หน้าตาเหมือน Preview เปิดได้ทุกเบราว์เซอร์"
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 transition-colors">
                      <Download size={11} /> HTML
                    </button>
                    {!isClient && (
                      <button onClick={() => openHtmlPreview(entryIdx, entry, job, html)}
                        title="เปิดดู HTML หน้าตาเหมือน Preview ในแท็บใหม่"
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 transition-colors">
                        เปิด HTML ในแท็บใหม่
                      </button>
                    )}
                    {viewMode === 'edit' && !isClient && (
                      <button onClick={() => setEditTone(t => (t === 'site' ? 'readable' : 'site'))}
                        title="เปลี่ยนสีเฉพาะตอนแก้ไข ไม่มีผลกับบทความที่บันทึก/push"
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${editTone === 'readable' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'}`}>
                        {editTone === 'readable' ? 'สีอ่านง่าย ✓' : 'สีอ่านง่าย'}
                      </button>
                    )}
                    {viewMode === 'edit' && (
                      <button disabled={editSaving} onClick={() => saveEditedHtml(entryIdx, entry)}
                        className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors">
                        {editSaving ? <RefreshCw size={10} className="animate-spin" /> : null} 💾 บันทึกการแก้ไข
                      </button>
                    )}
                  </div>
                </div>
                {viewMode === 'edit' && (
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 mb-2">
                    คลิกที่ข้อความในบทความแล้วพิมพ์แก้ได้เลย — โครง HTML/สไตล์/Schema ระบบเก็บให้เหมือนเดิม กด 💾 เมื่อเสร็จ
                  </p>
                )}
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                  {viewMode === 'preview' && <ArticleFrame html={applyFaqDisplay(boxKeyTakeaways(html), articleLook.detail?.faq)} pageBackground={articleLook.pageBackground} fontFaces={isClient ? undefined : articleLook.detail?.article?.fontFaces} />}
                  {viewMode === 'text' && (
                    <div className="p-5 text-sm text-gray-800 whitespace-pre-wrap leading-7">{htmlToPlainText(html)}</div>
                  )}
                  {viewMode === 'edit' && (
                    // wrapper + <style> อยู่นอกตัว editable — ไม่ถูกบันทึกลงบทความ
                    <div className={editTone === 'readable' ? 'ua-edit-readable' : ''}
                      style={{ background: editTone === 'site' ? editBackground(articleLook.pageBackground) : '#fff' }}>
                      {editTone === 'readable' && <style>{EDIT_READABLE_CSS}</style>}
                      <EditorToolbar editorRef={reviewEditorRef} className="sticky top-0 z-10 bg-white" />
                      <ScopedEditable html={html} editorRef={reviewEditorRef}
                        className="p-5 outline-none min-h-[200px] focus:ring-2 focus:ring-brand-blue/20" />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">ยังไม่มี HTML ของบทความนี้</p>
            )}

            {/* Comment history */}
            {hasComments && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">💬 ประวัติ Comment ({entryComments.length} รอบ)</div>
                <div className="space-y-2">
                  {entryComments.map((c, i) => (
                    <div key={c.id} className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-rose-600">Comment รอบที่ {i + 1}</span>
                        <span className="text-[10px] text-gray-400">{c.user?.name ?? 'ทีม'}</span>
                        <span className="text-[10px] text-gray-300 ml-auto">{new Date(c.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add comment + actions */}
            {!isApproved && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    💬 {hasComments ? `เพิ่ม Comment รอบที่ ${entryComments.length + 1}` : 'เพิ่ม Comment'}
                  </label>
                  <textarea
                    value={commentDraft[entryIdx] ?? ''}
                    onChange={e => setCommentDraft(prev => ({ ...prev, [entryIdx]: e.target.value }))}
                    placeholder={isClient
                      ? 'อยากให้แก้ตรงไหน พิมพ์บอกทีมงานได้เลย แล้วกด "ขอแก้ไข"'
                      : 'ระบุสิ่งที่ต้องแก้ไข... comment จะถูกบันทึกไว้ในบทความและใช้เป็น instruction ในการ regenerate'}
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-rose-200 resize-none"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {/* Approve */}
                  <button onClick={() => approve(entryIdx)} disabled={!!approving[entryIdx]}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-60">
                    <CheckCircle2 size={12} /> {approving[entryIdx] ? 'กำลังบันทึก…' : 'Approve'}
                  </button>
                  {/* Save comment only */}
                  {isClient ? (
                  <button
                    disabled={!(commentDraft[entryIdx] ?? '').trim() || savingComment[entryIdx]}
                    onClick={() => requestRevision(entryIdx, entry)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-40">
                    {savingComment[entryIdx] ? <RefreshCw size={12} className="animate-spin" /> : null}
                    ขอแก้ไข
                  </button>
                  ) : (
                  <>
                  <button
                    disabled={!(commentDraft[entryIdx] ?? '').trim() || savingComment[entryIdx]}
                    onClick={() => saveComment(entryIdx, entry)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50 disabled:opacity-40 transition-colors">
                    {savingComment[entryIdx] ? <RefreshCw size={12} className="animate-spin" /> : null}
                    บันทึก Comment
                  </button>
                  {/* Rewrite with all comments */}
                  <button
                    disabled={(!hasComments && !(commentDraft[entryIdx] ?? '').trim()) || rewriting[entryIdx]}
                    onClick={() => rewriteWithComments(entryIdx, entry)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-blue text-white text-xs font-bold rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors">
                    {rewriting[entryIdx] ? <RefreshCw size={12} className="animate-spin" /> : null}
                    🔄 เขียนใหม่ตาม Comment{entryComments.length > 0 ? ` (${entryComments.length + (commentDraft[entryIdx]?.trim() ? 1 : 0)} รอบ)` : ''}
                  </button>
                  </>
                  )}
                </div>
              </div>
            )}
            </div>

            {/* ── Search appearance (Yoast style) — meta ที่ใช้ตอน Push จริง ──
                เครื่องมือของทีมงาน ลูกค้าไม่เห็นและแก้ไม่ได้ ── */}
            {!isClient && (() => {
              const draft = seoDraft[entryIdx] ?? { seoTitle: entry.title ?? '', metaDescription: '', slug: entry.slug ?? '' }
              const setDraft = (patch: Partial<typeof draft>) =>
                setSeoDraft(prev => ({ ...prev, [entryIdx]: { ...draft, ...patch } }))
              const savedRecently = Date.now() - (seoSavedAt[entryIdx] ?? 0) < 6000
              return (
                // คอลัมน์ขวา: Search appearance → สร้างรูปด้วย Mars → ภาพปก เรียงลงมา
                <div className="space-y-4 min-w-0 lg:col-start-2 2xl:col-start-3">
                <aside className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-brand-navy">Search appearance</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">หน้าตาบทความบน Google — แก้ตรงนี้แล้วกดบันทึก ค่าที่ได้จะถูกใช้ตอน Push</p>
                    </div>
                    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 shrink-0">
                      {(['mobile', 'desktop'] as const).map(d => (
                        <button key={d} onClick={() => setSerpDevice(d)}
                          className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors ${
                            serpDevice === d ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-500'
                          }`}>
                          {d === 'mobile' ? 'Mobile' : 'Desktop'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <GoogleSerpPreview
                    device={serpDevice}
                    siteHost={siteHost}
                    siteName={siteName}
                    slug={slugifyEnSlug(draft.slug)}
                    title={draft.seoTitle}
                    description={draft.metaDescription}
                    thumbnail={
                      job?.coverImage
                        ? `data:${job.coverMimeType || 'image/webp'};base64,${job.coverImage}`
                        : (coverUrl[entryIdx] || firstImageFromHtml(html))
                    }
                    dateLabel={entry.thaiDate || entry.date}
                  />

                  {/* SEO title */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-gray-600">Meta Title</label>
                      <span className={`text-[10px] font-medium ${draft.seoTitle.length > 60 ? 'text-rose-500' : 'text-gray-400'}`}>
                        {draft.seoTitle.length}/60
                      </span>
                    </div>
                    <input
                      value={draft.seoTitle}
                      onChange={e => setDraft({ seoTitle: e.target.value })}
                      placeholder="ชื่อที่จะแสดงบนผลการค้นหา"
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    />
                    <MetaLengthBar len={draft.seoTitle.length} min={30} max={60} />
                  </div>

                  {/* Slug */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-gray-600">Slug (URL)</label>
                      <span className="text-[10px] text-gray-400">a-z 0-9 และ - เท่านั้น</span>
                    </div>
                    <input
                      value={draft.slug}
                      onChange={e => setDraft({ slug: e.target.value })}
                      onBlur={e => setDraft({ slug: slugifyEnSlug(e.target.value) })}
                      placeholder="english-url-slug"
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    />
                    <p className="text-[10px] text-gray-400 mt-1 truncate">
                      {siteHost ? `${siteHost}/` : '/'}{slugifyEnSlug(draft.slug)}
                    </p>
                  </div>

                  {/* Meta description */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-gray-600">Meta Description</label>
                      <span className={`text-[10px] font-medium ${draft.metaDescription.length > 160 ? 'text-rose-500' : 'text-gray-400'}`}>
                        {draft.metaDescription.length}/160
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      value={draft.metaDescription}
                      onChange={e => setDraft({ metaDescription: e.target.value })}
                      placeholder="สรุปบทความ 1-2 ประโยคสำหรับผลการค้นหา"
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    />
                    <MetaLengthBar len={draft.metaDescription.length} min={120} max={160} />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      disabled={seoSaving === entryIdx || imagesRunning}
                      title={imagesRunning ? 'รอสร้างรูปให้เสร็จก่อน' : undefined}
                      onClick={() => saveSeo(entryIdx, entry)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-brand-blue text-white text-[11px] font-bold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors">
                      {seoSaving === entryIdx ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                      {seoSaving === entryIdx ? 'กำลังบันทึก...' : 'บันทึก SEO'}
                    </button>
                    <button
                      disabled={aiMetaBusy === entryIdx || seoSaving === entryIdx || imagesRunning}
                      title="ให้ Mars เสนอ Meta Title / Description / Slug จากเนื้อหาบทความ — ยังไม่บันทึกจนกว่าจะกด บันทึก SEO"
                      onClick={() => suggestMeta(entryIdx)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 text-[11px] font-bold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                      {aiMetaBusy === entryIdx ? <RefreshCw size={11} className="animate-spin" /> : null}
                      {aiMetaBusy === entryIdx ? 'Mars กำลังเขียน...' : 'ให้ Mars เขียน Meta + Slug'}
                    </button>
                    {savedRecently && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <Check size={12} /> บันทึกแล้ว
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 leading-snug">
                    บันทึกแล้วระบบเขียนค่าลงทั้งบทความและฐานข้อมูล — ตอนกด Push จะขึ้นเว็บด้วยค่าล่าสุดนี้ ไม่ใช่ค่าก่อนแก้
                  </p>
                </aside>
                <SmeAiImagesPanel
                  articleId={articleIds[entryIdx]}
                  themeColors={project.themeColors}
                  html={html}
                  hasCover={!!(job?.coverImage || coverUrl[entryIdx])}
                  locked={coverLocked}
                  editing={viewMode === 'edit'}
                  coverBusy={coverBusy === entryIdx}
                  onUpdated={a => applyArticleUpdate(entryIdx, entry, a)}
                  onBusyChange={b => setImgBusy(prev => b ? entryIdx : (prev === entryIdx ? null : prev))}
                />
                {html && (
                  <div className={coverControlsOff ? 'pointer-events-none opacity-50' : ''}>
                    <ArticleImagesPanel
                      html={html}
                      coverImageUrl={job?.coverImage ? `data:${job.coverMimeType || 'image/webp'};base64,${job.coverImage}` : (coverUrl[entryIdx] ?? null)}
                      onSaveAlt={async (index, alt) => {
                        const ok = await patchContentHtml(entryIdx, { imageAlt: { index, alt } })
                        if (ok) toast.success('บันทึก alt แล้ว')
                        return ok
                      }}
                      onSaveLink={async (index, href) => {
                        const ok = await patchContentHtml(entryIdx, { imageLink: { index, href } })
                        if (ok) toast.success(href ? 'ใส่ลิงก์ให้รูปแล้ว' : 'เอาลิงก์ออกจากรูปแล้ว')
                        return ok
                      }}
                      onSetCover={async (src, alt) => {
                        const ok = await patchCover(entryIdx, entry, { coverImageUrl: src, coverAlt: alt || entry.title })
                        if (ok) toast.success('ตั้งเป็นภาพปกแล้ว')
                        return ok
                      }}
                    />
                  </div>
                )}
                {html && (
                  <div className={`bg-white border border-gray-200 rounded-xl p-4 space-y-3 ${coverControlsOff ? 'pointer-events-none opacity-50' : ''}`}>
                    <p className="text-xs font-bold text-brand-navy">แทรกรูปในเนื้อหา</p>
                    <input type="file" accept="image/*" onChange={e => setInsertFile(e.target.files?.[0] ?? null)} className="text-xs" />
                    <input value={insertAlt} onChange={e => setInsertAlt(e.target.value)} placeholder="Alt text ของรูป"
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue/20" />
                    <select value={insertPos} onChange={e => setInsertPos(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white">
                      <option value="">หลังหัวข้อ H2:</option>
                      {listH2Sections(html).map((h, i) => <option key={i} value={h.index}>{h.text}</option>)}
                    </select>
                    <button disabled={!insertFile || insertPos === '' || inserting} onClick={() => insertImageAfterH2(entryIdx, entry)}
                      className="w-full px-3 py-2 bg-brand-blue text-white text-[11px] font-bold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors">
                      {inserting ? 'กำลังแทรก...' : 'แทรกรูป'}
                    </button>
                  </div>
                )}
                {coverCard}
                </div>
              )
            })()}
      </>
    )
    return { entryIdx, status, row, detail }
  })
  const selectedDetail = reviewItems.find(i => i.detail)?.detail ?? null
  // บทความที่เปิดอยู่ยังแสดงตรงกลางต่อแม้ filter ซ่อนแถวของมัน (เหมือน Upload Review)
  const statusCounts = reviewItems.reduce<Record<string, number>>((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc }, {})
  const visibleItems = statusFilter ? reviewItems.filter(i => i.status === statusFilter) : reviewItems

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-500" />
          <span><strong>{pendingCount}</strong> รอ Review</span>
        </div>
        {approvedCount > 0 && (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={14} />
            <span><strong>{approvedCount}</strong> Approved แล้ว</span>
          </div>
        )}
      </div>

      {/* จอกว้าง (2xl) = 3 คอลัมน์ รายการ | บทความ | meta+รูป แบบ Upload Review · จอเล็กกว่านั้นแผงขวาลงไปอยู่ใต้บทความ
          (หน้าโปรเจกต์มีเมนูซ้ายอีกชั้น 3 คอลัมน์ที่ lg/xl ทำให้บทความแคบจนอ่านไม่ได้) */}
      <div className={`grid grid-cols-1 gap-4 items-start lg:grid-cols-[240px_minmax(0,1fr)] ${isClient ? '' : '2xl:grid-cols-[240px_minmax(0,1fr)_360px]'}`}>
        {/* รายการบทความ */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500">
              บทความ ({statusFilter ? `${visibleItems.length}/${reviewItems.length}` : reviewItems.length})
            </p>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as '' | ReviewListStatus)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              <option value="">ทุกสถานะ ({reviewItems.length})</option>
              {REVIEW_LIST_STATUS_OPTIONS.filter(o => statusCounts[o.value] || o.value === statusFilter).map(o => (
                <option key={o.value} value={o.value}>{o.label} ({statusCounts[o.value] || 0})</option>
              ))}
            </select>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
            {visibleItems.map(i => i.row)}
            {!visibleItems.length && <p className="px-3 py-6 text-xs text-gray-400 text-center">ไม่มีบทความในสถานะนี้</p>}
          </div>
        </div>
        {selectedDetail ?? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 min-w-0">
            <p className="text-sm text-gray-400 text-center py-10">เลือกบทความจากรายการด้านซ้าย</p>
          </div>
        )}
      </div>
    </div>
  )
}
