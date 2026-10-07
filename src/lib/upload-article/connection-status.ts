// ─── Upload Article — ผลทดสอบการเชื่อมต่อล่าสุด (เก็บใน pushPrefs.connectionTest) ───
// ค้างไว้ให้ทีมเห็นว่าเคยเชื่อมสำเร็จแล้ว — ถ้า credentials/โดเมนเปลี่ยนหลังทดสอบ จะถือว่าผลเก่า (stale) ต้องทดสอบใหม่

import { createHash } from 'crypto'

export interface UploadConnectionTest {
  platform: string
  ok: boolean
  message: string
  at: string
  /** fingerprint ของ credentials ตอนทดสอบ — ไม่ใช่ค่าจริง */
  fp: string
}

/** ช่องที่เป็นการเลือกปลายทาง/จับคู่ฟิลด์ — เปลี่ยนแล้วไม่ทำให้ผลทดสอบเก่า */
const CHOICE_KEYS = new Set(['collectionId', 'collectionSlug', 'siteUrl', 'siteId', 'bodyField', 'imageField', 'descriptionField', 'seoTitleField', 'blogId', 'blogHandle', 'memberId'])

export function connectionFingerprint(row: { websitePlatform: string; wpUrl: string; wpUser: string; wpAppPasswordEnc: string; siteConnection: string }): string {
  const platform = row.websitePlatform || 'wordpress'
  let basis: unknown
  if (platform === 'wordpress') {
    basis = [row.wpUrl, row.wpUser, row.wpAppPasswordEnc]
  } else {
    let conn: Record<string, Record<string, string>> = {}
    try { conn = JSON.parse(row.siteConnection || '{}') } catch { conn = {} }
    const cfg = conn[platform] ?? {}
    basis = Object.keys(cfg).filter(k => !CHOICE_KEYS.has(k)).sort().map(k => [k, cfg[k]])
  }
  return createHash('sha256').update(platform + JSON.stringify(basis)).digest('hex').slice(0, 16)
}

export function readConnectionTest(raw: unknown): UploadConnectionTest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.platform !== 'string' || typeof r.ok !== 'boolean' || typeof r.at !== 'string' || typeof r.fp !== 'string') return null
  return { platform: r.platform, ok: r.ok, message: typeof r.message === 'string' ? r.message : '', at: r.at, fp: r.fp }
}
