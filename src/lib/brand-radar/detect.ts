/**
 * Brand Radar — brand / competitor mention detection. Pure, no I/O.
 */
import { stripInvisible } from './normalize'

export interface BrandSpec { name: string; aliases: string[]; ambiguousAliases: string[]; contextTerms: string[] }
export interface CompetitorSpec { id: string; name: string; aliases: string[] }
export interface EntityHit {
  entityType: 'brand' | 'competitor'
  key: string
  competitorId: string | null
  name: string
  occurrences: number
  matchedAliases: string[]
  recommended: boolean
  compared: boolean
  position: number
  firstIndex: number
  snippet: string
}

export const RECOMMEND_CUES: readonly string[] = [
  'recommend', 'recommended', 'best', 'top pick', 'top choice', 'top-rated', 'leading', 'go-to',
  'we suggest', 'ideal choice', 'highly rated',
  'แนะนำ', 'ดีที่สุด', 'อันดับ 1', 'อันดับหนึ่ง', 'น่าใช้', 'ตัวเลือกที่ดี', 'ยอดนิยม', 'เหมาะที่สุด',
]
export const NEGATION_CUES: readonly string[] = [
  'not recommend', "don't recommend", 'do not recommend', "wouldn't recommend", 'avoid',
  'ไม่แนะนำ', 'ไม่ควร', 'หลีกเลี่ยง',
]
export const COMPARISON_CUES: readonly string[] = [
  'vs', 'vs.', 'versus', 'compared to', 'compared with', 'comparison', 'alternative to',
  'เทียบ', 'เปรียบเทียบ', 'ต่างจาก',
]

const CUE_WINDOW = 120
const NEIGHBOUR_WINDOW = 200
const SNIPPET_RADIUS = 100

const THAI_RE = /[฀-๿]/
// built at runtime: the project tsconfig target predates the `u` regex flag
const LETTER_OR_DIGIT_RE = new RegExp('[\\p{L}\\p{N}]', 'u')
const LATIN_ONLY_RE = new RegExp('^[\\p{Script=Latin}\\p{N}\\s\\p{P}\\p{S}]+$', 'u')

