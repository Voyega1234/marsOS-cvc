/**
 * siteCrawler — lightweight site intelligence for keyword research.
 * 1. Fetch & parse sitemap.xml (or sitemap_index.xml) → list of URLs
 * 2. Scrape key pages (home, about, services, contact) → business context text
 * All functions are non-throwing: return empty on error.
 */

const FETCH_TIMEOUT_MS = 10_000
const MAX_SITEMAP_URLS = 300
const MAX_PAGES_TO_SCRAPE = 6

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeOrigin(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.origin // e.g. https://example.com
  } catch {
    return ''
  }
}

async function safeFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarsOS-Crawler/1.0)' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// Strip HTML tags, collapse whitespace
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

// ─── sitemap parser ───────────────────────────────────────────────────────────

function extractUrlsFromXml(xml: string): string[] {
  const urls: string[] = []
  // <loc> tags
  const locRe = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = locRe.exec(xml)) !== null && urls.length < MAX_SITEMAP_URLS) {
    urls.push(m[1].trim())
  }
  return urls
}

function extractSitemapIndexUrls(xml: string): string[] {
  // <sitemap><loc>...</loc></sitemap>
  return extractUrlsFromXml(xml).filter(u => u.endsWith('.xml'))
}

export async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const origin = normalizeOrigin(siteUrl)
  if (!origin) return []

  // Try common sitemap locations
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap/`,
    `${origin}/post-sitemap.xml`,
  ]

  for (const candidate of candidates) {
    const xml = await safeFetch(candidate)
    if (!xml || !xml.includes('<loc>')) continue

    // Sitemap index? recursively fetch sub-sitemaps
    if (xml.includes('<sitemapindex') || xml.includes('<sitemap>')) {
      const subUrls = extractSitemapIndexUrls(xml)
      const all: string[] = []
      for (const sub of subUrls.slice(0, 5)) {
        const subXml = await safeFetch(sub)
        if (subXml) all.push(...extractUrlsFromXml(subXml))
        if (all.length >= MAX_SITEMAP_URLS) break
      }
      if (all.length > 0) return all.slice(0, MAX_SITEMAP_URLS)
    }

    const urls = extractUrlsFromXml(xml)
    if (urls.length > 0) return urls
  }

  return []
}

// ─── business context scraper ─────────────────────────────────────────────────

const KEY_PAGE_SLUGS = [
  '', // home
  'about', 'about-us', 'เกี่ยวกับเรา',
  'services', 'service', 'บริการ',
  'products', 'product',
  'contact', 'contact-us', 'ติดต่อ',
]

export interface BusinessContext {
  origin: string
  sitemapUrlCount: number
  sitemapUrlSamples: string[]   // up to 30 URL paths (no origin) for Gemini
  pageTexts: { slug: string; text: string }[]
  existingKeywords: string[]    // derived from URL slugs
}

export async function scrapeBusinessContext(siteUrl: string, sitemapUrls: string[]): Promise<BusinessContext> {
  const origin = normalizeOrigin(siteUrl)
  const result: BusinessContext = {
    origin,
    sitemapUrlCount: sitemapUrls.length,
    sitemapUrlSamples: [],
    pageTexts: [],
    existingKeywords: [],
  }

  if (!origin) return result

  // Extract slug paths from sitemap for Gemini context
  result.sitemapUrlSamples = sitemapUrls
    .map(u => {
      try {
        return new URL(u).pathname
      } catch {
        return null
      }
    })
    .filter((p): p is string => !!p && p !== '/')
    .slice(0, 30)

  // Derive existing keywords from URL slugs (hyphens → spaces)
  result.existingKeywords = result.sitemapUrlSamples
    .map(p => p.replace(/\/$/, '').split('/').pop() ?? '')
    .filter(Boolean)
    .map(slug => slug.replace(/-/g, ' '))
    .filter(kw => kw.length > 3 && kw.length < 60)
    .slice(0, 50)

  // Scrape key pages for business context text
  const scraped: { slug: string; text: string }[] = []
  let pageCount = 0

  for (const slug of KEY_PAGE_SLUGS) {
    if (pageCount >= MAX_PAGES_TO_SCRAPE) break
    const url = slug ? `${origin}/${slug}` : `${origin}/`
    const html = await safeFetch(url)
    if (!html) continue
    const text = stripHtml(html)
    if (text.length < 100) continue
    scraped.push({ slug: slug || 'home', text })
    pageCount++
  }

  result.pageTexts = scraped
  return result
}

// ─── format context for Gemini prompt ────────────────────────────────────────

export function formatBusinessContextForPrompt(ctx: BusinessContext): string {
  if (!ctx.origin) return ''

  const parts: string[] = []

  if (ctx.sitemapUrlCount > 0) {
    parts.push(`### Website Structure (from sitemap: ${ctx.sitemapUrlCount} pages total)`)
    if (ctx.sitemapUrlSamples.length > 0) {
      parts.push('Page paths found:')
      parts.push(ctx.sitemapUrlSamples.map(p => `- ${p}`).join('\n'))
    }
    if (ctx.existingKeywords.length > 0) {
      parts.push(`\nExisting content topics (derived from URLs — do NOT duplicate these exactly):`)
      parts.push(ctx.existingKeywords.map(k => `- ${k}`).join('\n'))
    }
  }

  if (ctx.pageTexts.length > 0) {
    parts.push('\n### Business Context (scraped from website)')
    for (const page of ctx.pageTexts) {
      parts.push(`\n**${page.slug}:**\n${page.text.slice(0, 600)}`)
    }
  }

  if (parts.length === 0) return ''

  return `
## WEBSITE INTELLIGENCE
Use the following website data to understand the business deeply and generate keywords that cover gaps and opportunities:

${parts.join('\n')}

### Instructions for using this context:
1. Understand what services/products the business actually offers from the page texts
2. Use sitemap URL paths to identify topics already covered — generate keywords to FILL GAPS, not duplicate
3. Derive the target audience, pain points, and buying journey from the business context
4. Generate keywords that a real customer of THIS specific business would search for
`
}
