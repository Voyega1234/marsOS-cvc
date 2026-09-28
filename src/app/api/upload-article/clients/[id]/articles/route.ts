import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import {
  extractTitleFromHtml,
  fetchGoogleDoc,
  importFromFile,
  importFromHtml,
  importFromMarkdown,
  importFromText,
} from '@/lib/upload-article/import-source'
import { extractBriefMeta } from '@/lib/upload-article/doc-meta'

export const maxDuration = 120

const MAX_FILES = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** GET /api/upload-article/clients/[id]/articles?status= — รายการบทความของลูกค้า (ไม่รวม sourceHtml/htmlContent) */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: session.user.organizationId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const status = req.nextUrl.searchParams.get('status') || undefined
  const articles = await prisma.uploadArticle.findMany({
    where: { clientId: client.id, organizationId: session.user.organizationId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json(articles.map((a) => toUploadArticleDTO(a, false)))
}

interface ImportedSource {
  name: string
  sourceType: string
  title: string
  html: string
  warnings?: string[]
}

/** POST /api/upload-article/clients/[id]/articles — นำเข้าบทความจากไฟล์ (multipart) หรือ JSON items */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const contentType = req.headers.get('content-type') || ''
  const imported: ImportedSource[] = []
  const errors: Array<{ name: string; error: string }> = []

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'อ่านไฟล์ไม่สำเร็จ' }, { status: 400 })

    const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, MAX_FILES)
    if (files.length === 0) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 400 })

    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES) {
          errors.push({ name: file.name, error: 'ไฟล์ใหญ่เกิน 10MB' })
          continue
        }
        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = (file.name.split('.').pop() || '').toLowerCase()
        const result = await importFromFile(file.name, buffer)
        imported.push({ name: file.name, sourceType: ext || 'paste', title: result.title, html: result.html, warnings: result.warnings })
      } catch (e) {
        errors.push({ name: file.name, error: e instanceof Error ? e.message : String(e) })
      }
    }
  } else {
    const body = await req.json().catch(() => null)
    const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_FILES) : []
    if (items.length === 0) return NextResponse.json({ error: 'ไม่พบรายการนำเข้า' }, { status: 400 })

    for (const [idx, item] of items.entries()) {
      const label = String(item?.title ?? '').trim() || `รายการที่ ${idx + 1}`
      try {
        if (typeof item?.googleDocUrl === 'string' && item.googleDocUrl.trim()) {
          const result = await fetchGoogleDoc(item.googleDocUrl.trim())
          imported.push({ name: item.googleDocUrl.trim(), sourceType: 'gdoc', title: item?.title?.trim() || result.title, html: result.html })
        } else if (typeof item?.html === 'string' && item.html.trim()) {
          const result = importFromHtml(item.html)
          imported.push({ name: label, sourceType: 'html', title: item?.title?.trim() || result.title, html: result.html })
        } else if (typeof item?.text === 'string' && item.text.trim()) {
          const result = importFromText(item.text)
          imported.push({ name: label, sourceType: 'paste', title: item?.title?.trim() || result.title, html: result.html })
        } else {
          errors.push({ name: label, error: 'ไม่พบเนื้อหา (html/text/googleDocUrl)' })
        }
      } catch (e) {
        errors.push({ name: label, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  const created = []
  const warnings: Array<{ name: string; warning: string }> = []
  for (const src of imported) {
    const title = src.title.trim() || extractTitleFromHtml(src.html, src.name) || 'บทความไม่มีชื่อ'
    const brief = extractBriefMeta(src.html)
    const row = await prisma.uploadArticle.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        title: title.slice(0, 200),
        sourceType: src.sourceType,
        sourceName: src.name.slice(0, 200),
        sourceHtml: src.html,
        createdById: session.user.id,
        ...(brief.seoTitle ? { seoTitle: brief.seoTitle } : {}),
        ...(brief.metaDescription ? { metaDescription: brief.metaDescription } : {}),
        ...(brief.slug ? { slug: brief.slug } : {}),
      },
    })
    created.push(toUploadArticleDTO(row, false))
    for (const w of src.warnings ?? []) warnings.push({ name: src.name, warning: w })
  }

  return NextResponse.json({ created, errors, warnings }, { status: 201 })
}
