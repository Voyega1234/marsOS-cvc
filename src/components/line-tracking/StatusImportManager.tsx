'use client'

// Drop a customer list file → preview matches → confirm. Nothing changes until the team confirms.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  applyStatusImportAction,
  previewStatusImportAction,
} from '@/lib/line-tracking/statusImportActions'
import type { ImportRow } from '@/lib/line-tracking/services/statusImportService'

const KIND_LABEL: Record<string, string> = {
  survey: 'รอพิจรณา (QUALIFIED)',
  install: 'ติดตั้ง (WON)',
}
const OUTCOME: Record<ImportRow['outcome'], { label: string; cls: string }> = {
  ready: { label: 'จะอัปเดต', cls: 'text-emerald-700' },
  nochange: { label: 'ข้อมูลตรงกับ Lead แล้ว — ข้าม', cls: 'text-slate-500' },
  duplicate: { label: 'Lead ซ้ำกับแถวอื่นในไฟล์ — ข้าม', cls: 'text-slate-500' },
  ambiguous: { label: 'ตรงหลาย Lead — ข้าม (แก้เองในหน้า Leads)', cls: 'text-amber-700' },
  notfound: { label: 'ไม่พบ Lead', cls: 'text-red-600' },
  nostage: { label: 'ไม่รู้ว่าเป็นขั้นไหน — เลือกขั้นด้านบน', cls: 'text-amber-700' },
}
const MATCHED_BY: Record<string, string> = {
  lineUserId: 'LINE ID',
  lineName: 'ชื่อไลน์',
  phone: 'เบอร์',
  name: 'ชื่อ',
}

