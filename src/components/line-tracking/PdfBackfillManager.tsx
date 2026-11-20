'use client'

// Staff-only panel: read logged LINE PDFs (dry run), then confirm to write them to leads.
// Rows run one at a time — each is a LINE download + Gemini call (up to ~45s).
import Link from 'next/link'
import { useState } from 'react'
import {
  backfillApplyPdf,
  backfillReadPdf,
  type BackfillReadResult,
} from '@/lib/line-tracking/pdfBackfillActions'

export interface BackfillRow {
  messageId: string
  fileName: string
  sentAt: string
  leadId: string | null
  leadName: string | null
  leadStatus: string | null
  applied: boolean
}

type RowState =
  | { phase: 'idle' }
  | { phase: 'reading' | 'applying' }
  | { phase: 'read'; result: BackfillReadResult }
  | { phase: 'done'; autoPaid: boolean }
  | { phase: 'error'; error: string }

const DOC_LABEL: Record<string, string> = {
  quotation: 'ใบเสนอราคา',
  invoice: 'ใบแจ้งหนี้',
  receipt: 'ใบเสร็จ',
  other: 'ไม่ใช่เอกสารขาย',
}

function canApply(row: BackfillRow, s: RowState | undefined): boolean {
  return !row.applied && !!row.leadId && s?.phase === 'read' && s.result.ok && s.result.docType !== 'other'
}

export default function PdfBackfillManager({
  projectId,
  autoPaid,
  rows,
}: {
  projectId: string
  autoPaid: boolean
  rows: BackfillRow[]
}) {
  const [state, setState] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)
  const set = (id: string, s: RowState) => setState((prev) => ({ ...prev, [id]: s }))

  async function readAll() {
    setBusy(true)
    for (const r of rows) {
      if (r.applied || !r.leadId) continue
      set(r.messageId, { phase: 'reading' })
      const result = await backfillReadPdf(projectId, r.messageId)
      set(r.messageId, { phase: 'read', result })
    }
    setBusy(false)
  }

  async function applyAll() {
    const targets = rows.filter((r) => canApply(r, state[r.messageId]))
    const ok = window.confirm(
      autoPaid
        ? `บันทึก ${targets.length} ไฟล์ลง Lead และเปลี่ยนสถานะเป็น Purchase (PAID) — ระบบจะส่ง event Purchase ไปแพลตฟอร์มโฆษณา ยืนยัน?`
        : `บันทึก ${targets.length} ไฟล์ลง Lead (ไม่เปลี่ยนสถานะ) ยืนยัน?`,
    )
    if (!ok) return
    setBusy(true)
    for (const r of targets) {
      set(r.messageId, { phase: 'applying' })
      const res = await backfillApplyPdf(projectId, r.messageId)
      set(r.messageId, res.ok ? { phase: 'done', autoPaid: res.autoPaid } : { phase: 'error', error: res.error })
    }
    setBusy(false)
  }

  const readyCount = rows.filter((r) => canApply(r, state[r.messageId])).length
  const pendingCount = rows.filter((r) => !r.applied && r.leadId).length

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" disabled={busy || pendingCount === 0} onClick={readAll}>
          1. อ่านทั้งหมด (ยังไม่บันทึก) · {pendingCount} ไฟล์
        </button>
        <button type="button" className="btn-primary" disabled={busy || readyCount === 0} onClick={applyAll}>
          2. ยืนยันบันทึก {readyCount} ไฟล์{autoPaid ? ' + เปลี่ยนเป็น Purchase' : ''}
        </button>
        {busy && <span className="text-xs text-slate-500">กำลังทำงาน… ไฟล์ละไม่เกินประมาณ 45 วินาที อย่าปิดหน้านี้</span>}
      </div>
      <p className="text-xs text-slate-500">
        {autoPaid
          ? 'โปรเจกต์นี้ตั้งให้ PDF เปลี่ยนสถานะเป็น Purchase อัตโนมัติ — Lead ที่เป็น PAID อยู่แล้วจะไม่ถูกเปลี่ยนซ้ำ. แพลตฟอร์มโฆษณาอาจไม่รับ event ที่เก่ามาก (เช่น Meta ราว 7 วัน)'
          : 'บันทึกข้อมูลและโน้ตลง Lead เท่านั้น ไม่เปลี่ยนสถานะ'}
        {' · '}LINE ลบไฟล์ที่ลูกค้าส่งหลังผ่านไประยะหนึ่ง ไฟล์เก่าอาจดาวน์โหลดไม่ได้
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">ไม่พบ PDF ใน webhook log ของโปรเจกต์นี้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-2 pr-3">ส่งเมื่อ</th>
                <th className="py-2 pr-3">ไฟล์</th>
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">ผลการอ่าน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = state[r.messageId]
                return (
                  <tr key={r.messageId} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-slate-600">
                      {new Date(r.sentAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="max-w-[16rem] break-words py-2 pr-3">{r.fileName}</td>
                    <td className="py-2 pr-3">
                      {r.leadId ? (
                        <Link href={`/line-tracking/projects/${projectId}/leads?q=${encodeURIComponent(r.leadName ?? '')}`} className="text-brand-blue hover:underline">
                          {r.leadName ?? 'ไม่มีชื่อ'}
                        </Link>
                      ) : (
                        <span className="text-slate-400">ไม่พบ Lead</span>
                      )}
                      {r.leadStatus && <span className="ml-1 text-xs text-slate-500">({r.leadStatus})</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <RowResult row={r} s={s} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RowResult({ row, s }: { row: BackfillRow; s: RowState | undefined }) {
  if (row.applied) return <span className="text-emerald-700">บันทึกแล้ว</span>
  if (!s || s.phase === 'idle') return <span className="text-slate-400">ยังไม่ได้อ่าน</span>
  if (s.phase === 'reading') return <span className="text-slate-500">กำลังอ่าน…</span>
  if (s.phase === 'applying') return <span className="text-slate-500">กำลังบันทึก…</span>
  if (s.phase === 'error') return <span className="text-red-600">{s.error}</span>
  if (s.phase === 'done') return <span className="text-emerald-700">บันทึกแล้ว{s.autoPaid ? ' · เปลี่ยนเป็น Purchase' : ''}</span>
  if (s.phase !== 'read') return null
  const r = s.result
  if (!r.ok) return <span className="text-red-600">{r.error}</span>
  return (
    <div className="space-y-0.5">
      <div className="font-medium text-slate-800">
        {DOC_LABEL[r.docType] ?? r.docType}
        {r.docNumber ? ` · ${r.docNumber}` : ''}
      </div>
      {r.amount != null && (
        <div className="tabular-nums">
          {r.isDeposit ? 'มัดจำ ' : ''}
          {r.amount.toLocaleString()} บาท
        </div>
      )}
      {r.buyer && <div className="text-xs text-slate-600">ผู้ซื้อ: {r.buyer}</div>}
      {r.salesContactName && <div className="text-xs text-slate-600">เซลส์: {r.salesContactName}</div>}
    </div>
  )
}
