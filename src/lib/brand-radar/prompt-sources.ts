/**
 * Brand Radar — prompt candidate sources. Nothing here saves anything: every function returns candidates
 * for the user to pick from. A source that is not connected or has no data returns connected:false and a note
 * that says what is missing. No prompt, volume or result is ever invented.
 */
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { dfsPost, hasDfsCreds, DFS_COST } from '@/lib/dfsClient'
import { getGSCServiceAuth } from '@/lib/google-auth'
import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS, orChat } from '@/lib/openrouter'
import { PBN_PREFS_MARK } from '@/lib/upload-article/pbn'
import { LANGUAGE_BOTH, resolveLanguage } from './language'
import { hostOf } from './normalize'
import { classifyIntent, classifyJourney, guessTopic, markDuplicates, textKey } from './prompts'
import { parseStrings, errMsg, type RadarCtx } from './server'
import { COUNTRIES, LIMITS, aiJobProjectId, type PromptCandidate, type PromptGenerateRes, type PromptSource } from './types'

export const GENERATE_SOURCES: readonly PromptSource[] = ['ai_generated', 'gsc', 'keyword_database', 'paa_provider']

const NOTE_AI = 'AI generated. These are not real user queries.'

function clampCount(n: number | undefined): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return LIMITS.generateMin
  return Math.min(LIMITS.generateMax, Math.max(LIMITS.generateMin, v))
}

interface ProfileLite {
  brandName: string; industry: string; country: string; language: string; products: string[]; competitors: string[]
}

async function loadProfileLite(ctx: RadarCtx): Promise<ProfileLite | null> {
  const where = { organizationId: ctx.orgId, projectId: ctx.project.id }
  const [p, comps] = await Promise.all([
    prisma.brandRadarProfile.findFirst({ where }),
    prisma.brandRadarCompetitor.findMany({ where: { ...where, status: 'ACTIVE' }, select: { name: true } }),
  ])
  if (!p) return null
  return {
    brandName: p.brandName, industry: p.industry, country: p.country, language: p.language,
    products: parseStrings(p.products), competitors: comps.map((c) => c.name),
  }
}

async function existingTexts(ctx: RadarCtx): Promise<string[]> {
  const rows = await prisma.brandRadarPrompt.findMany({
    where: { organizationId: ctx.orgId, projectId: ctx.project.id }, select: { text: true },
  })
  return rows.map((r) => r.text)
}

