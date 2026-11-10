'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Upload, RefreshCw, Download, Zap, Image as ImageIcon, Save, X,
} from 'lucide-react'
import RestrictionWarningBox from '@/components/shared/RestrictionWarningBox'
import { LabContextFilesCard } from '@/components/projects/workspace/LabContextFilesCard'
import { LabTestImageCard } from '@/components/projects/workspace/LabTestImageCard'
import { CtaSettingsEditor } from '@/components/upload-article/settings/CtaSection'
import { AuthorSettingsEditor } from '@/components/upload-article/settings/AuthorSection'
import { ImageSettingsEditor } from '@/components/upload-article/settings/ImagesSection'
import { readArticleImageSettings, type ArticleImageSettings } from '@/lib/article-settings'
import type { UploadCtaSettings } from '@/lib/upload-article/cta'
import type { UploadAuthorSettings } from '@/lib/upload-article/author'
import SmeStyleSettings, { type SmeScanContext } from '@/components/projects/sme-style/SmeStyleSettings'
import { projectThemeToUpload } from '@/lib/project-theme'
import LanguageModeSelect from '@/components/projects/LanguageModeSelect'
import { readLanguagePrefs } from '@/lib/keyword-language'
import { stripInlineImages } from '@/lib/articleSample'
import type { ProjectData, KeywordRow } from '@/components/projects/sme-types'
import type { SmeLabSection } from '@/components/projects/settings/sme-settings-sections'

// ─── Article Lab Tab ──────────────────────────────────────────────────────────

// Default style guide — ใช้เป็น fallback เมื่อ client ยังไม่ได้กำหนด style
const DEFAULT_STYLE_GUIDE = `## Tone & Voice
- เป็นกันเอง ให้ข้อมูล ตรงประเด็น ไม่เยิ่นเย้อ
- ใช้ภาษาไทยที่อ่านง่าย เข้าใจได้ทันที
- หลีกเลี่ยงภาษาวิชาการหนัก ๆ เว้นแต่จำเป็น

## Article Structure
- เริ่มด้วย Short Answer 2-3 บรรทัดก่อน H2 แรก
- H2 แต่ละหัวข้อไม่เกิน 3 ย่อหน้า
- มีตารางหรือ checklist อย่างน้อย 1 รายการ
- กล่องสรุปประเด็นสำคัญ 3-5 ข้อ ต่อจาก Short Answer (บทความภาษาอังกฤษใช้หัวกล่อง "Key Takeaways")
- FAQ อย่างน้อย 5 ข้อ หัว FAQ เป็น H2 แต่ละคำถามอยู่ใน <details><summary> เป็น <span class="content-faq__q"> (ห้ามใส่ H3/หัวข้อใน <summary>)

## Style
- ไม่มี Hero section / CTA แบบ hard sell เว้นแต่ระบุ
- โครง HTML/คลาสเป็นไปตาม Component Standard ของระบบ (ห้ามกำหนดคลาส/CSS เอง)

## Content Rules
- ห้ามเดาหมายเลขโทรศัพท์ อีเมล LINE ID
- ห้ามใช้คำ: ดีที่สุด, อันดับ 1, รับประกัน (เว้นแต่มีหลักฐาน)
- ใส่ Internal Links ตามรายการที่ระบุในส่วน INTERNAL LINKS
`

interface InternalLink { keyword: string; url: string }

