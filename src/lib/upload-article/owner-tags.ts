// ─── Upload Article — แท็กผู้ดูแลบทความ (pushPrefs.ownerTags / articleOwners) ──────
// ฟังก์ชันล้วน ไม่พึ่ง prisma/session — ใช้ทั้งใน DTO sanitizer, route PUT/PATCH และ unit test

import type { UploadOwnerTag } from './types'
import { UPLOAD_MAX_OWNER_TAGS, UPLOAD_MAX_OWNER_TAG_NAME } from './types'

/** อ่าน pushPrefs.ownerTags แบบกันค่าเพี้ยน: เอาเฉพาะ {id,name} ที่เป็น string, name trim ≤ 40 ตัว, id ไม่ซ้ำ, สูงสุด 30 */
export function readOwnerTags(raw: unknown): UploadOwnerTag[] {
  if (!Array.isArray(raw)) return []
  const out: UploadOwnerTag[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { id, name } = item as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string') continue
    const cleanId = id.trim()
    const cleanName = name.trim().slice(0, UPLOAD_MAX_OWNER_TAG_NAME).trim()
    if (!cleanId || !cleanName || seen.has(cleanId)) continue
    seen.add(cleanId)
    out.push({ id: cleanId, name: cleanName })
    if (out.length >= UPLOAD_MAX_OWNER_TAGS) break
  }
  return out
}

/** อ่าน pushPrefs.articleOwners — เก็บเฉพาะค่า string ที่ tag id นั้นยังมีอยู่จริงใน ownerTags */
export function readArticleOwners(raw: unknown, tags: UploadOwnerTag[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const valid = new Set(tags.map((t) => t.id))
  const out: Record<string, string> = {}
  for (const [articleId, tagId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tagId === 'string' && valid.has(tagId)) out[articleId] = tagId
  }
  return out
}

/**
 * รับรายการที่ทีมส่งมาแก้ (PUT owner-tags) → รายการ tag ใหม่
 * trim + ตัดชื่อว่าง + ชื่อซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) + สูงสุด 30
 * คง id เดิมถ้ามีอยู่ในรายการเดิม (existing) ไม่งั้นออก id ใหม่ (newId) — กัน id ที่ client แต่งเองมาชนของคนอื่น
 */
export function mergeOwnerTagInput(input: unknown, existing: UploadOwnerTag[], newId: () => string): UploadOwnerTag[] {
  if (!Array.isArray(input)) return []
  const existingIds = new Set(existing.map((t) => t.id))
  const usedIds = new Set<string>()
  const usedNames = new Set<string>()
  const out: UploadOwnerTag[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const { id, name } = item as Record<string, unknown>
    if (typeof name !== 'string') continue
    const cleanName = name.trim().slice(0, UPLOAD_MAX_OWNER_TAG_NAME).trim()
    if (!cleanName) continue
    const nameKey = cleanName.toLowerCase()
    if (usedNames.has(nameKey)) continue

    let tagId = typeof id === 'string' && existingIds.has(id) && !usedIds.has(id) ? id : ''
    if (!tagId) {
      do { tagId = newId() } while (existingIds.has(tagId) || usedIds.has(tagId))
    }
    usedIds.add(tagId)
    usedNames.add(nameKey)
    out.push({ id: tagId, name: cleanName })
    if (out.length >= UPLOAD_MAX_OWNER_TAGS) break
  }
  return out
}
