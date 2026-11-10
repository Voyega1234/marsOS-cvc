import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchGoogleDoc, importFromFile, importFromHtml, importFromText } from '@/lib/upload-article/import-source'
import { appendOutlineKeywords, buildOutlineKeyword } from '@/lib/upload-article/outline-import'
import type { UploadKeyword } from '@/lib/upload-article/types'

export const maxDuration = 120

/**
 * POST /api/upload-article/clients/[id]/outlines — นำเข้า outline (ไม่ใช่บทความ) เป็นแถว keyword ใหม่ใน keywordPlan
 *
 * Request (อย่างใดอย่างหนึ่ง):
 *  - multipart/form-data  field "files" (หลายไฟล์ ≤20, ไฟล์ละ ≤10MB; .docx/.txt/.md/.html ฯลฯ ตาม importFromFile)
 *  - application/json     { items: [{ title?, text? | html? | googleDocUrl? }] }  (≤20 รายการ)
 *      ลำดับความสำคัญต่อรายการ: googleDocUrl > html > text
 *
 * Response 201:
 *  {
 *    created: [{ id, title, keyword, headings, name }],   // headings = จำนวนหัวข้อ H2-H6 ใน outline
 *    errors:  [{ name, error }],                          // รายการที่ล้ม (อ่านไม่ได้ / ไม่พบหัวข้อใน outline)
 *    items:   UploadKeyword[]                             // แถวเต็มที่เพิ่ม (มี outline) — ตรงกับที่เก็บใน keywordPlan
 *  }
 *  400 { error } = ไม่มีไฟล์/รายการ หรือ keywordPlan เกินเพดาน 500 (ไม่เขียนอะไรเลย)
 *  401 / 403 (CLIENT) / 404 ไม่พบลูกค้า
 */

const MAX_FILES = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024

interface Prepared {
  name: string
  source: 'file' | 'paste' | 'gdoc'
  title: string
  html: string
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const contentType = req.headers.get('content-type') || ''
  const prepared: Prepared[] = []
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
        const result = await importFromFile(file.name, Buffer.from(await file.arrayBuffer()))
        prepared.push({ name: file.name, source: 'file', title: result.title, html: result.html })
      } catch (e) {
        errors.push({ name: file.name, error: e instanceof Error ? e.message : String(e) })
      }
    }
  } else {
    const body = await req.json().catch(() => null)
    const items = Array.isArray(body?.items) ? body.items.slice(0, MAX_FILES) : []
    if (items.length === 0) return NextResponse.json({ error: 'ไม่พบรายการนำเข้า' }, { status: 400 })

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]
      const label = String(item?.title ?? '').trim() || `รายการที่ ${idx + 1}`
      try {
        if (typeof item?.googleDocUrl === 'string' && item.googleDocUrl.trim()) {
          const url = item.googleDocUrl.trim()
          const result = await fetchGoogleDoc(url)
          prepared.push({ name: url, source: 'gdoc', title: item?.title?.trim() || result.title, html: result.html })
        } else if (typeof item?.html === 'string' && item.html.trim()) {
          const result = importFromHtml(item.html)
          prepared.push({ name: label, source: 'paste', title: item?.title?.trim() || result.title, html: result.html })
        } else if (typeof item?.text === 'string' && item.text.trim()) {
          const result = importFromText(item.text)
          prepared.push({ name: label, source: 'paste', title: item?.title?.trim() || result.title, html: result.html })
        } else {
          errors.push({ name: label, error: 'ไม่พบเนื้อหา (html/text/googleDocUrl)' })
        }
      } catch (e) {
        errors.push({ name: label, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  const rows: UploadKeyword[] = []
  const names: string[] = []
  for (const p of prepared) {
    try {
      rows.push(buildOutlineKeyword(p.html, { source: p.source, sourceName: p.name, importerTitle: p.title }))
      names.push(p.name)
    } catch (e) {
      errors.push({ name: p.name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  let added: UploadKeyword[] = []
  if (rows.length > 0) {
    const out = await appendOutlineKeywords(client.id, orgId, rows)
    if (!out) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: 400 })
    added = out.rows
  }

  const created = added.map((k, i) => ({ id: k.id, title: k.title, keyword: k.keyword, headings: k.outline?.items.length ?? 0, name: names[i] }))
  return NextResponse.json({ created, errors, items: added }, { status: 201 })
}

export const dynamic = 'force-dynamic'
