import { NextResponse } from 'next/server'
import { requireReader } from '@/lib/brand-radar/server'
import { BRAND_WINDOW_DAYS, buildBrandSummaries } from '@/lib/brand-radar/queries'
import { normalizeSchedule, type BrandsRes } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

/** Landing list of Brand Radar: every brand of the organization that already has a monitor, last 30 days. */
export async function GET() {
  const ctx = await requireReader()
  if (ctx instanceof NextResponse) return ctx
  const rows = await buildBrandSummaries(ctx.orgId, new Date(), ctx.allowedIds)
  // A customer login never sees the scan schedule or the setup state.
  const brands = ctx.clientView
    ? rows.map((b) => ({
        ...b,
        schedule: b.schedule ? normalizeSchedule('manual', 'manual') : null,
        nextRunAt: null,
        status: b.status === 'needs_setup' ? ('no_data' as const) : b.status,
      }))
    : rows
  return NextResponse.json({ windowDays: BRAND_WINDOW_DAYS, brands } satisfies BrandsRes)
}
