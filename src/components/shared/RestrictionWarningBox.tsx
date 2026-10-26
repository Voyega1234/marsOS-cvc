'use client'

import { AlertTriangle, X } from 'lucide-react'

/**
 * กล่องเตือนถาวร: คำต้องห้ามของ Content Engine ที่ server แก้ไม่หมด
 * (ชื่อ term + จำนวนที่เหลือ, อาจรวม title/meta/slug) — ค้างจนเริ่มเขียนรอบใหม่หรือกด ✕
 * ไม่มี warning = ไม่ render อะไรเลย
 */
export default function RestrictionWarningBox({
  warnings,
  onDismiss,
  className = '',
}: {
  warnings: string[]
  onDismiss: () => void
  className?: string
}) {
  if (!warnings.length) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 min-w-0 ${className}`}
    >
      <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0 text-xs text-amber-800 leading-relaxed break-words">
        <span className="font-semibold">บทความยังมีคำต้องห้ามเหลือ:</span> {warnings.join(', ')} — ตรวจแก้ก่อน push
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="ปิดคำเตือน"
        className="shrink-0 p-0.5 rounded text-amber-600 hover:text-amber-800 hover:bg-amber-100 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
