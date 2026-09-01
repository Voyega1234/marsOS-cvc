'use client'

/**
 * Competitor Gap — แท็บเดียวจบในตัวเอง
 *
 * โครงหน้า: ฟอร์มสั้น ๆ → สถานะการสแกนตามจริง → รายงาน
 * รายงานมี 8 ส่วนย่อย (เป็น section ภายในหน้านี้เท่านั้น ไม่เพิ่มแท็บระดับระบบ)
 *
 * กติกาแสดงผล: ค่าไหนไม่มีข้อมูลจริงให้แสดง "—" ห้ามเดา
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/competitor-gap/locations'
import type {
  DomainInventory, GapAction, GapReport, GapSnapshot, KeywordGapRow, Priority, RunStep, StructureFinding, StructurePillar,
} from '@/lib/competitor-gap/types'
import { CONTENT_PAGE_TYPES } from '@/lib/competitor-gap/types'

type SectionId = 'overview' | 'start-here' | 'parity' | 'competitors' | 'page-gap' | 'keyword-gap' | 'opportunities' | 'structure' | 'surpass'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'overview',      label: 'ภาพรวม' },
  { id: 'start-here',    label: 'เริ่มตรงนี้' },
  { id: 'parity',        label: 'เท่าคู่แข่งหรือยัง' },
  { id: 'competitors',   label: 'คู่แข่ง' },
  { id: 'page-gap',      label: 'ช่องว่างหน้าเว็บ' },
  { id: 'keyword-gap',   label: 'ช่องว่างคีย์เวิร์ด' },
  { id: 'opportunities', label: 'โอกาสคอนเทนต์' },
  { id: 'structure',     label: 'โครงสร้างบทความ' },
  { id: 'surpass',       label: 'แซง Top 5' },
]

const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'bg-red-100 text-red-700 border-red-200',
  P1: 'bg-orange-100 text-orange-700 border-orange-200',
  P2: 'bg-amber-50 text-amber-700 border-amber-200',
  P3: 'bg-gray-100 text-gray-600 border-gray-200',
}

const ACTION_STYLE: Record<string, string> = {
  FIX: 'bg-red-50 text-red-700',
  UPGRADE: 'bg-blue-50 text-blue-700',
  CREATE: 'bg-green-50 text-green-700',
  REFRESH: 'bg-purple-50 text-purple-700',
  MERGE: 'bg-yellow-50 text-yellow-700',
  REVIEW: 'bg-gray-100 text-gray-700',
  KEEP: 'bg-gray-100 text-gray-700',
}

const KW_STATE_LABEL: Record<string, string> = {
  MISSING: 'ยังไม่มีอันดับ',
  WEAK: 'อันดับอ่อน',
  NEAR_WIN: 'จ่อหน้าแรก',
  WINNING: 'นำอยู่',
  DEFEND: 'ต้องตั้งรับ',
  UNIQUE_OPPORTUNITY: 'โอกาสเฉพาะเรา',
}

function fmt(v: number | null | undefined, suffix = ''): string {
  // ค่าอย่าง ETV มาเป็นทศนิยมยาว — ตัดเหลือ 1 ตำแหน่ง ไม่ปัดเป็นจำนวนเต็มเพื่อไม่บิดค่าจริง
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
}

/**
 * ส่วนต่างของ "เรา" เทียบกับค่าอ้างอิงในแถวเดียวกัน (median ของคู่แข่ง หรืออันดับคู่แข่งที่ดีที่สุด)
 *
 * สีบอกว่าดีขึ้นหรือแย่ลงเทียบกับค่าอ้างอิง ไม่ใช่เทียบกับรอบสแกนก่อนหน้า
 * ตัวเลขคำนวณจากค่าที่วัดได้จริงเท่านั้น — ถ้าฝั่งใดฝั่งหนึ่งไม่มีข้อมูล จะแสดง "—"
 * lowerIsBetter ใช้กับอันดับ (อันดับ 3 ดีกว่าอันดับ 9)
 */
