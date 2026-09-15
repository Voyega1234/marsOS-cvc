'use client'

// ─── LanguageModeSelect ─────────────────────────────────────────────────────────
// เลือกโหมดภาษาสำหรับ keyword research / article write เมื่อ project.language
// เป็น 'en' เท่านั้น (โปรเจกต์ th ไม่แสดงอะไรเลย — พฤติกรรมเดิม)
// - th   = ไทยเท่านั้น
// - en   = อังกฤษเท่านั้น
// - both = ไทย+อังกฤษ ตามสัดส่วน ratioThai (%)
// บันทึกค่าไว้ที่ project.pushPrefs.languagePrefs ผ่าน PUT /api/projects/[id]
// (merge เข้ากับ pushPrefs เดิมเสมอ — ดู src/app/api/projects/[id]/route.ts)

import { useEffect, useState } from 'react'
import { readLanguagePrefs } from '@/lib/keyword-language'

export type LanguageMode = 'th' | 'en' | 'both'

interface LanguageModeSelectProps {
  projectId: string
  projectLanguage: string
  value: LanguageMode
  ratioThai: number
  onChange: (next: { keywordMode: LanguageMode; ratioThai: number }) => void
}

const MODE_OPTIONS: { id: LanguageMode; label: string }[] = [
  { id: 'th', label: 'ไทยเท่านั้น' },
  { id: 'en', label: 'อังกฤษเท่านั้น' },
  { id: 'both', label: 'ไทย+อังกฤษ' },
]

export default function LanguageModeSelect({ projectId, projectLanguage, value, ratioThai, onChange }: LanguageModeSelectProps) {
  const [saving, setSaving] = useState(false)

  // โหลดค่าที่เคยเลือกไว้จาก DB ตอน mount — หน้าที่ mount ตัวนี้ (keyword / บทความ / Lab)
  // ไม่ได้ถือ pushPrefs ไว้ใน props ทุกหน้า จึงให้ตัวเลือกดึงเองแล้วส่งขึ้น parent ผ่าน onChange
  useEffect(() => {
    if (projectLanguage !== 'en') return
    let cancelled = false
    fetch(`/api/projects/${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        const raw = typeof d.pushPrefs === 'string' ? d.pushPrefs : d.project?.pushPrefs
        if (!raw) return
        onChange(readLanguagePrefs(raw, projectLanguage))
      })
      .catch(() => { /* เงียบ — ใช้ค่า default */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectLanguage])

  // โปรเจกต์ไทย — ไม่ต้องมี UI เลือกโหมด (พฤติกรรมเดิม)
  if (projectLanguage !== 'en') return null

  async function persist(next: { keywordMode: LanguageMode; ratioThai: number }) {
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pushPrefs: JSON.stringify({ languagePrefs: { keywordMode: next.keywordMode, ratioThai: next.ratioThai } }),
        }),
      })
    } catch { /* เงียบ — ไม่บล็อก UX ถ้าบันทึกไม่สำเร็จ */ }
    finally { setSaving(false) }
  }

  function selectMode(mode: LanguageMode) {
    const next = { keywordMode: mode, ratioThai }
    onChange(next)
    persist(next)
  }

  function updateRatio(nextRatio: number) {
    const next = { keywordMode: value, ratioThai: nextRatio }
    onChange(next)
    persist(next)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-600">ภาษา:</span>
        {MODE_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => selectMode(opt.id)}
            disabled={saving}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              value === opt.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value === 'both' && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-32 shrink-0">ไทย {ratioThai}% / อังกฤษ {100 - ratioThai}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={ratioThai}
            onChange={e => updateRatio(Number(e.target.value))}
            className="flex-1 h-1.5 accent-gray-800 cursor-pointer"
          />
        </div>
      )}
      {value === 'both' && (
        <p className="text-[11px] text-gray-500">
          ค้นคำ: แบ่งจำนวนตามสัดส่วนนี้ · เขียนบทความ: ตามภาษาของ keyword (keyword อังกฤษล้วน = เขียนอังกฤษ)
        </p>
      )}
    </div>
  )
}
