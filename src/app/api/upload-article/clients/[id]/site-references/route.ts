import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { referenceDomain } from '@/lib/upload-article/references'
import { collectSiteReferences } from '@/lib/upload-article/site-references'

export const maxDuration = 300

const BLOCKED_MAX = 100

/**
 * POST /api/upload-article/clients/[id]/site-references — ดึงแหล่งอ้างอิงจากบทความที่เผยแพร่แล้วทั้งเว็บ (WordPress REST)
 * Body: { blocked?: string[] } — โดเมนที่ทีมไม่ให้ใช้ (เช่นคู่แข่ง) ไม่ถูกส่งกลับ
 * ไม่บันทึกเอง ไม่เรียก AI — หน้า Generate รวมเข้าคลัง แล้วทีมกดบันทึกธีม
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { wpUrl: true, website: true },
  })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const site = (client.wpUrl || client.website || '').trim()
  if (!site) return NextResponse.json({ error: 'ยังไม่มี URL เว็บไซต์ — กรอก URL ในแท็บเชื่อมต่อก่อน' }, { status: 400 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const raw: unknown[] = Array.isArray(body.blocked) ? body.blocked : []
  const domains = raw.map((d) => (typeof d === 'string' ? referenceDomain(d) : null)).filter((d): d is string => Boolean(d))
  const blocked = Array.from(new Set(domains)).slice(0, BLOCKED_MAX)

  try {
    const result = await collectSiteReferences({ site, blocked })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'ดึงแหล่งอ้างอิงไม่สำเร็จ'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
