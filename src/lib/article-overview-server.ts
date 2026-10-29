import { prisma } from '@/lib/prisma'
import { parseTimeline, type TimelinePlan } from '@/lib/project-timeline'
import { PBN_PREFS_MARK, PBN_CLIENT_NAME } from '@/lib/upload-article/pbn'
import { effectiveArticleStatus } from '@/lib/upload-article/duplicates'
import {
  UPLOAD_TO_OVERVIEW,
  smeToOverview,
  type OverviewArticle,
  type OverviewClient,
  type OverviewStatus,
} from '@/lib/article-overview'

interface TimelineEntry {
  date?: string
  keyword?: string
  title?: string
  articleStatus?: string
  funnel?: string
  slug?: string
  intent?: string
  priority?: string
  volume?: number
  timelineBatch?: string
}

export interface ArticleOverview {
  articles: OverviewArticle[]
  clients: OverviewClient[]
  /** ช่วงเวลาทำงานของแต่ละโปรเจกต์ SEO SME (key = projectId) — ใช้จำกัดวันที่เลือกได้ในปฏิทิน */
  plans: Record<string, TimelinePlan>
}

// แท็บที่ควรเปิดตามสถานะ — ไปหน้าที่ทำงานต่อกับบทความนั้นได้ทันที
function smeTab(status: OverviewStatus): string {
  if (status === 'review' || status === 'approved') return 'review'
  if (status === 'pushed') return 'push'
  return 'articles'
}

function uploadTab(rawStatus: string): string {
  if (rawStatus === 'IMPORTED') return 'generate'
  if (rawStatus === 'WRITING') return 'write'
  if (rawStatus === 'PUSHING' || rawStatus === 'PUSHED' || rawStatus === 'FAILED') return 'push'
  return 'review'
}

function readPublishAt(pushPrefs: string): Record<string, string> {
  try {
    const raw = (JSON.parse(pushPrefs) as { publishAt?: unknown }).publishAt
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

/**
 * บทความทั้งระบบของ org — SEO SME (Project.timeline) + Upload Article + PBN Backlinks
 * ทีมเท่านั้น (หน้า CLIENT ไม่เรียกตัวนี้)
 */
export async function loadArticleOverview(orgId: string): Promise<ArticleOverview> {
  const [projects, uploadClients, uploadArticles] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true, timeline: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.uploadClient.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, pushPrefs: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.uploadArticle.findMany({
      where: { organizationId: orgId },
      select: { id: true, clientId: true, title: true, slug: true, status: true, wordpressPostId: true, pushedAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const articles: OverviewArticle[] = []
  const clients: OverviewClient[] = []
  const plans: Record<string, TimelinePlan> = {}

  for (const p of projects) {
    const name = p.clientName ?? p.name
    clients.push({ id: p.id, name, source: 'seo-sme' })
    const { plan, entries } = parseTimeline<TimelineEntry>(p.timeline)
    plans[p.id] = plan
    entries.forEach((e, idx) => {
      const status = smeToOverview(e.articleStatus)
      articles.push({
        id: `sme-${p.id}-${idx}`,
        source: 'seo-sme',
        clientId: p.id,
        clientName: name,
        entryIndex: idx,
        uploadArticleId: null,
        title: e.title || e.keyword || '',
        keyword: e.keyword || '',
        status,
        rawStatus: e.articleStatus || 'pending',
        date: typeof e.date === 'string' ? e.date.slice(0, 10) : '',
        publishAt: null,
        updatedAt: '',
        href: `/projects/${p.id}?tab=${smeTab(status)}`,
        funnel: e.funnel,
        slug: e.slug,
        intent: e.intent,
        priority: e.priority,
        volume: e.volume,
        timelineBatch: e.timelineBatch,
      })
    })
  }

  const clientInfo = new Map<string, { name: string; isPbn: boolean; publishAt: Record<string, string> }>()
  for (const c of uploadClients) {
    const isPbn = c.pushPrefs.includes(PBN_PREFS_MARK)
    const name = isPbn ? PBN_CLIENT_NAME : c.name
    clientInfo.set(c.id, { name, isPbn, publishAt: readPublishAt(c.pushPrefs) })
    clients.push({ id: c.id, name, source: isPbn ? 'pbn' : 'upload-article' })
  }

  for (const a of uploadArticles) {
    const c = clientInfo.get(a.clientId)
    if (!c) continue
    const rawStatus = effectiveArticleStatus(a)
    const publishAt = c.publishAt[a.id] ?? a.pushedAt?.toISOString() ?? null
    articles.push({
      id: `ua-${a.id}`,
      source: c.isPbn ? 'pbn' : 'upload-article',
      clientId: a.clientId,
      clientName: c.name,
      entryIndex: -1,
      uploadArticleId: a.id,
      title: a.title,
      keyword: '',
      status: UPLOAD_TO_OVERVIEW[rawStatus] ?? 'pending',
      rawStatus,
      date: '',
      publishAt,
      updatedAt: a.updatedAt.toISOString(),
      href: c.isPbn ? '/pbn-backlinks?tab=review' : `/upload-article/${a.clientId}?tab=${uploadTab(rawStatus)}`,
      slug: a.slug || undefined,
    })
  }

  return { articles, clients, plans }
}
