// Brand Radar: pure analysis of a website's AI readiness (robots.txt, llms.txt, homepage). No network, no database.
import type { AiBotRow, BotPurpose, BotVerdict, FileState, HomepageCheck, SiteReadinessDTO } from './site-readiness-types'

export interface AiBot { bot: string; owner: string; purpose: BotPurpose }

export const AI_BOTS: AiBot[] = [
  { bot: 'GPTBot', owner: 'OpenAI', purpose: 'training' },
  { bot: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'search' },
  { bot: 'ChatGPT-User', owner: 'OpenAI', purpose: 'user' },
  { bot: 'ClaudeBot', owner: 'Anthropic', purpose: 'training' },
  { bot: 'Claude-SearchBot', owner: 'Anthropic', purpose: 'search' },
  { bot: 'Claude-User', owner: 'Anthropic', purpose: 'user' },
  { bot: 'PerplexityBot', owner: 'Perplexity', purpose: 'search' },
  { bot: 'Perplexity-User', owner: 'Perplexity', purpose: 'user' },
  { bot: 'Google-Extended', owner: 'Google', purpose: 'training' },
  // AI Overviews and AI Mode use the Google index
  { bot: 'Googlebot', owner: 'Google', purpose: 'index' },
  // Copilot and ChatGPT search use the Bing index
  { bot: 'Bingbot', owner: 'Microsoft', purpose: 'index' },
]

// ── robots.txt ───────────────────────────────────────────────────────────────

export interface RobotsRule { allow: boolean; pattern: string }
export interface RobotsGroup { agents: string[]; rules: RobotsRule[] }
export interface ParsedRobots { groups: RobotsGroup[]; sitemaps: string[] }

const MAX_ROBOTS_LINES = 20_000
const MAX_SITEMAPS = 5

/** RFC 9309 style parser: groups of consecutive User-agent lines followed by Allow / Disallow rules */
export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let cur: RobotsGroup | null = null
  let lastWasAgent = false
  const whole = String(text ?? '')
  // A leading byte-order mark would hide the first directive
  const lines = (whole.charCodeAt(0) === 0xfeff ? whole.slice(1) : whole).split(/\r\n|\r|\n/, MAX_ROBOTS_LINES)
  for (const raw of lines) {
    const hash = raw.indexOf('#')
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (field === 'sitemap') {
      if (/^https?:\/\//i.test(value) && sitemaps.length < MAX_SITEMAPS) sitemaps.push(value.slice(0, 300))
      continue
    }
    if ((field === 'allow' || field === 'disallow') && cur) cur.rules.push({ allow: field === 'allow', pattern: value })
  }
  return { groups, sitemaps }
}

/** Rules a bot must obey: the groups naming it, else the "*" groups, else none */
function groupFor(parsed: ParsedRobots, bot: string): { rules: RobotsRule[]; matched: string } {
  const token = bot.toLowerCase()
  const own = parsed.groups.filter((g) => g.agents.includes(token))
  if (own.length) return { rules: own.flatMap((g) => g.rules), matched: bot }
  const star = parsed.groups.filter((g) => g.agents.includes('*'))
  if (star.length) return { rules: star.flatMap((g) => g.rules), matched: '*' }
  return { rules: [], matched: '' }
}

/** Length of the match when the robots pattern matches the path (supports * and $), else -1. Linear scan, no backtracking. */
function matchLength(pattern: string, path: string): number {
  if (!pattern) return -1 // empty Disallow / Allow matches nothing
  let pat = pattern
  let anchored = false
  if (pat.endsWith('$')) { anchored = true; pat = pat.slice(0, -1) }
  const parts = pat.split('*')
  if (!path.startsWith(parts[0])) return -1
  if (parts.length === 1) return anchored && path !== parts[0] ? -1 : pattern.length
  let pos = parts[0].length
  for (let i = 1; i < parts.length - 1; i++) {
    const at = path.indexOf(parts[i], pos)
    if (at < 0) return -1
    pos = at + parts[i].length
  }
  const last = parts[parts.length - 1]
  if (anchored) return path.length - last.length >= pos && path.endsWith(last) ? pattern.length : -1
  return path.indexOf(last, pos) >= 0 ? pattern.length : -1
}

