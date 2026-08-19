'use client'

/**
 * ตัวเลือกสี + ฟอนต์ราย element ของบทความ (H1-H6, Text, URL, Author, FAQ)
 * ใช้ทั้งใน Article Lab (ต่อ client) และ Content Studio (ระดับ studio)
 *
 * กติกาสี: ตัวอักษรไม่ตั้ง = ดำ (ค่าเริ่มต้น) / พื้นหลังไม่ตั้ง = โปร่งใสเสมอ
 * ทุกช่องวางโค้ดสี (#RGB / #RRGGBB) ตรง ๆ ได้
 *
 * Layout: แถวห่อบรรทัดได้ (flex-wrap) — การ์ดแคบอย่างแผงข้าง Content Studio
 * ฟอนต์จะตกลงบรรทัดใหม่เอง ไม่ล้นกรอบ
 */
import { useState } from 'react'
import { THEME_ELEMENTS, THAI_FONTS, type ArticleElementStyles } from '@/lib/articleTheme'

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** ช่องสี = ป้ายจิ๋ว + swatch (native picker) + ช่องพิมพ์/วางโค้ดสี */
function ColorField({ tag, value, fallback, fallbackLabel, onChange }: {
  /** ป้ายจิ๋วหน้า swatch เช่น "อักษร" / "พื้น" */
  tag: string
  value: string | undefined
  /** ค่าเริ่มต้นที่ swatch แสดงเมื่อยังไม่ตั้ง */
  fallback: string
  fallbackLabel: string
  onChange: (color: string | undefined) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value ?? ''

  const commit = (raw: string) => {
    setDraft(null)
    const v = raw.trim()
    if (!v) { onChange(undefined); return }
    const hex = v.startsWith('#') ? v : `#${v}`
    if (HEX_RE.test(hex)) onChange(hex.toLowerCase())
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="w-8 text-right text-[9px] text-gray-300 select-none">{tag}</span>
      <label className="relative w-6 h-6 rounded-md border border-gray-200 cursor-pointer shrink-0 overflow-hidden"
        style={value
          ? { backgroundColor: value }
          : fallback === 'transparent'
            // ลายตารางหมากรุก = โปร่งใส
            ? { backgroundImage: 'conic-gradient(#e5e7eb 0 25%, #fff 0 50%, #e5e7eb 0 75%, #fff 0)', backgroundSize: '8px 8px' }
            : { backgroundColor: fallback }}
        title={value ?? fallbackLabel}>
        <input type="color" value={value ?? (fallback === 'transparent' ? '#ffffff' : fallback)}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
      <input
        value={text}
        placeholder={fallbackLabel}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
        className="w-[68px] h-6 rounded-md border border-gray-200 bg-white px-1.5 font-mono text-[10px] text-gray-600 placeholder:text-gray-300 min-w-0"
      />
      {value && (
        <button onClick={() => onChange(undefined)} className="text-[10px] text-gray-300 hover:text-red-500" title="ล้างค่า">✕</button>
      )}
    </div>
  )
}

export function ArticleElementStylesEditor({ value, onChange }: {
  value: ArticleElementStyles
  onChange: (next: ArticleElementStyles) => void
}) {
  const set = (key: string, patch: { color?: string; background?: string; font?: string }) => {
    const cur = { ...(value[key] ?? {}), ...patch }
    if (patch.font === '') delete cur.font
    if ('color' in patch && patch.color === undefined) delete cur.color
    if ('background' in patch && patch.background === undefined) delete cur.background
    if (!cur.color && !cur.background && !cur.font) {
      const next = { ...value }
      delete next[key]
      onChange(next)
      return
    }
    onChange({ ...value, [key]: cur })
  }
  const clear = (key: string) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {THEME_ELEMENTS.map(({ key, label, hasFont }) => {
        const st = value[key] ?? {}
        const isSet = Boolean(st.color || st.background || st.font)
        return (
          <div key={key} className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
            <span className="w-32 shrink-0 truncate text-[11px] text-gray-700"
              style={st.font ? { fontFamily: `'${st.font}', sans-serif` } : undefined}
              title={label}>{label}</span>
            <ColorField tag="อักษร" value={st.color} fallback="#000000" fallbackLabel="ดำ"
              onChange={c => set(key, { color: c })} />
            <ColorField tag="พื้น" value={st.background} fallback="transparent" fallbackLabel="โปร่งใส"
              onChange={c => set(key, { background: c })} />
            {hasFont ? (
              <select value={st.font ?? ''} onChange={e => set(key, { font: e.target.value })}
                className="h-6 flex-1 min-w-[120px] max-w-full rounded-md border border-gray-200 bg-white px-1 text-[10px] text-gray-600">
                <option value="">ฟอนต์ตามธีมเว็บ</option>
                {THAI_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <span className="flex-1 min-w-[120px] text-[9px] text-gray-300">— สีอย่างเดียว —</span>}
            {isSet && (
              <button onClick={() => clear(key)} className="shrink-0 text-[10px] text-gray-400 hover:text-red-500" title="กลับไปใช้ค่าเริ่มต้น (ตัวอักษรดำ · พื้นโปร่งใส)">✕</button>
            )}
          </div>
        )
      })}
      <p className="pt-1 text-[10px] text-gray-400">
        วางโค้ดสี (เช่น #1d48f3) ได้ทุกช่อง · ไม่ตั้งสีตัวอักษร = ดำ · ไม่ตั้งพื้นหลัง = โปร่งใส
      </p>
    </div>
  )
}
