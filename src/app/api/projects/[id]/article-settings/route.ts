/**
 * SEO SME > Article Lab — ตั้งค่า รูปภาพ / CTA / Author Box (หน้าตาเดียวกับ Upload Article)
 * GET → { images, cta, author } | PUT body { section: 'images' | 'cta' | 'author', value }
 *
 * ที่เก็บ (ใช้คอลัมน์เดิมทั้งหมด ไม่แก้สคีมา — ตัวเขียนบทความ /api/article/write อ่านจากที่เดิม):
 *   images → Project.themeColors.imageSettings
 *   cta    → Project.ctaSetting (โครง UploadCtaSettings — normalizeCtaItems อ่านได้ตรง ๆ)
 *   author → Project.authors + authorEnabled, สไตล์การ์ด themeColors.authorCard, โหมดเลือก themeColors.authorPick
 *            (คง id เดิมไว้เพราะ Article.assignedAuthorId อ้างถึง + คงเพศไว้ใช้กับ AUTHOR PERSONA)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeCtaItems } from '@/lib/articleComponents'
import { readUploadCta, type UploadCtaSettings } from '@/lib/upload-article/cta'
import { readUploadAuthor, UPLOAD_AUTHOR_MAX, type UploadAuthorSettings } from '@/lib/upload-article/author'
import { readArticleAuthorPick, readArticleImageSettings } from '@/lib/article-settings'

export const dynamic = 'force-dynamic'

/** กันแถวบวม — รูป CTA/ผู้เขียนถูกย่อจากหน้า UI แล้ว แต่ต้องกันฝั่ง server ด้วย */
const MAX_JSON = 3_500_000
const AUTHOR_ID_RE = /^[\w-]{1,64}$/
const GENDERS = new Set(['male', 'female', 'none'])

type SmeAuthor = { id: string; name: string; title: string; image: string; credentials: string[]; gender: string }

type ProjectRow = {
  themeColors: string | null
  ctaSetting: string | null
  authorEnabled: boolean | null
  authors: string | null
  authorName: string | null
  authorTitle: string | null
  authorImage: string | null
}

async function auth(id: string) {
  const session = await getSession()
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role === 'CLIENT') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const project = (await (prisma.project as any).findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { themeColors: true, ctaSetting: true, authorEnabled: true, authors: true, authorName: true, authorTitle: true, authorImage: true },
  })) as ProjectRow | null
  if (!project) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { project }
}

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseAuthors(raw: string | null | undefined): Record<string, unknown>[] {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((a) => a && typeof a === 'object') : []
  } catch {
    return []
  }
}

/** ตรวจผู้เขียนทีละคนด้วยเกณฑ์ของ Upload Article แต่คง id เดิม (ถ้าใช้ได้) + เพศ */
function sanitizeAuthors(list: unknown[]): SmeAuthor[] {
  const used = new Set<string>()
  const out: SmeAuthor[] = []
  for (const raw of list) {
    if (out.length >= UPLOAD_AUTHOR_MAX) break
    const clean = readUploadAuthor({ authors: [raw] }).authors[0]
    if (!clean) continue
    const r = raw as Record<string, unknown>
    let id = typeof r.id === 'string' && AUTHOR_ID_RE.test(r.id) ? r.id : clean.id
    if (used.has(id)) id = `${id}-${out.length + 1}`
    used.add(id)
    const gender = typeof r.gender === 'string' && GENDERS.has(r.gender) ? r.gender : 'none'
    out.push({ id, name: clean.name, title: clean.title, image: clean.image ?? '', credentials: clean.credentials, gender })
  }
  return out
}

function readCta(project: ProjectRow): UploadCtaSettings {
  let parsed: unknown = null
  try { parsed = project.ctaSetting ? JSON.parse(project.ctaSetting) : null } catch { parsed = null }
  // normalizeCtaItems = ตัวเดียวกับฝั่งเขียนบทความ — ของเก่า (CTA ชุดเดียว) ได้ perArticle ตามพฤติกรรมเดิม (3 จุด / แบนเนอร์ 2 จุด)
  const n = normalizeCtaItems(parsed)
  if (n.items.length === 0) return readUploadCta({ enabled: n.enabled, perArticle: 3, items: [] })
  return readUploadCta({ enabled: n.enabled, perArticle: n.perArticle, items: n.items })
}

