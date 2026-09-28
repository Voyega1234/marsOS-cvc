import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  driveImageToDataUrl,
  driveThumbUrl,
  isValidDriveId,
  listDriveFolder,
  parseDriveFolderLink,
  splitArticleFolder,
} from '@/lib/upload-article/drive-folder'

export const maxDuration = 60

type Loaded =
  | { ok: true; images: ReturnType<typeof splitArticleFolder>['images'] }
  | { ok: false; res: NextResponse }

/** โหลดบทความ (ตรวจสิทธิ์ + org) แล้วอ่านรายการรูปในโฟลเดอร์ Drive ต้นทาง */
async function loadDriveImages(articleId: string): Promise<Loaded> {
  const session = await getSession()
  if (!session?.user?.organizationId) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const article = await prisma.uploadArticle.findFirst({
    where: { id: articleId, organizationId: session.user.organizationId },
    select: { sourceType: true, sourceName: true },
  })
  if (!article) return { ok: false, res: NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 }) }
  if (article.sourceType !== 'gdrive') {
    return { ok: false, res: NextResponse.json({ error: 'บทความนี้ไม่ได้นำเข้าจากโฟลเดอร์ Google Drive' }, { status: 400 }) }
  }

  try {
    const ref = parseDriveFolderLink(article.sourceName)
    const listing = await listDriveFolder(ref.id, ref.resourceKey)
    return { ok: true, images: splitArticleFolder(listing.entries).images }
  } catch (e) {
    return { ok: false, res: NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }) }
  }
}

/** GET /api/upload-article/articles/[articleId]/drive-images — รายการรูปในโฟลเดอร์ Drive ของบทความ */
export async function GET(_req: NextRequest, { params }: { params: { articleId: string } }) {
  const loaded = await loadDriveImages(params.articleId)
  if (!loaded.ok) return loaded.res
  return NextResponse.json({
    images: loaded.images.map((img) => ({ id: img.id, name: img.name, thumbUrl: driveThumbUrl(img.id) })),
  })
}

/** POST /api/upload-article/articles/[articleId]/drive-images { fileId } — ดาวน์โหลด + ย่อรูป คืน data URI */
export async function POST(req: NextRequest, { params }: { params: { articleId: string } }) {
  const body = await req.json().catch(() => null)
  const fileId = body?.fileId
  if (!isValidDriveId(fileId)) return NextResponse.json({ error: 'ID รูปไม่ถูกต้อง' }, { status: 400 })

  const loaded = await loadDriveImages(params.articleId)
  if (!loaded.ok) return loaded.res

  // ต้องเป็นรูปที่อยู่ในโฟลเดอร์ของบทความนี้เท่านั้น
  const img = loaded.images.find((i) => i.id === fileId)
  if (!img) return NextResponse.json({ error: 'ไม่พบรูปนี้ในโฟลเดอร์ Drive ของบทความ' }, { status: 404 })

  try {
    const dataUrl = await driveImageToDataUrl(img.id, img.resourceKey)
    return NextResponse.json({ dataUrl, name: img.name })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
