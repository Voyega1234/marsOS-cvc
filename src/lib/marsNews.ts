/**
 * Mars SEO News — feed aggregator ใช้ร่วมกันระหว่าง
 * /api/mars/news (รายการหัวข้อ) และ /api/mars/news/digest (สรุปรายวัน)
 *
 * Fetches RSS ของสำนักข่าว SEO + Google News โดยตรง ไม่แตะ filesystem
 */

// ─── FEEDS ────────────────────────────────────────────────────────────────

interface Feed {
  id: string
  label: string
  /** RSS URL ตรงของสำนักข่าว SEO — หรือ Google News query (news.google.com) */
  url: string
  /** ตั้งชื่อ source คงที่สำหรับ feed ตรง (Google News มี <source> ในตัว) */
  sourceOverride?: string
}

// ข่าววงการ SEO เท่านั้น: อัลกอริทึม/ฟีเจอร์ Google, เครื่องมือ SEO, AI search
const FEEDS: Feed[] = [
  { id: 'search-engine-land', label: 'SEO News', url: 'https://searchengineland.com/feed', sourceOverride: 'Search Engine Land' },
  { id: 'search-engine-journal', label: 'SEO News', url: 'https://www.searchenginejournal.com/feed/', sourceOverride: 'Search Engine Journal' },
  { id: 'seroundtable', label: 'Google Update', url: 'https://www.seroundtable.com/index.xml', sourceOverride: 'Search Engine Roundtable' },
  { id: 'ahrefs', label: 'เครื่องมือ SEO', url: 'https://ahrefs.com/blog/feed/', sourceOverride: 'Ahrefs Blog' },
  { id: 'semrush', label: 'เครื่องมือ SEO', url: 'https://www.semrush.com/blog/feed/', sourceOverride: 'Semrush Blog' },
  { id: 'gn-google-update', label: 'Google Update', url: 'https://news.google.com/rss/search?q=%22Google%20Search%22%20algorithm%20update&hl=en-US&gl=US&ceid=US:en' },
  { id: 'gn-ai-search', label: 'AI Search', url: 'https://news.google.com/rss/search?q=AI%20search%20SEO%20%22AI%20Overviews%22&hl=en-US&gl=US&ceid=US:en' },
  // แหล่งทางการ + สื่อน่าเชื่อถือเพิ่มเติม (ตรวจ feed แล้ว 2026-08-19)
  { id: 'google-search-central', label: 'Google Update', url: 'https://feeds.feedburner.com/blogspot/amDG', sourceOverride: 'Google Search Central' },
  { id: 'google-search-status', label: 'Google Update', url: 'https://status.search.google.com/en/feed.atom', sourceOverride: 'Google Search Status' },
  { id: 'moz', label: 'SEO News', url: 'https://moz.com/posts/rss/blog', sourceOverride: 'Moz Blog' },
  { id: 'yoast', label: 'เครื่องมือ SEO', url: 'https://yoast.com/feed/', sourceOverride: 'Yoast' },
  { id: 'backlinko', label: 'SEO News', url: 'https://backlinko.com/feed', sourceOverride: 'Backlinko' },
]

const FEED_TIMEOUT_MS = 8000
export const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_ITEMS = 60

export interface NewsItem {
  title: string
  source: string
  url: string
  publishedAt: string
  category: string
  /** เนื้อย่อจาก RSS (ตัด HTML แล้ว) — ใช้ทำสรุปรายวัน ไม่ส่งให้ UI list */
  excerpt?: string
  /** รูปประกอบข่าว (absolute https เท่านั้น) */
  imageUrl?: string
}

export interface MarsNewsResponse {
  generatedAt: string
  items: NewsItem[]
}

// ─── RSS FETCHING ────────────────────────────────────────────────────────

function getTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i')
  return block.match(re)?.[1]?.trim() ?? ''
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
}

/** unescape entities ก่อน → ตัด HTML tag → บีบช่องว่าง */
function cleanFeedText(raw: string, limit = 600): string {
  let t = decodeEntities(raw)
  if (/[<>]/.test(t)) t = decodeEntities(t) // เผื่อ escape ซ้อนสองชั้น
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}

// ─── IMAGE EXTRACTION ───────────────────────────────────────────────────

function getAttr(tag: string, name: string): string {
  const re = new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  return (m?.[1] ?? m?.[2] ?? '').trim()
}

