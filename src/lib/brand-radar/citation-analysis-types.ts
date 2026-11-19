/**
 * Brand Radar — Citation Analysis: the shape of GET /api/brand-radar/citation-analysis.
 * Pure types only, shared by the server builder and the tab component.
 *
 * Everything here is computed from data that scans already stored (answers, mentions, citations, sentiment).
 * No AI call is made to build it. Text that came from an AI answer or a cited page (titles, URLs, domains,
 * prompt text) is untrusted and must be rendered as plain text.
 */
import type { CitationOwner, CitedDomainRow, ProviderKey } from './types'

/** What kind of site a cited domain is, guessed from the domain name and URL paths only. */
export type SiteType =
  | 'official'
  | 'blog'
  | 'news'
  | 'review'
  | 'forum'
  | 'directory'
  | 'social'
  | 'video'
  | 'marketplace'
  | 'reference'
  | 'government'
  | 'other'

export interface AnalysisRange { from: string; to: string }

export interface AnalysisTotals {
  /** Answers collected in the period (status DONE). */
  answers: number
  answersWithCitations: number
  citations: number
  /** Distinct cited domains. */
  domains: number
  /** Answers that cite at least one page of our own site. */
  ownCitedAnswers: number
  ownCitations: number
  /** ownCitations / citations */
  ownCitationShare: number | null
  /** ownCitedAnswers / answers */
  citationRate: number | null
  /** Answers that name our brand. */
  brandMentions: number
  mentionRate: number | null
  brandRecommended: number
  recommendedRate: number | null
  /** Answers that name our brand but cite no page of ours. */
  mentionedNotCited: number
  /** Answers that cite a competitor's site and no page of ours. */
  competitorCitedNotUs: number
  runs: number
  prompts: number
}

export interface AnalysisPrevious {
  range: AnalysisRange
  answers: number
  mentionRate: number | null
  citationRate: number | null
  recommendedRate: number | null
  ownCitationShare: number | null
  domains: number
}

export interface AnalysisRun {
  runId: string
  /** ISO timestamp of the run start. */
  date: string
  answers: number
}

export interface SentimentCounts { positive: number; neutral: number; mixed: number; negative: number }

export interface TrendPoint {
  /** Day (YYYY-MM-DD, Bangkok time) for byDay, run id for byRun. */
  key: string
  /** ISO date used for the axis label. */
  date: string
  answers: number
  mentionRate: number | null
  citationRate: number | null
  recommendedRate: number | null
  /** Share of answers that cite at least one competitor site. */
  competitorCitationRate: number | null
  /** Tone of what the AI said about our brand; null when no sentiment was stored for this point. */
  sentiment: SentimentCounts | null
}

/** One piece of evidence for why a domain keeps being cited. The UI turns the code into a sentence. */
export interface WhySignal {
  code: 'multi_platform' | 'many_pages' | 'consistent' | 'title_match' | 'top_position' | 'many_prompts' | 'page_type'
  /** The measured number behind the signal (platforms, pages, runs present, matching titles, average position, prompts). */
  value: number
  /** The denominator when the signal is a "value of total" statement. */
  total?: number
  /** Extra plain text, for example the dominant page type. */
  detail?: string
}

export interface AnalysisPage {
  url: string
  title: string
  /** Page kind guessed from the URL path: article, review, comparison, list, product, home, forum thread, video, other. */
  pageType: string
  citations: number
  answers: number
  prompts: number
  providers: ProviderKey[]
}

export interface AnalysisDomainRow {
  domain: string
  ownerType: CitationOwner
  /** Empty unless ownerType is competitor. */
  competitorName: string
  siteType: SiteType
  citations: number
  /** Answers that cite this domain at least once. */
  answers: number
  /** answers / all answers in the period */
  answerShare: number | null
  prompts: number
  providers: ProviderKey[]
  /** In how many runs of the period the domain was cited, and how many runs there were. */
  runsPresent: number
  runsTotal: number
  /** Share of answers citing this domain per run, aligned with CitationAnalysisDTO.runs (0 when absent). */
  series: number[]
  /** Average position in the citation list (1 = first); null when the domain has no citation rows. */
  avgPosition: number | null
  /** Answers citing the domain in the previous period of the same length; null when there is no previous data. */
  previousAnswers: number | null
  change: 'new' | 'up' | 'down' | 'same' | null
  lastSeenAt: string | null
  /** Backlink library entry for this domain. Always null in the client view. */
  vendor: CitedDomainRow['vendor']
  /** True when the domain is one of our own PBN sites. Always false in the client view. */
  isOwnPbn: boolean
  /** Most cited pages of the domain (top 8). */
  pages: AnalysisPage[]
  /** Prompts that most often lead to this domain being cited (top 8). */
  promptsList: Array<{ promptId: string; text: string; answers: number; asked: number }>
  signals: WhySignal[]
  /** One stored answer that cites this domain, for opening in the answer viewer. */
  sample: { promptId: string; runId: string; provider: ProviderKey } | null
}

