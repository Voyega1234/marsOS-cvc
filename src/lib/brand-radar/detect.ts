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
  /** where the first match starts as a share of the searched text (0 = start, 1 = end); null when the text is empty */
  positionPct: number | null
  firstIndex: number
  snippet: string
}

export const RECOMMEND_CUES: readonly string[] = [
  'recommend', 'recommended', 'best', 'top pick', 'top choice', 'top-rated', 'leading', 'go-to',
  'we suggest', 'ideal choice', 'highly rated',
  'recommends', 'recommending', 'recommendation', 'most popular', 'popular choice', 'trusted', 'favorite', 'favourite',
  'number one', 'no. 1', '#1', 'first choice', 'great choice', 'good choice', 'worth buying', 'standout', 'market leader',
  'แนะนำ', 'ดีที่สุด', 'อันดับ 1', 'อันดับหนึ่ง', 'น่าใช้', 'ตัวเลือกที่ดี', 'ยอดนิยม', 'เหมาะที่สุด',
]
export const NEGATION_CUES: readonly string[] = [
  'not recommend', "don't recommend", 'do not recommend', "wouldn't recommend", 'avoid',
  'not recommended', "isn't recommended", "aren't recommended", 'never recommend', 'not the best', 'not a good',
  'not worth', 'steer clear', 'stay away', 'not advisable',
  'ไม่แนะนำ', 'ไม่ควร', 'หลีกเลี่ยง',
]
export const COMPARISON_CUES: readonly string[] = [
  'vs', 'vs.', 'versus', 'compared to', 'compared with', 'comparison', 'alternative to',
  'better than', 'worse than', 'instead of', 'alternatives', 'rival', 'rivals', 'head-to-head', 'side by side',
  'เทียบ', 'เปรียบเทียบ', 'ต่างจาก',
]

const CUE_WINDOW = 120
const NEIGHBOUR_WINDOW = 200
const SNIPPET_RADIUS = 100

const THAI_RE = /[฀-๿]/
// built at runtime: the project tsconfig target predates the `u` regex flag
const LETTER_OR_DIGIT_RE = new RegExp('[\\p{L}\\p{N}]', 'u')
const CUE_ABBREV_RE = new RegExp('(?:^|[^\\p{L}\\p{N}])(?:vs|no)$', 'u')
const LATIN_ONLY_RE = new RegExp('^[\\p{Script=Latin}\\p{N}\\s\\p{P}\\p{S}]+$', 'u')

/**
 * Matching rules for Latin names (documented decisions):
 * - case-insensitive; typographic apostrophes and dashes are folded to ASCII (same length, so indices stay valid)
 *   so "L'Oréal" matches "L’Oréal" and "7-Eleven" matches "7–Eleven"
 * - a Latin-only name must not touch another letter/digit on either side ("Apple" is not in "pineapple",
 *   "Ace" is not in "replace"); Thai letters do not count as touching, Thai names are never bounded
 * - possessives match because the apostrophe is punctuation: "Philips's", "Xiaomi's", "Apple’s"
 * - plurals do NOT match ("Levoits" is not "Levoit"): a trailing "s" cannot be told from a different word
 *   ("Ace" / "aces"). Add the plural form as an alias when it matters.
 * - accents are kept (NFKC only): "Oréal" and "Oreal" are different; add the unaccented spelling as an alias
 */
function fold(s: string): string {
  return s.replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'").replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
}

function norm(s: string): string {
  return fold(stripInvisible(s).toLowerCase()).replace(/\s+/g, ' ').trim()
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

/** Cue only: "best-selling" / "best-in-class" are compounds, not the cue itself. */
function hyphenCompound(text: string, end: number): boolean {
  return text[end] === '-' && end + 1 < text.length && LETTER_OR_DIGIT_RE.test(text[end + 1])
}

/** All non-overlapping matches of term in text (already lowercase), honouring boundaries and `isFree`. */
function scanTerm(
  text: string, term: string, isFree?: (start: number, end: number) => boolean, isCue = false,
): number[] {
  const out: number[] = []
  let pos = 0
  while (pos <= text.length - term.length) {
    const idx = text.indexOf(term, pos)
    if (idx < 0) break
    if (boundaryOk(text, idx, term) && !(isCue && hyphenCompound(text, idx + term.length)) && (!isFree || isFree(idx, idx + term.length))) {
      out.push(idx)
      pos = idx + term.length
    } else {
      pos = idx + 1
    }
  }
  return out
}

function hasTerm(text: string, term: string, isCue = false): boolean {
  return scanTerm(text, term, undefined, isCue).length > 0
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

/** Is text[i] a sentence boundary? A newline, or . ! ? ; followed by whitespace or end of text. */
function isSentenceBoundary(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === '\n') return true
  if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ';') return false
  const next = text[i + 1]
  if (next !== undefined && !/\s/.test(next)) return false
  // "vs. Rival" and "no. 1" are cue text, not the end of a sentence
  if (ch === '.' && CUE_ABBREV_RE.test(text.slice(Math.max(0, i - 3), i))) return false
  return true
}

