/**
 * Competitor Gap — เครื่องเดินงานแบบเป็นเฟส
 *
 * หนึ่ง request = หนึ่งเฟส แล้วบันทึก checkpoint ลง AppSetting
 * (รูปแบบเดียวกับ Local Keyword Research ที่ระบบใช้อยู่ — ไม่สร้าง job framework ตัวที่สอง)
 * ทำให้ทำงานจบได้ภายใต้ maxDuration ของ Vercel และ UI เห็นสถานะจริงทีละขั้นโดยไม่ต้องปั้น %
 *
 * ต้นทุนทุกบาททุกสตางค์ถูกบันทึกลง AIJob ด้วยตัวเลขจริง:
 *   - DataForSEO: ใช้ค่า cost ที่ API ตอบกลับมา
 *   - OpenRouter: ใช้ usage.cost ที่ API ตอบกลับมา
 *   - Crawler ของเราเอง: 0 USD แต่บันทึกจำนวนหน้าที่ดึงจริงไว้ให้ตรวจสอบได้
 */

import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS, type ORUsage } from '@/lib/openrouter'
import {
  buildMetrics, buildInventory, buildPhase1Actions, computeReadiness,
  projectCoverage, summarizeCounts,
} from './baseline'
import { aiClassifyAmbiguous } from './aiClassify'
import { buildSurpassIdeas, enrichPhase1, summarizeCompetitors } from './aiStrategy'
import { applyRuleClassification, buildVocabulary } from './classify'
import { crawlDomain } from './crawler'
import { attachDomainMetrics, buildKeywordGap, emptyKeywordGap, fetchRankedKeywords, type DomainKeywords } from './keywordGap'
import { resolveCountry } from './locations'
import { buildBenchmark } from './quality'
import { classifyDomain, fetchTopCompetitors, isComparable, isScannableDomain } from './serp'
import { getCache, hashKey, saveReport, saveRun, setCache, TTL } from './store'
import { buildClusters, nameClusters } from './topics'
import type {
  CompetitorSummary, DomainInventory, DomainState, GapReport, RunInput, RunState, RunStep,
} from './types'
import { toDomain, toOrigin } from './urls'

export interface RunContext {
  organizationId: string
  userId: string
  projectId: string
}

const BASE_STEPS: RunStep[] = [
  { id: 'serp',     label: 'ค้นหาคู่แข่ง Top 5 บน Google', status: 'pending' },
  { id: 'classify', label: 'จำแนกประเภทหน้าและคัดหน้าที่เกี่ยวข้อง', status: 'pending' },
  { id: 'topics',   label: 'จัดกลุ่มหัวข้อและหาช่องว่างเชิงหัวข้อ', status: 'pending' },
  { id: 'keywords', label: 'เทียบคีย์เวิร์ดกับคู่แข่ง', status: 'pending' },
  { id: 'baseline', label: 'คำนวณมาตรฐาน Top 5 (median)', status: 'pending' },
  { id: 'phase1',   label: 'สร้างแผน START HERE (Phase 1)', status: 'pending' },
  { id: 'phase2',   label: 'หาแนวทางแซง Top 5 (Phase 2)', status: 'pending' },
]

