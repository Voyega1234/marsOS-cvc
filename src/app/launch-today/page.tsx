'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import AppShell from '@/components/layout/AppShell'
import {
  Zap, Plus, X, Loader2, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, Trash2, Edit3, Check, Wand2,
  Send, ShieldCheck, Building2, ChevronRight, AlertCircle,
  Users, Download,
} from 'lucide-react'
import type { CampaignBlueprintItem } from '@/types'
import { AccountSelect } from '@/components/ui/AccountSelect'

// ── Types ──────────────────────────────────────────────────────────────────────

interface KwIdea {
  keyword: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  suggestedCpc: number
  selected: boolean
}

interface AudienceSignals {
  customIntent: string[]
  remarketing: string[]
  inMarket: string[]
  searchThemes: string[]
}

interface Sitelink {
  text: string
  description1: string
  description2: string
  finalUrl: string
}

interface AdAsset {
  headlines: string       // one per line
  longHeadlines: string   // one per line ≤90 (PMax 5 / Display 1 / Demand Gen·Video 1+)
  descriptions: string    // one per line
  businessName: string
  finalUrl: string
  displayPath1: string    // ≤15 no spaces (Search)
  displayPath2: string
  sitelinks: Sitelink[]   // Search/PMax — ≥4 for full asset coverage
  callouts: string        // one per line ≤25 (Search/PMax)
  snippetHeader: string   // structured snippet header e.g. "บริการ"
  snippetValues: string   // one per line
  videoUrls: string       // YouTube URLs one per line (PMax/Demand Gen — optional)
  images: { assetType: string; imageUrl: string }[]   // LOGO / MARKETING_IMAGE / SQUARE_MARKETING_IMAGE / PORTRAIT_MARKETING_IMAGE
}

interface Campaign {
  id: string
  name: string
  type: CampaignType
  dailyBudget: number
  bidStrategy: string
  targetLocation: string
  keywords: KwIdea[]
  audienceSignals: AudienceSignals
  searchThemes: string[]
  ad: AdAsset
  done: boolean
}

// NOTE: no VIDEO — Google Ads API blocks creating Video campaigns entirely
// (MUTATE_NOT_ALLOWED, verified 2026-07-02). Video ads run via DEMAND_GEN instead.
type CampaignType = 'SEARCH' | 'PMAX' | 'DEMAND_GEN' | 'DISPLAY' | 'REMARKETING'

// ── Constants ──────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES: { value: CampaignType; label: string; desc: string; color: string }[] = [
  { value: 'SEARCH',      label: 'Search',      desc: 'Keyword-based text ads on Google Search', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'PMAX',        label: 'PMax',         desc: 'AI-driven across all Google inventory',   color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'DEMAND_GEN',  label: 'Demand Gen',   desc: 'Visual ads on YouTube, Discover, Gmail',  color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'DISPLAY',     label: 'Display',      desc: 'Banner ads across Google Display Network', color: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'REMARKETING', label: 'Remarketing',  desc: 'Re-engage past website visitors',          color: 'bg-amber-50 text-amber-700 border-amber-200' },
]

const BID_STRATEGIES: Record<CampaignType, string[]> = {
  SEARCH:      ['Maximize Conversions', 'Target CPA', 'Target ROAS', 'Maximize Clicks', 'Manual CPC'],
  PMAX:        ['Maximize Conversions', 'Target CPA', 'Target ROAS'],
  DEMAND_GEN:  ['Maximize Conversions', 'Target CPA', 'Maximize Clicks'],
  DISPLAY:     ['Maximize Conversions', 'Target CPA', 'Maximize Clicks', 'CPM'],
  REMARKETING: ['Target CPA', 'Maximize Conversions', 'Target ROAS', 'Manual CPC'],
}

// Google Ads asset requirements per campaign type — drives generation targets,
// character-limit filtering, and the pre-push readiness checklist.
// h = headline target/limit · lh = long headline target · d = description target/limit
const AD_TARGETS: Record<CampaignType, { h: number; hMax: number; lh: number; d: number; dMax: number }> = {
  SEARCH:      { h: 15, hMax: 30, lh: 0, d: 4, dMax: 90 },
  PMAX:        { h: 15, hMax: 30, lh: 5, d: 5, dMax: 90 },
  DISPLAY:     { h: 5,  hMax: 30, lh: 1, d: 5, dMax: 90 },
  REMARKETING: { h: 5,  hMax: 30, lh: 1, d: 5, dMax: 90 },
  DEMAND_GEN:  { h: 5,  hMax: 40, lh: 1, d: 5, dMax: 90 },
}

const MATCH_COLORS: Record<string, string> = {
  BROAD:  'bg-rose-50 text-rose-700',
  PHRASE: 'bg-amber-50 text-amber-700',
  EXACT:  'bg-emerald-50 text-emerald-700',
}

const MATCH_LABELS: Record<string, string> = {
  BROAD: 'Broad', PHRASE: 'Phrase', EXACT: 'Exact',
}

const REMARKETING_LISTS = [
  'All Website Visitors (30d)', 'All Website Visitors (90d)',
  'Cart Abandoners', 'Past Converters',
  'YouTube Viewers', 'LINE Click Audience', 'Similar Audiences',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }

// Split a textarea value into trimmed non-empty lines
function lines(v: string): string[] {
  return v.split('\n').map(s => s.trim()).filter(Boolean)
}

function emptyAd(): AdAsset {
  return {
    headlines: '', longHeadlines: '', descriptions: '', businessName: '', finalUrl: '',
    displayPath1: '', displayPath2: '', sitelinks: [], callouts: '',
    snippetHeader: '', snippetValues: '', videoUrls: '', images: [],
  }
}

// Exact Google Ads dimensions per image slot — uploads get center-cropped to these
const CROP_SPECS: Record<string, { w: number; h: number }> = {
  LOGO:                     { w: 1200, h: 1200 },
  MARKETING_IMAGE:          { w: 1200, h: 628 },
  SQUARE_MARKETING_IMAGE:   { w: 1200, h: 1200 },
  PORTRAIT_MARKETING_IMAGE: { w: 960,  h: 1200 },
}

// Center-crop + resize in the browser so every upload matches the slot's aspect ratio
// exactly (Google rejects off-ratio images). Never upscales past the source resolution.
// Logos keep PNG (transparency); everything else exports JPEG.
async function cropToSpec(file: File, assetType?: string): Promise<File> {
  const spec = assetType ? CROP_SPECS[assetType] : undefined
  if (!spec) return file
  try {
    const img = await createImageBitmap(file)
    const targetRatio = spec.w / spec.h
    const srcRatio = img.width / img.height
    let sx = 0, sy = 0, sw = img.width, sh = img.height
    if (srcRatio > targetRatio) { sw = Math.round(img.height * targetRatio); sx = Math.round((img.width - sw) / 2) }
    else if (srcRatio < targetRatio) { sh = Math.round(img.width / targetRatio); sy = Math.round((img.height - sh) / 2) }
    const outW = Math.min(spec.w, sw)
    const outH = Math.round(outW / targetRatio)
    const canvas = document.createElement('canvas')
    canvas.width = outW; canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
    const isLogo = assetType === 'LOGO'
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, isLogo ? 'image/png' : 'image/jpeg', 0.92))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, isLogo ? '.png' : '.jpg'), { type: blob.type })
  } catch { return file }   // crop ล้มเหลว → อัปโหลดต้นฉบับตามเดิม
}

async function uploadImage(file: File, assetType?: string): Promise<string | null> {
  try {
    const cropped = await cropToSpec(file, assetType)
    const fd = new FormData(); fd.append('file', cropped)
    const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
    if (!res.ok) return null
    return (await res.json()).url ?? null
  } catch { return null }
}

// Detect the keyword theme from the campaign name so a "Brand" campaign pulls only brand
// keywords and a "Generic" campaign pulls generic/category keywords (not brand).
function campaignNameTheme(name: string): 'brand' | 'generic' | 'competitor' | null {
  const n = name.toLowerCase()
  if (/\bcompetitor|คู่แข่ง|compe?titor/.test(n)) return 'competitor'
  if (/\bbrand\b|แบรนด์/.test(n)) return 'brand'
  if (/\bgeneric\b|non[-\s]?brand|nonbrand|ทั่วไป/.test(n)) return 'generic'
  return null
}
function keywordMatchesTheme(group: string, theme: 'brand' | 'generic' | 'competitor' | null): boolean {
  if (!theme) return true
  const g = (group || '').toLowerCase()
  if (theme === 'competitor') return g === 'competitor' || g === 'competitors'   // เฉพาะคู่แข่งเท่านั้น — ห้ามปน generic
  if (theme === 'brand') return g === 'brand'
  return g === 'generic' || g === 'product' || g === 'service'  // generic = non-brand terms
}

function makeCampaign(overrides?: Partial<Campaign>): Campaign {
  return {
    id: uid(),
    name: '',
    type: 'SEARCH',
    dailyBudget: 500,
    bidStrategy: 'Maximize Conversions',
    targetLocation: 'ประเทศไทย',
    keywords: [],
    audienceSignals: { customIntent: [], remarketing: [], inMarket: [], searchThemes: [] },
    searchThemes: [],
    ad: emptyAd(),
    done: false,
    ...overrides,
  }
}

function typeConfig(type: CampaignType) {
  return CAMPAIGN_TYPES.find(t => t.value === type) ?? CAMPAIGN_TYPES[0]
}

// Generate audience signals (Custom Intent + In-Market + Remarketing + Search Themes)
// for one campaign via AI. Uses /api/audience-signal/generate (the endpoint that actually
// returns signals) and returns a merged Campaign patch — or null if nothing new.
async function fetchAudienceSignals(campaign: Campaign, brief: BriefCtx): Promise<Partial<Campaign> | null> {
  try {
    const res = await fetch('/api/audience-signal/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName:   campaign.name || 'Campaign',
        businessName:   brief.businessName || 'Business',
        productService: brief.productService || campaign.name,
        targetAudience: `ลูกค้าที่สนใจ ${brief.productService || campaign.name}`,
        objective:      brief.objective || 'leads',
      }),
    })
    if (!res.ok) return null
    const raw = await res.json()
    // API returns { signal: {...} } (same endpoint the Campaign Generator uses)
    const sig = (raw.signal ?? raw) as {
      customIntent?: string[]; inMarket?: string[]; remarketing?: string[]; searchThemes?: string[]
    }
    const exCI = new Set(campaign.audienceSignals.customIntent.map(s => s.toLowerCase()))
    const exIM = new Set(campaign.audienceSignals.inMarket)
    const exRM = new Set(campaign.audienceSignals.remarketing)
    const exST = new Set(campaign.searchThemes)
    const newCI = (sig.customIntent ?? []).filter(s => s && !exCI.has(s.toLowerCase()))
    const newIM = (sig.inMarket     ?? []).filter(s => s && !exIM.has(s))
    const newRM = (sig.remarketing  ?? []).filter(s => s && !exRM.has(s))
    const newST = (sig.searchThemes ?? []).filter(s => s && !exST.has(s))
    if (newCI.length + newIM.length + newRM.length + newST.length === 0) return null
    return {
      audienceSignals: {
        customIntent: [...campaign.audienceSignals.customIntent, ...newCI],
        inMarket:     [...campaign.audienceSignals.inMarket, ...newIM],
        remarketing:  [...campaign.audienceSignals.remarketing, ...newRM],
        searchThemes: campaign.audienceSignals.searchThemes,
      },
      ...(newST.length > 0 ? { searchThemes: [...campaign.searchThemes, ...newST].slice(0, 25) } : {}),
    }
  } catch (e) { console.error('[aud-generate]', e); return null }
}

// Keywords for a campaign, filtered to its name theme (Brand vs Generic)
async function fetchKeywords(campaign: Campaign, brief: BriefCtx): Promise<KwIdea[]> {
  try {
    const res = await fetch('/api/keyword-research/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName:   brief.businessName || 'Business',
        productService: brief.productService || campaign.name,
        location:       brief.targetLocation || campaign.targetLocation || 'ประเทศไทย',
        objective:      brief.objective || 'leads',
        language:       'th',
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const theme = campaignNameTheme(campaign.name)
    return (data.keywords ?? [])
      .filter((k: Record<string, unknown>) => keywordMatchesTheme(String(k.group ?? ''), theme))
      .slice(0, 50)
      .map((k: Record<string, unknown>) => ({
        keyword: String(k.keyword ?? ''),
        matchType: (k.matchType as KwIdea['matchType']) ?? 'PHRASE',
        avgMonthlySearches: Number(k.avgMonthlySearches ?? 0),
        competition: (k.competition as KwIdea['competition']) ?? 'MEDIUM',
        suggestedCpc: Number(k.suggestedCpc ?? k.cpcEst ?? 0),
        selected: true,
      }))
  } catch { return [] }
}

// Search themes for asset-based (PMax/Demand Gen/Video)
async function fetchThemes(campaign: Campaign, brief: BriefCtx): Promise<string[]> {
  try {
    const res = await fetch('/api/keyword-research/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName:   brief.businessName || 'Business',
        productService: brief.productService || campaign.name,
        location:       brief.targetLocation || campaign.targetLocation || 'ประเทศไทย',
        objective:      brief.objective || 'leads',
        language:       'th',
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.keywords ?? []).slice(0, 10).map((k: Record<string, unknown>) => String(k.keyword ?? '')).filter(Boolean)
  } catch { return [] }
}

// AI-draft the FULL ad content for the campaign's Google Ads type:
// headlines + long headlines + descriptions + display paths + sitelinks + callouts +
// structured snippets — everything the push needs, extracted from the AI blueprint.
async function fetchAdContent(campaign: Campaign, brief: BriefCtx): Promise<Partial<AdAsset> | null> {
  try {
    const typeMap: Record<string, string> = { PMAX: 'PERFORMANCE_MAX', REMARKETING: 'DISPLAY' }
    const res = await fetch('/api/adcopy/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName:   campaign.name || 'Campaign',
        campaignType:   typeMap[campaign.type] ?? campaign.type,
        objective:      brief.objective || 'Conversion',
        dailyBudget:    campaign.dailyBudget,
        businessName:   brief.businessName || 'Business',
        productService: brief.productService || campaign.name,
        targetAudience: `ลูกค้าที่สนใจ ${brief.productService || campaign.name}`,
        websiteUrl:     campaign.ad.finalUrl || '',
        language:       'th',
        keywords:       campaign.keywords.filter(k => k.selected).map(k => k.keyword),
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const bp = data.blueprint ?? data
    // Merge every RSA variant the AI returned (Ad 1 + Ad 2 use different angles)
    const rsaAds = (bp?.adGroups ?? []).flatMap((g: { ads?: { rsa?: { headlines?: string[]; descriptions?: string[]; displayPath1?: string; displayPath2?: string } }[] }) => (g.ads ?? []).map(a => a.rsa).filter(Boolean))
    const disp = bp?.adGroups?.[0]?.displayAd ?? bp?.adGroups?.[0]?.ads?.[0]?.display
    const ag   = bp?.assetGroups?.[0]

    let headlines: string[] = []
    let longHeadlines: string[] = []
    let descriptions: string[] = []
    if (rsaAds.length > 0) {
      for (const rsa of rsaAds) {
        for (const h of rsa?.headlines ?? []) if (h && !headlines.includes(h)) headlines.push(h)
        for (const d of rsa?.descriptions ?? []) if (d && !descriptions.includes(d)) descriptions.push(d)
      }
    } else if (ag) {
      headlines     = (ag.headlines ?? []).filter(Boolean)
      longHeadlines = (ag.longHeadlines ?? []).filter(Boolean)
      descriptions  = (ag.descriptions ?? []).filter(Boolean)
    } else if (disp) {
      headlines     = (disp.headlines ?? []).filter(Boolean)
      longHeadlines = (disp.longHeadlines ?? []).filter(Boolean)
      descriptions  = (disp.descriptions ?? []).filter(Boolean)
    }
    if (headlines.length === 0 && descriptions.length === 0) return null

    const t = AD_TARGETS[campaign.type]
    const sitelinks: Sitelink[] = (bp?.sitelinks ?? [])
      .filter((s: { text?: string }) => s?.text)
      .slice(0, 6)
      .map((s: { text: string; description1?: string; description2?: string; finalUrl?: string }) => ({
        text: s.text.slice(0, 25),
        description1: (s.description1 ?? '').slice(0, 35),
        description2: (s.description2 ?? '').slice(0, 35),
        finalUrl: s.finalUrl ?? '',
      }))
    const callouts: string[] = (bp?.callouts ?? []).filter(Boolean).map((c: string) => c.slice(0, 25))
    const snippet = bp?.structuredSnippets?.[0]
    const firstRsa = rsaAds[0]

    return {
      headlines:     headlines.slice(0, t.h).join('\n'),
      longHeadlines: longHeadlines.slice(0, Math.max(t.lh, 1)).join('\n'),
      descriptions:  descriptions.slice(0, t.d).join('\n'),
      businessName:  (ag?.businessName || disp?.businessName || brief.businessName || '').slice(0, 25),
      displayPath1:  (firstRsa?.displayPath1 ?? '').slice(0, 15),
      displayPath2:  (firstRsa?.displayPath2 ?? '').slice(0, 15),
      sitelinks,
      callouts:      callouts.join('\n'),
      snippetHeader: snippet?.header ?? '',
      snippetValues: (snippet?.values ?? []).filter(Boolean).join('\n'),
    }
  } catch { return null }
}

// Real remarketing user lists that already exist in the target Google Ads account —
// these are what campaigns can actually target today (AI-suggested names are just ideas).
async function fetchAccountAudiences(accountId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/audiences?customerId=${accountId}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.audiences ?? [])
      .map((a: { name?: string }) => a.name ?? '')
      .filter(Boolean)
      .slice(0, 20)
  } catch { return [] }
}

