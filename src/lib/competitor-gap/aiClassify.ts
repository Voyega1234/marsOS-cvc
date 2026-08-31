/**
 * Competitor Gap — ชั้นที่ 2: AI จัดประเภทเฉพาะหน้าที่กฎยังไม่มั่นใจ (ส่งเป็นชุด)
 * ห้ามยิง AI ทีละหน้า และห้ามส่ง HTML ดิบ — ส่งเฉพาะ metadata ที่โค้ดสกัดมาแล้ว
 */

import type { PageRecord, PageType } from './types'
import { addUsage, askJson, emptyUsage } from './ai'
import { decideRelevant } from './classify'
import type { ORUsage } from '@/lib/openrouter'

const BATCH_SIZE = 40
const MAX_BATCHES = 6

const VALID: PageType[] = [
  'homepage', 'service', 'product', 'category', 'location', 'route', 'industry',
  'article', 'guide', 'case-study', 'tool', 'glossary', 'landing', 'about',
  'contact', 'career', 'legal', 'other',
]

const SYSTEM = `คุณคือ Senior SEO Specialist ที่จัดประเภทหน้าเว็บจาก metadata ที่ระบบดึงมาแล้ว
ตอบเป็น JSON เท่านั้น: {"pages":[{"i":<index>,"type":"<page type>","relevant":true|false}]}
type ต้องเป็นหนึ่งใน: ${VALID.join(', ')}
relevant = หน้านี้ช่วยแข่งขันในหัวข้อ/ธุรกิจของ keyword เป้าหมายจริงหรือไม่
ห้ามเดาข้อมูลที่ไม่ได้ให้มา ห้ามเพิ่ม field อื่น ห้ามอธิบาย`

interface AiPageAnswer { i: number; type: string; relevant?: boolean }

export interface AiClassifyResult {
  usage: ORUsage
  classified: number
  errors: string[]
}

export async function aiClassifyAmbiguous(params: {
  pages: PageRecord[]
  keyword: string
  domainLabel: string
}): Promise<AiClassifyResult> {
  const targets = params.pages.filter(p => p.classifiedBy === 'unknown' && p.indexable)
  const result: AiClassifyResult = { usage: emptyUsage(), classified: 0, errors: [] }
  if (targets.length === 0) return result

  // เรียงให้หน้าที่เกี่ยวข้องสูงสุดได้คิวก่อน — งบ AI จำกัด
  targets.sort((a, b) => b.relevanceScore - a.relevanceScore)
  const budget = targets.slice(0, BATCH_SIZE * MAX_BATCHES)

  for (let start = 0; start < budget.length; start += BATCH_SIZE) {
    const batch = budget.slice(start, start + BATCH_SIZE)
    const payload = batch.map((p, idx) => ({
      i: idx,
      path: p.path,
      title: p.title,
      h1: p.h1,
      h2: p.h2.slice(0, 4),
      words: p.wordCount,
      schema: p.schemaTypes.slice(0, 4),
      hasDate: !!p.publishedDate,
      excerpt: (p.sample ?? '').slice(0, 200),
    }))

    const res = await askJson<{ pages?: AiPageAnswer[] }>({
      system: SYSTEM,
      user: `keyword เป้าหมาย: ${params.keyword}\nเว็บไซต์: ${params.domainLabel}\n\nหน้าที่ต้องจัดประเภท:\n${JSON.stringify(payload)}`,
      maxTokens: 2500,
    })
    result.usage = addUsage(result.usage, res.usage)
    if (res.error) { result.errors.push(res.error); continue }

    for (const ans of res.data?.pages ?? []) {
      const page = batch[Number(ans.i)]
      if (!page) continue
      const type = VALID.includes(ans.type as PageType) ? (ans.type as PageType) : page.pageType
      page.pageType = type
      page.classifiedBy = 'ai'
      if (typeof ans.relevant === 'boolean') page.relevant = ans.relevant && page.indexable
      else page.relevant = decideRelevant(page, page.relevanceScore)
      result.classified++
    }
  }

  return result
}
