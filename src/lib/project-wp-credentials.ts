// ─── SEO SME — รหัส WordPress ของโปรเจกต์ (Project.wpAppPassword) + หา credentials ตอนทดสอบ/push ──
// รหัสใหม่เก็บแบบเข้ารหัส "enc:v1:<iv>:<data>" (crypto.ts ชุดเดียวกับ WordPressConnection/Upload Article)
// รหัสเก่าที่ยังเป็นข้อความธรรมดาอ่านได้ตามเดิม แล้วเข้ารหัสทับให้เองตอนถูกใช้ (ไม่ต้องรันสคริปต์กับ DB จริง)

import { prisma } from '@/lib/prisma'
import { decrypt, encrypt } from '@/lib/crypto'
import { normalizeSavedWpUrl } from '@/lib/upload-article/wp-push'

const ENC_PREFIX = 'enc:v1:'

/** เข้ารหัสก่อนบันทึกลง Project.wpAppPassword — ค่าว่างคืน null */
export function encryptProjectWpPassword(plain: string | null | undefined): string | null {
  const t = (plain ?? '').trim()
  return t ? ENC_PREFIX + encrypt(t) : null
}

/** อ่านรหัสจาก Project.wpAppPassword — legacy = ยังเป็นข้อความธรรมดา (ควรเข้ารหัสทับ) */
export function readProjectWpPassword(stored: string | null | undefined): { ok: true; value: string; legacy: boolean } | { ok: false } {
  const s = (stored ?? '').trim()
  if (!s) return { ok: true, value: '', legacy: false }
  if (!s.startsWith(ENC_PREFIX)) return { ok: true, value: s, legacy: true }
  try {
    return { ok: true, value: decrypt(s.slice(ENC_PREFIX.length)), legacy: false }
  } catch {
    return { ok: false }
  }
}

/** เข้ารหัสทับรหัสเก่าแบบข้อความธรรมดา — ทับเฉพาะเมื่อค่าใน DB ยังเป็นค่าเดิม (กันทับรหัสที่เพิ่งบันทึกใหม่) ล้มก็ไม่กระทบงานหลัก */
export async function upgradeLegacyProjectWpPassword(projectId: string, legacyStored: string | null | undefined): Promise<void> {
  if (!legacyStored) return
  try {
    const enc = encryptProjectWpPassword(legacyStored)
    if (!enc) return
    await prisma.project.updateMany({ where: { id: projectId, wpAppPassword: legacyStored }, data: { wpAppPassword: enc } })
  } catch { /* ไม่มี WP_ENCRYPTION_KEY หรือ DB ล้ม — คงค่าเดิมไว้ อ่านได้ตามปกติ */ }
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export type ProjectWpCredentials =
  | { ok: true; wpUrl: string; wpUser: string; wpPass: string; source: 'connection' | 'project' | 'env' }
  | { ok: false; error: string }

/**
 * credentials WordPress ของการทดสอบ/push ฝั่ง SEO SME — ใช้ร่วมกันทั้ง /api/push/connect และ /api/push/publish
 * ลำดับ: Connection ที่เลือก → Connection ของโปรเจกต์ → ค่าในโปรเจกต์ → .env
 * รหัสจาก .env ใช้ได้เฉพาะกับเว็บเดียวกับ WP_URL เท่านั้น — ห้ามส่งรหัสของเว็บหนึ่งไปให้อีกเว็บ
 * URL ถูกปรับเป็น https เสมอ (Application Password ของ WordPress ใช้ได้เฉพาะ https)
 */
export async function resolveProjectWpCredentials(orgId: string, projectId?: string | null, connectionId?: string | null): Promise<ProjectWpCredentials> {
  let wpUrl = '', wpUser = '', wpPass = ''
  let source: 'connection' | 'project' | 'env' = 'env'

  const fromConnection = (conn: { siteUrl: string; username: string; appPasswordEncrypted: string }): boolean => {
    wpUrl = normalizeSavedWpUrl(conn.siteUrl)
    wpUser = conn.username.trim()
    source = 'connection'
    try { wpPass = decrypt(conn.appPasswordEncrypted); return true } catch { return false }
  }
  const decryptError: ProjectWpCredentials = process.env.WP_ENCRYPTION_KEY
    ? { ok: false, error: 'ถอดรหัส Application Password ไม่สำเร็จ — ใส่รหัสใหม่แล้วบันทึก' }
    : { ok: false, error: 'เซิร์ฟเวอร์ไม่มี WP_ENCRYPTION_KEY — ถอดรหัส Application Password ไม่ได้ แจ้งผู้ดูแลระบบ' }

  if (connectionId) {
    const conn = await prisma.wordPressConnection.findFirst({ where: { id: connectionId, organizationId: orgId } })
    if (conn && !fromConnection(conn)) return decryptError
  }

  if (!wpUrl && projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true, wpUrl: true, wpUser: true, wpAppPassword: true, wordpressConnection: true },
    })
    if (project?.wordpressConnection) {
      if (!fromConnection(project.wordpressConnection)) return decryptError
    } else if (project?.wpUrl) {
      const pass = readProjectWpPassword(project.wpAppPassword)
      if (!pass.ok) return decryptError
      wpUrl = normalizeSavedWpUrl(project.wpUrl)
      wpUser = project.wpUser?.trim() ?? ''
      wpPass = pass.value
      source = 'project'
      if (pass.legacy) void upgradeLegacyProjectWpPassword(project.id, project.wpAppPassword)
    }
  }

  const envUrl = normalizeSavedWpUrl(process.env.WP_URL ?? '')
  if (!wpUrl) {
    wpUrl = envUrl
    wpUser = process.env.WP_USER?.trim() ?? ''
    wpPass = process.env.WP_APP_PASSWORD?.trim() ?? ''
    source = 'env'
  } else if ((!wpUser || !wpPass) && envUrl && hostOf(envUrl) === hostOf(wpUrl)) {
    // เว็บเดียวกับ .env แต่ตั้งค่าไม่ครบ — ใช้ User + Password จาก .env ทั้งคู่ (ห้ามจับคู่ user ของที่หนึ่งกับรหัสของอีกที่)
    wpUser = process.env.WP_USER?.trim() ?? ''
    wpPass = process.env.WP_APP_PASSWORD?.trim() ?? ''
    source = 'env'
  }

  if (!wpUrl || !wpUser || !wpPass) {
    return { ok: false, error: 'ไม่พบ WordPress credentials — เลือก Connection หรือตั้งค่า URL / Username / Application Password ใน Project Settings' }
  }
  return { ok: true, wpUrl, wpUser, wpPass, source }
}
