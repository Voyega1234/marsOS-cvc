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
  GapAction, GapReport, KeywordGapRow, Priority, RunStep, StructureFinding, StructurePillar,
} from '@/lib/competitor-gap/types'

type SectionId = 'overview' | 'start-here' | 'competitors' | 'page-gap' | 'keyword-gap' | 'opportunities' | 'structure' | 'surpass'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'overview',      label: 'ภาพรวม' },
  { id: 'start-here',    label: 'เริ่มตรงนี้' },
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
      .then((d: { report: GapReport | null; projectWebsite: string | null }) => {
        if (!alive) return
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
        if (!cancelled.current && r.report) { setReport(r.report as GapReport); setSection('overview') }
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
          {section === 'competitors' && <CompetitorsSection report={report} />}
          {section === 'page-gap' && <PageGapSection report={report} compDomains={compDomains} />}
          {section === 'keyword-gap' && <KeywordGapSection report={report} compDomains={compDomains} />}
          {section === 'opportunities' && <OpportunitiesSection report={report} />}
          {section === 'structure' && <StructureSection report={report} />}
          {section === 'surpass' && <SurpassSection report={report} />}
        </>
      )}
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

function KeywordGapSection({ report, compDomains }: { report: GapReport; compDomains: string[] }) {
  const [filter, setFilter] = useState<string>('ALL')
  const kg = report.keywordGap
  if (!kg.available) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">
        ไม่มีข้อมูลคีย์เวิร์ด{kg.note ? ` — ${kg.note}` : ''}
      </div>
    )
  }
  const rows: KeywordGapRow[] = filter === 'ALL' ? kg.rows : kg.rows.filter(r => r.state === filter)
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 className="font-semibold text-brand-navy mb-1">ช่องว่างคีย์เวิร์ด</h3>
      <p className="text-xs text-gray-500 mb-3">ข้อมูลอันดับและปริมาณค้นหาจาก DataForSEO — ช่องที่ไม่มีข้อมูลแสดง “—”</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {['ALL', ...Object.keys(kg.counts)].map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs px-3 py-1.5 rounded-lg border ${filter === k ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white text-gray-600 border-gray-200'}`}>
            {k === 'ALL' ? `ทั้งหมด (${kg.rows.length})` : `${KW_STATE_LABEL[k] ?? k} (${kg.counts[k as keyof typeof kg.counts]})`}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">คีย์เวิร์ด</th>
              <th className="py-2 px-3">volume</th>
              <th className="py-2 px-3">อันดับเรา</th>
              {compDomains.map(d => <th key={d} className="py-2 px-3 font-normal">{d}</th>)}
              <th className="py-2 px-3">เรา vs คู่แข่งที่ดีที่สุด</th>
              <th className="py-2 px-3">สถานะ</th>
              <th className="py-2 px-3">เจตนา</th>
              <th className="py-2 px-3">หน้าเราที่ติด</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map(r => (
              <tr key={r.keyword} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-800">{r.keyword}</td>
                <td className="py-2 px-3">{fmt(r.searchVolume)}</td>
                <td className="py-2 px-3 font-medium">{fmt(r.ourPosition)}</td>
                {r.competitorPositions.map((p, i) => <td key={i} className="py-2 px-3 text-gray-600">{fmt(p)}</td>)}
                <td className="py-2 px-3 text-xs"><Delta ours={r.ourPosition} reference={r.bestCompetitorPosition} lowerIsBetter suffix=" อันดับ" /></td>
                <td className="py-2 px-3 text-xs">{KW_STATE_LABEL[r.state] ?? r.state}</td>
                <td className="py-2 px-3 text-xs text-gray-500">{r.intent ?? '—'}</td>
                <td className="py-2 px-3 text-xs">
                  {r.ourUrl ? <a href={r.ourUrl} target="_blank" rel="noreferrer" className="text-brand-blue break-all">{r.ourUrl}</a> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && <div className="text-xs text-gray-400 mt-3">แสดง 200 แถวแรกจาก {rows.length}</div>}
    </div>
  )
}

// ── โอกาสคอนเทนต์ ───────────────────────────────────────────────────────────

function OpportunitiesSection({ report }: { report: GapReport }) {
  const items = report.phase1.actions.filter(a => a.action === 'CREATE' || a.action === 'UPGRADE' || a.action === 'REFRESH')
  if (items.length === 0) {
    return <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-400">ยังไม่มีรายการคอนเทนต์ที่ต้องทำจากข้อมูลที่เก็บได้</div>
  }
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 overflow-x-auto">
      <h3 className="font-semibold text-brand-navy mb-1">โอกาสคอนเทนต์</h3>
      <p className="text-xs text-gray-500 mb-4">ทุกแถวถูกเช็คกับหน้าที่มีอยู่แล้วบนเว็บเรา — ถ้าเจอหน้าที่ตอบเจตนาเดียวกันจะเป็น UPGRADE ไม่ใช่ CREATE</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
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
            <tr key={a.id} className="border-b border-gray-100 align-top">
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