function readAuthor(project: ProjectRow): UploadAuthorSettings & { authors: SmeAuthor[] } {
  const colors = parseObject(project.themeColors)
  let authors = sanitizeAuthors(parseAuthors(project.authors))
  // โปรเจกต์ legacy ที่ตั้ง author เดี่ยวไว้ก่อนมีระบบหลายคน — seed เข้า list (เหมือนหน้า Lab เดิม)
  if (authors.length === 0 && (project.authorName || project.authorTitle)) {
    authors = sanitizeAuthors([{ id: 'author-legacy', name: project.authorName ?? '', title: project.authorTitle ?? '', image: project.authorImage ?? '', gender: 'none' }])
  }
  const base = readUploadAuthor({ enabled: project.authorEnabled === true, style: colors.authorCard, pick: readArticleAuthorPick(colors.authorPick) })
  return { ...base, authors }
}

function payload(project: ProjectRow) {
  return {
    images: readArticleImageSettings(parseObject(project.themeColors).imageSettings),
    cta: readCta(project),
    author: readAuthor(project),
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(params.id)
  if ('error' in a) return a.error
  return NextResponse.json(payload(a.project))
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(params.id)
  if ('error' in a) return a.error
  const body = (await req.json().catch(() => null)) as { section?: unknown; value?: unknown } | null
  const section = body?.section
  const value = body?.value
  if (!value || typeof value !== 'object') return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })

  const data: Record<string, unknown> = {}
  /** key ใน themeColors ที่ section นี้เป็นเจ้าของ — key อื่น (สี/ฟอนต์ของหน้า Lab) ห้ามแตะ */
  const themePatch: Record<string, unknown> = {}
  if (section === 'images') {
    themePatch.imageSettings = readArticleImageSettings(value)
  } else if (section === 'cta') {
    const json = JSON.stringify(readUploadCta(value))
    if (json.length > MAX_JSON) return NextResponse.json({ error: 'CTA ใหญ่เกินไป — ลดขนาด/จำนวนรูปแบนเนอร์' }, { status: 413 })
    data.ctaSetting = json
  } else if (section === 'author') {
    const v = value as Record<string, unknown>
    const clean = readUploadAuthor(v)
    const json = JSON.stringify(sanitizeAuthors(Array.isArray(v.authors) ? v.authors : []))
    if (json.length > MAX_JSON) return NextResponse.json({ error: 'รูปผู้เขียนใหญ่เกินไป' }, { status: 413 })
    data.authors = json
    data.authorEnabled = clean.enabled
    themePatch.authorCard = clean.style
    themePatch.authorPick = clean.pick
  } else {
    return NextResponse.json({ error: 'section ต้องเป็น images, cta หรือ author' }, { status: 400 })
  }

  if (Object.keys(themePatch).length > 0) {
    // อ่าน themeColors ล่าสุดก่อนเขียน — ลดโอกาสทับสีที่เพิ่งบันทึกจากปุ่ม "บันทึกทั้งหมด"
    const fresh = (await (prisma.project as any).findUnique({ where: { id: params.id }, select: { themeColors: true } })) as { themeColors: string | null } | null
    data.themeColors = JSON.stringify({ ...parseObject(fresh?.themeColors), ...themePatch })
  }

  const updated = (await (prisma.project as any).update({
    where: { id: params.id },
    data,
    select: { themeColors: true, ctaSetting: true, authorEnabled: true, authors: true, authorName: true, authorTitle: true, authorImage: true },
  })) as ProjectRow

  const out = payload(updated)
  return NextResponse.json(section === 'images' ? out.images : section === 'cta' ? out.cta : out.author)
}
