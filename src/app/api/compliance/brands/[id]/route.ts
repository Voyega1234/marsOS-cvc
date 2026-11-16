import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit, requireStaff } from '@/lib/compliance/server'
import { brandError, loadBrandDetail } from '@/lib/compliance/brand-server'
import { sanitizeBrandInput } from '@/lib/compliance/brand'
import { RULE_EDITOR_ROLES } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const brand = await loadBrandDetail(ctx.orgId, params.id)
    if (!brand) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    return NextResponse.json({ brand })
  } catch (e) {
    return brandError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const cur = await prisma.complianceBrand.findFirst({ where: { id: params.id, organizationId: ctx.orgId } })
    if (!cur) return NextResponse.json({ error: 'ไม่พบแบรนด์' }, { status: 404 })
    const raw = await req.json().catch(() => ({}))
    const input = sanitizeBrandInput(raw && typeof raw === 'object' ? raw : {})

    if (input.name !== undefined) {
      if (!input.name) return NextResponse.json({ error: 'ต้องใส่ชื่อลูกค้า / แบรนด์' }, { status: 400 })
      const dup = await prisma.complianceBrand.findFirst({
        where: { organizationId: ctx.orgId, id: { not: cur.id }, name: { equals: input.name, mode: 'insensitive' } },
        select: { id: true },
      })
      if (dup) return NextResponse.json({ error: 'มีแบรนด์ชื่อนี้อยู่แล้ว' }, { status: 409 })
    }

    const statusChanged = input.status !== undefined && input.status !== cur.status
    if (statusChanged && !RULE_EDITOR_ROLES.includes(ctx.role)) {
      return NextResponse.json({ error: 'เฉพาะ Admin / SEO Manager เปลี่ยนสถานะแบรนด์ได้' }, { status: 403 })
    }

    const data: Record<string, string> = {}
    const fields: string[] = []
    if (input.name !== undefined && input.name !== cur.name) { data.name = input.name; fields.push('name') }
    if (input.industry !== undefined && input.industry !== cur.industry) { data.industry = input.industry; fields.push('industry') }
    if (input.voice !== undefined && input.voice !== cur.voice) { data.voice = input.voice; fields.push('voice') }
    if (input.notes !== undefined && input.notes !== cur.notes) { data.notes = input.notes; fields.push('notes') }
    if (statusChanged && input.status) data.status = input.status

    if (!fields.length && !statusChanged) {
      return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, cur.id) })
    }

    const updated = await prisma.complianceBrand.update({ where: { id: cur.id }, data: { ...data, updatedById: ctx.userId } })
    if (statusChanged) {
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_STATUS', detail: { brandId: cur.id, brandName: updated.name, from: cur.status, to: updated.status } })
    }
    if (fields.length) {
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRAND_UPDATE', detail: { brandId: cur.id, brandName: updated.name, fields, voiceChars: updated.voice.length } })
    }
    return NextResponse.json({ brand: await loadBrandDetail(ctx.orgId, cur.id) })
  } catch (e) {
    return brandError(e)
  }
}
