/**
 * Brand Radar — brands the AI platforms tag in their answers that we do not track yet.
 * Pure functions only (no prisma, no server imports) so they can be unit tested with plain tsx.
 */
import { PROVIDER_KEYS, type OtherEntity, type ProviderKey } from './types'
import type { UntrackedBrandRow, UntrackedBrandsDTO } from './untracked-types'

export const UNTRACKED_LIMIT = 20

// Built with the RegExp constructor because the project's TS target predates the "u" flag in literals
const EDGE_PUNCT = new RegExp('^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}\\p{M}]+$', 'gu')
const NON_WORD = new RegExp('[^\\p{L}\\p{N}\\p{M}]+', 'u')

/** NFKC, lower-case, trim, collapse whitespace, strip surrounding punctuation. */
export function normalizeBrandKey(s: string): string {
  return (s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_PUNCT, '')
    .trim()
}

/** Whole tokens: split on whitespace and punctuation. */
function tokens(key: string): string[] {
  return key.split(NON_WORD).filter(Boolean)
}

/** True when `needle` appears as a contiguous run of whole tokens inside `hay`. */
function containsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

function normalizeDomain(d: string): string {
  return (d ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = ''
  let bestN = 0
  counts.forEach((n, v) => {
    if (n > bestN) { best = v; bestN = n }
  })
  return best
}

interface Acc {
  key: string
  names: string[]
  categories: string[]
  domains: string[]
  answers: Set<string>
  prompts: Set<string>
  providers: Set<ProviderKey>
  perPrompt: Map<string, Set<string>>
}

export function computeUntrackedBrands(input: {
  extras: Map<string, OtherEntity[]>
  responses: Array<{ id: string; promptId: string; provider: ProviderKey }>
  prompts: Array<{ id: string; text: string }>
  trackedNames: string[]
  trackedDomains?: string[]
  limit?: number
}): UntrackedBrandsDTO {
  const trackedKeys = new Set<string>()
  const trackedTokens: string[][] = []
  for (const n of input.trackedNames) {
    const k = normalizeBrandKey(n)
    if (!k) continue
    trackedKeys.add(k)
    const t = tokens(k)
    if (t.length) trackedTokens.push(t)
  }
  const trackedDomains = (input.trackedDomains ?? []).map(normalizeDomain).filter(Boolean)
  const promptText = new Map(input.prompts.map((p) => [p.id, p.text]))

  const isTracked = (key: string, domain: string): boolean => {
    if (trackedKeys.has(key)) return true
    // Whole-token comparison. Thai names are written without spaces, so a Thai name is one token
    // and this falls back to plain equality (already covered above) instead of substring matching.
    const t = tokens(key)
    for (const tt of trackedTokens) {
      if (containsRun(t, tt) || containsRun(tt, t)) return true
    }
    if (domain) {
      for (const td of trackedDomains) {
        if (domain === td || domain.endsWith('.' + td)) return true
      }
    }
    return false
  }

  const groups = new Map<string, Acc>()
  let taggedAnswers = 0
  for (const r of input.responses) {
    const tags = input.extras.get(r.id)
    if (!tags || tags.length === 0) continue
    taggedAnswers++
    for (const tag of tags) {
      const key = normalizeBrandKey(tag.name)
      if (!key) continue
      const domain = normalizeDomain(tag.domain)
      if (isTracked(key, domain)) continue
      let g = groups.get(key)
      if (!g) {
        g = { key, names: [], categories: [], domains: [], answers: new Set(), prompts: new Set(), providers: new Set(), perPrompt: new Map() }
        groups.set(key, g)
      }
      // A tag repeated inside one answer counts once
      if (g.answers.has(r.id)) continue
      g.answers.add(r.id)
      g.names.push((tag.name ?? '').trim())
      const cat = (tag.category ?? '').trim()
      if (cat) g.categories.push(cat)
      if (domain) g.domains.push(domain)
      g.prompts.add(r.promptId)
      g.providers.add(r.provider)
      let pp = g.perPrompt.get(r.promptId)
      if (!pp) { pp = new Set(); g.perPrompt.set(r.promptId, pp) }
      pp.add(r.id)
    }
  }

  const rows: UntrackedBrandRow[] = []
  for (const g of Array.from(groups.values())) {
    const samples = Array.from(g.perPrompt.entries())
      .filter(([id]) => promptText.has(id))
      .map(([id, set], i) => ({ id, n: set.size, i }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, 3)
      .map((s) => ({ promptId: s.id, text: promptText.get(s.id) ?? '' }))
    rows.push({
      name: mostCommon(g.names),
      category: mostCommon(g.categories),
      domain: mostCommon(g.domains),
      answers: g.answers.size,
      prompts: g.prompts.size,
      providers: PROVIDER_KEYS.filter((p) => g.providers.has(p)),
      samplePrompts: samples,
    })
  }
  rows.sort((a, b) => b.answers - a.answers || b.prompts - a.prompts || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { taggedAnswers, rows: rows.slice(0, input.limit ?? UNTRACKED_LIMIT) }
}
