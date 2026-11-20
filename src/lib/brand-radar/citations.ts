/**
 * Brand Radar — citation extraction. A citation is a LINK; an unlinked brand name or bare domain is not one.
 */
import { classifyHost, hostOf, normalizeDomain, normalizeUrl, stripInvisible, unwrapFacebookRedirect } from './normalize'
import { LIMITS, type CitationOwner } from './types'

export interface RawCitation { url: string; title?: string }
export interface CitationHit {
  url: string
  normalizedUrl: string
  host: string
  domain: string
  title: string
  ownerType: CitationOwner
  competitorId: string | null
  position: number
}

const TITLE_MAX = 300
const MD_LINK_RE = /\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/gi
const BARE_URL_RE = /https?:\/\/[^\s<>"'`]+/gi

function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:!?)\]}'"]+$/, '')
}

export function extractCitations(
  input: { text: string; citations: RawCitation[] },
  ownedDomains: string[],
  competitors: Array<{ id: string; domains: string[] }>,
): CitationHit[] {
  const candidates: Array<{ url: string; title: string }> = []
  for (const c of input.citations || []) {
    if (c && typeof c.url === 'string') candidates.push({ url: c.url.trim(), title: c.title || '' })
  }
  const text = stripInvisible(input.text || '')
  // markdown links first; blank them out so the bare-URL pass does not re-read them
  const rest = text.replace(MD_LINK_RE, (_m, label: string, url: string) => {
    candidates.push({ url, title: label })
    return ' '
  })
  for (const m of rest.match(BARE_URL_RE) || []) {
    candidates.push({ url: stripTrailingPunct(m), title: '' })
  }

  const seen = new Set<string>()
  const out: CitationHit[] = []
  for (const cand of candidates) {
    const c = { url: unwrapFacebookRedirect(cand.url), title: cand.title }
    const normalizedUrl = normalizeUrl(c.url)
    if (!normalizedUrl || seen.has(normalizedUrl)) continue
    const host = hostOf(c.url)
    if (!host) continue
    seen.add(normalizedUrl)
    const { ownerType, competitorId } = classifyHost(host, ownedDomains, competitors)
    out.push({
      url: c.url.slice(0, LIMITS.urlMax),
      normalizedUrl,
      host,
      domain: normalizeDomain(host),
      title: stripInvisible(c.title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX),
      ownerType,
      competitorId,
      position: out.length,
    })
  }
  return out
}