function windowHas(
  text: string, start: number, end: number, rawCues: readonly string[],
  clip: { lo: number; hi: number; midLo?: number; midHi?: number } = { lo: 0, hi: text.length },
): boolean {
  // NFKC changes some Thai vowels (sara am), so cues go through the same normalisation as the text
  const cues = normCues(rawCues)
  let lo = Math.max(clip.lo, start - CUE_WINDOW)
  let hi = Math.min(clip.hi, end + CUE_WINDOW)
  // the midpoint split only matters while the gap has no sentence boundary; a boundary already separates the owners
  let sentLo = false
  let sentHi = false
  for (let i = start - 1; i >= lo; i--) {
    if (isSentenceBoundary(text, i)) { lo = i + 1; sentLo = true; break }
  }
  for (let i = end; i < hi; i++) {
    if (isSentenceBoundary(text, i)) { hi = i; sentHi = true; break }
  }
  const before = text.slice(lo, start)
  const after = text.slice(end, hi)
  // A cue between two different entities belongs to the nearer one: its start must be on this side of the midpoint.
  const midLo = sentLo ? -Infinity : (clip.midLo ?? -Infinity)
  const midHi = sentHi ? Infinity : (clip.midHi ?? Infinity)
  return cues.some(
    (c) =>
      scanTerm(before, c, undefined, true).some((i) => lo + i >= midLo) ||
      scanTerm(after, c, undefined, true).some((i) => end + i < midHi),
  )
}

export function detectEntities(
  rawText: string,
  brand: BrandSpec,
  competitors: CompetitorSpec[],
): { brand: EntityHit | null; competitors: EntityHit[] } {
  const empty = { brand: null, competitors: [] as EntityHit[] }
  const display = stripInvisible(rawText || '').replace(/\s+/g, ' ')
  if (!display.trim()) return empty
  // Lowercase per UTF-16 code unit and keep the original unit when the length would change
  // (e.g. U+0130), so offsets stay aligned with `display` and the rest of the text still folds case.
  let lowered = ''
  for (let i = 0; i < display.length; i++) {
    const c = display[i]
    const l = c.toLowerCase()
    lowered += l.length === 1 ? l : c
  }
  const lower = fold(lowered)

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
    // a cue window stops at the nearest match of a different entity on each side, and a cue in the
    // gap between the two belongs to whichever entity is nearer (split at the midpoint of the gap)
    const clipFor = (m: Match): { lo: number; hi: number; midLo?: number; midHi?: number } => {
      let lo = 0
      let hi = lower.length
      let midLo: number | undefined
      let midHi: number | undefined
      for (const o of kept) {
        if (o.entity === entity) continue
        if (o.end <= m.start && o.end > lo) { lo = o.end; midLo = (o.end + m.start) / 2 }
        if (o.start >= m.end && o.start < hi) { hi = o.start; midHi = (m.end + o.start) / 2 }
      }
      return { lo, hi, midLo, midHi }
    }
    const recommended = ms.some((m) => {
      const clip = clipFor(m)
      return windowHas(lower, m.start, m.end, RECOMMEND_CUES, clip) && !windowHas(lower, m.start, m.end, NEGATION_CUES, clip)
    })
    const compared = ms.some((m) => {
      // comparison cues stay unclipped by other entities: "Mars vs Rival" puts the cue between them
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
      positionPct: lower.length > 0 ? Math.round((first.start / lower.length) * 10000) / 10000 : null,
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
