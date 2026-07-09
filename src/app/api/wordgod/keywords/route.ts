/**
 * Mars OS — Keyword Research API (WordGod-equivalent pipeline)
 * Flow: Gemini grounding expand → Google KP real volume → AI titles → Topic Cluster → AEO scoring
 */
export const maxDuration = 800 // Vercel Pro max — supports 3000 keyword runs

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAIJob, estimateGeminiCost } from '@/lib/logAIJob'
import { logActivity } from '@/lib/logActivity'
import { loadGoogleAdsConfig, getAccessToken, getKPVolumes, getKPKeywordIdeas } from '@/lib/googleKeywordPlannerService'
import { getDataForSeoVolumes, hasDataForSeoCreds } from '@/lib/dataForSeoService'
import { fetchSitemapUrls, scrapeBusinessContext, formatBusinessContextForPrompt, type BusinessContext } from '@/lib/siteCrawler'
import {
  PRESETS,
  DEFAULT_RATIO,
  type IntentRatio,
  type PresetKey,
  INTENT_LABELS,
  INTENT_DESCRIPTIONS,
  rebalanceRatio,
  totalRatio,
  buildIntentPromptSection,
} from '@/lib/skills/intentRatioSkill'
import {
  KEYWORD_RESEARCH_PROMPT,
  detectTopicClusterRole,
  buildProblemContextSection,
} from '@/lib/skills/keywordResearchSkill'
import { clusterKeywords, type ClusterResult, type PipelineKeyword as ClusterPipelineKeyword } from '@/lib/skills/topicClusterSkill'
import { enrichWithAEO } from '@/lib/skills/aeoSkill'
import { buildSeoTitleAiPrompt, type TitleRequest, type TitleAiResult } from '@/lib/skills/seoTitleAiSkill'
import { scoreCompetitorGap } from '@/lib/skills/competitorGapSkill'
import { detectTrendSignal } from '@/lib/skills/trendSkill'
import { extractCompetitorKeywords } from '@/lib/skills/competitorUrlSkill'
import { generateVertexContent, isVertexOidcConfigured } from '@/lib/vertex'
import {
  classifyJourneyStage,
  classifyAISearchRisk,
  computeSalesImpactScore,
  computeBuyerIntentScore,
  computeVolumeScore,
  computePriorityScore,
  computeKnowledgeImpactScore,
  computeIntentBucketScore,
  computeKeywordDepthScore,
  computeInternalLinkOpportunityScore,
  computeCustomerPainUrgencyScore,
  suggestAnchorText,
  validateKeywordResearchQA,
  buildProblemFirstTitlePrompt,
  runProblemToKeywordExpander,
  runArticleGroupingDecisionEngine,
  type DiscoveredProblem,
  type IntentBucket,
  type AllScores,
  type JourneyStage,
  type AISearchRisk,
} from '@/lib/skills/problemFirstSkill'


// ── Types ─────────────────────────────────────────────────────────────────────

type SearchIntent =
  | 'informational' | 'commercial' | 'transactional' | 'navigational'
  | 'local' | 'problem_solving' | 'comparison' | 'price'
  | 'checklist' | 'review' | 'service_seeking' | 'update'

type KeywordType =
  | 'seed' | 'long_tail' | 'question' | 'commercial' | 'transactional'
  | 'local' | 'problem' | 'comparison' | 'price' | 'checklist' | 'review'
  | 'money_keyword' | 'supporting_keyword'

type Funnel = 'TOFU' | 'MOFU' | 'BOFU' | 'Post Purchase' | 'All'

type ArticleType =
  | 'Traffic Content' | 'Educational Content' | 'Authority Content'
  | 'Comparison Content' | 'Problem Solving Content' | 'Service Content'
  | 'Sales Content' | 'Brand Content' | 'Retention Content'

type Objective =
  | 'Traffic' | 'Lead' | 'Authority' | 'Comparison' | 'Problem Solving'
  | 'Sales' | 'Brand' | 'Retention' | 'Education'

export interface KeywordRow {
  no: number
  keyword: string
  title: string
  volume: number
  intent: SearchIntent
  keyword_type: KeywordType
  priority: 'high' | 'medium' | 'low'
  opportunity_score: number
  content_type: string
  notes: string
  topic_cluster_role?: string
  // AEO fields
  aeo_opportunity?: string
  aeo_opportunity_score?: number
  ai_overview_risk?: string
  ai_overview_risk_score?: number
  direct_answer_potential?: boolean
  featured_snippet_potential?: boolean
  question_pattern?: string
  answer_format_recommendation?: string
  ai_search_priority_score?: number
  ai_search_priority_level?: string
  // Framework fields
  funnel: Funnel
  traffic_score: number
  authority_score: number
  lead_score: number
  sales_score: number
  retention_score: number
  primary_objective: Objective
  secondary_objective: Objective
  article_type: ArticleType
  // WordGod Problem-First + Scoring Layer
  journey_stage?: JourneyStage
  ai_search_risk?: AISearchRisk
  ai_resilience_score?: number
  sales_impact_score?: number
  buyer_intent_score?: number
  priority_score?: number
  intent_bucket_score?: number
  keyword_depth_score?: number
  internal_link_opportunity_score?: number
  customer_pain_urgency_score?: number
  suggested_anchor_text?: string
  problem_group?: string
  original_problem?: string
  customer_problem?: string
  problem_urgency_score?: number
  // Competitor Gap
  gap_score?: number
  gap_level?: 'high' | 'medium' | 'low'
  gap_reasons?: string[]
  // Trend / Seasonal
  trend_type?: string
  trend_score?: number
  refresh_priority?: string
  content_notes?: string
  // Article Grouping
  article_group?: string
  merge_or_split?: 'merge' | 'split' | 'standalone'
  primary_keyword?: string
  secondary_keywords?: string[]
  // QA
  qa_passes?: boolean
  qa_warnings?: string[]
  // Volume source
  volume_source?: 'keyword_planner' | 'planner_variant' | 'dataforseo' | 'gemini_estimated'
  // Sheet fields (preserved from upload)
  slug?: string
  cluster?: string
  page_tier?: string
  status?: string
  action?: string
  section?: string
  keyword_group?: string
  current_url?: string
  conversion_potential?: number
  traffic_potential?: number
  relevance_score?: number
}

interface CsvInputRow {
  keyword: string
  volume?: number
  title?: string
  page_type?: string
  pillar_intent?: string
  cluster?: string
  page_tier?: string
  status?: string
  action?: string
  section?: string
  slug?: string
  keyword_group?: string
  current_url?: string
  conversion_potential?: number
  traffic_potential?: number
  relevance_score?: number
}

// ── Gemini helpers (via Vertex AI + Vercel OIDC) ──────────────────────────────

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'

// Accumulate tokens across all Gemini calls in one request
let _geminiTokensAccum = 0
function resetTokenAccum() { _geminiTokensAccum = 0 }
function addTokens(n: number) { _geminiTokensAccum += n }

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  const BACKOFFS = [5000, 15000, 30000]
  let lastErr: unknown = new Error('unknown')
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      if (isRateLimitError(err) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, BACKOFFS[attempt] ?? 30000))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

function parseGeminiJSON(text: string): any {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const firstBrace   = cleaned.indexOf('{')
  const firstBracket = cleaned.indexOf('[')
  let start: number
  if (firstBrace === -1 && firstBracket === -1) throw new Error('No JSON in Gemini response')
  else if (firstBrace   === -1) start = firstBracket
  else if (firstBracket === -1) start = firstBrace
  else start = Math.min(firstBrace, firstBracket)
  const jsonStr = cleaned.substring(start)
  try { return JSON.parse(jsonStr) } catch {
    let depth = 0, inStr = false, esc = false
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i]
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{' || ch === '[') depth++
      if (ch === '}' || ch === ']') { depth--; if (depth === 0) return JSON.parse(jsonStr.substring(0, i + 1)) }
    }
    throw new Error('Failed to parse Gemini JSON')
  }
}

// Plain text / JSON parse — no grounding tools
type GeminiUsageTag = {
  usageOperation?: string
  usageLabels?: Record<string, string | number | boolean | null | undefined>
}

async function callGemini(prompt: string, tags: GeminiUsageTag = {}): Promise<any> {
  return withRetry(async () => {
    const result = await generateVertexContent(prompt, {
      model: GEMINI_MODEL,
      usageOperation: tags.usageOperation || 'wordgod_text',
      usageLabels: { feature: 'wordgod', ...tags.usageLabels },
    })
    addTokens(result.usage.totalTokenCount)
    return parseGeminiJSON(result.text)
  })
}