/** รับเฉพาะ absolute https — http อัปเกรดเป็น https, // เติม https:, ตัด data: และ tracking pixel */
function normalizeImageUrl(raw: string): string | undefined {
  let u = decodeEntities(raw).trim()
  if (!u) return undefined
  if (u.startsWith('//')) u = `https:${u}`
  else if (/^http:\/\//i.test(u)) u = `https://${u.slice(7)}`
  if (!/^https:\/\//i.test(u)) return undefined
  try { new URL(u) } catch { return undefined }
  if (/feedburner|pixel|gravatar|\/emoji\//i.test(u)) return undefined
  return u
}

function firstImgFromHtml(html: string): string | undefined {
  if (!html) return undefined
  let t = decodeEntities(html)
  if (!/<img\b/i.test(t)) t = decodeEntities(t)
  for (const tag of t.match(/<img\b[^>]*>/gi) ?? []) {
    const w = getAttr(tag, 'width')
    const h = getAttr(tag, 'height')
    if (w === '1' || h === '1') continue
    const src = normalizeImageUrl(getAttr(tag, 'src') || getAttr(tag, 'data-src'))
    if (src) return src
  }
  return undefined
}

/** ดึงรูปจาก RSS item / Atom entry block ตามลำดับความสำคัญ */
export function extractFeedImage(block: string): string | undefined {
  for (const tag of block.match(/<media:content\b[^>]*>/gi) ?? []) {
    const type = getAttr(tag, 'type').toLowerCase()
    const medium = getAttr(tag, 'medium').toLowerCase()
    if (type && !type.startsWith('image')) continue
    if (medium && medium !== 'image') continue
    const u = normalizeImageUrl(getAttr(tag, 'url'))
    if (u) return u
  }
  for (const tag of block.match(/<media:thumbnail\b[^>]*>/gi) ?? []) {
    const u = normalizeImageUrl(getAttr(tag, 'url'))
    if (u) return u
  }
  for (const tag of block.match(/<enclosure\b[^>]*>/gi) ?? []) {
    if (!getAttr(tag, 'type').toLowerCase().startsWith('image/')) continue
    const u = normalizeImageUrl(getAttr(tag, 'url'))
    if (u) return u
  }
  for (const tag of block.match(/<link\b[^>]*>/gi) ?? []) {
    if (getAttr(tag, 'rel').toLowerCase() !== 'enclosure') continue
    if (!getAttr(tag, 'type').toLowerCase().startsWith('image/')) continue
    const u = normalizeImageUrl(getAttr(tag, 'href'))
    if (u) return u
  }
  for (const name of ['content:encoded', 'description', 'content', 'summary']) {
    const u = firstImgFromHtml(getTag(block, name))
    if (u) return u
  }
  return undefined
}

/** อ่าน og:image / twitter:image จาก HTML ของหน้าข่าว */
export function extractMetaImage(html: string): string | undefined {
  const found: Record<string, string> = {}
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (getAttr(tag, 'property') || getAttr(tag, 'name')).toLowerCase()
    if (key !== 'og:image' && key !== 'og:image:secure_url' && key !== 'twitter:image') continue
    const content = getAttr(tag, 'content')
    if (content && !found[key]) found[key] = content
  }
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image']) {
    const u = found[key] ? normalizeImageUrl(found[key]) : undefined
    if (u) return u
  }
  return undefined
}

const OG_TIMEOUT_MS = 3500
const OG_MAX_BYTES = 150 * 1024
const OG_MAX_ITEMS = 18

async function fetchOgImage(articleUrl: string): Promise<string | undefined> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OG_TIMEOUT_MS)
  try {
    const u = new URL(articleUrl)
    if (u.protocol !== 'https:' || u.hostname === 'news.google.com') return undefined
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok || !res.body) return undefined
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    let bytes = 0
    while (bytes < OG_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      bytes += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (/<\/head>/i.test(html)) break
    }
    reader.cancel().catch(() => {})
    return extractMetaImage(html)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function parseRssItems(xml: string, category: string, sourceOverride?: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []

  for (const block of itemBlocks) {
    const title = cleanFeedText(getTag(block, 'title'), 300)
    if (!title) continue

    const linkFallback = block.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() ?? ''
    const url = getTag(block, 'link') || linkFallback
    const pubDate = getTag(block, 'pubDate')
    const source = sourceOverride || getTag(block, 'source') || 'Google News'
    const excerpt = cleanFeedText(getTag(block, 'description') || getTag(block, 'content:encoded'))

    let publishedAt = new Date().toISOString()
    if (pubDate) {
      const parsed = new Date(pubDate)
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
    }

    const imageUrl = extractFeedImage(block)
    items.push({ title, source, url, publishedAt, category, ...(excerpt ? { excerpt } : {}), ...(imageUrl ? { imageUrl } : {}) })
  }
  return items
}

function parseAtomEntries(xml: string, category: string, sourceOverride?: string): NewsItem[] {
  const items: NewsItem[] = []
  const blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? []
  for (const block of blocks) {
    const title = cleanFeedText(getTag(block, 'title'), 300)
    if (!title) continue
    const url = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>(?:<\/link>)?/i)?.[1] ?? ''
    const when = getTag(block, 'published') || getTag(block, 'updated')
    const excerpt = cleanFeedText(getTag(block, 'summary') || getTag(block, 'content'))
    let publishedAt = new Date().toISOString()
    if (when) {
      const parsed = new Date(when)
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
    }
    const imageUrl = extractFeedImage(block)
    items.push({ title, source: sourceOverride || 'Atom', url, publishedAt, category, ...(excerpt ? { excerpt } : {}), ...(imageUrl ? { imageUrl } : {}) })
  }
  return items
}

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  try {
    const url = feed.url
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const rss = parseRssItems(xml, feed.label, feed.sourceOverride)
    const parsed = rss.length > 0 ? rss : parseAtomEntries(xml, feed.label, feed.sourceOverride)
    return parsed.slice(0, 8)
  } catch {
    return []
  }
}

export async function buildNewsResponse(opts?: { withImages?: boolean }): Promise<MarsNewsResponse> {
  const results = await Promise.all(FEEDS.map(fetchFeed))
  const all = results.flat()

  // Dedupe by normalized title
  const seen = new Set<string>()
  const deduped = all.filter(item => {
    const key = item.title.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  deduped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  const items = deduped.slice(0, MAX_ITEMS)

  if (opts?.withImages) {
    // fallback: og:image จากหน้าข่าว (เฉพาะ 18 ชิ้นใหม่สุดที่ยังไม่มีรูป, ข้าม Google News)
    const missing = items.filter(i => !i.imageUrl).slice(0, OG_MAX_ITEMS)
    await Promise.all(missing.map(async item => {
      const img = await fetchOgImage(item.url)
      if (img) item.imageUrl = img
    }))
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
  }
}

