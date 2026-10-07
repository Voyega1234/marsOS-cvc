'use client'

/** แท็บ Push ของ SEO SME — หน้าตา/พฤติกรรมเหมือน Upload Article > Push
 * แต่ยังใช้ backend เดิมของ SME (/api/push/publish, /api/articles, /api/projects/[id]/request-index) */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Globe, ExternalLink, Send, AlertTriangle, ChevronDown, ChevronRight, SearchCheck, Loader2, CheckCircle2, XCircle, RefreshCw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseArticleCards, assembleArticleHtml, type ParsedArticle } from '@/lib/articleCards'
import type { UploadSiteScan } from '@/lib/upload-article/types'

type WpStatus = 'idle' | 'connecting' | 'connected' | 'error'
type PushStatus = 'idle' | 'pushing' | 'done' | 'error'

export interface SmePushJob {
  entryIdx: number
  keyword: string
  title: string
  slug: string
  status: PushStatus
  postId?: number
  postUrl?: string
  error?: string
  pushedAt?: string
}

export interface SmeWpConnection { id: string; name: string; siteUrl: string; username: string }

type ReadyPushItem = {
  entryIdx: number; title: string; keyword: string; slug: string
  html: string; coverImage: string; coverMimeType: string
}
type DbArticleLite = {
  id: string; wordpressUrl?: string | null
  title?: string; slug?: string; status?: string; htmlContent?: string
  keyword?: { keyword?: string } | null
}
type PushPrefsState = { excludeCards?: Record<string, boolean>; stripH1?: boolean; autoRequestIndex?: boolean }
type IndexRec = { url: string; at: string; ok: boolean; error?: string }

