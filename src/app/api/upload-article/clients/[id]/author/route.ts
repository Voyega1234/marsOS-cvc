import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { readUploadAuthor } from '@/lib/upload-article/author'

/** GET /api/upload-article/clients/[id]/author — ค่า Author Box เต็ม (รวมรูปโปรไฟล์) สำหรับหน้า Project Setting */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json(readUploadAuthor(prefs.author))
}

/** PUT /api/upload-article/clients/[id]/author — บันทึกค่า Author Box ทั้งก้อน (ผ่าน readUploadAuthor ตัดค่าแปลกปลอมทิ้ง) */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'ข้อมูล Author Box ไม่ถูกต้อง' }, { status: 400 })
  const author = readUploadAuthor(body)

  const result = await updatePrefs(params.id, session.user.organizationId, (current) => ({
    prefs: { ...current, author },
    result: author,
  }))

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
