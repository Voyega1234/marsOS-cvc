/**
 * Brand Radar — URL Monitor contract: staff list the pages they want to watch, and the report shows how the
 * AI answers to the project's prompts pull (cite) each page.
 * Types only: safe to import from "use client" files.
 *
 * Counting rule for one monitored URL, inside the page filters:
 *   N = collected answers, C = answers that cite the URL, B = answers in C that also name the brand,
 *   P = prompts with at least one answer, K = prompts with at least one answer in C.
 *   AI Citation = C / N · Brand Mention = B / C · Visibility = K / P.
 * A number that cannot be computed is null, never 0.
 */
import type { ScoreGrade } from './scorecard-types'
import type { AnswerInsightDTO, OverviewDTO, ProviderKey } from './types'

export interface MonitoredUrl {
  id: string
  /** as typed by staff (trimmed), shown and used as the link */
  url: string
  /** canonical form from normalizeUrl(); citations are matched on this */
  normalizedUrl: string
  /** true = this page and every page under it */
  prefix: boolean
  addedAt: string
}

export interface UrlTotals {
  /** N */
  answers: number
  /** C */
  citingAnswers: number
  citationRate: number | null
  /** B */
  brandMentioned: number
  brandMentionRate: number | null
  /** P */
  prompts: number
  /** K */
  citingPrompts: number
  visibility: number | null
  /** mean place of the URL in the source list of the answers that cite it (1 = listed first) */
  avgPlace: number | null
  /** newest answer that cites the URL */
  lastCitedAt: string | null
}

/** One row of the monitored list: the URL and its headline numbers inside the page filters */
export interface UrlSummaryRow extends MonitoredUrl {
  citingAnswers: number
  citationRate: number | null
  citingPrompts: number
  lastCitedAt: string | null
}

export interface UrlProviderRow {
  provider: ProviderKey
  answers: number
  citingAnswers: number
  citationRate: number | null
  brandMentioned: number
  brandMentionRate: number | null
}

export interface UrlPromptRow {
  promptId: string
  text: string
  topic: string
  /** answers collected for this prompt */
  asked: number
  /** answers that cite the URL */
  cited: number
  citationRate: number | null
  /** answers that cite the URL and name the brand */
  brandMentioned: number
  /** AI platforms whose answer cites the URL */
  providers: ProviderKey[]
  /** newest answer that cites the URL; null when none does */
  latest: { responseId: string; runId: string; provider: ProviderKey; at: string | null } | null
}

export interface UrlScanPoint {
  runId: string
  date: string
  label: string
  asked: number
  cited: number
  citationRate: number | null
  prompts: number
  citingPrompts: number
  visibility: number | null
  brandMentioned: number
  brandMentionRate: number | null
  avgPlace: number | null
  /** false = this round used another prompt set or other AI platforms than the round before */
  sameSetAsPrevious: boolean | null
}

export interface UrlMonthStat {
  /** Bangkok calendar month, YYYY-MM */
  month: string
  scans: number
  asked: number
  cited: number
  citationRate: number | null
  visibility: number | null
  brandMentionRate: number | null
  avgPlace: number | null
}

export interface UrlScorecard {
  /**
   * Graded inside the page filters, in the order citation, mention, position.
   * `bestCompetitor` is the benchmark: the most cited other page (citation), the whole project (mention),
   * every other source (position).
   */
  grades: ScoreGrade[]
  /** whole history of the project, not limited by the page filters; null when it could not be loaded */
  months: { current: UrlMonthStat | null; previous: UrlMonthStat | null; first: UrlMonthStat | null } | null
}

export interface UrlReport {
  url: MonitoredUrl
  totals: UrlTotals
  byProvider: UrlProviderRow[]
  /** AI Citation of the URL per topic and AI platform */
  heat: OverviewDTO['heat']
  /** every prompt with an answer, most citing answers first */
  prompts: UrlPromptRow[]
  scans: UrlScanPoint[]
  scorecard: UrlScorecard
  /** brand sentiment over the answers that cite the URL */
  insight?: AnswerInsightDTO
  /** the pages that matched (more than one only in prefix mode), most cited first, capped */
  pages: Array<{ url: string; title: string; answers: number }>
}

export interface UrlMonitorDTO {
  /** false = Brand Radar is not set up for this project yet */
  configured: boolean
  urls: UrlSummaryRow[]
  /** collected answers inside the page filters */
  answers: number
  selectedId: string | null
  report: UrlReport | null
}

export interface UrlMonitorWriteRes { urls: MonitoredUrl[]; id?: string }