// ชนิดขั้นต่ำที่แท็บนี้ใช้ (ชนิดจริงใน ClientDetailTabs เป็น superset — assign ได้ตรง ๆ)
type SmeProject = { id: string; wordpressConnectionId?: string | null }
type SmeTimelineEntry = {
  title: string; keyword: string; slug?: string; page_type?: string
  reviewSeoTitle?: string; reviewMetaDescription?: string
}
type SmeArticleJob = {
  entryIdx: number; keyword: string; title: string
  status: string; html: string; coverImage: string; coverMimeType: string; slug?: string
}

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  title: { label: 'หัวเรื่อง', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  toc: { label: 'สารบัญ', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  content: { label: 'เนื้อหา', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  cta: { label: 'CTA', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  faq: { label: 'FAQ', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
}
const NOT_PUSHABLE = new Set(['POSTED', 'PUBLISHED', 'WORDPRESS_DRAFTED'])
const fmtDate = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function SmePushTab({
  project, timeline, jobs,
  wpConnections, setWpConnections, selectedConnId, setSelectedConnId,
  pushJobs, setPushJobs, onOpenWebsiteSettings,
}: {
  project: SmeProject
  timeline: SmeTimelineEntry[]
  jobs: SmeArticleJob[]
  wpConnections: SmeWpConnection[]
  setWpConnections: (c: SmeWpConnection[]) => void
  selectedConnId: string
  setSelectedConnId: (id: string) => void
  pushJobs: SmePushJob[]
  setPushJobs: React.Dispatch<React.SetStateAction<SmePushJob[]>>
  /** เปิด Project Settings › Website ของ client นี้ */
  onOpenWebsiteSettings?: () => void
}) {
  const [wpStatus, setWpStatus] = useState<WpStatus>('idle')
  const [wpInfo, setWpInfo] = useState<{ url: string; name: string; version: string; source?: string } | null>(null)
  const [wpError, setWpError] = useState('')
  const [publishMode, setPublishMode] = useState<'draft' | 'publish'>('draft')
  const [useElementor, setUseElementor] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  /** ประเภทหน้าต่อบทความ: auto = ดู page_type จาก timeline */
  const [globalType, setGlobalType] = useState<'auto' | 'post' | 'page'>('auto')
  const [wpTypeOverride, setWpTypeOverride] = useState<Record<number, 'auto' | 'post' | 'page'>>({})
  const [cardSel, setCardSel] = useState<Record<number, Record<string, boolean>>>({})
  const [openCardsIdx, setOpenCardsIdx] = useState<Set<number>>(new Set())
  const [pushPrefs, setPushPrefs] = useState<PushPrefsState>({})
  const [siteScan, setSiteScan] = useState<UploadSiteScan | null>(null)
  const [indexRequests, setIndexRequests] = useState<Record<string, IndexRec>>({})
  const [indexBusy, setIndexBusy] = useState<Record<string, boolean>>({})
  const [savingConn, setSavingConn] = useState(false)
  const [dbArticles, setDbArticles] = useState<DbArticleLite[]>([])
  /** โหมดที่ push ล่าสุดในเซสชันนี้ (entryIdx → draft/publish) ไว้ทำป้ายสถานะ */
  const [pushedMode, setPushedMode] = useState<Record<number, 'draft' | 'publish'>>({})

  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${project.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return
        try {
          const pp = JSON.parse(d.pushPrefs || '{}')
          setPushPrefs({ excludeCards: pp.excludeCards, stripH1: pp.stripH1, autoRequestIndex: pp.autoRequestIndex })
          if (pp.indexRequests && typeof pp.indexRequests === 'object') setIndexRequests(pp.indexRequests)
          if (pp.siteScan && typeof pp.siteScan === 'object' && pp.siteScan.components) setSiteScan(pp.siteScan)
        } catch { /* default */ }
      })
      .catch(() => {})
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  /** ส่งเฉพาะ 3 key นี้ — server merge ทับของเดิม และเก็บ siteScan/indexRequests ไว้เอง */
  const savePushPrefs = (next: PushPrefsState) => {
    setPushPrefs(next)
    const body = { excludeCards: next.excludeCards, stripH1: next.stripH1, autoRequestIndex: next.autoRequestIndex }
    fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushPrefs: JSON.stringify(body) }),
    }).catch(() => {})
  }

  const connections = wpConnections
  useEffect(() => {
    if (connections.length > 0) {
      if (project.wordpressConnectionId && !selectedConnId) setSelectedConnId(project.wordpressConnectionId)
      return
    }
    fetch('/api/settings/wordpress')
      .then(r => (r.ok ? r.json() : []))
      .then((data: SmeWpConnection[]) => {
        setWpConnections(data)
        if (project.wordpressConnectionId) setSelectedConnId(project.wordpressConnectionId)
        else if (data.length === 1) setSelectedConnId(data[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetch(`/api/articles?projectId=${project.id}`)
      .then(r => (r.ok ? r.json() : []))
      .then(arts => setDbArticles(Array.isArray(arts) ? arts : []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveConnection() {
    setSavingConn(true)
    await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wordpressConnectionId: selectedConnId || null }),
    }).catch(() => {})
    setSavingConn(false)
  }

  async function handleConnect() {
    setWpStatus('connecting'); setWpError(''); setWpInfo(null)
    try {
      const res = await fetch('/api/push/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, connectionId: selectedConnId || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setWpStatus('error'); setWpError(data.error ?? 'เชื่อมต่อไม่ได้'); return }
      setWpStatus('connected')
      setWpInfo({ url: data.url, name: data.name, version: data.version, source: data.source })
      if (selectedConnId) handleSaveConnection()
    } catch (e) {
      setWpStatus('error'); setWpError(String(e))
    }
  }

  // บทความพร้อม push = session jobs (มีรูปที่เจน) + DB (รอดตอนรีเฟรช) — รวมกันเหมือนเดิม
  const readyArticles: ReadyPushItem[] = (() => {
    const byEntry = new Map<number, ReadyPushItem>()
    for (const j of jobs) {
      if (j.html && (j.status === 'done' || j.status === 'review' || j.status === 'approved')) {
        byEntry.set(j.entryIdx, {
          entryIdx: j.entryIdx, title: j.title, keyword: j.keyword, slug: j.slug ?? '',
          html: j.html, coverImage: j.coverImage ?? '', coverMimeType: j.coverMimeType ?? 'image/webp',
        })
      }
    }
    for (const a of dbArticles) {
      if (!a.htmlContent || NOT_PUSHABLE.has(a.status ?? '')) continue
      const entryIdx = timeline.findIndex(t => (t.title ?? '').trim() === (a.title ?? '').trim())
      if (entryIdx < 0 || byEntry.has(entryIdx)) continue
      byEntry.set(entryIdx, {
        entryIdx,
        title: a.title ?? timeline[entryIdx]?.title ?? '',
        keyword: a.keyword?.keyword ?? timeline[entryIdx]?.keyword ?? '',
        slug: a.slug ?? timeline[entryIdx]?.slug ?? '',
        html: a.htmlContent, coverImage: '', coverMimeType: 'image/webp',
      })
    }
    return Array.from(byEntry.values())
  })()

  const parsedMap = useMemo(() => {
    const map = new Map<number, ParsedArticle>()
    for (const j of readyArticles) { if (j.html) map.set(j.entryIdx, parseArticleCards(j.html)) }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyArticles.map(j => `${j.entryIdx}:${j.html.length}`).join('|')])

  function isCardOn(entryIdx: number, cardId: string): boolean {
    const card = parsedMap.get(entryIdx)?.cards.find(c => c.id === cardId)
    if (!card) return false
    const explicit = cardSel[entryIdx]?.[cardId]
    if (explicit !== undefined) return explicit
    if (pushPrefs.excludeCards?.[card.type]) return false
    return !card.derived
  }

  function toggleCard(entryIdx: number, cardId: string) {
    const nextOn = !isCardOn(entryIdx, cardId)
    setCardSel(prev => ({ ...prev, [entryIdx]: { ...(prev[entryIdx] ?? {}), [cardId]: nextOn } }))
    const card = parsedMap.get(entryIdx)?.cards.find(c => c.id === cardId)
    if (card && ['toc', 'cta', 'faq'].includes(card.type)) {
      savePushPrefs({ ...pushPrefs, excludeCards: { ...(pushPrefs.excludeCards ?? {}), [card.type]: !nextOn } })
    }
  }

  function htmlForPush(entryIdx: number, originalHtml: string): string {
    const parsed = parsedMap.get(entryIdx)
    if (!parsed) return originalHtml
    const untouched = parsed.cards.every(c => isCardOn(entryIdx, c.id) === !c.derived)
    if (untouched) return originalHtml
    const ids = new Set(parsed.cards.filter(c => isCardOn(entryIdx, c.id)).map(c => c.id))
    return assembleArticleHtml(parsed, ids)
  }

  function getWpPostType(entryIdx: number): 'post' | 'page' {
    const o = wpTypeOverride[entryIdx] ?? globalType
    if (o === 'post' || o === 'page') return o
    const entry = timeline[entryIdx]
    const pt = entry?.page_type ?? (entry as unknown as { kw_page_type?: string })?.kw_page_type ?? ''
    return /service|page|core/i.test(pt) ? 'page' : 'post'
  }

  const findDbArticle = (title: string) => dbArticles.find(a => (a.title ?? '').trim() === (title ?? '').trim())
  const getPushJob = (entryIdx: number) => pushJobs.find(p => p.entryIdx === entryIdx)

  async function handlePush(entryIdx: number) {
    const job = readyArticles.find(j => j.entryIdx === entryIdx)
    if (!job?.html) return
    const entry = timeline[entryIdx]
    const title = entry?.title ?? job.title ?? ''
    const keyword = entry?.keyword ?? job.keyword ?? ''
    const slug = entry?.slug || job.slug || ''
    const reviewMetaTitle = entry?.reviewSeoTitle?.trim() ?? ''
    const reviewMetaDesc = entry?.reviewMetaDescription?.trim() ?? ''
    const coverImage = job.coverImage ?? ''
    const coverMimeType = job.coverMimeType ?? 'image/webp'

    setPushJobs(prev => [...prev.filter(p => p.entryIdx !== entryIdx), { entryIdx, keyword, title, slug, status: 'pushing' }])
    try {
      const res = await fetch('/api/push/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, html: htmlForPush(entryIdx, job.html), title, keyword, slug, coverImage, coverMimeType, metaTitle: reviewMetaTitle, metaDescription: reviewMetaDesc, publishMode, useElementor, wpPostType: getWpPostType(entryIdx), connectionId: selectedConnId || undefined, stripH1: pushPrefs.stripH1 ?? true, autoRequestIndex: pushPrefs.autoRequestIndex !== false }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setPushJobs(prev => prev.map(p => p.entryIdx === entryIdx ? { ...p, status: 'error', error: data.error ?? 'Push ล้มเหลว' } : p))
        toast.error(`Push ไม่สำเร็จ: ${data.error ?? res.status}`)
        return
      }
      setPushJobs(prev => prev.map(p => p.entryIdx === entryIdx
        ? { ...p, status: 'done', postId: data.postId, postUrl: data.postUrl, pushedAt: new Date().toISOString() } : p))
      setPushedMode(prev => ({ ...prev, [entryIdx]: publishMode }))
      toast.success('Push สำเร็จ')
      if (data.indexRequest) {
        if (data.indexRequest.ok) toast.success('ส่ง Request Index ให้ Google แล้ว')
        else toast.warning(`Push สำเร็จ แต่ Request Index ไม่สำเร็จ: ${data.indexRequest.error ?? 'ไม่ทราบสาเหตุ'}`)
      }
      // บันทึก wordpressUrl กลับ DB ให้แท็บ Publish เห็น — ล้มต้องแจ้ง ไม่กลืนเงียบ
      if (data.postUrl && title) {
        try {
          const wb = await fetch('/api/articles/by-title', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, title, wordpressUrl: data.postUrl, status: publishMode === 'publish' ? 'POSTED' : 'WORDPRESS_DRAFTED' }),
          })
          if (!wb.ok) throw new Error(`HTTP ${wb.status}`)
        } catch (e) {
          toast.error(`ขึ้นเว็บสำเร็จ แต่บันทึกสถานะลงฐานข้อมูลไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — แท็บ Publish จะยังไม่ขึ้นรายการนี้`)
        }
      }
      // รีเฟรชรายการบทความ (ได้ id ของ Article ใหม่) + ผล Request Index
      fetch(`/api/articles?projectId=${project.id}`).then(r => (r.ok ? r.json() : null)).then(arts => {
        if (Array.isArray(arts)) setDbArticles(arts)
      }).catch(() => {})
      fetch(`/api/projects/${project.id}`).then(r => (r.ok ? r.json() : null)).then(d => {
        try { const pp = JSON.parse(d?.pushPrefs || '{}'); if (pp.indexRequests) setIndexRequests(pp.indexRequests) } catch { /* ignore */ }
      }).catch(() => {})
    } catch (e) {
      setPushJobs(prev => prev.map(p => p.entryIdx === entryIdx ? { ...p, status: 'error', error: String(e) } : p))
      toast.error(`Push ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleRequestIndex(articleId: string) {
    if (indexBusy[articleId]) return
    setIndexBusy(prev => ({ ...prev, [articleId]: true }))
    try {
      const r = await fetch(`/api/projects/${project.id}/request-index`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articleId }),
      })
      const d = await r.json().catch(() => ({}))
      if (d.indexRequests) setIndexRequests(d.indexRequests)
      if (r.ok && d.ok) toast.success('ส่ง Request Index ให้ Google แล้ว')
      else toast.error(`Request Index ไม่สำเร็จ: ${d?.error || r.status}`)
    } catch (e) {
      toast.error(`Request Index ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIndexBusy(prev => ({ ...prev, [articleId]: false }))
    }
  }

  async function handlePushSelected() {
    if (batchBusy) return
    setBatchBusy(true)
    try {
      for (const idx of Array.from(selectedIdx)) await handlePush(idx) // ทีละบทความ
    } finally {
      setBatchBusy(false)
    }
  }

  function toggleSelect(idx: number) {
    setSelectedIdx(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })
  }
  const allSelected = readyArticles.length > 0 && readyArticles.every(j => selectedIdx.has(j.entryIdx))
  function toggleSelectAll() {
    setSelectedIdx(allSelected ? new Set() : new Set(readyArticles.map(j => j.entryIdx)))
  }

  const connected = wpStatus === 'connected'
  const selConn = connections.find(x => x.id === selectedConnId)

  return (
    <div className="space-y-4 w-full">
      {/* ─── Settings card ─── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5">
              <Globe size={14} /> WordPress Connection
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">ใช้ค่าที่ตั้งไว้ใน Project Settings › Website ของ client นี้</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleConnect} disabled={wpStatus === 'connecting'}>
            {wpStatus === 'connecting' ? <RefreshCw size={12} className="mr-1.5 animate-spin" /> : connected ? <CheckCircle2 size={12} className="mr-1.5 text-emerald-600" /> : <Globe size={12} className="mr-1.5" />}
            {wpStatus === 'connecting' ? 'กำลังเชื่อมต่อ...' : connected ? 'Connected' : 'Test Connect'}
          </Button>
        </div>

        {connections.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <select value={selectedConnId} onChange={e => setSelectedConnId(e.target.value)}
              className="h-8 flex-1 min-w-[220px] rounded-md border border-gray-200 px-2 text-xs bg-white">
              <option value="">— ไม่เลือก (ใช้ Project Settings หรือ .env) —</option>
              {connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.siteUrl})</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={handleSaveConnection} disabled={savingConn}>
              {savingConn ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
            {selConn && (
              <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <CheckCircle2 size={11} className="text-emerald-500" />
                <span className="font-mono">{selConn.siteUrl}</span> · User: {selConn.username}
              </span>
            )}
          </div>
        ) : (
          <button type="button" onClick={onOpenWebsiteSettings} className="text-xs text-brand-blue hover:underline flex items-center gap-1.5">
            <Settings size={12} /> ยังไม่มี WordPress connection — ตั้งค่าที่ Project Settings › Website
          </button>
        )}

        {wpStatus === 'connected' && wpInfo && (
          <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {wpInfo.name} · {wpInfo.url} · WordPress {wpInfo.version} ·{' '}
            {wpInfo.source === 'connection' ? 'ใช้การเชื่อมต่อกลางเดิม' : wpInfo.source === 'project' ? 'ใช้ Project Settings' : 'ใช้ .env'}
          </p>
        )}
        {wpStatus === 'error' && wpError && (
          <p className="text-[11px] text-rose-600 flex items-center gap-1.5"><XCircle size={12} /> {wpError}</p>
        )}

        <div className="flex flex-wrap gap-4 text-xs pt-1">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === 'draft'} onChange={() => setPublishMode('draft')} /> Draft
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={publishMode === 'publish'} onChange={() => setPublishMode('publish')} /> Publish
          </label>
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1.5" title="Auto = ดู page_type จาก timeline (service/page/core = Page)">
            <input type="radio" checked={globalType === 'auto'} onChange={() => setGlobalType('auto')} /> Auto
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={globalType === 'post'} onChange={() => setGlobalType('post')} /> Post
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={globalType === 'page'} onChange={() => setGlobalType('page')} /> Page
          </label>
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useElementor} onChange={e => setUseElementor(e.target.checked)} /> Elementor
          </label>
          <label className="flex items-center gap-1.5" title="เว็บส่วนใหญ่แสดง H1 จาก post title อยู่แล้ว — เปิดไว้กันหัวเรื่องซ้ำ (จำค่าต่อโปรเจกต์)">
            <input type="checkbox" checked={pushPrefs.stripH1 ?? true}
              onChange={e => savePushPrefs({ ...pushPrefs, stripH1: e.target.checked })} /> ตัด H1
          </label>
          <label className="flex items-center gap-1.5" title="หลัง Push แบบ Publish สำเร็จ ส่ง URL ให้ Google Indexing API อัตโนมัติ (จำค่าต่อโปรเจกต์)">
            <input type="checkbox" checked={pushPrefs.autoRequestIndex !== false}
              onChange={e => savePushPrefs({ ...pushPrefs, autoRequestIndex: e.target.checked })} /> Request Index อัตโนมัติหลัง Publish
          </label>
        </div>
        {publishMode === 'publish' && <p className="text-[11px] text-amber-600">จะ Publish บทความขึ้น Live ทันที</p>}

        {/* ผลสแกนเว็บปลายทาง (อ่านอย่างเดียว) */}
        <div className="border border-gray-100 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[11px] font-semibold text-gray-600">ผลสแกนเว็บปลายทาง (ตั้งค่าที่แท็บ Article Lab &gt; Style)</p>
          {siteScan ? (
            <div className="flex flex-wrap gap-2">
              {(['toc', 'faq', 'cta'] as const).map(k => {
                const f = siteScan.components[k]
                const label = k === 'toc' ? 'สารบัญ' : k.toUpperCase()
                const auto = f?.where === 'auto'
                return (
                  <span key={k} title={f?.source || undefined}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${auto ? 'bg-rose-50 text-rose-700 border-rose-200' : f?.found ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    {label}: {auto ? `เว็บใส่ให้ทุกบทความเอง${f.source ? ` (${f.source})` : ''} — ไม่ควร push` : f?.found ? 'พบในบางบทความ/หน้าเว็บ' : 'เว็บยังไม่มี'}
                  </span>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">ยังไม่ได้สแกนเว็บปลายทาง — ไปสแกนที่แท็บ Article Lab &gt; Style</p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" disabled={!selectedIdx.size || batchBusy || !connected} onClick={handlePushSelected}>
            <Send size={12} className="mr-1.5" /> {batchBusy ? 'กำลัง Push...' : `Push ที่เลือก (${selectedIdx.size})`}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /> เลือกทั้งหมด ({readyArticles.length})
          </label>
          {!connected && <span className="text-[11px] text-gray-400">กด Test Connect ก่อนจึงจะ Push ได้</span>}
        </div>
      </div>

      {/* ─── Article cards ─── */}
      <div className="space-y-3">
        {readyArticles.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10 bg-white border border-gray-200 rounded-xl">ยังไม่มีบทความพร้อม Push — ไปที่แท็บ Article แล้ว Generate ก่อน</p>
        )}
        {readyArticles.map(job => {
          const entry = timeline[job.entryIdx]
          const pj = getPushJob(job.entryIdx)
          const dbA = findDbArticle(job.title)
          const parsed = parsedMap.get(job.entryIdx)
          const pushing = pj?.status === 'pushing'
          const liveUrl = (pj?.status === 'done' ? pj.postUrl : undefined) || dbA?.wordpressUrl || undefined
          const pushed = (pj?.status === 'done') || !!dbA?.wordpressUrl
          const isDraft = pj?.status === 'done' ? pushedMode[job.entryIdx] === 'draft' : dbA?.status === 'WORDPRESS_DRAFTED'
          const ir = dbA?.id ? indexRequests[dbA.id] : undefined
          const open = openCardsIdx.has(job.entryIdx)
          const offCount = parsed ? parsed.cards.filter(c => !c.derived && !isCardOn(job.entryIdx, c.id)).length : 0
          const featureCards = parsed ? parsed.cards.filter(c => c.type === 'toc' || c.type === 'faq' || c.type === 'cta') : []
          return (
            <div key={job.entryIdx} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <label className="flex items-start gap-2 min-w-0">
                  <input type="checkbox" checked={selectedIdx.has(job.entryIdx)} onChange={() => toggleSelect(job.entryIdx)} className="mt-1" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-navy truncate">{entry?.title ?? job.title}</p>
                    <p className="text-[11px] text-gray-400 truncate">{entry?.keyword ?? job.keyword}</p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        pushing ? 'bg-blue-100 text-blue-700'
                        : pj?.status === 'error' ? 'bg-rose-50 text-rose-600'
                        : pushed ? (isDraft ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')
                        : 'bg-gray-100 text-gray-500'}`}>
                        {pushing ? 'กำลัง Push...' : pj?.status === 'error' ? 'Push ไม่สำเร็จ' : pushed ? (isDraft ? 'Draft' : 'Push แล้ว') : 'ยังไม่ push'}
                      </span>
                      {liveUrl && (
                        <a href={liveUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:underline">
                          <ExternalLink size={9} /> เปิดโพสต์
                        </a>
                      )}
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={wpTypeOverride[job.entryIdx] ?? 'auto'}
                    onChange={e => setWpTypeOverride(prev => ({ ...prev, [job.entryIdx]: e.target.value as 'auto' | 'post' | 'page' }))}
                    title={`ประเภทที่จะ push: ${getWpPostType(job.entryIdx)}`}
                    className="h-8 rounded-md border border-gray-200 px-2 text-xs bg-white">
                    <option value="auto">ตามค่าด้านบน → {getWpPostType(job.entryIdx)}</option>
                    <option value="post">Post</option>
                    <option value="page">Page</option>
                  </select>
                  {pushed && dbA?.id && (
                    <Button size="sm" variant="outline" disabled={!!indexBusy[dbA.id]} onClick={() => handleRequestIndex(dbA.id)}>
                      {indexBusy[dbA.id] ? <Loader2 size={11} className="mr-1.5 animate-spin" /> : <SearchCheck size={11} className="mr-1.5" />}
                      {ir?.ok ? 'Request Index อีกครั้ง' : 'Request Index'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={!connected || pushing || batchBusy} onClick={() => handlePush(job.entryIdx)}>
                    {pushing ? 'กำลัง Push...' : pushed ? 'Push ซ้ำ' : 'Push'}
                  </Button>
                </div>
              </div>

              {ir && (
                <p className={`text-[11px] ${ir.ok ? 'text-emerald-600' : 'text-rose-500'}`} title={ir.ok ? undefined : ir.error}>
                  {ir.ok ? `ส่งแล้ว · ${fmtDate(ir.at)}` : `ไม่สำเร็จ: ${ir.error ?? ''}`}
                </p>
              )}
              {pj?.status === 'error' && pj.error && <p className="text-xs text-rose-500">{pj.error}</p>}

              {parsed && (
                <div className="border border-gray-100 rounded-lg">
                  <div className="flex items-center gap-1.5 flex-wrap px-2.5 py-1.5">
                    <button type="button" onClick={() => setOpenCardsIdx(prev => { const n = new Set(prev); if (n.has(job.entryIdx)) n.delete(job.entryIdx); else n.add(job.entryIdx); return n })}
                      className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-brand-navy">
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {parsed.cards.length} Cards{offCount ? ` (ไม่ push ${offCount})` : ''}
                    </button>
                    {featureCards.map(c => {
                      const on = isCardOn(job.entryIdx, c.id)
                      const chip = TYPE_CHIP[c.type]
                      const finding = c.type === 'toc' || c.type === 'faq' || c.type === 'cta' ? siteScan?.components[c.type] : undefined
                      return (
                        <button key={c.id} type="button" onClick={() => toggleCard(job.entryIdx, c.id)}
                          title={finding?.where === 'auto' ? 'เว็บใส่ให้ทุกบทความเองแล้ว — push ไปจะซ้อนกัน' : undefined}
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${on ? chip.cls : 'bg-gray-50 text-gray-400 border-gray-200 line-through'}`}>
                          {chip.label}{finding?.where === 'auto' ? ' ⚠' : ''}
                        </button>
                      )
                    })}
                  </div>
                  {open && (
                    <div className="divide-y divide-gray-100 border-t border-gray-100">
                      {parsed.cards.map(c => {
                        const on = isCardOn(job.entryIdx, c.id)
                        const chip = TYPE_CHIP[c.type] ?? TYPE_CHIP.content
                        const finding = c.type === 'toc' || c.type === 'faq' || c.type === 'cta' ? siteScan?.components[c.type] : undefined
                        return (
                          <label key={c.id} className={`flex items-start gap-2 px-2.5 py-2 cursor-pointer ${on ? '' : 'bg-gray-50/70'}`}>
                            <input type="checkbox" checked={on} onChange={() => toggleCard(job.entryIdx, c.id)} className="mt-0.5" />
                            <div className={`min-w-0 flex-1 ${on ? '' : 'opacity-50'}`}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${chip.cls}`}>{chip.label}</span>
                                <span className="text-xs font-semibold text-brand-navy truncate">{c.label}</span>
                                {c.derived && <span className="text-[10px] text-purple-500">ระบบสร้างให้ — ติ๊กเพื่อเพิ่ม</span>}
                              </div>
                              {finding?.where === 'auto' && (
                                <p className="text-[10px] text-rose-600 mt-0.5 flex items-center gap-1">
                                  <AlertTriangle size={10} /> ปลั๊กอิน/ธีมของเว็บใส่ให้ทุกบทความเองแล้ว{finding.source ? ` (${finding.source})` : ''} — push ไปจะซ้อนกัน
                                </p>
                              )}
                              {c.plainText && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{c.plainText}</p>}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
