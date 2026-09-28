import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { readUploadCta } from '@/lib/upload-article/cta'

/** GET /api/upload-article/clients/[id]/cta — ค่า CTA เต็ม (รวมรูปแบนเนอร์/โลโก้) สำหรับหน้า Project Setting */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json(readUploadCta(prefs.cta))
}

/** PUT /api/upload-article/clients/[id]/cta — บันทึกค่า CTA ทั้งก้อน (ผ่าน readUploadCta ตัดค่าแปลกปลอมทิ้ง) */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'ข้อมูล CTA ไม่ถูกต้อง' }, { status: 400 })
  const cta = readUploadCta(body)

  const result = await updatePrefs(params.id, session.user.organizationId, (current) => ({
    prefs: { ...current, cta },
    result: cta,
  }))

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
