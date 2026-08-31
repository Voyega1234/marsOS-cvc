/**
 * Competitor Gap — ชั้น AI สำหรับ "ตีความ" เท่านั้น
 *
 * ตัวเลขทุกตัว (จำนวนหน้า, อันดับ, ปริมาณค้นหา, คะแนนคุณภาพ, สถานะ HTTP) ถูกคำนวณจากข้อมูลจริง
 * ก่อนถึง AI แล้ว AI มีหน้าที่อธิบายเหตุผล/มุมเนื้อหา/ลำดับความสำคัญเชิงคุณภาพเท่านั้น
 * และผลลัพธ์จาก AI ถูกกรองก่อนใช้เสมอ (เช่น internal link ต้องเป็น URL ที่ crawl เจอจริง)
 */

import type { ORUsage } from '@/lib/openrouter'
import { addUsage, askJson, emptyUsage } from './ai'
import type {
  CompetitorSummary, DomainInventory, DomainState, GapAction, KeywordGapResult,
  MetricRow, PageRecord, SurpassIdea, TopicCluster,
} from './types'
import { weaknessesFrom } from './quality'

const MAX_ENRICH = 24

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// ── Phase 1: อธิบายเหตุผลและมุมเนื้อหาของแต่ละงาน ────────────────────────────

interface EnrichItem {
  id: string
  reason?: string
  searchIntent?: string
  secondaryKeywords?: string[]
  topicsToCover?: string[]
  internalLinks?: string[]
  differentiation?: string
}