function norm(s: string): string {
  return stripInvisible(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

function blocksBoundary(ch: string | undefined): boolean {
  if (!ch) return false
  return LETTER_OR_DIGIT_RE.test(ch) && !THAI_RE.test(ch)
}

/** Does `term` at [idx, idx+len) satisfy the boundary rule? Only Latin-only terms are bounded. */
function boundaryOk(text: string, idx: number, term: string): boolean {
  if (!LATIN_ONLY_RE.test(term)) return true
  return !blocksBoundary(text[idx - 1]) && !blocksBoundary(text[idx + term.length])
}

/** All non-overlapping matches of term in text (already lowercase), honouring boundaries and `isFree`. */
function scanTerm(text: string, term: string, isFree?: (start: number, end: number) => boolean): number[] {
  const out: number[] = []
  let pos = 0
  while (pos <= text.length - term.length) {
    const idx = text.indexOf(term, pos)
    if (idx < 0) break
    if (boundaryOk(text, idx, term) && (!isFree || isFree(idx, idx + term.length))) {
      out.push(idx)
      pos = idx + term.length
    } else {
      pos = idx + 1
    }
  }
  return out
}

function hasTerm(text: string, term: string): boolean {
  return scanTerm(text, term).length > 0
}

interface Pair { term: string; entity: number; ambiguous: boolean }
interface Match { start: number; end: number; entity: number; term: string; ambiguous: boolean }

function uniqueTerms(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const t = norm(raw || '')
    if (t.length < 2 || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

const normCache = new Map<readonly string[], string[]>()
function normCues(cues: readonly string[]): string[] {
  let n = normCache.get(cues)
  if (!n) {
    n = cues.map(norm)
    normCache.set(cues, n)
  }
  return n
}

function windowHas(text: string, start: number, end: number, rawCues: readonly string[]): boolean {
  // NFKC changes some Thai vowels (sara am), so cues go through the same normalisation as the text
  const cues = normCues(rawCues)
  const before = text.slice(Math.max(0, start - CUE_WINDOW), start)
  const after = text.slice(end, end + CUE_WINDOW)
  return cues.some((c) => hasTerm(before, c) || hasTerm(after, c))
}

export function detectEntities(
  rawText: string,
  brand: BrandSpec,
  competitors: CompetitorSpec[],
): { brand: EntityHit | null; competitors: EntityHit[] } {
  const empty = { brand: null, competitors: [] as EntityHit[] }
  const display = stripInvisible(rawText || '').replace(/\s+/g, ' ')
  if (!display.trim()) return empty
  const text = display.toLowerCase()
  // Lowercasing can change length for rare characters; fall back to the display text then.
  const lower = text.length === display.length ? text : display

  // entity 0 = brand, 1.. = competitors
  const names = [brand.name, ...competitors.map((c) => c.name)]
  const ambiguousSet = new Set(uniqueTerms(brand.ambiguousAliases || []))
  const pairs: Pair[] = []
  const claimed = new Set<string>()
  const termSets = [uniqueTerms([brand.name, ...(brand.aliases || [])]), ...competitors.map((c) => uniqueTerms([c.name, ...(c.aliases || [])]))]
  termSets.forEach((terms, entity) => {
    for (const term of terms) {
      if (claimed.has(term)) continue
      claimed.add(term)
      pairs.push({ term, entity, ambiguous: entity === 0 && ambiguousSet.has(term) })
    }
  })
  pairs.sort((a, b) => b.term.length - a.term.length)

  const consumed = new Uint8Array(lower.length)
  const isFree = (s: number, e: number): boolean => {
    for (let i = s; i < e; i++) if (consumed[i]) return false
    return true
  }
  const matches: Match[] = []
  for (const p of pairs) {
    for (const idx of scanTerm(lower, p.term, isFree)) {
      consumed.fill(1, idx, idx + p.term.length)
      matches.push({ start: idx, end: idx + p.term.length, entity: p.entity, term: p.term, ambiguous: p.ambiguous })
    }
  }

  // Ambiguous brand aliases need support: a non-ambiguous brand match, or a context term.
  let kept = matches
  if (matches.some((m) => m.ambiguous)) {
    const solid = matches.some((m) => m.entity === 0 && !m.ambiguous)
    const ctx = !solid && uniqueTerms(brand.contextTerms || []).some((t) => hasTerm(lower, t))
    if (!solid && !ctx) kept = matches.filter((m) => !m.ambiguous)
  }
  if (!kept.length) return empty
  kept.sort((a, b) => a.start - b.start)

  const byEntity = new Map<number, Match[]>()
  for (const m of kept) {
    const arr = byEntity.get(m.entity)
    if (arr) arr.push(m)
    else byEntity.set(m.entity, [m])
  }

  const hits: EntityHit[] = []
  for (const [entity, ms] of Array.from(byEntity.entries())) {
    const first = ms[0]
    const recommended = ms.some(
      (m) => windowHas(lower, m.start, m.end, RECOMMEND_CUES) && !windowHas(lower, m.start, m.end, NEGATION_CUES),
    )
    const compared = ms.some((m) => {
      if (windowHas(lower, m.start, m.end, COMPARISON_CUES)) return true
      return kept.some(
        (o) =>
          o.entity !== entity &&
          ((o.start >= m.end && o.start - m.end <= NEIGHBOUR_WINDOW) ||
            (m.start >= o.end && m.start - o.end <= NEIGHBOUR_WINDOW)),
      )
    })
    const from = Math.max(0, first.start - SNIPPET_RADIUS)
    const to = Math.min(display.length, first.end + SNIPPET_RADIUS)
    const isBrand = entity === 0
    hits.push({
      entityType: isBrand ? 'brand' : 'competitor',
      key: isBrand ? 'brand' : competitors[entity - 1].id,
      competitorId: isBrand ? null : competitors[entity - 1].id,
      name: names[entity],
      occurrences: ms.length,
      matchedAliases: Array.from(new Set(ms.map((m) => m.term))),
      recommended,
      compared,
      position: 0,
      firstIndex: first.start,
      snippet: display.slice(from, to).replace(/\s+/g, ' ').trim(),
    })
  }
  hits.sort((a, b) => a.firstIndex - b.firstIndex)
  hits.forEach((h, i) => { h.position = i + 1 })

  return {
    brand: hits.find((h) => h.entityType === 'brand') ?? null,
    competitors: hits.filter((h) => h.entityType === 'competitor'),
  }
}
