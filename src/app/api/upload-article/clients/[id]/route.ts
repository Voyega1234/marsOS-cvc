import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import type { UploadPushPrefs, UploadTheme } from '@/lib/upload-article/types'
import { sanitizeThemeDetail } from '@/lib/upload-article/theme-css'
import { checkCredentialUrl } from '@/lib/upload-article/safe-fetch'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import { readImageDefaults } from '@/lib/upload-article/article-images'

const COLOR_RE = /^#[0-9a-f]{3,8}$/i

function isValidColor(v: unknown): v is string {
  return typeof v === 'string' && (v === '' || COLOR_RE.test(v))
}

/** โฮสต์ของ URL แบบ lower-case — ใช้เทียบว่าเปลี่ยนเว็บปลายทางหรือไม่ (เทียบแบบ string ถ้า parse ไม่ได้) */
function hostOf(url: string): string {
  if (!url) return ''
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

/** แพลตฟอร์มอื่นที่มีช่องโดเมน/URL + secret อยู่ใน siteConnection เดียวกัน — เปลี่ยนโดเมนโดยไม่ส่ง secret ใหม่มาด้วย ต้องล้าง secret เดิมทิ้ง */
const SITE_CONN_SECRET_FIELDS: Record<string, { domain: string; secrets: string[] }> = {
  shopify: { domain: 'storeDomain', secrets: ['accessToken'] },
  custom: { domain: 'webhookUrl', secrets: ['secret'] },
}

/** โยนออกจาก transaction ของ DELETE เมื่อยังมีบทความที่ขึ้นเว็บแล้ว — กันลบระหว่างที่ push ค้างอยู่พอดี (lost update) */
class BusyArticlesError extends Error {
  constructor(public count: number) {
    super('มีบทความกำลัง push/เขียนอยู่')
  }
}

/** PUSHING/WRITING ที่ค้างเกินนี้ถือว่าตายแล้ว ไม่กันการลบ (ตรงกับ lock 6 นาทีของ push/writer) */
const BUSY_WINDOW_MS = 6 * 60 * 1000

async function loadClient(id: string, orgId: string) {
  return prisma.uploadClient.findFirst({
    where: { id, organizationId: orgId },
    include: { articles: { select: { status: true } } },
  })
}

/** GET /api/upload-article/clients/[id] */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await loadClient(params.id, session.user.organizationId)
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json(toUploadClientDTO(client, computeClientCounts(client.articles)))
}

