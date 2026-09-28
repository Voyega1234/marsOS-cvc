import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import type { UploadPushPrefs, UploadTheme } from '@/lib/upload-article/types'

const COLOR_RE = /^#[0-9a-f]{3,8}$/i

function isValidColor(v: unknown): v is string {
  return typeof v === 'string' && (v === '' || COLOR_RE.test(v))
}

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
  if (body.language === 'th' || body.language === 'en') data.language = body.language
  if (typeof body.websitePlatform === 'string') data.websitePlatform = body.websitePlatform
  if (typeof body.wpUrl === 'string') data.wpUrl = body.wpUrl.trim()
  if (typeof body.wpUser === 'string') data.wpUser = body.wpUser.trim()

  if (body.theme && typeof body.theme === 'object') {
    const t = body.theme as Partial<UploadTheme>
    for (const key of ['theme', 'text', 'border', 'accent', 'background'] as const) {
      if (t[key] !== undefined && !isValidColor(t[key])) {
        return NextResponse.json({ error: `สี ${key} ไม่ถูกต้อง` }, { status: 400 })
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
    data.themeColors = JSON.stringify({ ...current, ...t })
  }

  if (body.pushPrefs && typeof body.pushPrefs === 'object') {
    const p = body.pushPrefs as Partial<UploadPushPrefs>
    let current: UploadPushPrefs
    try {
      current = JSON.parse(existing.pushPrefs)
    } catch {
      current = {}
    }
    data.pushPrefs = JSON.stringify({ ...current, ...p })
  }

  if (body.wpAppPassword === null) {
    data.wpAppPasswordEnc = ''
  } else if (typeof body.wpAppPassword === 'string' && body.wpAppPassword.trim()) {
    data.wpAppPasswordEnc = encrypt(body.wpAppPassword.trim())
  }
  // wpAppPassword === '' (หรือไม่ส่งมา) → เก็บค่าเดิมไว้ ไม่แตะ wpAppPasswordEnc

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
      merged[platform] = mergedPlatform
    }
    data.siteConnection = JSON.stringify(merged)
  }

  const updated = await prisma.uploadClient.update({ where: { id: existing.id }, data })
  const withArticles = await loadClient(updated.id, orgId)
  return NextResponse.json(toUploadClientDTO(updated, computeClientCounts(withArticles?.articles ?? [])))
}

/** DELETE /api/upload-article/clients/[id] — ลบลูกค้า (cascade ลบบทความทั้งหมด) */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  await prisma.uploadClient.delete({ where: { id: existing.id } })
  return NextResponse.json({ ok: true })
}
