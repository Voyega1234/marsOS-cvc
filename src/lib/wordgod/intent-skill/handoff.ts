/**
 * แถวที่ส่งต่อออกจากหน้า Keyword Research — ใช้ทั้งส่งเข้า Keyword ของโปรเจกต์ SEO SME
 * และส่งไปหน้า Keyword ของลูกค้า Upload Article (POST /api/upload-article/clients/[id]/keywords)
 */
import type { IntentCode, UnifiedPageType } from './types'

export interface KeywordHandoffRow {
  keyword: string
  volume: number | null
  title: string | null
  slug: string | null
  /** intent หลักจาก skill (null = ผลรุ่นเก่าที่ไม่มี skill) */
  intent: IntentCode | null
  pageType: UnifiedPageType | null
  clusterName: string | null
  section: string | null
  /** คีย์เวิร์ดหลักของกลุ่ม (1 กลุ่ม = 1 URL) */
  groupHead: string | null
  remark: string | null
  approved: boolean | null
}

const INTENT_UPLOAD: Record<IntentCode, string> = {
  I: 'informational',
  C: 'commercial',
  T: 'transactional',
  N: 'navigational',
}

export const PAGE_TYPE_LABEL_TH: Record<UnifiedPageType, string> = {
  HOMEPAGE: 'หน้าแรก',
  SERVICE: 'หน้าขาย/บริการ',
  CATEGORY: 'หน้าหมวดหมู่ (Hub)',
  LOCATION: 'หน้าพื้นที่บริการ',
  COMPARISON: 'เปรียบเทียบ',
  TOOL: 'เครื่องมือ',
  BLOG: 'บทความให้ความรู้',
}

export interface UploadKeywordItem {
  keyword: string
  volume: number | null
  title: string
  slug: string
  intent: string
  articleType: string
  note: string
}

/** แปลงเป็น items ของ API keyword ของ Upload Article (API เติมเฉพาะช่องที่ยังว่าง ไม่ทับของเดิม) */
export function toUploadKeywordItems(rows: KeywordHandoffRow[]): UploadKeywordItem[] {
  return rows
    .filter(r => r.keyword.trim())
    .map(r => {
      const note = [
        r.remark,
        r.groupHead && r.groupHead !== r.keyword ? `กลุ่ม: ${r.groupHead}` : null,
        r.clusterName ? `Cluster: ${r.clusterName}` : null,
        r.section ? `Section: ${r.section}` : null,
      ].filter(Boolean).join(' · ')
      return {
        keyword: r.keyword.trim(),
        volume: r.volume,
        title: r.title ?? '',
        slug: r.slug ?? '',
        intent: r.intent ? INTENT_UPLOAD[r.intent] : '',
        articleType: r.pageType ? PAGE_TYPE_LABEL_TH[r.pageType] : '',
        note,
      }
    })
}
