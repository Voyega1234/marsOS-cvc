// ตราประทับ "บทความนี้เขียนจากอะไร" — ใช้ตัดสินว่า Re-generate ควรให้ AI เขียนใหม่ทั้งบทความหรือไม่
// เก็บเฉพาะ hash ต่อ layer (ไม่เก็บข้อความ) ใน pushPrefs.articleWriteStamps[articleId]
import { createHash } from 'node:crypto'
import { structureOptionsFromDetail } from './references'
import type { UploadThemeDetail } from './types'

export const WRITE_STAMP_LABELS: Record<string, string> = {
  businessSkill: 'Business Skill',
  masterPrompt: 'Master Prompt',
  articleBrief: 'Article Brief',
  validatorPack: 'Validator Pack',
  restrictions: 'ข้อจำกัด (Content Engine)',
  comments: 'Comment ลูกค้า',
  keyword: 'Keyword',
  note: 'โน้ตของ keyword',
  intent: 'Search intent',
  articleType: 'ประเภทบทความ',
  language: 'ภาษาบทความ',
  structure: 'โครงบทความจากการสแกนเว็บ',
  references: 'แหล่งอ้างอิงที่อนุญาต',
}

export type WriteStamp = Record<string, string>

export interface WriteStampInput {
  businessSkill?: string | null
  masterPrompt?: string | null
  articleBrief?: string | null
  validatorPack?: string | null
  /** ข้อจำกัด/Comment — ส่งเป็นค่าที่ serialize ได้ (object ก็ได้) */
  restrictions?: unknown
  comments?: unknown
  keyword?: string | null
  note?: string | null
  intent?: string | null
  articleType?: string | null
  language?: string | null
  structure?: unknown
  references?: unknown
}

/** JSON ที่ลำดับ key คงที่ — hash ต้องไม่เปลี่ยนเพราะลำดับ key */
export function stableStringify(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = walk(o[k])
        return acc
      }, {})
    }
    return x
  }
  return JSON.stringify(walk(v))
}

export function hashText(v: unknown): string {
  return createHash('sha256').update(stableStringify(v)).digest('hex').slice(0, 16)
}

export function computeWriteStamp(input: WriteStampInput): WriteStamp {
  const out: WriteStamp = {}
  for (const k of Object.keys(WRITE_STAMP_LABELS) as Array<keyof WriteStampInput>) out[k] = hashText(input[k])
  return out
}

export interface StampChange { key: string; label: string }

/** เทียบตราเดิมกับปัจจุบัน — key ที่ตราเดิมไม่มี (ตราเก่ากว่า) ถือว่าไม่เปลี่ยน */
export function diffWriteStamp(stored: WriteStamp, current: WriteStamp): StampChange[] {
  const out: StampChange[] = []
  for (const key of Object.keys(WRITE_STAMP_LABELS)) {
    if (stored[key] === undefined || current[key] === undefined) continue
    if (stored[key] !== current[key]) out.push({ key, label: WRITE_STAMP_LABELS[key] })
  }
  return out
}

/** อ่านตราจาก pushPrefs.articleWriteStamps — รูปแบบผิด = null */
export function readWriteStamp(prefs: Record<string, unknown> | null | undefined, articleId: string): WriteStamp | null {
  const all = prefs?.articleWriteStamps
  if (!all || typeof all !== 'object') return null
  const s = (all as Record<string, unknown>)[articleId]
  if (!s || typeof s !== 'object') return null
  const out: WriteStamp = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return Object.keys(out).length ? out : null
}

/** บทความเก่าไม่มีตรา — layer ที่แก้หลังบทความถูกสร้าง = "น่าจะเปลี่ยน" (ไม่เห็น layer ที่ปิด/ไฟล์ที่ลบ) */
export function legacyChangedLayers(
  layers: Array<{ key: string; updatedAt: Date | null | undefined }>,
  articleCreatedAt: Date,
): StampChange[] {
  return layers
    .filter((l) => l.updatedAt && l.updatedAt.getTime() > articleCreatedAt.getTime())
    .map((l) => ({ key: l.key, label: WRITE_STAMP_LABELS[l.key] ?? l.key }))
}

/** ค่าเฉลี่ยต้นทุนเขียนต่อบทความจากงานล่าสุด (ไม่มีข้อมูล = null) */
export function averageCost(costs: Array<number | null | undefined>): { avg: number; samples: number } | null {
  const v = costs.filter((c): c is number => typeof c === 'number' && c > 0)
  if (v.length === 0) return null
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, samples: v.length }
}

interface TextFiles { data: unknown; files: Array<{ text: string }> }

/** ประกอบ input ของตราจากของที่ write route ใช้เขียนจริง — write route กับ rewrite-check ต้องเรียกตัวนี้ตัวเดียวกัน */
export function buildWriteStampInput(p: {
  ce: { businessSkill: { text: string } | null; masterPrompt: { text: string } | null; articleBrief: { text: string } | null; validatorPack: { text: string } | null }
  restrictions: TextFiles | null
  clientComments: TextFiles | null
  keyword: { keyword: string; note?: string; intent?: string; articleType?: string }
  detail?: UploadThemeDetail | null
  /** หัวข้อเดียวกับที่ write route ส่งให้ structureOptionsFromDetail (`${title} ${keyword}`) */
  topic?: string
  language?: string | null
}): WriteStampInput {
  // hash เฉพาะสิ่งที่ตัวเขียนเห็นจริง (structureOptionsFromDetail) — posts/toc ที่ re-scan แล้วเปลี่ยนไม่ทำให้เตือนมั่ว
  const opts = structureOptionsFromDetail(p.detail, p.topic ?? '')
  const { library, ...structure } = opts ?? {}
  const pack = (t: TextFiles | null) => (t ? { data: t.data, files: t.files.map((f) => f.text) } : null)
  return {
    businessSkill: p.ce.businessSkill?.text, masterPrompt: p.ce.masterPrompt?.text,
    articleBrief: p.ce.articleBrief?.text, validatorPack: p.ce.validatorPack?.text,
    restrictions: pack(p.restrictions), comments: pack(p.clientComments),
    keyword: p.keyword.keyword, note: p.keyword.note,
    intent: p.keyword.intent, articleType: p.keyword.articleType, language: p.language,
    structure: opts ? structure : undefined, references: library,
  }
}
