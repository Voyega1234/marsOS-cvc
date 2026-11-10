// ─── Upload Article — Import Outline (ฝั่ง server) ───
// แปลง HTML ที่ importer อ่านมา → แถว keyword ที่แนบ outline แล้วต่อท้าย pushPrefs.keywordPlan
// ไม่แตะ Prisma schema — outline เก็บใน UploadKeyword.outline

import { randomUUID } from 'crypto'
import { extractBriefMeta } from './doc-meta'
import { sanitizeSlugCandidate, uniqueSlug } from './keywords-ai'
import { updatePrefs } from './prefs-store'
import { parseOutlineFromHtml, type UploadOutline } from './outline'
import type { UploadKeyword } from './types'

export const OUTLINE_EMPTY_ERROR = 'ไม่พบหัวข้อใน outline'
export const KEYWORD_PLAN_MAX = 500

export interface OutlineSourceInfo {
  source: UploadOutline['source']
  /** ชื่อไฟล์ / URL Google Doc / ชื่อรายการที่วาง */
  sourceName: string
  /** ชื่อเรื่องจาก importer (extractTitleFromHtml) ใช้เป็น fallback */
  importerTitle?: string
}

function baseName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
}

/** สร้างแถว keyword จาก outline — throw ถ้าไม่มีหัวข้อ (slug ยังไม่ unique: appendOutlineKeywords จัดการตอนต่อท้าย) */
export function buildOutlineKeyword(html: string, info: OutlineSourceInfo, now: Date = new Date()): UploadKeyword {
  const parsed = parseOutlineFromHtml(html)
  if (parsed.items.length === 0) throw new Error(OUTLINE_EMPTY_ERROR)
  const brief = extractBriefMeta(html)
  const title = (parsed.title || info.importerTitle?.trim() || baseName(info.sourceName)).trim().slice(0, 200)
  const keyword = (brief.mainKeyword || parsed.keyword || title).trim().slice(0, 200)
  const slug = sanitizeSlugCandidate((brief.slug || parsed.slug || '').trim().slice(0, 200))
  const iso = now.toISOString()
  return {
    id: randomUUID(),
    keyword,
    volume: null,
    title,
    slug,
    intent: '',
    articleType: '',
    outline: {
      items: parsed.items,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
      source: info.source,
      sourceName: info.sourceName.slice(0, 300),
      importedAt: iso,
    },
    createdAt: iso,
  }
}

/** ต่อท้าย keywordPlan (ล็อกแถวผ่าน updatePrefs) — slug ซ้ำจะต่อท้ายเลข, เกินเพดานรวม 500 = ไม่เขียนเลย
 *  คืน null ถ้าไม่พบลูกค้า */
export async function appendOutlineKeywords(
  clientId: string,
  orgId: string,
  rows: UploadKeyword[],
): Promise<{ rows: UploadKeyword[] } | { error: string } | null> {
  const out = await updatePrefs<{ rows: UploadKeyword[] } | { error: string }>(clientId, orgId, (current) => {
    const plan = Array.isArray(current.keywordPlan) ? (current.keywordPlan as UploadKeyword[]) : []
    if (plan.length + rows.length > KEYWORD_PLAN_MAX) {
      return { result: { error: `เกินเพดาน ${KEYWORD_PLAN_MAX} คำ (มีอยู่ ${plan.length} คำ เพิ่มได้อีก ${Math.max(0, KEYWORD_PLAN_MAX - plan.length)} คำ)` } }
    }
    const taken = new Set(plan.map((k) => k.slug).filter(Boolean))
    const added = rows.map((r) => {
      if (!r.slug) return r
      const slug = uniqueSlug(r.slug, taken)
      taken.add(slug)
      return { ...r, slug }
    })
    return { prefs: { ...current, keywordPlan: [...plan, ...added] }, result: { rows: added } }
  })
  return out ? out.result : null
}
