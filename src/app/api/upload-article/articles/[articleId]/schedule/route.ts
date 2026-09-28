import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import type { UploadPushPrefs } from '@/lib/upload-article/types'

const MAX_PUBLISH_AT_ENTRIES = 400
const MIN_YEAR = 2000
const MAX_YEAR = 2100

/**
 * PATCH /api/upload-article/articles/[articleId]/schedule body {publishAt: ISO string | null}
 * ตั้ง/ล้างวัน-เวลาเผยแพร่ของบทความ — เก็บใน pushPrefs.publishAt[articleId] (ไม่แก้ schema)
 */
export async function PATCH(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  let publishAt: string | null = null
  if (body.publishAt !== null && body.publishAt !== undefined && body.publishAt !== '') {
    if (typeof body.publishAt !== 'string' || body.publishAt.length > 40) {
      return NextResponse.json({ error: 'วันที่ไม่ถูกต้อง' }, { status: 400 })
    }
    const d = new Date(body.publishAt)
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < MIN_YEAR || d.getUTCFullYear() > MAX_YEAR) {
      return NextResponse.json({ error: 'วันที่ไม่ถูกต้อง' }, { status: 400 })
    }
    publishAt = d.toISOString()
  }

  const result = await updatePrefs(article.clientId, orgId, (current) => {
    const cur = current as UploadPushPrefs
    const next: Record<string, string> = { ...(cur.publishAt ?? {}) }
    delete next[article.id]
    if (publishAt) next[article.id] = publishAt
    const keys = Object.keys(next)
    if (keys.length > MAX_PUBLISH_AT_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_PUBLISH_AT_ENTRIES)) delete next[k]
    }
    return { prefs: { ...cur, publishAt: next } as PrefsObject, result: true }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json({ ok: true, publishAt })
}