/** How the answers to one prompt on one platform differ between asks of the latest run, and against the run before. */
export interface AnswerVariationRow {
  promptId: string
  promptText: string
  provider: ProviderKey
  providerLabel: string
  runId: string
  runDate: string
  /** How many times the prompt was asked on this platform in the run. */
  asks: number
  /** How many of those answers name / recommend our brand or cite our site. */
  brandMentioned: number
  brandRecommended: number
  ownCited: number
  distinctDomains: number
  /** Domains cited in every ask (max 6). */
  alwaysCited: string[]
  /** Domains cited in some asks only (max 6). */
  sometimesCited: string[]
  /** 0..1, how similar the cited-domain sets are between asks (mean pairwise Jaccard); null with fewer than 2 asks. */
  stability: number | null
  previousRunId: string | null
  /** Domains cited now but not in the previous run, and the other way round (max 6 each). */
  newDomains: string[]
  lostDomains: string[]
  /** Brand mention rate now minus the previous run (-1..1); null without a previous run. */
  mentionChange: number | null
  /** Competitors named in these answers (top 4). */
  competitorsMentioned: Array<{ name: string; answers: number }>
}

export interface OwnPageRow {
  url: string
  title: string
  citations: number
  answers: number
  prompts: Array<{ promptId: string; text: string }>
  providers: ProviderKey[]
}

export interface MentionedNotCitedRow {
  promptId: string
  text: string
  /** Answers that name us without citing us, out of `asked` answers for the prompt. */
  answers: number
  asked: number
  providers: ProviderKey[]
  /** Domains the AI cited instead (top 5). */
  citedInstead: string[]
}

export interface CompetitorCitedRow {
  promptId: string
  text: string
  /** Answers that cite a competitor site and not ours, out of `asked`. */
  answers: number
  asked: number
  competitors: Array<{ name: string; domain: string; answers: number }>
}

export type FixAction = 'keep' | 'strengthen' | 'make_citable' | 'create'

/** One question: which of our pages the AI uses for it, which pages it uses instead, and what to do about it. */
export interface PromptFixRow {
  promptId: string
  text: string
  /** answers to this question inside the filters */
  asked: number
  /** answers that link to one of our sites */
  ownAnswers: number
  /** answers that name our brand */
  mentionedAnswers: number
  /** our pages the AI links to for this question, most answers first (top 3) */
  ownPages: Array<{ url: string; title: string; answers: number }>
  /** pages linked in the answers that do NOT link to us, most answers first (top 3) */
  insteadPages: Array<{ url: string; domain: string; title: string; ownerType: 'competitor' | 'external'; competitorName: string | null; answers: number }>
  action: FixAction
}

export interface FoundNotCitedPage {
  url: string
  title: string
  /** answers where the platform found this page */
  found: number
  /** of those, answers that also link to it */
  cited: number
  /** up to 3 questions where it was found but not linked */
  prompts: Array<{ promptId: string; text: string }>
}

/** Sources a platform reports it found while searching, against the sources it finally linked. */
export interface FoundFunnel {
  /** answers inside the filters that carry found-source data */
  withData: number
  /** of those, answers where one of our pages is among the found sources */
  found: number
  /** of `found`, answers that link to one of our sites */
  foundAndCited: number
  /** of `found`, answers that name our brand */
  foundAndMentioned: number
  /** platforms that supplied found-source data */
  providers: ProviderKey[]
  /** our pages found more often than cited, biggest gap first (capped) */
  pages: FoundNotCitedPage[]
}

export interface CitationAnalysisDTO {
  /** False when Brand Radar has not been set up for the project. */
  configured: boolean
  /** False when no answer exists for the filters. */
  hasData: boolean
  brandName: string
  range: AnalysisRange
  totals: AnalysisTotals
  /** Same-length period right before `range`; null when it holds no answers. */
  previous: AnalysisPrevious | null
  /** Runs in the period, oldest first (max 30, the most recent ones). */
  runs: AnalysisRun[]
  trend: { byDay: TrendPoint[]; byRun: TrendPoint[] }
  /** Cited domains sorted by answers, highest first (max 60). */
  domains: AnalysisDomainRow[]
  /** One row per prompt and platform of the latest run that asked it (max 60). */
  variation: AnswerVariationRow[]
  /** Our own pages that the AI cited (max 30). */
  ownPages: OwnPageRow[]
  gaps: {
    mentionedNotCited: MentionedNotCitedRow[]
    competitorCitedNotUs: CompetitorCitedRow[]
  }
  /** Per question: which page to fix to win it (max 50). Empty in the customer view. */
  fixPages: PromptFixRow[]
  /** Found-but-not-cited funnel; null in the customer view or when no platform reported found sources. */
  foundFunnel: FoundFunnel | null
}
