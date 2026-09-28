import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getOrCreatePbnClientId } from '@/lib/upload-article/pbn-store'

export const dynamic = 'force-dynamic'

/** GET /api/pbn-backlinks — id ของโปรเจกต์ PBN ขององค์กร (ยังไม่มีก็สร้างให้) */
export async function GET() {
  const session = await getSession()
  if (!session?.user?.organizationId || !session.user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const clientId = await getOrCreatePbnClientId(session.user.organizationId, session.user.id)
  return NextResponse.json({ clientId })
}
