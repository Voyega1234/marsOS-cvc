import type { PbnPushes } from './pbn'
import type { UploadedArticleReportInput } from './gsc-report'

export interface PbnMonitorArticleSource { id: string; title: string; slug: string }

/** id ของบทความที่เคย push ขึ้นเว็บ PBN เว็บนี้ (ใช้ดึงเฉพาะแถวที่เกี่ยวข้องจากฐานข้อมูล) */
export function pbnMonitorArticleIds(pushes: PbnPushes, siteId: string): string[] {
  return Object.keys(pushes).filter((articleId) => !!pushes[articleId]?.[siteId])
}

/** บทความที่ push ขึ้นเว็บ PBN เว็บเดียว ในรูปแบบ input ของ buildUploadedArticleRows (คงลำดับของ articles) */
export function pbnMonitorArticles(
  pushes: PbnPushes,
  siteId: string,
  articles: PbnMonitorArticleSource[],
  fallbackUrl?: (slug: string) => string,
): UploadedArticleReportInput[] {
  const out: UploadedArticleReportInput[] = []
  for (const a of articles) {
    const rec = pushes[a.id]?.[siteId]
    if (!rec) continue
    const url = rec.url || fallbackUrl?.(a.slug) || ''
    if (!url) continue
    out.push({ id: a.id, title: a.title || a.slug, wordpressUrl: url, slug: a.slug, pushedAt: rec.at })
  }
  return out
}
