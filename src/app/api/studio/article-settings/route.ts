/**
 * Content Studio — ตั้งค่า รูปภาพ / CTA / Author Box (หน้าตาเดียวกับ Upload Article)
 * ระดับ studio (ไม่ผูก client) เหมือน studio_article_theme — เก็บใน AppSetting key STUDIO_ARTICLE_SETTINGS_KEY
 * GET → { images, cta, author } | PUT body { section: 'images' | 'cta' | 'author', value } (ห้าม CLIENT)
 * ตัวเขียนบทความ /api/article/write (โหมด Studio = ไม่มี projectId) อ่านค่าจาก key เดียวกัน
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readArticleImageSettings, readStudioArticleSettings, STUDIO_ARTICLE_SETTINGS_KEY } from '@/lib/article-settings'
import { readUploadCta } from '@/lib/upload-article/cta'
import { readUploadAuthor } from '@/lib/upload-article/author'

// หน้า/route นี้ query DB ตอน request เท่านั้น — ห้าม prerender ตอน build (build ไม่ควรแตะ DB)
export const dynamic = 'force-dynamic'

/** กันแถวบวม — รูป CTA/ผู้เขียนถูกย่อจากหน้า UI แล้ว แต่ต้องกันฝั่ง server ด้วย */
const MAX_JSON = 3_500_000

async function readSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: STUDIO_ARTICLE_SETTINGS_KEY } })
  let parsed: unknown = null
  try { parsed = row ? JSON.parse(row.value) : null } catch { parsed = null }
  return readStudioArticleSettings(parsed)
}

export async function GET() {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await readSettings())
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { section?: unknown; value?: unknown } | null
  const section = body?.section
  const value = body?.value
  if (!value || typeof value !== 'object') return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })

  const current = await readSettings()
  if (section === 'images') current.images = readArticleImageSettings(value)
  else if (section === 'cta') current.cta = readUploadCta(value)
  else if (section === 'author') current.author = readUploadAuthor(value)
  else return NextResponse.json({ error: 'section ต้องเป็น images, cta หรือ author' }, { status: 400 })

  const json = JSON.stringify(current)
  if (json.length > MAX_JSON) return NextResponse.json({ error: 'ข้อมูลใหญ่เกินไป — ลดขนาด/จำนวนรูป' }, { status: 413 })
  await prisma.appSetting.upsert({
    where: { key: STUDIO_ARTICLE_SETTINGS_KEY },
    update: { value: json },
    create: { key: STUDIO_ARTICLE_SETTINGS_KEY, value: json },
  })
  return NextResponse.json(section === 'images' ? current.images : section === 'cta' ? current.cta : current.author)
}
