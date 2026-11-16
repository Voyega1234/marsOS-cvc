/**
 * Brand Radar — validation of profile and competitor input from the API (pure, no I/O).
 */
import { hostOf, stripInvisible } from './normalize'
import { cleanStrings } from './server'
import {
  COUNTRIES, LANGUAGES, LIMITS, PROMPT_SOURCES, PROVIDER_KEYS, SAMPLE_OPTIONS, SCHEDULES, isProviderKey, isSampleOption,
  type PromptSource, type ProviderKey, type Schedule,
} from './types'

/**
 * Providers a brand-new profile starts with: all eight (six LLMs via OpenRouter, Google AI Mode and
 * Google AI Overview via DataForSEO). Staff can switch any of them off in Settings.
 */
export const DEFAULT_PROVIDERS: ProviderKey[] = [...PROVIDER_KEYS]

export interface CleanProfile {
  brandName?: string
  aliases?: string[]
  ambiguousAliases?: string[]
  contextTerms?: string[]
  primaryDomain?: string
  ownedDomains?: string[]
  country?: string
  language?: string
  industry?: string
  products?: string[]
  providers?: ProviderKey[]
  promptSources?: PromptSource[]
  schedule?: Schedule
  monthlyBudgetUsd?: number | null
  maxPromptsPerRun?: number
  samplesPerPrompt?: number
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? stripInvisible(v).trim().slice(0, max) : ''
}

function domains(v: unknown): string[] {
  const out: string[] = []
  for (const d of cleanStrings(v, 30, 253)) {
    const h = hostOf(d)
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

/** Keys that are absent from `r` stay absent from the result, so a PUT never wipes what it did not send. */
export function cleanProfileInput(r: Record<string, unknown>): { ok: true; data: CleanProfile } | { ok: false; error: string } {
  const d: CleanProfile = {}
  if ('brandName' in r) {
    d.brandName = text(r.brandName, 200)
    if (!d.brandName) return { ok: false, error: 'Brand name is required' }
  }
  if ('aliases' in r) d.aliases = cleanStrings(r.aliases, LIMITS.aliasesMax, 100)
  if ('ambiguousAliases' in r) d.ambiguousAliases = cleanStrings(r.ambiguousAliases, LIMITS.aliasesMax, 100)
  if ('contextTerms' in r) d.contextTerms = cleanStrings(r.contextTerms, LIMITS.aliasesMax, 100)
  if ('primaryDomain' in r) {
    d.primaryDomain = hostOf(text(r.primaryDomain, 253))
    if (!d.primaryDomain) return { ok: false, error: 'Primary domain is not a valid domain' }
  }
  if ('ownedDomains' in r) d.ownedDomains = domains(r.ownedDomains)
  if ('country' in r) {
    const c = text(r.country, 8).toUpperCase()
    if (!COUNTRIES.some((x) => x.code === c)) return { ok: false, error: 'Unsupported country' }
    d.country = c
  }
  if ('language' in r) {
    const l = text(r.language, 8).toLowerCase()
    if (!LANGUAGES.some((x) => x.code === l)) return { ok: false, error: 'Unsupported language' }
    d.language = l
  }
  if ('industry' in r) d.industry = text(r.industry, 200)
  if ('products' in r) d.products = cleanStrings(r.products, 30, 200)
  if ('providers' in r) {
    const list = Array.isArray(r.providers) ? r.providers : []
    d.providers = PROVIDER_KEYS.filter((k) => list.some((x) => isProviderKey(x) && x === k))
  }
  if ('promptSources' in r) {
    const list = Array.isArray(r.promptSources) ? r.promptSources : []
    d.promptSources = PROMPT_SOURCES.filter((k) => list.includes(k))
  }
  if ('schedule' in r) {
    if (typeof r.schedule !== 'string' || !(SCHEDULES as readonly string[]).includes(r.schedule)) return { ok: false, error: 'Invalid schedule' }
    d.schedule = r.schedule as Schedule
  }
  if ('monthlyBudgetUsd' in r) {
    const v = r.monthlyBudgetUsd
    if (v === null || v === '') d.monthlyBudgetUsd = null
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Monthly budget must be a number of 0 or more' }
      d.monthlyBudgetUsd = n
    }
  }
  if ('maxPromptsPerRun' in r) {
    const n = Math.floor(Number(r.maxPromptsPerRun))
    if (!Number.isFinite(n) || n < 1 || n > LIMITS.maxPromptsPerRunMax) return { ok: false, error: `Max prompts per run must be 1 to ${LIMITS.maxPromptsPerRunMax}` }
    d.maxPromptsPerRun = n
  }
  if ('samplesPerPrompt' in r) {
    const n = Number(r.samplesPerPrompt)
    if (!isSampleOption(n)) return { ok: false, error: `Samples per prompt must be one of ${SAMPLE_OPTIONS.join(', ')}` }
    d.samplesPerPrompt = n
  }
  return { ok: true, data: d }
}

export function cleanCompetitorInput(r: Record<string, unknown>): { ok: true; data: { name?: string; aliases?: string[]; domains?: string[]; status?: 'ACTIVE' | 'INACTIVE' } } | { ok: false; error: string } {
  const d: { name?: string; aliases?: string[]; domains?: string[]; status?: 'ACTIVE' | 'INACTIVE' } = {}
  if ('name' in r) {
    d.name = text(r.name, 100)
    if (!d.name) return { ok: false, error: 'Competitor name is required' }
  }
  if ('aliases' in r) d.aliases = cleanStrings(r.aliases, LIMITS.aliasesMax, 100)
  if ('domains' in r) d.domains = domains(r.domains)
  if ('status' in r) {
    if (r.status !== 'ACTIVE' && r.status !== 'INACTIVE') return { ok: false, error: 'Invalid status' }
    d.status = r.status
  }
  return { ok: true, data: d }
}
