import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs } from '@/lib/upload-article/prefs-store'
import { loadArticleLinkRows } from '@/lib/upload-article/article-links'

/** GET /api/upload-article/clients/[id]/internal-links/articles — รายการบทความในระบบของลูกค้านี้ ใช้เป็นลิงก์ภายในอัตโนมัติ (PBN คืน []) */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const articles = await loadArticleLinkRows(params.id, session.user.organizationId, prefs)
  return NextResponse.json({ articles })
}

export const dynamic = 'force-dynamic'