// RULE: audiences must be REAL Google segments (In-Market/Affinity taxonomy from the
// Google Ads API) — never AI-invented names. ~1,000 segments, cached server-side 24h.
interface GoogleSegment { id: string; name: string; type: 'IN_MARKET' | 'AFFINITY'; path: string }

async function fetchGoogleSegments(accountId: string): Promise<GoogleSegment[]> {
  try {
    const res = await fetch(`/api/audiences/google?customerId=${accountId}&limit=1200`)
    if (!res.ok) return []
    const data = await res.json()
    return data.segments ?? []
  } catch { return [] }
}

// Pick the real Google segments that best match the AI's suggestions + the product —
// this is how "ระบบเลือกมาให้แล้ว" works: AI suggests ideas, we map them onto segments
// that actually exist in Google Ads.
// Generic words appear in dozens of unrelated segment names ("Financial Services",
// "Business Services") — give them token-fragment weight so they can't outrank a
// real topical match on their own.
const GENERIC_TOKENS = new Set(['services', 'service', 'products', 'product', 'personal', 'general', 'other', 'online'])

function matchRealSegments(suggestions: string[], segments: GoogleSegment[], limit = 6): string[] {
  if (segments.length === 0 || suggestions.length === 0) return []
  const tokens = new Set<string>()
  for (const s of suggestions) {
    for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) tokens.add(w)
  }
  if (tokens.size === 0) return []
  const scored = segments
    .map(seg => {
      const words = seg.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)
      let score = words.reduce((n, w) => n + (tokens.has(w) ? (GENERIC_TOKENS.has(w) ? 0.25 : 1) : 0), 0)
      if (score >= 1 && seg.type === 'IN_MARKET') score += 0.5   // buying intent first
      return { seg, score }
    })
    .filter(x => x.score >= 1)   // at least one non-generic topical word must match
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(x => x.seg.name)
}

// Full type-correct generation for one campaign, following the audience rules:
// SEARCH   → keywords only, NO audience (RLSA remarketing is a manual opt-in)
// PMAX/DG  → search themes + Audience SIGNAL (custom intent + real segments + real lists)
// DISPLAY/REMARKETING → audience TARGETING from real Google segments + real account lists
async function generateForCampaign(c: Campaign, brief: BriefCtx, accountLists: string[] = [], googleSegments: GoogleSegment[] = []): Promise<Campaign> {
  let updated: Campaign = { ...c }
  if (c.type === 'SEARCH') {
    const kws = await fetchKeywords(c, brief)
    const ex = new Set(updated.keywords.map(k => k.keyword.toLowerCase()))
    updated = { ...updated, keywords: [...updated.keywords, ...kws.filter(k => !ex.has(k.keyword.toLowerCase()))] }
  }
  if (c.type === 'PMAX' || c.type === 'DEMAND_GEN') {
    const themes = await fetchThemes(c, brief)
    updated = { ...updated, searchThemes: Array.from(new Set([...updated.searchThemes, ...themes])).slice(0, 25) }
  }
  if (c.type === 'REMARKETING') {
    // RULE: Remarketing campaigns target remarketing lists ONLY — no in-market/affinity,
    // no custom intent. Auto-select every real list in the account.
    const ex = new Set(updated.audienceSignals.remarketing)
    updated = { ...updated, audienceSignals: {
      customIntent: [], inMarket: [],
      remarketing: [...updated.audienceSignals.remarketing, ...accountLists.filter(n => !ex.has(n))],
      searchThemes: updated.audienceSignals.searchThemes,
    } }
  } else if (c.type !== 'SEARCH') {
    const audPatch = await fetchAudienceSignals(updated, brief)
    if (audPatch) updated = { ...updated, ...audPatch }
    // กฎ: audience ต้องเป็นของจริง — ตัดชื่อ remarketing ที่ AI แต่งเอง (ไม่มีในบัญชี) ทิ้ง
    const realSet = new Set(accountLists)
    updated = { ...updated, audienceSignals: {
      ...updated.audienceSignals,
      remarketing: updated.audienceSignals.remarketing.filter(n => realSet.has(n)),
    } }
    // RULE: In-Market/Affinity must be REAL Google segments — map the AI's suggestions
    // (plus the product itself) onto the actual taxonomy and drop anything that
    // doesn't exist in Google Ads.
    if (googleSegments.length > 0) {
      const realNames = new Set(googleSegments.map(s => s.name))
      const kept = updated.audienceSignals.inMarket.filter(n => realNames.has(n))
      const matched = matchRealSegments(
        [...updated.audienceSignals.inMarket, ...updated.audienceSignals.customIntent, brief.productService, c.name].filter(Boolean),
        googleSegments,
      )
      updated = { ...updated, audienceSignals: {
        ...updated.audienceSignals,
        inMarket: Array.from(new Set([...kept, ...matched])).slice(0, 8),
      } }
    }
    // Attach the account's REAL remarketing lists automatically
    if (accountLists.length > 0) {
      const ex = new Set(updated.audienceSignals.remarketing)
      const real = accountLists.filter(n => !ex.has(n))
      if (real.length > 0) {
        updated = { ...updated, audienceSignals: {
          ...updated.audienceSignals,
          remarketing: [...real, ...updated.audienceSignals.remarketing],
        } }
      }
    }
  } else {
    // SEARCH: no audience targeting (rule) — EXCEPT campaigns named "RLSA" which get the
    // account's remarketing lists auto-selected (bid boost on past visitors).
    const isRlsa = /rlsa/i.test(c.name)
    updated = { ...updated, audienceSignals: {
      ...updated.audienceSignals,
      customIntent: [], inMarket: [],
      ...(isRlsa && accountLists.length > 0
        ? { remarketing: Array.from(new Set([...updated.audienceSignals.remarketing, ...accountLists])) }
        : {}),
    } }
  }
  // AI-draft the full ad content — only fill fields the user hasn't typed yet
  const gen = await fetchAdContent(updated, brief)
  if (gen) {
    const ad = updated.ad
    updated = { ...updated, ad: {
      ...ad,
      headlines:     ad.headlines.trim()     || gen.headlines     || '',
      longHeadlines: ad.longHeadlines.trim() || gen.longHeadlines || '',
      descriptions:  ad.descriptions.trim()  || gen.descriptions  || '',
      businessName:  ad.businessName.trim()  || gen.businessName  || '',
      displayPath1:  ad.displayPath1.trim()  || gen.displayPath1  || '',
      displayPath2:  ad.displayPath2.trim()  || gen.displayPath2  || '',
      sitelinks:     ad.sitelinks.length > 0 ? ad.sitelinks : (gen.sitelinks ?? []),
      callouts:      ad.callouts.trim()      || gen.callouts      || '',
      snippetHeader: ad.snippetHeader.trim() || gen.snippetHeader || '',
      snippetValues: ad.snippetValues.trim() || gen.snippetValues || '',
    } }
  }
  // Long headline is REQUIRED for RDA (Display/Remarketing) and PMax — if the AI
  // didn't return one, derive from descriptions so generation is always complete.
  const lhTarget = AD_TARGETS[c.type].lh
  if (lhTarget > 0 && lines(updated.ad.longHeadlines).length === 0) {
    const derived = lines(updated.ad.descriptions).filter(d => d.length <= 90).slice(0, lhTarget)
    if (derived.length > 0) updated = { ...updated, ad: { ...updated.ad, longHeadlines: derived.join('\n') } }
  }
  return updated
}

// ── Google Ads push helpers ──────────────────────────────────────────────────────

interface GadsAccount {
  id: string
  name: string
  currencyCode?: string
}

// Launch Today bid labels → Google Ads bid-strategy enum tokens the push lib understands
const BID_TOKEN: Record<string, string> = {
  'Maximize Conversions': 'MAXIMIZE_CONVERSIONS',
  'Target CPA':           'TARGET_CPA',
  'Target ROAS':          'TARGET_ROAS',
  'Maximize Clicks':      'MAXIMIZE_CLICKS',
  'Manual CPC':           'MANUAL_CPC',
  'CPM':                  'MAXIMIZE_CONVERSIONS',
}

// Launch Today campaign type → blueprint campaignType (push lib treats PMAX as Performance Max;
// REMARKETING is a Display campaign).
function blueprintType(t: CampaignType): string {
  if (t === 'REMARKETING') return 'DISPLAY'
  return t // SEARCH · PMAX · DISPLAY · DEMAND_GEN
}

// Convert an in-memory Launch Today campaign into a push-ready blueprint item with
// the COMPLETE asset set per campaign type — text, extensions, images, and video.
// Always PAUSED for safety — nothing goes live automatically.
function toBlueprint(c: Campaign, forceMaxClicks = false): CampaignBlueprintItem {
  const isAssetBased = c.type === 'PMAX' || c.type === 'DEMAND_GEN'
  const isDisplay    = c.type === 'DISPLAY' || c.type === 'REMARKETING'
  const kws = c.keywords.filter(k => k.selected)
  const t   = AD_TARGETS[c.type]

  // Enforce Google Ads character limits per type so the push isn't rejected
  const headlines     = lines(c.ad.headlines).filter(h => h.length <= t.hMax)
  const descriptions  = lines(c.ad.descriptions).filter(d => d.length <= t.dMax)
  // Long headlines from the dedicated field; fall back to 31–90-char lines typed in Headlines
  const lhFallback    = lines(c.ad.headlines).filter(h => h.length > t.hMax && h.length <= 90)
  const longHeadlines = [...lines(c.ad.longHeadlines).filter(h => h.length <= 90), ...lhFallback]

  const imageAssets = c.ad.images
    .filter(i => i.imageUrl)
    .map(i => ({ assetType: i.assetType as 'MARKETING_IMAGE' | 'SQUARE_MARKETING_IMAGE' | 'PORTRAIT_MARKETING_IMAGE' | 'LOGO' | 'SQUARE_LOGO', description: i.assetType, imageUrl: i.imageUrl }))
  const videoAssets = lines(c.ad.videoUrls)
    .map(url => ({ assetType: 'YOUTUBE_VIDEO' as const, url, description: 'YouTube video' }))

  // Asset extensions (Search + PMax attach at campaign level; harmless elsewhere)
  const sitelinks = c.ad.sitelinks
    .filter(s => s.text.trim())
    .map(s => ({
      text: s.text.trim().slice(0, 25),
      description1: s.description1.trim().slice(0, 35),
      description2: s.description2.trim().slice(0, 35),
      finalUrl: s.finalUrl.trim() || c.ad.finalUrl,
    }))
  const callouts = lines(c.ad.callouts).map(x => x.slice(0, 25))
  const snippetValues = lines(c.ad.snippetValues)
  const structuredSnippets = c.ad.snippetHeader.trim() && snippetValues.length > 0
    ? [{ header: c.ad.snippetHeader.trim(), values: snippetValues }]
    : []

  const adBase = {
    headline1: headlines[0] ?? '', headline2: headlines[1] ?? '', headline3: headlines[2] ?? '',
    description1: descriptions[0] ?? '', description2: descriptions[1] ?? '',
    finalUrl: c.ad.finalUrl,
  }
  // Search → RSA text only (no images). Display/Remarketing → responsive display ad with images.
  const ads = isDisplay
    ? [{
        ...adBase,
        display: {
          adType: 'RESPONSIVE_DISPLAY' as const,
          headlines:     headlines.slice(0, 5),
          longHeadlines: longHeadlines.slice(0, 1),
          descriptions:  descriptions.slice(0, 5),
          businessName:  c.ad.businessName.slice(0, 25),
          finalUrl:      c.ad.finalUrl,
          imageAssets,
        },
      }]
    : (headlines.length > 0 || descriptions.length > 0)
      ? [{ ...adBase, rsa: {
          adType: 'RSA' as const,
          headlines:    headlines.slice(0, 15),
          descriptions: descriptions.slice(0, 4),
          finalUrl:     c.ad.finalUrl,
          displayPath1: c.ad.displayPath1.replace(/\s/g, '').slice(0, 15),
          displayPath2: c.ad.displayPath2.replace(/\s/g, '').slice(0, 15),
        } }]
      : []

  // PMax descriptions: Google wants the FIRST description ≤60 chars (short description slot)
  const agDescriptions = [...descriptions]
  const shortIdx = agDescriptions.findIndex(d => d.length <= 60)
  if (shortIdx > 0) agDescriptions.unshift(agDescriptions.splice(shortIdx, 1)[0])

  return {
    campaignName:    c.name.trim() || 'Untitled Campaign',
    campaignType:    blueprintType(c.type),
    status:          'PAUSED',
    budget:          c.dailyBudget,
    bidStrategy:     forceMaxClicks ? 'MAXIMIZE_CLICKS' : (BID_TOKEN[c.bidStrategy] ?? 'MAXIMIZE_CONVERSIONS'),
    locationTargets: [c.targetLocation || 'Thailand'],
    languageTargets: ['th'],
    finalUrl:        c.ad.finalUrl || undefined,
    adGroups: isAssetBased ? [] : [{
      adGroupName: 'Ad Group 1',
      defaultBid:  0,
      keywords:    kws.map(k => k.keyword),
      matchTypes:  kws.map(k => k.matchType),
      ads,
      // SEARCH: RLSA only (remarketing lists) — never in-market/affinity targeting.
      // DISPLAY/REMARKETING: remarketing lists + real Google segments.
      audiences: c.type === 'SEARCH'
        ? [...c.audienceSignals.remarketing]
        : [...c.audienceSignals.remarketing, ...c.audienceSignals.inMarket],
    }],
    assetGroups: isAssetBased ? [{
      assetGroupName: `${c.name.trim() || 'Campaign'} - Asset Group`,
      headlines:      headlines.slice(0, 15),
      longHeadlines:  longHeadlines.slice(0, 5),
      descriptions:   agDescriptions.slice(0, 5),
      businessName:   c.ad.businessName.slice(0, 25),
      finalUrl:       c.ad.finalUrl,
      imageAssets,
      ...(videoAssets.length > 0 ? { videoAssets } : {}),
      audienceSignals: {
        customIntent: c.audienceSignals.customIntent,
        remarketing:  c.audienceSignals.remarketing,
        inMarket:     c.audienceSignals.inMarket,
        searchThemes: c.searchThemes,
      },
    }] : undefined,
    negativeKeywords:   [],
    sitelinks,
    callouts,
    structuredSnippets,
    phoneNumbers:       [],
  }
}

