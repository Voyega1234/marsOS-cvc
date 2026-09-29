import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { refreshUploadSchema, uploadSchemaOptions } from '@/lib/upload-article/build-html'
import { stripGoogleDocsCommentsHtml } from '@/lib/upload-article/clean-html'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import type { UploadPushPrefs } from '@/lib/upload-article/types'
import { pbnArticleEffective } from '@/lib/upload-article/pbn-context'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const VALID_STATUS = new Set(['IMPORTED', 'GENERATED', 'REVIEWED', 'PUSHED', 'FAILED'])

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** GET /api/upload-article/articles/[articleId] — DTO เต็ม (มี sourceHtml + htmlContent) */
export async function GET(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: session.user.organizationId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  return NextResponse.json(toUploadArticleDTO(article, true))
}

/** PATCH /api/upload-article/articles/[articleId] — แก้ไขบางส่วน */
export async function PATCH(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const existing = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, 'utf-8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'ข้อมูลใหญ่เกิน 4MB — ลดขนาดรูปภาพก่อนบันทึก' }, { status: 413 })
  }
  const body = (() => {
    try {
      return JSON.parse(rawBody)
    } catch {
      return null
    }
  })()
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 200)
  if (typeof body.sourceHtml === 'string') data.sourceHtml = body.sourceHtml
  // คอมเมนต์ Google Docs ที่ติดมากับการวางเนื้อหาใน editor — ตัดก่อนบันทึก
  if (typeof body.htmlContent === 'string') data.htmlContent = stripGoogleDocsCommentsHtml(body.htmlContent)
  if (body.htmlContent === null) data.htmlContent = null
  if (body.outputMode === 'html' || body.outputMode === 'text') data.outputMode = body.outputMode
  if (typeof body.seoTitle === 'string') data.seoTitle = body.seoTitle.trim().slice(0, 120)
  if (typeof body.metaDescription === 'string') data.metaDescription = body.metaDescription.trim().slice(0, 300)
  if (typeof body.slug === 'string') data.slug = sanitizeSlug(body.slug)
  if (typeof body.coverAlt === 'string') data.coverAlt = body.coverAlt.trim().slice(0, 200)
  if (body.coverImageUrl === null) {
    data.coverImageUrl = null
  } else if (typeof body.coverImageUrl === 'string') {
    if (body.coverImageUrl && !/^data:image\//i.test(body.coverImageUrl) && !/^https:\/\//i.test(body.coverImageUrl)) {
      return NextResponse.json({ error: 'coverImageUrl ต้องเป็น data:image/... หรือ https://' }, { status: 400 })
    }
    data.coverImageUrl = body.coverImageUrl
  }
  if (typeof body.status === 'string') {
    if (!VALID_STATUS.has(body.status)) return NextResponse.json({ error: 'status ไม่ถูกต้อง' }, { status: 400 })
    data.status = body.status
  }

  // meta/slug/ปก หรือ HTML เปลี่ยน → สร้าง schema ใหม่ให้ตรงค่าล่าสุด (ไม่แตะเนื้อหา)
  const touchesSchema = ['htmlContent', 'seoTitle', 'metaDescription', 'slug', 'coverImageUrl', 'coverAlt', 'title'].some((k) => k in data)
  const nextHtml = 'htmlContent' in data ? (data.htmlContent as string | null) : existing.htmlContent
  if (touchesSchema && nextHtml) {
    const client = await prisma.uploadClient.findFirst({ where: { id: existing.clientId, organizationId: existing.organizationId } })
    if (client) {
      const merged = { ...existing, ...data } as typeof existing
      data.htmlContent = refreshUploadSchema(nextHtml, uploadSchemaOptions(merged, pbnArticleEffective(client, existing.id).client))
    }
  }

  const updated = await prisma.uploadArticle.update({ where: { id: existing.id }, data })
  // ตัด sourceHtml ออกจาก response ของ PATCH (ไม่มีหน้าไหนใช้ค่านี้จากผลลัพธ์ PATCH โดยตรง — ลดขนาด response
  // กัน 4.5MB ของ Vercel เวลาบันทึก htmlContent/coverImageUrl ก้อนใหญ่) ฝั่ง client merge แบบ spread จึงคงค่าที่มีอยู่เดิมไว้
  const dto = toUploadArticleDTO(updated, true)
  delete dto.sourceHtml
  return NextResponse.json(dto)
}

/** DELETE /api/upload-article/articles/[articleId] — บทความที่ขึ้นเว็บแล้ว (Draft/Publish) ลบไม่ได้ */
export async function DELETE(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: session.user.organizationId } })
  if (!existing) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  if (existing.wordpressPostId || existing.pushedAt) {
    return NextResponse.json({ error: 'บทความนี้ขึ้นเว็บไซต์แล้ว — ลบไม่ได้ ระบบเก็บไว้ไม่ให้หาย' }, { status: 409 })
  }

  await prisma.uploadArticle.delete({ where: { id: existing.id } })

  // ตัด cardSel/publishAt[articleId] ของบทความที่ลบไปแล้วทิ้ง — เขียนผ่าน updatePrefs กัน pushPrefs ที่แก้พร้อมกันหาย (lost update)
  await updatePrefs(existing.clientId, session.user.organizationId, (current) => {
    const cur = current as UploadPushPrefs
    const inCardSel = Boolean(cur.cardSel && existing.id in cur.cardSel)
    const inPublishAt = Boolean(cur.publishAt && existing.id in cur.publishAt)
    if (!inCardSel && !inPublishAt) return { result: undefined }
    const next: UploadPushPrefs = { ...cur }
    if (inCardSel) {
      const nextCardSel = { ...cur.cardSel }
      delete nextCardSel[existing.id]
      next.cardSel = nextCardSel
    }
    if (inPublishAt) {
      const nextPublishAt = { ...cur.publishAt }
      delete nextPublishAt[existing.id]
      next.publishAt = nextPublishAt
    }
    return { prefs: next as PrefsObject, result: undefined }
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
