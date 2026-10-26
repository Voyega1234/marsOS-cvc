// ─── SEO SME > Report — กรองข้อมูล GSC ตามผู้ดูแลบทความ (pushPrefs.ownerTags / articleOwners) ──
// ตรรกะเดียวกับ Upload Article (src/app/api/upload-article/clients/[id]/report/route.ts):
//   เฟส 1 หา "ข้อความหน้า" ตามที่ GSC ส่งมาเป๊ะ ๆ ของบทความผู้ดูแลคนนี้ → เฟส 2 ยิง query พร้อม regex filter ทีละ batch แล้วรวมผล
// ไม่มีบทความ / ไม่เจอหน้าใน GSC = รายงานว่าง (ห้ามหล่นไปใช้ข้อมูลทั้งเว็บ)

import type { searchconsole_v1 } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { parsePushPrefs } from '@/lib/project-index-requests'
import { readArticleOwners, readOwnerTags } from '@/lib/upload-article/owner-tags'
import { batchPagesForRegex, matchGscPagesToUrls, uploadedArticleUrl } from '@/lib/upload-article/gsc-report'
import { runGscQuery, type SmeOwnerScope } from './owner-scope'

export { makeScopedGscQuery, ownerFilterSummary, readOwnerFilterInput, type SmeOwnerScope } from './owner-scope'

export type SmeOwnerScopeResult = { scope: SmeOwnerScope } | { error: string; status: number }

/**
 * หาหน้าของบทความที่ผูกกับผู้ดูแล — โปรเจกต์ต้องอยู่ในองค์กรนี้ และ siteUrl ต้องเป็นเว็บ GSC ของโปรเจกต์นั้น
 * ranges = ช่วงวันที่ที่รายงานใช้ (ปัจจุบัน + เทียบ) — หน้าที่มีข้อมูลแค่ช่วงใดช่วงหนึ่งก็ต้องนับ
 * หาหน้าจากผลค้นหาแบบ web เสมอ (AI Overviews / AI Mode เป็นส่วนหนึ่งของ web จึงใช้ชุดหน้าเดียวกันได้)
 */
export async function resolveSmeOwnerScope(opts: {
  sc: searchconsole_v1.Searchconsole
  siteUrl: string
  orgId: string
  projectId: string
  ownerTagId: string
  ranges: Array<{ startDate: string; endDate: string }>
}): Promise<SmeOwnerScopeResult> {
  const project = await prisma.project.findFirst({
    where: { id: opts.projectId, organizationId: opts.orgId },
    select: { id: true, pushPrefs: true, gscSiteUrl: true, website: true },
  })
  if (!project) return { error: 'ไม่พบโปรเจกต์', status: 404 }
  if ((project.gscSiteUrl ?? '') !== opts.siteUrl) {
    return { error: 'เว็บ GSC ไม่ตรงกับโปรเจกต์ — โหลดหน้าใหม่แล้วลองอีกครั้ง', status: 400 }
  }

  const prefs = parsePushPrefs(project.pushPrefs)
  const tags = readOwnerTags(prefs.ownerTags)
  const empty = (): SmeOwnerScopeResult => ({ scope: { tagId: opts.ownerTagId, articles: 0, pagesMatched: 0, batches: [] } })
  // tag ที่ถูกลบแล้ว = ไม่มีบทความ
  if (!tags.some((t) => t.id === opts.ownerTagId)) return empty()

  const owners = readArticleOwners(prefs.articleOwners, tags)
  const ids = Object.keys(owners).filter((id) => owners[id] === opts.ownerTagId)
  if (ids.length === 0) return empty()

  const articles = await prisma.article.findMany({
    where: { id: { in: ids }, projectId: project.id },
    select: { slug: true, wordpressUrl: true },
  })
  // URL จริงบนเว็บถ้ามี ไม่งั้นเดาจาก website + slug (หน้าที่ไม่มีใน GSC ก็แค่จับคู่ไม่เจอ)
  const website = project.website ?? ''
  const articleUrls = articles
    .filter((a) => a.wordpressUrl || (a.slug && website))
    .map((a) => uploadedArticleUrl({ wordpressUrl: a.wordpressUrl, slug: a.slug }, website))
  if (articleUrls.length === 0) return { scope: { tagId: opts.ownerTagId, articles: articles.length, pagesMatched: 0, batches: [] } }

  const pageLists = await Promise.all(opts.ranges.map((r) => runGscQuery(opts.sc, opts.siteUrl, {
    startDate: r.startDate, endDate: r.endDate, dimensions: ['page'], rowLimit: 25000,
  })))
  const matched = matchGscPagesToUrls(pageLists.flat().map((r) => r.keys?.[0] ?? ''), articleUrls)
  return { scope: { tagId: opts.ownerTagId, articles: articles.length, pagesMatched: matched.length, batches: batchPagesForRegex(matched) } }
}
