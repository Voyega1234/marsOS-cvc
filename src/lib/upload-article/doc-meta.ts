// ─── Upload Article — อ่านตาราง brief ของผู้เขียนในต้นฉบับ ──────────────────────
// ต้นฉบับมีตารางแบบนี้อยู่ต้นเอกสาร (build-html ตัดออกจากเนื้อหาอยู่แล้ว):
//   Keyword | Search Volume
//   Main | ระบบเหยื่อกำจัดปลวก | 10
//   Longtail | เหยื่อกำจัดปลวก, ...
//   Title Count : (Max 70) | <meta title>
//   Description Count : (Max 160) | <meta description>
//   Slug | <slug>
// ฟังก์ชันล้วน ไม่พึ่ง prisma

import { parse, NodeType, type HTMLElement } from 'node-html-parser'
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
  if (!html) return out
  const hasTable = /<table/i.test(html)
  const hasList = /<(ul|ol|p)\b/i.test(html)
  if (!hasTable && !hasList) return out
  const root = parse(decodeTextEntities(html), { blockTextElements: {} })
  for (const table of hasTable ? root.querySelectorAll('table') : []) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td, th')
      if (cells.length < 2) continue
      const label = cellText(cells[0]).toLowerCase()
      const value = cells.slice(1).map((c) => cellText(c)).find(Boolean) || ''
      if (!label || !value) continue
      if (!out.seoTitle && /^(seo\s*|meta\s*)?title\b/.test(label)) {
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
  // brief แบบรายการ ("SEO Metadata" + <li><strong>SEO Title (55 characters):</strong> ...</li>) — ตารางมาก่อน รายการเติมเฉพาะช่องที่ยังว่าง
  if (hasList) {
    const blocks = root.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
    for (const entry of findBriefListBlocks(blocks).entries) {
      const { field, value } = entry
      if (field === 'seoTitle' && !out.seoTitle) out.seoTitle = value.slice(0, TITLE_MAX)
      else if (field === 'metaDescription' && !out.metaDescription) out.metaDescription = value.slice(0, DESCRIPTION_MAX)
      else if (field === 'slug' && !out.slug) {
        const slug = normalizeBriefSlug(value)
        if (slug) out.slug = slug
      } else if (field === 'mainKeyword' && !out.mainKeyword) out.mainKeyword = value.slice(0, 200)
      else if (field === 'longtail' && !out.longtail) out.longtail = value.slice(0, 500)
    }
  }
  return out
}

// ─── brief แบบรายการ "ป้าย: ค่า" ───────────────────────────────────────────────
// ต้นฉบับบางชุดเขียน brief เป็นรายการแทนตาราง เช่น
//   <p><strong>SEO Metadata</strong></p>
//   <ul><li><strong>Primary Keyword:</strong> ...</li><li><strong>SEO Title (55 characters):</strong> ...</li>
//       <li><strong>Meta Description (146 characters):</strong> ...</li><li><strong>H1:</strong> ...</li></ul>
// build-html ตัดก้อนนี้ออกจากเนื้อหา และ extractBriefMeta เอาค่าไปใส่ seoTitle / metaDescription

export type BriefListField = 'seoTitle' | 'metaDescription' | 'slug' | 'mainKeyword' | 'longtail' | 'h1' | 'other'

/** หัวก้อน brief: "SEO Metadata", "SEO Meta Data:", "SEO Brief", "Metadata" */
const BRIEF_MARKER_RE = /^(seo\s*)?(meta\s*-?\s*data|meta|brief)(\s*(info|details))?\s*:?$/i

const LIST_LABELS: Array<[RegExp, BriefListField]> = [
  [/^(seo|meta|page)\s*title$|^title(\s*tag)?$/, 'seoTitle'],
  [/^(seo\s*|meta\s*)?description$/, 'metaDescription'],
  [/^(url\s*)?slug$|^url$/, 'slug'],
  [/^(primary|main|focus|target)\s*keyword$|^main$/, 'mainKeyword'],
  [/^(long\s*tail|secondary)(\s*keywords?)?$/, 'longtail'],
  [/^h1(\s*title)?$/, 'h1'],
  [/^(search\s*volume|keywords?|word\s*count|intent|search\s*intent)$/, 'other'],
]

