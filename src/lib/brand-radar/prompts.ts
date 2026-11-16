/**
 * Brand Radar — pure prompt helpers: de-duplication, intent classification, CSV in/out.
 * No database, no network.
 */
import {
  JOURNEY_STAGES, LIMITS, PRIORITIES, PROMPT_INTENTS,
  type JourneyStage, type Priority, type PromptCandidate, type PromptDTO, type PromptInput, type PromptIntent, type PromptStats,
} from './types'

// ── De-duplication ───────────────────────────────────────────────────────────

// RegExp built from strings: the 'u' flag in a literal needs an ES6 target.
const NON_TEXT = new RegExp('[^\\p{L}\\p{N}\\p{M}\\s]', 'gu')

/** Key used to decide that two prompts are the same question. */
export function textKey(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .toLowerCase()
    .replace(NON_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
  return out
}

/** Jaccard similarity of character trigram sets of the two keys, 0..1. */
export function trigramSimilarity(a: string, b: string): number {
  const ka = textKey(a)
  const kb = textKey(b)
  if (ka === kb) return 1
  if (ka.length < 3 || kb.length < 3) return 0
  const ta = trigrams(ka)
  const tb = trigrams(kb)
  let inter = 0
  Array.from(ta).forEach((t) => { if (tb.has(t)) inter++ })
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

export function findDuplicate(
  text: string,
  others: string[],
  threshold: number = LIMITS.similarityThreshold,
): { text: string; similarity: number } | null {
  let best: { text: string; similarity: number } | null = null
  for (const o of others) {
    const similarity = trigramSimilarity(text, o)
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { text: o, similarity }
  }
  return best
}

export function markDuplicates(candidates: PromptCandidate[], existingTexts: string[]): PromptCandidate[] {
  const seen: string[] = []
  return candidates.map((c) => {
    const { duplicateOf: _drop, ...rest } = c
    void _drop
    const out: PromptCandidate = { ...rest }
    const ex = findDuplicate(c.text, existingTexts)
    if (ex) {
      out.duplicateOf = { kind: 'existing', text: ex.text, similarity: ex.similarity }
    } else {
      const ba = findDuplicate(c.text, seen)
      if (ba) out.duplicateOf = { kind: 'batch', text: ba.text, similarity: ba.similarity }
    }
    seen.push(c.text)
    return out
  })
}

// ── Intent ───────────────────────────────────────────────────────────────────

// SARA AM (ำ) is decomposed by NFKC, so patterns are normalised the same way as the input.
function intentRe(src: string): RegExp {
  return new RegExp(src.normalize('NFKC'), 'iu')
}

const RE_COMPARISON = intentRe(String.raw`\b(?:vs|versus|compare|compared|comparison)\b|เทียบ|เปรียบเทียบ|ดีกว่า|\b[\p{L}\p{N}]+\s+or\s+[\p{L}\p{N}]+\b|\S+\s*หรือ(?!ไม่)\s*\S+`)
const RE_RECOMMEND = intentRe(String.raw`\b(best|top|recommend|recommended|recommendation)\b|\bwhich\b.*\bshould\b|แนะนำ|ที่ไหนดี|ยี่ห้อไหนดี|อันไหนดี|ตัวไหนดี`)
const RE_TRANSACTIONAL = intentRe(String.raw`\b(buy|price|prices|pricing|cost|order|book|discount)\b|ซื้อ|ราคา|จอง|สั่ง|โปรโมชั่น|ส่วนลด`)
const RE_PROBLEM = intentRe(String.raw`\bhow to fix\b|\b(fix|solve|problem|issue|issues)\b|\bnot working\b|\bwhy is\b|แก้|ปัญหา|ทำไม|วิธีแก้`)
const RE_COMMERCIAL = intentRe(String.raw`\b(review|reviews)\b|\bpros and cons\b|\bworth it\b|รีวิว|ข้อดี|ข้อเสีย|คุ้มไหม|ดีไหม`)
const RE_NAVIGATIONAL = intentRe(String.raw`\blogin\b|\bofficial site\b|\bwebsite\b|\bcontact\b|\baddress\b|เข้าสู่ระบบ|เว็บไซต์|ติดต่อ|ที่อยู่|สาขา`)

export function classifyIntent(text: string): PromptIntent {
  const t = String(text ?? '').normalize('NFKC')
  if (RE_COMPARISON.test(t)) return 'brand_comparison'
  if (RE_RECOMMEND.test(t)) return 'recommendation'
  if (RE_TRANSACTIONAL.test(t)) return 'transactional'
  if (RE_PROBLEM.test(t)) return 'problem_solving'
  if (RE_COMMERCIAL.test(t)) return 'commercial_investigation'
  if (RE_NAVIGATIONAL.test(t)) return 'navigational'
  return 'informational'
}

export function classifyJourney(intent: PromptIntent): JourneyStage {
  switch (intent) {
    case 'informational':
    case 'problem_solving':
      return 'awareness'
    case 'commercial_investigation':
    case 'brand_comparison':
    case 'recommendation':
      return 'consideration'
    case 'transactional':
      return 'decision'
    case 'navigational':
      return 'retention'
  }
}

/** The keyword when given, else ''. Topics are never invented. */
export function guessTopic(_text: string, keyword?: string): string {
  void _text
  return (keyword ?? '').trim()
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC-4180-ish: quoted fields, "" escapes, CRLF/LF/CR, BOM. Blank lines are dropped. */
function parseCsvRecords(csv: string): string[][] {
  const s = csv.replace(/^﻿/, '')
  const records: string[][] = []
  let field = ''
  let rec: string[] = []
  let inQuotes = false
  let i = 0
  const endRecord = () => {
    rec.push(field)
    field = ''
    if (!(rec.length === 1 && rec[0].trim() === '')) records.push(rec)
    rec = []
  }
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue }
    if (ch === ',') { rec.push(field); field = ''; i++; continue }
    if (ch === '\r') { endRecord(); i += s[i + 1] === '\n' ? 2 : 1; continue }
    if (ch === '\n') { endRecord(); i++; continue }
    field += ch; i++
  }
  if (field !== '' || rec.length > 0) endRecord()
  return records
}

const HEADER_ALIASES: Record<string, string> = {
  text: 'text', prompt: 'text', topic: 'topic', intent: 'intent',
  journeystage: 'journeyStage', journey: 'journeyStage',
  country: 'country', language: 'language', keyword: 'keyword',
  searchvolume: 'searchVolume', volume: 'searchVolume', priority: 'priority',
}

function headerKey(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function parseVolume(raw: string): number | null {
  const v = raw.trim()
  if (/^\d+$/.test(v) || /^\d{1,3}(,\d{3})+$/.test(v)) {
    const n = Number(v.replace(/,/g, ''))
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

export function parsePromptCsv(csv: string): { rows: PromptInput[]; errors: string[] } {
  const rows: PromptInput[] = []
  const errors: string[] = []
  const records = parseCsvRecords(String(csv ?? ''))
  if (records.length === 0) return { rows, errors: ['Empty file: header row required'] }
  const cols: Array<string | null> = records[0].map((h) => HEADER_ALIASES[headerKey(h)] ?? null)
  if (!cols.includes('text')) return { rows, errors: ['Header row must contain a "text" (or "prompt") column'] }

  for (let r = 1; r < records.length; r++) {
    const rowNo = r + 1
    const cell: Record<string, string> = {}
    records[r].forEach((v, idx) => {
      const k = cols[idx]
      if (k && cell[k] === undefined) cell[k] = v
    })
    const text = (cell.text ?? '').trim()
    if (!text) { errors.push(`Row ${rowNo}: text is empty, skipped`); continue }
    if (text.length > LIMITS.promptTextMax) {
      errors.push(`Row ${rowNo}: text is longer than ${LIMITS.promptTextMax} characters, skipped`)
      continue
    }
    const row: PromptInput = { text }
    if (cell.topic?.trim()) row.topic = cell.topic.trim()
    const intent = (cell.intent ?? '').trim().toLowerCase()
    if ((PROMPT_INTENTS as readonly string[]).includes(intent)) row.intent = intent as PromptIntent
    const journey = (cell.journeyStage ?? '').trim().toLowerCase()
    if ((JOURNEY_STAGES as readonly string[]).includes(journey)) row.journeyStage = journey as JourneyStage
    if (cell.country?.trim()) row.country = cell.country.trim()
    if (cell.language?.trim()) row.language = cell.language.trim()
    if (cell.keyword?.trim()) row.keyword = cell.keyword.trim()
    if ('searchVolume' in cell) row.searchVolume = parseVolume(cell.searchVolume)
    const priority = (cell.priority ?? '').trim().toLowerCase()
    if ((PRIORITIES as readonly string[]).includes(priority)) row.priority = priority as Priority
    rows.push(row)
  }
  return { rows, errors }
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function promptsToCsv(rows: Array<PromptDTO & { stats?: PromptStats }>): string {
  const header = ['text', 'topic', 'intent', 'journeyStage', 'country', 'language', 'source', 'keyword', 'searchVolume', 'priority', 'status', 'responses', 'brandMentions', 'mentionRate', 'citationRate']
  const lines = [header.join(',')]
  for (const p of rows) {
    const s = p.stats
    lines.push([
      p.text, p.topic, p.intent, p.journeyStage, p.country, p.language, p.source, p.keyword,
      p.searchVolume, p.priority, p.status,
      s ? s.responses : null, s ? s.brandMentions : null, s ? s.mentionRate : null, s ? s.citationRate : null,
    ].map(csvCell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
