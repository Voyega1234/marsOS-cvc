import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, requireStaff } from '@/lib/compliance/server'
import { brandError, isMissingTable, listBrands, loadBrandDetail } from '@/lib/compliance/brand-server'
import { sanitizeBrandInput } from '@/lib/compliance/brand'

export const dynamic = 'force-dynamic'

const BRANDS_MAX = 500

export async function GET() {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json({ brands: await listBrands(ctx.orgId) })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ brands: [], unavailable: true })
    return brandError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const raw = await req.json().catch(() => ({}))
    const input = sanitizeBrandInput(raw && typeof raw === 'object' ? raw : {})
    if (!input.name) return NextResponse.json({ error: 'ต้องใส่ชื่อลูกค้า / แบรนด์' }, { status: 400 })
    const dup = await prisma.complianceBrand.findFirst({
      where: { organizationId: ctx.orgId, name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (dup) return NextResponse.json({ error: 'มีแบรนด์ชื่อนี้อยู่แล้ว' }, { status: 409 })
    // หน้า Brand Rule แสดงได้ 500 แบรนด์ (รวมที่เก็บถาวร) — เกินนั้นแบรนด์ใหม่จะมองไม่เห็น
    const total = await prisma.complianceBrand.count({ where: { organizationId: ctx.orgId } })
    if (total >= BRANDS_MAX) return NextResponse.json({ error: `มีแบรนด์ครบ ${BRANDS_MAX} รายการแล้ว (รวมที่เก็บถาวร) — แจ้งผู้ดูแลระบบก่อนเพิ่ม` }, { status: 400 })
    const row = await prisma.complianceBrand.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name,
        industry: input.industry ?? '',
        voice: input.voice ?? '',
        notes: input.notes ?? '',
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    })
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_CREATE', detail: { brandId: row.id, brandName: row.name, voiceChars: row.voice.length } })
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, row.id) }, { status: 201 })
  } catch (e) {
    return brandError(e)
  }
}
