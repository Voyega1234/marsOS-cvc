/**
 * Competitor Gap — คำนวณ Top 5 Baseline และแผน Phase 1 ด้วยข้อมูลล้วน ๆ
 *
 * หลัก:
 *  - baseline หลัก = MEDIAN ของคู่แข่งที่ "เทียบเคียงได้" (ไม่ใช่เจ้าที่ใหญ่ที่สุด)
 *  - แยก "หน้าทั้งหมดที่ index ได้" ออกจาก "หน้าที่เกี่ยวข้องเชิงแข่งขัน" เสมอ
 *  - จำนวนหน้าไม่ใช่เป้าหมาย: ส่วนต่างเชิงตัวเลขถูกยุบด้วย topic cluster + เช็คหน้าเดิมก่อนเสมอ
 */

import type {
  DomainInventory, DomainState, GapAction, KeywordGapResult, MetricRow,
  PageRecord, PageType, Priority, TopicCluster,
} from './types'
import { isCommercialType, labelLooksLikeService, tokens } from './classify'
import { DIM_LABELS, type QualityBenchmark, scoreDomain, weaknessesFrom } from './quality'
import { slugify } from './urls'

const ALL_TYPES: PageType[] = [
  'homepage', 'service', 'product', 'category', 'location', 'route', 'industry',
  'article', 'guide', 'case-study', 'tool', 'glossary', 'landing', 'about',
  'contact', 'career', 'legal', 'other',
]

export function median(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length === 0) return null
  const s = nums.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length === 0) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

// ── Inventory ────────────────────────────────────────────────────────────────

export function buildInventory(d: DomainState, benchmark: QualityBenchmark): DomainInventory {
  const byType = {} as Record<PageType, number>
  for (const t of ALL_TYPES) byType[t] = 0

  let totalIndexable = 0
  let relevant = 0
  for (const p of d.pages) {
    if (!p.indexable) continue
    totalIndexable++
    if (!p.relevant) continue
    relevant++
    byType[p.pageType] = (byType[p.pageType] ?? 0) + 1
  }

  const quality = scoreDomain(d.pages, benchmark)
  return {
    domain: d.domain,
    isOurs: d.isOurs,
    comparable: d.comparable,
    totalIndexable,
    relevant,
    byType,
    contentQuality: quality.score,
    organicKeywords: d.organicKeywords,
    estimatedTraffic: d.estimatedTraffic,
  }
}

// ── Metric table ─────────────────────────────────────────────────────────────

interface MetricDef {
  key: string
  label: string
  pick: (inv: DomainInventory) => number | null
  countOnly: boolean
}

const METRIC_DEFS: MetricDef[] = [
  { key: 'relevant',    label: 'Relevant SEO Pages',       pick: i => i.relevant,             countOnly: true },
  { key: 'service',     label: 'Service Pages',            pick: i => i.byType.service,       countOnly: true },
  { key: 'article',     label: 'Articles',                 pick: i => i.byType.article + i.byType.guide, countOnly: true },
  { key: 'route',       label: 'Route Pages',              pick: i => i.byType.route,         countOnly: true },
  { key: 'location',    label: 'Location Pages',           pick: i => i.byType.location,      countOnly: true },
  { key: 'industry',    label: 'Industry Pages',           pick: i => i.byType.industry,      countOnly: true },
  { key: 'case-study',  label: 'Case Studies',             pick: i => i.byType['case-study'], countOnly: true },
  { key: 'tool',        label: 'Tools',                    pick: i => i.byType.tool,          countOnly: true },
  { key: 'product',     label: 'Product / Category Pages', pick: i => i.byType.product + i.byType.category, countOnly: true },
  { key: 'totalIndexable', label: 'Total Indexable Pages', pick: i => i.totalIndexable,       countOnly: true },
  { key: 'quality',     label: 'Content Quality (0–100)',  pick: i => i.contentQuality,       countOnly: false },
  { key: 'organicKeywords', label: 'Organic Keywords',     pick: i => i.organicKeywords,      countOnly: false },
  { key: 'traffic',     label: 'Estimated Organic Traffic', pick: i => i.estimatedTraffic,    countOnly: false },
]

