import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// สลับโหมดของตัวเองได้แค่ 2 แบบตามหน้า Settings > Interface Mode (Admin / User)
// role อื่นให้ Admin ตั้งที่หน้า Users (/api/users/[id]) เท่านั้น
const SELF_ROLES = ['ADMIN', 'WRITER'] as const

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id || !session?.user?.organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const role = typeof body.role === 'string' ? body.role : ''
  if (!(SELF_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // อ่าน role ปัจจุบันจาก DB เสมอ (ไม่เชื่อค่าจาก client)
  const me = await prisma.user.findFirst({
    where: { id: session.user.id, organizationId: session.user.organizationId },
    select: { role: true },
  })
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (me.role === role) return NextResponse.json({ ok: true, role })

  // กันยกสิทธิ์ตัวเองเป็น ADMIN — ทำได้เฉพาะกรณีกลับจากโหมด User ที่ตัวเองเคยสลับลงมาจาก ADMIN
  // หลักฐานคือ ROLE_CHANGED ล่าสุดของตัวเอง (เขียนโดยเซิร์ฟเวอร์เท่านั้น) ต้องเป็น ADMIN → role ปัจจุบัน
  if (role === 'ADMIN') {
    const last = await prisma.activityLog.findFirst({
      where: {
        organizationId: session.user.organizationId,
        entityType: 'User',
        entityId: session.user.id,
        action: 'ROLE_CHANGED',
      },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, oldValue: true, newValue: true },
    })
    // log ล่าสุดของ user นี้ (ใครเปลี่ยนก็ได้) ต้องเป็นเจ้าตัวสลับเอง — ถ้า Admin ลดสิทธิ์ทีหลัง จะสลับกลับเองไม่ได้
    if (!last || last.userId !== session.user.id || last.oldValue !== 'ADMIN' || last.newValue !== me.role) {
      return NextResponse.json({ error: 'Forbidden — ต้องให้ Admin เป็นผู้กำหนดสิทธิ์ Admin' }, { status: 403 })
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { role },
  })

  // Log the role change (ใช้เป็นหลักฐานตอนสลับกลับเป็น ADMIN — ถ้าจดไม่ได้ก็สลับกลับเองไม่ได้ ให้ Admin คนอื่นตั้งให้)
  try {
    await prisma.activityLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: 'ROLE_CHANGED',
        entityType: 'User',
        entityId: session.user.id,
        oldValue: me.role,
        newValue: role,
      },
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, role })
}
