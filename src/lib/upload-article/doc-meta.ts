// ─── Upload Article — อ่านตาราง brief ของผู้เขียนในต้นฉบับ ──────────────────────
// ต้นฉบับมีตารางแบบนี้อยู่ต้นเอกสาร (build-html ตัดออกจากเนื้อหาอยู่แล้ว):
//   Keyword | Search Volume
//   Main | ระบบเหยื่อกำจัดปลวก | 10
//   Longtail | เหยื่อกำจัดปลวก, ...
//   Title Count : (Max 70) | <meta title>
//   Description Count : (Max 160) | <meta description>
//   Slug | <slug>
// ฟังก์ชันล้วน ไม่พึ่ง prisma

import { parse, type HTMLElement } from 'node-html-parser'
import { decodeTextEntities } from './entities'

export interface DocBriefMeta {
  seoTitle?: string
  metaDescription?: string
  slug?: string
  mainKeyword?: string
  longtail?: string
}

const TITLE_MAX = 70
const DESCRIPTION_MAX = 160

function cellText(el: HTMLElement | undefined): string {
  return (el?.text || '').replace(/\s+/g, ' ').trim()
}

/** slug ในตารางบางทีเป็น URL เต็มหรือมี / นำหน้า — เหลือเฉพาะส่วนท้าย ตัวพิมพ์เล็ก a-z0-9- */
export function normalizeBriefSlug(raw: string): string {
  let s = raw.trim()
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname
  } catch {
    // ใช้ค่าเดิม
  }
  s = s.split('/').filter(Boolean).pop() || ''
  try {
    s = decodeURIComponent(s)
  } catch {
    // ใช้ค่าเดิม
  }
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * หาค่าในตาราง brief ทุกตารางของเอกสาร (ป้ายอยู่ช่องแรกของแถว ค่าอยู่ช่องที่ไม่ว่างช่องถัดไป)
 * ป้ายที่รองรับ: Title / Meta Title / Title Count : (Max 70), Description / Meta Description / Description Count,
 * Slug / URL, Main / Main Keyword / Focus Keyword, Longtail
 */
export function extractBriefMeta(html: string): DocBriefMeta {
  const out: DocBriefMeta = {}
  if (!html || !/<table/i.test(html)) return out
  const root = parse(decodeTextEntities(html), { blockTextElements: {} })
  for (const table of root.querySelectorAll('table')) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td, th')
      if (cells.length < 2) continue
      const label = cellText(cells[0]).toLowerCase()
      const value = cells.slice(1).map((c) => cellText(c)).find(Boolean) || ''
      if (!label || !value) continue
      if (!out.seoTitle && /^(meta\s*)?title\b/.test(label)) {
        out.seoTitle = value.slice(0, TITLE_MAX)
      } else if (!out.metaDescription && /^(meta\s*)?description\b/.test(label)) {
        out.metaDescription = value.slice(0, DESCRIPTION_MAX)
      } else if (!out.slug && /^(slug|url)\b/.test(label)) {
        const slug = normalizeBriefSlug(value)
        if (slug) out.slug = slug
      } else if (!out.mainKeyword && /^(main(\s*keyword)?|focus\s*keyword)\b/.test(label)) {
        out.mainKeyword = value.slice(0, 200)
      } else if (!out.longtail && /^long\s*tail/.test(label)) {
        out.longtail = value.slice(0, 500)
      }
    }
  }
  return out
}