// ── Readiness checklist ────────────────────────────────────────────────────────
// What each campaign type REQUIRES before a real Google Ads push (error = push จะ fail
// หรือได้ campaign เปล่า) and what it SHOULD have for quality (warn).

interface Gap { level: 'error' | 'warn'; msg: string }

function campaignGaps(c: Campaign, accountLists: string[] = []): Gap[] {
  const gaps: Gap[] = []
  const t  = AD_TARGETS[c.type]
  const hs = lines(c.ad.headlines).filter(h => h.length <= t.hMax)
  const lh = lines(c.ad.longHeadlines).filter(h => h.length <= 90)
  const ds = lines(c.ad.descriptions).filter(d => d.length <= t.dMax)
  const overH = lines(c.ad.headlines).length - hs.length
  const overD = lines(c.ad.descriptions).length - ds.length
  const img = (type: string) => c.ad.images.some(i => i.assetType === type && i.imageUrl)
  const videos = lines(c.ad.videoUrls)
  const err = (msg: string) => gaps.push({ level: 'error', msg })
  const warn = (msg: string) => gaps.push({ level: 'warn', msg })

  if (!c.name.trim()) err('ตั้งชื่อ campaign')
  if (!c.ad.finalUrl.trim()) err('ใส่ Final URL (landing page)')
  if (c.dailyBudget <= 0) err('ตั้ง daily budget')
  if (overH > 0) warn(`Headlines เกิน ${t.hMax} ตัวอักษร ${overH} บรรทัด — จะถูกตัดทิ้งตอน push`)
  if (overD > 0) warn(`Descriptions เกิน ${t.dMax} ตัวอักษร ${overD} บรรทัด — จะถูกตัดทิ้งตอน push`)

  switch (c.type) {
    case 'SEARCH': {
      if (c.keywords.filter(k => k.selected).length === 0) err('เลือก keyword อย่างน้อย 1 คำ')
      if (/rlsa/i.test(c.name) && c.audienceSignals.remarketing.length === 0)
        err('แคมเปญ RLSA ต้องเลือก remarketing list อย่างน้อย 1 (แท็บ Audience)')
      if (hs.length < 3) err(`Headlines ต้องมีอย่างน้อย 3 (มี ${hs.length}) — เป้า 15`)
      else if (hs.length < 15) warn(`Headlines ${hs.length}/15 — ครบ 15 ถึงได้ Ad Strength ดี`)
      if (ds.length < 2) err(`Descriptions ต้องมีอย่างน้อย 2 (มี ${ds.length}) — เป้า 4`)
      else if (ds.length < 4) warn(`Descriptions ${ds.length}/4`)
      const sl = c.ad.sitelinks.filter(s => s.text.trim()).length
      if (sl < 4) warn(`Sitelinks ${sl}/4 — Google แนะนำอย่างน้อย 4`)
      const co = lines(c.ad.callouts).length
      if (co < 4) warn(`Callouts ${co}/4+`)
      if (!c.ad.snippetHeader.trim() || lines(c.ad.snippetValues).length < 3) warn('Structured snippet ยังไม่ครบ (header + ค่า ≥3)')
      break
    }
    case 'PMAX': {
      if (!c.ad.businessName.trim()) err('ใส่ Business Name (≤25 ตัว) — Google บังคับ')
      if (!img('LOGO')) err('อัปโหลด Logo 1200×1200 — Google บังคับ')
      if (!img('MARKETING_IMAGE')) err('อัปโหลดรูป Landscape 1200×628 — Google บังคับ')
      if (!img('SQUARE_MARKETING_IMAGE')) err('อัปโหลดรูป Square 1200×1200 — Google บังคับ')
      if (hs.length < 3) err(`Headlines ต้องมีอย่างน้อย 3 (มี ${hs.length}) — เป้า 15`)
      else if (hs.length < 15) warn(`Headlines ${hs.length}/15`)
      if (lh.length < 1) err('Long Headline อย่างน้อย 1 (≤90 ตัว) — เป้า 5')
      else if (lh.length < 5) warn(`Long Headlines ${lh.length}/5`)
      if (ds.length < 2) err(`Descriptions ต้องมีอย่างน้อย 2 (มี ${ds.length}) — เป้า 5`)
      else if (ds.length < 5) warn(`Descriptions ${ds.length}/5`)
      if (ds.length > 0 && !ds.some(d => d.length <= 60)) warn('ควรมี description สั้น ≤60 ตัว 1 อัน (short description slot)')
      if (!img('PORTRAIT_MARKETING_IMAGE')) warn('รูป Portrait 960×1200 — แนะนำ (ใช้บน Discover/YouTube)')
      if (videos.length === 0) warn('ไม่มี video — Google จะ auto-generate จากรูป (ใส่ YouTube URL จะคุมคุณภาพได้)')
      if (c.searchThemes.length === 0) warn('ยังไม่มี search themes')
      break
    }
    case 'DISPLAY':
    case 'REMARKETING': {
      if (hs.length < 1) err('Headline อย่างน้อย 1 — เป้า 5')
      else if (hs.length < 5) warn(`Headlines ${hs.length}/5`)
      if (lh.length < 1) err('Long Headline อย่างน้อย 1 (≤90 ตัว) — Responsive Display Ad บังคับมี')
      if (ds.length < 1) err('Description อย่างน้อย 1 — เป้า 5')
      else if (ds.length < 5) warn(`Descriptions ${ds.length}/5`)
      if (!c.ad.businessName.trim()) err('ใส่ Business Name')
      if (!img('MARKETING_IMAGE')) err('อัปโหลดรูป Landscape 1200×628')
      if (!img('SQUARE_MARKETING_IMAGE')) err('อัปโหลดรูป Square 1200×1200')
      if (!img('LOGO')) warn('Logo — แนะนำให้มี')
      if (c.type === 'REMARKETING' && c.audienceSignals.remarketing.length === 0) err('เลือก remarketing list อย่างน้อย 1')
      break
    }
    case 'DEMAND_GEN': {
      if (hs.length < 1) err(`Headline อย่างน้อย 1 (≤40 ตัว) — เป้า 5`)
      else if (hs.length < 5) warn(`Headlines ${hs.length}/5 (≤40 ตัว)`)
      if (ds.length < 1) err('Description อย่างน้อย 1 — เป้า 5')
      else if (ds.length < 5) warn(`Descriptions ${ds.length}/5`)
      if (!c.ad.businessName.trim()) err('ใส่ Business Name')
      if (!img('LOGO')) err('อัปโหลด Logo 1200×1200')
      if (!img('MARKETING_IMAGE')) err('อัปโหลดรูป Landscape 1200×628')
      if (!img('SQUARE_MARKETING_IMAGE')) err('อัปโหลดรูป Square 1200×1200')
      if (!img('PORTRAIT_MARKETING_IMAGE')) warn('รูป Portrait 960×1200 — แนะนำ (Discover/Gmail)')
      if (videos.length === 0) warn('ไม่มี video — แนะนำใส่ YouTube URL')
      break
    }
  }

  // Selected remarketing names that don't exist as REAL lists in the account get skipped
  // at push time — surface that here so nobody targets an empty audience by accident.
  const fakeLists = c.audienceSignals.remarketing.filter(n => !accountLists.includes(n))
  if (fakeLists.length > 0) {
    const preview = fakeLists.slice(0, 2).join(', ') + (fakeLists.length > 2 ? ` +อีก ${fakeLists.length - 2}` : '')
    if (c.type === 'REMARKETING' && fakeLists.length === c.audienceSignals.remarketing.length) {
      err(`list ที่เลือกทั้งหมดไม่มีจริงในบัญชี (${preview}) — Remarketing จะไม่มี audience เลย ต้องสร้าง list จริงก่อน (ขั้นตอน Remarketing Audience ด้านล่าง หรือใน Google Ads UI)`)
    } else {
      warn(`list ${fakeLists.length} ชื่อไม่มีจริงในบัญชี จะถูกข้ามตอน push: ${preview}`)
    }
  }
  return gaps
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function Btn({ onClick, children, variant = 'primary', disabled = false, loading = false, size = 'md' }: {
  onClick?: () => void; children: React.ReactNode
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  disabled?: boolean; loading?: boolean; size?: 'sm' | 'md'
}) {
  const base = `inline-flex items-center gap-1.5 font-medium rounded-xl transition-colors disabled:opacity-40 ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`
  const cls = variant === 'primary' ? 'bg-neutral-950 text-white hover:bg-neutral-800'
    : variant === 'outline' ? 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
    : variant === 'danger' ? 'border border-red-200 text-red-600 hover:bg-red-50'
    : 'text-neutral-600 hover:bg-neutral-100'
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${cls}`}>
      {loading && <Loader2 size={12} className="animate-spin shrink-0" />}
      {children}
    </button>
  )
}

function Tag({ children, onRemove, color = 'bg-neutral-100 text-neutral-700' }: {
  children: React.ReactNode; onRemove?: () => void; color?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      {children}
      {onRemove && <button onClick={onRemove} className="ml-0.5 opacity-60 hover:opacity-100"><X size={10} /></button>}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">{title}</div>
      {children}
    </div>
  )
}

// Search-and-pick from Google's REAL In-Market/Affinity taxonomy — works like the
// audience browser in the Google Ads UI. The system pre-selects via matchRealSegments;
// this picker lets the user adjust from the same real list.
function GoogleAudiencePicker({ segments, selected, onChange }: {
  segments: GoogleSegment[]
  selected: string[]
  onChange: (names: string[]) => void
}) {
  const [q, setQ] = useState('')
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const results = terms.length > 0
    ? segments.filter(s => { const hay = s.name.toLowerCase(); return terms.every(t => hay.includes(t)) }).slice(0, 50)
    : []
  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name])
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(n => {
            const seg = segments.find(s => s.name === n)
            return (
              <Tag key={n} color={seg?.type === 'AFFINITY' ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'}
                onRemove={() => onChange(selected.filter(x => x !== n))}>
                {n}{seg ? ` · ${seg.type === 'AFFINITY' ? 'Affinity' : 'In-Market'}` : ''}
              </Tag>
            )
          })}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)}
        placeholder={segments.length > 0
          ? `ค้นหาจาก ${segments.length.toLocaleString()} audiences จริงของ Google เช่น Real Estate, Travel, Beauty...`
          : 'เลือก Google Ads account ก่อน เพื่อโหลด audience จริงจาก Google'}
        disabled={segments.length === 0}
        className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-50" />
      {results.length > 0 && (
        <div className="border border-neutral-200 rounded-xl divide-y divide-neutral-100 max-h-52 overflow-y-auto">
          {results.map(s => {
            const active = selected.includes(s.name)
            return (
              <button key={s.id} onClick={() => toggle(s.name)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors ${active ? 'bg-purple-50' : 'hover:bg-neutral-50'}`}>
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-purple-600 border-purple-600' : 'border-neutral-300'}`}>
                    {active && <Check size={9} className="text-white" />}
                  </span>
                  <span className="text-neutral-800">{s.name}</span>
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${s.type === 'AFFINITY' ? 'bg-indigo-50 text-indigo-600' : 'bg-purple-50 text-purple-600'}`}>
                  {s.type === 'AFFINITY' ? 'Affinity' : 'In-Market'}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {terms.length > 0 && results.length === 0 && segments.length > 0 && (
        <p className="text-xs text-neutral-400">ไม่พบ audience ที่ตรงกับ &quot;{q}&quot; ใน taxonomy ของ Google</p>
      )}
    </div>
  )
}

// One input box per asset with a live character counter — like the real Google Ads UI.
// Value stays a "\n"-joined string in state so the rest of the page is unchanged.
function FieldListEditor({ label, value, onChange, maxItems, maxLen, target, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  maxItems: number; maxLen: number; target: number; placeholder?: string
}) {
  const rows = value === '' ? [''] : value.split('\n')
  const setRow = (i: number, v: string) => {
    const next = [...rows]; next[i] = v.replace(/\n/g, ''); onChange(next.join('\n'))
  }
  const filled = rows.filter(r => r.trim() && r.trim().length <= maxLen).length
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1.5">
        {label} (≤{maxLen} ตัวอักษร)
        <span className={`ml-1.5 normal-case tracking-normal font-semibold ${filled >= target ? 'text-emerald-600' : 'text-amber-500'}`}>{filled}/{target}</span>
      </label>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const len = r.trim().length
          const over = len > maxLen
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <input value={r} onChange={e => setRow(i, e.target.value)}
                  placeholder={i === 0 ? placeholder : `${label} ${i + 1}`}
                  className={`w-full border rounded-xl pl-3 pr-14 py-2 text-sm focus:outline-none focus:ring-2 ${over ? 'border-red-300 bg-red-50/40 focus:ring-red-200' : 'border-neutral-200 focus:ring-neutral-200'}`} />
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums pointer-events-none ${over ? 'text-red-500 font-bold' : len > 0 ? 'text-neutral-400' : 'text-neutral-300'}`}>
                  {len}/{maxLen}
                </span>
              </div>
              {rows.length > 1 && (
                <button onClick={() => onChange(rows.filter((_, j) => j !== i).join('\n'))}
                  className="text-neutral-300 hover:text-red-500 transition-colors shrink-0"><X size={13} /></button>
              )}
            </div>
          )
        })}
      </div>
      {rows.length < maxItems && (
        <button onClick={() => onChange([...rows, ''].join('\n'))}
          className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1">
          <Plus size={11} />เพิ่ม {label}
        </button>
      )}
    </div>
  )
}

// Live ad preview (right column) — Search text ad or Display/PMax card, Google-style.
function AdPreview({ campaign }: { campaign: Campaign }) {
  const hs = lines(campaign.ad.headlines)
  const lh = lines(campaign.ad.longHeadlines)
  const ds = lines(campaign.ad.descriptions)
  const raw = campaign.ad.finalUrl || 'https://www.example.com'
  let domain = 'www.example.com'
  try { domain = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname } catch { /* keep default */ }
  const paths = [campaign.ad.displayPath1, campaign.ad.displayPath2].filter(Boolean)
  const landscape = campaign.ad.images.find(i => i.assetType === 'MARKETING_IMAGE')?.imageUrl
  const logo = campaign.ad.images.find(i => i.assetType === 'LOGO')?.imageUrl
  const sitelinks = campaign.ad.sitelinks.filter(s => s.text.trim()).slice(0, 4)

  if (campaign.type === 'SEARCH') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-bold text-neutral-900 mb-1">Sponsored</div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-5 h-5 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-[9px] font-bold text-neutral-500">
            {(campaign.ad.businessName || domain)[0]?.toUpperCase() ?? 'A'}
          </span>
          <span className="text-xs text-neutral-800">{domain}{paths.length > 0 && <span className="text-neutral-400"> › {paths.join(' › ')}</span>}</span>
        </div>
        <div className="text-[15px] leading-snug text-[#1a0dab] hover:underline cursor-pointer">
          {hs.slice(0, 3).join(' - ') || 'Headline 1 - Headline 2 - Headline 3'}
        </div>
        <div className="text-xs text-neutral-600 mt-1 leading-relaxed">
          {ds.slice(0, 2).join(' ') || 'Description จะแสดงตรงนี้...'}
        </div>
        {sitelinks.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2.5 pt-2 border-t border-neutral-100">
            {sitelinks.map((s, i) => (
              <div key={i}>
                <div className="text-[13px] text-[#1a0dab] hover:underline cursor-pointer">{s.text}</div>
                {s.description1 && <div className="text-[10px] text-neutral-500 truncate">{s.description1}</div>}
              </div>
            ))}
          </div>
        )}
        {lines(campaign.ad.callouts).length > 0 && (
          <div className="text-[10px] text-neutral-500 mt-1.5">{lines(campaign.ad.callouts).slice(0, 4).join(' · ')}</div>
        )}
      </div>
    )
  }

  // Display / PMax / Demand Gen card preview
  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
      {landscape
        ? <img src={landscape} alt="ad" className="w-full aspect-[1.91/1] object-cover" />
        : <div className="w-full aspect-[1.91/1] bg-neutral-100 flex items-center justify-center text-[10px] text-neutral-400">รูป Landscape 1200×628</div>}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          {logo
            ? <img src={logo} alt="logo" className="w-6 h-6 rounded-full object-cover border border-neutral-200" />
            : <span className="w-6 h-6 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-[9px] font-bold text-neutral-500">{(campaign.ad.businessName || 'A')[0]?.toUpperCase()}</span>}
          <span className="text-[11px] font-semibold text-neutral-700 truncate">{campaign.ad.businessName || 'Business Name'}</span>
        </div>
        <div className="text-sm font-semibold text-neutral-900 leading-snug">
          {(lh[0] ?? hs[0]) || 'Long headline จะแสดงตรงนี้'}
        </div>
        <div className="text-xs text-neutral-600 mt-1 line-clamp-2">{ds[0] || 'Description จะแสดงตรงนี้...'}</div>
        <button className="mt-2.5 w-full py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">เรียนรู้เพิ่มเติม</button>
      </div>
    </div>
  )
}