/** Whether the path may be fetched under the rules: longest match wins, Allow wins a tie */
export function pathAllowed(rules: RobotsRule[], path: string): boolean {
  let best = -1
  let allow = true
  for (const r of rules) {
    const len = matchLength(r.pattern, path)
    if (len < 0) continue
    if (len > best || (len === best && r.allow && !allow)) { best = len; allow = r.allow }
  }
  return allow
}

export function botVerdict(parsed: ParsedRobots, bot: string): { verdict: BotVerdict; matchedGroup: string } {
  const { rules, matched } = groupFor(parsed, bot)
  if (!pathAllowed(rules, '/')) return { verdict: 'blocked', matchedGroup: matched }
  const partial = rules.some((r) => !r.allow && r.pattern !== '')
  return { verdict: partial ? 'partial' : 'allowed', matchedGroup: matched }
}

function botRows(parsed: ParsedRobots | null, verdict: BotVerdict): AiBotRow[] {
  return AI_BOTS.map((b) => {
    if (!parsed) return { ...b, verdict, matchedGroup: '' }
    const v = botVerdict(parsed, b.bot)
    return { ...b, verdict: v.verdict, matchedGroup: v.matchedGroup }
  })
}

export interface RobotsCheck { state: FileState; httpStatus: number | null; bots: AiBotRow[]; sitemaps: string[] }

/** robots.txt fetch outcome to result. status null = our fetch failed. */
export function robotsFromResponse(res: { status: number; body: string } | null): RobotsCheck {
  if (!res) return { state: 'unreadable', httpStatus: null, bots: botRows(null, 'unknown'), sitemaps: [] }
  const { status, body } = res
  if (status >= 200 && status < 300) {
    const parsed = parseRobots(body)
    return { state: 'found', httpStatus: status, bots: botRows(parsed, 'allowed'), sitemaps: parsed.sitemaps }
  }
  if (status === 404 || status === 410) return { state: 'missing', httpStatus: status, bots: botRows(null, 'allowed'), sitemaps: [] }
  // 401 / 403 / 5xx / anything else: we cannot say what a real bot would see
  return { state: 'unreadable', httpStatus: status, bots: botRows(null, 'unknown'), sitemaps: [] }
}

// ── homepage ─────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
      try { return String.fromCodePoint(code) } catch { return m }
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

interface Block { start: number; end: number; inner: string; attrs: string }

/** Index-based scan for <tag ...>...</tag> blocks (no regex over the whole input) */
function findBlocks(html: string, tag: string, max = 200): Block[] {
  const out: Block[] = []
  const lower = html.toLowerCase()
  const open = `<${tag}`
  const close = `</${tag}`
  let i = 0
  while (out.length < max) {
    const s = lower.indexOf(open, i)
    if (s < 0) break
    const after = lower.charAt(s + open.length)
    if (after && !/[\s>/]/.test(after)) { i = s + open.length; continue }
    const gt = lower.indexOf('>', s)
    if (gt < 0) break
    const c = lower.indexOf(close, gt)
    const end = c < 0 ? lower.length : c
    const closeGt = c < 0 ? -1 : lower.indexOf('>', c)
    out.push({ start: s, end: closeGt < 0 ? lower.length : closeGt + 1, inner: html.slice(gt + 1, end), attrs: html.slice(s + open.length, gt) })
    i = closeGt < 0 ? lower.length : closeGt + 1
  }
  return out
}

/** Reads one attribute from a tag's attribute text */
function attr(attrs: string, name: string): string {
  const re = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const m = re.exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''
}

/** Attribute text of every <tag ...> start tag (void tags such as meta and link) */
function startTags(html: string, tag: string, max = 300): string[] {
  const out: string[] = []
  const lower = html.toLowerCase()
  const open = `<${tag}`
  let i = 0
  while (out.length < max) {
    const s = lower.indexOf(open, i)
    if (s < 0) break
    const after = lower.charAt(s + open.length)
    if (after && !/[\s>/]/.test(after)) { i = s + open.length; continue }
    const gt = lower.indexOf('>', s)
    if (gt < 0) break
    out.push(html.slice(s + open.length, gt))
    i = gt + 1
  }
  return out
}

