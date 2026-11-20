'use client'

// Convert Cake sheet status sync: share sheet → paste link → map statuses → review → apply + auto-sync.
import { useState, useTransition } from 'react'
import {
  applyCcSyncAction,
  previewCcSyncAction,
  saveCcMappingAction,
  saveCcSheetAction,
  setCcSyncEnabledAction,
} from '@/lib/line-tracking/convertCakeSheetActions'
import type {
  CcOutcome,
  CcStatusMap,
  CcSyncReport,
} from '@/lib/line-tracking/services/convertCakeSheetSync'
import { LEAD_STATUS, LEAD_STATUS_LABEL, type LeadStatus } from '@/lib/line-tracking/enums'

type Props = {
  projectId: string
  sheetId: string | null
  tabName: string | null
  enabled: boolean
  lastRunAt: string | null
  lastResult: string | null
  statusMap: CcStatusMap
  saEmail: string | null
}

type Fail = { ok: false; error: string }

const COUNT_LABEL: Record<CcOutcome, string> = {
  change: 'จะเปลี่ยนสถานะ',
  same: 'ตรงอยู่แล้ว',
  kept: 'ใช้แล้ว (คงค่าที่แก้ใน MarsOS)',
  paid: 'PAID ไม่แตะ',
  unmapped: 'สถานะยังไม่เทียบ',
  nostatus: 'ไม่มีสถานะ',
  notfound: 'หา lead ไม่เจอ',
  ambiguous: 'เจอหลาย lead',
  duplicate: 'หลายแถวชี้ lead เดียว',
  older: 'แถวเก่าของลูกค้าซ้ำ (ใช้แถวใหม่)',
  deferred: 'รอรอบถัดไป',
}
const OUTCOME_ORDER: CcOutcome[] = [
  'change', 'same', 'kept', 'paid', 'unmapped', 'nostatus', 'notfound', 'ambiguous', 'duplicate', 'older', 'deferred',
]
const COLUMN_LABEL: [keyof CcSyncReport['columns'], string][] = [
  ['leadId', 'Lead ID'],
  ['status', 'สถานะ'],
  ['lineUserId', 'LINE User ID'],
  ['lineName', 'ชื่อไลน์'],
  ['phone', 'เบอร์'],
  ['name', 'ชื่อ'],
]
const MATCHED_BY: Record<string, string> = {
  lineUserId: 'LINE ID',
  lineName: 'ชื่อไลน์',
  phone: 'เบอร์',
  name: 'ชื่อ',
}

const statusLabel = (s: string | null) =>
  s ? (LEAD_STATUS_LABEL as Record<string, string>)[s] ?? s : '-'

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
}