/** Dedupe inside the batch by exact key, classify, then mark near-duplicates against existing prompts. */
function finish(
  raw: Array<{ text: string; keyword?: string; searchVolume?: number | null }>,
  source: PromptSource, profile: ProfileLite, existing: string[], limit: number,
): PromptCandidate[] {
  const seen = new Set<string>()
  const out: PromptCandidate[] = []
  for (const r of raw) {
    const text = r.text.trim().slice(0, LIMITS.promptTextMax)
    const key = textKey(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const intent = classifyIntent(text)
    out.push({
      text,
      source,
      intent,
      journeyStage: classifyJourney(intent),
      topic: guessTopic(text, r.keyword),
      keyword: r.keyword ?? '',
      searchVolume: r.searchVolume ?? null,
      country: profile.country,
      language: resolveLanguage(profile.language, text),
      priority: 'medium',
    })
    if (out.length >= limit) break
  }
  return markDuplicates(out, existing)
}

const NO_PROFILE: Omit<PromptGenerateRes, 'source'> = {
  connected: false, candidates: [], note: 'Set up the brand profile in Settings first. Prompts are generated from it.',
}

// ── AI generated ─────────────────────────────────────────────────────────────

async function fromAi(ctx: RadarCtx, count: number, seed: string, profile: ProfileLite): Promise<PromptGenerateRes> {
  const lang = profile.language === LANGUAGE_BOTH
    ? 'a mix: about half of the questions in Thai and half in English'
    : profile.language === 'th' ? 'Thai' : 'English'
  const prompt = [
    `You write realistic questions that people type to AI assistants (ChatGPT, Gemini, Perplexity, Claude).`,
    `Brand: ${profile.brandName || ctx.project.clientName}`,
    `Industry: ${profile.industry || 'not specified'}`,
    `Products or services: ${profile.products.join(', ') || 'not specified'}`,
    `Known competitors: ${profile.competitors.join(', ') || 'none listed'}`,
    `Country: ${profile.country}. Language of the questions: ${lang}.`,
    seed ? `Focus area: ${seed}` : '',
    `Write exactly ${count} different questions a potential customer might ask while researching, comparing or choosing in this market.`,
    `Mix informational, recommendation, comparison, price and problem-solving questions. Do not put the brand name in most of them.`,
    `Each question must be natural, under 200 characters, and self-contained.`,
    `Return only JSON: {"prompts": ["question 1", "question 2", ...]}`,
  ].filter(Boolean).join('\n')

  const model = OR_MODELS.default()
  let text = ''
  try {
    const res = await orChat({
      trace: 'brand_radar_prompt_generate', client: ctx.project.clientName || ctx.project.name, prompt, model,
      jsonMode: true, maxTokens: 8000, temperature: 0.8, timeoutMs: 120_000,
    })
    text = res.text
    await logAIJob({
      organizationId: ctx.orgId, projectId: aiJobProjectId(ctx.project.id), jobType: 'BRAND_RADAR_PROMPT_GEN', modelProvider: 'openrouter',
      modelName: model, status: 'SUCCESS', tokenUsed: res.usage.totalTokens, estimatedCost: res.usage.costUsd,
      createdById: ctx.userId, inputSummary: `count=${count} seed=${seed}`,
    })
  } catch (e) {
    await logAIJob({
      organizationId: ctx.orgId, projectId: aiJobProjectId(ctx.project.id), jobType: 'BRAND_RADAR_PROMPT_GEN', modelProvider: 'openrouter',
      modelName: model, status: 'FAILED', errorMessage: errMsg(e), createdById: ctx.userId, inputSummary: `count=${count} seed=${seed}`,
    })
    throw new Error(`AI prompt generation failed: ${errMsg(e)}`)
  }

  let list: unknown[] = []
  try {
    const parsed = JSON.parse(text) as { prompts?: unknown }
    if (Array.isArray(parsed.prompts)) list = parsed.prompts
  } catch {
    throw new Error('AI prompt generation returned an unreadable answer. Try again.')
  }
  const raw = list.filter((x): x is string => typeof x === 'string').map((t) => ({ text: t }))
  const candidates = finish(raw, 'ai_generated', profile, await existingTexts(ctx), count)
  return { source: 'ai_generated', connected: true, candidates, note: NOTE_AI }
}

// ── Google Search Console ────────────────────────────────────────────────────

const EN_Q = /^(what|how|why|which|where|when|who|whom|can|could|is|are|does|do|did|should|will|would)\b/i
const TH_Q = new RegExp('อะไร|ยังไง|อย่างไร|ทำไม|เท่าไหร่|เท่าไร|ที่ไหน|เมื่อไหร่|ใคร|ไหม|หรือไม่|หรือเปล่า|แบบไหน|ตัวไหน|วิธี')

export function looksLikeQuestion(q: string): boolean {
  const t = q.trim()
  return t.includes('?') || t.includes('？') || EN_Q.test(t) || TH_Q.test(t)
}

async function findGscSite(ctx: RadarCtx): Promise<string> {
  const host = hostOf(ctx.project.website)
  if (!host) return ''
  const clients = await prisma.uploadClient.findMany({
    where: { organizationId: ctx.orgId, NOT: { pushPrefs: { contains: PBN_PREFS_MARK } } },
    select: { website: true, pushPrefs: true },
  })
  for (const c of clients) {
    if (hostOf(c.website) !== host) continue
    try {
      const prefs = JSON.parse(c.pushPrefs || '{}') as { gscReport?: { siteUrl?: string } }
      const site = prefs.gscReport?.siteUrl
      if (typeof site === 'string' && site) return site
    } catch { /* ignore broken JSON */ }
  }
  return ''
}

async function fromGsc(ctx: RadarCtx, count: number, profile: ProfileLite): Promise<PromptGenerateRes> {
  const siteUrl = await findGscSite(ctx)
  if (!siteUrl) {
    return {
      source: 'gsc', connected: false, candidates: [],
      note: 'No Google Search Console property is linked to this client. Open the Upload Article client with the same website, choose the GSC site in its Report tab, and make sure the service account has access.',
    }
  }
  const end = new Date()
  const start = new Date(end.getTime() - 90 * 86_400_000)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  let rows: Array<{ keys?: string[] | null; impressions?: number | null }> = []
  try {
    const auth = await getGSCServiceAuth()
    const sc = google.searchconsole({ version: 'v1', auth })
    const res = await sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate: day(start), endDate: day(end), dimensions: ['query'], rowLimit: 5000, type: 'web' },
    })
    rows = res.data.rows ?? []
  } catch (e) {
    return { source: 'gsc', connected: false, candidates: [], note: `Google Search Console could not be read (${errMsg(e).slice(0, 160)}). Check that the service account can access ${siteUrl}.` }
  }
  const questions = rows
    .map((r) => ({ text: String(r.keys?.[0] ?? ''), impressions: r.impressions ?? 0 }))
    .filter((r) => r.text && looksLikeQuestion(r.text))
    .sort((a, b) => b.impressions - a.impressions)
  if (questions.length === 0) {
    return { source: 'gsc', connected: true, candidates: [], note: `Connected to ${siteUrl}, but no question-like search queries were found in the last 90 days.` }
  }
  const candidates = finish(
    questions.map((q) => ({ text: q.text, keyword: q.text, searchVolume: Math.round(q.impressions) })),
    'gsc', profile, await existingTexts(ctx), Math.max(count, LIMITS.generateMin),
  )
  return {
    source: 'gsc', connected: true, candidates,
    note: `Real search queries from Google Search Console (${siteUrl}, last 90 days). Search volume shown is GSC impressions over those 90 days, not monthly search volume.`,
  }
}

// ── Keyword database ─────────────────────────────────────────────────────────