function stripBlocks(html: string, tags: string[]): string {
  let out = html
  for (const t of tags) {
    const blocks = findBlocks(out, t, 5000)
    if (!blocks.length) continue
    let res = ''
    let last = 0
    for (const b of blocks) {
      res += out.slice(last, b.start) + ' '
      last = b.end
    }
    out = res + out.slice(last)
  }
  return out
}

/** Visible text length without JavaScript: scripts, styles, noscript, templates and tags removed */
export function visibleTextLength(html: string): number {
  let body = stripBlocks(html, ['script', 'style', 'noscript', 'template', 'title'])
  // comments
  let out = ''
  let i = 0
  for (;;) {
    const s = body.indexOf('<!--', i)
    if (s < 0) { out += body.slice(i); break }
    out += body.slice(i, s) + ' '
    const e = body.indexOf('-->', s + 4)
    if (e < 0) break
    i = e + 3
  }
  body = out
  // remove tags: a '<' followed by a letter, '/' or '!' up to the next '>'
  let text = ''
  i = 0
  for (;;) {
    const s = body.indexOf('<', i)
    if (s < 0) { text += body.slice(i); break }
    text += body.slice(i, s)
    const next = body.charAt(s + 1)
    if (/[a-zA-Z/!?]/.test(next)) {
      const e = body.indexOf('>', s)
      if (e < 0) break
      text += ' '
      i = e + 1
    } else {
      text += '<'
      i = s + 1
    }
  }
  return squash(decodeEntities(text)).length
}

function collectTypes(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || out.size >= 20 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node.slice(0, 200)) collectTypes(n, out, depth + 1)
    return
  }
  const o = node as Record<string, unknown>
  const t = o['@type']
  const list = Array.isArray(t) ? t : [t]
  for (const x of list) if (typeof x === 'string' && x.trim() && out.size < 20) out.add(clip(x.trim(), 60))
  if ('@graph' in o) collectTypes(o['@graph'], out, depth + 1)
}

export function analyseHomepage(html: string, xRobotsTag: string): Omit<HomepageCheck, 'state' | 'httpStatus' | 'finalUrl'> {
  const src = String(html ?? '')
  let noindex = false
  let nosnippet = false
  const readDirectives = (value: string) => {
    const v = value.toLowerCase()
    if (/(^|[\s,])(noindex|none)([\s,]|$)/.test(v)) noindex = true
    if (/(^|[\s,])nosnippet([\s,]|$)/.test(v) || /max-snippet\s*:\s*0(?!\d)/.test(v)) nosnippet = true
  }
  readDirectives(xRobotsTag ?? '')

  let description = ''
  for (const a of startTags(src, 'meta')) {
    const name = attr(a, 'name').toLowerCase()
    if (name === 'robots' || name === 'googlebot' || name === 'bingbot') readDirectives(attr(a, 'content'))
    else if (name === 'description' && !description) description = attr(a, 'content')
  }

  let canonical = ''
  for (const a of startTags(src, 'link')) {
    if (attr(a, 'rel').toLowerCase().split(/\s+/).includes('canonical')) { canonical = attr(a, 'href'); break }
  }

  const titleBlock = findBlocks(src, 'title', 1)[0]
  const title = titleBlock ? squash(decodeEntities(titleBlock.inner)) : ''

  const types = new Set<string>()
  let hasJsonLd = false
  for (const b of findBlocks(src, 'script', 500)) {
    if (attr(b.attrs, 'type').toLowerCase().split(';')[0].trim() !== 'application/ld+json') continue
    hasJsonLd = true
    if (b.inner.length > 500_000) continue
    try { collectTypes(JSON.parse(b.inner), types) } catch { /* broken JSON-LD is ignored */ }
  }

  return {
    noindex,
    nosnippet,
    title: clip(title, 200),
    description: clip(squash(decodeEntities(description)), 300),
    canonical: clip(decodeEntities(canonical).trim(), 300),
    schemaTypes: Array.from(types),
    hasJsonLd,
    textLength: visibleTextLength(src),
  }
}

