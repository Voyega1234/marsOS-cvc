import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errMsg, requireStaff } from '@/lib/compliance/server'
import { BUILTIN_INDUSTRIES, industryLabel } from '@/lib/compliance/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await requireStaff()
    if (ctx instanceof NextResponse) return ctx
    const rows = await prisma.complianceRule.findMany({
      where: { organizationId: ctx.orgId, status: { in: ['ACTIVE', 'DRAFT'] } },
      select: { industry: true, status: true },
    })
    const counts = new Map<string, { active: number; draft: number }>()
    for (const r of rows) {
      const c = counts.get(r.industry) ?? { active: 0, draft: 0 }
      if (r.status === 'ACTIVE') c.active++
      else c.draft++
      counts.set(r.industry, c)
    }
    const keys = [...BUILTIN_INDUSTRIES.map((i) => i.key)]
    for (const k of Array.from(counts.keys())) if (!keys.includes(k)) keys.push(k)
    const industries = keys.map((key) => ({
      key,
      label: industryLabel(key),
      builtin: BUILTIN_INDUSTRIES.some((i) => i.key === key),
      ...(counts.get(key) ?? { active: 0, draft: 0 }),
    }))
    return NextResponse.json({ industries })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}
