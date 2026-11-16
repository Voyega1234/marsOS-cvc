import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, requireStaff } from '@/lib/compliance/server'
import { brandError, loadBrandDetail } from '@/lib/compliance/brand-server'
import { BRAND_FILES_MAX, sanitizeFileInput } from '@/lib/compliance/brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const brand = await prisma.complianceBrand.findFirst({ where: { id: params.id, organizationId: ctx.orgId }, select: { id: true, name: true } })
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    const raw = await req.json().catch(() => ({}))
    const parsed = sanitizeFileInput(raw && typeof raw === 'object' ? raw : {})
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const count = await prisma.complianceBrandFile.count({ where: { organizationId: ctx.orgId, brandId: brand.id } })
    if (count >= BRAND_FILES_MAX) {
      return NextResponse.json({ error: `แบรนด์นี้มีไฟล์ครบ ${BRAND_FILES_MAX} ไฟล์แล้ว — ลบไฟล์เก่าก่อน` }, { status: 400 })
    }
    const row = await prisma.complianceBrandFile.create({
      data: {
        organizationId: ctx.orgId,
        brandId: brand.id,
        fileName: parsed.fileName,
        text: parsed.text,
        chars: parsed.text.length,
        createdById: ctx.userId,
      },
      select: { id: true, fileName: true, chars: true },
    })
    await prisma.complianceBrand.update({ where: { id: brand.id }, data: { updatedById: ctx.userId } })
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_FILE_ADD',
      detail: { brandId: brand.id, brandName: brand.name, fileId: row.id, fileName: row.fileName, chars: row.chars, truncated: parsed.truncated },
    })
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, brand.id), truncated: parsed.truncated }, { status: 201 })
  } catch (e) {
    return brandError(e)
  }
}
