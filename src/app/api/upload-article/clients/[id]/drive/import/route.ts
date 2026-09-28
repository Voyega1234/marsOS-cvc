import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toUploadArticleDTO } from '@/lib/upload-article/serialize'
import { extractTitleFromHtml, fetchGoogleDoc, importFromFile, type ImportResult } from '@/lib/upload-article/import-source'
import { extractBriefMeta } from '@/lib/upload-article/doc-meta'
import {
  downloadDriveFile,
  driveFolderUrl,
  driveImageToDataUrl,
  isValidDriveId,
  listDriveFolder,
  splitArticleFolder,
} from '@/lib/upload-article/drive-folder'

export const maxDuration = 120

/**
 * POST /api/upload-article/clients/[id]/drive/import  { folderId, name, resourceKey? }
 * นำเข้า "โฟลเดอร์บทความเดียว" — เอกสาร (Google Doc/.docx) ตามต้นฉบับ ห้ามแก้เนื้อ + รูปปก (ย่อแล้ว)
 * ฝั่ง client วนเรียกทีละโฟลเดอร์ เพื่อไม่ให้ request เดียวทำงานนานจน timeout
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const folderId = body?.folderId
  if (!isValidDriveId(folderId)) return NextResponse.json({ error: 'ID โฟลเดอร์ไม่ถูกต้อง' }, { status: 400 })
  const resourceKey = typeof body?.resourceKey === 'string' && /^[A-Za-z0-9_-]+$/.test(body.resourceKey) ? body.resourceKey : undefined
  const folderName = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const force = body?.force === true

  // กันนำเข้าโฟลเดอร์เดิมซ้ำ — เทียบด้วย sourceName (ลิงก์โฟลเดอร์มาตรฐาน) ของลูกค้านี้
  if (!force) {
    const sourceName = driveFolderUrl({ id: folderId, resourceKey }).slice(0, 200)
    const dup = await prisma.uploadArticle.findFirst({
      where: { organizationId: orgId, clientId: client.id, sourceType: 'gdrive', sourceName },
      select: { id: true },
    })
    if (dup) return NextResponse.json({ error: 'โฟลเดอร์นี้นำเข้าแล้ว' }, { status: 409 })
  }

  let listing: Awaited<ReturnType<typeof listDriveFolder>>
  try {
    listing = await listDriveFolder(folderId, resourceKey)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
  const { doc, cover } = splitArticleFolder(listing.entries)
  if (!doc) return NextResponse.json({ error: 'ไม่พบไฟล์ Google Doc หรือ .docx ในโฟลเดอร์' }, { status: 400 })

  // เนื้อหา — ใช้ตัวนำเข้าเดิม (ไม่เขียนใหม่ ไม่แก้เนื้อ)
  let result: ImportResult
  try {
    if (doc.kind === 'gdoc') {
      result = await fetchGoogleDoc(`https://docs.google.com/document/d/${doc.id}/edit`)
    } else {
      const { buffer } = await downloadDriveFile(doc.id, doc.resourceKey)
      const fileName = /\.docx$/i.test(doc.name) ? doc.name : `${doc.name}.docx`
      result = await importFromFile(fileName, buffer)
    }
  } catch (e) {
    return NextResponse.json({ error: `${doc.name}: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 })
  }
  if (!result.html.trim()) return NextResponse.json({ error: `${doc.name}: เอกสารว่างเปล่า` }, { status: 400 })

  const docBaseName = doc.name.replace(/\.docx$/i, '')
  const title =
    (result.title.trim() || extractTitleFromHtml(result.html, docBaseName) || folderName || listing.title || 'บทความไม่มีชื่อ').slice(0, 200)

  // รูปปก — พลาดได้ ไม่ทำให้การนำเข้าล้ม (แจ้งเป็น warning)
  let coverImageUrl: string | null = null
  let warning: string | undefined = result.warnings?.length ? result.warnings.join(' · ') : undefined
  if (cover) {
    try {
      coverImageUrl = await driveImageToDataUrl(cover.id, cover.resourceKey)
    } catch (e) {
      const coverWarning = `ใส่ภาพปก "${cover.name}" ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`
      warning = warning ? `${warning} · ${coverWarning}` : coverWarning
    }
  }

  const brief = extractBriefMeta(result.html)
  const row = await prisma.uploadArticle.create({
    data: {
      organizationId: orgId,
      clientId: client.id,
      title,
      sourceType: 'gdrive',
      sourceName: driveFolderUrl({ id: folderId, resourceKey }).slice(0, 200),
      sourceHtml: result.html,
      ...(coverImageUrl ? { coverImageUrl, coverAlt: title } : {}),
      createdById: session.user.id,
      ...(brief.seoTitle ? { seoTitle: brief.seoTitle } : {}),
      ...(brief.metaDescription ? { metaDescription: brief.metaDescription } : {}),
      ...(brief.slug ? { slug: brief.slug } : {}),
    },
  })

  return NextResponse.json(
    { article: toUploadArticleDTO(row, false), coverName: coverImageUrl ? cover?.name : undefined, warning },
    { status: 201 },
  )
}