export function buildMetrics(inventories: DomainInventory[]): MetricRow[] {
  const ours = inventories.find(i => i.isOurs) ?? null
  const competitors = inventories.filter(i => !i.isOurs)
  const benchSet = competitors.filter(c => c.comparable).length >= 2
    ? competitors.filter(c => c.comparable)
    : competitors

  return METRIC_DEFS.map(def => {
    const ourVal = ours ? def.pick(ours) : null
    const compVals = competitors.map(def.pick)
    const benchVals = benchSet.map(def.pick).filter((v): v is number => v !== null)
    const med = median(benchVals)
    const avg = average(benchVals)
    const best = benchVals.length ? Math.max(...benchVals) : null

    let missing: number | null = null
    let coveragePct: number | null = null
    let gapPct: number | null = null
    if (ourVal !== null && med !== null) {
      missing = Math.max(0, Math.round(med - ourVal))
      coveragePct = med <= 0 ? 100 : Math.min(100, Math.round((ourVal / med) * 100))
      gapPct = Math.max(0, 100 - coveragePct)
    }

    return {
      key: def.key,
      label: def.label,
      ours: ourVal,
      competitors: compVals,
      median: med,
      average: avg,
      best,
      missingToBaseline: missing,
      coveragePct,
      gapPct,
      countOnly: def.countOnly,
    }
  })
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface ReadinessResult {
  score: number | null
  breakdown: { label: string; weight: number; coveragePct: number }[]
  biggestProblem: string | null
}

const READINESS_WEIGHTS = {
  relevantPages: 25,
  serviceCoverage: 15,
  topicCoverage: 25,
  keywordCoverage: 15,
  contentQuality: 20,
} as const

export function computeReadiness(params: {
  metrics: MetricRow[]
  clusters: TopicCluster[]
  keywordGap: KeywordGapResult
  inventories: DomainInventory[]
}): ReadinessResult {
  const parts: { key: string; label: string; weight: number; coveragePct: number }[] = []

  const relevant = params.metrics.find(m => m.key === 'relevant')
  if (relevant?.coveragePct !== null && relevant?.coveragePct !== undefined) {
    parts.push({ key: 'relevantPages', label: 'Relevant Page Coverage', weight: READINESS_WEIGHTS.relevantPages, coveragePct: relevant.coveragePct })
  }
  const service = params.metrics.find(m => m.key === 'service')
  if (service?.coveragePct !== null && service?.coveragePct !== undefined) {
    parts.push({ key: 'serviceCoverage', label: 'Service Coverage', weight: READINESS_WEIGHTS.serviceCoverage, coveragePct: service.coveragePct })
  }

  const benchClusters = params.clusters.filter(c => c.competitorCoverage >= 2)
  if (benchClusters.length > 0) {
    const covered = benchClusters.filter(c => c.ourPages > 0).length
    parts.push({
      key: 'topicCoverage',
      label: 'Topic Coverage',
      weight: READINESS_WEIGHTS.topicCoverage,
      coveragePct: Math.round((covered / benchClusters.length) * 100),
    })
  }

  if (params.keywordGap.available) {
    const contested = params.keywordGap.rows.filter(r => r.competitorCoverage >= 1)
    if (contested.length > 0) {
      const held = contested.filter(r => r.ourPosition !== null && r.ourPosition <= 20).length
      parts.push({
        key: 'keywordCoverage',
        label: 'Keyword Coverage',
        weight: READINESS_WEIGHTS.keywordCoverage,
        coveragePct: Math.round((held / contested.length) * 100),
      })
    }
  }

  const ours = params.inventories.find(i => i.isOurs)
  const benchQuality = median(
    params.inventories.filter(i => !i.isOurs && i.comparable).map(i => i.contentQuality)
  ) ?? median(params.inventories.filter(i => !i.isOurs).map(i => i.contentQuality))
  if (ours?.contentQuality != null && benchQuality != null && benchQuality > 0) {
    parts.push({
      key: 'contentQuality',
      label: 'Content Quality',
      weight: READINESS_WEIGHTS.contentQuality,
      coveragePct: Math.min(100, Math.round((ours.contentQuality / benchQuality) * 100)),
    })
  }

  if (parts.length === 0) return { score: null, breakdown: [], biggestProblem: null }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0)
  const score = Math.round(parts.reduce((s, p) => s + p.coveragePct * p.weight, 0) / totalWeight)
  const worst = parts.slice().sort((a, b) => a.coveragePct - b.coveragePct)[0]

  return {
    score,
    breakdown: parts.map(p => ({ label: p.label, weight: p.weight, coveragePct: p.coveragePct })),
    biggestProblem: worst ? worst.label : null,
  }
}