// JSON mode via responseMimeType
async function callGeminiJson(prompt: string, tags: GeminiUsageTag = {}): Promise<any> {
  return withRetry(async () => {
    const result = await generateVertexContent(prompt, {
      model: GEMINI_MODEL,
      responseMimeType: 'application/json',
      temperature: 0.5,
      maxOutputTokens: 16384,
      usageOperation: tags.usageOperation || 'wordgod_json',
      usageLabels: { feature: 'wordgod', ...tags.usageLabels },
    })
    addTokens(result.usage.totalTokenCount)
    return parseGeminiJSON(result.text)
  })
}

// ── Gemini with Grounding — 2-pass: search first, then JSON format ────────────

interface GroundingMeta {
  webSearchQueries: string[]
  sourceUrls: string[]
}

// 2-pass: Pass 1 = grounding search (plain text), Pass 2 = format research text to JSON
// prompt should be research instructions only — no JSON schema (so Gemini focuses on searching)
// jsonSchema is extracted from the last JSON block in prompt and sent in pass 2
async function callGeminiWithGrounding(prompt: string): Promise<{ data: any; grounding: GroundingMeta }> {
  // Extract JSON schema from end of prompt (last { ... } block) so pass 1 is research-only
  const jsonStart = prompt.lastIndexOf('\n{')
  const researchPart = jsonStart !== -1 ? prompt.substring(0, jsonStart).trimEnd() : prompt
  const jsonSchema   = jsonStart !== -1 ? prompt.substring(jsonStart).trim() : ''

  // Pass 1: grounding search
  const researchResult = await withRetry(() => generateVertexContent(researchPart, {
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }],
    usageOperation: 'keyword_grounding_research',
    usageLabels: { feature: 'wordgod' },
  }))
  const researchText = researchResult.text
  addTokens(researchResult.usage.totalTokenCount)

  const meta = researchResult.data?.candidates?.[0]?.groundingMetadata ?? {}
  const grounding: GroundingMeta = {
    webSearchQueries: meta.webSearchQueries ?? [],
    sourceUrls: (meta.groundingChunks ?? []).map((c: any) => c.web?.uri ?? '').filter(Boolean),
  }

  // Pass 2: format research findings to JSON
  const formatPrompt = jsonSchema
    ? `Based on this research:\n\n${researchText}\n\nReturn ONLY valid JSON matching this schema (no markdown):\n${jsonSchema}`
    : `Based on this research:\n\n${researchText}\n\nReturn your findings as valid JSON only (no markdown).`

  const data = await withRetry(async () => {
    const result = await generateVertexContent(formatPrompt, {
      model: GEMINI_MODEL,
      responseMimeType: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 8192,
      usageOperation: 'keyword_grounding_format',
      usageLabels: { feature: 'wordgod' },
    })
    addTokens(result.usage.totalTokenCount)
    return parseGeminiJSON(result.text)
  })

  return { data, grounding }
}

// ── Problem Discovery (Grounding) ─────────────────────────────────────────────

async function runProblemDiscovery(niche: string, businessContext: string): Promise<{ problems: DiscoveredProblem[]; groundingQueries: string[]; groundingUrls: string[] }> {
  // Pass 1 prompt: research only — no JSON schema so Gemini focuses on grounding search
  const researchPrompt = `You are a customer research expert for SEO keyword strategy.

Business context: ${businessContext || niche}
Niche: ${niche}

IMPORTANT — AUTO-DISCOVERY MODE:
You have very little specific context. Use Google Search grounding to find real Thai customer questions, complaints, and confusion in this niche.
Search for: Thai-language forums (Pantip, Reddit Thailand), product reviews, Q&A sites, Facebook groups related to "${niche}".
Find REAL problems Thai customers face — not generic marketing statements.

WHAT COUNTS AS A "PROBLEM" (be broad — include all):
- Confusion before buying: not knowing which product/brand/option to choose
- Fear of wrong choice: worried about wasting money or making a mistake
- Comparison anxiety: overwhelmed by too many choices
- Technical difficulty during use: setup problems, errors, things not working
- Post-purchase doubt: wondering if they made the right choice
- General knowledge gaps: lacking background to make informed decisions

Journey stages: pre_purchase, during_use, result_interpretation, post_purchase, general_education

REQUIREMENTS:
- Return MINIMUM 5 problems, up to 10
- At least 2 problems must have urgency_score >= 7
- Problems must be specific, not vague marketing statements
- Write problem_statement in natural Thai that a real customer would express
- If specific data unavailable, generate realistic problems Thai customers commonly face in similar niches
- Generate 3–5 Thai keyword seeds per problem

Use Google Search first to find real Thai customer problems in this niche, then return your findings as JSON only (no markdown):
{
  "problems": [
    {
      "problem_statement": "...",
      "journey_stage": "pre_purchase",
      "problem_group": "buying_decision",
      "urgency_score": 8,
      "keywords_to_expand": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}`

  try {
    const { data, grounding } = await callGeminiWithGrounding(researchPrompt)
    const problems: DiscoveredProblem[] = (data?.problems ?? []).filter(
      (p: any) => p.problem_statement && p.keywords_to_expand?.length > 0
    )
    return { problems, groundingQueries: grounding.webSearchQueries, groundingUrls: grounding.sourceUrls }
  } catch {
    return { problems: [], groundingQueries: [], groundingUrls: [] }
  }
}

// ── Volume: KP primary → DFS fallback (WordGod pattern) ──────────────────────

let _kpKeywordCount = 0
let _dfsKeywordCount = 0

async function fetchVolumes(keywords: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (keywords.length === 0) return result

  const norm = (s: string) => s.toLowerCase().trim()

  // ── KP primary ──────────────────────────────────────────────────────────────
  const config = loadGoogleAdsConfig()
  if (config) {
    try {
      const accessToken = await getAccessToken(config)
      const kpMap = await getKPVolumes(keywords, config, accessToken)
      kpMap.forEach((entry, kw) => {
        if (entry.volume > 0) result.set(norm(kw), entry.volume)
      })
      _kpKeywordCount += keywords.length
    } catch { /* fall through to DFS */ }
  }

  // ── DFS fallback — only keywords KP returned 0 or missed ────────────────────
  const needsDFS = keywords.filter(kw => !result.has(norm(kw)) || result.get(norm(kw)) === 0)
  if (needsDFS.length > 0 && hasDataForSeoCreds()) {
    try {
      const dfsMap = await getDataForSeoVolumes(needsDFS)
      dfsMap.forEach((metric, kw) => {
        if (metric.volume > 0) result.set(norm(kw), metric.volume)
      })
      _dfsKeywordCount += needsDFS.length
    } catch { /* ignore */ }
  }

  return result
}

// ── Keyword expansion via Gemini grounding ────────────────────────────────────

interface GeminiKw {
  keyword: string
  volume_estimate: number
  competition: string
  opportunity_score: number
  intent: string
  keyword_type: string
  reason: string
}

// Dynamic batch/parallel — SDK handles rate limits internally (same as WordGod)
function getBatchConfig(targetCount: number) {
  if (targetCount <= 100) return { batch: 25, parallel: 3 }
  if (targetCount <= 500) return { batch: 50, parallel: 5 }
  return { batch: 100, parallel: 8 }
}

const FORUM_FILTER = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i

