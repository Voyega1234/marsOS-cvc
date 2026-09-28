import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { findPbnClientId } from '@/lib/upload-article/pbn-store'
import { readPbnSites } from '@/lib/upload-article/pbn'
import { readPbnStyles, type PbnStyle } from '@/lib/upload-article/pbn-sets'
import { sanitizeThemeDetail } from '@/lib/upload-article/theme-css'
import { DEFAULT_UPLOAD_THEME, type UploadTheme } from '@/lib/upload-article/types'

export const dynamic = 'force-dynamic'

const COLOR_RE = /^#[0-9a-f]{3,8}$/i
const FONT_RE = /^[\w\sÀ-ɏ฀-๿'",-]*$/
const COLOR_KEYS = ['theme', 'text', 'border', 'accent', 'background'] as const
const FONT_KEYS = ['fontFamily', 'headingFont'] as const

async function auth() {
  const session = await getSession()
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const orgId = session.user.organizationId
  const clientId = await findPbnClientId(orgId)
  return { orgId, clientId }
}

/**
 * ตรวจ + รวมธีมเข้ากับค่าฐาน — เกณฑ์เดียวกับ PATCH /api/upload-article/clients/[id] (ค่าไปอยู่ใน <style> ของบทความ)
 * whitelist เฉพาะ key ของ UploadTheme, detail ผ่าน sanitize ทุกช่อง
 */
function mergeTheme(base: UploadTheme, raw: unknown): UploadTheme | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'ข้อมูลสไตล์ไม่ถูกต้อง' }
  const t = raw as Partial<UploadTheme>
  for (const key of COLOR_KEYS) {
    const v = t[key]
    if (v !== undefined && !(typeof v === 'string' && (v === '' || COLOR_RE.test(v)))) return { error: `สี ${key} ไม่ถูกต้อง` }
  }
  for (const key of FONT_KEYS) {
    const v = t[key]
    if (v !== undefined && (typeof v !== 'string' || v.length > 200 || !FONT_RE.test(v))) return { error: 'ชื่อฟอนต์มีอักขระที่ไม่รองรับ' }
  }
  if (t.styleMode !== undefined && t.styleMode !== 'embed' && t.styleMode !== 'clean') return { error: 'styleMode ต้องเป็น embed หรือ clean' }
  const next: UploadTheme = {
    theme: base.theme,
    text: base.text,
    border: base.border,
    accent: base.accent,
    background: base.background,
    styleMode: base.styleMode === 'clean' ? 'clean' : 'embed',
  }
  if (base.fontFamily !== undefined) next.fontFamily = base.fontFamily
  if (base.headingFont !== undefined) next.headingFont = base.headingFont
  if (base.detail) next.detail = base.detail
  for (const key of COLOR_KEYS) if (typeof t[key] === 'string') next[key] = t[key] as string
  for (const key of FONT_KEYS) if (typeof t[key] === 'string') next[key] = t[key] as string
  if (t.styleMode === 'embed' || t.styleMode === 'clean') next.styleMode = t.styleMode
  if ('detail' in t) {
    const detail = t.detail === null ? undefined : sanitizeThemeDetail(t.detail)
    if (detail) next.detail = detail
    else delete next.detail
  }
  return next
}

/** GET /api/pbn-backlinks/styles — สไตล์บทความที่ตั้งชื่อตามเว็บ PBN (key = siteId) */
export async function GET() {
  const a = await auth()
  if ('error' in a) return a.error
  if (!a.clientId) return NextResponse.json({ styles: {} })
  const prefs = await readPrefs(a.clientId, a.orgId)
  return NextResponse.json({ styles: readPbnStyles(prefs) })
}

/**
 * PUT /api/pbn-backlinks/styles body {siteId, name?, theme}
 * สร้าง/แก้สไตล์ของเว็บ — ยังไม่มีสไตล์ = เริ่มจากสไตล์หลักของโปรเจกต์ PBN แล้วทับด้วยค่าที่ส่งมา
 */
export async function PUT(req: NextRequest) {
  const a = await auth()
  if ('error' in a) return a.error
  if (!a.clientId) return NextResponse.json({ error: 'ยังไม่มีเว็บ PBN' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const siteId = typeof body?.siteId === 'string' ? body.siteId : ''
  if (!siteId) return NextResponse.json({ error: 'เลือกเว็บ PBN ก่อน' }, { status: 400 })
  const rawName = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''

  const row = await prisma.uploadClient.findFirst({ where: { id: a.clientId, organizationId: a.orgId }, select: { themeColors: true } })
  let mainTheme: UploadTheme = DEFAULT_UPLOAD_THEME
  try {
    if (row?.themeColors) mainTheme = { ...DEFAULT_UPLOAD_THEME, ...JSON.parse(row.themeColors) }
  } catch {
    /* ใช้ค่าตั้งต้น */
  }

  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const site = readPbnSites(current).find((s) => s.id === siteId)
    if (!site) return { result: { error: 'ไม่พบเว็บ PBN นี้ (อาจถูกลบไปแล้ว)' } as { error: string } | PbnStyle }
    const styles = readPbnStyles(current)
    const prev = styles[siteId]
    const merged = mergeTheme(prev?.theme ?? mainTheme, body?.theme ?? {})
    if ('error' in merged) return { result: merged }
    const style: PbnStyle = { siteId, name: rawName || prev?.name || site.name, theme: merged, updatedAt: new Date().toISOString() }
    return { prefs: { ...current, pbnStyles: { ...styles, [siteId]: style } }, result: style }
  })
  if (!out) return NextResponse.json({ error: 'ไม่พบโปรเจกต์ PBN' }, { status: 404 })
  if ('error' in out.result) return NextResponse.json({ error: out.result.error }, { status: 400 })
  return NextResponse.json({ style: out.result })
}

/** DELETE /api/pbn-backlinks/styles?siteId= — ลบสไตล์ของเว็บ (บทความของเว็บนั้นกลับไปใช้สไตล์หลัก) */
export async function DELETE(req: NextRequest) {
  const a = await auth()
  if ('error' in a) return a.error
  const siteId = new URL(req.url).searchParams.get('siteId') || ''
  if (!a.clientId || !siteId) return NextResponse.json({ error: 'ไม่พบสไตล์นี้' }, { status: 404 })
  const out = await updatePrefs(a.clientId, a.orgId, (current) => {
    const styles = readPbnStyles(current)
    if (!styles[siteId]) return { result: false }
    delete styles[siteId]
    return { prefs: { ...current, pbnStyles: styles }, result: true }
  })
  if (!out?.result) return NextResponse.json({ error: 'ไม่พบสไตล์นี้' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
