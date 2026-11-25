import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { articleCommentCounts } from '@/lib/upload-article/article-comments'

/** GET /api/upload-article/clients/[id]/article-comments — จำนวน Comment ของลูกค้าต่อบทความ (ทั้งหมด / ที่ยังไม่ได้ปรับ) */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ counts: articleCommentCounts(prefs) })
}

export const dynamic = 'force-dynamic'
