/**
 * Brand Radar — brands the AI platforms name that are not tracked yet (not our brand, not a tracked competitor).
 * Source: the brand tags the platform itself attaches to an answer (ChatGPT / Gemini only). Staff only.
 * Types only: safe to import from "use client" files.
 */
import type { ProviderKey } from './types'

export interface UntrackedBrandRow {
  name: string
  /** category label given by the platform, '' when none */
  category: string
  /** website domain given by the platform, '' when none */
  domain: string
  /** answers that tag this brand */
  answers: number
  /** questions with at least one such answer */
  prompts: number
  providers: ProviderKey[]
  /** up to 3 questions where it shows up */
  samplePrompts: Array<{ promptId: string; text: string }>
}

export interface UntrackedBrandsDTO {
  /** answers inside the filters that carry platform brand tags (0 = no data yet) */
  taggedAnswers: number
  /** most answers first, capped */
  rows: UntrackedBrandRow[]
}
