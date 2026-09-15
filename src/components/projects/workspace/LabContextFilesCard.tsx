'use client'

import { Check, FileText, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

/** ผลลัพธ์ที่ทีมกดใส่ Project Context ได้ — parent เป็นคนตัดสินว่าจะแทนที่หรือต่อท้ายข้อความเดิม */
export interface ContextFilesApply {
  projectContext: string
}

interface ContextFilesResult {
  projectContext: string
  promptId: string
  promptName: string
  created: boolean
  summary: string
  warnings: string[]
}

const ALLOWED_EXT = ['.csv', '.pdf']
const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

function isAllowed(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
  return ALLOWED_EXT.includes(ext)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * ลากไฟล์ CSV/PDF ของลูกค้ามาวาง แล้วให้ระบบอ่านสรุปเป็น Project Context
 * และเติมลง Business Skill ของโปรเจกต์นี้ให้อัตโนมัติ (เติมช่องว่าง + ต่อท้ายช่องที่มีข้อมูลแล้ว)
 */
export function LabContextFilesCard({
  projectId,
  onApply,
}: {
  projectId: string
  onApply: (apply: ContextFilesApply) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<ContextFilesResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list)
    const rejected: string[] = []
    const accepted: File[] = []
    for (const f of incoming) {
      if (!isAllowed(f)) { rejected.push(`${f.name} (นามสกุลไม่รองรับ)`); continue }
      if (f.size > MAX_FILE_BYTES) { rejected.push(`${f.name} (ใหญ่เกิน 10MB)`); continue }
      accepted.push(f)
    }
    if (rejected.length) toast.error(`ข้ามไฟล์: ${rejected.join(', ')}`)

    setFiles((prev) => {
      const next = [...prev, ...accepted]
      if (next.length > MAX_FILES) {
        toast.error(`เลือกไฟล์ได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง — ตัดไฟล์ส่วนเกินออก`)
        return next.slice(0, MAX_FILES)
      }
      return next
    })
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
    setResult(null)
  }

  async function run() {
    if (files.length === 0) {
      toast.error('ยังไม่ได้เลือกไฟล์ — วางไฟล์ .csv หรือ .pdf ก่อน')
      return
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      toast.error(`ไฟล์รวมกันใหญ่เกิน 4MB (ตอนนี้ ${formatSize(totalBytes)}) — ลดจำนวนไฟล์หรือบีบอัดก่อน`)
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const res = await fetch(`/api/projects/${projectId}/context-files`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
      setResult(body as ContextFilesResult)
      toast.success('อ่านไฟล์และบันทึกลง Business Skill แล้ว')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function apply() {
    if (!result) return
    onApply({ projectContext: result.projectContext })
    toast.success('ใส่ Project Context ลงฟอร์มแล้ว — ตรวจ แก้ได้ก่อนกดบันทึก')
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText size={13} className="text-gray-400" />
        <span className="text-xs font-semibold text-gray-800">อ่านไฟล์ธุรกิจลูกค้า (CSV / PDF)</span>
      </div>
      <p className="text-[10px] text-gray-400 leading-relaxed mb-2">
        ลากไฟล์รายการสินค้า ราคา โบรชัวร์ หรือเอกสารบริษัทมาวาง ระบบจะอ่านแล้วสรุปเป็นบริบทธุรกิจ
        และเติมลง Business Skill ของโปรเจกต์นี้ให้ (สูงสุด {MAX_FILES} ไฟล์ รวมไม่เกิน 4MB)
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-5 cursor-pointer transition-colors ${
          dragging ? 'border-brand-blue bg-brand-mist/40' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <Upload size={16} className="text-gray-400" />
        <span className="text-[11px] text-gray-500">ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</span>
        <span className="text-[10px] text-gray-300">.csv, .pdf — ไฟล์ละไม่เกิน 10MB</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.pdf,text/csv,application/pdf"
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <FileText size={11} className="text-gray-400 shrink-0" />
              <span className="text-[11px] text-gray-700 truncate flex-1">{f.name}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{formatSize(f.size)}</span>
              <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-red-500 shrink-0">
                <X size={11} />
              </button>
            </div>
          ))}
          <p className={`text-[10px] ${totalBytes > MAX_TOTAL_BYTES ? 'text-red-500' : 'text-gray-400'}`}>
            รวม {formatSize(totalBytes)} / 4 MB
          </p>
        </div>
      )}

      <button
        onClick={run}
        disabled={busy || files.length === 0}
        className="mt-2.5 w-full h-8 rounded-lg bg-brand-blue text-white text-xs font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {busy ? 'กำลังอ่านไฟล์...' : 'อ่านไฟล์แล้วเติมข้อมูล'}
      </button>
      {busy && <p className="mt-1.5 text-[10px] text-gray-400">อ่านไฟล์และให้ AI สรุปอยู่ ใช้เวลาประมาณ 1-2 นาที</p>}

      {result && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          {result.summary && <p className="text-xs text-brand-navy leading-relaxed">{result.summary}</p>}

          <p className="text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5">
            บันทึกลง Business Skill แล้ว (ชุด: {result.promptName}{result.created ? ' — สร้างใหม่' : ' — อัปเดต'})
          </p>

          <p className="text-[10px] text-gray-400">
            Project Context ที่ได้ ({result.projectContext.length.toLocaleString()} ตัวอักษร)
          </p>

          {result.warnings.length > 0 && (
            <p className="text-[10px] text-amber-600">
              <span className="font-semibold">ข้อควรทราบ:</span> {result.warnings.join(' · ')}
            </p>
          )}

          <button
            onClick={apply}
            className="w-full h-8 rounded-lg border border-brand-blue text-brand-blue text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-gray-50"
          >
            <Check size={12} />
            ใส่ Project Context ลงฟอร์ม
          </button>
        </div>
      )}
    </div>
  )
}
