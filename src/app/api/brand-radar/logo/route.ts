import { NextRequest, NextResponse } from 'next/server'
import { bad, isRadarCtx, requireProject, requireProjectReader } from '@/lib/brand-radar/server'
import { getBrandLogo, setBrandLogo } from '@/lib/brand-radar/brand-logo'
import { brandLogoPath, decodeLogoDataUrl } from '@/lib/brand-radar/logo'
import { validateClientLogoInput } from '@/lib/upload-article/client-logo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireProjectReader(req.nextUrl.searchParams.get('projectId'))
  if (!isRadarCtx(ctx)) return ctx
  const stored = await getBrandLogo(ctx.orgId, ctx.project.id)
  const decoded = stored ? decodeLogoDataUrl(stored) : null
  if (!decoded) return NextResponse.json({ error: 'No logo' }, { status: 404 })
  return new NextResponse(Buffer.from(decoded.base64, 'base64'), {
    headers: {
      'Content-Type': decoded.mime,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    },
  })
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('logo' in body)) return bad('Invalid body')
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  const v = validateClientLogoInput(body.logo)
  if (!v.ok) return bad(v.error)
  const saved = await setBrandLogo(ctx.orgId, ctx.project.id, v.value)
  if (!saved) return bad('Project not found', 404)
  return NextResponse.json({ logo: v.value ? brandLogoPath(ctx.project.id, Date.now()) : null })
}