export default function StatusImportManager({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [defaultKind, setDefaultKind] = useState('survey')
  const inputRef = useRef<HTMLInputElement>(null)

  async function preview(f: File | null, kind: string) {
    setError(null)
    setResult(null)
    setRows(null)
    if (!f) return
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      setError('รองรับเฉพาะไฟล์ .xlsx หรือ .csv')
      return
    }
    setBusy(true)
    const formData = new FormData()
    formData.set('projectId', projectId)
    formData.set('file', f)
    formData.set('defaultKind', kind)
    const res = await previewStatusImportAction(formData)
    if (res.ok) {
      setRows(res.rows)
      setFileName(res.fileName)
      setSelected(new Set(res.rows.filter((r) => r.outcome === 'ready').map((r) => r.row)))
    } else setError(res.error)
    setBusy(false)
  }

  function pick(f: File | null) {
    setFile(f)
    void preview(f, defaultKind)
  }

  const selectable = rows?.filter((r) => r.outcome === 'ready' && r.leadId && r.kind) ?? []
  const ready = selectable.filter((r) => selected.has(r.row))
  const toggle = (row: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(row)) n.delete(row)
      else n.add(row)
      return n
    })
  const allOn = selectable.length > 0 && ready.length === selectable.length

  async function apply() {
    const moves = ready.filter((r) => r.changeStatus)
    const install = moves.filter((r) => r.kind === 'install').length
    if (
      !window.confirm(
        `อัปเดต ${ready.length} Lead` +
          (moves.length
            ? ` — เปลี่ยนสถานะ ${moves.length}${install ? ` (ติดตั้ง = WON ${install})` : ''} และส่ง event ไปแพลตฟอร์มโฆษณา`
            : '') +
          ' ยืนยัน?'
      )
    )
      return
    setBusy(true)
    setError(null)
    const res = await applyStatusImportAction(
      projectId,
      fileName,
      ready.map((r) => ({
        leadId: r.leadId!,
        kind: r.kind!,
        row: r.row,
        value: r.value,
        fillName: r.fillName,
        fillPhone: r.fillPhone,
        survey: r.survey,
      }))
    )
    if (res.ok) {
      setResult(
        `เปลี่ยนสถานะแล้ว ${res.changed} Lead · อัปเดตข้อมูลอย่างเดียว ${res.updated} Lead${res.skipped ? ` · ข้าม ${res.skipped}` : ''}`
      )
      setRows(null)
      router.refresh()
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    } else setError(res.error)
    setBusy(false)
  }

  const counts = rows?.reduce<Record<string, number>>(
    (m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }),
    {}
  )

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        📥 อัปโหลดไฟล์สถานะ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false)
          }}
        >
          <div
            className="card my-8 w-full max-w-4xl space-y-3 p-5"
            role="dialog"
            aria-modal="true"
            aria-label="อัปเดตสถานะจากไฟล์"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">
                📥 อัปเดตสถานะจากไฟล์รายชื่อลูกค้า
              </h2>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700"
                aria-label="ปิด"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                สถานะว่าง / ไม่รู้จัก ให้นับเป็น
                <select
                  value={defaultKind}
                  onChange={(e) => {
                    setDefaultKind(e.target.value)
                    void preview(file, e.target.value)
                  }}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">ไม่เปลี่ยน (ข้าม)</option>
                  <option value="survey">{KIND_LABEL.survey}</option>
                  <option value="install">{KIND_LABEL.install}</option>
                </select>
              </label>
            </div>
            <label
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pick(e.dataTransfer.files?.[0] ?? null)
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition ${
                dragging
                  ? 'border-line-500 bg-line-500/5 text-line-600'
                  : 'border-slate-300 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <span className="font-medium">
                {file ? file.name : 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์'}
              </span>
              <span className="mt-1 text-xs text-slate-400">
                .xlsx / .csv ไม่เกิน 5MB · ระบบตรวจให้ดูก่อน ยังไม่บันทึกจนกว่าจะกดยืนยัน
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || ready.length === 0}
                onClick={apply}
              >
                ยืนยันอัปเดต {ready.length} Lead ที่เลือก
              </button>
              {busy && <span className="text-xs text-slate-500">กำลังทำงาน…</span>}
            </div>
            <p className="text-xs text-slate-500">
              จับคู่ด้วยชื่อไลน์จาก “Line@:ชื่อ//” ใน “รายละเอียดการตาม” / “รายละเอียดการตามล่าสุด”
              (หรือ LINE user ID) → เบอร์โทร (ทุกเบอร์ในช่อง) → ชื่อลูกค้า. ช่อง “สถานะ”: ติดตั้ง =
              WON, รอพิจรณา = QUALIFIED. value: “ยอด … บาท” (มี “= …” ใช้ยอดรวม vat),
              แถวรอพิจรณาใช้ราคาที่เสนอตัวแรก. ชื่อ / เบอร์ / value ที่ต่างจาก Lead จะถูกอัปเดต
              (อัปโหลดไฟล์ใหม่ซ้ำได้) — ติ๊กเฉพาะแถวที่ต้องการ. แถวที่ไม่แน่ใจจะข้าม ไม่เดา
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {result && <p className="text-sm text-emerald-700">{result}</p>}

            {rows && (
              <>
                <p className="text-sm text-slate-600">
                  {fileName} · {rows.length} แถว
                  {counts &&
                    Object.entries(counts)
                      .map(([k, n]) => ` · ${OUTCOME[k as ImportRow['outcome']].label} ${n}`)
                      .join('')}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 pr-3">
                          <input
                            type="checkbox"
                            aria-label="เลือกทั้งหมด"
                            checked={allOn}
                            disabled={!selectable.length}
                            onChange={() =>
                              setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.row)))
                            }
                          />
                        </th>
                        <th className="py-2 pr-3">แถว</th>
                        <th className="py-2 pr-3">ในไฟล์</th>
                        <th className="py-2 pr-3">แหล่งที่มา</th>
                        <th className="py-2 pr-3">Lead ที่จับคู่</th>
                        <th className="py-2 pr-3">ขั้น</th>
                        <th className="py-2 pr-3">อัปเดตข้อมูล</th>
                        <th className="py-2 pr-3">ผล</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.row} className="border-b align-top last:border-0">
                          <td className="py-2 pr-3">
                            {r.outcome === 'ready' && (
                              <input
                                type="checkbox"
                                aria-label={`เลือกแถว ${r.row}`}
                                checked={selected.has(r.row)}
                                onChange={() => toggle(r.row)}
                              />
                            )}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-slate-500">{r.row}</td>
                          <td className="max-w-[18rem] break-words py-2 pr-3">{r.key}</td>
                          <td className="py-2 pr-3 text-slate-600">{r.source || '—'}</td>
                          <td className="py-2 pr-3">
                            {r.leadId ? (
                              <>
                                {r.leadName ?? '(ไม่มีชื่อ)'}{' '}
                                <span className="text-xs text-slate-500">
                                  ({r.leadStatus} · จับจาก{MATCHED_BY[r.matchedBy ?? ''] ?? '-'})
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {r.kind ? KIND_LABEL[r.kind] : '—'}
                            {r.kind && r.leadId && !r.changeStatus && (
                              <div className="text-xs text-slate-400">สถานะไม่เปลี่ยน</div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-600">
                            {r.value != null && (
                              <div className="tabular-nums">
                                ยอด {r.value.toLocaleString()} บาท
                                {r.leadValue ? ` (เดิม ${r.leadValue.toLocaleString()})` : ''}
                              </div>
                            )}
                            {r.fillName && (
                              <div>
                                ชื่อ: {r.fillName}
                                {r.leadFullName ? ` (เดิม ${r.leadFullName})` : ''}
                              </div>
                            )}
                            {r.fillPhone && (
                              <div>
                                เบอร์: {r.fillPhone}
                                {r.leadPhone ? ` (เดิม ${r.leadPhone})` : ''}
                              </div>
                            )}
                            {r.survey && (
                              <div>
                                นัดสำรวจ: {r.survey}
                                {r.leadSurvey ? ` (เดิม ${r.leadSurvey})` : ''}
                              </div>
                            )}
                            {r.value == null && !r.fillName && !r.fillPhone && !r.survey && '—'}
                          </td>
                          <td className={`py-2 pr-3 ${OUTCOME[r.outcome].cls}`}>
                            {OUTCOME[r.outcome].label}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
