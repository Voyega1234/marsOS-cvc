import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import { isPbnPrefs } from '@/lib/upload-article/pbn'
import { uploadHtmlVersion } from '@/lib/upload-article/cards'
import { uploadArticleLanguage } from '@/lib/upload-article/build-html'
import { TOC_POSITION_MAX, normalizeTocPosition, placeToc, sectionCountOfHtml } from '@/lib/upload-article/toc-position'

/** POST /api/upload-article/articles/[articleId]/toc-position — ย้าย (หรือเพิ่ม) สารบัญของระบบในบทความ + จำตำแหน่งไว้ให้ Generate ครั้งถัดไป */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const client = await prisma.uploadClient.findFirst({ where: { id: article.clientId, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  let prefsNow: Record<string, unknown> = {}
  try { prefsNow = JSON.parse(client.pushPrefs) } catch { /* ใช้ค่าว่าง */ }
  if (isPbnPrefs(prefsNow)) return NextResponse.json({ error: 'บทความ PBN ไม่มีสารบัญของระบบ' }, { status: 400 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const position = normalizeTocPosition(body.position)
  if (position === undefined) return NextResponse.json({ error: 'ตำแหน่งสารบัญไม่ถูกต้อง' }, { status: 400 })
  if (typeof body.version !== 'string' || !body.version || body.version.length > 100) {
    return NextResponse.json({ error: 'version ไม่ถูกต้อง' }, { status: 400 })
  }
  if (!article.htmlContent) return NextResponse.json({ error: 'บทความยังไม่ได้ Generate' }, { status: 400 })
  if (uploadHtmlVersion(article.htmlContent) !== body.version) {
    return NextResponse.json({ error: 'บทความถูกแก้ไปแล้ว — โหลดใหม่ก่อนย้ายสารบัญ' }, { status: 409 })
  }

  const language = uploadArticleLanguage(client.language, article.title)
  const html = placeToc(article.htmlContent, position, language)
  if (html === null) {
    return NextResponse.json({ error: 'วางสารบัญไม่ได้ — บทความต้องมีหัวข้อ H2 อย่างน้อย 3 หัวข้อ (และผ่าน Generate แล้ว)' }, { status: 400 })
  }

  // ล็อกด้วย updatedAt — มีคนแก้บทความระหว่างนี้ = ไม่เขียนทับ
  const res = await prisma.uploadArticle.updateMany({
    where: { id: article.id, organizationId: orgId, updatedAt: article.updatedAt },
    data: { htmlContent: html },
  })
  if (res.count === 0) return NextResponse.json({ error: 'บทความถูกแก้ไปแล้ว — โหลดใหม่ก่อนย้ายสารบัญ' }, { status: 409 })

  // ย้ายไปท้ายบทความ = จำว่า "ท้ายเสมอ" ไม่ใช่ "หลังหัวข้อที่ n" (บทความถัดไปหัวข้อเยอะกว่าก็ยังอยู่ท้าย)
  const remembered = position > 0 && position >= sectionCountOfHtml(html) ? TOC_POSITION_MAX : position
  const saved = await updatePrefs(article.clientId, orgId, (current) => {
    const next: PrefsObject = { ...current, tocPosition: remembered }
    const cardSel = { ...((current.cardSel as Record<string, unknown> | undefined) ?? {}) }
    delete cardSel[article.id] // เวอร์ชัน HTML เปลี่ยนแล้ว — หน้า Push บันทึก selection ใหม่เอง
    next.cardSel = cardSel
    return { prefs: next, result: undefined }
  })
  if (!saved) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const updated = await prisma.uploadArticle.findFirst({ where: { id: article.id, organizationId: orgId } })
  if (!updated) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  const dto = toUploadArticleDTO(updated, true)
  delete dto.sourceHtml
  return NextResponse.json({ article: dto, tocPosition: remembered })
}
