/**
 * Brand Radar — validation of prompt input from the API (pure, no I/O).
 */
import { stripInvisible } from './normalize'
import { classifyIntent, classifyJourney, guessTopic, textKey } from './prompts'
import {
  COUNTRIES, JOURNEY_STAGES, LANGUAGES, LIMITS, PRIORITIES, PROMPT_INTENTS, PROMPT_SOURCES, PROMPT_STATUSES,
  type JourneyStage, type Priority, type PromptIntent, type PromptSource, type PromptStatus,
} from './types'

export interface CleanPrompt {
  text: string
  textKey: string
  topic: string
  intent: PromptIntent
  journeyStage: JourneyStage
  country: string
  language: string
  source: PromptSource
  keyword: string
  searchVolume: number | null
  priority: Priority
  status: PromptStatus
  note: string
}

function pick<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null
}

/** A supported country code (upper case) or null */
export function pickCountry(v: unknown): string | null {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return COUNTRIES.some((x) => x.code === c) ? c : null
}

/** A supported language code (lower case) or null */
export function pickLanguage(v: unknown): string | null {
  const l = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return LANGUAGES.some((x) => x.code === l) ? l : null
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? stripInvisible(v).trim().slice(0, max) : ''
}

export function cleanVolume(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** Validate the prompt text only. Returns an error reason or the trimmed text. */
export function cleanText(v: unknown): { ok: true; text: string } | { ok: false; reason: string } {
  const text = typeof v === 'string' ? stripInvisible(v).trim() : ''
  if (!text) return { ok: false, reason: 'Prompt text is empty' }
  if (text.length > LIMITS.promptTextMax) return { ok: false, reason: `Prompt is longer than ${LIMITS.promptTextMax} characters` }
  if (!textKey(text)) return { ok: false, reason: 'Prompt has no readable text' }
  return { ok: true, text }
}

/** Full prompt for creation: missing fields are derived (intent, journey, topic) or defaulted. */
export function cleanPromptInput(
  raw: unknown, defaults: { country: string; language: string },
): { ok: true; value: CleanPrompt } | { ok: false; reason: string; text: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const t = cleanText(r.text)
  if (!t.ok) return { ok: false, reason: t.reason, text: typeof r.text === 'string' ? r.text.slice(0, 80) : '' }
  const keyword = str(r.keyword, 200)
  // Same rule as cleanPromptPatch: a value that is present but unsupported is an error, not silently defaulted.
  const present = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')
  const rowText = t.text.slice(0, 80)
  if (present(r.country) && !pickCountry(r.country)) return { ok: false, reason: 'Invalid country', text: rowText }
  if (present(r.language) && !pickLanguage(r.language)) return { ok: false, reason: 'Invalid language', text: rowText }
  const intent = pick(PROMPT_INTENTS, r.intent) ?? classifyIntent(t.text)
  return {
    ok: true,
    value: {
      text: t.text,
      textKey: textKey(t.text),
      topic: str(r.topic, 100) || guessTopic(t.text, keyword),
      intent,
      journeyStage: pick(JOURNEY_STAGES, r.journeyStage) ?? classifyJourney(intent),
      country: pickCountry(r.country) ?? defaults.country,
      language: pickLanguage(r.language) ?? defaults.language,
      source: pick(PROMPT_SOURCES, r.source) ?? 'manual',
      keyword,
      searchVolume: cleanVolume(r.searchVolume),
      priority: pick(PRIORITIES, r.priority) ?? 'medium',
      status: pick(PROMPT_STATUSES, r.status) ?? 'CANDIDATE',
      note: str(r.note, 1000),
    },
  }
}

/** Partial update: only keys present in the body are returned. Invalid values are errors, not ignored. */
export function cleanPromptPatch(raw: unknown): { ok: true; data: Partial<CleanPrompt> } | { ok: false; reason: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d: Partial<CleanPrompt> = {}
  if ('text' in r) {
    const t = cleanText(r.text)
    if (!t.ok) return { ok: false, reason: t.reason }
    d.text = t.text
    d.textKey = textKey(t.text)
  }
  const enums: Array<[keyof CleanPrompt, readonly string[]]> = [
    ['intent', PROMPT_INTENTS], ['journeyStage', JOURNEY_STAGES], ['source', PROMPT_SOURCES],
    ['priority', PRIORITIES], ['status', PROMPT_STATUSES],
  ]
  for (const [k, list] of enums) {
    if (!(k in r)) continue
    const v = r[k as string]
    if (typeof v !== 'string' || !list.includes(v)) return { ok: false, reason: `Invalid ${String(k)}` }
    ;(d as Record<string, unknown>)[k] = v
  }
  if ('topic' in r) d.topic = str(r.topic, 100)
  if ('keyword' in r) d.keyword = str(r.keyword, 200)
  if ('note' in r) d.note = str(r.note, 1000)
  if ('country' in r) {
    const c = pickCountry(r.country)
    if (!c) return { ok: false, reason: 'Unsupported country' }
    d.country = c
  }
  if ('language' in r) {
    const l = pickLanguage(r.language)
    if (!l) return { ok: false, reason: 'Unsupported language' }
    d.language = l
  }
  if ('searchVolume' in r) d.searchVolume = cleanVolume(r.searchVolume)
  return { ok: true, data: d }
}
