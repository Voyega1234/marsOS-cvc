import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parsePushPrefs } from '@/lib/project-index-requests'
import { updateProjectPrefs, type ProjectPrefs } from '@/lib/project-prefs-store'
import { mergeOwnerTagInput, readArticleOwners, readOwnerTags } from '@/lib/upload-article/owner-tags'

/** id สั้น 8 ตัว (ซ้ำกับที่มีอยู่แล้ว mergeOwnerTagInput จะสุ่มใหม่ให้เอง) */
function newTagId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/** GET /api/projects/[id]/owner-tags — รายชื่อผู้ดูแล + ผู้ดูแลต่อบทความ (ให้แท็บ Push / Report ใช้ร่วมกัน) */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { pushPrefs: true },
  })
  if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 })

  const prefs = parsePushPrefs(project.pushPrefs)
  const ownerTags = readOwnerTags(prefs.ownerTags)
  return NextResponse.json({ ownerTags, articleOwners: readArticleOwners(prefs.articleOwners, ownerTags) })
}

/**
 * PUT /api/projects/[id]/owner-tags body {tags:[{id?, name}]}
 * บันทึกรายชื่อผู้ดูแลบทความของโปรเจกต์ SEO SME (ทั้งก้อน) — เก็บใน Project.pushPrefs.ownerTags (ไม่แก้ schema)
 * tag ที่ถูกลบออกจะถูกตัดออกจาก pushPrefs.articleOwners ด้วย — ตรรกะเดียวกับ Upload Article
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).tags)) {
    return NextResponse.json({ error: 'ข้อมูลผู้ดูแลไม่ถูกต้อง' }, { status: 400 })
  }
  const input = (body as Record<string, unknown>).tags

  const result = await updateProjectPrefs(params.id, session.user.organizationId, (current) => {
    const existing = readOwnerTags(current.ownerTags)
    const ownerTags = mergeOwnerTagInput(input, existing, newTagId)
    // articleOwners ที่ชี้ไป tag ที่ไม่มีแล้วถูกตัดทิ้งโดย readArticleOwners
    const articleOwners = readArticleOwners(current.articleOwners, ownerTags)
    const next: ProjectPrefs = { ...current, ownerTags, articleOwners }
    return { prefs: next, result: { ownerTags, articleOwners } }
  })
  if (!result) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 })

  return NextResponse.json(result.result)
}

export const dynamic = 'force-dynamic'
