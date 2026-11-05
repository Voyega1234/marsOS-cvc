import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { REWRITE_SOURCE_TYPE, freshRewriteShadow, rewriteBackupName } from '@/lib/upload-article/rewrite-lock'

/**
 * POST /api/upload-article/articles/[articleId]/rewrite-undo — ย้อนเนื้อหากลับไปก่อนเขียนใหม่ด้วย AI รอบล่าสุด
 * คืน sourceHtml / htmlContent / metaDescription จากแถวสำรอง แล้วลบแถวสำรอง (สถานะคงเดิม — โพสต์บนเว็บไม่ถูกแตะจนกว่าจะ Re-push)
 */
export async function POST(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = session.user.organizationId

  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  if (await freshRewriteShadow(article.id, orgId)) {
    return NextResponse.json({ error: 'บทความนี้กำลังถูก AI เขียนใหม่ — รอให้เสร็จก่อนแล้วค่อยย้อนกลับ' }, { status: 409 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // ล็อกแถวบทความกันสลับกับการเขียนใหม่/บันทึกที่ชนกัน
      await tx.$queryRaw`SELECT id FROM "plans_seo_pipeline"."UploadArticle" WHERE id = ${article.id} FOR UPDATE`
      const backup = await tx.uploadArticle.findFirst({
        where: { organizationId: orgId, sourceType: REWRITE_SOURCE_TYPE, sourceName: rewriteBackupName(article.id) },
      })
      if (!backup) return null
      const row = await tx.uploadArticle.update({
        where: { id: article.id },
        data: { sourceHtml: backup.sourceHtml, htmlContent: backup.htmlContent, metaDescription: backup.metaDescription },
      })
      await tx.uploadArticle.delete({ where: { id: backup.id } })
      return row
    }, { timeout: 15_000, maxWait: 10_000 })
    if (!updated) return NextResponse.json({ error: 'ไม่มีเวอร์ชันก่อนเขียนใหม่ให้ย้อนกลับ' }, { status: 404 })
    return NextResponse.json(toUploadArticleDTO(updated, true))
  } catch (e) {
    return NextResponse.json({ error: `ย้อนกลับไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