async function fromKeywords(ctx: RadarCtx, count: number, profile: ProfileLite): Promise<PromptGenerateRes> {
  // ctx.project is already verified to belong to ctx.orgId.
  const rows = await prisma.keyword.findMany({
    where: { projectId: ctx.project.id }, select: { keyword: true, volume: true }, orderBy: { createdAt: 'desc' }, take: 1000,
  })
  if (rows.length === 0) {
    return { source: 'keyword_database', connected: false, candidates: [], note: "This client's keyword bank is empty. Run Keyword Research for the project first." }
  }
  rows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
  const candidates = finish(
    rows.map((r) => ({ text: r.keyword, keyword: r.keyword, searchVolume: r.volume })),
    'keyword_database', profile, await existingTexts(ctx), Math.max(count, LIMITS.generateMin),
  )
  return {
    source: 'keyword_database', connected: true, candidates,
    note: 'Keywords from this client\'s keyword bank, used as written with their stored search volume. Rewrite them as questions if you want a more natural prompt.',
  }
}

// ── People Also Ask (DataForSEO SERP) ────────────────────────────────────────

interface DfsPaaItem { type?: string; title?: string; items?: Array<{ title?: string }> }
interface DfsSerpRes { tasks?: Array<{ cost?: number; result?: Array<{ items?: DfsPaaItem[] }> | null }> }

async function fromPaa(ctx: RadarCtx, seed: string, profile: ProfileLite): Promise<PromptGenerateRes> {
  const keyword = (seed || profile.products[0] || profile.industry || '').trim()
  if (!hasDfsCreds()) {
    return { source: 'paa_provider', connected: false, candidates: [], note: 'DataForSEO is not configured on the server (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).' }
  }
  if (!keyword) {
    return { source: 'paa_provider', connected: false, candidates: [], note: 'Enter a seed keyword, or add products or an industry to the brand profile, so there is something to search for.' }
  }
  const country = COUNTRIES.find((c) => c.code === profile.country) ?? COUNTRIES[0]
  let cost: number = DFS_COST.serp
  let questions: string[] = []
  try {
    const res = await dfsPost<DfsSerpRes>('/serp/google/organic/live/advanced', [{
      keyword, location_code: country.dfsLocationCode, language_code: resolveLanguage(profile.language, keyword), depth: 10,
    }])
    const task = res.tasks?.[0]
    if (typeof task?.cost === 'number') cost = task.cost
    const items = task?.result?.[0]?.items ?? []
    for (const it of items) {
      if (it.type !== 'people_also_ask') continue
      for (const q of it.items ?? []) if (q.title) questions.push(q.title)
    }
    await logAIJob({
      organizationId: ctx.orgId, projectId: aiJobProjectId(ctx.project.id), jobType: 'BRAND_RADAR_PROMPT_GEN', modelProvider: 'dataforseo',
      modelName: 'serp_organic_live_advanced', status: 'SUCCESS', externalCost: cost, externalCalls: 1,
      externalApi: 'dataforseo_serp_paa', createdById: ctx.userId, inputSummary: `paa seed=${keyword}`,
    })
  } catch (e) {
    await logAIJob({
      organizationId: ctx.orgId, projectId: aiJobProjectId(ctx.project.id), jobType: 'BRAND_RADAR_PROMPT_GEN', modelProvider: 'dataforseo',
      modelName: 'serp_organic_live_advanced', status: 'FAILED', externalCalls: 1, externalApi: 'dataforseo_serp_paa',
      errorMessage: errMsg(e), createdById: ctx.userId, inputSummary: `paa seed=${keyword}`,
    })
    return { source: 'paa_provider', connected: false, candidates: [], note: `The SERP provider call failed (${errMsg(e).slice(0, 160)}).` }
  }
  questions = questions.map((q) => q.trim()).filter(Boolean)
  if (questions.length === 0) {
    return { source: 'paa_provider', connected: true, candidates: [], note: `Google returned no People Also Ask box for "${keyword}" in ${country.label}. Try another seed keyword.` }
  }
  const candidates = finish(questions.map((q) => ({ text: q, keyword })), 'paa_provider', profile, await existingTexts(ctx), LIMITS.generateMax)
  return {
    source: 'paa_provider', connected: true, candidates,
    note: `People Also Ask questions Google showed for "${keyword}" (${country.label}). Search volume is unknown for these.`,
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function generateCandidates(ctx: RadarCtx, source: PromptSource, count: number | undefined, seed: string | undefined): Promise<PromptGenerateRes> {
  const profile = await loadProfileLite(ctx)
  if (!profile) return { source, ...NO_PROFILE }
  const cleanSeed = (seed ?? '').trim().slice(0, 200)
  switch (source) {
    case 'ai_generated': return fromAi(ctx, clampCount(count), cleanSeed, profile)
    case 'gsc': return fromGsc(ctx, clampCount(count), profile)
    case 'keyword_database': return fromKeywords(ctx, clampCount(count), profile)
    case 'paa_provider': return fromPaa(ctx, cleanSeed, profile)
    default:
      return { source, connected: false, candidates: [], note: 'This source cannot generate prompts. Add them manually or import a CSV.' }
  }
}
