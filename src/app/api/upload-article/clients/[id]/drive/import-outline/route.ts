import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { extractTitleFromHtml, fetchGoogleDoc, importFromFile, type ImportResult } from '@/lib/upload-article/import-source'
import { downloadDriveFile, driveFolderUrl, isValidDriveId, listDriveFolder, splitArticleFolder } from '@/lib/upload-article/drive-folder'
import { appendOutlineKeywords, buildOutlineKeyword } from '@/lib/upload-article/outline-import'

export const maxDuration = 120

/**
 * POST /api/upload-article/clients/[id]/drive/import-outline  { folderId, name?, resourceKey? }
 * นำเข้า "โฟลเดอร์เดียว" เป็น outline (อ่านเอกสาร Google Doc/.docx ตัวแรกในโฟลเดอร์ ไม่เอารูป) → เพิ่มแถว keyword ใหม่ใน keywordPlan (source 'gdrive')
 * ฝั่ง client วนเรียกทีละโฟลเดอร์เหมือน drive/import
 *
 * Response 201: { created: { id, title, keyword, headings, name }, item: UploadKeyword }
 *  400 { error }: ID ไม่ถูกต้อง / เปิดโฟลเดอร์ไม่ได้ / ไม่พบเอกสาร / เอกสารว่าง / ไม่พบหัวข้อใน outline / keywordPlan เกินเพดาน
 *  401 / 403 (CLIENT) / 404 ไม่พบลูกค้า
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const folderId = body?.folderId
  if (!isValidDriveId(folderId)) return NextResponse.json({ error: 'ID โฟลเดอร์ไม่ถูกต้อง' }, { status: 400 })
  const resourceKey = typeof body?.resourceKey === 'string' && /^[A-Za-z0-9_-]+$/.test(body.resourceKey) ? body.resourceKey : undefined
  const folderName = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''

  let listing: Awaited<ReturnType<typeof listDriveFolder>>
  try {
    listing = await listDriveFolder(folderId, resourceKey)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
  const { doc } = splitArticleFolder(listing.entries)
  if (!doc) return NextResponse.json({ error: 'ไม่พบไฟล์ Google Doc หรือ .docx ในโฟลเดอร์' }, { status: 400 })

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
  let row
  try {
    row = buildOutlineKeyword(result.html, {
      source: 'gdrive',
      sourceName: driveFolderUrl({ id: folderId, resourceKey }),
      importerTitle: result.title.trim() || extractTitleFromHtml(result.html, docBaseName) || folderName || listing.title || docBaseName,
    })
  } catch (e) {
    return NextResponse.json({ error: `${doc.name}: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 })
  }

  const out = await appendOutlineKeywords(client.id, orgId, [row])
  if (!out) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: 400 })
  const item = out.rows[0]
  return NextResponse.json(
    { created: { id: item.id, title: item.title, keyword: item.keyword, headings: item.outline?.items.length ?? 0, name: doc.name }, item },
    { status: 201 },
  )
}

export const dynamic = 'force-dynamic'