// ── Phase 1 actions ──────────────────────────────────────────────────────────

const TYPE_URL_PREFIX: Partial<Record<PageType, string>> = {
  service: '/services/', product: '/products/', category: '/category/',
  location: '/locations/', route: '/routes/', industry: '/industries/',
  article: '/blog/', guide: '/guides/', 'case-study': '/case-studies/',
  tool: '/tools/', glossary: '/glossary/', landing: '/',
}

function recommendUrl(label: string, type: PageType): string {
  return `${TYPE_URL_PREFIX[type] ?? '/'}${slugify(label)}/`
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  a.forEach(t => { if (b.has(t)) inter++ })
  return inter / (a.size + b.size - inter)
}

/** เช็คหน้าเดิมก่อนเสมอ — กัน cannibalization และกันสั่งสร้างหน้าซ้ำเจตนาเดิม */
export function findExistingMatch(clusterTokens: string[], ourPages: PageRecord[]): PageRecord | null {
  const target = new Set(clusterTokens)
  let best: PageRecord | null = null
  let bestScore = 0
  for (const p of ourPages) {
    if (!p.indexable) continue
    const set = new Set(tokens([p.title, p.h1, p.path.replace(/[-_/]+/g, ' ')].join(' ')))
    const s = jaccard(target, set)
    if (s > bestScore) { bestScore = s; best = p }
  }
  return bestScore >= 0.34 ? best : null
}

export interface BlockerInput {
  ours: DomainState
}

