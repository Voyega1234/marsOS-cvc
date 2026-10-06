import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requestIndexIfLive, isIndexableUrl } from '@/lib/upload-article/request-index'
import { saveProjectIndexRequest } from '@/lib/project-index-requests'

// ─── SEO SME > Request Index — กดส่งบทความที่ขึ้นเว็บแล้วให้ Google ทีละชิ้น ───

function hostOf(u: string | null | undefined): string {
  if (!u) return ''
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

/** GSC property: sc-domain:example.com หรือ https://example.com/ */
function gscHost(s: string | null | undefined): string {
  if (!s) return ''
  return s.startsWith('sc-domain:') ? s.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '') : hostOf(s)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true, website: true, wpUrl: true, gscSiteUrl: true, wordpressConnection: { select: { siteUrl: true } } },
  })
  if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const articleId = typeof body?.articleId === 'string' ? body.articleId : ''
  if (!articleId) return NextResponse.json({ error: 'ต้องระบุ articleId' }, { status: 400 })

  const article = await prisma.article.findFirst({
    where: { id: articleId, projectId: project.id },
    select: { id: true, wordpressUrl: true, status: true },
  })
  if (!article) return NextResponse.json({ error: 'ไม่พบบทความ' }, { status: 404 })
  if (!article.wordpressUrl || !['POSTED', 'WORDPRESS_DRAFTED'].includes(article.status)) {
    return NextResponse.json({ error: 'บทความนี้ยังไม่ได้ Push ขึ้นเว็บ' }, { status: 400 })
  }
  if (!isIndexableUrl(article.wordpressUrl)) {
    return NextResponse.json({ error: 'URL ของบทความยังไม่ใช่ลิงก์ https ที่เผยแพร่แล้ว' }, { status: 400 })
  }

  // กันยิง URL มั่ว — host ต้องตรงกับเว็บของโปรเจกต์ (website / WordPress / GSC)
  const allowedHosts = [project.website, project.wpUrl, project.wordpressConnection?.siteUrl].map(hostOf)
  allowedHosts.push(gscHost(project.gscSiteUrl))
  const urlHost = hostOf(article.wordpressUrl)
  if (!urlHost || !allowedHosts.filter(Boolean).includes(urlHost)) {
    return NextResponse.json({ error: 'URL ของบทความไม่ตรงกับเว็บของโปรเจกต์นี้' }, { status: 400 })
  }

  const record = await requestIndexIfLive(article.wordpressUrl)
  const indexRequests = await saveProjectIndexRequest(project.id, article.id, record)
  return NextResponse.json(
    { ok: record.ok, error: record.error, indexRequest: record, indexRequests },
    { status: record.ok ? 200 : 502 },
  )
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