export function SmeLabTab({ project, onSaved, keywordRows = [], section }: {
  project: ProjectData
  onSaved: (updated: Partial<ProjectData>) => void
  keywordRows?: KeywordRow[]
  /** ส่งมาจาก SmeSettingsShell (เมนูซ้าย) — มีค่า = ซ่อนแถบ sub-tab ภายในและแสดงเฉพาะบล็อกของหน้านั้น; ไม่ส่ง = พฤติกรรมเดิม */
  section?: SmeLabSection
}) {
  // Style settings
  const [styleGuide, setStyleGuide] = useState(project.styleGuide ?? DEFAULT_STYLE_GUIDE)
  // บริบทธุรกิจ — ข้อเท็จจริงที่บทความห้ามเขียนขัด (จุดแก้เดียวของระบบ ตาม Setup Checklist)
  const [projectContext, setProjectContext] = useState(project.projectContext ?? '')
  // โหมดภาษาสำหรับทดสอบเขียนบทความใน Lab (ตัวเลือกเดียวกับหน้า Articles)
  const [langPrefs, setLangPrefs] = useState(() => readLanguagePrefs(null, project.language))
  // ก่อน LanguageModeSelect โหลดค่าที่บันทึกไว้เสร็จ ห้ามส่ง language_mode (ค่า default อาจไม่ตรง DB) — ให้ route อ่านจาก DB เอง
  const [langLoaded, setLangLoaded] = useState(false)
  const onLangChange = useCallback((next: ReturnType<typeof readLanguagePrefs>) => { setLangPrefs(next); setLangLoaded(true) }, [])
  // ธีมบทความ (สี/ฟอนต์/หน้าตา FAQ) แก้และบันทึกใน SmeStyleSettings — ที่นี่เก็บแค่ค่าล่าสุดไว้ใช้กับพรีวิว/CTA
  const [themeColorsRaw, setThemeColorsRaw] = useState<string | null>(project.themeColors ?? null)
  const accentColor = project.accentColor ?? '#2563eb'
  const articleColors = useMemo(() => {
    const t = projectThemeToUpload(themeColorsRaw, project.accentColor ?? null)
    return { theme: t.theme, border: t.border, background: t.background, pageBackground: t.pageBackground ?? '' }
  }, [themeColorsRaw, project.accentColor])
  const [forbiddenWords, setForbiddenWords] = useState(() => {
    try { return JSON.parse(project.forbiddenWords ?? '[]').join('\n') } catch { return '' }
  })

  // รับบริบทธุรกิจ/Style Guide/คำต้องห้ามจากผลสแกน — ทีมยังแก้ต่อได้ และต้องกดบันทึกเองถึงจะลง DB
  // เมนูซ้าย: ช่องพวกนี้อยู่หน้า "ข้อมูลธุรกิจ" ไม่ใช่หน้า Style — จำไว้ว่ายังไม่ได้บันทึก แล้วโชว์ปุ่มบันทึกบนหน้า Style ให้ด้วย
  const [scanContextPending, setScanContextPending] = useState(false)
  const applyScanContext = (r: SmeScanContext) => {
    if (r.projectContext) setProjectContext(r.projectContext)
    if (r.styleGuide) setStyleGuide(r.styleGuide)
    if (r.forbiddenWords.length) setForbiddenWords(r.forbiddenWords.join('\n'))
    if (r.projectContext || r.styleGuide || r.forbiddenWords.length) setScanContextPending(true)
  }
  const [internalLinksText, setInternalLinksText] = useState(() => {
    try {
      const links: InternalLink[] = JSON.parse(project.internalLinks ?? '[]')
      return links.map(l => `${l.keyword} | ${l.url}`).join('\n')
    } catch { return '' }
  })
  const styleFileRef = useRef<HTMLInputElement>(null)
  const linkFileRef = useRef<HTMLInputElement>(null)

  // Article lab settings
  const [keyword, setKeyword] = useState('')
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState(project.sampleArticle ?? '')
  const [coverImageLab, setCoverImageLab] = useState('')
  const [coverMimeTypeLab, setCoverMimeTypeLab] = useState('image/webp')
  const [midImageLab, setMidImageLab] = useState('')
  const [midMimeTypeLab, setMidMimeTypeLab] = useState('image/webp')
  const [streamText, setStreamText] = useState('')
  const [stepMsg, setStepMsg] = useState('')
  // คำต้องห้ามที่ server แก้ไม่หมด — แยกจาก stepMsg กันถูกข้อความสถานะทับ
  const [restrictionWarns, setRestrictionWarns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview' | 'cover'>('preview')

  // Save state
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function loadStyleMd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setStyleGuide(ev.target?.result as string ?? '')
    reader.readAsText(file)
  }

  function loadLinkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string ?? ''
      // support CSV: keyword,url  OR  keyword | url  OR  keyword\turl
      const lines = text.trim().split('\n').filter(l => l.trim())
      const parsed = lines.map(line => {
        const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : ','
        const parts = line.split(sep).map(p => p.trim())
        return parts.length >= 2 ? `${parts[0]} | ${parts[1]}` : line.trim()
      })
      setInternalLinksText(parsed.join('\n'))
    }
    reader.readAsText(file)
  }

  function parseInternalLinks(): InternalLink[] {
    return internalLinksText.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf('|')
        if (idx > 0) return { keyword: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() }
        return null
      })
      .filter(Boolean) as InternalLink[]
  }

  async function generate() {
    if (!keyword.trim() || !title.trim()) return
    setLoading(true)
    setStreamText('')
    setStepMsg('')
    setRestrictionWarns([])
    setHtml('')
    setCoverImageLab('')
    setMidImageLab('')
    try {
      // 1) บันทึกค่า Article Lab ลง DB ก่อนเสมอ
      //    /api/article/write อ่านค่าทุกอย่างจาก DB ตอนรันจริง ถ้าไม่บันทึกก่อนแล้ว
      //    ส่ง override มาทาง body บททดสอบจะใช้คนละค่ากับตอน publish จริง
      setStepMsg('💾 บันทึกค่า Article Lab ลง DB...')
      await persistSettings(false)

      // 2) ยิงด้วย payload ชุดเดียวกับหน้าบทความจริงเป๊ะ ๆ — ไม่ override อะไรเลย
      //    prompt ทุกชั้น (Business Skill → Master Prompt → Article Brief → Validator
      //    → Image Prompt) จึงมาจาก Content Engine ของ client นี้ชุดเดียวกับตอนรันจริง
      setStepMsg('✍️ AI กำลังเขียนบทความ...')
      const res = await fetch('/api/article/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword, title, stream: true,
          projectId: project.id,
          language: project.language,
          language_mode: langLoaded ? langPrefs.keywordMode : null,
        }),
      })
      if (!res.ok) {
        // เซิร์ฟเวอร์ตอบเหตุผลจริงมาเป็น JSON (เช่น CONTENT_ENGINE_NOT_CONFIGURED)
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.message || detail?.error || `HTTP ${res.status}`)
      }
      if (!res.body) throw new Error('เซิร์ฟเวอร์ไม่ส่ง stream กลับมา')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let fullHtml = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          // หนึ่ง SSE block อาจมีหลายบรรทัด "data:" — ต้องอ่านทีละบรรทัดเหมือนหน้าบทความจริง
          for (const rawLine of part.split('\n')) {
          const line = rawLine.replace(/^data:\s*/, '').trim()
          if (!line || line === '[DONE]') continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'chunk') { fullHtml += evt.content; setStreamText(fullHtml) }
            else if (evt.type === 'status') { setStepMsg(evt.message) }
            else if (evt.type === 'done') {
              fullHtml = evt.html ?? fullHtml
              setHtml(fullHtml)
              setStreamText('')
              setStepMsg('')
              if (evt.coverImage) { setCoverImageLab(evt.coverImage); setCoverMimeTypeLab(evt.coverMimeType ?? 'image/webp'); setViewMode('cover') }
              if (evt.midImage) { setMidImageLab(evt.midImage); setMidMimeTypeLab(evt.midMimeType ?? 'image/webp') }
              if (Array.isArray(evt.restrictionWarnings)) setRestrictionWarns(evt.restrictionWarnings.map(String))
            }
            else if (evt.type === 'error') throw new Error(evt.error)
          } catch { /* skip */ }
          }
        }
      }
    } catch (e) {
      setStepMsg('')
      setStreamText(`❌ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  /**
   * เขียนค่า Article Lab ทั้งหมดลง DB
   * includeSample = true เฉพาะตอนผู้ใช้กด "บันทึกเป็น Pattern" (เก็บ html เป็น sampleArticle)
   * generate() เรียกด้วย false — บันทึกแค่ค่าตั้งต้น ไม่ทับ Pattern เดิมด้วยบททดสอบ
   */
  async function persistSettings(includeSample: boolean) {
    const words = forbiddenWords.split('\n').map((w: string) => w.trim()).filter(Boolean)
    const links = parseInternalLinks()
    const common = {
      styleGuide,
      projectContext,
      // ธีม (themeColors/accentColor/articleTheme) ไม่ส่งตรงนี้ — บันทึกผ่าน SmeStyleSettings ไม่ให้ Generate ทับธีมด้วยค่าเก่า
      forbiddenWords: JSON.stringify(words),
      internalLinks: JSON.stringify(links),
    }
    // บทความตัวอย่างจาก Generate มีรูปฝังเป็น base64 — ตัดออก เก็บแค่โครงบทความไว้เป็น Pattern
    const sample = includeSample && html ? stripInlineImages(html) : ''
    const body: Record<string, unknown> = { ...common }
    if (sample) body.sampleArticle = sample
    const payload = JSON.stringify(body)
    // Vercel รับ request body ได้ไม่เกิน 4.5MB — เกินแล้วจะตอบ 413 ก่อนถึงโค้ดเรา
    if (payload.length > 4_000_000) {
      throw new Error(`ข้อมูลใหญ่เกินไป (${(payload.length / 1_000_000).toFixed(1)}MB) — ลองลดข้อความ Style Guide / บริบทธุรกิจ`)
    }
    const res = await fetch(`/api/projects/${project.id}/style`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      if (res.status === 413) throw new Error('ข้อมูลใหญ่เกินไป เซิร์ฟเวอร์ไม่รับ — ลองลดข้อความ Style Guide')
      throw new Error(`บันทึกค่า Article Lab ไม่สำเร็จ (${detail?.error ?? `HTTP ${res.status}`})`)
    }
    onSaved({
      ...common,
      ...(sample ? { sampleArticle: sample } : {}),
    })
  }

  async function saveAll() {
    setSaving(true)
    try {
      await persistSettings(true)
      setScanContextPending(false)
      setSaved(true)
      toast.success('บันทึกค่า Article Lab แล้ว')
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      // เดิมไม่มี catch — บันทึกพังแล้วปุ่มแค่เด้งกลับ ผู้ใช้ไม่รู้ว่าไม่ได้บันทึก
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Export เป็นไฟล์ HTML เดียวจบ — เปิดดูได้เลยโดยไม่ต้องพึ่งระบบ
   * ใช้ส่งให้ลูกค้าตรวจก่อนรันจริง (สี/CSS/Schema ฝังมาใน html จาก API แล้ว
   * เหลือแค่ห่อ document + ฝังรูปปกเป็น data URI)
   */
  function exportHtml() {
    if (!html) return
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cover = coverImageLab
      ? `<img src="data:${coverMimeTypeLab};base64,${coverImageLab}" alt="${esc(title)}" style="width:100%;height:auto;display:block;margin:0 0 24px;border-radius:12px" />\n`
      : ''
    const doc = `<!doctype html>
<html lang="${project.language === 'en' ? 'en' : 'th'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:24px 16px;background:#fff">
<div style="max-width:840px;margin:0 auto">
${cover}${html}
</div>
</body>
</html>`
    const slug = (keyword || 'article').trim().replace(/\s+/g, '-').replace(/[/\\?%*:|"<>]/g, '').slice(0, 60)
    const a = document.createElement('a')
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }))
    a.href = url
    a.download = `${slug || 'article'}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Internal Link state — 3 separate tables ──────
  // ilGscLinks: fetched from GSC (read-only preview, user can exclude)
  // ilKwLinks:  fetched from Keywords (read-only preview, user can exclude)
  // ilManualLinks: user-added rows
  const [ilGscLinks, setIlGscLinks] = useState<InternalLink[]>([])
  const [ilKwLinks, setIlKwLinks] = useState<InternalLink[]>([])
  const [ilManualLinks, setIlManualLinks] = useState<InternalLink[]>(() => {
    try { return JSON.parse(project.internalLinks ?? '[]') } catch { return [] }
  })
  const [ilExcluded, setIlExcluded] = useState<Set<string>>(new Set())
  const [ilLinksPerArticle, setIlLinksPerArticle] = useState<string>(() => {
    try {
      const p = (project as { linksPerArticle?: string | number }).linksPerArticle
      return p ? String(p) : '3-5'
    } catch { return '3-5' }
  })
  const [ilGscLoading, setIlGscLoading] = useState(false)
  const [ilKwLoading, setIlKwLoading] = useState(false)
  const [ilSaving, setIlSaving] = useState(false)
  const [ilSaved, setIlSaved] = useState(false)
  const [ilGscFetched, setIlGscFetched] = useState(false)
  const [ilGscProperties, setIlGscProperties] = useState<string[]>([])
  const [ilGscSelected, setIlGscSelected] = useState<string>(project.gscSiteUrl ?? '')

  function ilManualAdd() {
    setIlManualLinks(prev => [...prev, { keyword: '', url: '' }])
  }
  function ilManualRemove(i: number) {
    setIlManualLinks(prev => prev.filter((_, j) => j !== i))
  }
  function ilManualUpdate(i: number, field: 'keyword' | 'url', val: string) {
    setIlManualLinks(prev => prev.map((l, j) => j === i ? { ...l, [field]: val } : l))
  }
  function ilToggleExclude(url: string) {
    setIlExcluded(prev => { const s = new Set(prev); s.has(url) ? s.delete(url) : s.add(url); return s })
  }

  // merged = GSC (non-excluded) + Keywords (non-excluded) + Manual
  function ilMerged(): InternalLink[] {
    const seen = new Set<string>()
    const out: InternalLink[] = []
    for (const l of [...ilGscLinks, ...ilKwLinks, ...ilManualLinks]) {
      if (!l.url.trim()) continue
      if (ilExcluded.has(l.url)) continue
      if (seen.has(l.url)) continue
      seen.add(l.url)
      out.push(l)
    }
    return out
  }

  async function ilFetchGscProperties() {
    try {
      const res = await fetch(`/api/projects/${project.id}/sitelinks?source=properties`)
      if (res.ok) {
        const data = await res.json() as { properties: string[] }
        const props = data.properties ?? []
        setIlGscProperties(props)
        if (props.length > 0 && !ilGscSelected) setIlGscSelected(props[0])
      }
    } catch { /* skip */ }
  }

  async function ilFetchGsc(siteUrl?: string) {
    setIlGscLoading(true)
    const url = siteUrl ?? ilGscSelected ?? project.gscSiteUrl ?? ''
    try {
      const res = await fetch(`/api/projects/${project.id}/sitelinks?source=gsc${url ? `&siteUrl=${encodeURIComponent(url)}` : ''}`)
      if (res.ok) {
        const data = await res.json() as { links: InternalLink[] }
        setIlGscLinks((data.links ?? []).filter(l => l.url))
        setIlGscFetched(true)
      }
    } catch { /* skip */ } finally {
      setIlGscLoading(false)
    }
  }

  async function ilFetchKeywords() {
    setIlKwLoading(true)
    try {
      const rawBase = ilGscSelected || project.website || ''
      const base = rawBase.replace(/\/$/, '')

      // Source of keywords: keywordRows prop (AI Keyword Research, up to thousands of entries)
      // NOT the Keyword table which only has manually-researched ones (usually small)
      const sourceRows = keywordRows.length > 0 ? keywordRows : []

      if (sourceRows.length === 0) {
        // Fallback: try keywords-cache endpoint if state not loaded yet
        const cacheRes = await fetch(`/api/projects/${project.id}/keywords-cache`)
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json() as { keywordRows?: KeywordRow[] }
          const cached = cacheData.keywordRows ?? []
          if (cached.length > 0) {
            const incoming: InternalLink[] = cached
              .filter(k => k.keyword?.trim())
              .map(k => {
                const slug = k.keyword.toLowerCase().trim()
                  .replace(/\s+/g, '-')
                  .replace(/[^a-z0-9ก-๙-]/g, '')
                return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
              })
            setIlKwLinks(incoming)
            return
          }
        }
        // Final fallback: Keyword table (manually-researched)
        const kwRes = await fetch(`/api/keywords?projectId=${project.id}`)
        if (!kwRes.ok) return
        const kws = await kwRes.json() as { keyword: string; id: string }[]
        const incoming: InternalLink[] = kws
          .filter((k: { keyword: string; id: string }) => k.keyword?.trim())
          .map((k: { keyword: string; id: string }) => {
            const slug = k.keyword.toLowerCase().trim()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9ก-๙-]/g, '')
            return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
          })
        setIlKwLinks(incoming)
        return
      }

      // Main path: use keywordRows state (already loaded, up to 2739+)
      const incoming: InternalLink[] = sourceRows
        .filter(k => k.keyword?.trim())
        .map(k => {
          const slug = k.keyword.toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9ก-๙-]/g, '')
          return { keyword: k.keyword, url: base ? `${base}/${slug}` : `/${slug}` }
        })
      setIlKwLinks(incoming)
    } catch (e) {
      console.error('[ilFetchKeywords]', e)
    } finally {
      setIlKwLoading(false)
    }
  }

  async function ilSave() {
    setIlSaving(true)
    const merged = ilMerged()
    try {
      const payload = JSON.stringify(merged)
      const res = await fetch(`/api/projects/${project.id}/style`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalLinks: payload, linksPerArticle: ilLinksPerArticle, gscSiteUrl: ilGscSelected || undefined }),
      })
      if (res.ok) {
        setInternalLinksText(merged.map(l => `${l.keyword} | ${l.url}`).join('\n'))
        onSaved({ internalLinks: payload })
        setIlSaved(true)
        setTimeout(() => setIlSaved(false), 2500)
      } else {
        toast.error(`บันทึก Internal Link ไม่สำเร็จ (HTTP ${res.status})`)
      }
    } catch (e) {
      toast.error(`บันทึก Internal Link ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIlSaving(false)
    }
  }

  // ── Lab sub-tab state ──────────────────────────────
  const [labSubTab, setLabSubTab] = useState<'style' | 'images' | 'cta' | 'author' | 'sitelink' | 'image'>('style')

  // ── รูปภาพ / CTA / Author Box — บันทึกแยกผ่าน /article-settings (ไม่ผูกกับปุ่ม "บันทึกทั้งหมด") ──
  const articleSettingsUrl = `/api/projects/${project.id}/article-settings`
  const loadArticleSettings = useCallback(async (): Promise<Record<string, unknown>> => {
    const r = await fetch(articleSettingsUrl)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || 'โหลดค่าตั้งค่าไม่สำเร็จ')
    return d
  }, [articleSettingsUrl])
  async function putArticleSettings(section: 'images' | 'cta' | 'author', value: unknown): Promise<unknown> {
    const r = await fetch(articleSettingsUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, value }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || (r.status === 413 ? 'ข้อมูลใหญ่เกินไป — ลดขนาดรูป' : 'บันทึกไม่สำเร็จ'))
    return d
  }
  const [labImages, setLabImages] = useState<ArticleImageSettings | null>(null)
  // ใช้เมนูซ้าย (section) → ดูจาก section; ไม่งั้นดูจาก sub-tab ภายในเหมือนเดิม
  const showStyleSettings = section ? section === 'style' : labSubTab === 'style'
  const showBusinessBlock = section ? section === 'business' : labSubTab === 'style'
  const showTestArticleBlock = section ? section === 'test-article' : labSubTab === 'style'
  const showImagesBlock = section ? section === 'images' : labSubTab === 'images'
  const showCtaBlock = section ? section === 'cta' : labSubTab === 'cta'
  const showAuthorBlock = section ? section === 'author' : labSubTab === 'author'
  const showLinksBlock = section ? section === 'links' : labSubTab === 'sitelink'
  const showTestImageBlock = section ? section === 'test-image' : labSubTab === 'image'

  useEffect(() => {
    if (!showImagesBlock || labImages) return
    let cancelled = false
    loadArticleSettings()
      .then(d => { if (!cancelled) setLabImages(readArticleImageSettings(d.images)) })
      .catch(e => toast.error(e instanceof Error ? e.message : 'โหลดค่ารูปภาพไม่สำเร็จ'))
    return () => { cancelled = true }
  }, [showImagesBlock, labImages, loadArticleSettings])

  // เปิดหน้า Internal Link จากเมนูซ้าย → ดึง GSC / Keywords ครั้งแรกเหมือนตอนกดแท็บ sitelink เดิม
  useEffect(() => {
    if (section !== 'links' || ilGscFetched) return
    ilFetchGscProperties()
    ilFetchGsc()
    ilFetchKeywords()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const LAB_SUBTABS = [
    { id: 'style' as const,    label: 'Style',    icon: '🎨' },
    { id: 'images' as const,   label: 'รูปภาพ',   icon: '🖼️' },
    { id: 'cta' as const,      label: 'CTA',      icon: '📣' },
    { id: 'author' as const,   label: 'Author Box', icon: '👤' },
    { id: 'sitelink' as const, label: 'Internal Link', icon: '🔗' },
    { id: 'image' as const,    label: 'Test Image', icon: '🧪' },
  ]

  // ปุ่ม "บันทึกทั้งหมด" ตัวเดียวกัน (saveAll) — โหมดเมนูซ้ายวางเป็นแถวหัวของหน้า business / links / test-article
  const saveAllButton = (
    <button onClick={saveAll} disabled={saving}
      className="flex items-center gap-1.5 px-4 py-2 bg-brand-blue text-white text-sm font-semibold rounded-xl hover:bg-brand-deep disabled:opacity-50 transition-colors">
      {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
      {saving ? 'บันทึก...' : saved ? '✅ บันทึกแล้ว!' : 'บันทึกทั้งหมด'}
    </button>
  )
  const sectionHasSaveAll = section === 'business' || section === 'links' || section === 'test-article'
  const sectionHasLanguage = section === 'business' || section === 'test-article'

  return (
    <div className="space-y-0">
      {(!section || sectionHasLanguage) && (
        <LanguageModeSelect
          projectId={project.id}
          projectLanguage={project.language}
          value={langPrefs.keywordMode}
          ratioThai={langPrefs.ratioThai}
          onChange={onLangChange}
        />
      )}
      {section && sectionHasSaveAll && (
        <div className="flex items-center justify-end mb-4">{saveAllButton}</div>
      )}
      {/* ── Sub-tab bar (ซ่อนเมื่อใช้เมนูซ้าย) ─────────────── */}
      {!section && (
      <div className="flex items-center gap-1 mb-5 bg-gray-100 rounded-2xl p-1 w-fit max-w-full overflow-x-auto">
        {LAB_SUBTABS.map(t => (
          <button key={t.id} onClick={() => {
            setLabSubTab(t.id)
            if (t.id === 'sitelink' && !ilGscFetched) {
              ilFetchGscProperties()
              ilFetchGsc()
              ilFetchKeywords()
            }
          }}
            className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              labSubTab === t.id ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
        <div className="ml-4 pl-4 border-l border-gray-300">
          {saveAllButton}
        </div>
      </div>
      )}

      {/* ผลสแกนที่ใส่ลงช่องหน้า "ข้อมูลธุรกิจ" แล้วแต่ยังไม่บันทึก — บันทึกจากหน้านี้ได้เลยเหมือนแท็บ Style เดิม */}
      {section === 'style' && scanContextPending && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">ใส่ผลสแกนลงบริบทธุรกิจ / Style Guide / คำต้องห้ามแล้ว (ดูได้ที่หน้า Business &amp; Style Guide) — ยังไม่ได้บันทึก</p>
          {saveAllButton}
        </div>
      )}
      {/* ══ STYLE sub-tab ══════════════════════════════ */}
      {showStyleSettings && (
        <SmeStyleSettings
          projectId={project.id}
          website={project.website}
          themeColors={themeColorsRaw}
          accentColor={project.accentColor}
          onSaved={(tc) => { setThemeColorsRaw(tc); onSaved({ themeColors: tc }) }}
          onApplyContext={applyScanContext}
        />
      )}
      {(showBusinessBlock || showTestArticleBlock) && (
        <div className={section ? 'space-y-4' : 'flex flex-col lg:flex-row gap-4 lg:gap-6 items-start'}>
          {/* Left settings */}
          {showBusinessBlock && (
          <div className={section ? 'w-full space-y-4' : 'w-full lg:w-72 lg:shrink-0 space-y-4'}>
            {/* อ่านไฟล์ธุรกิจลูกค้า (CSV/PDF) — เติม Project Context + เขียนลง Business Skill ให้อัตโนมัติ */}
            <LabContextFilesCard
              projectId={project.id}
              onApply={(r) => {
                // ต่อท้ายข้อความเดิม ไม่ทับ — ทีมยังแก้ต่อได้ก่อนกดบันทึก
                setProjectContext((prev) => (prev.trim() ? `${prev}\n\n${r.projectContext}` : r.projectContext))
              }}
            />

            {/* Project Context — ข้อเท็จจริงของธุรกิจ (Setup Checklist ชี้มาที่นี่) */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-800">🏢 บริบทธุรกิจ (Project Context)</span>
                <span className="text-[10px] text-gray-400 ml-auto">AI ยึดเป็นข้อเท็จจริง ห้ามเขียนขัด</span>
              </div>
              <p className="text-[10px] text-gray-400 mb-2">ใส่ข้อมูลจริงของธุรกิจ: บริการ ราคา พื้นที่ จุดขาย ข้อจำกัด — กัน AI แต่งข้อมูลผิดในบทความ</p>
              <textarea value={projectContext} onChange={e => setProjectContext(e.target.value)}
                rows={5} placeholder={'เช่น\n- ร้านล้างแอร์ เปิด 08:00-18:00 ทุกวัน พื้นที่บริการ: บางแค ภาษีเจริญ หนองแขม\n- ราคาเริ่มต้น 400 บาท/เครื่อง ไม่มีบริการซ่อมคอมเพรสเซอร์\n- จุดขาย: ช่างได้ใบรับรอง, รับประกันงาน 30 วัน'}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-brand-soft/50" />
            </div>

            {/* Style Guide */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-800 flex-1">Style Guide (.md)</span>
                <button onClick={() => setStyleGuide(DEFAULT_STYLE_GUIDE)}
                  className="flex items-center gap-1 text-[10px] text-indigo-600 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50">
                  Default
                </button>
                <button onClick={() => styleFileRef.current?.click()}
                  className="flex items-center gap-1 text-[10px] text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50">
                  <Upload size={10} /> อัปโหลด
                </button>
                <input ref={styleFileRef} type="file" accept=".md,.txt" className="hidden" onChange={loadStyleMd} />
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Style Guide นี้จะถูกใช้กับบทความทุกชิ้นของ Client นี้ — แก้ไขได้เฉพาะหน้า Content Lab เท่านั้น
              </p>
              <textarea value={styleGuide} onChange={e => setStyleGuide(e.target.value)}
                placeholder={`วาง style.md หรืออัปโหลดไฟล์\n## Tone\n- เป็นกันเอง ให้ข้อมูล`}
                rows={8}
                className="w-full text-[11px] font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-y" />
              {styleGuide && (
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-400">{styleGuide.length.toLocaleString()} chars</span>
                  <button onClick={() => setStyleGuide('')} className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-0.5">
                    <X size={9} /> ล้าง
                  </button>
                </div>
              )}
            </div>

            {/* Forbidden Words */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="mb-2">
                <span className="text-xs font-semibold text-gray-800">คำต้องห้าม</span>
                <p className="text-[10px] text-gray-400 mt-0.5">1 บรรทัด = 1 คำ</p>
              </div>
              <textarea value={forbiddenWords} onChange={e => setForbiddenWords(e.target.value)}
                placeholder={'ดีที่สุด\nถูกที่สุด\nหมายเลข 1'}
                rows={4}
                className="w-full text-xs font-mono border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none" />
            </div>
          </div>
          )}

          {/* Right: Article Lab */}
          {showTestArticleBlock && (
          <div className="flex-1 min-w-0 space-y-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-bold text-brand-navy">Article Lab</div>
                {project.sampleArticle && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✅ มี Pattern บันทึกแล้ว</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-4">
                ใช้ <b>prompt ชุดเดียวกับตอนรันจริงทุกชั้น</b> (Business Skill → Master Prompt → Article Brief → Validator → Image Prompt) ของ client นี้
                — กด Generate แล้วระบบจะบันทึกค่า Article Lab ลง DB ให้ก่อน ผลลัพธ์จึงตรงกับหน้าบทความจริงเป๊ะ ๆ แล้ว Export HTML ส่งให้ลูกค้าตรวจได้เลย
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Keyword หลัก</label>
                  <input value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="เช่น รับทำ Google Ads"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Title (H1)</label>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="เช่น รับทำ Google Ads มืออาชีพ"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={generate} disabled={loading || !keyword.trim() || !title.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-blue text-white text-sm font-semibold rounded-xl hover:bg-brand-deep disabled:opacity-40 transition-colors">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                  {loading ? 'กำลัง Generate...' : 'Generate ด้วย Style นี้'}
                </button>
                {!html && project.sampleArticle && (
                  <button onClick={() => setHtml(project.sampleArticle!)}
                    className="text-xs text-brand-blue hover:text-blue-800 font-medium border border-blue-200 px-3 py-2 rounded-xl hover:bg-blue-50">
                    โหลด Pattern เดิม
                  </button>
                )}
              </div>
            </div>

            {loading && (
              <div className="bg-gray-950 text-emerald-400 rounded-2xl p-4 font-mono text-[11px] max-h-52 overflow-auto space-y-1">
                {stepMsg && <p className="text-blue-300 font-semibold animate-pulse">{stepMsg}</p>}
                {streamText && <><span className="text-gray-400">{streamText.slice(-900)}</span><span className="animate-pulse">▋</span></>}
                {!streamText && !stepMsg && <p className="text-gray-500 animate-pulse">กำลังเริ่มต้น...</p>}
              </div>
            )}

            {!loading && (
              <RestrictionWarningBox warnings={restrictionWarns} onDismiss={() => setRestrictionWarns([])} />
            )}

            {html && !loading && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="flex flex-wrap gap-2 items-center justify-between px-5 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <button onClick={() => setViewMode('preview')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'preview' ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-500'}`}>
                      Preview
                    </button>
                    <button onClick={() => setViewMode('code')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'code' ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-500'}`}>
                      HTML
                    </button>
                    {coverImageLab && (
                      <button onClick={() => setViewMode('cover')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${viewMode === 'cover' ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-500'}`}>
                        🖼️ รูปปก
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={generate} disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-xl hover:bg-gray-50">
                      <RefreshCw size={11} /> Regenerate
                    </button>
                    <button onClick={exportHtml}
                      title="ดาวน์โหลดไฟล์ HTML เดียวจบ (ฝังสี/CSS/Schema/รูปปก) — ส่งให้ลูกค้าตรวจก่อนรันจริง"
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 text-brand-blue text-xs font-semibold rounded-xl hover:bg-blue-50">
                      <Download size={11} /> Export HTML
                    </button>
                    <button onClick={saveAll} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                      {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                      {saved ? '✅ บันทึกแล้ว!' : 'บันทึกเป็น Pattern'}
                    </button>
                  </div>
                </div>
                {viewMode === 'code' && (
                  <textarea value={html} onChange={e => setHtml(e.target.value)}
                    className="w-full font-mono text-[11px] text-gray-200 bg-gray-950 p-5 min-h-[320px] sm:min-h-[500px] resize-y focus:outline-none"
                    spellCheck={false} />
                )}
                {viewMode === 'preview' && (
                  <div className="p-6 min-h-96 overflow-auto"
                    // บทความพื้นโปร่งใส — วางบนสีพื้นหน้าเว็บจริงจากการสแกน ไม่งั้นเว็บพื้นเข้มจะอ่านไม่ออก
                    style={articleColors.background === '' && /^#[0-9a-f]{3,8}$/i.test(articleColors.pageBackground ?? '') ? { backgroundColor: articleColors.pageBackground } : undefined}>
                    <iframe srcDoc={html} className="w-full border-0 min-h-[400px] sm:min-h-[600px]" sandbox="allow-same-origin" title="Article Preview" />
                  </div>
                )}
                {viewMode === 'cover' && coverImageLab && (
                  <div className="p-4 space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={11} /> รูปปกบทความ (Cover 1024×1024)</p>
                      <div className="relative group">
                        <img src={`data:${coverMimeTypeLab};base64,${coverImageLab}`} alt="cover" className="w-full rounded-xl overflow-hidden border border-gray-100" />
                        <a href={`data:${coverMimeTypeLab};base64,${coverImageLab}`} download="cover.webp"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-brand-navy/70 text-white text-[10px] px-2 py-1 rounded-lg flex items-center gap-1">
                          <Download size={10} /> ดาวน์โหลด
                        </a>
                      </div>
                    </div>
                    {midImageLab && (
                      <div>
                        <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1"><ImageIcon size={11} /> รูปประกอบบทความ (In-body 1200×630)</p>
                        <div className="relative group">
                          <img src={`data:${midMimeTypeLab};base64,${midImageLab}`} alt="mid" className="w-full rounded-xl overflow-hidden border border-gray-100" />
                          <a href={`data:${midMimeTypeLab};base64,${midImageLab}`} download="mid.webp"
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-brand-navy/70 text-white text-[10px] px-2 py-1 rounded-lg flex items-center gap-1">
                            <Download size={10} /> ดาวน์โหลด
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* ══ รูปภาพ sub-tab — หน้าตาเดียวกับ Upload Article ═══ */}
      {showImagesBlock && (
        labImages
          ? (
            <ImageSettingsEditor
              key={project.id}
              saved={labImages}
              autoOption
              intro="ตั้งค่ารูปปกและรูปประกอบที่ระบบสร้างให้ตอน Generate บทความของโปรเจกต์นี้"
              save={async (draft) => {
                const d = await putArticleSettings('images', draft) as ArticleImageSettings
                setLabImages(d)
                return d
              }}
            />
          )
          : <p className="text-xs text-gray-400 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> กำลังโหลด...</p>
      )}

      {/* ══ CTA sub-tab — หน้าตาเดียวกับ Upload Article ═══ */}
      {showCtaBlock && (
        <CtaSettingsEditor
          loadKey={project.id}
          load={async () => (await loadArticleSettings()).cta as UploadCtaSettings}
          save={async (slim) => {
            const d = await putArticleSettings('cta', slim) as UploadCtaSettings
            onSaved({ ctaSetting: JSON.stringify(d) })
            return d
          }}
          accentColor={articleColors.theme || accentColor}
          border={articleColors.border || '#e5e7eb'}
          description="CTA จะถูกแทรกในบทความอัตโนมัติทุกครั้งที่ Generate (เมื่อเปิดใช้งาน) — มีหลายชุดได้ ระบบสุ่มใช้ต่อบทความ"
        />
      )}

      {/* ══ AUTHOR sub-tab — หน้าตาเดียวกับ Upload Article (+ เพศ ใช้ปรับสรรพนามในบทความ) ═══ */}
      {showAuthorBlock && (
        <AuthorSettingsEditor
          loadKey={project.id}
          withGender
          load={async () => (await loadArticleSettings()).author as UploadAuthorSettings}
          save={async (slim) => {
            const d = await putArticleSettings('author', slim) as UploadAuthorSettings
            onSaved({ authors: JSON.stringify(d.authors), authorEnabled: d.enabled })
            return d
          }}
          description="แนบการ์ดผู้เขียนท้ายบทความ + ปรับโทนภาษาตามผู้เขียน — ถ้าบทความถูกกำหนดผู้เขียนไว้แล้วจะใช้คนนั้นก่อน"
        />
      )}

      {/* ══ SITELINK sub-tab ═══════════════════════════ */}
      {showLinksBlock && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-brand-navy">Internal Links</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    AI จะแทรก {ilLinksPerArticle} links ต่อบทความจากรายการนี้ — ใช้ URL เต็ม (https://...)
                  </p>
                </div>
                <button onClick={ilSave} disabled={ilSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 shrink-0">
                  {ilSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                  {ilSaved ? '✅ บันทึกแล้ว!' : 'บันทึก'}
                </button>
              </div>
            </div>

            {/* Controls row */}
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">GSC Property</span>
                {ilGscProperties.length > 1 ? (
                  <select value={ilGscSelected} onChange={e => setIlGscSelected(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300">
                    {ilGscProperties.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input value={ilGscSelected} onChange={e => setIlGscSelected(e.target.value)}
                    placeholder={project.gscSiteUrl ?? 'sc-domain:example.com'}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white font-mono focus:outline-none focus:ring-1 focus:ring-gray-300" />
                )}
                <button onClick={() => ilFetchGsc()} disabled={ilGscLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-semibold text-gray-600 rounded-xl hover:bg-white disabled:opacity-50 shrink-0">
                  <RefreshCw size={11} className={ilGscLoading ? 'animate-spin' : ''} /> ดึงจาก GSC
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">Keywords</span>
                <span className="flex-1 text-xs text-gray-400">ดึงจาก keyword list + articles ในโปรเจกต์นี้</span>
                <button onClick={ilFetchKeywords} disabled={ilKwLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-xs font-semibold text-gray-600 rounded-xl hover:bg-white disabled:opacity-50 shrink-0">
                  <Zap size={11} className={ilKwLoading ? 'animate-spin' : ''} /> ดึงจาก Keywords
                </button>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-semibold text-gray-600 shrink-0 w-28">Links / บทความ</span>
                <input type="text" value={ilLinksPerArticle} onChange={e => setIlLinksPerArticle(e.target.value)}
                  placeholder="3-5"
                  className="w-20 text-sm text-center border border-gray-200 rounded-lg px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                <span className="text-xs text-gray-400">เช่น <span className="font-mono">3</span> หรือ <span className="font-mono">3-10</span></span>
              </div>
            </div>

            {/* 3 separate tables */}
            <div className="divide-y divide-gray-100">

              {/* Table 1: GSC results */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">จาก GSC</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilGscLinks.filter(l => !ilExcluded.has(l.url)).length} / {ilGscLinks.length}</span>
                  {ilGscLoading && <RefreshCw size={11} className="animate-spin text-gray-400" />}
                </div>
                {ilGscLinks.length === 0 && !ilGscLoading ? (
                  <p className="text-xs text-gray-400 py-2">ยังไม่ได้ดึง — กด "ดึงจาก GSC" ด้านบน</p>
                ) : (
                  <div className="max-h-60 overflow-auto space-y-0.5">
                    {ilGscLinks.map((link, i) => {
                      const excluded = ilExcluded.has(link.url)
                      return (
                        <div key={i} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors ${excluded ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'}`}>
                          <button onClick={() => ilToggleExclude(link.url)}
                            className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${excluded ? 'border-gray-300 bg-white' : 'border-emerald-500 bg-emerald-500'}`}>
                            {!excluded && <span className="text-white text-[10px] leading-none">✓</span>}
                          </button>
                          <span className="text-xs text-gray-700 w-28 sm:w-40 shrink-0 truncate">{link.keyword}</span>
                          <span className="text-xs text-blue-500 font-mono truncate flex-1">{link.url}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Table 2: Keywords results */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">จาก Keywords</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilKwLinks.filter(l => !ilExcluded.has(l.url)).length} / {ilKwLinks.length}</span>
                  {ilKwLoading && <RefreshCw size={11} className="animate-spin text-gray-400" />}
                </div>
                {ilKwLinks.length === 0 && !ilKwLoading ? (
                  <p className="text-xs text-gray-400 py-2">ยังไม่ได้ดึง — กด "ดึงจาก Keywords" ด้านบน</p>
                ) : (
                  <div className="max-h-60 overflow-auto space-y-0.5">
                    {ilKwLinks.map((link, i) => {
                      const excluded = ilExcluded.has(link.url)
                      return (
                        <div key={i} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors ${excluded ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'}`}>
                          <button onClick={() => ilToggleExclude(link.url)}
                            className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${excluded ? 'border-gray-300 bg-white' : 'border-blue-500 bg-blue-500'}`}>
                            {!excluded && <span className="text-white text-[10px] leading-none">✓</span>}
                          </button>
                          <span className="text-xs text-gray-700 w-28 sm:w-40 shrink-0 truncate">{link.keyword}</span>
                          <span className="text-xs text-blue-500 font-mono truncate flex-1">{link.url}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Table 3: Manual links */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-700">เพิ่มเอง</span>
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ilManualLinks.filter(l => l.url.trim()).length}</span>
                </div>
                <div className="space-y-1 max-h-60 overflow-auto">
                  {ilManualLinks.map((link, i) => (
                    <div key={i} className="grid grid-cols-[1fr_2fr_2rem] items-center gap-2 group">
                      <input value={link.keyword} onChange={e => ilManualUpdate(i, 'keyword', e.target.value)}
                        placeholder="anchor text"
                        className="text-xs text-gray-800 border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
                      <input value={link.url} onChange={e => ilManualUpdate(i, 'url', e.target.value)}
                        placeholder="https://example.com/slug"
                        className="text-xs text-brand-blue font-mono border border-gray-100 focus:border-gray-300 rounded-lg px-2 py-1.5 w-full focus:outline-none" />
                      <button onClick={() => ilManualRemove(i)}
                        className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm leading-none text-center transition-all">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={ilManualAdd}
                  className="mt-2 w-full text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl py-2 hover:border-gray-400 hover:text-gray-600 transition-colors">
                  + เพิ่มลิงก์เอง
                </button>
              </div>

            </div>

            {/* Footer summary */}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                รวม <span className="font-bold text-gray-800">{ilMerged().length}</span> links (ไม่ซ้ำ ไม่รวมที่ unchecked)
                {ilSaved && <span className="ml-3 text-emerald-600 font-semibold">✅ บันทึกแล้ว</span>}
              </p>
              <button onClick={ilSave} disabled={ilSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                {ilSaving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                {ilSaved ? '✅ บันทึกแล้ว!' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ TEST IMAGE sub-tab ═════════════════════════ */}
      {showTestImageBlock && (
        <LabTestImageCard projectId={project.id} defaultKeyword={keywordRows[0]?.keyword ?? ''} />
      )}
    </div>
  )
}