export function createRun(input: RunInput, runId: string): RunState {
  const now = new Date().toISOString()
  return {
    version: 1,
    runId,
    projectId: input.projectId,
    input,
    status: 'running',
    phase: 'serp',
    cursor: 0,
    steps: BASE_STEPS.map(s => ({ ...s })),
    serp: null,
    domains: [],
    clusters: [],
    keywordGap: null,
    report: null,
    costUsd: 0,
    warnings: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

function setStep(state: RunState, id: string, status: RunStep['status'], detail?: string) {
  const step = state.steps.find(s => s.id === id)
  if (step) {
    step.status = status
    if (detail !== undefined) step.detail = detail
  }
}

function insertCrawlSteps(state: RunState) {
  const crawlSteps: RunStep[] = state.domains.map(d => ({
    id: `crawl:${d.domain}`,
    label: d.isOurs ? `สแกนเว็บของเรา (${d.domain})` : `สแกนคู่แข่ง ${d.domain}`,
    status: 'pending',
  }))
  const at = state.steps.findIndex(s => s.id === 'classify')
  state.steps.splice(at < 0 ? state.steps.length : at, 0, ...crawlSteps)
}

async function logCost(ctx: RunContext, params: {
  jobType: string
  provider: string
  model: string
  ok: boolean
  aiUsage?: ORUsage
  externalCost?: number
  externalCalls?: number
  externalApi?: string
  summary: string
  error?: string
}) {
  await logAIJob({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    jobType: params.jobType,
    modelProvider: params.provider,
    modelName: params.model,
    status: params.ok ? 'SUCCESS' : 'FAILED',
    tokenUsed: params.aiUsage?.totalTokens,
    estimatedCost: params.aiUsage?.costUsd ?? 0,
    externalCost: params.externalCost ?? 0,
    externalCalls: params.externalCalls ?? 0,
    externalApi: params.externalApi,
    errorMessage: params.error,
    createdById: ctx.userId,
    inputSummary: params.summary,
  })
}

// ── เฟสต่าง ๆ ────────────────────────────────────────────────────────────────

async function phaseSerp(state: RunState, ctx: RunContext) {
  const country = resolveCountry(state.input.country)
  const take = Math.max(3, Math.min(5, state.input.advanced.competitorCount))
  setStep(state, 'serp', 'running')

  const cacheId = hashKey(`${state.input.keyword}|${country.locationCode}|${country.languageCode}|${take}`)
  const cached = await getCache<RunState['serp']>('serp', cacheId)

  let costUsd = 0
  let calls = 0
  if (cached?.data) {
    state.serp = cached.data
    setStep(state, 'serp', 'done', `ใช้ผล SERP ที่แคชไว้เมื่อ ${new Date(cached.savedAt).toLocaleString('th-TH')}`)
  } else {
    const fetched = await fetchTopCompetitors({
      keyword: state.input.keyword,
      locationCode: country.locationCode,
      languageCode: country.languageCode,
      depth: 10,
      take,
    })
    state.serp = fetched.result
    costUsd = fetched.costUsd
    calls = fetched.calls
    state.costUsd += costUsd
    await setCache('serp', cacheId, fetched.result, TTL.serp)
    await logCost(ctx, {
      jobType: 'competitor_gap_serp',
      provider: 'dataforseo',
      model: 'serp/google/organic/live/regular',
      ok: true,
      externalCost: costUsd,
      externalCalls: calls,
      externalApi: 'dataforseo',
      summary: `Competitor Gap SERP · keyword="${state.input.keyword}" · ${country.label} · depth 10`,
    })
    setStep(state, 'serp', 'done', `พบผลออร์แกนิก ${fetched.result.all.length} รายการ · เลือกมาสแกน ${fetched.result.top.length} เว็บ`)
  }

  const serp = state.serp!
  const ourOrigin = toOrigin(state.input.ourWebsite)
  const ourDomain = toDomain(state.input.ourWebsite)

  const domains: DomainState[] = [{
    isOurs: true,
    label: 'เว็บของเรา',
    domain: ourDomain,
    origin: ourOrigin,
    serpPosition: serp.all.find(e => e.domain === ourDomain)?.position ?? null,
    serpUrl: serp.all.find(e => e.domain === ourDomain)?.url ?? null,
    kind: 'business',
    comparable: true,
    pages: [],
    coverage: emptyCoverage(),
    organicKeywords: null,
    estimatedTraffic: null,
  }]

  // คู่แข่งที่ผู้ใช้ระบุเองมาก่อนเสมอ — ถ้าเว็บนั้นติด SERP อยู่แล้วก็ผูกอันดับจริงให้ด้วย
  const taken = new Set<string>([ourDomain])
  for (const raw of state.input.manualCompetitors ?? []) {
    const domain = toDomain(raw)
    if (!domain || taken.has(domain)) continue
    taken.add(domain)
    if (!isScannableDomain(domain)) {
      state.warnings.push(`ข้าม ${domain} ที่ระบุมา — เว็บนี้ปิดด้วยหน้าล็อกอิน สแกนเนื้อหาไม่ได้`)
      continue
    }
    const onSerp = serp.all.find(e => e.domain === domain) ?? null
    const kind = onSerp?.kind ?? classifyDomain(domain)
    domains.push({
      isOurs: false,
      manual: true,
      label: onSerp ? `ระบุเอง · อันดับ ${onSerp.position}` : 'ระบุเอง',
      domain,
      origin: onSerp ? toOrigin(onSerp.url) : toOrigin(raw),
      serpPosition: onSerp?.position ?? null,
      serpUrl: onSerp?.url ?? null,
      kind,
      comparable: isComparable(kind),
      pages: [],
      coverage: emptyCoverage(),
      organicKeywords: null,
      estimatedTraffic: null,
    })
  }

  // เติมจาก Google Top N ด้วยกระบวนการเดิมจนครบจำนวนคู่แข่งที่ตั้งไว้
  for (const entry of serp.top) {
    if (domains.length - 1 >= take) break
    if (taken.has(entry.domain)) continue            // เว็บเราหรือเว็บที่ผู้ใช้ระบุไว้แล้ว ไม่นับซ้ำ
    taken.add(entry.domain)
    domains.push({
      isOurs: false,
      manual: false,
      label: `อันดับ ${entry.position}`,
      domain: entry.domain,
      origin: toOrigin(entry.url),
      serpPosition: entry.position,
      serpUrl: entry.url,
      kind: entry.kind,
      comparable: isComparable(entry.kind),
      pages: [],
      coverage: emptyCoverage(),
      organicKeywords: null,
      estimatedTraffic: null,
    })
  }

  state.domains = domains
  insertCrawlSteps(state)
  state.phase = 'crawl'
  state.cursor = 0
}

function emptyCoverage(): DomainState['coverage'] {
  return {
    robotsFound: false, robotsBlockedRoot: false, sitemapUrls: 0, discovered: 0,
    crawled: 0, ok: 0, redirects: 0, nonIndexable: 0, blocked: 0, errors: 0,
    jsSuspected: 0, jsRendered: 0, truncated: false, confidence: 'low', notes: [],
  }
}

async function phaseCrawl(state: RunState, ctx: RunContext) {
  const d = state.domains[state.cursor]
  if (!d) { state.phase = 'classify'; return }

  const stepId = `crawl:${d.domain}`
  setStep(state, stepId, 'running')
  const budget = state.input.advanced.maxPagesPerDomain
  const cacheId = hashKey(`${d.domain}|${budget}|${state.input.advanced.jsFallback ? 1 : 0}`)

  try {
    const cached = await getCache<{ pages: DomainState['pages']; coverage: DomainState['coverage'] }>('crawl', cacheId)
    if (cached?.data) {
      d.pages = cached.data.pages
      d.coverage = cached.data.coverage
      setStep(state, stepId, 'done', `ใช้ผลสแกนที่แคชไว้เมื่อ ${new Date(cached.savedAt).toLocaleString('th-TH')} · ${d.coverage.ok} หน้า`)
    } else {
      const out = await crawlDomain(d.origin, d.domain, {
        budget,
        jsFallback: state.input.advanced.jsFallback,
      })
      d.pages = out.pages
      d.coverage = out.coverage
      await setCache('crawl', cacheId, out, TTL.crawl)
      await logCost(ctx, {
        jobType: 'competitor_gap_crawl',
        provider: 'marsos',
        model: 'self-hosted-http-crawler',
        ok: true,
        externalCost: 0,
        externalCalls: out.coverage.crawled,
        externalApi: 'self-hosted',
        summary: `Competitor Gap crawl · ${d.domain} · พบ ${out.coverage.discovered} URL · ดึง ${out.coverage.crawled} · สำเร็จ ${out.coverage.ok} · ความมั่นใจ ${out.coverage.confidence} · ไม่มีค่าใช้จ่าย API`,
      })
      setStep(state, stepId, 'done', `ดึง ${out.coverage.crawled} หน้า · ใช้ได้ ${out.coverage.ok} · ความครอบคลุม ${out.coverage.confidence}`)
    }
  } catch (e) {
    // คู่แข่งบล็อกหรือเว็บล่ม = ข้ามเจ้านั้น ไม่ล้มทั้งรายงาน
    const msg = e instanceof Error ? e.message : String(e)
    d.coverage.notes.push(`สแกนไม่สำเร็จ: ${msg}`)
    d.coverage.confidence = 'low'
    state.warnings.push(`สแกน ${d.domain} ไม่สำเร็จ: ${msg}`)
    setStep(state, stepId, 'failed', msg.slice(0, 160))
    await logCost(ctx, {
      jobType: 'competitor_gap_crawl',
      provider: 'marsos',
      model: 'self-hosted-http-crawler',
      ok: false,
      summary: `Competitor Gap crawl · ${d.domain}`,
      error: msg,
    })
  }

  state.cursor += 1
  if (state.cursor >= state.domains.length) {
    state.phase = 'classify'
    state.cursor = 0
  }
}

async function phaseClassify(state: RunState, ctx: RunContext) {
  setStep(state, 'classify', 'running')
  const keyword = state.input.keyword

  const marketTitles: string[] = []
  for (const d of state.domains) {
    if (d.isOurs) continue
    for (const p of d.pages) if (p.title) marketTitles.push(p.title)
  }
  const vocab = buildVocabulary(keyword, marketTitles)

  for (const d of state.domains) applyRuleClassification(d.pages, vocab)

  let usage: ORUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
  const errors: string[] = []
  let aiCount = 0
  for (const d of state.domains) {
    const res = await aiClassifyAmbiguous({ pages: d.pages, keyword, domainLabel: d.domain })
    usage = {
      inputTokens: usage.inputTokens + res.usage.inputTokens,
      outputTokens: usage.outputTokens + res.usage.outputTokens,
      totalTokens: usage.totalTokens + res.usage.totalTokens,
      costUsd: usage.costUsd + res.usage.costUsd,
    }
    aiCount += res.classified
    errors.push(...res.errors)
  }

  // ข้อความตัวอย่างใช้เฉพาะขั้นนี้ — ทิ้งเพื่อไม่ให้ state บวมและไม่ส่งต่อให้โมเดลถัดไป
  for (const d of state.domains) for (const p of d.pages) delete p.sample

  state.costUsd += usage.costUsd
  if (errors.length) state.warnings.push(...Array.from(new Set(errors)).slice(0, 3))
  await logCost(ctx, {
    jobType: 'competitor_gap_classify',
    provider: 'openrouter',
    model: OR_MODELS.default(),
    ok: errors.length === 0,
    aiUsage: usage,
    summary: `Competitor Gap classify · ${state.domains.length} โดเมน · AI จำแนก ${aiCount} หน้า (ที่เหลือใช้กฎ ไม่เสียค่า AI)`,
    error: errors[0],
  })

  const totalRelevant = state.domains.reduce((s, d) => s + d.pages.filter(p => p.relevant && p.indexable).length, 0)
  setStep(state, 'classify', 'done', `จำแนกด้วยกฎเป็นหลัก · ใช้ AI ${aiCount} หน้า · หน้าที่เกี่ยวข้องรวม ${totalRelevant}`)
  state.phase = 'topics'
}

async function phaseTopics(state: RunState, ctx: RunContext) {
  setStep(state, 'topics', 'running')
  state.clusters = buildClusters(state.domains)
  const named = await nameClusters(state.clusters, state.input.keyword)
  state.costUsd += named.usage.costUsd
  if (named.error) state.warnings.push(`ตั้งชื่อกลุ่มหัวข้อด้วย AI ไม่สำเร็จ: ${named.error}`)
  await logCost(ctx, {
    jobType: 'competitor_gap_topics',
    provider: 'openrouter',
    model: OR_MODELS.default(),
    ok: !named.error,
    aiUsage: named.usage,
    summary: `Competitor Gap topics · ${state.clusters.length} กลุ่มหัวข้อ · เรียก AI 1 ครั้งสำหรับตั้งชื่อทั้งชุด`,
    error: named.error ?? undefined,
  })

  const missing = state.clusters.filter(c => c.state === 'missing').length
  setStep(state, 'topics', 'done', `${state.clusters.length} กลุ่มหัวข้อ · ยังไม่มีบนเว็บเรา ${missing} กลุ่ม`)
  state.phase = 'keywords'
}

async function phaseKeywords(state: RunState, ctx: RunContext) {
  if (!state.input.advanced.includeKeywordGap) {
    state.keywordGap = emptyKeywordGap('ปิดการดึงข้อมูลคีย์เวิร์ดไว้ในตั้งค่าขั้นสูง')
    setStep(state, 'keywords', 'skipped', 'ปิดไว้ในตั้งค่าขั้นสูง')
    state.phase = 'baseline'
    return
  }

  setStep(state, 'keywords', 'running')
  const country = resolveCountry(state.input.country)
  const collected: DomainKeywords[] = []
  let cost = 0
  let calls = 0

  for (const d of state.domains) {
    const cacheId = hashKey(`${d.domain}|${country.locationCode}|${country.languageCode}`)
    const cached = await getCache<{ rows: [string, DomainKeywords['rows'] extends Map<string, infer V> ? V : never][]; organicKeywords: number | null; estimatedTraffic: number | null; note: string | null }>('kw', cacheId)
    if (cached?.data) {
      collected.push({
        domain: d.domain,
        rows: new Map(cached.data.rows),
        organicKeywords: cached.data.organicKeywords,
        estimatedTraffic: cached.data.estimatedTraffic,
        note: cached.data.note,
      })
      continue
    }
    const res = await fetchRankedKeywords(d.domain, country.locationCode, country.languageCode)
    cost += res.costUsd
    calls += 1
    collected.push(res.data)
    const rows: [string, unknown][] = []
    res.data.rows.forEach((v, k) => rows.push([k, v]))
    await setCache('kw', cacheId, {
      rows,
      organicKeywords: res.data.organicKeywords,
      estimatedTraffic: res.data.estimatedTraffic,
      note: res.data.note,
    }, TTL.keywords)
  }

  state.costUsd += cost
  attachDomainMetrics(state.domains, collected)
  const ours = collected[0]
  // คลังคำสำหรับกรองคีย์เวิร์ดนอกธุรกิจ — ใช้เฉพาะหัวข้อที่อยู่ในเรื่องจริง:
  // ชื่อผลลัพธ์บน SERP ของคีย์เวิร์ดเป้าหมาย + หน้าที่ผ่านเกณฑ์ความเกี่ยวข้องแล้ว
  // (ถ้าใช้ทุกหน้าของคู่แข่ง โดเมนแบบ marketplace จะลากคำนอกเรื่องเข้ามาทั้งกอง)
  const topicTitles: string[] = []
  for (const e of state.serp?.all ?? []) if (e.title) topicTitles.push(e.title)
  for (const d of state.domains) {
    for (const pg of d.pages) if (pg.relevant && pg.title) topicTitles.push(pg.title)
  }
  const vocab = buildVocabulary(state.input.keyword, topicTitles)

  state.keywordGap = ours
    ? buildKeywordGap({
        ours,
        competitors: collected.slice(1),
        comparableFlags: state.domains.slice(1).map(d => d.comparable),
        vocab,
      })
    : emptyKeywordGap('ไม่มีข้อมูลคีย์เวิร์ดของเว็บเรา')

  if (calls > 0) {
    await logCost(ctx, {
      jobType: 'competitor_gap_ranked_keywords',
      provider: 'dataforseo',
      model: 'dataforseo_labs/google/ranked_keywords/live',
      ok: true,
      externalCost: cost,
      externalCalls: calls,
      externalApi: 'dataforseo',
      summary: `Competitor Gap keyword gap · ${calls} โดเมน · ${country.label} · แถวที่ใช้เทียบ ${state.keywordGap.rows.length}`,
    })
  }

  const notes = state.keywordGap.note
  setStep(state, 'keywords', state.keywordGap.available ? 'done' : 'skipped',
    state.keywordGap.available
      ? `เทียบ ${state.keywordGap.rows.length} คีย์เวิร์ด · ยังไม่มี ${state.keywordGap.counts.MISSING} · จ่ออันดับ 1 หน้าแรก ${state.keywordGap.counts.NEAR_WIN}`
      : notes ?? 'ไม่มีข้อมูลคีย์เวิร์ด')
  state.phase = 'baseline'
}

function buildReportSkeleton(state: RunState): GapReport {
  const keyword = state.input.keyword
  const marketPages = state.domains.filter(d => !d.isOurs).flatMap(d => d.pages)
  const benchmark = buildBenchmark(marketPages, keyword)
  const inventories: DomainInventory[] = state.domains.map(d => buildInventory(d, benchmark))
  const metrics = buildMetrics(inventories)
  const keywordGap = state.keywordGap ?? emptyKeywordGap('ไม่ได้ดึงข้อมูลคีย์เวิร์ด')
  const readiness = computeReadiness({ metrics, clusters: state.clusters, keywordGap, inventories })

  const comparable = state.domains.filter(d => !d.isOurs && d.comparable).map(d => d.domain)
  const competitors: CompetitorSummary[] = state.domains.filter(d => !d.isOurs).map((d, i) => ({
    domain: d.domain,
    manual: d.manual === true,
    position: d.serpPosition,
    rankingUrl: d.serpUrl,
    kind: d.kind,
    comparable: d.comparable,
    inventory: inventories[i + 1] ?? inventories[inventories.length - 1],
    topClusters: state.clusters
      .filter(c => (c.competitorPages[i] ?? 0) > 0)
      .sort((a, b) => (b.competitorPages[i] ?? 0) - (a.competitorPages[i] ?? 0))
      .slice(0, 8)
      .map(c => c.label),
    coverage: d.coverage,
    whyTheyWin: null, whereWeak: null, whatToMatch: null, doNotCopy: null, howToBeat: null,
  }))

  return {
    version: 1,
    runId: state.runId,
    input: state.input,
    generatedAt: new Date().toISOString(),
    serp: state.serp!,
    domains: inventories,
    competitors,
    metrics,
    clusters: state.clusters,
    keywordGap,
    readiness: readiness.score,
    readinessBreakdown: readiness.breakdown,
    gapToBaselinePct: readiness.score === null ? null : Math.max(0, 100 - readiness.score),
    biggestProblem: readiness.biggestProblem,
    baselineBasis: {
      comparableDomains: comparable,
      note: comparable.length >= 2
        ? `ใช้ median ของคู่แข่งที่เทียบเคียงได้ ${comparable.length} เว็บเป็นมาตรฐาน (เว็บประเภทไดเรกทอรี/ราชการ/ชุมชน แสดงไว้แต่ไม่ถูกใช้ตั้งมาตรฐาน)`
        : 'คู่แข่งที่เทียบเคียงได้มีน้อยกว่า 2 เว็บ — ใช้ median ของ Top 5 ทั้งหมดแทน ตัวเลขมาตรฐานจึงอ่อนกว่าปกติ',
    },
    phase1: { actions: [], counts: {}, projectedCoveragePct: null, summary: null },
    phase2: { ideas: [], summary: null },
    costUsd: state.costUsd,
    warnings: state.warnings,
  }
}

function phaseBaseline(state: RunState) {
  setStep(state, 'baseline', 'running')
  state.report = buildReportSkeleton(state)
  const r = state.report
  setStep(state, 'baseline', 'done',
    r.readiness === null
      ? 'ข้อมูลไม่พอคำนวณคะแนน — แสดงเฉพาะตัวเลขที่วัดได้'
      : `ความพร้อมแข่งขัน ${r.readiness}/100 · ห่างจากมาตรฐาน Top 5 ${r.gapToBaselinePct}%`)
  state.phase = 'phase1'
}

async function phasePhase1(state: RunState, ctx: RunContext) {
  setStep(state, 'phase1', 'running')
  const report = state.report!
  const ours = state.domains[0]
  const marketPages = state.domains.filter(d => !d.isOurs).flatMap(d => d.pages)
  const benchmark = buildBenchmark(marketPages, state.input.keyword)

  const actions = buildPhase1Actions({
    ours,
    clusters: state.clusters,
    keywordGap: report.keywordGap,
    inventories: report.domains,
    benchmark,
    competitorDomains: state.domains.filter(d => !d.isOurs).map(d => d.domain),
  })

  const enriched = await enrichPhase1({
    actions,
    keyword: state.input.keyword,
    ourDomain: ours.domain,
    ourPages: ours.pages,
    metrics: report.metrics,
    readiness: report.readiness,
  })
  state.costUsd += enriched.usage.costUsd
  if (enriched.error) state.warnings.push(`AI อธิบายแผน Phase 1 ไม่สำเร็จ: ${enriched.error} (ยังแสดงงานและตัวเลขที่คำนวณได้ตามปกติ)`)

  await logCost(ctx, {
    jobType: 'competitor_gap_phase1',
    provider: 'openrouter',
    model: OR_MODELS.default(),
    ok: !enriched.error,
    aiUsage: enriched.usage,
    summary: `Competitor Gap Phase 1 · ${actions.length} งาน · เรียก AI 1 ครั้งเพื่ออธิบายเหตุผล/มุมเนื้อหา`,
    error: enriched.error ?? undefined,
  })

  report.phase1 = {
    actions,
    counts: summarizeCounts(actions),
    projectedCoveragePct: projectCoverage({
      readiness: { score: report.readiness, breakdown: report.readinessBreakdown, biggestProblem: report.biggestProblem },
      clusters: state.clusters,
      actions,
      keywordGap: report.keywordGap,
    }),
    summary: enriched.summary,
  }

  setStep(state, 'phase1', 'done', `${actions.length} งาน · P0 ${report.phase1.counts.P0 ?? 0} · P1 ${report.phase1.counts.P1 ?? 0}`)
  state.phase = 'phase2'
}

async function phasePhase2(state: RunState, ctx: RunContext) {
  setStep(state, 'phase2', 'running')
  const report = state.report!
  const competitorStates = state.domains.filter(d => !d.isOurs)

  const summaries = await summarizeCompetitors({
    keyword: state.input.keyword,
    ourDomain: state.domains[0].domain,
    ourInventory: report.domains.find(i => i.isOurs) ?? null,
    competitors: competitorStates.map((s, i) => ({
      state: s,
      inventory: report.competitors[i].inventory,
      topClusters: report.competitors[i].topClusters,
    })),
    clusters: state.clusters,
  })
  state.costUsd += summaries.usage.costUsd
  for (const c of report.competitors) {
    const s = summaries.summaries[c.domain]
    if (!s) continue
    c.whyTheyWin = s.whyTheyWin ?? null
    c.whereWeak = s.whereWeak ?? null
    c.whatToMatch = s.whatToMatch ?? null
    c.doNotCopy = s.doNotCopy ?? null
    c.howToBeat = s.howToBeat ?? null
  }

  const surpass = await buildSurpassIdeas({
    keyword: state.input.keyword,
    ourDomain: state.domains[0].domain,
    competitors: competitorStates.map((s, i) => ({ state: s, inventory: report.competitors[i].inventory })),
    clusters: state.clusters,
    keywordGap: report.keywordGap,
    competitorNotes: summaries.summaries,
  })
  state.costUsd += surpass.usage.costUsd
  report.phase2 = { ideas: surpass.ideas, summary: surpass.summary }

  const err = summaries.error ?? surpass.error
  if (err) state.warnings.push(`AI ส่วน Phase 2 ไม่สมบูรณ์: ${err}`)
  await logCost(ctx, {
    jobType: 'competitor_gap_phase2',
    provider: 'openrouter',
    model: OR_MODELS.default(),
    ok: !err,
    aiUsage: {
      inputTokens: summaries.usage.inputTokens + surpass.usage.inputTokens,
      outputTokens: summaries.usage.outputTokens + surpass.usage.outputTokens,
      totalTokens: summaries.usage.totalTokens + surpass.usage.totalTokens,
      costUsd: summaries.usage.costUsd + surpass.usage.costUsd,
    },
    summary: `Competitor Gap Phase 2 · สรุปคู่แข่ง ${report.competitors.length} เว็บ + ไอเดียแซง ${surpass.ideas.length} ข้อ · เรียก AI 2 ครั้ง`,
    error: err ?? undefined,
  })

  report.costUsd = state.costUsd
  report.warnings = state.warnings
  report.generatedAt = new Date().toISOString()

  setStep(state, 'phase2', 'done', `${surpass.ideas.length} แนวทาง`)
  state.phase = 'done'
  state.status = 'done'
  await saveReport(state.projectId, report)
}

/** เดินหน้าหนึ่งเฟสแล้วบันทึก checkpoint — เรียกซ้ำจนกว่า status จะเป็น done/error */
export async function advanceRun(state: RunState, ctx: RunContext): Promise<RunState> {
  if (state.status !== 'running') return state
  try {
    switch (state.phase) {
      case 'serp': await phaseSerp(state, ctx); break
      case 'crawl': await phaseCrawl(state, ctx); break
      case 'classify': await phaseClassify(state, ctx); break
      case 'topics': await phaseTopics(state, ctx); break
      case 'keywords': await phaseKeywords(state, ctx); break
      case 'baseline': phaseBaseline(state); break
      case 'phase1': await phasePhase1(state, ctx); break
      case 'phase2': await phasePhase2(state, ctx); break
      default: state.status = 'done'
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state.status = 'error'
    state.error = msg
    const current = state.steps.find(s => s.status === 'running')
    if (current) { current.status = 'failed'; current.detail = msg.slice(0, 200) }
    await logCost(ctx, {
      jobType: `competitor_gap_${state.phase}`,
      provider: 'marsos',
      model: 'competitor-gap-runner',
      ok: false,
      summary: `Competitor Gap หยุดที่เฟส ${state.phase}`,
      error: msg,
    })
  }
  await saveRun(state)
  return state
}
