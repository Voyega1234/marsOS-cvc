import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { MAX_TRANSLATE_SOURCES } from '@/lib/upload-article/translate-sources'
import { markTranslateSources } from '@/lib/upload-article/translate-sources-store'

/**
 * POST /api/upload-article/clients/[id]/translate-sources body {ids: string[]}
 * Marks articles imported in the Translate tab as translation sources, so Review and Push do not
 * list them (only their translations go on). Stored in pushPrefs.translateSources, no schema change.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).ids : undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRANSLATE_SOURCES) {
    return NextResponse.json({ error: 'รายการบทความไม่ถูกต้อง' }, { status: 400 })
  }
  const ids = raw.filter((v): v is string => typeof v === 'string')
  const translateSources = await markTranslateSources(params.id, session.user.organizationId, ids)
  if (!translateSources) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json({ translateSources })
}