async function expandKeywordsGemini(
  seeds: string[],
  businessName: string,
  category: string,
  count: number,
  exclude: string[],
  intentRatio: IntentRatio,
  isKnowledgeMode = false,
  siteContextPrompt = '',
): Promise<GeminiKw[]> {
  const excludeSet = new Set(exclude.map(k => k.trim().toLowerCase()))
  const { batch: BATCH, parallel: PARALLEL } = getBatchConfig(count)
  const totalBatches = Math.ceil(count / BATCH)
  const allResults: GeminiKw[][] = new Array(totalBatches).fill(null).map(() => [])

  // niche = all seed guides joined — gives Gemini full business context per batch
  const niche = seeds.join(' / ') || businessName || category

  for (let wave = 0; wave < totalBatches; wave += PARALLEL) {
    const waveIdxs = Array.from(
      { length: Math.min(PARALLEL, totalBatches - wave) },
      (_, i) => wave + i,
    )
    // snapshot alreadyFound before this wave starts
    const alreadyFound = allResults.flat().map(k => k.keyword)

    await Promise.all(waveIdxs.map(async (bi) => {
      const need = bi === totalBatches - 1 ? count - bi * BATCH : BATCH
      if (need <= 0) return

      const basePrompt = KEYWORD_RESEARCH_PROMPT(
        niche,
        seeds[bi % seeds.length] || seeds[0],
        need,
        [...exclude, ...alreadyFound],
        alreadyFound,
        intentRatio,
        isKnowledgeMode,
      )
      // Inject site context only on first wave (saves tokens)
      const prompt = wave === 0 && bi === 0 && siteContextPrompt
        ? siteContextPrompt + '\n\n' + basePrompt
        : basePrompt

      try {
        const raw = await callGeminiJson(prompt, {
          usageOperation: 'keyword_expand',
          usageLabels: { sub_function: 'seed_expansion', batch: bi + 1 },
        }) as any
        const batch: any[] = raw?.keywords ?? raw ?? []
        const results: GeminiKw[] = []
        for (const kw of batch) {
          if (!kw?.keyword) continue
          if (FORUM_FILTER.test(kw.keyword)) continue
          results.push({
            keyword: kw.keyword,
            volume_estimate: kw.volume_estimate ?? 0,
            competition: kw.competition ?? 'UNSPECIFIED',
            opportunity_score: kw.opportunity_score ?? 50,
            intent: kw.intent ?? 'informational',
            keyword_type: kw.keyword_type ?? 'long_tail',
            reason: kw.reason ?? '',
          })
        }
        allResults[bi] = results
      } catch (err: any) {
        console.error(`[wordgod] expand batch ${bi + 1} error:`, err?.message)
        allResults[bi] = []
      }
    }))
  }

  // Merge + deduplicate across all batches
  const collected: GeminiKw[] = []
  for (const batchResult of allResults) {
    for (const kw of batchResult) {
      if (collected.length >= count) break
      const norm = kw.keyword.trim().toLowerCase()
      if (excludeSet.has(norm)) continue
      excludeSet.add(norm)
      collected.push(kw)
    }
    if (collected.length >= count) break
  }
  return collected
}

// ── AI Title generation (WordGod seoTitleAiSkill) ────────────────────────────

interface TitleResult {
  title: string
  aeo_question?: string
  seo_score?: number
  aeo_score?: number
  ai_search_score?: number
  ctr_score?: number
}

async function generateTitles(
  kws: GeminiKw[],
  businessName: string,
  category: string,
): Promise<Map<string, TitleResult>> {
  const result = new Map<string, TitleResult>()
  const BATCH = 25
  const batches: GeminiKw[][] = []
  for (let i = 0; i < kws.length; i += BATCH) batches.push(kws.slice(i, i + BATCH))

  // Parallel — all batches fire simultaneously (same as WordGod)
  await Promise.all(batches.map(async (batch, bi) => {
    const requests: TitleRequest[] = batch.map(kw => ({
      keyword: kw.keyword,
      volume: kw.volume_estimate,
      competition: kw.competition,
      intent: kw.intent,
      keyword_type: kw.keyword_type,
      content_type: resolveContentType(kw.intent),
      business_context: businessName || category,
      category,
    }))
    const prompt = buildSeoTitleAiPrompt(requests, 'th')
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callGeminiJson(prompt, {
          usageOperation: 'seo_title_generation',
          usageLabels: { sub_function: 'titles', batch: bi + 1 },
        }) as any
        for (const t of (raw?.titles ?? [])) {
          if (t?.keyword && t?.title) {
            result.set(t.keyword.toLowerCase().trim(), {
              title: t.title,
              aeo_question: t.aeo_question,
              seo_score: t.seo_score,
              aeo_score: t.aeo_score,
              ai_search_score: t.ai_search_score,
              ctr_score: t.ctr_score,
            })
          }
        }
        return
      } catch (err: any) {
        lastErr = err
        if (attempt === 0) await new Promise(r => setTimeout(r, 5000))
      }
    }
    console.error(`[wordgod] title batch ${bi + 1} error:`, (lastErr as any)?.message)
  }))
  return result
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function classifyIntent(kw: string): SearchIntent {
  const k = kw.toLowerCase()
  if (/ราคา|ค่า|เท่าไร/.test(k)) return 'price'
  if (/เปรียบเทียบ|vs\.|ดีกว่า|ต่างกัน|ไหนดี/.test(k)) return 'comparison'
  if (/รีวิว|review|ดีไหม/.test(k)) return 'review'
  if (/ซื้อ|สั่ง|จอง/.test(k)) return 'transactional'
  if (/บริการ|รับจัด|agency/.test(k)) return 'service_seeking'
  if (/แก้|รักษา|ป้องกัน|วิธีแก้|ปัญหา/.test(k)) return 'problem_solving'
  if (/วิธีเลือก|ก่อนซื้อ|แนะนำ|ควรรู้/.test(k)) return 'commercial'
  if (/เช็คลิสต์|checklist|รายการ/.test(k)) return 'checklist'
  if (/ล่าสุด|อัปเดต|2025|2026/.test(k)) return 'informational'
  return 'informational'
}

function resolveContentType(intent: string): string {
  const map: Record<string, string> = {
    informational: 'pillar_article', commercial: 'buying_guide',
    transactional: 'product_page', problem_solving: 'problem_solution_article',
    comparison: 'comparison_article', price: 'price_guide',
    checklist: 'checklist_article', review: 'review_article',
    service_seeking: 'service_page', local: 'local_seo_page',
    navigational: 'brand_page', update: 'news_article',
  }
  return map[intent] || 'article'
}

function resolvePageType(intent: string, contentType: string): string {
  // Human-readable page type for UI display
  if (['service_seeking', 'transactional', 'price'].includes(intent)) return 'Service Page'
  if (contentType === 'pillar_article' || contentType === 'checklist_article') return 'Blog'
  if (contentType === 'buying_guide' || contentType === 'comparison_article') return 'Blog'
  if (contentType === 'problem_solution_article' || contentType === 'review_article') return 'Blog'
  if (contentType === 'price_guide') return 'Blog'
  if (contentType === 'service_page') return 'Service Page'
  if (contentType === 'local_seo_page') return 'Local Page'
  if (contentType === 'brand_page') return 'Brand Page'
  if (contentType === 'news_article') return 'Blog'
  return 'Blog'
}

function generateSlug(keyword: string): string {
  // Transliterate Thai keywords to slug using keyword itself (lowercase latin chars only)
  // For Thai text: use romanization heuristic or just clean/truncate
  const cleaned = keyword
    .toLowerCase()
    .replace(/[^฀-๿a-z0-9\s-]/g, '') // keep Thai + latin + numbers + spaces
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
  return cleaned || 'article'
}

function scoreOpportunity(volume: number, competition: string, intent: string): number {
  const volScore =
    volume >= 100000 ? 10 : volume >= 50000 ? 9 : volume >= 20000 ? 8 :
    volume >= 10000 ? 7 : volume >= 5000 ? 6 : volume >= 1000 ? 5 :
    volume >= 500 ? 4 : volume >= 100 ? 3 : volume > 0 ? 2 : 1
  const compScore = competition === 'LOW' || competition === 'Low' ? 9
    : competition === 'MEDIUM' || competition === 'Medium' ? 6 : 4
  const intentVal: Record<string, number> = {
    transactional: 10, commercial: 9, service_seeking: 8, price: 8,
    comparison: 7, review: 7, problem_solving: 6,
    checklist: 5, informational: 5, navigational: 4,
  }
  const raw = volScore * 10 * 0.35 + compScore * 10 * 0.25 + (intentVal[intent] ?? 5) * 10 * 0.40
  return Math.max(0, Math.min(100, Math.round(raw)))
}

function resolvePriority(score: number): 'high' | 'medium' | 'low' {
  return score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
}

function fallbackTitle(keyword: string, intent: string): string {
  const TEMPLATES: Record<string, string> = {
    informational: `${keyword} คืออะไร? อธิบายครบในที่เดียว`,
    commercial: `เปรียบเทียบ ${keyword} — แนะนำตัวเลือกที่ดีที่สุด`,
    transactional: `${keyword} — บริการ ราคา และวิธีสมัคร`,
    problem_solving: `วิธีแก้ปัญหา ${keyword} อย่างได้ผล`,
    comparison: `${keyword} เปรียบเทียบข้อดีข้อเสีย`,
    review: `รีวิว ${keyword} ครบทุกด้าน`,
    checklist: `เช็คลิสต์ ${keyword} ก่อนตัดสินใจ`,
    price: `${keyword} ราคาเท่าไร? อัปเดตล่าสุด`,
  }
  return TEMPLATES[intent] || `${keyword} — คู่มือฉบับสมบูรณ์`
}

