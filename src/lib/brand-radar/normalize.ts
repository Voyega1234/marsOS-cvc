/**
 * Brand Radar — text / domain / URL normalisation. Pure, no I/O.
 */
import { LIMITS, type CitationOwner } from './types'

/** Remove zero-width characters and NFKC-normalise. */
export function stripInvisible(s: string): string {
  return (s || '').replace(/[​-‍﻿]/g, '').normalize('NFKC')
}

/** Unique key for a competitor / brand name. */
export function nameKey(s: string): string {
  return stripInvisible(s).toLowerCase().trim().replace(/\s+/g, ' ')
}

const MULTI_PART_SUFFIXES = new Set([
  'co.th', 'in.th', 'ac.th', 'go.th', 'or.th', 'mi.th', 'net.th',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.sg', 'com.my', 'co.id', 'com.vn', 'co.in', 'com.hk', 'com.tw', 'com.cn', 'com.br', 'co.kr', 'com.ph',
])

// built at runtime: the project tsconfig target predates the `u` regex flag
const HOST_CHARS_RE = new RegExp('^[\\p{L}\\p{N}.-]+$', 'u')

/** Lowercase host (no www, no port, no credentials) from a host or URL without scheme checks. '' if invalid. */
function extractHost(input: string): string {
  let s = stripInvisible(String(input ?? '')).trim()
  if (!s || /\s/.test(s)) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  s = s.split(/[/?#]/)[0]
  const at = s.lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  s = s.replace(/:\d*$/, '')
  s = s.toLowerCase().replace(/\.+$/, '')
  if (!s || !s.includes('.')) return ''
  if (!HOST_CHARS_RE.test(s)) return ''
  const labels = s.split('.')
  if (labels.some((l) => !l || l.startsWith('-') || l.endsWith('-'))) return ''
  return s.replace(/^www\./, '')
}

export function hostOf(url: string): string {
  return extractHost(url)
}

/** Registrable domain, lowercase. '' when invalid. */
export function normalizeDomain(input: string): string {
  const host = extractHost(input)
  if (!host) return ''
  const labels = host.split('.')
  if (labels.length < 2) return ''
  if (labels.length >= 3 && MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.'))) {
    return labels.slice(-3).join('.')
  }
  return labels.slice(-2).join('.')
}

/** Facebook outbound-link shim (l.facebook.com/l.php?u=...) -> the target URL. One level, http(s) targets only; otherwise input unchanged. */
export function unwrapFacebookRedirect(url: string): string {
  try {
    const raw = String(url ?? '')
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
    const h = u.hostname.toLowerCase()
    if (h !== 'l.facebook.com' && h !== 'lm.facebook.com') return url
    if (u.pathname !== '/l.php' && !u.pathname.startsWith('/l/')) return url
    const target = u.searchParams.get('u')
    if (target && /^https?:\/\/[^\s]+$/i.test(target.trim())) return target.trim()
    return url
  } catch {
    return url
  }
}

const FACEBOOK_ALIAS_HOSTS = new Set(['m.facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'touch.facebook.com'])
const FACEBOOK_LOCALE_HOST_RE = /^[a-z]{2}-[a-z]{2}\.facebook\.com$/

const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'msclkid', 'srsltid', 'ref', 'ref_src'])

/** Canonical form used to de-duplicate citations. null for non-http(s) or invalid input. */
export function normalizeUrl(url: string): string | null {
  let s = unwrapFacebookRedirect(stripInvisible(String(url ?? '')).trim())
  if (!s || /\s/.test(s)) return null
  if (!/^https?:\/\//i.test(s)) {
    // other scheme (mailto:, javascript:, data:, ftp://) — but "host:8080/x" is a port, not a scheme
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null
    s = 'https://' + s.replace(/^\/\//, '')
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  let host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (FACEBOOK_ALIAS_HOSTS.has(host) || FACEBOOK_LOCALE_HOST_RE.test(host)) host = 'facebook.com'
  if (!host || !host.includes('.')) return null
  const params: Array<[string, string]> = []
  u.searchParams.forEach((v, k) => {
    const lk = k.toLowerCase()
    if (lk.startsWith('utm_') || TRACKING_PARAMS.has(lk)) return
    params.push([k, v])
  })
  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
  let path = u.pathname.replace(/\/+$/, '')
  if (path === '/') path = ''
  const query = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : ''
  const port = u.port ? `:${u.port}` : ''
  return (host + port + path + query).slice(0, LIMITS.urlMax)
}

/** True when host equals ownedDomain or is a subdomain of it. */
export function domainMatches(hostOrDomain: string, ownedDomain: string): boolean {
  const h = (extractHost(hostOrDomain) || stripInvisible(hostOrDomain).trim().toLowerCase()).replace(/^www\./, '')
  const o = (extractHost(ownedDomain) || stripInvisible(ownedDomain).trim().toLowerCase()).replace(/^www\./, '')
  if (!h || !o) return false
  return h === o || h.endsWith('.' + o)
}

export function classifyHost(
  host: string,
  ownedDomains: string[],
  competitors: Array<{ id: string; domains: string[] }>,
): { ownerType: CitationOwner; competitorId: string | null } {
  if (ownedDomains.some((d) => domainMatches(host, d))) return { ownerType: 'own', competitorId: null }
  for (const c of competitors) {
    if (c.domains.some((d) => domainMatches(host, d))) return { ownerType: 'competitor', competitorId: c.id }
  }
  return { ownerType: 'external', competitorId: null }
}
