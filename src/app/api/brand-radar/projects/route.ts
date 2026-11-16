import { NextResponse } from 'next/server'
import { isCtx, requireStaff } from '@/lib/brand-radar/server'
import { buildProjectOptions } from '@/lib/brand-radar/queries'
import type { ProjectsRes } from '@/lib/brand-radar/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await requireStaff()
  if (!isCtx(staff)) return staff
  const projects = await buildProjectOptions(staff.orgId)
  return NextResponse.json({ projects } satisfies ProjectsRes)
}
