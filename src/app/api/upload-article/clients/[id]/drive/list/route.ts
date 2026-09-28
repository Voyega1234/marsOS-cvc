import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  driveFolderUrl,
  listDriveFolder,
  mapWithConcurrency,
  parseDriveFolderLink,
  splitArticleFolder,
  type DriveEntry,
} from '@/lib/upload-article/drive-folder'

export const maxDuration = 300

const MAX_ARTICLE_FOLDERS = 50

interface DriveArticleItem {
  folderId: string
  resourceKey?: string
  name: string
  docName: string
  imageCount: number
  /** เคยนำเข้าโฟลเดอร์นี้ให้ลูกค้านี้แล้ว (กันนำเข้าซ้ำ) */
  alreadyImported: boolean
}

interface DriveSkippedItem {
  folderId: string
  name: string
  reason: string
}

/**
 * POST /api/upload-article/clients/[id]/drive/list  { url }
 * ตรวจโฟลเดอร์ Drive: ถ้าโฟลเดอร์ที่ให้มามีเอกสารอยู่เลย = บทความเดียว
 * ไม่งั้นโฟลเดอร์ย่อยแต่ละอัน = 1 บทความ (สูงสุด 50) — โฟลเดอร์ย่อยที่ไม่มีเอกสารจะถูกข้ามพร้อมเหตุผล
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'กรุณาวางลิงก์โฟลเดอร์ Google Drive' }, { status: 400 })

  let ref: ReturnType<typeof parseDriveFolderLink>
  try {
    ref = parseDriveFolderLink(url)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }

  let root: Awaited<ReturnType<typeof listDriveFolder>>
  try {
    root = await listDriveFolder(ref.id, ref.resourceKey)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }

  const articles: DriveArticleItem[] = []
  const skipped: DriveSkippedItem[] = []
  let truncated = false

  const rootParts = splitArticleFolder(root.entries)

  // มีโฟลเดอร์ย่อย → เช็คก่อนว่าโฟลเดอร์ย่อยมีเอกสารบ้างไหม (แต่ละโฟลเดอร์ย่อย = 1 บทความ)
  // ถึงแม้ parent เองจะมีเอกสารอยู่ด้วย (เช่นไฟล์บรีฟ) ก็ให้ยึดโฟลเดอร์ย่อยเป็นหลัก ไม่ถือว่า parent คือบทความเดียว
  if (rootParts.subFolders.length > 0) {
    let folders: DriveEntry[] = rootParts.subFolders
    if (folders.length > MAX_ARTICLE_FOLDERS) {
      truncated = true
      folders = folders.slice(0, MAX_ARTICLE_FOLDERS)
    }
    const results = await mapWithConcurrency(folders, 5, async (f) => {
      try {
        const listing = await listDriveFolder(f.id, f.resourceKey)
        return { f, parts: splitArticleFolder(listing.entries), error: null as string | null }
      } catch (e) {
        return { f, parts: null, error: e instanceof Error ? e.message : String(e) }
      }
    })
    for (const { f, parts, error } of results) {
      if (error || !parts) {
        skipped.push({ folderId: f.id, name: f.name, reason: error || 'อ่านโฟลเดอร์ไม่สำเร็จ' })
      } else if (!parts.doc) {
        skipped.push({ folderId: f.id, name: f.name, reason: 'ไม่พบไฟล์ Google Doc หรือ .docx ในโฟลเดอร์' })
      } else {
        articles.push({
          folderId: f.id,
          ...(f.resourceKey ? { resourceKey: f.resourceKey } : {}),
          name: f.name,
          docName: parts.doc.name,
          imageCount: parts.images.length,
          alreadyImported: false,
        })
      }
    }
  }

  // ไม่มีโฟลเดอร์ย่อยที่มีเอกสารเลย (ไม่มีโฟลเดอร์ย่อย หรือมีแต่ไม่มีเอกสารสักอัน) แต่ parent เองมีเอกสาร → ถือเป็นบทความเดียว
  if (articles.length === 0 && rootParts.doc) {
    articles.push({
      folderId: ref.id,
      ...(ref.resourceKey ? { resourceKey: ref.resourceKey } : {}),
      name: root.title || rootParts.doc.name,
      docName: rootParts.doc.name,
      imageCount: rootParts.images.length,
      alreadyImported: false,
    })
  }

  if (articles.length === 0) {
    return NextResponse.json(
      { error: 'ไม่พบบทความในโฟลเดอร์นี้ — ต้องมีโฟลเดอร์ย่อยที่มี Google Doc หรือ .docx (หรือเอกสารอยู่ในโฟลเดอร์นี้เลย)' },
      { status: 400 },
    )
  }

  // ทำเครื่องหมายโฟลเดอร์ที่เคยนำเข้าให้ลูกค้านี้แล้ว (sourceName = ลิงก์โฟลเดอร์)
  if (articles.length) {
    const existing = await prisma.uploadArticle.findMany({
      where: {
        organizationId: orgId,
        clientId: client.id,
        sourceType: 'gdrive',
        sourceName: { in: articles.map((a) => driveFolderUrl({ id: a.folderId, resourceKey: a.resourceKey })) },
      },
      select: { sourceName: true },
    })
    const done = new Set(existing.map((r) => r.sourceName))
    for (const a of articles) a.alreadyImported = done.has(driveFolderUrl({ id: a.folderId, resourceKey: a.resourceKey }))
  }

  return NextResponse.json({ folderName: root.title || undefined, articles, skipped, truncated })
}
