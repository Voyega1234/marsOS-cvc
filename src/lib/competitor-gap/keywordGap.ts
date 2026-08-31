/**
 * Competitor Gap — Keyword Gap เท่าที่จำเป็นต่อการตัดสินใจแข่งขัน
 *
 * ไม่ได้สร้าง Keyword Research ใหม่ (โมดูลเดิมไม่ถูกแตะ) — ใช้ ranked keywords
 * ของ DataForSEO Labs แบบ bulk โดเมนละครั้ง แล้วเทียบตำแหน่งกัน
 */

import { DFS_COST, dfsPost, hasDfsCreds } from '@/lib/dfsClient'
import { isGenericToken, tokens, type Vocabulary } from './classify'
import type { DomainState, KeywordGapResult, KeywordGapRow, KeywordState } from './types'

const LIMIT_PER_DOMAIN = 300
const MAX_ROWS = 400

interface RankedResponse {
  cost?: number
  tasks?: Array<{
    status_code: number
    status_message?: string
    cost?: number
    result?: Array<{
      total_count?: number
      metrics?: { organic?: { count?: number; etv?: number } }
      items?: Array<Record<string, any>>
    }>
  }>
}

export interface DomainKeywords {
  domain: string
  rows: Map<string, { position: number; url: string | null; volume: number | null; intent: string | null }>
  organicKeywords: number | null
  estimatedTraffic: number | null
  note: string | null
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchRankedKeywords(domain: string, locationCode: number, languageCode: string): Promise<{ data: DomainKeywords; costUsd: number }> {
  const empty: DomainKeywords = { domain, rows: new Map(), organicKeywords: null, estimatedTraffic: null, note: null }
  if (!hasDfsCreds()) return { data: { ...empty, note: 'ไม่ได้ตั้งค่า DataForSEO' }, costUsd: 0 }

  try {
    const json = await dfsPost<RankedResponse>('/dataforseo_labs/google/ranked_keywords/live', [{
      target: domain,
      location_code: locationCode,
      language_code: languageCode,
      limit: LIMIT_PER_DOMAIN,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }])

    const task = json.tasks?.[0]
    const result = task?.result?.[0]
    const items = result?.items ?? []
    const rows = empty.rows

    for (const item of items) {
      const kw = item?.keyword_data?.keyword ?? item?.keyword
      if (typeof kw !== 'string' || !kw.trim()) continue
      const serpItem = item?.ranked_serp_element?.serp_item ?? item?.serp_item ?? {}
      const pos = num(serpItem?.rank_group ?? serpItem?.rank_absolute)
      if (pos === null) continue
      const existing = rows.get(kw)
      if (existing && existing.position <= pos) continue
      rows.set(kw, {
        position: pos,
        url: typeof serpItem?.url === 'string' ? serpItem.url : null,
        volume: num(item?.keyword_data?.keyword_info?.search_volume),
        intent: typeof item?.keyword_data?.search_intent_info?.main_intent === 'string'
          ? item.keyword_data.search_intent_info.main_intent
          : null,
      })
    }

    const billed = typeof json.cost === 'number' ? json.cost
      : typeof task?.cost === 'number' ? task.cost
      : DFS_COST.ranked_keywords

    return {
      data: {
        domain,
        rows,
        organicKeywords: num(result?.total_count) ?? num(result?.metrics?.organic?.count),
        // ใช้เฉพาะค่าที่ DataForSEO ส่งมาจริง — ถ้าไม่มีคืน null (ห้ามประมาณเอง)
        estimatedTraffic: num(result?.metrics?.organic?.etv),
        note: rows.size === 0 ? 'ไม่พบคีย์เวิร์ดที่ติดอันดับสำหรับโดเมนนี้' : null,
      },
      costUsd: billed,
    }
  } catch (e) {
    return {
      data: { ...empty, note: e instanceof Error ? e.message.slice(0, 160) : 'ดึงข้อมูลไม่สำเร็จ' },
      costUsd: 0,
    }
  }
}

/**
 * คีย์เวิร์ดหนึ่งคำ "เกี่ยวกับธุรกิจของเรา" แค่ไหน
 *
 * ranked keywords ของโดเมนใหญ่ (marketplace/เว็บรวมบริการ) มีคำนอกธุรกิจปนมาเยอะมาก
 * ถ้าไม่กรอง ตารางจะถูกคำ volume สูงที่ไม่เกี่ยวข้องยึดหัวตาราง
 * ใช้คลังคำเดียวกับชั้นจัดประเภทหน้า (keyword เป้าหมาย + คำที่ตลาดบน SERP ใช้จริง) — ไม่มีค่าใช้จ่ายเพิ่ม
 */
function keywordRelevance(keyword: string, vocab: Vocabulary): { ratio: number; strong: number } {
  const ts = tokens(keyword)
  if (ts.length === 0) return { ratio: 0, strong: 0 }
  let hits = 0
  let strong = 0
  for (const t of ts) {
    // คำกว้างไม่นับเป็นหลักฐาน ไม่งั้น "ร้านทำผม" จะผ่านเพราะคำว่า "ทำ" ใน "รับทำ seo"
    if (isGenericToken(t)) continue
    const w = vocab.weights.get(t)
    if (w === undefined) continue
    hits += 1
    if (w >= 2) strong += 1
  }
  return { ratio: hits / ts.length, strong }
}

function isBusinessRelevant(keyword: string, coverage: number, vocab: Vocabulary | null): boolean {
  if (!vocab) return true
  const ts = tokens(keyword)
  const hasSeedToken = ts.some(t => !isGenericToken(t) && vocab.keywordTokens.includes(t))
  const { ratio, strong } = keywordRelevance(keyword, vocab)
  // คู่แข่งเทียบเคียงหลายเจ้าติดคำเดียวกัน = สัญญาณตลาด ผ่านเกณฑ์ที่หลวมกว่า
  if (coverage >= 2) return strong >= 1 || ratio >= 0.34
  // คู่แข่งติดแค่เจ้าเดียว: ต้องพาดพิงคำเป้าหมายโดยตรง หรือทับซ้อนกับคลังคำเกือบทั้งคำ
  return strong >= 1 && (hasSeedToken || ratio >= 0.6)
}

function stateOf(ourPos: number | null, compPositions: (number | null)[], coverage: number, volume: number | null): KeywordState {
  const ranked = compPositions.filter((p): p is number => p !== null)
  const best = ranked.length ? Math.min(...ranked) : null

  if (ourPos === null) {
    // ไม่มีคู่แข่งเทียบเคียงเจ้าไหนยึดหน้าแรกได้ = ช่องว่างที่เข้าไปเป็นเจ้าแรกได้
    if (coverage <= 1 && (best === null || best > 10) && (volume ?? 0) > 0) return 'UNIQUE_OPPORTUNITY'
    return 'MISSING'
  }
  if (best === null) return 'WINNING'
  if (ourPos <= best) {
    // นำอยู่แต่คู่แข่งจ่อหลัง = ต้องตั้งรับ
    return best - ourPos <= 3 ? 'DEFEND' : 'WINNING'
  }
  if (ourPos >= 11 && ourPos <= 20) return 'NEAR_WIN'
  return 'WEAK'
}

export function buildKeywordGap(params: {
  ours: DomainKeywords
  competitors: DomainKeywords[]
  comparableFlags: boolean[]
  /** คลังคำของธุรกิจ ใช้กรองคีย์เวิร์ดนอกเรื่องออก (ไม่ส่งมา = ไม่กรอง) */
  vocab?: Vocabulary | null
}): KeywordGapResult {
  const counts: Record<KeywordState, number> = {
    MISSING: 0, WEAK: 0, NEAR_WIN: 0, WINNING: 0, DEFEND: 0, UNIQUE_OPPORTUNITY: 0,
  }

  const universe = new Set<string>()
  params.ours.rows.forEach((_v, k) => universe.add(k))
  params.competitors.forEach((c, i) => {
    if (!params.comparableFlags[i]) return       // คู่แข่งที่เทียบไม่ได้ ไม่ตั้งเป็นมาตรฐาน
    c.rows.forEach((_v, k) => universe.add(k))
  })

  const rows: KeywordGapRow[] = []
  let filteredOut = 0
  universe.forEach(keyword => {
    const ourEntry = params.ours.rows.get(keyword) ?? null
    const compEntries = params.competitors.map(c => c.rows.get(keyword) ?? null)
    const compPositions = compEntries.map((e, i) => (params.comparableFlags[i] ? e?.position ?? null : null))
    const coverage = compPositions.filter(p => p !== null).length
    if (!ourEntry && coverage === 0) return
    // คำที่เว็บเราติดอันดับอยู่แล้วเก็บไว้เสมอ ส่วนคำของคู่แข่งต้องเกี่ยวกับธุรกิจจริง
    if (!ourEntry && !isBusinessRelevant(keyword, coverage, params.vocab ?? null)) {
      filteredOut += 1
      return
    }

    const volume = ourEntry?.volume ?? compEntries.find(e => e?.volume != null)?.volume ?? null
    const intent = ourEntry?.intent ?? compEntries.find(e => e?.intent)?.intent ?? null
    const ranked = compPositions.filter((p): p is number => p !== null)

    rows.push({
      keyword,
      searchVolume: volume,
      ourPosition: ourEntry?.position ?? null,
      ourUrl: ourEntry?.url ?? null,
      competitorPositions: compEntries.map(e => e?.position ?? null),
      competitorCoverage: coverage,
      bestCompetitorPosition: ranked.length ? Math.min(...ranked) : null,
      state: stateOf(ourEntry?.position ?? null, compPositions, coverage, volume),
      intent,
    })
  })

  rows.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.keyword.localeCompare(b.keyword))
  const trimmed = rows.slice(0, MAX_ROWS)
  for (const r of trimmed) counts[r.state]++

  const notes = [params.ours.note, ...params.competitors.map(c => c.note)].filter(Boolean) as string[]
  if (filteredOut > 0) notes.push(`กรองคีย์เวิร์ดที่ไม่เกี่ยวกับธุรกิจออก ${filteredOut.toLocaleString()} คำ`)
  return {
    available: trimmed.length > 0,
    note: notes.length ? Array.from(new Set(notes)).join(' · ') : null,
    rows: trimmed,
    counts,
  }
}

export function emptyKeywordGap(note: string): KeywordGapResult {
  return {
    available: false,
    note,
    rows: [],
    counts: { MISSING: 0, WEAK: 0, NEAR_WIN: 0, WINNING: 0, DEFEND: 0, UNIQUE_OPPORTUNITY: 0 },
  }
}

export function attachDomainMetrics(domains: DomainState[], data: DomainKeywords[]): void {
  domains.forEach((d, i) => {
    const src = data[i]
    if (!src) return
    d.organicKeywords = src.organicKeywords
    d.estimatedTraffic = src.estimatedTraffic
  })
}