function Delta({
  ours, reference, lowerIsBetter = false, suffix = '',
}: {
  ours: number | null | undefined
  reference: number | null | undefined
  lowerIsBetter?: boolean
  suffix?: string
}) {
  if (ours === null || ours === undefined || Number.isNaN(ours)) return <span className="text-gray-300">—</span>
  if (reference === null || reference === undefined || Number.isNaN(reference)) return <span className="text-gray-300">—</span>
  const diff = ours - reference
  if (diff === 0) return <span className="text-gray-400">= เท่ากัน</span>
  const better = lowerIsBetter ? diff < 0 : diff > 0
  const arrow = diff > 0 ? '▲' : '▼'
  const sign = diff > 0 ? '+' : '−'
  return (
    <span className={better ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
      {arrow} {sign}{Math.abs(diff).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}
    </span>
  )
}

function StatusDot({ status }: { status: RunStep['status'] }) {
  const cls =
    status === 'done' ? 'bg-green-500'
    : status === 'running' ? 'bg-brand-blue animate-pulse'
    : status === 'failed' ? 'bg-red-500'
    : status === 'skipped' ? 'bg-gray-300'
    : 'bg-gray-200'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />
}

interface RunStatus {
  runId: string
  status: 'running' | 'done' | 'error'
  phase: string
  steps: RunStep[]
  costUsd: number
  warnings: string[]
  error: string | null
  updatedAt: string
}

export default function CompetitorGapTab({ project }: { project: { id: string; website?: string | null } }) {
  const [website, setWebsite] = useState(project.website ?? '')
  const [keyword, setKeyword] = useState('')
  const [country, setCountry] = useState(DEFAULT_COUNTRY)
  const [manualCompetitors, setManualCompetitors] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [maxPages, setMaxPages] = useState(300)
  const [competitorCount, setCompetitorCount] = useState(5)
  const [includeKeywordGap, setIncludeKeywordGap] = useState(true)
  const [jsFallback, setJsFallback] = useState(true)

  const [report, setReport] = useState<GapReport | null>(null)
  const [history, setHistory] = useState<GapSnapshot[]>([])
  const [loadingReport, setLoadingReport] = useState(true)
  const [run, setRun] = useState<RunStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [section, setSection] = useState<SectionId>('overview')
  const cancelled = useRef(false)

  useEffect(() => () => { cancelled.current = true }, [])

  // โหลดเฉพาะรายงานที่แคชไว้ — ไม่เริ่มสแกนที่มีค่าใช้จ่ายเองตอนเปิดหน้า
  useEffect(() => {
    let alive = true
    fetch(`/api/competitor-gap/report?projectId=${encodeURIComponent(project.id)}`)
      .then(r => r.json())
      .then((d: { report: GapReport | null; history?: GapSnapshot[]; projectWebsite: string | null }) => {
        if (!alive) return
        if (Array.isArray(d.history)) setHistory(d.history)
        if (d.report) {
          setReport(d.report)
          setKeyword(d.report.input.keyword)
          setCountry(d.report.input.country)
          setWebsite(d.report.input.ourWebsite)
          setManualCompetitors((d.report.input.manualCompetitors ?? []).join('\n'))
        } else if (d.projectWebsite) {
          setWebsite(d.projectWebsite)
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingReport(false) })
    return () => { alive = false }
  }, [project.id])

  const startRun = useCallback(async () => {
    if (!keyword.trim()) { setFormError('กรุณาระบุคีย์เวิร์ดเป้าหมาย'); return }
    if (!website.trim()) { setFormError('กรุณาระบุเว็บไซต์ของเรา'); return }
    setFormError(null)
    setRunning(true)
    setRun(null)
    cancelled.current = false

    try {
      let res = await fetch('/api/competitor-gap/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          keyword: keyword.trim(),
          country,
          ourWebsite: website.trim(),
          manualCompetitors: manualCompetitors.split('\n').map(v => v.trim()).filter(Boolean),
          advanced: { maxPagesPerDomain: maxPages, competitorCount, includeKeywordGap, jsFallback },
        }),
      })
      let data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'เริ่มสแกนไม่สำเร็จ')
      setRun(data as RunStatus)

      // หนึ่ง request = หนึ่งเฟส — เดินต่อจนกว่าจะจบ
      let guard = 0
      while (!cancelled.current && (data as RunStatus).status === 'running' && guard < 60) {
        guard++
        res = await fetch('/api/competitor-gap/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: (data as RunStatus).runId }),
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'สแกนไม่สำเร็จ')
        if (cancelled.current) return
        setRun(data as RunStatus)
      }

      if ((data as RunStatus).status === 'done') {
        const r = await fetch(`/api/competitor-gap/report?projectId=${encodeURIComponent(project.id)}`).then(x => x.json())
        if (!cancelled.current && r.report) {
          setReport(r.report as GapReport)
          if (Array.isArray(r.history)) setHistory(r.history as GapSnapshot[])
          setSection('overview')
        }
      }
    } catch (e) {
      if (!cancelled.current) setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!cancelled.current) setRunning(false)
    }
  }, [keyword, website, country, project.id, maxPages, competitorCount, includeKeywordGap, jsFallback])

  const compDomains = report?.competitors.map(c => c.domain) ?? []

  return (
    <div className="space-y-6">
      {/* ── ฟอร์ม ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-brand-navy">Competitor Gap</h2>
            <p className="text-sm text-gray-500 mt-1">
              เทียบเว็บเรากับ Top 1–5 ของ Google บนคีย์เวิร์ดเป้าหมาย แล้วบอกว่าต้องแก้/เพิ่มอะไรถึงจะขึ้นไปอยู่ระดับเดียวกัน
            </p>
          </div>
          {report && (
            <div className="text-right text-xs text-gray-500 shrink-0">
              <div>สแกนล่าสุด</div>
              <div className="font-medium text-gray-700">{new Date(report.generatedAt).toLocaleString('th-TH')}</div>
              <div className="mt-1">ค่าใช้จ่ายดูรวมที่ Settings → AI Cost</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">เว็บไซต์ของเรา</label>
            <input value={website} onChange={e => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">คีย์เวิร์ดเป้าหมาย *</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)}
              placeholder="เช่น รับทำ SEO"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ประเทศ *</label>
            <select value={country} onChange={e => setCountry(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {COUNTRIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            คู่แข่งที่ระบุเอง (ไม่บังคับ) — บรรทัดละ 1 URL สูงสุด 5 เว็บ
          </label>
          <textarea value={manualCompetitors} onChange={e => setManualCompetitors(e.target.value)}
            rows={3} placeholder={'https://competitor-a.com\nhttps://competitor-b.co.th'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue/30" />
          <p className="text-xs text-gray-500 mt-1">
            ใส่ไม่ครบตามจำนวนคู่แข่งที่ตั้งไว้ ระบบจะเติมจาก Google Top N ให้เองด้วยกระบวนการเดิม · เว็บที่ปิดด้วยหน้าล็อกอิน (เช่น Facebook) สแกนไม่ได้ จะถูกข้าม
          </p>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={startRun} disabled={running}
            className="px-5 py-2.5 rounded-lg bg-brand-blue text-white text-sm font-medium disabled:opacity-50">
            {running ? 'กำลังสแกน…' : report ? 'สแกนใหม่' : 'เริ่มวิเคราะห์'}
          </button>
          <button onClick={() => setShowAdvanced(v => !v)} className="text-sm text-gray-500 hover:text-gray-700">
            ตั้งค่าขั้นสูง {showAdvanced ? '▲' : '▼'}
          </button>

        </div>

        {showAdvanced && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-brand-mist rounded-xl">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">หน้าที่ดึงสูงสุดต่อเว็บ</label>
              <input type="number" min={50} max={2000} value={maxPages}
                onChange={e => setMaxPages(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">จำนวนคู่แข่ง</label>
              <input type="number" min={3} max={5} value={competitorCount}
                onChange={e => setCompetitorCount(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
              <input type="checkbox" checked={includeKeywordGap} onChange={e => setIncludeKeywordGap(e.target.checked)} />
              ดึงข้อมูลคีย์เวิร์ด (มีค่าใช้จ่าย)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
              <input type="checkbox" checked={jsFallback} onChange={e => setJsFallback(e.target.checked)} />
              เปิด browser เฉพาะหน้าที่ต้องใช้ JS
            </label>
          </div>
        )}

        {formError && <div className="mt-3 text-sm text-red-600">{formError}</div>}
      </div>

      {/* ── สถานะการสแกน ── */}
      {run && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-brand-navy">สถานะการสแกน</h3>
            <span className="text-xs text-gray-500">
              {run.status === 'running' ? 'กำลังทำงาน' : run.status === 'done' ? 'เสร็จแล้ว' : 'หยุดกลางทาง'}
            </span>
          </div>
          <ol className="space-y-2">
            {run.steps.map(s => (
              <li key={s.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5"><StatusDot status={s.status} /></span>
                <span className="flex-1">
                  <span className={s.status === 'pending' ? 'text-gray-400' : 'text-gray-800'}>{s.label}</span>
                  {s.detail && <span className="block text-xs text-gray-500">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {run.error && <div className="mt-3 text-sm text-red-600">{run.error}</div>}
          {run.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-amber-700 list-disc pl-5 space-y-1">
              {run.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── รายงาน ── */}
      {loadingReport ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-sm text-gray-400">กำลังโหลด…</div>
      ) : !report ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <p className="text-gray-500">No Competitor Gap analysis yet.</p>
          <p className="text-xs text-gray-400 mt-2">ใส่คีย์เวิร์ดเป้าหมายแล้วกด “เริ่มวิเคราะห์” — ระบบจะไม่สแกนเองเพื่อคุมค่าใช้จ่าย</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap border ${
                  section === s.id ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {s.label}
              </button>
            ))}
          </div>

          {section === 'overview' && <OverviewSection report={report} compDomains={compDomains} />}
          {section === 'start-here' && <StartHereSection report={report} />}
          {section === 'parity' && <ParitySection report={report} history={history} />}
          {section === 'competitors' && <CompetitorsSection report={report} />}
          {section === 'page-gap' && <PageGapSection report={report} compDomains={compDomains} />}
          {section === 'keyword-gap' && <KeywordGapSection report={report} compDomains={compDomains} projectId={project.id} />}
          {section === 'opportunities' && <OpportunitiesSection report={report} projectId={project.id} />}
          {section === 'structure' && <StructureSection report={report} />}
          {section === 'surpass' && <SurpassSection report={report} />}
        </>
      )}
    </div>
  )
}

// ── เท่าคู่แข่งหรือยัง (parity checklist + ความคืบหน้าข้ามรอบ) ────────────────

/** หน้าเนื้อหาตามนิยามเดียวกับ snapshot ฝั่งเซิร์ฟเวอร์ — บทความ/ไกด์/เคส/คำศัพท์/เครื่องมือ */
function contentPagesOf(inv: DomainInventory): number {
  return CONTENT_PAGE_TYPES.reduce((s, t) => s + (inv.byType[t] ?? 0), 0)
}

/**
 * เป้าช่วงแรกของ SEO: "มี ≥ คู่แข่ง" ก่อน แล้วค่อยแซง
 * ตารางนี้ตอบตรง ๆ ต่อคู่แข่งแต่ละเจ้า: ขาดอีกกี่หน้า / กี่คำ ถึงจะเท่าเขา
 * ทุกตัวเลขมาจากผลสแกนจริง — มิติไหนไม่มีข้อมูล (เช่น ไม่ได้ดึงคีย์เวิร์ด) แสดง "—" ไม่นับแทน
 */
function ParitySection({ report, history }: { report: GapReport; history: GapSnapshot[] }) {
  const ours = report.domains.find(d => d.isOurs) ?? null
  const ourContent = ours ? contentPagesOf(ours) : null
  const kw = report.keywordGap
  const ourTop10 = kw.available
    ? kw.rows.filter(r => r.ourPosition !== null && r.ourPosition <= 10).length
    : null

  const rows = report.competitors.map((c, i) => {
    const theirContent = contentPagesOf(c.inventory)
    const theirTop10 = kw.available
      ? kw.rows.filter(r => { const p = r.competitorPositions[i]; return p !== null && p <= 10 }).length
      : null
    // คำที่เขาติด Top 10 แต่เรายังไม่ติด — จำนวนคำที่ต้องตามเก็บถึงจะเท่าเจ้านี้
    const kwDeficit = kw.available
      ? kw.rows.filter(r => {
          const p = r.competitorPositions[i]
          return p !== null && p <= 10 && !(r.ourPosition !== null && r.ourPosition <= 10)
        }).length
      : null
    const pageDeficit = ours ? Math.max(0, c.inventory.relevant - ours.relevant) : null
    const contentDeficit = ours !== null && ourContent !== null
      ? Math.max(0, theirContent - ourContent)
      : null
    const measured = [pageDeficit, contentDeficit, kwDeficit].filter(v => v !== null)
    const reached = measured.length > 0 && measured.every(v => v === 0)
    return { c, theirContent, theirTop10, kwDeficit, pageDeficit, contentDeficit, reached }
  })

  const comparableRows = rows.filter(r => r.c.comparable)
  const reachedCount = comparableRows.filter(r => r.reached).length
  const worstContent = comparableRows.reduce<typeof rows[number] | null>(
    (worst, r) => (r.contentDeficit !== null && (worst === null || (r.contentDeficit > (worst.contentDeficit ?? 0))) ? r : worst),
    null,
  )

  const latest = history.length > 0 ? history[history.length - 1] : null
  const prev = history.length > 1 ? history[history.length - 2] : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">คู่แข่งเทียบเคียงที่เราตามทันแล้ว</div>
          <div className="text-4xl font-bold text-brand-navy mt-1">
            {comparableRows.length === 0 ? '—' : `${reachedCount}/${comparableRows.length}`}
          </div>
          <div className="text-xs text-gray-400 mt-1">"ตามทัน" = มี ≥ เขาในทุกมิติที่วัดได้ (หน้า relevant · หน้าเนื้อหา · คำ Top 10)</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">ช่องว่างหน้าเนื้อหาที่กว้างที่สุด</div>
          <div className="text-4xl font-bold text-orange-600 mt-1">
            {worstContent === null || worstContent.contentDeficit === null ? '—' : fmt(worstContent.contentDeficit, ' หน้า')}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {worstContent === null ? 'ไม่มีคู่แข่งเทียบเคียงในรอบนี้' : `เทียบกับ ${worstContent.c.domain}`}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">คำที่เราติด Top 10 ตอนนี้</div>
          <div className="text-4xl font-bold text-brand-navy mt-1">{fmt(ourTop10)}</div>
          <div className="text-xs text-gray-400 mt-1">
            {kw.available ? 'นับจากข้อมูลอันดับจริงของรอบสแกนนี้' : 'รอบนี้ไม่ได้ดึงข้อมูลคีย์เวิร์ด — เปิดในตั้งค่าขั้นสูง'}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 overflow-x-auto">
        <h3 className="font-semibold text-brand-navy mb-1">Parity checklist ต่อคู่แข่ง</h3>
        <p className="text-xs text-gray-500 mb-4">
          เป้าช่วงแรก: มี ≥ คู่แข่งก่อน — คอลัมน์ "ขาดอีก" คือระยะทางที่เหลือถึงจะเท่าเจ้านั้น (0 = เท่าหรือนำแล้ว)
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">คู่แข่ง</th>
              <th className="py-2 px-3">หน้า relevant (เขา/เรา)</th>
              <th className="py-2 px-3">ขาดอีก</th>
              <th className="py-2 px-3">หน้าเนื้อหา (เขา/เรา)</th>
              <th className="py-2 px-3">ขาดอีก</th>
              <th className="py-2 px-3">คำ Top 10 (เขา/เรา)</th>
              <th className="py-2 px-3">คำที่ต้องตามเก็บ</th>
              <th className="py-2 px-3">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.c.domain} className="border-b border-gray-100">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-gray-800">{r.c.domain}</div>
                  {!r.c.comparable && <div className="text-[11px] text-gray-400">เทียบเคียงไม่ได้ (ไม่ใช่ธุรกิจแบบเดียวกัน) — ไม่ใช้ตั้งเป้า</div>}
                </td>
                <td className="py-2.5 px-3 tabular-nums">{fmt(r.c.inventory.relevant)} / {fmt(ours?.relevant ?? null)}</td>
                <td className="py-2.5 px-3 tabular-nums">
                  {r.pageDeficit === null ? '—' : r.pageDeficit === 0
                    ? <span className="text-green-600 font-medium">0</span>
                    : <span className="text-red-600 font-medium">{fmt(r.pageDeficit)}</span>}
                </td>
                <td className="py-2.5 px-3 tabular-nums">{fmt(r.theirContent)} / {fmt(ourContent)}</td>
                <td className="py-2.5 px-3 tabular-nums">
                  {r.contentDeficit === null ? '—' : r.contentDeficit === 0
                    ? <span className="text-green-600 font-medium">0</span>
                    : <span className="text-red-600 font-medium">{fmt(r.contentDeficit)}</span>}
                </td>
                <td className="py-2.5 px-3 tabular-nums">{fmt(r.theirTop10)} / {fmt(ourTop10)}</td>
                <td className="py-2.5 px-3 tabular-nums">
                  {r.kwDeficit === null ? '—' : r.kwDeficit === 0
                    ? <span className="text-green-600 font-medium">0</span>
                    : <span className="text-red-600 font-medium">{fmt(r.kwDeficit)}</span>}
                </td>
                <td className="py-2.5 px-3">
                  {r.reached
                    ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-green-100 text-green-700">≥ เจ้านี้แล้ว</span>
                    : <span className="px-2 py-0.5 rounded-full text-[11px] bg-orange-100 text-orange-700">ยังตามไม่ทัน</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-400 mt-3">
          จำนวนหน้าเป็นตัวชี้วัดความครอบคลุม ไม่ใช่คำสั่งให้ปั๊มหน้า — ดูว่าควรสร้าง/รวม/อัปเกรดหน้าไหนที่ "โอกาสคอนเทนต์"
          · "คำที่ต้องตามเก็บ" กดดูรายคำได้ที่ "ช่องว่างคีย์เวิร์ด"
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 overflow-x-auto">
        <h3 className="font-semibold text-brand-navy mb-1">ความคืบหน้าข้ามรอบสแกน</h3>
        <p className="text-xs text-gray-500 mb-4">เทียบรอบล่าสุดกับรอบก่อนหน้า — ดูว่า gap แคบลงจริงหรือไม่</p>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">ยังไม่มีประวัติ — ระบบเริ่มเก็บ snapshot ตั้งแต่รอบสแกนถัดไปเป็นต้นไป</p>
        ) : (
          <>
            {latest && prev && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="p-4 rounded-xl bg-brand-mist">
                  <div className="text-xs text-gray-500">ความพร้อมแข่งขัน</div>
                  <div className="text-2xl font-bold text-brand-navy">{fmt(latest.readiness)}</div>
                  <Delta ours={latest.readiness} reference={prev.readiness} />
                </div>
                <div className="p-4 rounded-xl bg-brand-mist">
                  <div className="text-xs text-gray-500">ห่างจากมาตรฐาน Top 5</div>
                  <div className="text-2xl font-bold text-brand-navy">{fmt(latest.gapToBaselinePct, '%')}</div>
                  <Delta ours={latest.gapToBaselinePct} reference={prev.gapToBaselinePct} lowerIsBetter suffix="%" />
                </div>
                <div className="p-4 rounded-xl bg-brand-mist">
                  <div className="text-xs text-gray-500">หน้าเนื้อหาของเรา</div>
                  <div className="text-2xl font-bold text-brand-navy">{fmt(latest.ourContentPages)}</div>
                  <Delta ours={latest.ourContentPages} reference={prev.ourContentPages} />
                </div>
                <div className="p-4 rounded-xl bg-brand-mist">
                  <div className="text-xs text-gray-500">คำที่เราติด Top 10</div>
                  <div className="text-2xl font-bold text-brand-navy">{fmt(latest.ourTop10Keywords)}</div>
                  <Delta ours={latest.ourTop10Keywords} reference={prev.ourTop10Keywords} />
                </div>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4">วันที่สแกน</th>
                  <th className="py-2 px-3">คีย์เวิร์ด</th>
                  <th className="py-2 px-3">ความพร้อม</th>
                  <th className="py-2 px-3">ห่าง Top 5</th>
                  <th className="py-2 px-3">หน้า relevant เรา</th>
                  <th className="py-2 px-3">หน้าเนื้อหาเรา</th>
                  <th className="py-2 px-3">คำ Top 10 เรา</th>
                  <th className="py-2 px-3">คำยังไม่มีอันดับ</th>
                  <th className="py-2 px-3">คลัสเตอร์ที่ขาด</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(s => (
                  <tr key={s.runId} className="border-b border-gray-100">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(s.generatedAt).toLocaleDateString('th-TH')}</td>
                    <td className="py-2 px-3">{s.keyword}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.readiness)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.gapToBaselinePct, '%')}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.ourRelevantPages)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.ourContentPages)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.ourTop10Keywords)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.keywordCounts?.MISSING ?? null)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmt(s.missingClusters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length === 1 && (
              <p className="text-xs text-gray-400 mt-3">มีรอบเดียว — สแกนรอบถัดไปจะเห็นว่าตัวเลขขยับทางไหน</p>
            )}
            <p className="text-[11px] text-gray-400 mt-2">
              คีย์เวิร์ดเป้าหมายต่างกัน = คนละสนามแข่ง เทียบแถวที่คีย์เวิร์ดเดียวกันเป็นหลัก
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── ภาพรวม ───────────────────────────────────────────────────────────────────