/** P0 = ปัญหาที่ทำให้ SEO เดินไม่ได้ ต้องมาก่อนงานคอนเทนต์เสมอ */
export function detectBlockers(ours: DomainState): GapAction[] {
  const actions: GapAction[] = []
  const add = (a: Omit<GapAction, 'id' | 'priority' | 'impact'>) => {
    actions.push({ ...a, id: `p0-${actions.length + 1}`, priority: 'P0', impact: 'Very High' })
  }

  const home = ours.pages.find(p => p.path === '/' || p.path === '')
  if (!home) {
    add({
      action: 'FIX', title: 'ระบบเข้าถึงหน้าแรกของเว็บไม่ได้',
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: null, recommendedUrl: null,
      reason: 'crawler ดึงหน้าแรกไม่สำเร็จ ถ้า Googlebot เจอสภาพเดียวกันคือปัญหาระดับสูงสุด',
      evidence: [`crawl สำเร็จ ${ours.coverage.ok} หน้า, error ${ours.coverage.errors}, ถูกบล็อก ${ours.coverage.blocked}`],
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  } else if (home.status !== 200) {
    add({
      action: 'FIX', title: `หน้าแรกตอบ HTTP ${home.status}`,
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: 'homepage', competitorCoverage: null, existingUrl: home.url, recommendedUrl: null,
      reason: 'หน้าแรกต้องตอบ 200 เสมอ',
      evidence: [`${home.url} → HTTP ${home.status}`],
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  if (ours.coverage.robotsBlockedRoot) {
    add({
      action: 'FIX', title: 'robots.txt ปิดทั้งเว็บ',
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: `https://${ours.domain}/robots.txt`, recommendedUrl: null,
      reason: 'มีบรรทัด Disallow: / ที่ผลกับ user-agent ทั่วไป — หน้าใหม่ทั้งหมดจะไม่ถูกเก็บ',
      evidence: ['robots.txt: Disallow: / (user-agent *)'],
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  const noindexed = ours.pages.filter(p => p.nonIndexableReason === 'meta robots noindex' && p.relevanceScore > 0.1)
  if (noindexed.length > 0) {
    add({
      action: 'FIX', title: `${noindexed.length} หน้าที่เกี่ยวข้องถูกตั้ง noindex`,
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: noindexed[0].url, recommendedUrl: null,
      reason: 'หน้าที่ควรแข่งขันถูกสั่งไม่ให้ index — แก้ก่อนลงทุนทำคอนเทนต์เพิ่ม',
      evidence: noindexed.slice(0, 5).map(p => p.url),
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  const serverErrors = ours.pages.filter(p => p.status >= 500)
  if (serverErrors.length > 0) {
    add({
      action: 'FIX', title: `${serverErrors.length} หน้าตอบ 5xx`,
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: serverErrors[0].url, recommendedUrl: null,
      reason: 'หน้าที่ error ระดับเซิร์ฟเวอร์จะถูกถอดออกจากดัชนี',
      evidence: serverErrors.slice(0, 5).map(p => `${p.url} → ${p.status}`),
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  const isPaginated = (u: string) => /\/page\/\d+|[?&][^=]*page[^=]*=\d+/i.test(u)
  const badCanonical = ours.pages.filter(p =>
    p.nonIndexableReason === 'canonical ชี้ไปหน้าอื่น' &&
    p.relevanceScore > 0.15 &&
    !isPaginated(p.url)      // หน้าแบ่งหน้าที่ canonical กลับไปหน้าแรกคือการตั้งค่าปกติ
  )
  if (badCanonical.length >= 3) {
    add({
      action: 'FIX', title: `${badCanonical.length} หน้าตั้ง canonical ชี้ออกไปหน้าอื่น`,
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: badCanonical[0].url, recommendedUrl: null,
      reason: 'canonical ผิดทำให้หน้าที่ควรติดอันดับถูกยุบรวมไปหน้าอื่น',
      evidence: badCanonical.slice(0, 5).map(p => `${p.url} → ${p.canonical}`),
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  if (ours.coverage.sitemapUrls === 0) {
    add({
      action: 'FIX', title: 'ไม่พบ sitemap.xml',
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [], searchIntent: null,
      pageType: null, competitorCoverage: null, existingUrl: `https://${ours.domain}/sitemap.xml`, recommendedUrl: null,
      reason: 'ไม่มี sitemap ทำให้หน้าลึกถูกค้นพบช้าและวัดความครอบคลุมไม่ได้',
      evidence: ['ลองตำแหน่งมาตรฐานแล้วไม่พบไฟล์ sitemap ที่อ่านได้'],
      topicsToCover: [], internalLinks: [], differentiation: null,
    })
  }

  return actions
}

export interface Phase1Input {
  ours: DomainState
  clusters: TopicCluster[]
  keywordGap: KeywordGapResult
  inventories: DomainInventory[]
  benchmark: QualityBenchmark
  competitorDomains: string[]
}

const LIMITS: Record<Priority, number> = { P0: 12, P1: 25, P2: 30, P3: 15 }

export function buildPhase1Actions(input: Phase1Input): GapAction[] {
  const actions: GapAction[] = detectBlockers(input.ours)
  const ourPages = input.ours.pages
  const usedUrls = new Set<string>()
  const usedClusters = new Set<string>()

  const benchQuality = median(
    input.inventories.filter(i => !i.isOurs && i.comparable).map(i => i.contentQuality)
  ) ?? median(input.inventories.filter(i => !i.isOurs).map(i => i.contentQuality))

  const kwRows = input.keywordGap.rows
  const pickKeyword = (clusterTokens: string[]): { keyword: string | null; volume: number | null; intent: string | null; secondary: string[] } => {
    const target = new Set(clusterTokens)
    const scored = kwRows
      .map(r => ({ r, s: jaccard(target, new Set(tokens(r.keyword))) }))
      .filter(x => x.s >= 0.2)
      .sort((a, b) => (b.r.searchVolume ?? 0) - (a.r.searchVolume ?? 0) || b.s - a.s)
    if (scored.length === 0) return { keyword: null, volume: null, intent: null, secondary: [] }
    return {
      keyword: scored[0].r.keyword,
      volume: scored[0].r.searchVolume,
      intent: scored[0].r.intent,
      secondary: scored.slice(1, 5).map(x => x.r.keyword),
    }
  }

  const push = (a: Omit<GapAction, 'id'>) => {
    const count = actions.filter(x => x.priority === a.priority).length
    if (count >= LIMITS[a.priority]) return
    actions.push({ ...a, id: `${a.priority.toLowerCase()}-${actions.length + 1}` })
  }

  // 1) NEAR WIN — หน้าเดิมที่อยู่อันดับ 11–20 ดันขึ้นก่อน ถูกที่สุดและเร็วที่สุด
  const nearWins = kwRows.filter(r => r.state === 'NEAR_WIN' && r.ourUrl)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 10)
  for (const r of nearWins) {
    if (!r.ourUrl || usedUrls.has(r.ourUrl)) continue
    usedUrls.add(r.ourUrl)
    const page = ourPages.find(p => p.url === r.ourUrl) ?? null
    push({
      priority: 'P1', action: 'UPGRADE',
      title: `ดันหน้าเดิมที่จ่ออันดับ 1 หน้าแรก: ${page?.title || r.ourUrl}`,
      primaryKeyword: r.keyword, primaryKeywordVolume: r.searchVolume,
      secondaryKeywords: [], searchIntent: r.intent, pageType: page?.pageType ?? null,
      competitorCoverage: `${r.competitorCoverage}/${input.competitorDomains.length}`,
      existingUrl: r.ourUrl, recommendedUrl: r.ourUrl,
      reason: 'หน้านี้ติดอันดับ 11–20 อยู่แล้ว การปรับให้ตรงเจตนาค้นหาและเพิ่มความลึกใช้แรงน้อยกว่าสร้างหน้าใหม่',
      evidence: [
        `อันดับเรา: ${r.ourPosition}`,
        r.bestCompetitorPosition !== null ? `คู่แข่งที่ดีที่สุด: อันดับ ${r.bestCompetitorPosition}` : 'ไม่มีข้อมูลอันดับคู่แข่งของคำนี้',
        r.searchVolume !== null ? `ปริมาณค้นหา: ${r.searchVolume}` : 'ไม่มีข้อมูลปริมาณค้นหา',
      ],
      topicsToCover: page?.h2.slice(0, 5) ?? [], internalLinks: [], differentiation: null,
      impact: 'Very High',
    })
  }

  // 2) หัวข้อที่คู่แข่งมีซ้ำ ๆ แต่เราไม่มี — ต้องเช็คหน้าเดิมก่อนว่าจะ CREATE หรือ UPGRADE
  const missing = input.clusters
    .filter(c => c.state === 'missing' && c.competitorCoverage >= 2)
    .sort((a, b) => b.competitorCoverage - a.competitorCoverage || b.medianPages - a.medianPages)

  for (const c of missing) {
    if (usedClusters.has(c.id)) continue
    const existing = findExistingMatch(c.tokens, ourPages)
    const kw = pickKeyword(c.tokens)
    const commercial = isCommercialType(c.dominantType)
    const priority: Priority = c.competitorCoverage >= 3 && commercial ? 'P1'
      : c.competitorCoverage >= 3 ? 'P2'
      : commercial ? 'P2' : 'P3'
    const coverageLabel = `${c.competitorCoverage}/${c.comparableCount}`

    if (existing && !usedUrls.has(existing.url)) {
      usedUrls.add(existing.url)
      usedClusters.add(c.id)
      push({
        priority, action: 'UPGRADE',
        title: `ยกระดับหน้าเดิมให้ครอบคลุมหัวข้อ: ${c.label}`,
        primaryKeyword: kw.keyword ?? c.label, primaryKeywordVolume: kw.volume,
        secondaryKeywords: kw.secondary, searchIntent: kw.intent, pageType: existing.pageType,
        competitorCoverage: coverageLabel, existingUrl: existing.url, recommendedUrl: existing.url,
        reason: 'เว็บเรามีหน้าที่ตอบเจตนาเดียวกันอยู่แล้ว — ยกระดับหน้าเดิม ห้ามสร้าง URL ใหม่ซ้ำหัวข้อ (กันแย่งอันดับกันเอง)',
        evidence: [
          `คู่แข่งเทียบเคียงที่มีหัวข้อนี้: ${coverageLabel}`,
          `median จำนวนหน้าของคู่แข่งในหัวข้อนี้: ${c.medianPages}`,
          `หน้าเดิมของเรา: ${existing.url}`,
        ],
        topicsToCover: c.sampleTitles.slice(0, 4), internalLinks: [], differentiation: null,
        impact: priority === 'P1' ? 'Very High' : 'Medium',
      })
      continue
    }

    usedClusters.add(c.id)
    // คู่แข่งวางหน้างานบริการไว้ใต้ /products/ ได้ แต่หน้าที่เราควรสร้างคือหน้าบริการ
    const createType: PageType =
      labelLooksLikeService(c.label) && (c.dominantType === 'product' || c.dominantType === 'category')
        ? 'service'
        : c.dominantType
    push({
      priority, action: 'CREATE',
      title: c.label,
      primaryKeyword: kw.keyword ?? c.label, primaryKeywordVolume: kw.volume,
      secondaryKeywords: kw.secondary, searchIntent: kw.intent, pageType: createType,
      competitorCoverage: coverageLabel, existingUrl: null,
      // slug มาจากหัวข้อของคลัสเตอร์เสมอ — ถ้าใช้คีย์เวิร์ดหลักของรอบสแกน URL จะไม่ตรงกับหน้าที่แนะนำ
      recommendedUrl: recommendUrl(c.label, createType),
      reason: `คู่แข่งเทียบเคียง ${coverageLabel} มีหน้าในหัวข้อนี้ แต่เว็บเรายังไม่มีหน้าที่ตอบเจตนานี้`,
      evidence: [
        `คู่แข่งเทียบเคียงที่มีหัวข้อนี้: ${coverageLabel}`,
        `median จำนวนหน้าในหัวข้อนี้: ${c.medianPages}`,
        'ค้นหน้าเดิมของเราแล้วไม่พบหน้าที่ตอบเจตนาเดียวกัน',
      ],
      topicsToCover: c.sampleTitles.slice(0, 4), internalLinks: [], differentiation: null,
      impact: priority === 'P1' ? 'Very High' : priority === 'P2' ? 'Medium' : 'Low',
    })
  }

  // 3) หัวข้อที่เรามีแต่บางกว่ามาตรฐาน
  const weakClusters = input.clusters
    .filter(c => c.state === 'weak' && c.competitorCoverage >= 2 && c.ourUrls.length > 0)
    .sort((a, b) => b.competitorCoverage - a.competitorCoverage)
  for (const c of weakClusters) {
    const url = c.ourUrls.find(u => !usedUrls.has(u))
    if (!url) continue
    usedUrls.add(url)
    const kw = pickKeyword(c.tokens)
    push({
      priority: isCommercialType(c.dominantType) ? 'P1' : 'P2', action: 'UPGRADE',
      title: `เพิ่มความครอบคลุมหัวข้อ: ${c.label}`,
      primaryKeyword: kw.keyword ?? c.label, primaryKeywordVolume: kw.volume,
      secondaryKeywords: kw.secondary, searchIntent: kw.intent, pageType: c.dominantType,
      competitorCoverage: `${c.competitorCoverage}/${c.comparableCount}`,
      existingUrl: url, recommendedUrl: url,
      reason: 'มีหน้าอยู่แล้วแต่ครอบคลุมน้อยกว่ามาตรฐานตลาด — ขยายหน้าเดิมคุ้มกว่าสร้างใหม่',
      evidence: [`หน้าของเราในหัวข้อนี้: ${c.ourPages}`, `median ของคู่แข่ง: ${c.medianPages}`],
      topicsToCover: c.sampleTitles.slice(0, 4), internalLinks: [], differentiation: null,
      impact: 'High',
    })
  }

  // 4) หน้าที่คุณภาพต่ำกว่ามาตรฐานอย่างมีนัย
  if (benchQuality != null) {
    const weakPages = ourPages
      .filter(p => p.relevant && p.indexable && p.qualityScore !== null && p.qualityScore < benchQuality - 10 && !usedUrls.has(p.url))
      .sort((a, b) => (a.qualityScore ?? 0) - (b.qualityScore ?? 0))
      .slice(0, 10)
    for (const p of weakPages) {
      usedUrls.add(p.url)
      const weak = weaknessesFrom(p.qualityDims ?? {})
      push({
        priority: isCommercialType(p.pageType) ? 'P1' : 'P2', action: 'UPGRADE',
        title: `ยกคุณภาพหน้า: ${p.title || p.path}`,
        primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [],
        searchIntent: null, pageType: p.pageType,
        competitorCoverage: null, existingUrl: p.url, recommendedUrl: p.url,
        reason: `คะแนนคุณภาพเนื้อหา ${p.qualityScore} ต่ำกว่า median ของคู่แข่ง (${benchQuality})`,
        evidence: [
          `คะแนนของหน้านี้: ${p.qualityScore}/100`,
          `median คู่แข่ง: ${benchQuality}/100`,
          weak.length ? `จุดอ่อน: ${weak.join(', ')}` : 'ไม่พบมิติที่ต่ำกว่าเกณฑ์ชัดเจน',
        ],
        topicsToCover: [], internalLinks: [], differentiation: null,
        impact: 'High',
      })
    }
  }

  // 5) REFRESH — เนื้อหาเก่ากว่ามาตรฐานตลาดชัดเจน
  if (input.benchmark.medianAgeDays !== null) {
    const cutoff = input.benchmark.medianAgeDays * 2
    const stale = ourPages
      .filter(p => {
        if (!p.relevant || !p.indexable || usedUrls.has(p.url)) return false
        const d = p.modifiedDate ?? p.publishedDate
        if (!d) return false
        return (Date.now() - new Date(d).getTime()) / 86_400_000 > cutoff
      })
      .slice(0, 8)
    for (const p of stale) {
      usedUrls.add(p.url)
      const d = p.modifiedDate ?? p.publishedDate!
      const ageDays = Math.round((Date.now() - new Date(d).getTime()) / 86_400_000)
      push({
        priority: 'P2', action: 'REFRESH',
        title: `อัปเดตเนื้อหา: ${p.title || p.path}`,
        primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [],
        searchIntent: null, pageType: p.pageType, competitorCoverage: null,
        existingUrl: p.url, recommendedUrl: p.url,
        reason: 'เนื้อหาเก่ากว่ามาตรฐานความสดของตลาดเกิน 2 เท่า',
        evidence: [`อัปเดตล่าสุด ${ageDays} วันก่อน`, `median ของตลาด ${Math.round(input.benchmark.medianAgeDays)} วัน`],
        topicsToCover: [], internalLinks: [], differentiation: null,
        impact: 'Medium',
      })
    }
  }

  // 6) Internal linking — หน้าที่เกี่ยวข้องแต่ลิงก์ภายในน้อยกว่ามาตรฐานมาก
  const linkBench = input.benchmark.medianInternalLinks
  const thin = ourPages
    .filter(p => p.relevant && p.indexable && p.internalLinks < linkBench * 0.5 && !usedUrls.has(p.url))
    .sort((a, b) => a.internalLinks - b.internalLinks)
    .slice(0, 8)
  for (const p of thin) {
    usedUrls.add(p.url)
    push({
      priority: 'P2', action: 'UPGRADE',
      title: `เพิ่มลิงก์ภายในให้หน้า: ${p.title || p.path}`,
      primaryKeyword: null, primaryKeywordVolume: null, secondaryKeywords: [],
      searchIntent: null, pageType: p.pageType, competitorCoverage: null,
      existingUrl: p.url, recommendedUrl: p.url,
      reason: 'ลิงก์ภายในน้อยกว่ามาตรฐานตลาดมาก ทำให้หน้านี้ได้รับน้ำหนักจากเว็บตัวเองต่ำ',
      evidence: [`ลิงก์ภายในของหน้านี้: ${p.internalLinks}`, `median ตลาด: ${Math.round(linkBench)}`],
      topicsToCover: [], internalLinks: [], differentiation: null,
      impact: 'Medium',
    })
  }

  // 7) MERGE — หลายหน้าของเราชนหัวข้อเดียวกันเกินมาตรฐาน
  for (const c of input.clusters) {
    if (c.ourPages >= 3 && c.medianPages > 0 && c.ourPages > c.medianPages * 1.5) {
      push({
        priority: 'P2', action: 'MERGE',
        title: `รวมหน้าที่ชนหัวข้อเดียวกัน: ${c.label}`,
        primaryKeyword: c.label, primaryKeywordVolume: null, secondaryKeywords: [],
        searchIntent: null, pageType: c.dominantType, competitorCoverage: `${c.competitorCoverage}/${c.comparableCount}`,
        existingUrl: c.ourUrls[0] ?? null, recommendedUrl: c.ourUrls[0] ?? null,
        reason: 'เรามีหน้าในหัวข้อนี้มากกว่ามาตรฐานตลาดอย่างชัดเจน เสี่ยงแย่งอันดับกันเอง',
        evidence: [`หน้าของเรา: ${c.ourPages}`, `median คู่แข่ง: ${c.medianPages}`, ...c.ourUrls.slice(0, 4)],
        topicsToCover: [], internalLinks: [], differentiation: null,
        impact: 'Medium',
      })
    }
  }

  const order: Priority[] = ['P0', 'P1', 'P2', 'P3']
  const actionRank: Record<string, number> = { FIX: 0, UPGRADE: 1, CREATE: 2, MERGE: 3, REFRESH: 4, REVIEW: 5, KEEP: 6 }
  return actions.sort((a, b) =>
    order.indexOf(a.priority) - order.indexOf(b.priority) ||
    actionRank[a.action] - actionRank[b.action] ||
    (b.primaryKeywordVolume ?? 0) - (a.primaryKeywordVolume ?? 0)
  )
}

/**
 * คาดการณ์ความครอบคลุมหลังทำ Phase 1 — คำนวณจาก "ช่องว่างที่แผนนี้ปิดจริง" เท่านั้น
 * ไม่ใช่ตัวเลขที่ตั้งขึ้นเอง
 */
export function projectCoverage(params: {
  readiness: ReadinessResult
  clusters: TopicCluster[]
  actions: GapAction[]
  keywordGap: KeywordGapResult
}): number | null {
  if (params.readiness.score === null) return null
  const closedClusters = new Set(
    params.actions.filter(a => a.action === 'CREATE' || a.action === 'UPGRADE').map(a => a.title)
  )
  const bench = params.clusters.filter(c => c.competitorCoverage >= 2)
  if (bench.length === 0) return params.readiness.score

  const coveredNow = bench.filter(c => c.ourPages > 0).length
  const willCover = bench.filter(c => c.ourPages === 0 && (closedClusters.has(c.label) || closedClusters.has(`ยกระดับหน้าเดิมให้ครอบคลุมหัวข้อ: ${c.label}`))).length
  const topicAfter = Math.round(((coveredNow + willCover) / bench.length) * 100)

  const parts = params.readiness.breakdown.map(p =>
    p.label === 'Topic Coverage' ? { ...p, coveragePct: Math.max(p.coveragePct, topicAfter) } : p
  )
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0)
  if (totalWeight === 0) return params.readiness.score
  return Math.round(parts.reduce((s, p) => s + p.coveragePct * p.weight, 0) / totalWeight)
}

export function summarizeCounts(actions: GapAction[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const a of actions) {
    counts[a.priority] = (counts[a.priority] ?? 0) + 1
    counts[`${a.priority}_${a.action}`] = (counts[`${a.priority}_${a.action}`] ?? 0) + 1
    counts[a.action] = (counts[a.action] ?? 0) + 1
  }
  counts.total = actions.length
  return counts
}

export { DIM_LABELS }
