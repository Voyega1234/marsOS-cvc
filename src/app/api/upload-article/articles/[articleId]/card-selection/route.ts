import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'
import type { UploadCardSelection, UploadPushPrefs } from '@/lib/upload-article/types'

const MAX_CARD_SEL_ENTRIES = 400
const MAX_OFF_IDS = 200
const MAX_OFF_ID_LEN = 100

/** เก็บ pushPrefs.cardSel[articleId] ล่าสุด แล้วตัดรายการเก่าสุดทิ้งถ้าเกินเพดาน (เรียงตามลำดับที่ถูกแทรก) */
function withCardSel(current: UploadPushPrefs, articleId: string, entry: UploadCardSelection): UploadPushPrefs {
  const next: Record<string, UploadCardSelection> = { ...(current.cardSel ?? {}) }
  delete next[articleId] // ลบก่อนใส่ใหม่ เพื่อให้ articleId นี้ไปอยู่ลำดับล่าสุด (ไม่ถูกตัดทิ้งก่อนใคร)
  next[articleId] = entry
  const keys = Object.keys(next)
  if (keys.length > MAX_CARD_SEL_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_CARD_SEL_ENTRIES)) delete next[k]
  }
  return { ...current, cardSel: next }
}

/** PATCH /api/upload-article/articles/[articleId]/card-selection — บันทึก card ที่ทีมติ๊กออกในหน้า Push ต่อบทความ */
export async function PATCH(req: NextRequest, { params }: { params: { articleId: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const article = await prisma.uploadArticle.findFirst({ where: { id: params.articleId, organizationId: orgId } })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  if (typeof body.version !== 'string' || !body.version || body.version.length > 100) {
    return NextResponse.json({ error: 'version ไม่ถูกต้อง' }, { status: 400 })
  }
  if (!Array.isArray(body.off)) {
    return NextResponse.json({ error: 'off ต้องเป็น array' }, { status: 400 })
  }
  const off = body.off as unknown[]
  if (off.length > MAX_OFF_IDS) {
    return NextResponse.json({ error: `off มากเกินไป (สูงสุด ${MAX_OFF_IDS} รายการ)` }, { status: 400 })
  }
  if (!off.every((x) => typeof x === 'string' && x.length <= MAX_OFF_ID_LEN)) {
    return NextResponse.json({ error: `off แต่ละรายการต้องเป็นข้อความไม่เกิน ${MAX_OFF_ID_LEN} ตัวอักษร` }, { status: 400 })
  }

  const entry: UploadCardSelection = { version: body.version, off: off as string[] }
  const result = await updatePrefs(article.clientId, orgId, (current) => {
    const next = withCardSel(current as UploadPushPrefs, article.id, entry)
    return { prefs: next as PrefsObject, result: undefined }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