function resolveFramework(intent: string, kwType: string, volume: number, hints: { convPotential?: number; trafficPotential?: number }) {
  const funnel: Funnel =
    ['transactional', 'service_seeking', 'price'].includes(intent) ? 'BOFU' :
    ['commercial', 'comparison', 'review'].includes(intent) ? 'MOFU' : 'TOFU'

  const traffic_score   = Math.min(10, Math.round((volume / 5000) * 10 + (hints.trafficPotential ?? 3)))
  const authority_score = ['informational', 'checklist'].includes(intent) ? 8 : 5
  const lead_score      = ['transactional', 'service_seeking'].includes(intent) ? 9 : ['commercial', 'comparison'].includes(intent) ? 7 : 4
  const sales_score     = ['transactional', 'price'].includes(intent) ? 9 : (hints.convPotential ?? 0) >= 4 ? 7 : 4
  const retention_score = ['review', 'checklist'].includes(intent) ? 7 : 3

  const primary_objective: Objective =
    funnel === 'BOFU' ? 'Lead' : funnel === 'MOFU' ? 'Comparison' : 'Traffic'
  const secondary_objective: Objective =
    authority_score >= 7 ? 'Authority' : lead_score >= 7 ? 'Lead' : 'Education'

  const article_type: ArticleType =
    intent === 'informational' ? 'Educational Content' :
    intent === 'commercial'    ? 'Authority Content' :
    intent === 'comparison'    ? 'Comparison Content' :
    intent === 'problem_solving' ? 'Problem Solving Content' :
    intent === 'transactional' ? 'Service Content' :
    intent === 'review'        ? 'Authority Content' :
    intent === 'service_seeking' ? 'Service Content' :
    'Traffic Content'

  return { funnel, traffic_score, authority_score, lead_score, sales_score, retention_score, primary_objective, secondary_objective, article_type }
}

