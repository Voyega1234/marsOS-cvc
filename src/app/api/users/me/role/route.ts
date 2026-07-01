import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED_ROLES = ['ADMIN', 'SEO_MANAGER', 'SEO_PLANNER', 'WRITER', 'REVIEWER', 'PUBLISHER']

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id || !session?.user?.organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { role } = await req.json()
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { role },
  })

  // Log the role change
  try {
    await prisma.activityLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: 'ROLE_CHANGED',
        entityType: 'User',
        entityId: session.user.id,
        oldValue: session.user.role ?? '',
        newValue: role,
      },
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, role })
}
