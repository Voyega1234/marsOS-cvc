/**
 * Brand Radar — scorecard contract: a grade per headline number (against tracked competitors)
 * and a month-to-month comparison. Types only: safe to import from "use client" files.
 */

export type Grade = 'good' | 'fair' | 'poor'

/** mention = answers naming the brand; citation = answers linking to our sites; position = order among tracked names */
export type ScoreMetricKey = 'mention' | 'citation' | 'position'

export interface ScoreGrade {
  metric: ScoreMetricKey
  /** our value: a rate 0..1 for mention / citation, the average position for position (1 = named first); null = no data */
  value: number | null
  /** the best tracked competitor on this metric; null = no competitor has data */
  bestCompetitor: { name: string; value: number } | null
  /** null = cannot be graded (no competitor data, or no value of ours) */
  grade: Grade | null
  /** our rank among the brand and the tracked competitors that have data (1 = best); null when not graded */
  rank: number | null
  /** how many brands were ranked (ours included) */
  outOf: number
}

export interface MonthStat {
  /** Bangkok calendar month, YYYY-MM */
  month: string
  /** scan rounds that started in the month */
  scans: number
  /** DONE answers collected by those rounds */
  asked: number
  mentionRate: number | null
  citationRate: number | null
  /** answers that name the brand or link to our sites / asked */
  appearRate: number | null
  /** mean order of the brand among tracked names over the answers that name it, null when never named */
  avgPosition: number | null
}

export interface ScorecardDTO {
  /** graded inside the page filters, like the other Overview numbers */
  grades: ScoreGrade[]
  /**
   * Whole history of this brand: every AI platform and question, not limited by the page filters.
   * previous = the calendar month before `current` (null when it has no answers); first = the first month with answers
   * (null when it is the same month as `current`).
   */
  months: { current: MonthStat | null; previous: MonthStat | null; first: MonthStat | null }
}