/** PATCH /api/upload-article/clients/[id] — แก้ข้อมูล/ธีม/credentials บางส่วน */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const existing = await loadClient(params.id, orgId)
  if (!existing) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 120)
    if (!name) return NextResponse.json({ error: 'ชื่อลูกค้าห้ามว่าง' }, { status: 400 })
    data.name = name
  }
  if (typeof body.website === 'string') data.website = body.website.trim()
  if (body.language === 'th' || body.language === 'en' || body.language === 'both') data.language = body.language
  if (typeof body.websitePlatform === 'string') data.websitePlatform = body.websitePlatform
  if (typeof body.wpUser === 'string') data.wpUser = body.wpUser.trim()

  // wpUrl ต้องเป็น https + โฮสต์สาธารณะก่อนถูกส่งรหัสผ่าน WordPress ไปหา (กัน SSRF / ยิงรหัสผ่านผิดที่)
  const nextPlatform = typeof body.websitePlatform === 'string' ? body.websitePlatform : existing.websitePlatform
  const wpCredsInBody = typeof body.wpUser === 'string' || typeof body.wpAppPassword === 'string'
  if (typeof body.wpUrl === 'string') {
    const raw = body.wpUrl.trim()
    if (!raw) {
      data.wpUrl = ''
    } else if (nextPlatform === 'wordpress' || wpCredsInBody) {
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      const err = await checkCredentialUrl(normalized)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
      data.wpUrl = normalized
    } else {
      data.wpUrl = raw
    }
  }

  if (body.theme && typeof body.theme === 'object') {
    const t = body.theme as Partial<UploadTheme>
    for (const key of ['theme', 'text', 'border', 'accent', 'background'] as const) {
      if (t[key] !== undefined && !isValidColor(t[key])) {
        return NextResponse.json({ error: `สี ${key} ไม่ถูกต้อง` }, { status: 400 })
      }
    }
    // ค่าฟอนต์ไปอยู่ใน <style> ของบทความ — รับเฉพาะชื่อฟอนต์/คอมมา/เครื่องหมายคำพูด กัน CSS/HTML injection
    for (const key of ['fontFamily', 'headingFont'] as const) {
      const v = t[key]
      if (v !== undefined && (typeof v !== 'string' || v.length > 200 || !/^[\w\s\u00C0-\u024F\u0E00-\u0E7F'",-]*$/.test(v))) {
        return NextResponse.json({ error: 'ชื่อฟอนต์มีอักขระที่ไม่รองรับ' }, { status: 400 })
      }
    }
    if (t.styleMode !== undefined && t.styleMode !== 'embed' && t.styleMode !== 'clean') {
      return NextResponse.json({ error: 'styleMode ต้องเป็น embed หรือ clean' }, { status: 400 })
    }
    let current: UploadTheme
    try {
      current = JSON.parse(existing.themeColors)
    } catch {
      current = { theme: '#2563eb', text: '#1f2937', border: '#e5e7eb', accent: '#2563eb', background: '', styleMode: 'embed' }
    }
    // whitelist เฉพาะ key ที่มีจริงใน UploadTheme — กันส่ง key แปลกปลอมเข้ามาปน
    const next: UploadTheme = { ...current }
    for (const key of ['theme', 'text', 'border', 'accent', 'background'] as const) {
      if (typeof t[key] === 'string') next[key] = t[key] as string
    }
    for (const key of ['fontFamily', 'headingFont'] as const) {
      if (typeof t[key] === 'string') next[key] = t[key] as string
    }
    if (t.styleMode === 'embed' || t.styleMode === 'clean') next.styleMode = t.styleMode
    // detail ไปเป็น CSS ในบทความ — ผ่าน sanitize ทุกช่อง, null = ล้างกลับค่าตั้งต้น
    if ('detail' in t) {
      const detail = t.detail === null ? undefined : sanitizeThemeDetail(t.detail)
      if (detail) next.detail = detail
      else delete next.detail
    }
    data.themeColors = JSON.stringify(next)
  }

  // pushPrefs เขียนผ่าน updatePrefs (ล็อกแถว อ่านค่าล่าสุดก่อนแก้) กัน request อื่นที่กำลังเขียน pushPrefs พร้อมกันหาย (lost update)
  if (body.pushPrefs && typeof body.pushPrefs === 'object') {
    const p = body.pushPrefs as Record<string, unknown>
    const result = await updatePrefs(existing.id, orgId, (current) => {
      const cur = current as UploadPushPrefs
      // whitelist เฉพาะ key ที่ทีมแก้ได้จากหน้า UI — siteScan เขียนได้จาก route สแกนเท่านั้น (ไม่อยู่ใน whitelist นี้)
      const next: UploadPushPrefs = { ...cur }
      if (p.publishMode === 'draft' || p.publishMode === 'publish') next.publishMode = p.publishMode
      if (p.wpPostType === 'post' || p.wpPostType === 'page') next.wpPostType = p.wpPostType
      if (typeof p.useElementor === 'boolean') next.useElementor = p.useElementor
      if (typeof p.stripH1 === 'boolean') next.stripH1 = p.stripH1
      if (p.excludeCards && typeof p.excludeCards === 'object') {
        const ec = p.excludeCards as Record<string, unknown>
        const nextEc: { toc?: boolean; cta?: boolean; faq?: boolean } = { ...(cur.excludeCards ?? {}) }
        for (const k of ['toc', 'cta', 'faq'] as const) {
          if (typeof ec[k] === 'boolean') nextEc[k] = ec[k] as boolean
        }
        next.excludeCards = nextEc
      }
      if (p.imageDefaults && typeof p.imageDefaults === 'object') {
        next.imageDefaults = readImageDefaults({ ...(cur.imageDefaults ?? {}), ...(p.imageDefaults as object) })
      }
      return { prefs: next as PrefsObject, result: undefined }
    })
    if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  }

  // เปลี่ยนเว็บ (โฮสต์ wpUrl) หรือเปลี่ยน wpUser โดยไม่ได้ส่งรหัสผ่านใหม่มาด้วย → ล้างรหัสผ่านเดิมทิ้ง
  // กันรหัสผ่านของเว็บเก่าถูกใช้ยิง (เช่น "ทดสอบการเชื่อมต่อ") ไปที่เว็บ/ผู้ใช้ใหม่โดยไม่ตั้งใจ
  let wpPasswordCleared = false
  const newPasswordSupplied = typeof body.wpAppPassword === 'string' && body.wpAppPassword.trim() !== ''
  if (!newPasswordSupplied && existing.wpAppPasswordEnc) {
    const newWpUrl = typeof data.wpUrl === 'string' ? data.wpUrl : existing.wpUrl
    const newWpUser = typeof data.wpUser === 'string' ? data.wpUser : existing.wpUser
    const hostChanged = hostOf(newWpUrl) !== hostOf(existing.wpUrl) && hostOf(newWpUrl) !== ''
    const userChanged = newWpUser !== existing.wpUser
    if (hostChanged || userChanged) {
      data.wpAppPasswordEnc = ''
      wpPasswordCleared = true
    }
  }

  if (body.wpAppPassword === null) {
    data.wpAppPasswordEnc = ''
  } else if (typeof body.wpAppPassword === 'string' && body.wpAppPassword.trim()) {
    data.wpAppPasswordEnc = encrypt(body.wpAppPassword.trim())
  }
  // wpAppPassword === '' (หรือไม่ส่งมา) → เก็บค่าเดิมไว้ ไม่แตะ wpAppPasswordEnc (เว้นแต่ถูกล้างเพราะเปลี่ยนเว็บ/ผู้ใช้ด้านบน)

  const secretsClearedPlatforms: string[] = []
  if (body.siteConnection && typeof body.siteConnection === 'object') {
    let currentConn: Record<string, Record<string, string>> = {}
    try {
      currentConn = JSON.parse(existing.siteConnection)
    } catch {
      currentConn = {}
    }
    const incoming = body.siteConnection as Record<string, Record<string, unknown>>
    const merged: Record<string, Record<string, string>> = { ...currentConn }
    for (const [platform, cfg] of Object.entries(incoming)) {
      if (!cfg || typeof cfg !== 'object') continue
      const mergedPlatform: Record<string, string> = { ...(currentConn[platform] ?? {}) }
      for (const [key, val] of Object.entries(cfg)) {
        if (typeof val !== 'string') continue
        if (val === '' || val.startsWith('••••')) continue // ว่าง/ถูก mask → คงค่าเดิม
        mergedPlatform[key] = val
      }
      // โดเมน/URL เปลี่ยนแต่ไม่ได้ส่ง secret ใหม่มาด้วย → ล้าง secret เดิมทิ้ง กันหลุดไปโดเมนใหม่
      const rule = SITE_CONN_SECRET_FIELDS[platform]
      if (rule) {
        const oldDomain = currentConn[platform]?.[rule.domain] ?? ''
        const newDomain = mergedPlatform[rule.domain] ?? ''
        const domainChanged = newDomain !== '' && newDomain !== oldDomain
        const secretResupplied = rule.secrets.some((s) => {
          const v = cfg[s]
          return typeof v === 'string' && v !== '' && !v.startsWith('••••')
        })
        if (domainChanged && !secretResupplied) {
          let cleared = false
          for (const s of rule.secrets) {
            if (mergedPlatform[s]) cleared = true
            delete mergedPlatform[s]
          }
          if (cleared) secretsClearedPlatforms.push(platform)
        }
      }
      merged[platform] = mergedPlatform
    }
    data.siteConnection = JSON.stringify(merged)
  }

  const updated = await prisma.uploadClient.update({ where: { id: existing.id }, data })
  const withArticles = await loadClient(updated.id, orgId)
  return NextResponse.json({
    ...toUploadClientDTO(updated, computeClientCounts(withArticles?.articles ?? [])),
    wpPasswordCleared: wpPasswordCleared || undefined,
    siteConnectionSecretsCleared: secretsClearedPlatforms.length ? secretsClearedPlatforms : undefined,
  })
}

/**
 * DELETE /api/upload-article/clients/[id] body {confirmName} — ลบลูกค้า (cascade ลบบทความทั้งหมด รวมที่ขึ้นเว็บแล้ว)
 * เจ้าของสั่ง 2026-09-28: ต้องลบได้จริงแม้มีบทความขึ้นเว็บแล้ว — ระบบไม่ลบโพสต์บนเว็บไซต์ลูกค้า
 * กันพลาด: ต้องส่งชื่อลูกค้าให้ตรง + ห้ามลบระหว่างมีบทความกำลัง push/เขียนอยู่
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  if (typeof body.confirmName !== 'string' || body.confirmName.trim() !== existing.name.trim()) {
    return NextResponse.json({ error: 'ชื่อลูกค้าที่พิมพ์ยืนยันไม่ตรง' }, { status: 400 })
  }

  // นับ + ลบในทรานแซกชันเดียว กันบทความเริ่ม push/เขียนแทรกเข้ามาระหว่างนับกับลบพอดี
  try {
    await prisma.$transaction(async (tx) => {
      const busyCount = await tx.uploadArticle.count({
        where: {
          clientId: existing.id,
          status: { in: ['PUSHING', 'WRITING'] },
          updatedAt: { gt: new Date(Date.now() - BUSY_WINDOW_MS) },
        },
      })
      if (busyCount > 0) throw new BusyArticlesError(busyCount)
      // ลบ Content Engine prompt ที่ผูก scope กับลูกค้านี้ด้วย (PromptVersion cascade ตาม schema แล้ว)
      await tx.promptTemplate.deleteMany({ where: { organizationId: existing.organizationId, projectId: existing.id } })
      await tx.uploadClient.delete({ where: { id: existing.id } })
    })
  } catch (err) {
    if (err instanceof BusyArticlesError) {
      return NextResponse.json({
        error: `ลบลูกค้าไม่ได้ตอนนี้ — มีบทความกำลัง push หรือกำลังเขียนอยู่ ${err.count} บทความ รอให้เสร็จก่อนแล้วลองใหม่`,
      }, { status: 409 })
    }
    throw err
  }

  return NextResponse.json({ ok: true })
}
