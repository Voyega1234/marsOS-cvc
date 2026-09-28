import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readPrefs, updatePrefs } from '@/lib/upload-article/prefs-store'
import { sanitizeInternalLinks } from '@/lib/upload-article/internal-links'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks } from '@/lib/upload-article/types'

function readLinks(prefs: Record<string, unknown> | null): UploadInternalLinks {
  const raw = prefs?.internalLinks
  return { ...DEFAULT_UPLOAD_INTERNAL_LINKS, ...(raw && typeof raw === 'object' ? (raw as Partial<UploadInternalLinks>) : {}) }
}

/** GET /api/upload-article/clients/[id]/internal-links */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const prefs = await readPrefs(params.id, session.user.organizationId)
  if (!prefs) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  return NextResponse.json(readLinks(prefs))
}

/** PUT /api/upload-article/clients/[id]/internal-links — บันทึกแบบ partial (ส่งเฉพาะ field ที่แก้) */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const input = (body && typeof body === 'object' ? body : {}) as Partial<UploadInternalLinks>
  const sanitized = sanitizeInternalLinks(input)
  if (sanitized.error) return NextResponse.json({ error: sanitized.error }, { status: 400 })

  const result = await updatePrefs(params.id, session.user.organizationId, (current) => {
    const currentLinks = readLinks(current)
    const nextLinks: UploadInternalLinks = { ...currentLinks, ...sanitized.value }
    return { prefs: { ...current, internalLinks: nextLinks }, result: nextLinks }
  })

  if (!result) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
