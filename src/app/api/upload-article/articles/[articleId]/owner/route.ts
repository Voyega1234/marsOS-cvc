import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import { readArticleOwners, readOwnerTags } from '@/lib/upload-article/owner-tags'

type OwnerResult = { error: string } | { articleOwners: Record<string, string> }

/**
 * PATCH /api/upload-article/articles/[articleId]/owner body {ownerTagId: string | null}
 * ตั้ง/ล้างผู้ดูแลบทความ — เก็บใน pushPrefs.articleOwners[articleId] (ไม่แก้ schema)
 */
export async function PATCH(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  let ownerTagId: string | null = null
  if (body.ownerTagId !== null && body.ownerTagId !== undefined && body.ownerTagId !== '') {
    if (typeof body.ownerTagId !== 'string' || body.ownerTagId.length > 64) {
      return NextResponse.json({ error: 'ผู้ดูแลไม่ถูกต้อง' }, { status: 400 })
    }
    ownerTagId = body.ownerTagId
  }

  const result = await updatePrefs<OwnerResult>(article.clientId, orgId, (current) => {
    const tags = readOwnerTags(current.ownerTags)
    if (ownerTagId && !tags.some((t) => t.id === ownerTagId)) {
      return { result: { error: 'ไม่พบผู้ดูแลนี้ — เพิ่มชื่อที่แท็บ Report ก่อน' } }
    }
    const articleOwners = readArticleOwners(current.articleOwners, tags)
    delete articleOwners[article.id]
    if (ownerTagId) articleOwners[article.id] = ownerTagId
    const next: PrefsObject = { ...current, articleOwners }
    return { prefs: next, result: { articleOwners } }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if ('error' in result.result) return NextResponse.json({ error: result.result.error }, { status: 400 })

  return NextResponse.json({ articleOwners: result.result.articleOwners })
}

export const dynamic = 'force-dynamic'
