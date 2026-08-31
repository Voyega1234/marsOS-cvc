/**
 * Competitor Gap — จัดกลุ่มหัวข้อ (topic cluster) ข้ามทุกโดเมน
 *
 * เทียบกันที่ "หัวข้อ + เจตนาค้นหา" ไม่ใช่จำนวน URL
 * ทำด้วยโค้ดก่อน (ต้นทุน 0) แล้วให้ AI ช่วยตั้งชื่อกลุ่มทีหลังในการเรียกครั้งเดียว
 */

import type { DomainState, PageRecord, PageType, TopicCluster } from './types'
import { tokens } from './classify'

const JOIN_THRESHOLD = 0.42
const MAX_CLUSTERS = 120

interface Seed {
  page: PageRecord
  domainIdx: number
  tokenSet: Set<string>
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  a.forEach(t => { if (b.has(t)) inter++ })
  return inter / (a.size + b.size - inter)
}

function brandTokens(domains: DomainState[]): Set<string> {
  const out = new Set<string>()
  for (const d of domains) {
    for (const t of tokens(d.domain.replace(/\.[a-z.]+$/i, '').replace(/[-_.]/g, ' '))) out.add(t)
  }
  return out
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function buildClusters(domains: DomainState[]): TopicCluster[] {
  const brand = brandTokens(domains)
  const seeds: Seed[] = []

  domains.forEach((d, idx) => {
    for (const p of d.pages) {
      if (!p.relevant || !p.indexable) continue
      const raw = tokens([p.title, p.h1, p.path.replace(/[-_/]+/g, ' ')].join(' '))
      const set = new Set(raw.filter(t => !brand.has(t)))
      if (set.size === 0) continue
      seeds.push({ page: p, domainIdx: idx, tokenSet: set })
    }
  })

  seeds.sort((a, b) => b.page.relevanceScore - a.page.relevanceScore || b.tokenSet.size - a.tokenSet.size)

  interface Bucket { tokenSet: Set<string>; members: Seed[] }
  const buckets: Bucket[] = []

  for (const seed of seeds) {
    let best: Bucket | null = null
    let bestScore = 0
    for (const b of buckets) {
      const s = jaccard(seed.tokenSet, b.tokenSet)
      if (s > bestScore) { bestScore = s; best = b }
    }
    if (best && bestScore >= JOIN_THRESHOLD) {
      best.members.push(seed)
      // centroid โตช้า ๆ เพื่อไม่ให้กลุ่มกลืนทุกอย่าง
      if (best.tokenSet.size < 14) seed.tokenSet.forEach(t => best!.tokenSet.add(t))
    } else if (buckets.length < MAX_CLUSTERS) {
      buckets.push({ tokenSet: new Set(seed.tokenSet), members: [seed] })
    }
  }

  const comparableIdx = domains.map((d, i) => ({ d, i })).filter(x => !x.d.isOurs && x.d.comparable).map(x => x.i)
  const fallbackIdx = domains.map((d, i) => ({ d, i })).filter(x => !x.d.isOurs).map(x => x.i)
  const benchIdx = comparableIdx.length >= 2 ? comparableIdx : fallbackIdx

  const clusters: TopicCluster[] = buckets.map((b, i) => {
    const freq = new Map<string, number>()
    for (const m of b.members) m.tokenSet.forEach(t => freq.set(t, (freq.get(t) ?? 0) + 1))
    const label = Array.from(freq.entries())
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 3)
      .map(e => e[0])
      .join(' ')

    const perDomain = domains.map(() => 0)
    const ourUrls: string[] = []
    for (const m of b.members) {
      perDomain[m.domainIdx]++
      if (domains[m.domainIdx].isOurs && ourUrls.length < 8) ourUrls.push(m.page.url)
    }

    const typeCount = new Map<PageType, number>()
    for (const m of b.members) typeCount.set(m.page.pageType, (typeCount.get(m.page.pageType) ?? 0) + 1)
    const dominantType = Array.from(typeCount.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'other'

    const ourPages = perDomain[domains.findIndex(d => d.isOurs)] ?? 0
    const benchCounts = benchIdx.map(idx => perDomain[idx])
    const coverage = benchCounts.filter(n => n > 0).length
    const med = median(benchCounts)

    let state: TopicCluster['state']
    if (coverage <= 1 && ourPages === 0) state = 'low-value'
    else if (ourPages === 0) state = 'missing'
    else if (med > 0 && ourPages < med) state = 'weak'
    else state = 'strong'

    return {
      id: `c${i + 1}`,
      label: label || `หัวข้อ ${i + 1}`,
      tokens: Array.from(b.tokenSet).slice(0, 12),
      ourPages,
      ourUrls,
      competitorPages: benchIdx.map(idx => perDomain[idx]),
      competitorCoverage: coverage,
      comparableCount: benchIdx.length,
      medianPages: med,
      state,
      sampleTitles: b.members
        .filter(m => !domains[m.domainIdx].isOurs)
        .slice(0, 4)
        .map(m => m.page.title)
        .filter(Boolean),
      dominantType,
    }
  })

  // กลุ่มที่มีหน้าเดียวจากโดเมนเดียว = สัญญาณอ่อน ไม่เอามาสร้างข้อเสนอ
  return clusters
    .filter(c => c.ourPages + c.competitorPages.reduce((s, n) => s + n, 0) >= 2)
    .sort((a, b) => b.competitorCoverage - a.competitorCoverage || b.medianPages - a.medianPages)
}

/** ให้ AI ตั้งชื่อกลุ่มให้อ่านรู้เรื่อง — เรียกครั้งเดียวทั้งชุด ล้มเหลวก็ใช้ชื่อจาก token ต่อได้ */
import { askJson } from './ai'
import type { ORUsage } from '@/lib/openrouter'
import { emptyUsage } from './ai'

export async function nameClusters(clusters: TopicCluster[], keyword: string): Promise<{ usage: ORUsage; error: string | null }> {
  const targets = clusters.slice(0, 60)
  if (targets.length === 0) return { usage: emptyUsage(), error: null }

  const res = await askJson<{ clusters?: Array<{ id: string; label: string }> }>({
    system: `คุณคือ Senior SEO Specialist ตั้งชื่อกลุ่มหัวข้อให้สั้น ชัด เป็นภาษาที่ลูกค้าใช้จริง
ตอบ JSON เท่านั้น: {"clusters":[{"id":"c1","label":"ชื่อกลุ่ม"}]}
ใช้ข้อมูลที่ให้เท่านั้น ห้ามเพิ่มกลุ่มใหม่ ห้ามอธิบาย ชื่อยาวไม่เกิน 40 ตัวอักษร`,
    user: `keyword เป้าหมาย: ${keyword}\n\nกลุ่มที่ต้องตั้งชื่อ:\n${JSON.stringify(
      targets.map(c => ({ id: c.id, tokens: c.tokens.slice(0, 8), titles: c.sampleTitles.slice(0, 3) }))
    )}`,
    maxTokens: 2000,
  })

  for (const item of res.data?.clusters ?? []) {
    const c = clusters.find(x => x.id === item.id)
    if (c && typeof item.label === 'string' && item.label.trim()) c.label = item.label.trim().slice(0, 60)
  }
  return { usage: res.usage, error: res.error }
}
