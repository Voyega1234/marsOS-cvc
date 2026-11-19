// Brand Radar language handling.
//
// A profile can be set to one language (th / en) or to "both" for clients whose prompts are written in
// Thai and in English. "both" is a profile-level choice only: every prompt, task and provider call still
// carries one concrete language, taken from the text of the prompt itself.

import { LANGUAGES } from './types'

/** Profile-level value: prompts are in Thai and in English, each one is detected from its own text */
export const LANGUAGE_BOTH = 'both'

/** Choices for the profile language field (Settings) */
export const PROFILE_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  ...LANGUAGES,
  { code: LANGUAGE_BOTH, label: 'Thai + English (ไทย + อังกฤษ)' },
]

/** true when `v` is one of the languages a provider can be asked in (never "both") */
export function isConcreteLanguage(v: unknown): v is string {
  return typeof v === 'string' && LANGUAGES.some((l) => l.code === v)
}

/** true when `v` is a value the profile language field accepts */
export function isProfileLanguage(v: unknown): v is string {
  return typeof v === 'string' && PROFILE_LANGUAGES.some((l) => l.code === v)
}

// Thai Unicode block, written as numbers so the source stays plain ASCII
const THAI_FIRST = 0x0e00
const THAI_LAST = 0x0e7f

/** Thai when the text has any Thai character, otherwise English (brand names in Latin letters inside a
 *  Thai question are common, the reverse is not). */
export function detectPromptLanguage(text: string): 'th' | 'en' {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= THAI_FIRST && c <= THAI_LAST) return 'th'
  }
  return 'en'
}

/**
 * The one language a prompt is asked in.
 * - profile "both": always read from the text, so prompts saved before the profile was switched work as they are
 * - otherwise: the prompt's own language when it has one, then the profile's
 * A value that is not a single language never leaves this function.
 */
export function resolveLanguage(profileLanguage: string | null | undefined, text: string, stored?: string | null): string {
  if (profileLanguage === LANGUAGE_BOTH) return detectPromptLanguage(text)
  const base = stored || profileLanguage || ''
  return isConcreteLanguage(base) ? base : detectPromptLanguage(text)
}