function textOf(el: HTMLElement): string {
  return (el.text || '').replace(/\s+/g, ' ').trim()
}

/** "SEO Title (55 characters): ค่า" → ช่อง + ค่า · ไม่ใช่ป้าย brief = null */
export function parseBriefLine(text: string): { field: BriefListField; value: string } | null {
  const m = /^([^:：]{1,60})[:：]\s*(.*)$/.exec(text.replace(/\s+/g, ' ').trim())
  if (!m) return null
  const label = m[1]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const value = m[2].trim()
  if (!label || !value) return null
  for (const [re, field] of LIST_LABELS) if (re.test(label)) return { field, value }
  return null
}

function isMarkerBlock(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (!/^(p|h[1-6])$/.test(tag)) return false
  return BRIEF_MARKER_RE.test(textOf(el))
}

/** รายการที่ทุกข้อเป็น "ป้าย brief: ค่า" อย่างน้อย 2 ข้อ (และต้องมี title/description/keyword อย่างน้อย 1) */
function briefListEntries(el: HTMLElement): Array<{ field: BriefListField; value: string }> | null {
  const tag = el.tagName.toLowerCase()
  if (tag !== 'ul' && tag !== 'ol') return null
  const items = el.querySelectorAll('li')
  if (items.length < 2) return null
  const entries: Array<{ field: BriefListField; value: string }> = []
  for (const li of items) {
    const e = parseBriefLine(textOf(li))
    if (!e) return null
    entries.push(e)
  }
  return entries.some((e) => e.field === 'seoTitle' || e.field === 'metaDescription' || e.field === 'mainKeyword') ? entries : null
}

/**
 * หา block ที่เป็น brief แบบรายการในลำดับ block ระดับบนของเอกสาร
 * - หัว "SEO Metadata" (ย่อหน้า/หัวข้อ) + รายการหรือย่อหน้า "ป้าย: ค่า" ที่ตามมาติดกัน
 * - หรือรายการ ul/ol ที่ทุกข้อเป็นป้าย brief (ไม่มีหัวก็ได้)
 * คืน index ของ block ที่ต้องตัด และค่าที่อ่านได้
 */
export function findBriefListBlocks(blocks: HTMLElement[]): {
  drop: Set<number>
  entries: Array<{ field: BriefListField; value: string }>
} {
  const drop = new Set<number>()
  const entries: Array<{ field: BriefListField; value: string }> = []
  for (let i = 0; i < blocks.length; i++) {
    if (drop.has(i)) continue
    const el = blocks[i]
    if (isMarkerBlock(el)) {
      // เก็บรายการ/ย่อหน้า "ป้าย: ค่า" ที่ตามหัวมาติดกัน — เจออย่างอื่นก็หยุด
      const found: Array<{ field: BriefListField; value: string }> = []
      const taken: number[] = []
      let j = i + 1
      while (j < blocks.length) {
        const b = blocks[j]
        const list = briefListEntries(b)
        if (list) {
          found.push(...list)
          taken.push(j)
          j++
          continue
        }
        if (b.tagName.toLowerCase() === 'p') {
          const line = parseBriefLine(textOf(b))
          if (line) {
            found.push(line)
            taken.push(j)
            j++
            continue
          }
          if (!textOf(b)) {
            taken.push(j)
            j++
            continue
          }
        }
        break
      }
      if (found.some((e) => e.field !== 'other')) {
        drop.add(i)
        for (const t of taken) drop.add(t)
        entries.push(...found)
        i = j - 1
      }
      continue
    }
    const list = briefListEntries(el)
    if (list) {
      drop.add(i)
      entries.push(...list)
    }
  }
  return { drop, entries }
}
