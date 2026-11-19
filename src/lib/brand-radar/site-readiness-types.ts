// Brand Radar: types for the "AI readiness of the brand's own website" check. Types only, safe to import from client files.

export type BotVerdict = 'allowed' | 'partial' | 'blocked' | 'unknown'
export type BotPurpose = 'training' | 'search' | 'user' | 'index'

export interface AiBotRow {
  bot: string
  owner: string
  purpose: BotPurpose
  verdict: BotVerdict
  /** the user-agent group that applied: the bot's own, '*' or '' when no rule */
  matchedGroup: string
}

export type FileState = 'found' | 'missing' | 'unreadable'

export interface HomepageCheck {
  state: 'ok' | 'unreadable'
  httpStatus: number | null
  finalUrl: string
  noindex: boolean
  nosnippet: boolean
  title: string
  description: string
  canonical: string
  schemaTypes: string[]
  hasJsonLd: boolean
  /** characters of visible text without running JavaScript */
  textLength: number
}

export interface SiteReadinessDTO {
  status: 'ok' | 'no_domain' | 'unreachable'
  domain: string
  checkedAt: string | null
  robots: { state: FileState; httpStatus: number | null; bots: AiBotRow[]; sitemaps: string[] }
  llmsTxt: { state: FileState; httpStatus: number | null }
  homepage: HomepageCheck | null
  /** short machine codes of problems found, most serious first; the UI maps them to Thai sentences */
  issues: string[]
}
