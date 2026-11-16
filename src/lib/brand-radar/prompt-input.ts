/**
 * Brand Radar — validation of prompt input from the API (pure, no I/O).
 */
import { stripInvisible } from './normalize'
import { classifyIntent, classifyJourney, guessTopic, textKey } from './prompts'
import {
  JOURNEY_STAGES, LIMITS, PRIORITIES, PROMPT_INTENTS, PROMPT_SOURCES, PROMPT_STATUSES,
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
  const intent = pick(PROMPT_INTENTS, r.intent) ?? classifyIntent(t.text)
  return {
    ok: true,
    value: {
      text: t.text,
      textKey: textKey(t.text),
      topic: str(r.topic, 100) || guessTopic(t.text, keyword),
      intent,
      journeyStage: pick(JOURNEY_STAGES, r.journeyStage) ?? classifyJourney(intent),
      country: str(r.country, 8).toUpperCase() || defaults.country,
      language: str(r.language, 8).toLowerCase() || defaults.language,
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
  if ('country' in r) d.country = str(r.country, 8).toUpperCase()
  if ('language' in r) d.language = str(r.language, 8).toLowerCase()
  if ('searchVolume' in r) d.searchVolume = cleanVolume(r.searchVolume)
  return { ok: true, data: d }
}
