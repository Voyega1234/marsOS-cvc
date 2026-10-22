// ─── Upload Article — โหลดบทความในระบบมาแปลงเป็นลิงก์ภายใน (ฝั่งเซิร์ฟเวอร์ ใช้ prisma) ──────────
// PBN Backlinks (pushPrefs.kind === 'pbn') ไม่เอาบทความมาเป็นลิงก์อัตโนมัติ — คนละเว็บ คนละโดเมน

import { prisma } from '@/lib/prisma'
import { isPbnPrefs, parseWriterSourceName } from './pbn'
import { articleLinkPairs, articleLinkRows, linkPoolForArticle, maxLinksPerArticle, anchorPoolForTopic, normalizeUrl, rankLinksByTopic, type ArticleLinkRow } from './internal-links'
import { linkHost, topicLinkKeeper } from './link-insert'
import { DEFAULT_UPLOAD_INTERNAL_LINKS, type UploadInternalLinks, type UploadKeyword, type UploadLinkPair } from './types'

function readPlan(prefs: Record<string, unknown> | null): UploadKeyword[] {
  const raw = prefs?.keywordPlan
  return Array.isArray(raw) ? (raw as UploadKeyword[]) : []
}

/** บทความทั้งหมดของลูกค้านี้ (ใหม่สุดก่อน สูงสุด 500 แถว) แปลงเป็นรายการลิงก์ภายใน — PBN คืน [] เสมอ */
export async function loadArticleLinkRows(
  clientId: string,
  orgId: string,
  prefs: Record<string, unknown> | null,
): Promise<ArticleLinkRow[]> {
  if (isPbnPrefs(prefs)) return []
  const rows = await prisma.uploadArticle.findMany({
    where: { clientId, organizationId: orgId },
    select: { id: true, title: true, sourceName: true, status: true, pushMode: true, wordpressUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return articleLinkRows(rows, readPlan(prefs))
}

export interface ArticleLinkContext {
  pool: UploadLinkPair[]
  max: number
  /** host ของเว็บลูกค้า + ทุก URL ใน pool — ลิงก์ที่ชี้มาที่ host เหล่านี้ถือเป็นลิงก์ภายใน */
  siteHosts: Set<string>
  /** ลิงก์ภายในเดิมที่ตรงหัวข้อ + anchor ตรงหน้าปลายทาง — relink เก็บไว้ ไม่ถอด */
  keep: (url: string, text: string) => boolean
}

/**
 * pool ลิงก์ภายในของบทความ 1 ชิ้น — ใช้ตอน generate/relink
 * ตัดลิงก์เข้าตัวเอง + keyword หลักของบทความเอง แล้วเหลือเฉพาะคู่ที่หัวข้อตรงกับ keyword/ชื่อบทความ (เรียงตรงมากสุดก่อน)
 */
export async function loadArticleLinkContext(
  client: { id: string; website?: string | null; wpUrl?: string | null },
  orgId: string,
  prefs: Record<string, unknown> | null,
  article: { title: string; slug: string; sourceName: string; wordpressUrl: string | null },
): Promise<ArticleLinkContext> {
  const raw = prefs?.internalLinks
  const links: UploadInternalLinks = { ...DEFAULT_UPLOAD_INTERNAL_LINKS, ...(raw && typeof raw === 'object' ? (raw as Partial<UploadInternalLinks>) : {}) }
  const extra = await loadArticleLinkPairs(client.id, orgId, prefs)
  const parsed = parseWriterSourceName(article.sourceName)
  const planKeyword = parsed ? readPlan(prefs).find((k) => k.id === parsed.keywordId)?.keyword : undefined
  const all = linkPoolForArticle(links, {
    slug: article.slug,
    excludeUrl: article.wordpressUrl ?? undefined,
    extra,
    ownKeywords: [article.title, planKeyword ?? ''],
  })
  const manualKeys = new Set((links.manual || []).map((p) => normalizeUrl(p.url)))
  const topic = { keyword: planKeyword ?? '', title: article.title }
  const ranked = rankLinksByTopic(all, topic, manualKeys)
  // host จากทั้ง pool (ก่อนกรองหัวข้อ) — ลิงก์เก่าที่ชี้ไปหน้าไม่ตรงหัวข้อก็ต้องถูกถอดได้
  const siteHosts = new Set<string>()
  for (const u of [client.website, client.wpUrl, ...all.map((p) => p.url)]) {
    const h = u ? linkHost(/^https?:\/\//i.test(u) ? u : `https://${u}`) : ''
    if (h) siteHosts.add(h)
  }
  return { pool: anchorPoolForTopic(ranked, topic, all), max: maxLinksPerArticle(links.linksPerArticle), siteHosts, keep: topicLinkKeeper(ranked, all) }
}

/** เฉพาะคู่ลิงก์ที่เผยแพร่แล้วจริง — ใช้เติม pool ตอนเขียน/ generate บทความ */
export async function loadArticleLinkPairs(
  clientId: string,
  orgId: string,
  prefs: Record<string, unknown> | null,
): Promise<UploadLinkPair[]> {
  return articleLinkPairs(await loadArticleLinkRows(clientId, orgId, prefs))
}