export async function enrichPhase1(params: {
  actions: GapAction[]
  keyword: string
  ourDomain: string
  ourPages: PageRecord[]
  metrics: MetricRow[]
  readiness: number | null
}): Promise<{ usage: ORUsage; summary: string | null; error: string | null }> {
  const targets = params.actions.filter(a => a.priority !== 'P3').slice(0, MAX_ENRICH)
  if (targets.length === 0) return { usage: emptyUsage(), summary: null, error: null }

  // ตัวเลือก internal link = หน้าเราที่มีจริงเท่านั้น (AI เลือกจากลิสต์นี้ ห้ามคิด URL เอง)
  const linkPool = params.ourPages
    .filter(p => p.indexable && p.relevant)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 40)
  const linkIndex = new Map(linkPool.map(p => [p.url, p]))
  const linkList = linkPool.map(p => `${p.url} — ${trim(p.title || p.path, 70)}`).join('\n')

  const items = targets.map(a => ({
    id: a.id,
    priority: a.priority,
    action: a.action,
    title: trim(a.title, 120),
    pageType: a.pageType,
    primaryKeyword: a.primaryKeyword,
    searchVolume: a.primaryKeywordVolume,
    competitorCoverage: a.competitorCoverage,
    existingUrl: a.existingUrl,
    evidence: a.evidence.slice(0, 3).map(e => trim(e, 120)),
    marketExamples: a.topicsToCover.slice(0, 4).map(t => trim(t, 80)),
  }))

  const metricLines = params.metrics
    .filter(m => m.ours !== null && m.median !== null)
    .map(m => `${m.label}: เรา ${m.ours} · median คู่แข่ง ${m.median} · coverage ${m.coveragePct}%`)
    .join('\n')

  const res = await askJson<{ summary?: string; items?: EnrichItem[] }>({
    system:
      'คุณคือ Senior SEO Strategist ทำงานกับข้อมูลที่วัดมาแล้วเท่านั้น ' +
      'ห้ามสร้างตัวเลขใหม่ทุกชนิด (traffic, ปริมาณค้นหา, อันดับ, จำนวนหน้า, วันที่, สถานะ HTTP) ' +
      'ห้ามแนะนำให้ "ทำหน้าเยอะกว่าคู่แข่ง" ตอบภาษาไทย กระชับ เป็นรูปธรรม ตอบ JSON เท่านั้น',
    user: `คีย์เวิร์ดเป้าหมาย: ${params.keyword}
เว็บของเรา: ${params.ourDomain}
คะแนนความพร้อมแข่งขันที่วัดได้: ${params.readiness ?? 'ไม่มีข้อมูล'}

ภาพรวมเทียบ Top 5 (median):
${metricLines || '(ไม่มีข้อมูลเปรียบเทียบ)'}

หน้าที่มีอยู่จริงบนเว็บเรา (ใช้เลือก internal link เท่านั้น ห้ามคิด URL ใหม่):
${linkList || '(ไม่พบหน้าที่เกี่ยวข้อง)'}

รายการงานที่ระบบคำนวณไว้แล้ว (ห้ามเพิ่ม/ลบงาน แค่เติมคำอธิบาย):
${JSON.stringify(items, null, 1)}

ตอบ JSON:
{"summary":"สรุป 2-3 ประโยคว่าตอนนี้เว็บเราขาดอะไรถึงยังไม่เท่า Top 5 และงานชุดนี้แก้อะไร",
 "items":[{"id":"...","reason":"ทำไมงานนี้จำเป็นเชิงการแข่งขัน 1-2 ประโยค","searchIntent":"transactional|commercial|informational|navigational","secondaryKeywords":["..."],"topicsToCover":["หัวข้อย่อยที่หน้านี้ต้องมี"],"internalLinks":["URL จากลิสต์ด้านบนเท่านั้น"],"differentiation":"มุมที่ทำให้หน้านี้ดีกว่าของคู่แข่งโดยไม่ลอก"}]}`,
    maxTokens: 6000,
  })

  if (!res.data) return { usage: res.usage, summary: null, error: res.error }

  const byId = new Map(targets.map(a => [a.id, a]))
  for (const item of res.data.items ?? []) {
    const a = byId.get(String(item.id))
    if (!a) continue
    if (typeof item.reason === 'string' && item.reason.trim()) a.reason = item.reason.trim()
    if (typeof item.searchIntent === 'string' && !a.searchIntent) a.searchIntent = item.searchIntent.trim()
    if (Array.isArray(item.secondaryKeywords) && a.secondaryKeywords.length === 0) {
      a.secondaryKeywords = item.secondaryKeywords.filter(k => typeof k === 'string').slice(0, 6)
    }
    if (Array.isArray(item.topicsToCover) && item.topicsToCover.length) {
      a.topicsToCover = item.topicsToCover.filter(t => typeof t === 'string').slice(0, 8)
    }
    if (Array.isArray(item.internalLinks)) {
      // กันโมเดลแต่ง URL: เก็บเฉพาะที่ crawl เจอจริง
      a.internalLinks = item.internalLinks
        .filter(u => typeof u === 'string' && linkIndex.has(u) && u !== a.existingUrl)
        .slice(0, 5)
    }
    if (typeof item.differentiation === 'string' && item.differentiation.trim()) {
      a.differentiation = item.differentiation.trim()
    }
  }

  const summary = typeof res.data.summary === 'string' && res.data.summary.trim()
    ? res.data.summary.trim()
    : null
  return { usage: res.usage, summary, error: null }
}

// ── คู่แข่งรายเจ้า + Phase 2 ─────────────────────────────────────────────────

function competitorFacts(d: DomainState, inv: DomainInventory, clusters: TopicCluster[]) {
  const idx = clusters
    .map(c => ({ label: c.label, n: c.competitorPages }))
  const topTopics = clusters
    .filter(c => c.sampleTitles.length > 0)
    .slice(0, 40)
  const weakPages = d.pages
    .filter(p => p.relevant && p.qualityDims)
    .map(p => ({ url: p.url, score: p.qualityScore, weak: weaknessesFrom(p.qualityDims ?? {}) }))
    .filter(p => p.weak.length > 0)
    .slice(0, 8)
  return {
    domain: d.domain,
    serpPosition: d.serpPosition,
    kind: d.kind,
    comparable: d.comparable,
    relevantPages: inv.relevant,
    totalIndexablePages: inv.totalIndexable,
    contentQuality: inv.contentQuality,
    organicKeywords: inv.organicKeywords,
    estimatedTraffic: inv.estimatedTraffic,
    pageTypes: Object.entries(inv.byType).filter(([, n]) => n > 0).map(([t, n]) => `${t}:${n}`),
    coverageConfidence: d.coverage.confidence,
    weakSpots: weakPages,
    _idx: idx,
    _topTopics: topTopics,
  }
}