function intentBucketOf(intent: string): IntentBucket {
  if (['commercial', 'comparison', 'review'].includes(intent)) return 'commercial'
  if (['transactional', 'service_seeking', 'price'].includes(intent)) return 'transactional'
  if (['navigational'].includes(intent)) return 'navigational'
  if (['update'].includes(intent)) return 'update'
  return 'informational'
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  resetTokenAccum()
  _kpKeywordCount = 0
  _dfsKeywordCount = 0
  const startedAt = Date.now()

  const session = await getSession()
  const orgId   = session?.user?.organizationId ?? null
  const userId  = session?.user?.id ?? 'system'

  const body = await req.json()
  const {
    niche = '' as string,          // primary input (WordGod style)
    seeds = [] as string[],        // legacy fallback
    csv_rows = [] as CsvInputRow[],
    business_name = '',
    category = 'General',
    count = 30,
    preset_key = 'preset1' as PresetKey,
    intent_mix = null as IntentRatio | null,
    project_id = null as string | null,
    site_url = '' as string,
  } = body

  // Resolve niche: new field takes priority, fallback to seeds array (legacy)
  const resolvedNiche: string = niche.trim() || (Array.isArray(seeds) ? seeds.join(' / ') : '') || business_name || category

  // ── SSE stream setup ────────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  const ctrl = { ref: null as ReadableStreamDefaultController<Uint8Array> | null }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) { ctrl.ref = controller },
  })

  function push(event: string, data: unknown) {
    try {
      ctrl.ref?.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch { /* stream closed */ }
  }

  function log(msg: string) { push('progress', { msg }) }

  // Run pipeline async, SSE streams progress, closes when done
  ;(async () => {
    try {
      const intentRatio: IntentRatio = intent_mix ?? (
        PRESETS.find(p => p.key === preset_key)?.ratio ?? DEFAULT_RATIO
      )
      const isKnowledgeMode = preset_key === 'preset6'
      const hasGemini = isVertexOidcConfigured()

      // ─ Step 0: Sitemap + business context ──────────────────────────────────
      let businessCtx: BusinessContext | null = null
      let siteContextPrompt = ''
      if (site_url && resolvedNiche) {
        log(`🌐 กำลัง crawl sitemap จาก ${site_url} ...`)
        try {
          const sitemapUrls = await fetchSitemapUrls(site_url)
          businessCtx = await scrapeBusinessContext(site_url, sitemapUrls)
          siteContextPrompt = formatBusinessContextForPrompt(businessCtx)
          if (businessCtx.sitemapUrlCount > 0) {
            log(`🗺 Sitemap: พบ ${businessCtx.sitemapUrlCount} หน้า · scrape context จาก ${businessCtx.pageTexts.length} หน้าหลัก`)
          }
        } catch { log('⚠️ Crawl sitemap ไม่สำเร็จ — ดำเนินการต่อโดยไม่มี context') }
      }

      // ─ Step 0.5: Problem Discovery (Grounding) ─────────────────────────────
      let problemSeeds: string[] = []
      let discoveredProblems: DiscoveredProblem[] = []
      const allGroundingQueries: string[] = []
      const allGroundingUrls: string[] = []

      if (resolvedNiche && hasGemini && csv_rows.length === 0) {
        log(`🔍 Problem Discovery: ค้นหา customer problems ใน "${resolvedNiche}" จาก Google Search ...`)
        try {
          const { problems, groundingQueries, groundingUrls } = await runProblemDiscovery(resolvedNiche, siteContextPrompt)
          if (problems.length > 0) {
            discoveredProblems = problems
            problemSeeds = problems.flatMap(p => p.keywords_to_expand ?? []).filter(Boolean)
            for (const q of groundingQueries) { if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q) }
            for (const u of groundingUrls) { if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u) }
            log(`✓ Problem Discovery: พบ ${problems.length} problems · ${problemSeeds.length} keyword seeds · Grounding queries: ${groundingQueries.length}`)
            if (groundingQueries.length > 0) {
              log(`🌐 Hidden queries: ${groundingQueries.slice(0, 3).join(' | ')}`)
            }
          } else {
            log(`⚠️ Problem Discovery: ไม่พบ problems — ดำเนินการต่อโดยไม่มี`)
          }
        } catch (err: any) {
          log(`⚠️ Problem Discovery error: ${err?.message?.slice(0, 80)}`)
        }
      }

      // ─ Step 0.8: KP generateKeywordIdeas (WordGod pattern) ────────────────
      // ดึง keyword จริงจาก Google Keyword Planner ก่อน → inject เข้า pool
      // Gemini จะ expand เพิ่มเติมจาก KP keywords เหล่านี้
      const kpDirectPool: GeminiKw[] = []
      const excludeSet = new Set<string>(
        (businessCtx?.existingKeywords ?? []).map(k => k.trim().toLowerCase())
      )
      const FORUM_FILTER_KP = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i

      if (resolvedNiche && hasGemini && csv_rows.length === 0) {
        const kpConfig = loadGoogleAdsConfig()
        if (kpConfig) {
          try {
            log(`📐 KP Ideas: ดึง keyword ideas จาก Google Keyword Planner ...`)
            const kpAccessToken = await getAccessToken(kpConfig)
            // seeds = niche + problem seeds (ถ้ามี)
            const kpSeeds = [resolvedNiche, ...problemSeeds.slice(0, 19)].filter(Boolean)
            const kpRows = await getKPKeywordIdeas(kpSeeds, site_url || undefined, kpConfig, kpAccessToken)

            let kpAdded = 0
            for (const row of kpRows) {
              if (!row.keyword || row.volume === 0) continue
              if (FORUM_FILTER_KP.test(row.keyword)) continue
              const n = row.keyword.trim().toLowerCase()
              if (excludeSet.has(n)) continue
              excludeSet.add(n)
              kpDirectPool.push({
                keyword: row.keyword,
                volume_estimate: row.volume,
                competition: row.competition,
                opportunity_score: row.competition === 'LOW' ? 70 : row.competition === 'MEDIUM' ? 50 : 30,
                intent: 'informational',
                keyword_type: 'long_tail',
                reason: 'Google Keyword Planner',
              })
              kpAdded++
              if (kpAdded >= count) break
            }
            log(`✓ KP Ideas: ได้ ${kpAdded} keywords พร้อม real volume (จาก ${kpRows.length} ทั้งหมด)`)
            _kpKeywordCount += kpAdded
          } catch (err: any) {
            log(`⚠️ KP Ideas error: ${err?.message?.slice(0, 80)} — ดำเนินการต่อด้วย Gemini`)
          }
        }
      }

      // seedVolumeMap — short-tail KP anchors for annotating long-tail volume estimates
      const seedVolumeMap = new Map<string, number>()
      for (const kp of kpDirectPool) {
        const wordCount = kp.keyword.trim().split(/\s+/).length
        if (wordCount <= 3 && kp.volume_estimate > 0) {
          seedVolumeMap.set(kp.keyword.trim().toLowerCase(), kp.volume_estimate)
        }
      }

      // ─ Step 1: Keywords ─────────────────────────────────────────────────────
      let geminiKws: GeminiKw[] = []

      if (csv_rows.length > 0) {
        const CSV_CLASSIFY_BATCH = 50
        const csvVolumeMap = new Map(csv_rows.map((r: CsvInputRow) => [r.keyword.toLowerCase().trim(), Number(r.volume ?? 0)]))
        const totalBatches = Math.ceil(csv_rows.length / CSV_CLASSIFY_BATCH)
        log(`📋 CSV mode: ${csv_rows.length} keywords · แบ่งเป็น ${totalBatches} batch`)

        const buildClassifyPrompt = (batch: CsvInputRow[]): string => {
          const kwList = batch.map((r, i) => {
            const extras = [
              r.title            ? `title="${r.title}"` : '',
              r.page_type        ? `page_type="${r.page_type}"` : '',
              r.cluster          ? `cluster="${r.cluster}"` : '',
              r.page_tier        ? `tier="${r.page_tier}"` : '',
              r.keyword_group    ? `group="${r.keyword_group}"` : '',
              r.conversion_potential ? `conv=${r.conversion_potential}` : '',
              r.traffic_potential    ? `traffic=${r.traffic_potential}` : '',
              r.relevance_score      ? `relevance=${r.relevance_score}` : '',
            ].filter(Boolean).join(' | ')
            return `${i + 1}. "${r.keyword}" vol:${r.volume ?? 0}${extras ? ` [${extras}]` : ''}`
          }).join('\n')
          return `## WordGod — Keyword Classifier
Business: ${business_name || 'ไม่ระบุ'} | Category: ${category}

จงจัดหมวดหมู่ keywords ทุกตัวในรายการ (ต้อง return ครบทุกตัว จำนวน ${batch.length} keywords):
- intent: informational | commercial | transactional | comparison | problem_solving | review | checklist | local | navigational | price | service_seeking | update
- keyword_type: seed | long_tail | question | commercial | transactional | comparison | problem | price | review | checklist | money_keyword | supporting_keyword
- competition: Low | Medium | High
- opportunity_score: 1-100

CRITICAL: ต้อง return JSON ครบ ${batch.length} keywords ห้ามตัดออก

Keywords:
${kwList}

Return JSON only — ต้องมีครบ ${batch.length} items:
{"keywords": [{"keyword": "...", "volume_estimate": 0, "competition": "Low", "opportunity_score": 75, "intent": "informational", "keyword_type": "long_tail", "reason": "..."}]}`
        }

        if (hasGemini) {
          for (let start = 0; start < csv_rows.length; start += CSV_CLASSIFY_BATCH) {
            const batchNum = Math.floor(start / CSV_CLASSIFY_BATCH) + 1
            const batch = (csv_rows as CsvInputRow[]).slice(start, start + CSV_CLASSIFY_BATCH)
            log(`🤖 Gemini classify batch ${batchNum}/${totalBatches}: ${batch.length} keywords ...`)
            try {
              const classified = await callGeminiJson(buildClassifyPrompt(batch), {
                usageOperation: 'keyword_classify',
                usageLabels: { sub_function: 'csv_classify', batch: batchNum },
              }) as any
              if (classified?.keywords?.length) {
                const batchResults = classified.keywords.map((k: any) => ({
                  ...k,
                  volume_estimate: csvVolumeMap.get(k.keyword?.toLowerCase().trim()) ?? k.volume_estimate ?? 0,
                }))
                geminiKws.push(...batchResults)
                log(`✓ Batch ${batchNum}: ได้ ${batchResults.length}/${batch.length} keywords`)
              } else {
                geminiKws.push(...batch.map((r: CsvInputRow) => ({
                  keyword: r.keyword, volume_estimate: Number(r.volume ?? 0),
                  competition: 'UNSPECIFIED', opportunity_score: 50,
                  intent: classifyIntent(r.keyword), keyword_type: 'supporting_keyword', reason: 'imported',
                })))
                log(`⚠️ Batch ${batchNum}: fallback rule-based (${batch.length} keywords)`)
              }
            } catch {
              geminiKws.push(...batch.map((r: CsvInputRow) => ({
                keyword: r.keyword, volume_estimate: Number(r.volume ?? 0),
                competition: 'UNSPECIFIED', opportunity_score: 50,
                intent: classifyIntent(r.keyword), keyword_type: 'supporting_keyword', reason: 'imported',
              })))
              log(`⚠️ Batch ${batchNum}: Gemini error → fallback`)
            }
          }
        }

        if (geminiKws.length === 0) {
          geminiKws = csv_rows.map((r: CsvInputRow) => ({
            keyword: r.keyword, volume_estimate: Number(r.volume ?? 0),
            competition: 'UNSPECIFIED', opportunity_score: 50,
            intent: classifyIntent(r.keyword), keyword_type: 'supporting_keyword', reason: 'imported',
          }))
        }

      } else if (resolvedNiche && hasGemini) {
        // ── Serial batch pipeline — throttle enforces 1 call/5s globally ─────
        const BATCH_SIZE = 50  // keywords per Gemini call
        const PARALLEL   = 1   // serial — throttle handles pacing
        // KP pool นับเป็นส่วนหนึ่งของ count แล้ว — Gemini ขอแค่ส่วนที่ขาด
        const geminiTarget = Math.max(0, count - kpDirectPool.length)
        const totalBatches = geminiTarget > 0 ? Math.ceil(geminiTarget / BATCH_SIZE) : 0
        log(`🔍 Keyword Research: "${resolvedNiche}" · KP pool ${kpDirectPool.length} · Gemini เพิ่มอีก ${geminiTarget} · ${totalBatches} batches (serial, 5s/call)`)

        // excludeSet ใช้จาก Step 0.8 (มี KP keywords อยู่แล้ว)
        const allBatchResults: GeminiKw[][] = new Array(totalBatches).fill(null).map(() => [])

        for (let wave = 0; wave < totalBatches; wave += PARALLEL) {

          const waveIdxs = Array.from(
            { length: Math.min(PARALLEL, totalBatches - wave) },
            (_, i) => wave + i,
          )
          const alreadyFound = allBatchResults.flat().map(k => k.keyword)
          log(`🔄 Wave ${Math.floor(wave / PARALLEL) + 1}: batch ${wave + 1}–${wave + waveIdxs.length} (มีแล้ว ${alreadyFound.length}/${geminiTarget})...`)

          await Promise.all(waveIdxs.map(async (bi) => {
            const need = bi === totalBatches - 1
              ? geminiTarget - bi * BATCH_SIZE
              : BATCH_SIZE
            if (need <= 0) return

            const problemSeedHint = bi === 0 && problemSeeds.length > 0
              ? `\n### PROBLEM SEEDS (from customer research — prioritize these topics):\n${problemSeeds.slice(0, 20).join(', ')}\n`
              : ''
            const prompt = (bi === 0 && siteContextPrompt ? siteContextPrompt + '\n' : '') +
              problemSeedHint +
              KEYWORD_RESEARCH_PROMPT(
                resolvedNiche,
                resolvedNiche,
                need,
                [...Array.from(excludeSet), ...alreadyFound],
                alreadyFound,
                intentRatio,
                isKnowledgeMode,
              )

            try {
              const raw = await callGeminiJson(prompt, {
                usageOperation: 'keyword_research',
                usageLabels: { sub_function: 'niche_research', batch: bi + 1 },
              }) as any
              const batch: any[] = raw?.keywords ?? raw ?? []
              const results: GeminiKw[] = []
              for (const kw of batch) {
                if (!kw?.keyword) continue
                if (FORUM_FILTER.test(kw.keyword)) continue
                results.push({
                  keyword: kw.keyword,
                  volume_estimate: kw.volume_estimate ?? 0,
                  competition: kw.competition ?? 'UNSPECIFIED',
                  opportunity_score: kw.opportunity_score ?? 50,
                  intent: kw.intent ?? 'informational',
                  keyword_type: kw.keyword_type ?? 'long_tail',
                  reason: kw.reason ?? '',
                })
              }
              allBatchResults[bi] = results
              log(`✓ Batch ${bi + 1}/${totalBatches}: ได้ ${results.length} keywords`)
            } catch (err: any) {
              log(`⚠️ Batch ${bi + 1} error: ${err?.message?.slice(0, 80)}`)
              allBatchResults[bi] = []
            }
          }))
        }

        // Merge Gemini results + deduplicate
        for (const batchResult of allBatchResults) {
          for (const kw of batchResult) {
            if (geminiKws.length >= geminiTarget) break
            const n = kw.keyword.trim().toLowerCase()
            if (excludeSet.has(n)) continue
            excludeSet.add(n)
            geminiKws.push(kw)
          }
          if (geminiKws.length >= geminiTarget) break
        }

        // ── Step 2b: Problem-derived keyword expansion ──────────────────────
        // Runs AFTER Gemini batches merge — pushes directly to geminiKws (no cap)
        if (discoveredProblems.length > 0) {
          log(`[2b/4] Expanding problem-derived keywords...`)
          try {
            const problemExpandResult = await runProblemToKeywordExpander(
              discoveredProblems,
              resolvedNiche,
              excludeSet,
              log,
              callGeminiWithGrounding
            )
            for (const q of problemExpandResult.groundingQueries) {
              if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q)
            }
            for (const u of problemExpandResult.groundingUrls) {
              if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u)
            }
            for (const pk of problemExpandResult.keywords) {
              const n = pk.keyword.trim().toLowerCase()
              if (excludeSet.has(n)) continue
              excludeSet.add(n)
              geminiKws.push({
                keyword: pk.keyword,
                volume_estimate: pk.volume_estimate,
                competition: pk.competition,
                opportunity_score: 50,
                intent: pk.intent as any,
                keyword_type: 'problem' as any,
                reason: pk.original_problem,
              })
            }
            log(`[2b/4] Problem keywords added: ${problemExpandResult.keywords.length}`)
          } catch (err: any) {
            log(`⚠️ Step 2b error: ${err?.message?.slice(0, 80)}`)
          }
        }

        // ── Step 2.6: Competitor URL keyword signals from grounding ────────────
        if (allGroundingUrls.length > 0) {
          const existingNorms = new Set(Array.from(excludeSet))
          const competitorSignals = extractCompetitorKeywords(allGroundingUrls, [], existingNorms)
          let competitorInjected = 0
          for (const signal of competitorSignals) {
            if (signal.keyword.length < 8 || signal.source !== 'page_title') continue
            const norm = signal.keyword.toLowerCase().trim()
            if (excludeSet.has(norm)) continue
            excludeSet.add(norm)
            allBatchResults.push([{
              keyword: signal.keyword,
              volume_estimate: 0,
              competition: 'UNSPECIFIED',
              opportunity_score: 40,
              intent: 'informational',
              keyword_type: 'supporting_keyword',
              reason: `competitor signal: ${signal.url}`,
            }])
            competitorInjected++
          }
          if (competitorInjected > 0) {
            log(`🔗 Step 2.6: inject ${competitorInjected} competitor keyword signals จาก ${allGroundingUrls.length} URLs`)
          }
        }

        // ── Step 2.5: Inject grounding queries as verified seeds ───────────────
        if (allGroundingQueries.length > 0) {
          log(`[2.5/4] Grounding: harvested ${allGroundingQueries.length} hidden queries + ${allGroundingUrls.length} competitor URLs`)
          log(`[2.5/4] Hidden queries (sample): ${allGroundingQueries.slice(0, 5).join(' | ')}`)
          let injected = 0
          for (const q of allGroundingQueries) {
            const qn = q.trim().toLowerCase()
            if (excludeSet.has(qn)) continue
            excludeSet.add(qn)
            geminiKws.push({
              keyword: q,
              volume_estimate: 0,
              competition: 'UNSPECIFIED',
              opportunity_score: 40,
              intent: 'informational',
              keyword_type: 'seed',
              reason: 'grounding query',
            })
            injected++
          }
          if (injected > 0) log(`[2.5/4] Injected ${injected} grounding queries as verified seeds`)
        }

        // KP pool มาก่อน (real volume) ตามด้วย Gemini
        geminiKws = [...kpDirectPool, ...geminiKws]
        log(`📦 รวม keywords: ${geminiKws.length} ตัว (KP: ${kpDirectPool.length} + Gemini: ${geminiKws.length - kpDirectPool.length}) เป้าหมาย ${count}`)

      } else {
        push('error', { error: 'กรุณาใส่ Niche หรือ keywords' })
        ctrl.ref?.close()
        return
      }

      // Deduplicate
      const seen = new Set<string>()
      geminiKws = geminiKws.filter(k => {
        const n = k.keyword.trim().toLowerCase()
        if (seen.has(n)) return false
        seen.add(n); return true
      })

      // ─ Step 2: Google KP volumes (ข้ามถ้าเป็น CSV mode — ใช้ volume จากไฟล์) ─
      const normFn = (s: string) => s.toLowerCase().trim()
      const csvMap = new Map<string, CsvInputRow>(
        (csv_rows as CsvInputRow[]).map(r => [normFn(r.keyword), r])
      )

      let dfsVolumes = new Map<string, number>()
      if (csv_rows.length === 0) {
        log(`📊 ดึง search volume: KP primary → DFS fallback (${geminiKws.length} keywords) ...`)
        dfsVolumes = await fetchVolumes(geminiKws.map(k => k.keyword))
        log(`✓ Volume: ได้ ${dfsVolumes.size} keywords (KP: ${_kpKeywordCount}, DFS fallback: ${_dfsKeywordCount})`)

        // ── Step 2.55: KP historical metrics for keywords still missing volume ──
        const stillNoVolume = geminiKws.filter(k => {
          const v = dfsVolumes.get(k.keyword) ?? k.volume_estimate ?? 0
          return v === 0
        })
        const kpHistBatch = stillNoVolume.slice(0, 600)
        if (kpHistBatch.length > 0) {
          const kpCfg = loadGoogleAdsConfig()
          if (kpCfg) {
            log(`📐 Step 2.55: KP historical metrics สำหรับ ${kpHistBatch.length} keywords ที่ยังขาด volume ...`)
            try {
              const kpAT = await getAccessToken(kpCfg)
              const kpHistMap = await getKPVolumes(kpHistBatch.map(k => k.keyword), kpCfg, kpAT)
              let kpHistHits = 0
              kpHistMap.forEach((entry, kw) => {
                if (entry.volume > 0 && !dfsVolumes.has(kw)) {
                  dfsVolumes.set(kw, entry.volume)
                  kpHistHits++
                }
              })
              _kpKeywordCount += kpHistHits
              log(`✓ Step 2.55: KP historical ได้เพิ่ม ${kpHistHits} volumes`)
            } catch (err: any) {
              log(`⚠️ Step 2.55 error: ${err?.message?.slice(0, 80)}`)
            }
          }
        }
      } else {
        log(`📋 ใช้ volume จากไฟล์ CSV (ข้าม KP/DFS)`)
      }

      // ─ Step 3: AI titles ─────────────────────────────────────────────────────
      const needsTitles = geminiKws.filter(k => !csvMap.get(normFn(k.keyword))?.title)
      if (needsTitles.length > 0) {
        const titleBatches = Math.ceil(needsTitles.length / 25)
        log(`✍️ สร้าง SEO Titles: ${needsTitles.length} keywords · ${titleBatches} batches ...`)
      }
      const titleMap = hasGemini && needsTitles.length > 0
        ? await generateTitles(needsTitles, business_name, category)
        : new Map<string, TitleResult>()
      if (needsTitles.length > 0) log(`✓ Titles สำเร็จ: ${titleMap.size} titles`)

      // ─ Step 4: Enrich + AEO ─────────────────────────────────────────────────
      log(`⚡ AEO scoring + framework tagging ...`)
      const rows: KeywordRow[] = geminiKws.map((kw, i) => {
        const src        = csvMap.get(normFn(kw.keyword))
        const dfsVol     = dfsVolumes.get(kw.keyword) ?? 0
        const csvVol     = src?.volume ?? kw.volume_estimate ?? 0
        const realVolume = dfsVol > 0 ? dfsVol : csvVol
        const intent     = (kw.intent || classifyIntent(kw.keyword)) as SearchIntent
        const kwType     = kw.keyword_type as KeywordType

        let score = scoreOpportunity(realVolume, kw.competition, kw.intent)
        if (src?.conversion_potential) score = Math.min(100, score + Math.round((src.conversion_potential - 3) * 3))
        if (src?.relevance_score)      score = Math.min(100, score + Math.round((src.relevance_score - 3) * 2))

        const existingTitle = src?.title ?? ''
        const titleData     = titleMap.get(normFn(kw.keyword))
        const title         = existingTitle || titleData?.title || fallbackTitle(kw.keyword, kw.intent)
        const contentType   = resolveContentType(intent)
        const pageType      = src?.page_type ?? resolvePageType(intent, contentType)
        const autoSlug      = src?.slug ?? generateSlug(kw.keyword)
        const framework     = resolveFramework(intent, kwType, realVolume, {
          convPotential: src?.conversion_potential, trafficPotential: src?.traffic_potential,
        })
        // ── WordGod scoring layer ──────────────────────────────────────────────
        const journeyStage     = classifyJourneyStage(kw.keyword, intent)
        const topicClusterRole = detectTopicClusterRole(kw.keyword, intent)
        const { risk, ai_resilience_score } = classifyAISearchRisk(kw.keyword, intent, contentType)
        const sales_impact_score = computeSalesImpactScore(intent, journeyStage, realVolume)
        const buyer_intent_score = computeBuyerIntentScore(intent)
        const volScore           = computeVolumeScore(realVolume)
        const aeoFields          = enrichWithAEO(kw.keyword, intent, ai_resilience_score, sales_impact_score)
        const gapFields          = scoreCompetitorGap(kw.keyword, kwType, intent, realVolume, aeoFields.aeo_opportunity_score ?? 0, topicClusterRole)
        const trendFields        = detectTrendSignal(kw.keyword, intent, kwType)
        const keyword_depth_score = computeKeywordDepthScore(kw.keyword, topicClusterRole)
        const internal_link_opp   = computeInternalLinkOpportunityScore(kw.keyword, intent, topicClusterRole)
        const pain_urgency        = computeCustomerPainUrgencyScore(kw.keyword, undefined, journeyStage)
        const anchor_text         = suggestAnchorText(kw.keyword, intent)
        const knowledgeScore      = computeKnowledgeImpactScore(kw.keyword, intent)

        const intentBucket: IntentBucket =
          ['commercial', 'comparison', 'review'].includes(intent) ? 'commercial' :
          ['transactional', 'service_seeking', 'price'].includes(intent) ? 'transactional' :
          ['navigational'].includes(intent) ? 'navigational' :
          ['update'].includes(intent) ? 'update' : 'informational'

        const bucketBase = { volume_score: volScore, ai_resilience_score, sales_impact_score, buyer_intent_score }
        const intent_bucket_score = computeIntentBucketScore(kw.keyword, intent, intentBucket, bucketBase)

        const allScores: AllScores = {
          opportunity_score: score,
          sales_impact_score,
          buyer_intent_score,
          problem_urgency_score: 50,
          ai_resilience_score,
          cluster_potential_score: 50,
          volume_score: volScore,
          intent_bucket: intentBucket,
          intent_bucket_score,
          keyword_depth_score,
          internal_link_opportunity_score: internal_link_opp,
          customer_pain_urgency_score: pain_urgency,
        }
        const priority_score = computePriorityScore(allScores, 'hybrid')

        return {
          no: i + 1, keyword: kw.keyword, title, volume: realVolume,
          intent, keyword_type: kwType, priority: resolvePriority(score),
          opportunity_score: score, content_type: contentType, page_type: pageType,
          slug: autoSlug, notes: kw.reason || '',
          topic_cluster_role: topicClusterRole,
          // AEO
          aeo_opportunity: aeoFields.aeo_opportunity,
          aeo_opportunity_score: aeoFields.aeo_opportunity_score,
          ai_overview_risk: aeoFields.ai_overview_risk,
          ai_overview_risk_score: aeoFields.ai_overview_risk_score,
          direct_answer_potential: aeoFields.direct_answer_potential,
          featured_snippet_potential: aeoFields.featured_snippet_potential,
          question_pattern: aeoFields.question_pattern,
          answer_format_recommendation: aeoFields.answer_format_recommendation,
          ai_search_priority_score: aeoFields.ai_search_priority_score,
          ai_search_priority_level: aeoFields.ai_search_priority_level,
          // WordGod scoring
          journey_stage: journeyStage,
          ai_search_risk: risk,
          ai_resilience_score,
          sales_impact_score,
          buyer_intent_score,
          priority_score,
          intent_bucket_score,
          keyword_depth_score,
          internal_link_opportunity_score: internal_link_opp,
          customer_pain_urgency_score: pain_urgency,
          suggested_anchor_text: anchor_text,
          // Competitor gap
          gap_score: gapFields.gap_score,
          gap_level: gapFields.gap_level,
          gap_reasons: gapFields.gap_reasons,
          // Trend
          trend_type: trendFields.trend_type,
          trend_score: trendFields.trend_score,
          refresh_priority: trendFields.refresh_priority,
          content_notes: trendFields.content_notes,
          // Volume source tag — 4 types matching WordGod
          volume_source: (() => {
            const kn = kw.keyword.toLowerCase().trim()
            const kpEntry = kpDirectPool.find(k => k.keyword.toLowerCase().trim() === kn)
            if (kpEntry) return 'keyword_planner'
            if (dfsVolumes.has(kn)) {
              // check if came from KP historical (added to dfsVolumes in step 2.55)
              const wasKpHist = _kpKeywordCount > 0 && !_dfsKeywordCount
              return wasKpHist ? 'planner_variant' : 'dataforseo'
            }
            // Check seedVolumeMap — parent volume exists → planner_variant
            const seedMatch = Array.from(seedVolumeMap.entries()).find(([seed]) => kn.includes(seed))
            if (seedMatch) return 'planner_variant'
            return 'gemini_estimated'
          })(),
          ...framework,
          ...(src?.cluster && { cluster: src.cluster }),
          ...(src?.page_tier && { page_tier: src.page_tier }),
          ...(src?.status && { status: src.status }),
          ...(src?.action && { action: src.action }),
          ...(src?.section && { section: src.section }),
          ...(src?.keyword_group && { keyword_group: src.keyword_group }),
          ...(src?.current_url && { current_url: src.current_url }),
          ...(src?.conversion_potential != null && { conversion_potential: src.conversion_potential }),
          ...(src?.traffic_potential != null && { traffic_potential: src.traffic_potential }),
          ...(src?.relevance_score != null && { relevance_score: src.relevance_score }),
        }
      })

      // ── Step 3b: Boost real-volume keywords + Intent-bucket allocation ────────
      // Boost keywords with verified real volume (more reliable than estimates)
      for (const row of rows) {
        if (row.volume_source === 'keyword_planner' || row.volume_source === 'planner_variant' || row.volume_source === 'dataforseo') {
          row.intent_bucket_score = (row.intent_bucket_score ?? 0) + 15
          row.priority_score = (row.priority_score ?? 0) + 15
        }
      }

      // Intent-bucket allocation — select keywords to match intentRatio targets
      const mapBucket = (intent: string): IntentBucket =>
        ['commercial', 'comparison', 'review'].includes(intent) ? 'commercial' :
        ['transactional', 'service_seeking', 'price'].includes(intent) ? 'transactional' :
        ['navigational'].includes(intent) ? 'navigational' :
        ['update'].includes(intent) ? 'update' : 'informational'

      const keywordTier = (r: KeywordRow) => {
        const hasProblem = !!(r.customer_problem || r.notes)
        const hasVol = r.volume > 0
        if (hasProblem && hasVol) return 1
        if (hasVol) return 2
        if (hasProblem) return 3
        return 4
      }

      if (rows.length > count) {
        // Pre-select real-volume keywords (cap at 60% of count)
        const realVol = rows
          .filter(r => r.volume_source === 'keyword_planner' || r.volume_source === 'planner_variant' || r.volume_source === 'dataforseo')
          .sort((a, b) => b.volume - a.volume)
        const guaranteed = realVol.slice(0, Math.floor(count * 0.6))
        const guaranteedSet = new Set(guaranteed.map(r => r.keyword))
        const remaining = rows.filter(r => !guaranteedSet.has(r.keyword))
        const remainTarget = count - guaranteed.length

        // Group remaining by bucket and fill per ratio
        const buckets: Record<IntentBucket, KeywordRow[]> = { informational: [], commercial: [], transactional: [], navigational: [], update: [] }
        for (const r of remaining) buckets[mapBucket(r.intent)].push(r)
        for (const b of Object.keys(buckets) as IntentBucket[]) {
          buckets[b].sort((a, b2) => (b2.intent_bucket_score ?? 0) - (a.intent_bucket_score ?? 0))
        }
        const bucketKeys: IntentBucket[] = ['informational', 'commercial', 'transactional', 'navigational', 'update']
        const ratioMap: Record<IntentBucket, number> = {
          informational: intentRatio.informational, commercial: intentRatio.commercial,
          transactional: intentRatio.transactional, navigational: intentRatio.navigational, update: intentRatio.update,
        }
        const selected: KeywordRow[] = [...guaranteed]
        const remainder2: KeywordRow[] = []
        let allocated = 0
        const activeBuckets = bucketKeys.filter(b => ratioMap[b] > 0)
        const quotas: Record<IntentBucket, number> = {} as any
        for (let i = 0; i < activeBuckets.length; i++) {
          const b = activeBuckets[i]
          quotas[b] = i === activeBuckets.length - 1 ? remainTarget - allocated : Math.round(remainTarget * ratioMap[b] / 100)
          allocated += quotas[b]
        }
        for (const b of bucketKeys) {
          if (!quotas[b]) quotas[b] = 0
          selected.push(...buckets[b].slice(0, quotas[b]))
          remainder2.push(...buckets[b].slice(quotas[b]))
        }
        // Fill remaining slots from remainder sorted by tier + bucket score
        if (selected.length < count) {
          remainder2.sort((a, b2) => {
            const td = keywordTier(a) - keywordTier(b2)
            return td !== 0 ? td : (b2.intent_bucket_score ?? 0) - (a.intent_bucket_score ?? 0)
          })
          selected.push(...remainder2.slice(0, count - selected.length))
        }
        // Final sort by tier + bucket score
        selected.sort((a, b2) => {
          const td = keywordTier(a) - keywordTier(b2)
          return td !== 0 ? td : (b2.intent_bucket_score ?? 0) - (a.intent_bucket_score ?? 0)
        })
        rows.length = 0
        rows.push(...selected)
        log(`[3b/4] Intent-bucket allocation done: ${rows.length} keywords selected (strategy: hybrid)`)
      }

      // ── Step 3b: Article Grouping + QA Validator ──────────────────────────────
      log(`📐 Step 3b: Article grouping + QA validation ...`)
      const articleGroupMap = await runArticleGroupingDecisionEngine(
        rows.map(r => ({ keyword: r.keyword, intent: r.intent, volume: r.volume, journey_stage: r.journey_stage })),
        resolvedNiche || category,
        log
      )
      for (const row of rows) {
        const group = articleGroupMap.get(row.keyword)
        if (group) {
          row.article_group = group.article_group
          row.merge_or_split = group.merge_or_split
          row.primary_keyword = group.primary_keyword
          row.secondary_keywords = group.secondary_keywords
        }
        // QA
        const qa = validateKeywordResearchQA({
          keyword: row.keyword, intent: row.intent, journey_stage: row.journey_stage,
          ai_search_risk: row.ai_search_risk, sales_impact_score: row.sales_impact_score,
          priority_score: row.priority_score, volume: row.volume,
          customer_problem: row.customer_problem, article_group: row.article_group,
          internal_link_opportunity_score: row.internal_link_opportunity_score,
          intent_bucket: intentBucketOf(row.intent),
        })
        row.qa_passes = qa.passes
        row.qa_warnings = qa.warnings.length > 0 ? qa.warnings : undefined
      }
      log(`✓ Step 3b: ${articleGroupMap.size} article groups · ${rows.filter(r => r.qa_passes).length}/${rows.length} QA passed`)

      rows.sort((a, b) => (b.priority_score ?? b.opportunity_score) - (a.priority_score ?? a.opportunity_score))
      rows.forEach((r, i) => { r.no = i + 1 })

      // ─ Step 5: Topic Cluster ─────────────────────────────────────────────────
      log(`🗂 Topic Clustering: จัดกลุ่ม ${rows.length} keywords ...`)
      let clusters: ClusterResult = { clusters: [], ungrouped: [] }
      if (rows.length > 0 && hasGemini) {
        try {
          const clusterInput: ClusterPipelineKeyword[] = rows.map(r => ({
            keyword: r.keyword, title: r.title, volume: r.volume,
            opportunity_score: r.opportunity_score, priority: r.priority,
            intent: r.intent, aeo_question: '',
          }))
          clusters = await clusterKeywords(
            clusterInput,
            category || business_name,
            (prompt) => callGeminiJson(prompt, {
              usageOperation: 'topic_cluster',
              usageLabels: { sub_function: 'cluster_keywords' },
            }),
          )
          log(`✓ จัดกลุ่มได้ ${clusters.clusters.length} topic clusters`)
        } catch (err: any) {
          log(`⚠️ Cluster error: ${err?.message?.slice(0, 60)}`)
        }
      }

      // ─ Step 6: Log AIJob ─────────────────────────────────────────────────────
      if (orgId) {
        const geminiCost = estimateGeminiCost(_geminiTokensAccum)
        const jobType    = csv_rows.length > 0 ? 'KEYWORD_CLASSIFY' : 'KEYWORD_RESEARCH'
        logAIJob({
          organizationId: orgId, projectId: project_id, jobType,
          modelProvider: 'GEMINI', modelName: GEMINI_MODEL, status: 'SUCCESS',
          tokenUsed: _geminiTokensAccum, estimatedCost: geminiCost, createdById: userId,
          inputSummary: `${jobType} — ${rows.length} keywords · ${Math.round((Date.now() - startedAt) / 1000)}s`,
        }).catch(() => {})
        if (_kpKeywordCount > 0) {
          logAIJob({
            organizationId: orgId, projectId: project_id, jobType: 'KP_VOLUME_LOOKUP',
            modelProvider: 'GOOGLE', modelName: 'google_ads/keyword_planner', status: 'SUCCESS',
            externalCost: 0, externalCalls: _kpKeywordCount, externalApi: 'GoogleKeywordPlanner',
            createdById: userId, inputSummary: `Google KP — ${_kpKeywordCount} lookups`,
          }).catch(() => {})
        }
        if (_dfsKeywordCount > 0) {
          const DFS_COST = 0.003
          logAIJob({
            organizationId: orgId, projectId: project_id, jobType: 'DFS_VOLUME_LOOKUP',
            modelProvider: 'DATAFORSEO', modelName: 'google_ads/search_volume/live', status: 'SUCCESS',
            externalCost: _dfsKeywordCount * DFS_COST, externalCalls: _dfsKeywordCount, externalApi: 'DataForSEO',
            createdById: userId, inputSummary: `DFS fallback — ${_dfsKeywordCount} lookups`,
          }).catch(() => {})
        }
      }

      const siteMeta = businessCtx ? {
        sitemap_url_count: businessCtx.sitemapUrlCount,
        pages_scraped: businessCtx.pageTexts.length,
        existing_topic_count: businessCtx.existingKeywords.length,
      } : null

      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      log(`✅ เสร็จแล้ว: ${rows.length} keywords · ${clusters.clusters.length} clusters · ${elapsed}s`)

      if (orgId && project_id) {
        logActivity({ organizationId: orgId, userId, action: 'RUN', entityType: 'KeywordResearch', entityId: project_id, newValue: `${rows.length} keywords · niche: ${resolvedNiche} · ${elapsed}s` }).catch(() => {})
      }

      push('result', { business_name, category, rows, clusters, intent_ratio: intentRatio, site_meta: siteMeta })

    } catch (e: unknown) {
      console.error('[wordgod/keywords]', e)
      push('error', { error: String(e) })
    } finally {
      ctrl.ref?.close()
    }
  })()

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