// ── llms.txt ─────────────────────────────────────────────────────────────────

/** llms.txt counts as found only for a 2xx text response with a non-empty body that is not an HTML page */
export function llmsFromResponse(res: { status: number; contentType: string; body: string } | null): { state: FileState; httpStatus: number | null } {
  if (!res) return { state: 'unreadable', httpStatus: null }
  const { status } = res
  if (status >= 200 && status < 300) {
    const ct = res.contentType.toLowerCase()
    const textType = ct === '' || ct.startsWith('text/') || ct.startsWith('application/octet-stream')
    const head = res.body.slice(0, 1000).trimStart().toLowerCase()
    const looksHtml = head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body') || ct.includes('html')
    if (textType && res.body.trim() !== '' && !looksHtml) return { state: 'found', httpStatus: status }
    return { state: 'missing', httpStatus: status }
  }
  if (status === 404 || status === 410) return { state: 'missing', httpStatus: status }
  return { state: 'unreadable', httpStatus: status }
}

// ── issues ───────────────────────────────────────────────────────────────────

export function collectIssues(parts: Pick<SiteReadinessDTO, 'robots' | 'llmsTxt' | 'homepage'>): string[] {
  const issues: string[] = []
  const { robots, llmsTxt, homepage } = parts
  const blocked = (p: BotPurpose[]) => robots.bots.some((b) => p.includes(b.purpose) && b.verdict === 'blocked')
  if (blocked(['search', 'user'])) issues.push('robots_blocks_ai_search')
  if (blocked(['index'])) issues.push('robots_blocks_index')
  if (homepage?.noindex) issues.push('homepage_noindex')
  if (blocked(['training'])) issues.push('robots_blocks_ai_training')
  if (homepage?.nosnippet) issues.push('homepage_nosnippet')
  if (homepage && homepage.state === 'ok') {
    if (!homepage.hasJsonLd || homepage.schemaTypes.length === 0) issues.push('no_schema')
    else if (!homepage.schemaTypes.some((t) => /^(organization|localbusiness|website)$/i.test(t) || /(organization|localbusiness)$/i.test(t))) issues.push('no_org_schema')
    if (homepage.textLength < 500) issues.push('thin_without_js')
    if (!homepage.description) issues.push('no_meta_description')
    if (!homepage.canonical) issues.push('no_canonical')
  }
  if (robots.sitemaps.length === 0) issues.push('no_sitemap')
  if (llmsTxt.state !== 'found') issues.push('no_llms_txt')
  return issues
}

// ── cache freshness and domain cleaning ──────────────────────────────────────

const WEEK_MS = 7 * 24 * 3600 * 1000
const HOUR_MS = 3600 * 1000

export function isCheckStale(cached: { domain: string; checkedAt: string | null; status: string } | null | undefined, domain: string, now: Date): boolean {
  if (!cached) return true
  if (cached.domain !== domain) return true
  const t = cached.checkedAt ? Date.parse(cached.checkedAt) : NaN
  if (!Number.isFinite(t)) return true
  const age = now.getTime() - t
  if (age < 0) return false
  if (cached.status === 'unreachable') return age > HOUR_MS
  return age > WEEK_MS
}

/** Host name only: no scheme, userinfo, path, port, IP literal or single-label name. '' when not usable. */
export function cleanCheckDomain(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim().toLowerCase()
  if (!s || s.length > 300) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  if (/[@\s]/.test(s.split(/[/?#]/)[0])) return ''
  s = s.split(/[/?#]/)[0]
  s = s.replace(/:\d+$/, '')
  s = s.replace(/\.$/, '')
  if (!s || s.length > 253) return ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return ''
  if (/^\d+(\.\d+)*$/.test(s) || /^0x/i.test(s)) return '' // IPv4-like
  if (s.split('.').some((l) => !l || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) return ''
  if (s.endsWith('.localhost')) return ''
  return s
}