export async function summarizeCompetitors(params: {
  keyword: string
  ourDomain: string
  ourInventory: DomainInventory | null
  competitors: { state: DomainState; inventory: DomainInventory; topClusters: string[] }[]
  clusters: TopicCluster[]
}): Promise<{ usage: ORUsage; summaries: Record<string, Partial<CompetitorSummary>>; error: string | null }> {
  if (params.competitors.length === 0) {
    return { usage: emptyUsage(), summaries: {}, error: null }
  }

  const payload = params.competitors.map(c => {
    const f = competitorFacts(c.state, c.inventory, params.clusters)
    return {
      domain: f.domain,
      serpPosition: f.serpPosition,
      kind: f.kind,
      relevantPages: f.relevantPages,
      totalIndexablePages: f.totalIndexablePages,
      contentQuality: f.contentQuality,
      organicKeywords: f.organicKeywords,
      estimatedTraffic: f.estimatedTraffic,
      pageTypes: f.pageTypes,
      topTopics: c.topClusters.slice(0, 10),
      weakSpots: f.weakSpots.map(w => `${w.url} (คะแนน ${w.score}) จุดอ่อน: ${w.weak.join(', ')}`),
      coverageConfidence: f.coverageConfidence,
    }
  })

  const ourLine = params.ourInventory
    ? `เว็บเรา ${params.ourDomain}: หน้าที่เกี่ยวข้อง ${params.ourInventory.relevant}, หน้าที่ index ได้ ${params.ourInventory.totalIndexable}, คุณภาพ ${params.ourInventory.contentQuality ?? '—'}`
    : `เว็บเรา ${params.ourDomain}: ไม่มีข้อมูล`

  const res = await askJson<{ competitors?: Array<Record<string, string>> }>({
    system:
      'คุณคือ Senior SEO Strategist วิเคราะห์คู่แข่งจากข้อมูลที่วัดมาแล้วเท่านั้น ' +
      'ห้ามแต่งตัวเลขหรืออ้างข้อมูลที่ไม่ได้ให้มา ห้ามแนะนำให้ลอกคู่แข่ง ตอบภาษาไทย สั้น ตรง JSON เท่านั้น',
    user: `คีย์เวิร์ด: ${params.keyword}
${ourLine}

คู่แข่ง Top 5 (ข้อมูลจากการ crawl จริง):
${JSON.stringify(payload, null, 1)}

ตอบ JSON:
{"competitors":[{"domain":"...","whyTheyWin":"...","whereWeak":"...","whatToMatch":"สิ่งที่เราต้องมีให้ทันเพื่อเข้าสนามแข่ง","doNotCopy":"สิ่งที่ไม่ควรลอก","howToBeat":"ทางที่เราจะดีกว่าได้ในภายหลัง"}]}
แต่ละช่อง 1-2 ประโยค อ้างอิงเฉพาะตัวเลข/จุดอ่อนที่ให้มา`,
    maxTokens: 3500,
  })

  const out: Record<string, Partial<CompetitorSummary>> = {}
  for (const row of res.data?.competitors ?? []) {
    const domain = String(row.domain ?? '').trim()
    if (!domain) continue
    out[domain] = {
      whyTheyWin: row.whyTheyWin?.trim() || null,
      whereWeak: row.whereWeak?.trim() || null,
      whatToMatch: row.whatToMatch?.trim() || null,
      doNotCopy: row.doNotCopy?.trim() || null,
      howToBeat: row.howToBeat?.trim() || null,
    }
  }
  return { usage: res.usage, summaries: out, error: res.error }
}

