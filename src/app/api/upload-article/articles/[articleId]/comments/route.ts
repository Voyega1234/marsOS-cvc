import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { COMMENT_REVISE_JOB_TYPE, keepStoredChanges, readArticleComments, sanitizeArticleComments } from '@/lib/upload-article/article-comments'
import { replaceArticleComments } from '@/lib/upload-article/article-comments-store'
import { REWRITE_SOURCE_TYPE } from '@/lib/upload-article/rewrite-lock'
import { averageCost } from '@/lib/upload-article/write-stamp'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'

/** บทความ + ลูกค้าของผู้ใช้คนนี้ (แถวเงา/แถวสำรองของ AI เขียนใหม่ไม่นับเป็นบทความ) */
async function loadTarget(articleId: string, orgId: string) {
  const article = await prisma.uploadArticle.findFirst({
    where: { id: articleId, organizationId: orgId },
    select: { id: true, clientId: true, sourceType: true },
  })
  if (!article || article.sourceType === REWRITE_SOURCE_TYPE) return null
  return article
}

/** ค่าใช้จ่ายเฉลี่ยของการปรับตาม comment — ของลูกค้ารายนี้ก่อน ไม่มีค่อยใช้ของทั้งองค์กร */
async function averageReviseCost(orgId: string, clientId: string) {
  const recent = (input?: string) =>
    prisma.aIJob.findMany({
      where: { organizationId: orgId, jobType: COMMENT_REVISE_JOB_TYPE, status: 'SUCCESS', estimatedCost: { not: null }, ...(input ? { input } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { estimatedCost: true },
    })
  let jobs = await recent(uaJobInput(clientId))
  if (jobs.length === 0) jobs = await recent()
  return averageCost(jobs.map((j) => (j.estimatedCost == null ? null : Number(j.estimatedCost))))
}

/** GET /api/upload-article/articles/[articleId]/comments — Comment ของลูกค้าของบทความนี้ + ค่าใช้จ่ายเฉลี่ยต่อการปรับ 1 ครั้ง */
export async function GET(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const article = await loadTarget(params.articleId, orgId)
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const prefs = await readPrefs(article.clientId, orgId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  // สถิติค่าใช้จ่ายเป็นแค่ข้อมูลประกอบ — อ่านไม่ได้ก็ยังต้องแสดง comment
  const cost = await averageReviseCost(orgId, article.clientId).catch(() => null)
  return NextResponse.json({
    comments: readArticleComments(prefs, article.id),
    avgCostUsd: cost ? cost.avg : null,
    costSamples: cost ? cost.samples : 0,
  })
}

/** PUT /api/upload-article/articles/[articleId]/comments body {comments} — แทนที่รายการ comment ของบทความนี้ทั้งชุด */
export async function PUT(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const body = (await req.json().catch(() => null)) as { comments?: unknown } | null
  if (!body || !Array.isArray(body.comments)) return NextResponse.json({ error: 'ข้อมูล Comment ไม่ถูกต้อง' }, { status: 400 })

  const article = await loadTarget(params.articleId, orgId)
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const next = sanitizeArticleComments(body.comments)
  // บันทึกว่า AI แก้อะไรไป (changes) เขียนได้จาก comment-revise เท่านั้น — ที่นี่คงของที่เก็บไว้ตาม id ไม่รับจากหน้าจอ
  const stored = await replaceArticleComments(article.clientId, orgId, article.id, (current) => keepStoredChanges(next, current))
  if (!stored) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ comments: stored })
}

export const dynamic = 'force-dynamic'