function OverviewSection({ report, compDomains }: { report: GapReport; compDomains: string[] }) {
  const cards = report.readinessBreakdown
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">ความพร้อมแข่งขัน</div>
          <div className="text-4xl font-bold text-brand-navy mt-1">
            {report.readiness === null ? '—' : report.readiness}<span className="text-lg text-gray-400">/100</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">คะแนนภายในของ MarsOS ไม่ใช่คะแนนจาก Google</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">ห่างจากมาตรฐาน Top 5</div>
          <div className="text-4xl font-bold text-orange-600 mt-1">{fmt(report.gapToBaselinePct, '%')}</div>
          <div className="text-xs text-gray-400 mt-1">เทียบกับ median ของคู่แข่งที่เทียบเคียงได้</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-xs text-gray-500">ปัญหาใหญ่ที่สุดตอนนี้</div>
          <div className="text-xl font-semibold text-brand-navy mt-2">{report.biggestProblem ?? '—'}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy mb-4">สรุปความครอบคลุมรายด้าน</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {cards.length === 0 && <div className="text-sm text-gray-400">ข้อมูลไม่พอคำนวณ — แสดง “—”</div>}
          {cards.map(c => (
            <div key={c.label} className="p-4 rounded-xl bg-brand-mist">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="text-2xl font-bold text-brand-navy">{c.coveragePct}%</div>
              <div className="text-[11px] text-gray-400">น้ำหนัก {c.weight}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 overflow-x-auto">
        <h3 className="font-semibold text-brand-navy mb-1">ตารางเทียบกับ Top 5</h3>
        <p className="text-xs text-gray-500 mb-4">{report.baselineBasis.note}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">ตัวชี้วัด</th>
              <th className="py-2 px-3">เรา</th>
              {compDomains.map(d => <th key={d} className="py-2 px-3 font-normal">{d}</th>)}
              <th className="py-2 px-3">Median</th>
              <th className="py-2 px-3">เรา vs median</th>
              <th className="py-2 px-3">ต้องเพิ่ม</th>
              <th className="py-2 px-3">ครอบคลุม</th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.map(m => (
              <tr key={m.key} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-700">
                  {m.label}
                  {m.key === 'relevant' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">ตัวหลัก</span>}
                  {m.key === 'totalIndexable' && <span className="ml-2 text-[10px] text-gray-400">(ขนาดเว็บ ไม่ใช้ตั้งเป้า)</span>}
                </td>
                <td className="py-2 px-3 font-medium text-brand-navy">{fmt(m.ours)}</td>
                {m.competitors.map((v, i) => <td key={i} className="py-2 px-3 text-gray-600">{fmt(v)}</td>)}
                <td className="py-2 px-3 font-medium">{fmt(m.median)}</td>
                <td className="py-2 px-3"><Delta ours={m.ours} reference={m.median} /></td>
                <td className="py-2 px-3 text-orange-600">{fmt(m.missingToBaseline)}</td>
                <td className="py-2 px-3">{fmt(m.coveragePct, '%')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CoverageDisclosure report={report} />
    </div>
  )
}

function CoverageDisclosure({ report }: { report: GapReport }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 className="font-semibold text-brand-navy mb-3">ความครอบคลุมของการสแกน</h3>
      <p className="text-xs text-gray-500 mb-3">ระบบไม่เคลมว่าสแกนได้ 100% — ตัวเลขด้านล่างคือสิ่งที่เก็บได้จริง</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">เว็บ</th>
              <th className="py-2 px-3">Sitemap</th>
              <th className="py-2 px-3">พบ URL</th>
              <th className="py-2 px-3">ดึงมา</th>
              <th className="py-2 px-3">สำเร็จ</th>
              <th className="py-2 px-3">redirect</th>
              <th className="py-2 px-3">index ไม่ได้</th>
              <th className="py-2 px-3">ถูกบล็อก</th>
              <th className="py-2 px-3">error</th>
              <th className="py-2 px-3">ความมั่นใจ</th>
            </tr>
          </thead>
          <tbody>
            {report.competitors.map(c => (
              <tr key={c.domain} className="border-b border-gray-100">
                <td className="py-2 pr-4">{c.domain}</td>
                <td className="py-2 px-3">{fmt(c.coverage.sitemapUrls)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.discovered)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.crawled)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.ok)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.redirects)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.nonIndexable)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.blocked)}</td>
                <td className="py-2 px-3">{fmt(c.coverage.errors)}</td>
                <td className="py-2 px-3">{c.coverage.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.warnings.length > 0 && (
        <ul className="mt-4 text-xs text-amber-700 list-disc pl-5 space-y-1">
          {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  )
}

// ── เริ่มตรงนี้ ──────────────────────────────────────────────────────────────

function ActionCard({ a }: { a: GapAction }) {
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className={`text-xs font-semibold px-2 py-1 rounded border ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${ACTION_STYLE[a.action] ?? 'bg-gray-100'}`}>{a.action}</span>
        <div className="flex-1">
          <div className="font-medium text-brand-navy">{a.title}</div>
          <div className="text-sm text-gray-600 mt-1">{a.reason}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 mt-2">
            <span>คีย์เวิร์ดหลัก: <b className="text-gray-700">{a.primaryKeyword ?? '—'}</b></span>
            <span>volume: {fmt(a.primaryKeywordVolume)}</span>
            <span>เจตนา: {a.searchIntent ?? '—'}</span>
            <span>ประเภทหน้า: {a.pageType ?? '—'}</span>
            <span>คู่แข่งมี: {a.competitorCoverage ?? '—'}</span>
            <span>ผลกระทบ: {a.impact}</span>
          </div>
          {(a.existingUrl || a.recommendedUrl) && (
            <div className="text-xs text-gray-500 mt-2">
              {a.existingUrl && <div>หน้าเดิม: <a href={a.existingUrl} target="_blank" rel="noreferrer" className="text-brand-blue break-all">{a.existingUrl}</a></div>}
              {a.recommendedUrl && a.recommendedUrl !== a.existingUrl && <div>URL แนะนำ: <span className="text-gray-700 break-all">{a.recommendedUrl}</span></div>}
            </div>
          )}
          {a.evidence.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer">หลักฐานที่ใช้ตัดสิน</summary>
              <ul className="text-xs text-gray-500 list-disc pl-5 mt-1 space-y-0.5">
                {a.evidence.map((e, i) => <li key={i} className="break-all">{e}</li>)}
              </ul>
            </details>
          )}
          {(a.topicsToCover.length > 0 || a.secondaryKeywords.length > 0 || a.internalLinks.length > 0 || a.differentiation) && (
            <details className="mt-1">
              <summary className="text-xs text-gray-500 cursor-pointer">รายละเอียดการทำ</summary>
              <div className="text-xs text-gray-600 mt-1 space-y-1">
                {a.secondaryKeywords.length > 0 && <div>คีย์เวิร์ดรอง: {a.secondaryKeywords.join(', ')}</div>}
                {a.topicsToCover.length > 0 && <div>หัวข้อที่ต้องมี: {a.topicsToCover.join(' · ')}</div>}
                {a.internalLinks.length > 0 && <div>ลิงก์ภายในที่ควรเชื่อม: {a.internalLinks.join(' · ')}</div>}
                {a.differentiation && <div>มุมที่ต่าง: {a.differentiation}</div>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function StartHereSection({ report }: { report: GapReport }) {
  const p1 = report.phase1
  const groups: { priority: Priority; label: string }[] = [
    { priority: 'P0', label: 'P0 — ปัญหาที่บล็อก SEO (ต้องแก้ก่อน)' },
    { priority: 'P1', label: 'P1 — งานที่ทำให้ทันมาตรฐาน Top 5' },
    { priority: 'P2', label: 'P2 — งานสนับสนุนที่มีมูลค่าสูง' },
    { priority: 'P3', label: 'P3 — ทำทีหลังได้' },
  ]
  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy">START HERE — ทำอะไรก่อน</h3>
        <p className="text-xs text-gray-500 mt-1">Phase 1: ไล่ให้ทันมาตรฐาน Top 5 ก่อน (ยังไม่ใช่ขั้นแซง)</p>
        {p1.summary && <p className="text-sm text-gray-700 mt-3">{p1.summary}</p>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
          {(['P0', 'P1', 'P2', 'P3'] as Priority[]).map(p => (
            <div key={p} className="p-3 rounded-xl bg-brand-mist text-center">
              <div className="text-xs text-gray-500">{p}</div>
              <div className="text-2xl font-bold text-brand-navy">{p1.counts[p] ?? 0}</div>
            </div>
          ))}
          <div className="p-3 rounded-xl bg-brand-mist text-center">
            <div className="text-xs text-gray-500">ครอบคลุมหลังทำ Phase 1</div>
            <div className="text-2xl font-bold text-green-600">{fmt(p1.projectedCoveragePct, '%')}</div>
            <div className="text-[10px] text-gray-400">จากช่องว่างที่แผนนี้ปิดจริง</div>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-3">
          ตอนนี้ครอบคลุม {report.readiness === null ? '—' : `${report.readiness}%`} ·
          ช่องว่าง {fmt(report.gapToBaselinePct, '%')} ·
          คีย์เวิร์ดที่ต้องจัดการ {report.keywordGap.available ? report.keywordGap.counts.MISSING + report.keywordGap.counts.NEAR_WIN + report.keywordGap.counts.WEAK : '—'}
        </div>
      </div>

      {p1.actions.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">
          ไม่พบงานที่ต้องทำจากข้อมูลที่เก็บได้
        </div>
      )}

      {groups.map(g => {
        const items = p1.actions.filter(a => a.priority === g.priority)
        if (items.length === 0) return null
        return (
          <div key={g.priority} className="bg-white border border-gray-200 rounded-2xl p-6">
            <h4 className="font-semibold text-brand-navy mb-4">{g.label} · {items.length} งาน</h4>
            <div className="space-y-3">
              {items.map(a => <ActionCard key={a.id} a={a} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── คู่แข่ง ──────────────────────────────────────────────────────────────────

function CompetitorsSection({ report }: { report: GapReport }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy mb-1">ผลออร์แกนิกที่ดึงมา</h3>
        <p className="text-xs text-gray-500 mb-3">แสดง Top 5 ตามจริง — เว็บที่ไม่ใช่ประเภทเดียวกับเรา (ไดเรกทอรี/ราชการ/ชุมชน) จะถูกยกเว้นจากการตั้งมาตรฐาน</p>
        <ol className="space-y-2 text-sm">
          {report.serp.all.slice(0, 10).map(e => (
            <li key={`${e.position}-${e.domain}`} className="flex items-center gap-3">
              <span className="w-6 text-gray-400">{e.position}</span>
              <span className="font-medium text-gray-800">{e.domain}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{e.kind}</span>
              {!e.comparable && <span className="text-xs text-amber-600">ไม่ใช้ตั้งมาตรฐาน</span>}
            </li>
          ))}
        </ol>
      </div>

      {report.competitors.map(c => (
        <div key={c.domain} className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-semibold text-brand-navy">
                {c.domain}
                {c.manual && (
                  <span className="ml-2 align-middle text-[11px] font-normal px-2 py-0.5 rounded-full bg-brand-mist text-brand-navy border border-gray-200">
                    ระบุเอง
                  </span>
                )}
              </h4>
              <div className="text-xs text-gray-500 mt-0.5">
                อันดับ {c.position === null ? 'ไม่ติด Top ที่ดึงมา' : fmt(c.position)} · ประเภท {c.kind} · {c.comparable ? 'ใช้ตั้งมาตรฐาน' : 'ไม่ใช้ตั้งมาตรฐาน'}
              </div>
            </div>
            <a href={c.rankingUrl ?? '#'} target="_blank" rel="noreferrer" className="text-xs text-brand-blue">หน้าที่ติดอันดับ</a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <Stat label="หน้าที่เกี่ยวข้อง" value={fmt(c.inventory.relevant)} />
            <Stat label="หน้าที่ index ได้" value={fmt(c.inventory.totalIndexable)} />
            <Stat label="คุณภาพเนื้อหา" value={fmt(c.inventory.contentQuality)} />
            <Stat label="คีย์เวิร์ดที่ติดอันดับ" value={fmt(c.inventory.organicKeywords)} />
            <Stat label="ทราฟฟิกประมาณการ" value={fmt(c.inventory.estimatedTraffic)} />
          </div>

          {c.topClusters.length > 0 && (
            <div className="text-xs text-gray-500 mt-3">หัวข้อเด่น: {c.topClusters.join(' · ')}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
            <Note title="ทำไมเขาชนะ" body={c.whyTheyWin} />
            <Note title="จุดอ่อนของเขา" body={c.whereWeak} />
            <Note title="สิ่งที่เราต้องมีให้ทัน" body={c.whatToMatch} />
            <Note title="สิ่งที่ไม่ควรลอก" body={c.doNotCopy} />
            <Note title="ทางที่เราจะดีกว่าได้" body={c.howToBeat} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-brand-mist">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-brand-navy">{value}</div>
    </div>
  )
}

function Note({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="p-3 rounded-xl border border-gray-100">
      <div className="text-xs font-medium text-gray-500">{title}</div>
      <div className="text-sm text-gray-700 mt-1">{body ?? '—'}</div>
    </div>
  )
}

// ── ช่องว่างหน้าเว็บ / หัวข้อ ────────────────────────────────────────────────

function PageGapSection({ report, compDomains }: { report: GapReport; compDomains: string[] }) {
  const stateLabel: Record<string, string> = {
    missing: 'ยังไม่มี', weak: 'มีแต่บาง', strong: 'ครอบคลุมดี', 'low-value': 'มูลค่าต่ำ',
  }
  const stateStyle: Record<string, string> = {
    missing: 'bg-red-50 text-red-700', weak: 'bg-amber-50 text-amber-700',
    strong: 'bg-green-50 text-green-700', 'low-value': 'bg-gray-100 text-gray-500',
  }
  const clusters = report.clusters.slice().sort((a, b) => b.competitorCoverage - a.competitorCoverage || b.medianPages - a.medianPages)
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy mb-1">ช่องว่างเชิงหัวข้อ</h3>
        <p className="text-xs text-gray-500 mb-4">
          เป้าหมายคือ “ครอบคลุมหัวข้อ” ไม่ใช่จำนวนหน้าเท่ากับคู่แข่ง — หัวข้อที่คู่แข่งมีกันหลายเจ้าคือสัญญาณที่หนักที่สุด
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">หัวข้อ</th>
                <th className="py-2 px-3">สถานะ</th>
                <th className="py-2 px-3">หน้าเรา</th>
                {compDomains.map(d => <th key={d} className="py-2 px-3 font-normal">{d}</th>)}
                <th className="py-2 px-3">median</th>
                <th className="py-2 px-3">เรา vs median</th>
                <th className="py-2 px-3">คู่แข่งที่มี</th>
                <th className="py-2 px-3">ประเภทหน้า</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map(c => (
                <tr key={c.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-4">
                    <div className="text-gray-800">{c.label}</div>
                    {c.sampleTitles.length > 0 && (
                      <div className="text-[11px] text-gray-400 line-clamp-2">{c.sampleTitles.slice(0, 2).join(' · ')}</div>
                    )}
                  </td>
                  <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded ${stateStyle[c.state]}`}>{stateLabel[c.state]}</span></td>
                  <td className="py-2 px-3 font-medium">{c.ourPages}</td>
                  {c.competitorPages.map((n, i) => <td key={i} className="py-2 px-3 text-gray-600">{n}</td>)}
                  <td className="py-2 px-3">{c.medianPages}</td>
                  <td className="py-2 px-3"><Delta ours={c.ourPages} reference={c.medianPages} /></td>
                  <td className="py-2 px-3">{c.competitorCoverage}/{c.comparableCount}</td>
                  <td className="py-2 px-3 text-gray-500">{c.dominantType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── ช่องว่างคีย์เวิร์ด ───────────────────────────────────────────────────────

const OPP_ACTION_LABEL: Record<string, string> = {
  CREATE_NEW: 'สร้างหน้าใหม่',
  ADD_TO_EXISTING: 'เสริมหน้าเดิม',
  MERGE_WITH_EXISTING_TOPIC: 'รวมกับหัวข้อเดิม',
  SEND_TO_KEYWORD_RESEARCH: 'ส่งเข้า Keyword Research',
  ADD_TO_EXISTING_KEYWORDS: 'เก็บเป็นคำที่มีอยู่แล้ว',
  ADD_TO_EXCLUDE: 'ใส่รายการไม่เอา',
  IGNORE: 'ข้าม',
  NEEDS_REVIEW: 'ต้องตรวจเอง',
}

const OPP_ACTION_STYLE: Record<string, string> = {
  CREATE_NEW: 'bg-green-50 text-green-700',
  ADD_TO_EXISTING: 'bg-blue-50 text-blue-700',
  MERGE_WITH_EXISTING_TOPIC: 'bg-yellow-50 text-yellow-700',
  SEND_TO_KEYWORD_RESEARCH: 'bg-indigo-50 text-indigo-700',
  ADD_TO_EXISTING_KEYWORDS: 'bg-gray-100 text-gray-700',
  ADD_TO_EXCLUDE: 'bg-red-50 text-red-700',
  IGNORE: 'bg-gray-100 text-gray-500',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700',
}

/** แถบความเสี่ยงกินกันเอง 0–100 ตามเกณฑ์เดียวกับฝั่ง Keyword Research */
function RiskCell({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined || Number.isNaN(score)) return <span className="text-gray-400">—</span>
  const band = score >= 80 ? { label: 'สูงมาก', cls: 'bg-red-50 text-red-700' }
    : score >= 60 ? { label: 'น่าจะซ้ำ', cls: 'bg-orange-50 text-orange-700' }
      : score >= 40 ? { label: 'ต้องตรวจ', cls: 'bg-amber-50 text-amber-700' }
        : { label: 'ต่ำ', cls: 'bg-green-50 text-green-700' }
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${band.cls}`}>{score} {band.label}</span>
}

function KeywordGapSection({ report, compDomains, projectId }: { report: GapReport; compDomains: string[]; projectId: string }) {
  const [filter, setFilter] = useState<string>('ALL')
  const [actionFilter, setActionFilter] = useState<string>('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const kg = report.keywordGap
  const rowsAll: KeywordGapRow[] = kg.available ? kg.rows : []

  const rows = rowsAll
    .filter(r => (filter === 'ALL' || r.state === filter))
    .filter(r => (actionFilter === 'ALL' || r.recommendedAction === actionFilter))
    .filter(r => !hidden.has(r.keyword))
  const hasOpportunity = rowsAll.some(r => r.recommendedAction)
  const shown = hasOpportunity
    ? [...rows].sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1)).slice(0, 200)
    : rows.slice(0, 200)

  const actionCounts = new Map<string, number>()
  rowsAll.forEach(r => { if (r.recommendedAction) actionCounts.set(r.recommendedAction, (actionCounts.get(r.recommendedAction) ?? 0) + 1) })

  const toggle = (k: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  const pageAllSelected = shown.length > 0 && shown.every(r => selected.has(r.keyword))
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (pageAllSelected) shown.forEach(r => next.delete(r.keyword))
    else shown.forEach(r => next.add(r.keyword))
    return next
  })

  const selectedRows = rowsAll.filter(r => selected.has(r.keyword))

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setNote(null)
    try {
      const res = await fetch('/api/keyword-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, source: 'competitor_gap', ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setNote(okText)
      setSelected(new Set())
    } catch (e) {
      setNote(`ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const addExisting = () => post({
    action: 'add_existing',
    entries: selectedRows.map(r => ({ keyword: r.keyword, url: r.ourUrl ?? r.existingUrl ?? null, kind: r.ourUrl ? 'page' : 'keyword' })),
  }, `เก็บเป็นคำที่มีอยู่แล้ว ${selectedRows.length} คำ`)

  const addExclude = () => post({
    action: 'add_exclude',
    entries: selectedRows.map(r => ({ keyword: r.keyword, mode: 'exact', reason: 'ตัดจาก Competitor Gap' })),
  }, `ใส่รายการไม่เอา ${selectedRows.length} คำ`)

  const sendToResearch = () => post({
    action: 'send_to_research',
    items: selectedRows.map(r => ({
      keyword: r.keyword,
      competitor: r.bestCompetitorDomain ?? null,
      intent: r.guardIntent ?? r.intent ?? null,
      topic: r.guardTopic ?? null,
      suggestedAction: r.recommendedAction ?? null,
      existingMatch: r.existingMatch ?? null,
      existingUrl: r.existingUrl ?? r.ourUrl ?? null,
      cannibalizationScore: r.cannibalizationRisk ?? null,
      volume: r.searchVolume ?? null,
    })),
  }, `ส่งเข้า Keyword Research ${selectedRows.length} คำ`)

  const ignore = () => {
    setHidden(prev => new Set([...Array.from(prev), ...selectedRows.map(r => r.keyword)]))
    setSelected(new Set())
    setNote('ซ่อนในหน้านี้แล้ว (ไม่ได้บันทึกถาวร)')
  }

  if (!kg.available) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">
        ไม่มีข้อมูลคีย์เวิร์ด{kg.note ? ` — ${kg.note}` : ''}
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 className="font-semibold text-brand-navy mb-1">คำแนะนำโอกาสคีย์เวิร์ด</h3>
      <p className="text-xs text-gray-500 mb-3">
        ข้อมูลอันดับและปริมาณค้นหาจาก DataForSEO — ช่องที่ไม่มีข้อมูลแสดง “—”
        {hasOpportunity ? ' · คู่แข่งติดอันดับคือหลักฐานว่ามีโอกาส ไม่ใช่หลักฐานว่าต้องสร้างหน้าใหม่' : ''}
      </p>

      <div className="flex flex-wrap gap-2 mb-2">
        {['ALL', ...Object.keys(kg.counts)].map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs px-3 py-1.5 rounded-lg border ${filter === k ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white text-gray-600 border-gray-200'}`}>
            {k === 'ALL' ? `ทั้งหมด (${kg.rows.length})` : `${KW_STATE_LABEL[k] ?? k} (${kg.counts[k as keyof typeof kg.counts]})`}
          </button>
        ))}
      </div>

      {hasOpportunity ? (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setActionFilter('ALL')}
            className={`text-xs px-3 py-1.5 rounded-lg border ${actionFilter === 'ALL' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}>
            ทุกคำแนะนำ
          </button>
          {Array.from(actionCounts.entries()).map(([a, n]) => (
            <button key={a} onClick={() => setActionFilter(a)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${actionFilter === a ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}>
              {OPP_ACTION_LABEL[a] ?? a} ({n})
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-gray-500">เลือกแล้ว {selected.size} คำ</span>
        <button disabled={busy || selected.size === 0} onClick={addExisting}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">เก็บเป็นคำที่มีอยู่แล้ว</button>
        <button disabled={busy || selected.size === 0} onClick={addExclude}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">ใส่รายการไม่เอา</button>
        <button disabled={busy || selected.size === 0} onClick={sendToResearch}
          className="px-3 py-1.5 rounded-lg bg-brand-navy text-white disabled:opacity-40">ส่งเข้า Keyword Research</button>
        <button disabled={busy || selected.size === 0} onClick={ignore}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-40">ข้าม</button>
        {note ? <span className="text-gray-500">{note}</span> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-2"><input type="checkbox" checked={pageAllSelected} onChange={toggleAll} title="เลือกทั้งหน้านี้" /></th>
              <th className="py-2 pr-4">คีย์เวิร์ด</th>
              <th className="py-2 px-3">คู่แข่งที่ติด</th>
              <th className="py-2 px-3">volume</th>
              <th className="py-2 px-3">อันดับเรา</th>
              {compDomains.map(d => <th key={d} className="py-2 px-3 font-normal">{d}</th>)}
              <th className="py-2 px-3">เรา vs คู่แข่งที่ดีที่สุด</th>
              <th className="py-2 px-3">สถานะ</th>
              <th className="py-2 px-3">เจตนา</th>
              <th className="py-2 px-3">หัวข้อ</th>
              <th className="py-2 px-3">ของเดิมที่ชน</th>
              <th className="py-2 px-3">URL เดิม</th>
              <th className="py-2 px-3">ความเสี่ยงกินกันเอง</th>
              <th className="py-2 px-3">คะแนนโอกาส</th>
              <th className="py-2 px-3">คำแนะนำ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const existingUrl = r.existingUrl ?? r.ourUrl
              return (
                <tr key={r.keyword} className={`border-b border-gray-100 ${selected.has(r.keyword) ? 'bg-blue-50/40' : ''}`}>
                  <td className="py-2 pr-2"><input type="checkbox" checked={selected.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                  <td className="py-2 pr-4 text-gray-800">{r.keyword}</td>
                  <td className="py-2 px-3 text-xs text-gray-600">{r.bestCompetitorDomain ?? '—'}</td>
                  <td className="py-2 px-3">{fmt(r.searchVolume)}</td>
                  <td className="py-2 px-3 font-medium">{fmt(r.ourPosition)}</td>
                  {r.competitorPositions.map((p, i) => <td key={i} className="py-2 px-3 text-gray-600">{fmt(p)}</td>)}
                  <td className="py-2 px-3 text-xs"><Delta ours={r.ourPosition} reference={r.bestCompetitorPosition} lowerIsBetter suffix=" อันดับ" /></td>
                  <td className="py-2 px-3 text-xs">{KW_STATE_LABEL[r.state] ?? r.state}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.guardIntent ?? r.intent ?? '—'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.guardTopic ?? '—'}</td>
                  <td className="py-2 px-3 text-xs text-gray-600" title={r.actionReasons?.join(' · ')}>{r.existingMatch ?? '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {existingUrl ? <a href={existingUrl} target="_blank" rel="noreferrer" className="text-brand-blue break-all">{existingUrl}</a> : '—'}
                  </td>
                  <td className="py-2 px-3 text-xs"><RiskCell score={r.cannibalizationRisk} /></td>
                  <td className="py-2 px-3 text-xs font-medium">{r.opportunityScore ?? '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {r.recommendedAction
                      ? <span className={`px-1.5 py-0.5 rounded font-medium ${OPP_ACTION_STYLE[r.recommendedAction] ?? 'bg-gray-100 text-gray-700'}`} title={r.actionReasons?.join(' · ')}>
                          {OPP_ACTION_LABEL[r.recommendedAction] ?? r.recommendedAction}
                        </span>
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && <div className="text-xs text-gray-400 mt-3">แสดง 200 แถวแรกจาก {rows.length}</div>}
    </div>
  )
}

// ── โอกาสคอนเทนต์ ───────────────────────────────────────────────────────────

function OpportunitiesSection({ report, projectId }: { report: GapReport; projectId: string }) {
  const items = report.phase1.actions.filter(a => a.action === 'CREATE' || a.action === 'UPGRADE' || a.action === 'REFRESH')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // ส่งเข้า Keyword Bank ได้เฉพาะแถวที่มีคีย์เวิร์ดหลักจริง (title อย่างเดียวไม่พอ)
  const sendable = items.filter(a => a.primaryKeyword)
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allSelected = sendable.length > 0 && sendable.every(a => selected.has(a.id) || sentIds.has(a.id))
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (allSelected) sendable.forEach(a => next.delete(a.id))
    else sendable.forEach(a => { if (!sentIds.has(a.id)) next.add(a.id) })
    return next
  })

  async function sendToKeywordPage() {
    const chosen = sendable.filter(a => selected.has(a.id))
    if (chosen.length === 0) return
    setSending(true); setNote(null)
    try {
      const rows = chosen.map(a => ({
        keyword: a.primaryKeyword!,
        title: a.title || undefined,
        volume: a.primaryKeywordVolume ?? undefined,
        intent: a.searchIntent
          ? /trans/i.test(a.searchIntent) ? 'TRANSACTIONAL'
            : /commercial/i.test(a.searchIntent) ? 'COMMERCIAL'
              : /navi/i.test(a.searchIntent) ? 'NAVIGATIONAL' : 'INFORMATIONAL'
          : undefined,
        priority: a.priority === 'P0' ? 3 : a.priority === 'P1' ? 2 : 1,
        meta: {
          action: a.action,
          page_type: a.pageType ?? undefined,
          recommendedUrl: a.recommendedUrl ?? undefined,
          existingUrl: a.existingUrl ?? undefined,
          competitorCoverage: a.competitorCoverage ?? undefined,
          secondaryKeywords: a.secondaryKeywords,
          differentiation: a.differentiation ?? undefined,
          notes: a.reason,
        },
      }))
      const res = await fetch(`/api/projects/${projectId}/keyword-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source: 'competitor-gap' }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`)
      setSentIds(prev => new Set([...Array.from(prev), ...chosen.map(a => a.id)]))
      setSelected(new Set())
      setNote(`ส่งไปหน้า Keyword แล้ว ${chosen.length} คำ (สร้างใหม่ ${payload.created ?? 0} • อัปเดต ${payload.updated ?? 0})`)
    } catch (e) {
      setNote(`ส่งไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSending(false)
    }
  }
  if (items.length === 0) {
    return <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">ยังไม่มีรายการคอนเทนต์ที่ต้องทำจากข้อมูลที่เก็บได้</div>
  }
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 overflow-x-auto">
      <h3 className="font-semibold text-brand-navy mb-1">โอกาสคอนเทนต์</h3>
      <p className="text-xs text-gray-500 mb-3">ทุกแถวถูกเช็คกับหน้าที่มีอยู่แล้วบนเว็บเรา — ถ้าเจอหน้าที่ตอบเจตนาเดียวกันจะเป็น UPGRADE ไม่ใช่ CREATE</p>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-gray-500">เลือกแล้ว {selected.size} รายการ</span>
        <button disabled={sending || selected.size === 0} onClick={sendToKeywordPage}
          className="px-3 py-1.5 rounded-lg bg-brand-navy text-white disabled:opacity-40">
          {sending ? 'กำลังส่ง…' : 'ส่งไปหน้า Keyword'}
        </button>
        <span className="text-gray-400">คีย์เวิร์ด + Title ที่เลือกจะเข้า Keyword Bank ของโปรเจกต์ (คำซ้ำจะอัปเดตของเดิม ไม่สร้างซ้ำ)</span>
        {note ? <span className="text-gray-600">{note}</span> : null}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="เลือกทุกแถวที่มีคีย์เวิร์ดหลัก" /></th>
            <th className="py-2 pr-3">ลำดับ</th>
            <th className="py-2 px-3">งาน</th>
            <th className="py-2 px-3">หน้า/บทความที่แนะนำ</th>
            <th className="py-2 px-3">คีย์เวิร์ดหลัก</th>
            <th className="py-2 px-3">เจตนา</th>
            <th className="py-2 px-3">ประเภท</th>
            <th className="py-2 px-3">คู่แข่งมี</th>
            <th className="py-2 px-3">หน้าเดิม</th>
            <th className="py-2 px-3">URL แนะนำ</th>
            <th className="py-2 px-3">เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          {items.map(a => (
            <tr key={a.id} className={`border-b border-gray-100 align-top ${selected.has(a.id) ? 'bg-blue-50/40' : ''}`}>
              <td className="py-2 pr-2">
                {sentIds.has(a.id)
                  ? <span className="text-[10px] font-bold text-emerald-600" title="ส่งเข้า Keyword Bank แล้ว">✓</span>
                  : a.primaryKeyword
                    ? <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    : <span className="text-gray-300" title="ไม่มีคีย์เวิร์ดหลัก — ส่งเข้า Keyword Bank ไม่ได้">—</span>}
              </td>
              <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded border ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span></td>
              <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded ${ACTION_STYLE[a.action]}`}>{a.action}</span></td>
              <td className="py-2 px-3 text-gray-800 max-w-xs">{a.title}</td>
              <td className="py-2 px-3">
                <div>{a.primaryKeyword ?? '—'}</div>
                <div className="text-[11px] text-gray-400">volume {fmt(a.primaryKeywordVolume)}</div>
                {a.secondaryKeywords.length > 0 && <div className="text-[11px] text-gray-400">รอง: {a.secondaryKeywords.slice(0, 3).join(', ')}</div>}
              </td>
              <td className="py-2 px-3 text-xs">{a.searchIntent ?? '—'}</td>
              <td className="py-2 px-3 text-xs">{a.pageType ?? '—'}</td>
              <td className="py-2 px-3 text-xs">{a.competitorCoverage ?? '—'}</td>
              <td className="py-2 px-3 text-xs break-all">{a.existingUrl ?? '—'}</td>
              <td className="py-2 px-3 text-xs break-all">{a.recommendedUrl ?? '—'}</td>
              <td className="py-2 px-3 text-xs text-gray-600 max-w-sm">{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── แซง Top 5 ────────────────────────────────────────────────────────────────

function SurpassSection({ report }: { report: GapReport }) {
  const p1Remaining = (report.phase1.counts.P0 ?? 0) + (report.phase1.counts.P1 ?? 0)
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy">Phase 2 — ทำให้ดีกว่า Top 5</h3>
        <p className="text-xs text-gray-500 mt-1">
          ส่วนนี้ใช้ได้หลังปิดงาน Phase 1 แล้วเท่านั้น — ตอนนี้ยังมีงาน P0+P1 ค้างอยู่ {p1Remaining} งาน
        </p>
        {report.phase2.summary && <p className="text-sm text-gray-700 mt-3">{report.phase2.summary}</p>}
      </div>
      {report.phase2.ideas.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">ยังไม่มีข้อเสนอในส่วนนี้</div>
      ) : report.phase2.ideas.map(i => (
        <div key={i.id} className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-semibold text-brand-navy">{i.title}</h4>
            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">แรงที่ต้องใช้: {i.effort}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
            <Note title="จุดอ่อนคู่แข่งที่ใช้ประโยชน์" body={i.competitorWeakness} />
            <Note title="ผู้ใช้ได้อะไรเพิ่ม" body={i.userValue} />
            <Note title="ต่างจากคู่แข่งยังไง" body={i.whyDifferent} />
            <Note title="โอกาสเชิง SEO" body={i.seoOpportunity} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── โครงสร้างบทความ (SEO / AEO / GEO / E-E-A-T) ─────────────────────────────

const PILLARS: { id: StructurePillar; label: string; what: string }[] = [
  { id: 'SEO',    label: 'SEO',    what: 'โครงหัวข้อและความลึกที่ทำให้ติดอันดับ' },
  { id: 'AEO',    label: 'AEO',    what: 'รูปแบบที่เครื่องมือค้นหาหยิบไปตอบคำถามได้ทันที' },
  { id: 'GEO',    label: 'GEO',    what: 'รูปแบบที่ AI หยิบไปอ้างในคำตอบ' },
  { id: 'E-E-A-T', label: 'E-E-A-T', what: 'สัญญาณความน่าเชื่อถือ ผู้เขียน วันที่ แหล่งอ้างอิง' },
]

const STRUCTURE_STATUS_STYLE: Record<StructureFinding['status'], string> = {
  'ต่ำกว่ามาตรฐาน': 'bg-red-50 text-red-700 border-red-200',
  'ตามมาตรฐาน': 'bg-green-50 text-green-700 border-green-200',
  'ไม่มีข้อมูล': 'bg-gray-100 text-gray-500 border-gray-200',
}

function unitSuffix(unit: StructureFinding['unit']): string {
  return unit === '%' ? '%' : ` ${unit}`
}

function StructureSection({ report }: { report: GapReport }) {
  const st = report.articleStructure

  if (!st) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">
        รายงานรอบนี้สแกนก่อนมีการวิเคราะห์โครงสร้างบทความ — สแกนใหม่อีกครั้งเพื่อดูส่วนนี้
      </div>
    )
  }

  if (!st.available) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">
        {st.note ?? 'ข้อมูลไม่พอสำหรับเทียบโครงสร้างบทความ'}
      </div>
    )
  }

  const below = st.findings.filter(f => f.status === 'ต่ำกว่ามาตรฐาน')

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-brand-navy">โครงสร้างบทความ — คู่แข่งทำยังไง เราขาดอะไร</h3>
        <p className="text-xs text-gray-500 mt-1">
          วัดจากหน้าเนื้อหาที่ index ได้จริง (บทความ/ไกด์/เคสศึกษา/คำศัพท์) — เรา {fmt(st.ours?.contentPages ?? null)} หน้า ·
          คู่แข่งที่เทียบเคียงได้ {st.competitors.length} เว็บ · ต่ำกว่ามาตรฐาน {below.length} จาก {st.findings.length} ตัวชี้วัด
        </p>
        {st.note && <p className="text-xs text-amber-700 mt-2">{st.note}</p>}
        {st.summary && <p className="text-sm text-gray-700 mt-3">{st.summary}</p>}
      </div>

      {PILLARS.map(pillar => {
        const rows = st.findings.filter(f => f.pillar === pillar.id)
        if (rows.length === 0) return null
        const note = st.aiNotes.find(n => n.pillar === pillar.id) ?? null
        return (
          <div key={pillar.id} className="bg-white border border-gray-200 rounded-2xl p-6">
            <div className="flex items-baseline gap-3">
              <h4 className="font-semibold text-brand-navy">{pillar.label}</h4>
              <span className="text-xs text-gray-500">{pillar.what}</span>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">ตัวชี้วัด</th>
                    <th className="py-2 px-3">เรา</th>
                    <th className="py-2 px-3">median คู่แข่ง</th>
                    <th className="py-2 px-3">ต่าง</th>
                    <th className="py-2 px-3">สถานะ</th>
                    <th className="py-2 px-3">คู่แข่งทำอะไร</th>
                    <th className="py-2 px-3">ต้องทำอะไรเพิ่ม</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(f => (
                    <tr key={`${f.pillar}-${f.label}`} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-3 text-gray-800">{f.label}</td>
                      <td className="py-2 px-3">{fmt(f.ours, unitSuffix(f.unit))}</td>
                      <td className="py-2 px-3">{fmt(f.median, unitSuffix(f.unit))}</td>
                      <td className="py-2 px-3"><Delta ours={f.ours} reference={f.median} lowerIsBetter={f.lowerIsBetter} suffix={unitSuffix(f.unit)} /></td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${STRUCTURE_STATUS_STYLE[f.status]}`}>{f.status}</span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-600 max-w-xs">{f.whatCompetitorsDo}</td>
                      <td className="py-2 px-3 text-xs text-gray-600 max-w-sm">{f.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {note && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="text-xs font-medium text-gray-700">{note.title}</div>
                <div className="text-xs text-gray-600 mt-1">{note.whatToDo}</div>
              </div>
            )}
          </div>
        )
      })}

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h4 className="font-semibold text-brand-navy">โครงบทความรายเว็บ</h4>
        <p className="text-xs text-gray-500 mt-1">ค่าที่วัดได้ต่อเว็บ — เว็บที่มีหน้าเนื้อหาน้อยกว่า 3 หน้าไม่ถูกนับเข้า median</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">เว็บ</th>
                <th className="py-2 px-3">หน้าเนื้อหา</th>
                <th className="py-2 px-3">คำ (median)</th>
                <th className="py-2 px-3">H2</th>
                <th className="py-2 px-3">H3</th>
                <th className="py-2 px-3">หัวข้อคำถาม</th>
                <th className="py-2 px-3">FAQ schema</th>
                <th className="py-2 px-3">บล็อกสรุป</th>
                <th className="py-2 px-3">ตาราง</th>
                <th className="py-2 px-3">ผู้เขียน</th>
                <th className="py-2 px-3">วันที่</th>
                <th className="py-2 px-3">อ้างแหล่งนอก</th>
              </tr>
            </thead>
            <tbody>
              {[st.ours, ...st.competitors, st.median].filter(Boolean).map((p, i) => (
                <tr key={`${p!.domain}-${i}`} className={`border-b border-gray-100 ${p!.isOurs ? 'bg-blue-50/40' : ''}`}>
                  <td className="py-2 pr-3 text-gray-800">
                    {p!.domain}
                    {p!.isOurs && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-brand-navy text-white">เรา</span>}
                  </td>
                  <td className="py-2 px-3">{fmt(p!.contentPages)}</td>
                  <td className="py-2 px-3">{fmt(p!.medianWordCount)}</td>
                  <td className="py-2 px-3">{fmt(p!.medianH2)}</td>
                  <td className="py-2 px-3">{fmt(p!.medianH3)}</td>
                  <td className="py-2 px-3">{fmt(p!.questionHeadingPct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.faqSchemaPct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.summaryBlockPct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.tablePct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.authorNamedPct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.datedPct, '%')}</td>
                  <td className="py-2 px-3">{fmt(p!.medianCitations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h4 className="font-semibold text-brand-navy">บทความคู่แข่งที่โครงสร้างครบที่สุด</h4>
        {st.exemplars.length === 0 ? (
          <p className="text-sm text-gray-400 mt-2">ไม่พบบทความคู่แข่งที่โครงสร้างครบพอจะยกเป็นตัวอย่าง</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {st.exemplars.map(e => (
              <li key={e.url} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="text-sm text-gray-800">{e.title}</div>
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-blue break-all hover:underline">{e.url}</a>
                <div className="text-xs text-gray-500 mt-1">{e.domain} · {e.why}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
