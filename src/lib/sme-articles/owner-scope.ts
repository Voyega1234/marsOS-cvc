// ─── SEO SME > Report — ส่วนที่ไม่พึ่ง DB ของตัวกรองผู้ดูแล (ยิง query ตาม scope + อ่าน input) ──
// แยกจาก owner-report.ts เพื่อให้ unit test ได้โดยไม่โหลด prisma

import type { searchconsole_v1 } from 'googleapis'
import { buildPageRegex, mergeGscRows, type RawGscRow } from '@/lib/upload-article/gsc-report'

export interface SmeOwnerScope {
  tagId: string
  /** จำนวนบทความที่ผูกกับผู้ดูแลนี้ */
  articles: number
  /** จำนวนหน้าใน GSC ที่ตรงกับบทความเหล่านั้น */
  pagesMatched: number
  /** หน้าแบ่งเป็นชุดให้ regex ยาวไม่เกินเพดานของ GSC — ว่าง = ไม่มีหน้าให้รายงาน */
  batches: string[][]
}

/** อ่าน projectId / ownerTagId จาก body ของ /api/report/gsc* — ไม่ส่งมาครบ = ไม่กรอง (null) */
export function readOwnerFilterInput(body: unknown): { projectId: string; ownerTagId: string } | null {
  if (!body || typeof body !== 'object') return null
  const { projectId, ownerTagId } = body as Record<string, unknown>
  if (typeof projectId !== 'string' || typeof ownerTagId !== 'string') return null
  const p = projectId.trim().slice(0, 64)
  const t = ownerTagId.trim().slice(0, 64)
  return p && t ? { projectId: p, ownerTagId: t } : null
}

/** จำนวน batch ที่ยิงพร้อมกัน — กันยิง GSC รัวเกินเมื่อผู้ดูแลมีบทความเยอะ */
const OWNER_BATCH_CONCURRENCY = 2

export async function runGscQuery(sc: searchconsole_v1.Searchconsole, siteUrl: string, body: Record<string, unknown>): Promise<RawGscRow[]> {
  const res = await sc.searchanalytics.query({ siteUrl, requestBody: body as never })
  return (res.data.rows ?? []) as RawGscRow[]
}

/**
 * ตัวยิง query ของรายงาน: ไม่มี scope = ยิงตรง (ทั้งเว็บ เหมือนเดิม)
 * มี scope = ยิงทีละ batch พร้อม regex filter หน้า แล้วรวมผล (ตัดตาม rowLimit เดิม) — ไม่มีหน้า = []
 */
export function makeScopedGscQuery(sc: searchconsole_v1.Searchconsole, siteUrl: string, scope: SmeOwnerScope | null) {
  return async (body: Record<string, unknown>): Promise<RawGscRow[]> => {
    if (!scope) return runGscQuery(sc, siteUrl, body)
    if (scope.batches.length === 0) return []
    const results: RawGscRow[][] = []
    for (let i = 0; i < scope.batches.length; i += OWNER_BATCH_CONCURRENCY) {
      const chunk = scope.batches.slice(i, i + OWNER_BATCH_CONCURRENCY)
      results.push(...await Promise.all(chunk.map((pages) => runGscQuery(sc, siteUrl, {
        ...body,
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: buildPageRegex(pages) }] }],
      }))))
    }
    const rowLimit = typeof body.rowLimit === 'number' ? body.rowLimit : undefined
    return mergeGscRows(results, rowLimit)
  }
}

/** ส่วนที่แนบไปกับ response ให้หน้า Report แสดงแถบ "กรองเฉพาะบทความของ …" */
export function ownerFilterSummary(scope: SmeOwnerScope | null) {
  return scope ? { tagId: scope.tagId, articles: scope.articles, pagesMatched: scope.pagesMatched } : null
}
