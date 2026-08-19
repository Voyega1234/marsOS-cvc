/**
 * ธีมบทความของ Content Studio (ระดับ studio — ไม่ผูก client)
 * เก็บใน AppSetting key 'studio_article_theme' โครงเดียวกับ Project.themeColors
 * GET → อ่าน | PUT → บันทึก (ADMIN)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// หน้า/route นี้ query DB ตอน request เท่านั้น — ห้าม prerender ตอน build (build ไม่ควรแตะ DB)
export const dynamic = 'force-dynamic'

const KEY = 'studio_article_theme'

export async function GET() {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
  try {
    return NextResponse.json(row ? JSON.parse(row.value) : {})
  } catch {
    return NextResponse.json({})
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid theme' }, { status: 400 })
  const value = JSON.stringify(body)
  if (value.length > 20000) return NextResponse.json({ error: 'theme too large' }, { status: 400 })
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } })
  return NextResponse.json({ ok: true })
}