export async function buildSurpassIdeas(params: {
  keyword: string
  ourDomain: string
  competitors: { state: DomainState; inventory: DomainInventory }[]
  clusters: TopicCluster[]
  keywordGap: KeywordGapResult
  competitorNotes: Record<string, Partial<CompetitorSummary>>
}): Promise<{ usage: ORUsage; ideas: SurpassIdea[]; summary: string | null; error: string | null }> {
  const weakness = params.competitors.map(c => {
    const note = params.competitorNotes[c.state.domain]
    const dims = c.state.pages
      .filter(p => p.relevant && p.qualityDims)
      .slice(0, 30)
      .flatMap(p => weaknessesFrom(p.qualityDims ?? {}))
    const freq: Record<string, number> = {}
    for (const d of dims) freq[d] = (freq[d] ?? 0) + 1
    const common = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n} หน้า)`)
    return {
      domain: c.state.domain,
      contentQuality: c.inventory.contentQuality,
      commonWeakness: common,
      note: note?.whereWeak ?? null,
    }
  })

  const uniqueOpps = params.keywordGap.rows
    .filter(r => r.state === 'UNIQUE_OPPORTUNITY' || (r.state === 'MISSING' && r.competitorCoverage <= 1))
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 15)
    .map(r => `${r.keyword} (volume ${r.searchVolume ?? '—'}, คู่แข่งครอบคลุม ${r.competitorCoverage})`)

  const thinTopics = params.clusters
    .filter(c => c.competitorCoverage <= 2 && c.medianPages <= 1)
    .slice(0, 15)
    .map(c => c.label)

  const res = await askJson<{ summary?: string; ideas?: Array<Record<string, string>> }>({
    system:
      'คุณคือ Head of SEO Strategy เสนอวิธี "ทำให้ดีกว่า Top 5" หลังจากที่งาน baseline ถูกวางแผนแยกไว้แล้ว ' +
      'กติกา: ห้ามเสนอ "ทำหน้าให้เยอะกว่าคู่แข่ง" ห้ามลอกคู่แข่ง ห้ามแต่งตัวเลข ทุกข้อต้องอิงจุดอ่อนที่ให้มาจริง ' +
      'ตอบภาษาไทย JSON เท่านั้น',
    user: `คีย์เวิร์ด: ${params.keyword}
เว็บเรา: ${params.ourDomain}

จุดอ่อนคู่แข่งที่วัดได้:
${JSON.stringify(weakness, null, 1)}

คีย์เวิร์ดที่คู่แข่งยังไม่จับ:
${uniqueOpps.join('\n') || '(ไม่มีข้อมูล)'}

หัวข้อที่ตลาดยังทำบาง:
${thinTopics.join(', ') || '(ไม่มีข้อมูล)'}

เสนอ 4-6 ไอเดีย ตอบ JSON:
{"summary":"1-2 ประโยคว่าโอกาสแซงอยู่ตรงไหน",
 "ideas":[{"title":"...","competitorWeakness":"จุดอ่อนที่ใช้ประโยชน์ (อ้างจากข้อมูลที่ให้)","userValue":"ผู้ใช้ได้อะไรเพิ่ม","whyDifferent":"ต่างจากคู่แข่งยังไง","seoOpportunity":"โอกาสเชิง SEO","effort":"Low|Medium|High"}]}`,
    maxTokens: 3000,
    temperature: 0.4,
  })

  const ideas: SurpassIdea[] = (res.data?.ideas ?? [])
    .filter(i => i && typeof i.title === 'string' && i.title.trim())
    .slice(0, 8)
    .map((i, n) => ({
      id: `surpass-${n + 1}`,
      title: i.title.trim(),
      competitorWeakness: i.competitorWeakness?.trim() || '—',
      userValue: i.userValue?.trim() || '—',
      whyDifferent: i.whyDifferent?.trim() || '—',
      seoOpportunity: i.seoOpportunity?.trim() || '—',
      effort: i.effort === 'Low' || i.effort === 'High' ? i.effort : 'Medium',
    }))

  return {
    usage: res.usage,
    ideas,
    summary: res.data?.summary?.trim() || null,
    error: res.error,
  }
}

export { addUsage, emptyUsage }