export default function ConvertCakeSheetSyncManager(props: Props) {
  const { projectId, saEmail } = props
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<CcSyncReport | null>(null)
  const [applied, setApplied] = useState<CcSyncReport | null>(null)
  const [sheetUrl, setSheetUrl] = useState(
    props.sheetId ? `https://docs.google.com/spreadsheets/d/${props.sheetId}/edit` : '',
  )
  const [tab, setTab] = useState(props.tabName ?? '')
  const [map, setMap] = useState<Record<string, string>>(props.statusMap)
  const [filter, setFilter] = useState<CcOutcome>('change')
  const [enabled, setEnabled] = useState(props.enabled)
  const [copied, setCopied] = useState(false)

  function takeReport(res: CcSyncReport | Fail, isApply = false) {
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setReport(res)
    setApplied(isApply ? res : null)
    setMap((prev) => {
      const next = { ...prev }
      for (const s of res.statuses) if (s.mapped || !(s.label in next)) next[s.label] = s.mapped
      return next
    })
  }

  function run(fn: () => Promise<void>) {
    startTransition(() => {
      void fn().catch((e) => setError(e instanceof Error ? e.message : String(e)))
    })
  }

  async function copyEmail() {
    if (!saEmail) return
    try {
      await navigator.clipboard.writeText(saEmail)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('คัดลอกไม่สำเร็จ — คัดลอกเองจากกล่อง')
    }
  }

  const saveSheet = () => run(async () => takeReport(await saveCcSheetAction(projectId, sheetUrl, tab)))
  const saveMapping = () => run(async () => takeReport(await saveCcMappingAction(projectId, map)))
  const preview = () => run(async () => takeReport(await previewCcSyncAction(projectId)))
  const apply = () => {
    const n = report?.counts.change ?? 0
    if (
      !confirm(
        `จะเปลี่ยนสถานะ ${n} lead และเปิดซิงก์อัตโนมัติทุก 10 นาที\nระบบจะส่ง conversion ตามกฎของโปรเจกต์นี้ ยืนยันหรือไม่?`,
      )
    )
      return
    run(async () => {
      const res = await applyCcSyncAction(projectId)
      takeReport(res, true)
      if (res.ok) setEnabled(true)
    })
  }
  const toggle = () =>
    run(async () => {
      const res = await setCcSyncEnabledAction(projectId, !enabled)
      if (res.ok) {
        setError(null)
        setEnabled(!enabled)
      } else setError(res.error)
    })

  const noMatchCols = report && !report.columns.lineUserId && !report.columns.lineName && !report.columns.phone && !report.columns.name
  const shownRows = report?.rows.filter((r) => r.outcome === filter) ?? []

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-slate-900">ขั้นที่ 1 แชร์ชีท</h2>
        {saEmail ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-slate-100 px-2 py-1 text-sm">{saEmail}</code>
              <button type="button" className="btn-secondary text-sm" onClick={copyEmail}>
                {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </div>
            <p className="text-sm text-slate-500">กด Share ในชีท แล้วใส่อีเมลนี้ สิทธิ์ Viewer (ระบบอ่านอย่างเดียว)</p>
          </>
        ) : (
          <p className="text-sm text-red-600">
            ยังไม่ได้ตั้งค่า service account (GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold text-slate-900">ขั้นที่ 2 วางลิงก์ชีท</h2>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="เว้นว่าง = ใช้แท็บจากลิงก์ / แท็บแรก"
          value={tab}
          onChange={(e) => setTab(e.target.value)}
        />
        <button type="button" className="btn-primary text-sm" disabled={pending || !sheetUrl.trim()} onClick={saveSheet}>
          {pending ? 'กำลังทำงาน...' : 'บันทึกและอ่านชีท'}
        </button>
      </section>

      {report && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-slate-900">ขั้นที่ 3 เทียบสถานะ</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {COLUMN_LABEL.map(([k, label]) => (
              <span key={k}>
                {label}: <b>{report.columns[k] ?? 'ไม่พบ'}</b>
              </span>
            ))}
          </div>
          {noMatchCols && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              ไม่พบคอลัมน์ที่ใช้จับคู่ lead
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">สถานะในชีท</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-right">จำนวนแถว</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">สถานะใน MarsOS</th>
                </tr>
              </thead>
              <tbody>
                {report.statuses.map((s) => {
                  const v = map[s.label] ?? s.mapped ?? ''
                  return (
                    <tr key={s.label} className={v === '' ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-2">{s.label}</td>
                      <td className="px-3 py-2 text-right">{s.count}</td>
                      <td className="px-3 py-2">
                        <select
                          className="rounded border border-slate-300 px-2 py-1 text-sm"
                          value={v}
                          onChange={(e) => setMap((m) => ({ ...m, [s.label]: e.target.value }))}
                        >
                          <option value="">— ยังไม่เทียบ —</option>
                          {LEAD_STATUS.map((st: LeadStatus) => (
                            <option key={st} value={st}>
                              {`${LEAD_STATUS_LABEL[st]} (${st})`}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-primary text-sm" disabled={pending} onClick={saveMapping}>
            บันทึกตารางเทียบ
          </button>
        </section>
      )}

      {report && (
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold text-slate-900">ขั้นที่ 4 ตรวจก่อนเปิดใช้</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip chip-muted">ทั้งหมด {report.totalRows} แถว</span>
            {OUTCOME_ORDER.map((o) => (
              <span key={o} className="chip chip-muted">
                {COUNT_LABEL[o]}: {report.counts[o] ?? 0}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_ORDER.map((o) => (
              <button
                key={o}
                type="button"
                className={`text-xs ${filter === o ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(o)}
              >
                {COUNT_LABEL[o]} ({report.counts[o] ?? 0})
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">แถว</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">Lead ID</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">สถานะชีท</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">Lead</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">สถานะปัจจุบัน → เป้าหมาย</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">จับคู่ด้วย</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 text-left">ผล</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={7}>
                      ไม่มีแถวในกลุ่มนี้
                    </td>
                  </tr>
                )}
                {shownRows.map((r) => (
                  <tr key={r.row}>
                    <td className="px-3 py-2">{r.row}</td>
                    <td className="px-3 py-2">{r.sheetLeadId || '-'}</td>
                    <td className="px-3 py-2">{r.sheetStatus || '-'}</td>
                    <td className="px-3 py-2">
                      {r.leadId && r.leadName ? (
                        <a
                          className="text-blue-600 hover:underline"
                          href={`/line-tracking/projects/${projectId}/leads?q=${encodeURIComponent(r.leadName)}`}
                        >
                          {r.leadName}
                        </a>
                      ) : (
                        r.leadName ?? '-'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {statusLabel(r.leadStatus)} → {statusLabel(r.target)}
                    </td>
                    <td className="px-3 py-2">{r.matchedBy ? MATCHED_BY[r.matchedBy] ?? r.matchedBy : '-'}</td>
                    <td className="px-3 py-2">{COUNT_LABEL[r.outcome]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm" disabled={pending} onClick={preview}>
              อ่านชีทใหม่
            </button>
            <button type="button" className="btn-primary text-sm" disabled={pending} onClick={apply}>
              อัปเดตสถานะและเปิดซิงก์อัตโนมัติ
            </button>
          </div>
          {applied && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              อัปเดตแล้ว — เปลี่ยนสถานะ {applied.counts.change ?? 0} lead จากทั้งหมด {applied.totalRows} แถว
              {(applied.counts.deferred ?? 0) > 0 && ` (รอรอบถัดไป ${applied.counts.deferred})`}
            </div>
          )}
        </section>
      )}

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-slate-900">สถานะซิงก์อัตโนมัติ</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="chip chip-muted">{enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</span>
          <span className="text-slate-600">
            รอบล่าสุด: {props.lastRunAt ? new Date(props.lastRunAt).toLocaleString('th-TH') : '-'}
          </span>
          <button type="button" className="btn-secondary text-sm" disabled={pending} onClick={toggle}>
            {enabled ? 'ปิดซิงก์' : 'เปิดซิงก์'}
          </button>
        </div>
        {props.lastResult && (
          <p className={`text-sm ${props.lastResult.startsWith('ERROR') ? 'text-red-600' : 'text-slate-600'}`}>
            {props.lastResult}
          </p>
        )}
        <p className="text-xs text-slate-500">
          ระบบเช็กชีททุก 10 นาที · เปลี่ยนสถานะเฉพาะเมื่อสถานะในชีทเปลี่ยน — ถ้าแก้สถานะใน MarsOS เอง จะคงไว้จนกว่าชีทจะเปลี่ยน · lead ที่ PAID แล้วจะไม่ถูกแตะ
        </p>
      </section>
    </div>
  )
}