// ── AI Plan Modal ──────────────────────────────────────────────────────────────

interface AiPlanInput {
  productService: string
  targetAudience: string
  location: string
  objective: string
  competitors: string
}

interface AiPlanModalProps {
  campaign: Campaign
  brief: BriefCtx
  onClose: () => void
  onApply: (patch: Partial<Campaign>) => void
}

function AiPlanModal({ campaign, brief, onClose, onApply }: AiPlanModalProps) {
  const isSearch   = campaign.type === 'SEARCH' || campaign.type === 'DISPLAY' || campaign.type === 'REMARKETING'
  const isPmax     = campaign.type === 'PMAX' || campaign.type === 'DEMAND_GEN'
  const needsKw    = isSearch
  const needsAud   = campaign.type !== 'SEARCH'   // rule: Search takes no audience (RLSA is manual opt-in)

  const [input, setInput] = useState<AiPlanInput>({
    productService: brief.productService || '',
    targetAudience: '',
    location:       brief.targetLocation || 'ประเทศไทย',
    objective:      brief.objective      || 'Leads',
    competitors:    '',
  })
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const set = (k: keyof AiPlanInput, v: string) => setInput(p => ({ ...p, [k]: v }))

  async function run() {
    if (!input.productService.trim()) return
    setLoading(true)
    setProgress([])

    const businessName = brief.businessName || 'Business'
    const patches: Partial<Campaign> = {}

    try {
      // Step 1: Keywords / Search Themes
      if (needsKw || isPmax) {
        setProgress(p => [...p, `🔍 กำลัง generate ${needsKw ? 'keywords' : 'search themes'}...`])
        const res = await fetch('/api/keyword-research/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName,
            productService: input.productService,
            location:       input.location,
            objective:      input.objective,
            language:       'th',
            competitors:    input.competitors || undefined,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (needsKw) {
            const theme = campaignNameTheme(campaign.name)
            const allKw: KwIdea[] = (data.keywords ?? [])
              .filter((k: Record<string, unknown>) => keywordMatchesTheme(String(k.group ?? ''), theme))
              .slice(0, 50).map((k: Record<string, unknown>) => ({
              keyword:            String(k.keyword ?? ''),
              matchType:          (k.matchType as KwIdea['matchType']) ?? 'PHRASE',
              avgMonthlySearches: Number(k.avgMonthlySearches ?? 0),
              competition:        (k.competition as KwIdea['competition']) ?? 'MEDIUM',
              suggestedCpc:       Number(k.suggestedCpc ?? k.cpcEst ?? 0),
              selected:           true,
            }))
            const existing = new Set(campaign.keywords.map(k => k.keyword.toLowerCase()))
            patches.keywords = [...campaign.keywords, ...allKw.filter(k => !existing.has(k.keyword.toLowerCase()))]
            setProgress(p => [...p, `✅ Keywords: ${allKw.length} รายการ`])
          } else {
            const themes: string[] = (data.keywords ?? []).slice(0, 15).map((k: Record<string, unknown>) => String(k.keyword ?? ''))
            const merged = Array.from(new Set([...campaign.searchThemes, ...themes])).slice(0, 25)
            patches.searchThemes = merged
            setProgress(p => [...p, `✅ Search Themes: ${merged.length} รายการ`])
          }
        }
      }

      // Step 2: Audience Signals (all types benefit from this)
      if (needsAud) {
        setProgress(p => [...p, '🎯 กำลัง generate audience signals...'])
        const res = await fetch('/api/audience-signal/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignName:   campaign.name || 'Campaign',
            businessName,
            productService: input.productService,
            targetAudience: input.targetAudience || `ลูกค้าที่สนใจ ${input.productService}`,
            objective:      input.objective,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const sig = (data.signal ?? data) as {
            customIntent?: string[]
            searchThemes?: string[]
            remarketing?:  string[]
            inMarket?:     string[]
            demographics?: { ageRanges?: string[]; genders?: string[]; householdIncome?: string[] }
          }

          const existingCI  = new Set(campaign.audienceSignals.customIntent.map(s => s.toLowerCase()))
          const existingIM  = new Set(campaign.audienceSignals.inMarket)
          const existingRM  = new Set(campaign.audienceSignals.remarketing)
          const existingST  = new Set(campaign.searchThemes)

          const newCI = (sig.customIntent ?? []).filter(s => !existingCI.has(s.toLowerCase()))
          const newIM = (sig.inMarket     ?? []).filter(s => !existingIM.has(s))
          const newRM = (sig.remarketing  ?? []).filter(s => !existingRM.has(s))
          const newST = (sig.searchThemes ?? []).filter(s => !existingST.has(s))

          patches.audienceSignals = {
            customIntent: [...campaign.audienceSignals.customIntent, ...newCI],
            inMarket:     [...campaign.audienceSignals.inMarket, ...newIM],
            remarketing:  [...campaign.audienceSignals.remarketing, ...newRM],
            searchThemes: [...campaign.audienceSignals.searchThemes],
          }
          // merge searchThemes from audience into campaign.searchThemes too (for PMax)
          if (newST.length > 0 && !patches.searchThemes) {
            patches.searchThemes = [...campaign.searchThemes, ...newST].slice(0, 25)
          }

          const total = newCI.length + newIM.length + newRM.length
          setProgress(p => [...p,
            `✅ Custom Intent: ${newCI.length} signals`,
            newIM.length > 0 ? `✅ In-Market: ${newIM.length} segments` : '',
            newRM.length > 0 ? `✅ Remarketing: ${newRM.length} lists` : '',
          ].filter(Boolean))
          void total
        }
      }

      setProgress(p => [...p, '🎉 เสร็จแล้ว!'])
      await new Promise(r => setTimeout(r, 600))
      onApply(patches)
      onClose()
    } catch (e) {
      console.error('[ai-plan]', e)
      setProgress(p => [...p, '❌ เกิดข้อผิดพลาด'])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-neutral-950 flex items-center justify-center">
              <Wand2 size={15} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-neutral-900">AI Plan This Campaign</div>
              <div className="text-xs text-neutral-400">
                {campaign.name || 'Campaign'} · {campaign.type}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700"><X size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* What AI will generate */}
          <div className="flex flex-wrap gap-2">
            {needsKw && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
                <Sparkles size={10} />Keywords
              </span>
            )}
            {isPmax && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded-full border border-orange-200">
                <Sparkles size={10} />Search Themes
              </span>
            )}
            {needsAud && (
              <>
                <span className="flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-full border border-purple-200">
                  <Sparkles size={10} />{isPmax ? 'Audience Signal' : 'Audience'}
                </span>
                <span className="flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-200">
                  <Sparkles size={10} />In-Market (จริง)
                </span>
                <span className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-200">
                  <Sparkles size={10} />Remarketing
                </span>
              </>
            )}
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">
                สินค้า / บริการ <span className="text-red-500">*</span>
              </label>
              <input value={input.productService} onChange={e => set('productService', e.target.value)}
                placeholder="เช่น บริการยื่นวีซ่าไต้หวัน, คลินิกเลเซอร์, ซอฟต์แวร์ HR"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">กลุ่มเป้าหมาย</label>
              <input value={input.targetAudience} onChange={e => set('targetAudience', e.target.value)}
                placeholder="เช่น คนวัย 25-45 ที่ต้องการเดินทางไปต่างประเทศ"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">วัตถุประสงค์</label>
                <select value={input.objective} onChange={e => set('objective', e.target.value)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300">
                  {['Leads', 'Sales', 'Brand Awareness', 'App Installs', 'Store Visits'].map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Location</label>
                <input value={input.location} onChange={e => set('location', e.target.value)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-600 mb-1">คู่แข่ง (optional)</label>
              <input value={input.competitors} onChange={e => set('competitors', e.target.value)}
                placeholder="เช่น SCBVISA, iTAX, Kasikorn (คั่นด้วย comma)"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            </div>
          </div>

          {/* Progress */}
          {progress.length > 0 && (
            <div className="bg-neutral-50 rounded-xl p-3 space-y-1">
              {progress.map((msg, i) => (
                <div key={i} className="text-xs text-neutral-700 flex items-center gap-2">
                  {loading && i === progress.length - 1 && !msg.startsWith('✅') && !msg.startsWith('🎉') && !msg.startsWith('❌')
                    ? <Loader2 size={11} className="animate-spin text-blue-500 shrink-0" />
                    : <span className="w-3 shrink-0" />}
                  {msg}
                </div>
              ))}
            </div>
          )}

          {/* Action */}
          <div className="flex gap-2 pt-1">
            <button onClick={run} disabled={loading || !input.productService.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-950 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {loading ? 'กำลัง generate...' : 'Generate ทั้งหมด'}
            </button>
            <button onClick={onClose} disabled={loading}
              className="px-4 py-2.5 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors">
              ยกเลิก
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Brief context bar ──────────────────────────────────────────────────────────

interface BriefCtx {
  businessName: string
  productService: string
  targetLocation: string
  objective: string
}

function BriefBar({ brief, onChange }: { brief: BriefCtx; onChange: (b: BriefCtx) => void }) {
  const [open, setOpen] = useState(false)
  const set = (k: keyof BriefCtx, v: string) => onChange({ ...brief, [k]: v })
  const filled = [brief.businessName, brief.productService, brief.targetLocation].filter(Boolean).length

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-neutral-50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-neutral-900">Business Context</span>
          {filled > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
              {filled}/3 filled — AI จะแม่นขึ้น
            </span>
          )}
          {filled === 0 && (
            <span className="text-xs text-neutral-400">เพิ่มข้อมูลให้ AI แนะนำ keyword แม่นขึ้น (optional)</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-neutral-100 pt-4">
          {([
            { key: 'businessName',   label: 'Business Name',   placeholder: 'เช่น ConvertCake Agency' },
            { key: 'productService', label: 'Product / Service', placeholder: 'เช่น บริการยื่นวีซ่าไต้หวัน' },
            { key: 'targetLocation', label: 'Target Location',  placeholder: 'เช่น กรุงเทพฯ, ไทย' },
            { key: 'objective',      label: 'Objective',         placeholder: 'เช่น Leads, Sales, Brand' },
          ] as { key: keyof BriefCtx; label: string; placeholder: string }[]).map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-neutral-500 mb-1">{f.label}</label>
              <input value={brief[f.key]} onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Campaign Card ──────────────────────────────────────────────────────────────

function CampaignCard({
  campaign, index, brief, accountLists, googleSegments,
  onChange, onRemove,
}: {
  campaign: Campaign
  index: number
  brief: BriefCtx
  accountLists: string[]
  googleSegments: GoogleSegment[]
  onChange: (c: Campaign) => void
  onRemove: () => void
}) {
  const [tab, setTab]             = useState<'keywords' | 'audience' | 'ad'>('keywords')
  const [uploading, setUploading] = useState<string | null>(null)
  const [editName, setEditName]   = useState(false)
  const [nameInput, setNameInput] = useState(campaign.name)
  const [manualKw, setManualKw]   = useState('')
  const [newTheme, setNewTheme]   = useState('')
  const [newCustom, setNewCustom] = useState('')
  const [loadingKw, setLoadingKw] = useState(false)
  const [loadingAud, setLoadingAud] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [aiPlanOpen, setAiPlanOpen] = useState(false)

  const isSearch   = campaign.type === 'SEARCH' || campaign.type === 'REMARKETING' || campaign.type === 'DISPLAY'
  const isPmax     = campaign.type === 'PMAX' || campaign.type === 'DEMAND_GEN'
  const cfg        = typeConfig(campaign.type)
  const selectedKw = campaign.keywords.filter(k => k.selected)
  const up         = (patch: Partial<Campaign>) => onChange({ ...campaign, ...patch })
  const upSig      = (patch: Partial<AudienceSignals>) => up({ audienceSignals: { ...campaign.audienceSignals, ...patch } })
  const upAd       = (patch: Partial<AdAsset>) => up({ ad: { ...campaign.ad, ...patch } })

  // Upload one or more images into a slot type — appends up to the slot's Google limit
  // (e.g. 15 landscape images), never replaces existing ones.
  async function handleImagePick(assetType: string, files: FileList | null, max: number) {
    if (!files || files.length === 0) return
    setUploading(assetType)
    const current = campaign.ad.images.filter(i => i.assetType === assetType).length
    const room = Math.max(0, max - current)
    const added: { assetType: string; imageUrl: string }[] = []
    for (const f of Array.from(files).slice(0, room)) {
      const url = await uploadImage(f, assetType)   // auto-crops to the slot's exact ratio
      if (url) added.push({ assetType, imageUrl: url })
    }
    setUploading(null)
    if (added.length > 0) upAd({ images: [...campaign.ad.images, ...added] })
  }

  function saveName() {
    if (nameInput.trim()) up({ name: nameInput.trim() })
    setEditName(false)
  }

  // ── Generate Keywords ──
  async function generateKeywords() {
    setLoadingKw(true)
    try {
      const res = await fetch('/api/keyword-research/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName:   brief.businessName   || 'Business',
          productService: brief.productService || campaign.name,
          location:       brief.targetLocation || campaign.targetLocation || 'ประเทศไทย',
          objective:      brief.objective      || 'leads',
          language:       'th',
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      // Pull keywords that match the campaign name's theme (Brand vs Generic)
      const theme = campaignNameTheme(campaign.name)
      const allKw: KwIdea[] = (data.keywords ?? [])
        .filter((k: Record<string, unknown>) => keywordMatchesTheme(String(k.group ?? ''), theme))
        .slice(0, 50)
        .map((k: Record<string, unknown>) => ({
          keyword: String(k.keyword ?? ''),
          matchType: (k.matchType as KwIdea['matchType']) ?? 'PHRASE',
          avgMonthlySearches: Number(k.avgMonthlySearches ?? 0),
          competition: (k.competition as KwIdea['competition']) ?? 'MEDIUM',
          suggestedCpc: Number(k.suggestedCpc ?? k.cpcEst ?? 0),
          selected: true,
        }))
      const existing = new Set(campaign.keywords.map(k => k.keyword.toLowerCase()))
      const newOnes = allKw.filter(k => !existing.has(k.keyword.toLowerCase()))
      up({ keywords: [...campaign.keywords, ...newOnes] })
    } catch (e) { console.error('[kw-generate]', e) }
    finally { setLoadingKw(false) }
  }

  // ── Generate Search Themes (PMax) ──
  async function generateThemes() {
    setLoadingKw(true)
    try {
      const res = await fetch('/api/keyword-research/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName:   brief.businessName   || 'Business',
          productService: brief.productService || campaign.name,
          location:       brief.targetLocation || campaign.targetLocation || 'ประเทศไทย',
          objective:      brief.objective      || 'leads',
          language:       'th',
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      const themes: string[] = (data.keywords ?? []).slice(0, 10).map((k: Record<string, unknown>) => String(k.keyword ?? ''))
      const merged = Array.from(new Set([...campaign.searchThemes, ...themes])).slice(0, 25)
      up({ searchThemes: merged })
    } catch (e) { console.error('[theme-generate]', e) }
    finally { setLoadingKw(false) }
  }

  // ── Generate Audience (AI suggests → mapped onto REAL Google segments) ──
  async function generateAudience() {
    setLoadingAud(true)
    try {
      const patch = await fetchAudienceSignals(campaign, brief)
      let next: Campaign = patch ? { ...campaign, ...patch } : campaign
      if (googleSegments.length > 0) {
        const realNames = new Set(googleSegments.map(s => s.name))
        const kept = next.audienceSignals.inMarket.filter(n => realNames.has(n))
        const matched = matchRealSegments(
          [...next.audienceSignals.inMarket, ...next.audienceSignals.customIntent, brief.productService, campaign.name].filter(Boolean),
          googleSegments,
        )
        next = { ...next, audienceSignals: {
          ...next.audienceSignals,
          inMarket: Array.from(new Set([...kept, ...matched])).slice(0, 8),
        } }
      }
      if (next !== campaign) onChange(next)
    } finally { setLoadingAud(false) }
  }

  function addManualKw() {
    if (!manualKw.trim()) return
    const kw: KwIdea = { keyword: manualKw.trim(), matchType: 'PHRASE', avgMonthlySearches: 0, competition: 'MEDIUM', suggestedCpc: 0, selected: true }
    up({ keywords: [...campaign.keywords, kw] })
    setManualKw('')
  }

  function addTheme() {
    if (!newTheme.trim()) return
    up({ searchThemes: [...campaign.searchThemes, newTheme.trim()] })
    setNewTheme('')
  }

  function addCustomIntent() {
    if (!newCustom.trim()) return
    upSig({ customIntent: [...campaign.audienceSignals.customIntent, newCustom.trim()] })
    setNewCustom('')
  }

  const kwCount   = campaign.keywords.length
  const selCount  = selectedKw.length
  const audCount  = campaign.audienceSignals.customIntent.length + campaign.audienceSignals.remarketing.length + campaign.audienceSignals.inMarket.length
  const gaps      = campaignGaps(campaign, accountLists)
  const gapErrors = gaps.filter(g => g.level === 'error')
  const gapWarns  = gaps.filter(g => g.level === 'warn')

  return (
    <>
    {aiPlanOpen && (
      <AiPlanModal
        campaign={campaign}
        brief={brief}
        onClose={() => setAiPlanOpen(false)}
        onApply={patch => onChange({ ...campaign, ...patch })}
      />
    )}
    <div className={`bg-white rounded-2xl border transition-colors ${campaign.done ? 'border-emerald-200' : 'border-neutral-200'} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-100">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${cfg.color} border`}>
          {index + 1}
        </div>

        {editName ? (
          <div className="flex items-center gap-2 flex-1">
            <input autoFocus value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditName(false) }}
              className="flex-1 border border-blue-300 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={saveName} className="p-1 text-emerald-600 hover:text-emerald-700"><Check size={14} /></button>
            <button onClick={() => setEditName(false)} className="p-1 text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => { setNameInput(campaign.name); setEditName(true) }}
            className="flex items-center gap-2 flex-1 text-left hover:text-blue-600 transition-colors group">
            <span className={`text-sm font-semibold ${campaign.name ? 'text-neutral-900' : 'text-neutral-400 italic'}`}>
              {campaign.name || 'คลิกเพื่อใส่ชื่อ campaign...'}
            </span>
            <Edit3 size={12} className="text-neutral-300 group-hover:text-blue-400 shrink-0" />
          </button>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {/* Push readiness chip */}
          {gapErrors.length > 0
            ? <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-semibold border border-red-200">
                <AlertCircle size={9} />ขาด {gapErrors.length}
              </span>
            : gapWarns.length > 0
              ? <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-semibold border border-amber-200">
                  <AlertTriangle size={9} />แนะนำ {gapWarns.length}
                </span>
              : <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-semibold border border-emerald-200">
                  <CheckCircle2 size={9} />ครบ
                </span>}

          {/* AI Plan button */}
          <button onClick={() => setAiPlanOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-700 transition-colors">
            <Wand2 size={11} />AI Plan
          </button>

          {/* Campaign Type selector */}
          <select value={campaign.type}
            onChange={e => {
              const newType = e.target.value as CampaignType
              const strategies = BID_STRATEGIES[newType]
              up({ type: newType, bidStrategy: strategies[0] })
            }}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border focus:outline-none ${cfg.color}`}>
            {CAMPAIGN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {campaign.done
            ? <button onClick={() => up({ done: false })} title="Mark as incomplete">
                <CheckCircle2 size={18} className="text-emerald-500" />
              </button>
            : <button onClick={() => up({ done: true })} title="Mark as done"
                className="w-[18px] h-[18px] rounded-full border-2 border-neutral-300 hover:border-emerald-400 transition-colors" />
          }

          <button onClick={() => setCollapsed(o => !o)} className="p-1 text-neutral-400 hover:text-neutral-600">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={onRemove} className="p-1 text-neutral-300 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-5">
          {/* Settings row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Daily Budget (฿)</label>
              <input type="number" value={campaign.dailyBudget} min={0}
                onChange={e => up({ dailyBudget: Number(e.target.value) })}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Bid Strategy</label>
              <select value={campaign.bidStrategy} onChange={e => up({ bidStrategy: e.target.value })}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200">
                {(BID_STRATEGIES[campaign.type] ?? BID_STRATEGIES.SEARCH).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Target Location</label>
              <input value={campaign.targetLocation}
                onChange={e => up({ targetLocation: e.target.value })}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-neutral-100 pb-0">
            {(['keywords', 'audience', 'ad'] as const).map(t => {
              const adCount = campaign.ad.headlines.split('\n').filter(s => s.trim()).length + campaign.ad.images.filter(i => i.imageUrl).length
              return (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${tab === t ? 'border-neutral-950 text-neutral-950' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>
                {t === 'keywords'
                  ? isSearch ? `Keywords${kwCount > 0 ? ` (${selCount}/${kwCount})` : ''}` : `Search Themes${campaign.searchThemes.length > 0 ? ` (${campaign.searchThemes.length})` : ''}`
                  : t === 'audience'
                  ? `Audience${audCount > 0 ? ` (${audCount})` : ''}`
                  : `${campaign.type === 'SEARCH' ? 'Ad Text' : 'Ad + รูป'}${adCount > 0 ? ` (${adCount})` : ''}`}
              </button>
              )
            })}
          </div>

          {/* Tab: Keywords (Search) */}
          {tab === 'keywords' && isSearch && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">เลือก keywords ที่จะใช้ใน campaign นี้</p>
                <Btn size="sm" onClick={generateKeywords} loading={loadingKw} variant="outline">
                  <Sparkles size={11} />AI Generate Keywords
                </Btn>
              </div>

              {campaign.keywords.length > 0 && (
                <div className="rounded-xl border border-neutral-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-neutral-500 w-6">
                          <input type="checkbox"
                            checked={campaign.keywords.every(k => k.selected)}
                            onChange={e => up({ keywords: campaign.keywords.map(k => ({ ...k, selected: e.target.checked })) })}
                            className="rounded" />
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-500">Keyword</th>
                        <th className="px-3 py-2 text-left font-medium text-neutral-500">Match</th>
                        <th className="px-3 py-2 text-right font-medium text-neutral-500">Vol</th>
                        <th className="px-3 py-2 text-right font-medium text-neutral-500">CPC</th>
                        <th className="px-3 py-2 w-6"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {campaign.keywords.map((kw, i) => (
                        <tr key={i} className={`transition-colors ${kw.selected ? '' : 'opacity-40'}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={kw.selected}
                              onChange={() => up({ keywords: campaign.keywords.map((k, j) => j === i ? { ...k, selected: !k.selected } : k) })}
                              className="rounded" />
                          </td>
                          <td className="px-3 py-2 font-medium text-neutral-900">{kw.keyword}</td>
                          <td className="px-3 py-2">
                            <select value={kw.matchType}
                              onChange={e => up({ keywords: campaign.keywords.map((k, j) => j === i ? { ...k, matchType: e.target.value as KwIdea['matchType'] } : k) })}
                              className={`text-xs px-2 py-0.5 rounded-full border-0 font-medium focus:outline-none cursor-pointer ${MATCH_COLORS[kw.matchType]}`}>
                              {['BROAD','PHRASE','EXACT'].map(m => <option key={m} value={m}>{MATCH_LABELS[m]}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right text-neutral-500 tabular-nums">
                            {kw.avgMonthlySearches > 0 ? kw.avgMonthlySearches.toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-neutral-500 tabular-nums">
                            {kw.suggestedCpc > 0 ? `฿${kw.suggestedCpc.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => up({ keywords: campaign.keywords.filter((_, j) => j !== i) })}
                              className="text-neutral-300 hover:text-red-500 transition-colors">
                              <X size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Manual add */}
              <div className="flex gap-2">
                <input value={manualKw} onChange={e => setManualKw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addManualKw()}
                  placeholder="พิมพ์ keyword แล้วกด Enter..."
                  className="flex-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                <Btn size="sm" onClick={addManualKw} variant="outline"><Plus size={12} />Add</Btn>
              </div>
            </div>
          )}

          {/* Tab: Search Themes (PMax/Video/DemandGen) */}
          {tab === 'keywords' && isPmax && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">Search themes ที่ใช้ใน {campaign.type} campaign</p>
                <Btn size="sm" onClick={generateThemes} loading={loadingKw} variant="outline">
                  <Sparkles size={11} />AI Suggest Themes
                </Btn>
              </div>
              <div className="flex flex-wrap gap-2 min-h-[36px]">
                {campaign.searchThemes.map((t, i) => (
                  <Tag key={i} color="bg-orange-50 text-orange-800"
                    onRemove={() => up({ searchThemes: campaign.searchThemes.filter((_, j) => j !== i) })}>
                    {t}
                  </Tag>
                ))}
                {campaign.searchThemes.length === 0 && <p className="text-xs text-neutral-400">ยังไม่มี search themes — กด AI Suggest หรือพิมพ์เอง</p>}
              </div>
              <div className="flex gap-2">
                <input value={newTheme} onChange={e => setNewTheme(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTheme()}
                  placeholder="เพิ่ม theme เอง..."
                  className="flex-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                <Btn size="sm" onClick={addTheme} variant="outline"><Plus size={12} />Add</Btn>
              </div>
            </div>
          )}

          {/* Tab: Audience */}
          {tab === 'audience' && (() => {
            const isSearchCamp = campaign.type === 'SEARCH'
            const remarketingSection = (
              <Section title={isSearchCamp
                ? 'RLSA — Remarketing Lists (optional)'
                : accountLists.length > 0 ? 'Remarketing Lists (จากบัญชีจริง)' : 'Remarketing Lists'}>
                {accountLists.length > 0 && !isSearchCamp && (
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-neutral-500">list ที่มีอยู่จริงในบัญชี — ระบบเพิ่มให้อัตโนมัติตอนกด &quot;สร้างทั้งหมด&quot;</p>
                    <Btn size="sm" variant="outline" onClick={() => upSig({
                      remarketing: Array.from(new Set([...campaign.audienceSignals.remarketing, ...accountLists]))
                    })}>
                      <Plus size={11} />เพิ่มทั้งหมด ({accountLists.length})
                    </Btn>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(accountLists.length > 0 ? accountLists : REMARKETING_LISTS).map(opt => {
                    const active = campaign.audienceSignals.remarketing.includes(opt)
                    return (
                      <button key={opt} onClick={() => upSig({
                        remarketing: active
                          ? campaign.audienceSignals.remarketing.filter(s => s !== opt)
                          : [...campaign.audienceSignals.remarketing, opt]
                      })}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${active ? 'bg-amber-500 text-white border-amber-500' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
                        {opt}
                      </button>
                    )
                  })}
                  {campaign.audienceSignals.remarketing.filter(s => !accountLists.includes(s) && !REMARKETING_LISTS.includes(s)).map(s => (
                    <Tag key={s} color="bg-amber-50 text-amber-700"
                      onRemove={() => upSig({ remarketing: campaign.audienceSignals.remarketing.filter(x => x !== s) })}>
                      {s}
                    </Tag>
                  ))}
                </div>
              </Section>
            )

            // RULE: Search campaigns take NO audience targeting — RLSA opt-in only
            if (isSearchCamp) {
              return (
                <div className="space-y-5">
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3">
                    <p className="text-xs font-bold text-blue-800 mb-1">Search ไม่ใส่ Audience Targeting</p>
                    <p className="text-[11px] text-blue-700">
                      แคมเปญ Search ใช้ keyword เป็นตัวกำหนดกลุ่มเป้าหมาย — ไม่ต้องเลือก audience
                      ยกเว้นอย่างเดียว: <b>RLSA</b> (remarketing list ของคนที่เคยเข้าเว็บ) เลือกด้านล่างได้ถ้าต้องการ bid แรงขึ้นกับคนเคยเข้าเว็บ
                    </p>
                  </div>
                  {remarketingSection}
                </div>
              )
            }

            // RULE: Remarketing campaigns pick remarketing lists ONLY
            if (campaign.type === 'REMARKETING') {
              return (
                <div className="space-y-5">
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-xs font-bold text-amber-800 mb-1">Remarketing เลือกจาก Remarketing List เท่านั้น</p>
                    <p className="text-[11px] text-amber-700">
                      แคมเปญนี้ยิงหาคนที่เคยเข้าเว็บ — ระบบเลือก list จริงจากบัญชีให้อัตโนมัติตอนกด &quot;สร้างทั้งหมด&quot; ไม่ใช้ In-Market/Affinity
                    </p>
                  </div>
                  {remarketingSection}
                </div>
              )
            }

            // PMAX/DEMAND_GEN = Audience SIGNAL · DISPLAY = Audience TARGETING
            return (
              <div className="space-y-5">
                {isPmax && (
                  <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3">
                    <p className="text-xs font-bold text-purple-800 mb-1">
                      <Zap size={11} className="inline mr-1" />Audience Signal — ไม่ใช่ targeting
                    </p>
                    <p className="text-[11px] text-purple-700">
                      {campaign.type} ใช้ทั้งหมดนี้เป็น <b>signal</b> ให้ Google หากลุ่มที่ใกล้เคียง (ไม่ได้จำกัดการแสดงผล):
                      Custom Intent ({campaign.audienceSignals.customIntent.length}) + In-Market/Affinity ({campaign.audienceSignals.inMarket.length}) + Remarketing ({campaign.audienceSignals.remarketing.length}) + Search Themes ({campaign.searchThemes.length})
                      — แนบเข้า asset group ตอน push อัตโนมัติ ระบบ generate ให้ครบจากปุ่ม &quot;สร้างทั้งหมด&quot;
                    </p>
                  </div>
                )}

                {/* In-Market / Affinity — REAL Google taxonomy, system pre-selects */}
                <Section title={isPmax ? 'In-Market / Affinity (Signal) — จาก Google จริง' : 'In-Market / Affinity — Audience จริงจาก Google'}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-neutral-500">ระบบเลือกจาก audience ที่มีจริงใน Google ให้แล้ว — ค้นหาเพิ่ม/ลบได้เหมือน Google Ads</p>
                    <Btn size="sm" onClick={generateAudience} loading={loadingAud} variant="outline">
                      <Sparkles size={11} />AI เลือกให้
                    </Btn>
                  </div>
                  <GoogleAudiencePicker
                    segments={googleSegments}
                    selected={campaign.audienceSignals.inMarket}
                    onChange={names => upSig({ inMarket: names })} />
                </Section>

                {/* Custom Intent — signal keywords, PMax/Demand Gen only */}
                {isPmax && (
                  <Section title="Custom Intent (Signal)">
                    <p className="text-xs text-neutral-500 mb-2">คำค้นที่บ่งชี้ความตั้งใจซื้อ — ใช้เป็น signal เท่านั้น (ไม่ใช่ audience targeting)</p>
                    <div className="flex flex-wrap gap-2 min-h-[36px]">
                      {campaign.audienceSignals.customIntent.map((s, i) => (
                        <Tag key={i} color="bg-blue-50 text-blue-700"
                          onRemove={() => upSig({ customIntent: campaign.audienceSignals.customIntent.filter((_, j) => j !== i) })}>
                          {s}
                        </Tag>
                      ))}
                      {campaign.audienceSignals.customIntent.length === 0 && <p className="text-xs text-neutral-400">ยังไม่มี — กด &quot;สร้างทั้งหมด&quot; หรือ &quot;AI เลือกให้&quot;</p>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input value={newCustom} onChange={e => setNewCustom(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addCustomIntent()}
                        placeholder="เพิ่ม intent keyword..."
                        className="flex-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                      <Btn size="sm" onClick={addCustomIntent} variant="outline"><Plus size={12} />Add</Btn>
                    </div>
                  </Section>
                )}

                {remarketingSection}
              </div>
            )
          })()}

          {/* Tab: Ad text + assets — everything Google Ads needs per campaign type */}
          {tab === 'ad' && (() => {
            const t = AD_TARGETS[campaign.type]
            const isSearchType = campaign.type === 'SEARCH'
            const needsImages  = campaign.type !== 'SEARCH'
            const needsVideo   = campaign.type === 'PMAX' || campaign.type === 'DEMAND_GEN'
            const counter = (n: number, target: number) => (
              <span className={`ml-1.5 normal-case tracking-normal font-semibold ${n >= target ? 'text-emerald-600' : 'text-amber-500'}`}>{n}/{target}</span>
            )
            // Per-type limits follow Google Ads: RDA/PMax allow up to 15 marketing images
            // per shape and 5 logos — at least 1 required where marked.
            const imageSlots = [
              { assetType: 'LOGO',                     label: 'Logo',      size: '1200×1200', max: 5,  required: campaign.type !== 'DISPLAY' && campaign.type !== 'REMARKETING' },
              { assetType: 'MARKETING_IMAGE',          label: 'Landscape', size: '1200×628',  max: 15, required: true },
              { assetType: 'SQUARE_MARKETING_IMAGE',   label: 'Square',    size: '1200×1200', max: 15, required: true },
              ...(campaign.type === 'PMAX' || campaign.type === 'DEMAND_GEN'
                ? [{ assetType: 'PORTRAIT_MARKETING_IMAGE', label: 'Portrait', size: '960×1200', max: 15, required: false }]
                : []),
            ]
            const updateSitelink = (i: number, patch: Partial<Sitelink>) =>
              upAd({ sitelinks: campaign.ad.sitelinks.map((s, j) => j === i ? { ...s, ...patch } : s) })
            return (
            <div className="pt-4 md:grid md:grid-cols-[minmax(0,1fr),300px] md:gap-6 md:items-start">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {!isSearchType && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Business Name (≤25 ตัว) <span className="text-red-400">*</span></label>
                    <input value={campaign.ad.businessName} onChange={e => upAd({ businessName: e.target.value })}
                      placeholder="ชื่อแบรนด์ที่โชว์ในโฆษณา"
                      className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Final URL (Landing Page) <span className="text-red-400">*</span></label>
                  <input value={campaign.ad.finalUrl} onChange={e => upAd({ finalUrl: e.target.value })}
                    onBlur={e => { const v = e.target.value.trim(); if (v && !/^https?:\/\//i.test(v)) upAd({ finalUrl: `https://${v}` }) }}
                    placeholder="https://..."
                    className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                </div>
              </div>

              <FieldListEditor label="Headline" value={campaign.ad.headlines}
                onChange={v => upAd({ headlines: v })}
                maxItems={15} maxLen={t.hMax} target={t.h} placeholder="รับทำโฆษณาออนไลน์" />

              {t.lh > 0 && (
                <FieldListEditor label="Long Headline" value={campaign.ad.longHeadlines}
                  onChange={v => upAd({ longHeadlines: v })}
                  maxItems={5} maxLen={90} target={t.lh}
                  placeholder="บริการครบวงจรโดยทีมผู้เชี่ยวชาญ ดูแลตั้งแต่ต้นจนจบ ปรึกษาฟรีวันนี้" />
              )}

              <div>
                <FieldListEditor label="Description" value={campaign.ad.descriptions}
                  onChange={v => upAd({ descriptions: v })}
                  maxItems={5} maxLen={t.dMax} target={t.d}
                  placeholder="บริการรับทำโฆษณาโดยทีมมืออาชีพ เน้นผลลัพธ์ วัดผลได้จริง" />
                {campaign.type === 'PMAX' && <p className="text-[10px] text-neutral-400 mt-1">อันแรกควร ≤60 ตัวอักษร (short description slot ของ PMax)</p>}
              </div>

              {isSearchType && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Display Path 1 (≤15 ไม่มีเว้นวรรค)</label>
                      <input value={campaign.ad.displayPath1} onChange={e => upAd({ displayPath1: e.target.value })}
                        placeholder="เช่น google-ads"
                        className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Display Path 2</label>
                      <input value={campaign.ad.displayPath2} onChange={e => upAd({ displayPath2: e.target.value })}
                        placeholder="เช่น โปรโมชั่น"
                        className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">
                      Sitelinks{counter(campaign.ad.sitelinks.filter(s => s.text.trim()).length, 4)}
                      <span className="ml-1.5 normal-case tracking-normal text-neutral-400">· text ≤25 · desc ≤35</span>
                    </label>
                    <div className="space-y-2">
                      {campaign.ad.sitelinks.map((s, i) => (
                        <div key={i} className="rounded-xl border border-neutral-200 p-2.5 space-y-1.5">
                          <div className="flex gap-2">
                            <input value={s.text} onChange={e => updateSitelink(i, { text: e.target.value })}
                              placeholder="ข้อความลิงก์ เช่น ราคาแพ็กเกจ"
                              className="flex-1 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                            <input value={s.finalUrl} onChange={e => updateSitelink(i, { finalUrl: e.target.value })}
                              placeholder="https://... (เว้นว่าง = ใช้ Final URL)"
                              className="flex-1 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                            <button onClick={() => upAd({ sitelinks: campaign.ad.sitelinks.filter((_, j) => j !== i) })}
                              className="text-neutral-300 hover:text-red-500 transition-colors shrink-0"><X size={13} /></button>
                          </div>
                          <div className="flex gap-2">
                            <input value={s.description1} onChange={e => updateSitelink(i, { description1: e.target.value })}
                              placeholder="คำอธิบาย 1 (optional)"
                              className="flex-1 border border-neutral-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                            <input value={s.description2} onChange={e => updateSitelink(i, { description2: e.target.value })}
                              placeholder="คำอธิบาย 2 (optional)"
                              className="flex-1 border border-neutral-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-300" />
                          </div>
                        </div>
                      ))}
                      <Btn size="sm" variant="outline"
                        onClick={() => upAd({ sitelinks: [...campaign.ad.sitelinks, { text: '', description1: '', description2: '', finalUrl: '' }] })}>
                        <Plus size={11} />เพิ่ม Sitelink
                      </Btn>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FieldListEditor label="Callout" value={campaign.ad.callouts}
                      onChange={v => upAd({ callouts: v })}
                      maxItems={10} maxLen={25} target={4} placeholder="ที่ปรึกษามืออาชีพ" />
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">
                        Structured Snippet — header + ค่า (≥3 บรรทัด)
                      </label>
                      <input value={campaign.ad.snippetHeader} onChange={e => upAd({ snippetHeader: e.target.value })}
                        placeholder="Header เช่น บริการ / Services"
                        className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mb-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                      <textarea value={campaign.ad.snippetValues} onChange={e => upAd({ snippetValues: e.target.value })}
                        rows={2} placeholder={'วีซ่าท่องเที่ยว\nวีซ่าทำงาน\nวีซ่านักเรียน'}
                        className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                    </div>
                  </div>
                </>
              )}

              {needsVideo && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">
                    YouTube Video URLs — 1 บรรทัด = 1 วิดีโอ
                    <span className="ml-1.5 normal-case tracking-normal text-neutral-400">· optional — ไม่ใส่ Google จะ auto-generate จากรูป</span>
                  </label>
                  <textarea value={campaign.ad.videoUrls} onChange={e => upAd({ videoUrls: e.target.value })}
                    rows={2} placeholder={'https://www.youtube.com/watch?v=...'}
                    className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
                </div>
              )}

              {needsImages && (
                <div className="space-y-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400">รูปภาพ (จำเป็นสำหรับ {campaign.type})</label>
                  {imageSlots.map(slot => {
                    const imgs = campaign.ad.images.filter(i => i.assetType === slot.assetType)
                    return (
                      <div key={slot.assetType}>
                        <div className="text-[10px] font-semibold text-neutral-500 mb-1.5">
                          {slot.label} <span className="text-neutral-400 font-normal">{slot.size}</span>
                          <span className={`ml-1.5 font-bold ${imgs.length > 0 ? 'text-emerald-600' : slot.required ? 'text-red-500' : 'text-neutral-400'}`}>
                            {imgs.length}/{slot.max}
                          </span>
                          {slot.required && imgs.length === 0 && <span className="text-red-400 ml-1">* ต้องมีอย่างน้อย 1</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {imgs.map((img, i) => (
                            <div key={`${img.imageUrl}-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-neutral-200 group">
                              <img src={img.imageUrl} alt={`${slot.label} ${i + 1}`} className="w-full h-full object-cover" />
                              <button
                                onClick={() => upAd({ images: campaign.ad.images.filter(x => x !== img) })}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <X size={9} />
                              </button>
                            </div>
                          ))}
                          {imgs.length < slot.max && (
                            <label className="w-16 h-16 rounded-lg border-2 border-dashed border-neutral-200 flex flex-col items-center justify-center cursor-pointer hover:border-neutral-400 text-neutral-400 transition-colors">
                              {uploading === slot.assetType
                                ? <Loader2 size={14} className="animate-spin" />
                                : <><Plus size={14} /><span className="text-[9px] mt-0.5">เพิ่ม</span></>}
                              <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
                                onChange={e => { handleImagePick(slot.assetType, e.target.files, slot.max); e.target.value = '' }} />
                            </label>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <p className="text-[10px] text-neutral-400">
                    {campaign.type === 'PMAX' || campaign.type === 'DEMAND_GEN'
                      ? <>ต้องมี <b>Logo + Landscape + Square</b> อย่างน้อยอย่างละ 1 ถึงจะ push ได้ · เพิ่มได้สูงสุดตาม limit ของ Google (รูปเยอะ = Google มีตัวเลือก optimize มากขึ้น)</>
                      : <>Display ต้องมี <b>Landscape + Square</b> อย่างน้อยอย่างละ 1 · Logo แนะนำ · เพิ่มได้ถึง 15 รูปต่อขนาด</>}
                    {' '}· รูปไม่ตรงขนาด <b>ระบบ crop กลางรูปให้อัตโนมัติ</b>
                  </p>
                </div>
              )}
            </div>

            {/* Right column: live Google-style ad preview */}
            <div className="mt-6 md:mt-0 md:sticky md:top-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-2">
                Ad Preview · {campaign.type === 'SEARCH' ? 'Google Search' : 'Display Network'}
              </div>
              <AdPreview campaign={campaign} />
              <p className="text-[10px] text-neutral-400 mt-2">
                Preview อัปเดตสดตามที่พิมพ์ — Google จะสุ่มสลับ headline/description จริงตอนแสดงผล
              </p>
            </div>
            </div>
            )
          })()}

          {/* Push readiness checklist — what Google Ads still needs from this campaign */}
          <div className={`rounded-xl border p-3 ${gapErrors.length > 0 ? 'border-red-200 bg-red-50/50' : gapWarns.length > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-1.5">
              Google Ads Readiness · {campaign.type}
            </div>
            {gaps.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 size={12} className="shrink-0" />ครบทุกอย่างที่ Google Ads ต้องการ — พร้อม push
              </div>
            ) : (
              <div className="space-y-1">
                {gapErrors.map((g, i) => (
                  <div key={`e${i}`} className="flex items-start gap-1.5 text-xs text-red-700">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />{g.msg}
                  </div>
                ))}
                {gapWarns.map((g, i) => (
                  <div key={`w${i}`} className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />{g.msg}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  )
}

// ── Summary bar ────────────────────────────────────────────────────────────────

function SummaryBar({ campaigns }: { campaigns: Campaign[] }) {
  const total   = campaigns.length
  const done    = campaigns.filter(c => c.done).length
  const totalBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0)
  const totalKw = campaigns.reduce((s, c) => s + c.keywords.filter(k => k.selected).length, 0)
  const allDone = total > 0 && done === total

  if (total === 0) return null

  return (
    <div className={`rounded-2xl border p-4 ${allDone ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-neutral-200'}`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          {allDone
            ? <CheckCircle2 size={16} className="text-emerald-500" />
            : <AlertTriangle size={16} className="text-amber-500" />}
          <span className={`text-sm font-semibold ${allDone ? 'text-emerald-800' : 'text-neutral-900'}`}>
            {allDone ? 'ทุก campaign พร้อม launch' : `${done}/${total} campaigns done`}
          </span>
        </div>
        <div className="flex gap-4 text-xs text-neutral-500">
          <span>{total} campaigns</span>
          <span>฿{totalBudget.toLocaleString()}/day</span>
          {totalKw > 0 && <span>{totalKw} keywords selected</span>}
        </div>
        {!allDone && (
          <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden min-w-[80px]">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Account selector (top of page) ───────────────────────────────────────────────

function AccountBar({ accounts, selected, loading, onSelect }: {
  accounts: GadsAccount[]; selected: GadsAccount | null; loading: boolean
  onSelect: (a: GadsAccount | null) => void
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Building2 size={16} className="text-neutral-700" />
          <span className="text-sm font-semibold text-neutral-900">Google Ads Account</span>
        </div>
        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-neutral-400"><Loader2 size={12} className="animate-spin" /> กำลังโหลด accounts...</span>
        ) : accounts.length === 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle size={12} /> ไม่พบ account — เชื่อม Google Ads ก่อน</span>
        ) : (
          <>
            <AccountSelect
              accounts={accounts}
              value={selected?.id ?? ''}
              onChange={id => onSelect(accounts.find(a => a.id === id) ?? null)}
              placeholder="— เลือก account ปลายทางก่อน —"
              className={`flex-1 min-w-[220px] text-sm border rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10 ${selected ? 'border-neutral-200' : 'border-amber-400'}`}
            />
            {selected && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 shrink-0">
                <ShieldCheck size={12} /> push เข้า: {selected.name}
              </span>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        เลือก account ปลายทางก่อน เพื่อกัน push ผิดบัญชี — ทุก campaign จะถูกสร้างเป็น <span className="font-semibold text-amber-600">PAUSED</span> เสมอ
      </p>
    </div>
  )
}

// ── Push panel ───────────────────────────────────────────────────────────────────

function Stat({ label, value, amber = false }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`text-lg font-bold ${amber ? 'text-amber-600' : 'text-neutral-900'}`}>{value}</p>
    </div>
  )
}

interface PushCampaignResult { campaignName: string; status: string; error?: string; adsCreated?: number; warnings?: string[] }

function LaunchPushPanel({ readyCampaigns, brief, account, accountLists }: {
  readyCampaigns: Campaign[]; brief: BriefCtx; account: GadsAccount | null; accountLists: string[]
}) {
  const [pushing, setPushing]   = useState(false)
  const [mode, setMode]         = useState<'dry_run' | 'live' | null>(null)
  const [confirm, setConfirm]   = useState(false)
  const [result, setResult]     = useState<{ success: boolean; message: string; campaigns?: PushCampaignResult[] } | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const dailyTotal   = readyCampaigns.reduce((s, c) => s + c.dailyBudget, 0)
  const monthlyTotal = dailyTotal * 30

  // Block the push while any campaign is missing something Google Ads REQUIRES —
  // otherwise the push fails mid-way or creates empty campaign shells.
  const blockers = readyCampaigns
    .map(c => ({ name: c.name.trim() || '(ไม่มีชื่อ)', errors: campaignGaps(c, accountLists).filter(g => g.level === 'error') }))
    .filter(b => b.errors.length > 0)
  const canPush = !!account && blockers.length === 0

  async function doPush(m: 'dry_run' | 'live') {
    if (!account) return
    setPushing(true); setMode(m); setError(null); setResult(null); setConfirm(false)
    try {
      // 1) create a media plan to attach the blueprint to (push-blueprint requires a plan id)
      const createRes = await fetch('/api/media-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName:  brief.businessName || 'Launch Today',
          monthlyBudget: monthlyTotal,
          status:        'review',
          brief: {
            businessName:   brief.businessName,
            productService: brief.productService,
            targetLocation: brief.targetLocation,
          },
        }),
      })
      if (!createRes.ok) throw new Error(await createRes.text())
      const planId = (await createRes.json()).id as string
      const acct = account

      // 2) push "ทีละแคมเปญ" — 1 request/แคมเปญ กัน timeout บน serverless (Vercel)
      const accountSettings = { currency: acct.currencyCode ?? 'THB', timeZone: 'Asia/Bangkok', autoTagging: true }
      const pushOne = async (idx: number, forceMaxClicks: boolean, append: boolean) => {
        const res = await fetch(`/api/media-plans/${planId}/push-blueprint`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: acct.id, mode: m, append,
            blueprintJson: { campaigns: [toBlueprint(readyCampaigns[idx], forceMaxClicks)], accountSettings, conversionActions: [] },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Push failed')
        return data
      }

      const allResults: NonNullable<NonNullable<typeof result>['campaigns']> = []
      let usedMaxClicks = false
      for (let i = 0; i < readyCampaigns.length; i++) {
        // Maximize Conversions/Target CPA need conversion tracking — if the account has
        // none, Google rejects the campaign. Retry that campaign with Maximize Clicks.
        let data = await pushOne(i, false, i > 0)
        let camp = data.result?.campaigns?.[0]
        if (JSON.stringify(camp ?? data).includes('Conversion tracking is not enabled')) {
          usedMaxClicks = true
          data = await pushOne(i, true, true)
          camp = data.result?.campaigns?.[0]
        }
        if (camp) allResults.push(camp)
        setResult({ success: false, message: `กำลัง push... ${i + 1}/${readyCampaigns.length}`, campaigns: [...allResults] })
      }
      const created = allResults.filter(c => c.status === 'success').length
      const success = allResults.length > 0 && allResults.every(c => c.status === 'success')
      setResult({
        success,
        message: (m === 'dry_run'
          ? `Dry run ผ่าน — ตรวจสอบ ${readyCampaigns.length} campaigns แล้ว ไม่มีการสร้างจริง`
          : `Push สำเร็จ — สร้าง ${created}/${readyCampaigns.length} campaigns (PAUSED) ใน ${acct.name}`)
          + (usedMaxClicks ? ' · ⚠ account ไม่มี conversion tracking → ใช้ Maximize Clicks อัตโนมัติ' : ''),
        campaigns: allResults,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setPushing(false); setMode(null)
    }
  }

  if (readyCampaigns.length === 0) return null

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Send size={16} className="text-neutral-900" />
        <h3 className="text-sm font-bold text-neutral-900">Push to Google Ads</h3>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Campaigns"    value={String(readyCampaigns.length)} />
        <Stat label="Daily Budget" value={`฿${dailyTotal.toLocaleString()}`} />
        <Stat label="Status"       value="PAUSED" amber />
      </div>

      {account ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3">
          <Building2 size={14} className="text-neutral-500" />
          <span className="text-xs text-neutral-500">ปลายทาง:</span>
          <span className="text-sm font-semibold text-neutral-900">{account.name}</span>
          <span className="text-xs text-neutral-400">({account.id})</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-600">
          <AlertCircle size={14} /> ยังไม่ได้เลือก Google Ads account ด้านบน
        </div>
      )}

      {blockers.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-red-700">ยัง push ไม่ได้ — ขาดสิ่งที่ Google Ads บังคับ:</p>
          {blockers.map((b, i) => (
            <div key={i} className="text-xs text-red-700">
              <span className="font-semibold">{b.name}:</span> {b.errors.map(e => e.msg).join(' · ')}
            </div>
          ))}
        </div>
      )}

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 break-words">{error}</div>}
      {result && (
        <div className={`rounded-xl border px-4 py-3 text-xs ${result.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <p className="font-semibold mb-1">{result.message}</p>
          {result.campaigns && result.campaigns.length > 0 && (
            <ul className="space-y-0.5 mt-1.5">
              {result.campaigns.map((c, i) => (
                <li key={i}>
                  <div className="flex items-center gap-1.5">
                    {/success|created|ok|completed/i.test(c.status)
                      ? <Check size={11} className="text-emerald-600 shrink-0" />
                      : <X size={11} className="text-red-500 shrink-0" />}
                    <span>{c.campaignName} — {c.status}{typeof c.adsCreated === 'number' ? ` · ${c.adsCreated} ads` : ''}{c.error ? `: ${c.error}` : ''}</span>
                  </div>
                  {(c.warnings ?? []).map((w, j) => (
                    <div key={j} className="flex items-start gap-1.5 ml-4 mt-0.5 text-amber-700">
                      <AlertTriangle size={10} className="shrink-0 mt-0.5" />{w}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Btn variant="outline" onClick={() => doPush('dry_run')} disabled={!canPush || pushing} loading={pushing && mode === 'dry_run'}>
          <ShieldCheck size={13} /> Test (Dry Run)
        </Btn>
        <Btn variant="primary" onClick={() => setConfirm(true)} disabled={!canPush || pushing} loading={pushing && mode === 'live'}>
          <Send size={13} /> Push จริง (Live)
        </Btn>
      </div>

      {confirm && account && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirm(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              <h4 className="text-base font-bold text-neutral-900">ยืนยัน Push จริง</h4>
            </div>
            <p className="text-sm text-neutral-600">
              กำลังจะสร้าง <span className="font-bold">{readyCampaigns.length} campaigns</span> เข้าบัญชี:
            </p>
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-bold text-amber-900">{account.name}</p>
              <p className="text-xs text-amber-700">Customer ID: {account.id}{account.currencyCode ? ` · ${account.currencyCode}` : ''}</p>
            </div>
            <p className="text-xs text-neutral-400">ทุก campaign จะถูกสร้างเป็น PAUSED — เปิดเองภายหลังใน Google Ads</p>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setConfirm(false)}>ยกเลิก</Btn>
              <Btn variant="primary" onClick={() => doPush('live')}><Send size={13} /> ยืนยัน push เข้า {account.name}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Remarketing Audience (final step — OPTIONAL) ────────────────────────────────
// Mirrors the Campaign Generator's GTM Tracking panel: push GA4 Config + Conversion
// Linker + Google Ads Remarketing tag to GTM, list the account's existing remarketing
// lists, and export a setup doc. Never blocks the campaign push — when launching in a
// hurry the client's GA4/GTM access is often not granted yet.

interface GtmContainer { accountId: string; accountName: string; containerId: string; containerName: string; publicId: string }
interface Ga4Property  { propertyId: string; displayName: string }
interface UserListRow  { id: string; name: string; type: string; membershipLifeSpan: number; memberCount: number }

// Standard remarketing lists worth creating for every new account
const SUGGESTED_AUDIENCES = [
  { name: 'All Website Visitors (30d)', days: 30,  rule: 'Page URL contains /' },
  { name: 'All Website Visitors (90d)', days: 90,  rule: 'Page URL contains /' },
  { name: 'Converted Visitors (180d)',  days: 180, rule: 'Page URL contains /thank-you' },
]

function buildAudienceSetupHTML(brief: BriefCtx, account: GadsAccount | null, opts: {
  gtm?: GtmContainer | null; ga4?: Ga4Property | null; conversionId?: string
  existing: UserListRow[]
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const biz = esc(brief.businessName || 'Client')
  const rows = SUGGESTED_AUDIENCES.map(a =>
    `<tr><td>${esc(a.name)}</td><td>${a.days} วัน</td><td>${esc(a.rule)}</td></tr>`).join('')
  const existingRows = opts.existing.length > 0
    ? opts.existing.map(a => `<tr><td>${esc(a.name)}</td><td>${a.membershipLifeSpan} วัน</td><td>${a.memberCount.toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="3" style="color:#999">ยังไม่มี remarketing list ในบัญชี</td></tr>'
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>Remarketing Setup — ${biz}</title>
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;max-width:800px;margin:32px auto;padding:0 20px;color:#1a1a1a;line-height:1.6}
h1{font-size:22px}h2{font-size:16px;margin-top:28px;border-bottom:2px solid #eee;padding-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 10px;text-align:left}th{background:#f7f7f7}
ol li{margin-bottom:6px}.meta{background:#f7f9fc;border:1px solid #e3e8f0;border-radius:8px;padding:12px 16px;font-size:14px}
.warn{background:#fff8e6;border:1px solid #f0dfa8;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:8px}</style></head><body>
<h1>Remarketing Audience Setup — ${biz}</h1>
<div class="meta">
Google Ads Account: <b>${esc(account ? `${account.name} (${account.id})` : 'ยังไม่ระบุ')}</b><br>
GTM Container: <b>${esc(opts.gtm ? `${opts.gtm.containerName} (${opts.gtm.publicId})` : 'ยังไม่ระบุ — ขอ access จากลูกค้า')}</b><br>
GA4 Property: <b>${esc(opts.ga4 ? `${opts.ga4.displayName} (G-${opts.ga4.propertyId})` : 'ยังไม่ระบุ — ขอ access จากลูกค้า')}</b><br>
Conversion/Remarketing ID: <b>${esc(opts.conversionId || 'ดึงจาก Google Ads → Tools → Audience Manager → Audience sources')}</b>
</div>
<h2>1) Tag ที่ต้องติดตั้งใน GTM</h2>
<ol>
<li><b>Google Ads Remarketing (จำเป็น — ตัวเดียวพอสำหรับสะสม audience)</b> — Conversion ID: ${esc(opts.conversionId || 'AW-XXXXXXXXX')} · trigger: All Pages</li>
<li><b>Conversion Linker</b> (แนะนำ — ช่วย conversion tracking ภายหลัง) — trigger: All Pages</li>
<li><b>GA4 Configuration</b> (optional) — Measurement ID: ${esc(opts.ga4 ? `G-${opts.ga4.propertyId}` : 'G-XXXXXXX')} · trigger: All Pages</li>
</ol>
<div class="warn">ถ้าใช้ระบบนี้ push GTM ให้อัตโนมัติได้ (ต้องมีสิทธิ์ GTM edit/publish) — ระบบจะติดตั้งเฉพาะ Remarketing tag (ข้อ 1) ให้และ publish อัตโนมัติ</div>
<h2>2) Remarketing Lists ที่แนะนำให้สร้าง (Google Ads UI)</h2>
<table><tr><th>ชื่อ Audience</th><th>Membership</th><th>Rule</th></tr>${rows}</table>
<ol>
<li>Google Ads → Tools & Settings → Shared Library → <b>Audience Manager</b></li>
<li>คลิก <b>+</b> → <b>Website visitors</b></li>
<li>ตั้งชื่อตามตาราง → เลือก "Visited a page with URL containing" ตาม Rule</li>
<li>ตั้ง Membership duration ตามตาราง → Save</li>
<li>ระบบเริ่มสะสม visitors ใน 24–48 ชม. (ต้องมี tag ข้อ 1 ติดบนเว็บก่อน)</li>
</ol>
<h2>3) Remarketing Lists ที่มีอยู่แล้วในบัญชี</h2>
<table><tr><th>ชื่อ</th><th>Membership</th><th>ขนาด</th></tr>${existingRows}</table>
<h2>4) เชื่อม GA4 ↔ Google Ads (ถ้ายังไม่เชื่อม)</h2>
<ol>
<li>GA4 → Admin → Product Links → <b>Google Ads Links</b> → Link เข้าบัญชี ${esc(account?.id ?? '')}</li>
<li>เปิด <b>Enable Personalized Advertising</b> เพื่อให้ audience จาก GA4 ไหลเข้า Google Ads</li>
</ol>
<p style="color:#999;font-size:12px;margin-top:32px">Generated by Mercy · Launch Today · ${new Date().toLocaleDateString('th-TH')}</p>
</body></html>`
}

function RemarketingAudiencePanel({ brief, account }: { brief: BriefCtx; account: GadsAccount | null }) {
  const { data: session } = useSession()
  const accessToken = (session as Record<string, unknown> | null)?.accessToken as string | undefined

  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Existing remarketing lists in the selected account
  const [existing, setExisting]     = useState<UserListRow[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // GTM / GA4 targets
  const [containers, setContainers]   = useState<GtmContainer[]>([])
  const [ga4Props, setGa4Props]       = useState<Ga4Property[]>([])
  const [selContainer, setSelContainer] = useState<GtmContainer | null>(null)
  const [selGa4, setSelGa4]           = useState<Ga4Property | null>(null)
  const [loadingGtm, setLoadingGtm]   = useState(false)
  const [conversionId, setConversionId] = useState('')
  const [withLinker, setWithLinker]   = useState(false)   // Conversion Linker = +1 GTM call, optional
  const [pushing, setPushing]         = useState(false)
  const [log, setLog]                 = useState<string[]>([])
  const [result, setResult]           = useState<{ ok: boolean; error?: string } | null>(null)

  // Lazy-load everything on first open — this step is optional, don't burn quota upfront
  useEffect(() => {
    if (!open || loaded) return
    setLoaded(true)
    setLoadingGtm(true)
    const headers: Record<string, string> = {}
    if (accessToken) headers['x-access-token'] = accessToken
    fetch('/api/tracking/gtm-containers', { headers })
      .then(r => r.json())
      .then(d => {
        const list: GtmContainer[] = d.containers ?? []
        setContainers(list)
        if (list.length > 0) setSelContainer(list[0])
      })
      .catch(() => {})
      .finally(() => setLoadingGtm(false))
    fetch('/api/integrations/ga4')
      .then(r => r.json())
      .then(d => {
        const list: Ga4Property[] = d.data ?? []
        setGa4Props(list)
        if (list.length > 0) setSelGa4(list[0])
      })
      .catch(() => {})
  }, [open, loaded, accessToken])

  // Existing lists + conversion/remarketing ID follow the account picked at the top of the page
  useEffect(() => {
    if (!open || !account) return
    setLoadingList(true)
    fetch(`/api/audiences?customerId=${account.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setExisting((d?.audiences ?? []).filter((a: UserListRow) => a.name)))
      .catch(() => {})
      .finally(() => setLoadingList(false))
    fetch(`/api/google-ads/customer-info?customerId=${account.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(info => { if (info?.remarketingId) setConversionId(info.remarketingId) })
      .catch(() => {})
  }, [open, account])

  // Remarketing-ONLY push: just the Google Ads Remarketing tag (+ optional Conversion
  // Linker) on the All-Pages trigger. No GA4 Config, no thank-you conversion event, no
  // generate-workspace round-trip — fewest possible GTM API calls (~6) to stay under quota.
  async function handlePushGtm() {
    if (!selContainer) return
    if (!conversionId.trim()) {
      setResult({ ok: false, error: 'ต้องมี Conversion/Remarketing ID (AW-…) — เลือก account ด้านบนให้ระบบดึงให้ หรือกรอกเอง' })
      return
    }
    setPushing(true); setLog([]); setResult(null)
    try {
      // Pull a FRESH access token right before pushing — the session endpoint runs the
      // server-side refresh flow, so we never send a stale/expired token to GTM (401).
      let liveToken = accessToken
      try {
        const s = await fetch('/api/auth/session').then(r => r.ok ? r.json() : null)
        if (s?.accessToken) liveToken = s.accessToken as string
      } catch { /* fall back to the cached session token */ }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (liveToken) headers['x-access-token'] = liveToken
      const pushRes = await fetch('/api/tracking/push-to-gtm', {
        method: 'POST', headers,
        body: JSON.stringify({
          accountId:              selContainer.accountId,
          containerId:            selContainer.containerId,
          googleAdsConversionId:  conversionId,
          googleAdsRemarketingId: conversionId,
          pushConversionLinker:   withLinker,
          pushRemarketing:        true,
          remarketingOnly:        true,
        }),
      })
      const pushData = await pushRes.json()
      setLog(pushData.log ?? [])
      if (!pushRes.ok) throw new Error(pushData.error ?? 'Push failed')
      setResult({ ok: true })
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed'
      const friendly = /429|RESOURCE_EXHAUSTED|rateLimitExceeded/i.test(raw)
        ? 'GTM API quota เต็มชั่วคราว — โหมดใหม่ยิงแค่ ~6 calls แล้ว รอ 1-2 นาทีค่อยลองอีกครั้ง'
        : /401|invalid authentication|UNAUTHENTICATED|Expected OAuth 2/i.test(raw)
          ? 'Google token หมดอายุหรือยังไม่มีสิทธิ์ Tag Manager — กด Logout แล้ว Login ใหม่ (ตอน login ต้องติ๊กยอมรับสิทธิ์ Tag Manager ด้วย) แล้วกลับมากด Push อีกครั้ง'
          : raw
      setResult({ ok: false, error: friendly })
    } finally { setPushing(false) }
  }

  function exportSetupDoc() {
    const html = buildAudienceSetupHTML(brief, account, {
      gtm: selContainer, ga4: selGa4, conversionId, existing,
    })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `remarketing-setup-${(brief.businessName || 'client').replace(/\s+/g, '-').toLowerCase()}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-neutral-50 transition-colors">
        <div className="flex items-center gap-3">
          <Users size={16} className="text-neutral-900" />
          <div>
            <span className="text-sm font-bold text-neutral-900">ขั้นตอนสุดท้าย: Remarketing Audience</span>
            <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">OPTIONAL — ข้ามได้</span>
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-neutral-100 pt-4">
          <p className="text-xs text-neutral-500">
            ติดตั้ง <b>Google Ads Remarketing tag</b> ผ่าน GTM เพื่อเริ่มสะสม audience —
            <b> ถ้ายังไม่ได้รับ access GTM จากลูกค้า ให้กด Export ส่งเอกสารให้คนที่มีสิทธิ์ทำแทน</b> แคมเปญ push ไปก่อนได้เลย ไม่ต้องรอ
          </p>

          {!accessToken && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
              <AlertTriangle size={13} className="shrink-0" /> ยังไม่ได้ Login ด้วย Google — GTM push ต้องใช้ account ที่มีสิทธิ์ GTM (Export ได้ตามปกติ)
            </div>
          )}

          {/* Existing remarketing lists in the account */}
          <Section title={`Remarketing Lists ที่มีอยู่ใน ${account?.name ?? 'บัญชี'}`}>
            {loadingList ? (
              <span className="flex items-center gap-1.5 text-xs text-neutral-400"><Loader2 size={11} className="animate-spin" /> กำลังโหลด...</span>
            ) : existing.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {existing.slice(0, 12).map((a, i) => (
                  <Tag key={i} color="bg-emerald-50 text-emerald-700">{a.name} · {a.memberCount.toLocaleString()}</Tag>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400">ยังไม่มี remarketing list — สร้างตามเอกสาร Export หรือให้ทีมที่มีสิทธิ์ทำ</p>
            )}
          </Section>

          {/* GTM + GA4 targets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">GTM Container</label>
              {loadingGtm ? (
                <span className="flex items-center gap-1.5 text-xs text-neutral-400 py-2"><Loader2 size={11} className="animate-spin" /> โหลด containers...</span>
              ) : containers.length === 0 ? (
                <p className="text-xs text-neutral-400 py-2">ไม่พบ container — ยังไม่มีสิทธิ์ GTM (ใช้ Export แทน)</p>
              ) : (
                <select value={selContainer?.containerId ?? ''}
                  onChange={e => setSelContainer(containers.find(c => c.containerId === e.target.value) ?? null)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200">
                  {containers.map(c => (
                    <option key={c.containerId} value={c.containerId}>{c.accountName} → {c.containerName} ({c.publicId})</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">GA4 Property (ใช้ในเอกสาร Export เท่านั้น)</label>
              {ga4Props.length === 0 ? (
                <p className="text-xs text-neutral-400 py-2">ไม่พบ GA4 property — ไม่กระทบการ push (ใช้ประกอบเอกสาร Export)</p>
              ) : (
                <select value={selGa4?.propertyId ?? ''}
                  onChange={e => setSelGa4(ga4Props.find(p => p.propertyId === e.target.value) ?? null)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200">
                  {ga4Props.map(p => <option key={p.propertyId} value={p.propertyId}>{p.displayName} (G-{p.propertyId})</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Conversion / Remarketing ID (AW-…) <span className="text-red-400">*</span></label>
              <input value={conversionId} onChange={e => setConversionId(e.target.value)} placeholder="AW-XXXXXXXXX — ดึงอัตโนมัติจาก account"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
            <input type="checkbox" checked={withLinker} onChange={e => setWithLinker(e.target.checked)} className="rounded" />
            <span>แถม <b>Conversion Linker</b> ด้วย (+1 call — ช่วยเรื่อง conversion tracking ภายหลัง ไม่จำเป็นสำหรับ remarketing)</span>
          </label>
          <p className="text-[11px] text-neutral-400 -mt-2">
            โหมดนี้ push แค่ <b>Google Ads Remarketing tag</b> ตัวเดียว (All Pages) — ไม่แตะ GA4 / ไม่มี Thank-You event → ใช้ GTM API น้อยสุด (~6 calls) เลี่ยง 429
          </p>

          {log.length > 0 && (
            <div className="bg-neutral-50 rounded-xl p-3 space-y-0.5 max-h-40 overflow-y-auto">
              {log.map((l, i) => <div key={i} className="text-[11px] text-neutral-600 font-mono">{l}</div>)}
            </div>
          )}
          {result && (
            <div className={`rounded-xl border px-4 py-3 text-xs ${result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {result.ok
                ? '✅ Push สำเร็จ — Google Ads Remarketing tag ติดตั้งและ publish แล้ว audience จะเริ่มสะสมใน 24-48 ชม.'
                : result.error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" onClick={handlePushGtm} disabled={!selContainer || pushing} loading={pushing}>
              <Send size={13} /> Push Remarketing Tag เข้า GTM
            </Btn>
            <Btn variant="outline" onClick={exportSetupDoc}>
              <Download size={13} /> Export เอกสาร Setup (HTML)
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function LaunchTodayPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [brief, setBrief] = useState<BriefCtx>({
    businessName: '', productService: '', targetLocation: 'ประเทศไทย', objective: 'Leads',
  })

  // Google Ads target account (picked up-front so we never push to the wrong account)
  const [accounts, setAccounts]       = useState<GadsAccount[]>([])
  const [selectedAcct, setSelectedAcct] = useState<GadsAccount | null>(null)
  const [loadingAccts, setLoadingAccts] = useState(true)

  // Real remarketing user lists in the selected account — auto-attached to
  // audience-driven campaigns and offered as toggle chips in the Audience tab
  const [accountLists, setAccountLists] = useState<string[]>([])
  // Real Google In-Market/Affinity taxonomy (~1,000 segments) for the audience picker
  const [googleSegments, setGoogleSegments] = useState<GoogleSegment[]>([])
  useEffect(() => {
    if (!selectedAcct) { setAccountLists([]); return }
    let cancelled = false
    fetchAccountAudiences(selectedAcct.id).then(list => { if (!cancelled) setAccountLists(list) })
    fetchGoogleSegments(selectedAcct.id).then(segs => { if (!cancelled && segs.length > 0) setGoogleSegments(segs) })
    return () => { cancelled = true }
  }, [selectedAcct])

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const list: GadsAccount[] = (d.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: (a.descriptiveName as string) || (a.name as string) || `Account ${a.id}`,
          currencyCode: a.currencyCode as string | undefined,
        }))
        setAccounts(list)
        // NO auto-select — picking the first account once pushed junk into a real
        // client account (Villa Market). The user must choose explicitly.
      })
      .catch(() => {/* silent */})
      .finally(() => setLoadingAccts(false))
  }, [])

  const updateCampaign = useCallback((id: string, c: Campaign) => {
    setCampaigns(prev => prev.map(x => x.id === id ? c : x))
  }, [])

  const removeCampaign = useCallback((id: string) => {
    setCampaigns(prev => prev.filter(x => x.id !== id))
  }, [])

  function addCampaign(type: CampaignType = 'SEARCH') {
    const newC = makeCampaign({
      type,
      bidStrategy: BID_STRATEGIES[type][0],
      targetLocation: brief.targetLocation || 'ประเทศไทย',
    })
    setCampaigns(prev => [...prev, newC])
  }

  // One click → generate keyword + audience (type-correct, name-aware) for EVERY campaign.
  // Requires every campaign to be named first, because the name drives the theme
  // (e.g. "SEM Generic" pulls only Generic keywords).
  const [genningAll, setGenningAll] = useState(false)
  const canGenerateAll = campaigns.length > 0 && campaigns.every(c => c.name.trim() !== '')
  async function generateAllContent() {
    if (!canGenerateAll || genningAll) return
    setGenningAll(true)
    try {
      // Refresh real remarketing lists once, then generate every campaign in parallel
      const lists = selectedAcct ? await fetchAccountAudiences(selectedAcct.id) : accountLists
      if (lists.length > 0) setAccountLists(lists)
      const segs = googleSegments.length > 0 ? googleSegments : (selectedAcct ? await fetchGoogleSegments(selectedAcct.id) : [])
      if (segs.length > 0 && googleSegments.length === 0) setGoogleSegments(segs)
      const results = await Promise.all(campaigns.map(c => generateForCampaign(c, brief, lists, segs)))
      setCampaigns(results)
    } finally { setGenningAll(false) }
  }

  const readyCampaigns = campaigns.filter(c => c.done)

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between pb-5 border-b border-neutral-200">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Zap size={20} className="text-neutral-950" />
              <h1 className="text-2xl font-bold tracking-tight text-neutral-950">Launch Today</h1>
            </div>
            <p className="text-neutral-500 text-sm">เพิ่ม campaign ที่จะทำ → AI ช่วย keyword + audience → พร้อม launch</p>
          </div>
        </div>

        {/* Google Ads target account — pick first to avoid pushing to the wrong account */}
        <AccountBar accounts={accounts} selected={selectedAcct} loading={loadingAccts} onSelect={setSelectedAcct} />

        {/* Brief context */}
        <BriefBar brief={brief} onChange={setBrief} />

        {/* One-click generate everything (keyword + audience) for all campaigns */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <Btn variant="primary" onClick={generateAllContent} loading={genningAll} disabled={!canGenerateAll || genningAll}>
            <Sparkles size={14} />
            {genningAll ? 'กำลังสร้างทั้งหมด...' : `✨ สร้างทั้งหมด: Keyword + Audience + Ad Text${campaigns.length > 0 ? ` (${campaigns.length})` : ''}`}
          </Btn>
          <p className="text-[11px] text-neutral-400 mt-1.5">
            {campaigns.length === 0
              ? 'เพิ่ม campaign ก่อน'
              : !canGenerateAll
                ? '⚠ ต้องตั้งชื่อทุก campaign ก่อน — ชื่อกำหนดการดึง keyword (เช่น "SEM Generic" จะดึงเฉพาะ Generic KW, "SEM Brand" ดึงเฉพาะ Brand)'
                : 'AI สร้างครบตามเงื่อนไข Google Ads: Search=keyword+RSA 15H/4D+Sitelinks/Callouts/Snippets · PMax=15H/5LH/5D+themes+signals · Display/Demand Gen=banner text ครบ — เหลือแค่อัปโหลดรูป (PMax/Display) และเช็ค checklist ในการ์ด'}
          </p>
        </div>

        {/* Summary */}
        <SummaryBar campaigns={campaigns} />

        {/* Campaign list */}
        <div className="space-y-4">
          {campaigns.map((c, i) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              index={i}
              brief={brief}
              accountLists={accountLists}
              googleSegments={googleSegments}
              onChange={updated => updateCampaign(c.id, updated)}
              onRemove={() => removeCampaign(c.id)}
            />
          ))}

          {campaigns.length === 0 && (
            <div className="bg-neutral-50 border border-dashed border-neutral-300 rounded-2xl p-10 text-center">
              <Zap size={28} className="text-neutral-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-neutral-500 mb-1">ยังไม่มี campaign</p>
              <p className="text-xs text-neutral-400">กดปุ่มด้านล่างเพื่อเพิ่ม campaign แรก</p>
            </div>
          )}
        </div>

        {/* Add campaign */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">เพิ่ม Campaign</div>
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_TYPES.map(t => (
              <button key={t.value} onClick={() => addCampaign(t.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors hover:shadow-sm ${t.color}`}>
                <Plus size={11} />
                <span>{t.label}</span>
                <span className="opacity-60 hidden sm:inline">— {t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Ready campaigns */}
        {readyCampaigns.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span className="text-sm font-semibold text-emerald-900">{readyCampaigns.length} campaign พร้อม launch</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {readyCampaigns.map(c => {
                const cfg = typeConfig(c.type)
                const kw = c.keywords.filter(k => k.selected).length
                const aud = c.audienceSignals.customIntent.length + c.audienceSignals.remarketing.length + c.audienceSignals.inMarket.length
                const errs = campaignGaps(c, accountLists).filter(g => g.level === 'error').length
                return (
                  <div key={c.id} className={`bg-white rounded-xl border px-4 py-3 ${errs > 0 ? 'border-red-200' : 'border-emerald-200'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>{c.type}</span>
                      <span className="text-sm font-semibold text-neutral-900 truncate">{c.name || '(ไม่มีชื่อ)'}</span>
                      {errs > 0
                        ? <span className="text-[10px] font-semibold text-red-600 shrink-0">ขาด {errs} รายการ</span>
                        : <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />}
                    </div>
                    <div className="flex gap-3 text-xs text-neutral-500">
                      <span>฿{c.dailyBudget.toLocaleString()}/day</span>
                      {kw > 0 && <span>{kw} kw</span>}
                      {aud > 0 && <span>{aud} audience</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Push to Google Ads */}
        <LaunchPushPanel readyCampaigns={readyCampaigns} brief={brief} account={selectedAcct} accountLists={accountLists} />

        {/* Final step (optional): remarketing audience setup — never blocks the launch */}
        <RemarketingAudiencePanel brief={brief} account={selectedAcct} />
      </div>
    </AppShell>
  )
}
