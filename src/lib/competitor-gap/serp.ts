/**
 * Competitor Gap — Google Top N จาก DataForSEO (ใช้ client เดิม src/lib/dfsClient.ts)
 * ไม่เพิ่มผู้ให้บริการ SEO เจ้าใหม่ ไม่คัดลอก credential
 */

import { DFS_COST, dfsPost, hasDfsCreds } from '@/lib/dfsClient'
import type { CompetitorKind, SerpEntry, SerpResult } from './types'
import { toDomain } from './urls'

interface DfsSerpResponse {
  cost?: number
  tasks?: Array<{
    status_code: number
    status_message?: string
    cost?: number
    result?: Array<{ items?: Array<Record<string, any>> }>
  }>
}

const GOV = /(^|\.)go\.th$|(^|\.)gov(\.[a-z]{2})?$|(^|\.)mil(\.[a-z]{2})?$|(^|\.)or\.th$/i
const COMMUNITY = ['pantip.com', 'reddit.com', 'quora.com', 'facebook.com', 'x.com', 'twitter.com', 'blockdit.com', 'stackexchange.com', 'stackoverflow.com', 'linkedin.com', 'threads.net', 'tiktok.com', 'instagram.com']
const VIDEO = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com']
const MARKETPLACE = ['shopee.co.th', 'shopee.com', 'lazada.co.th', 'amazon.com', 'alibaba.com', 'aliexpress.com', 'ebay.com', 'taobao.com', 'jd.com', 'nocnoc.com', 'kaidee.com', 'shopify.com', 'etsy.com']
const DIRECTORY = ['wongnai.com', 'tripadvisor.com', 'yellowpages.co.th', 'thaiyellowpages.com', 'ddproperty.com', 'hipflat.co.th', 'jobsdb.com', 'jobthai.com', 'yelp.com', 'foursquare.com', 'agoda.com', 'booking.com', 'trivago.com']
const MEDIA = ['thairath.co.th', 'khaosod.co.th', 'matichon.co.th', 'prachachat.net', 'bangkokpost.com', 'thansettakij.com', 'posttoday.com', 'sanook.com', 'kapook.com', 'mgronline.com', 'dailynews.co.th', 'nationthailand.com', 'brandinside.asia', 'marketeeronline.co', 'techsauce.co', 'forbes.com', 'bloomberg.com', 'reuters.com', 'cnn.com', 'bbc.com']
const REFERENCE = ['wikipedia.org', 'wikiwand.com', 'britannica.com', 'medium.com', 'blogspot.com', 'wordpress.com', 'wixsite.com']

function inList(domain: string, list: string[]): boolean {
  return list.some(d => domain === d || domain.endsWith(`.${d}`))
}

export function classifyDomain(domain: string): CompetitorKind {
  if (!domain) return 'other'
  if (GOV.test(domain)) return 'government'
  if (inList(domain, COMMUNITY) || inList(domain, VIDEO)) return 'community'
  if (inList(domain, MARKETPLACE)) return 'marketplace'
  if (inList(domain, DIRECTORY)) return 'directory'
  if (inList(domain, MEDIA)) return 'media'
  if (inList(domain, REFERENCE)) return 'other'
  return 'business'
}

/**
 * เว็บที่สแกนไม่ได้จริง — ปิดด้วย login wall ทำให้ crawler เห็นแต่หน้าล็อกอิน
 * ยังแสดงในตาราง SERP ตามจริง แต่ไม่ถูกเลือกมาเป็นคู่แข่งให้เสียเวลา/เสียเงินสแกน
 */
const UNSCANNABLE = ['facebook.com', 'fb.com', 'm.me', 'messenger.com']

export function isScannableDomain(domain: string): boolean {
  return !inList(domain, UNSCANNABLE)
}

/** เทียบเคียงกับเว็บธุรกิจของลูกค้าได้ไหม — ใช้ตัดสิน baseline เท่านั้น ไม่ตัดผลออกจากตาราง */
export function isComparable(kind: CompetitorKind): boolean {
  return kind === 'business' || kind === 'content'
}

export interface SerpFetch {
  result: SerpResult
  costUsd: number
  calls: number
}

export async function fetchTopCompetitors(params: {
  keyword: string
  locationCode: number
  languageCode: string
  depth?: number
  take: number
}): Promise<SerpFetch> {
  if (!hasDfsCreds()) throw new Error('ยังไม่ได้ตั้งค่า DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)')

  const data = await dfsPost<DfsSerpResponse>('/serp/google/organic/live/regular', [{
    keyword: params.keyword,
    location_code: params.locationCode,
    language_code: params.languageCode,
    depth: params.depth ?? 10,
  }])

  const task = data.tasks?.[0]
  if (task && task.status_code !== 20000) throw new Error(task.status_message ?? `DFS task error ${task.status_code}`)

  const items = task?.result?.[0]?.items ?? []
  const all: SerpEntry[] = []
  for (const it of items) {
    if (it?.type !== 'organic') continue                 // ตัดโฆษณา/ฟีเจอร์อื่นออกจากอันดับออร์แกนิก
    const url = String(it.url ?? '')
    const domain = String(it.domain ?? toDomain(url)).replace(/^www\./i, '').toLowerCase()
    if (!domain) continue
    if (all.some(e => e.domain === domain)) continue     // 1 โดเมน 1 ที่นั่ง
    const kind = classifyDomain(domain)
    all.push({
      position: Number(it.rank_group ?? it.rank_absolute ?? all.length + 1),
      domain,
      url,
      title: String(it.title ?? ''),
      kind,
      comparable: isComparable(kind),
    })
  }

  // ต้นทุนจริงจากบิล DFS ในการตอบกลับ — ไม่มีค่อยถอยไปใช้ค่าประมาณของระบบ
  const billed = typeof data.cost === 'number' ? data.cost
    : typeof task?.cost === 'number' ? task.cost
    : DFS_COST.serp

  return {
    result: {
      keyword: params.keyword,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      fetchedAt: new Date().toISOString(),
      top: all.filter(e => isScannableDomain(e.domain)).slice(0, params.take),
      all,
    },
    costUsd: billed,
    calls: 1,
  }
}
