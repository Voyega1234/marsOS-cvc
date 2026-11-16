import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, requireStaff } from '@/lib/compliance/server'
import { brandError, loadBrandDetail } from '@/lib/compliance/brand-server'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; fileId: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const brand = await prisma.complianceBrand.findFirst({ where: { id: params.id, organizationId: ctx.orgId }, select: { id: true } })
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    const f = await prisma.complianceBrandFile.findFirst({ where: { id: params.fileId, organizationId: ctx.orgId, brandId: brand.id } })
    if (!f) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 404 })
    return NextResponse.json({ file: { id: f.id, fileName: f.fileName, chars: f.chars, text: f.text, createdAt: f.createdAt.toISOString() } })
  } catch (e) {
    return brandError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const brand = await prisma.complianceBrand.findFirst({ where: { id: params.id, organizationId: ctx.orgId }, select: { id: true, name: true } })
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    const f = await prisma.complianceBrandFile.findFirst({
      where: { id: params.fileId, organizationId: ctx.orgId, brandId: brand.id },
      select: { id: true, fileName: true },
    })
    if (!f) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 404 })
    await prisma.complianceBrandFile.delete({ where: { id: f.id } })
    await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_FILE_REMOVE', detail: { brandId: brand.id, brandName: brand.name, fileId: f.id, fileName: f.fileName } })
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id) })
  } catch (e) {
    return brandError(e)
  }
}
