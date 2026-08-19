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

    items.push({ title, source, url, publishedAt, category, ...(excerpt ? { excerpt } : {}) })
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
    items.push({ title, source: sourceOverride || 'Atom', url, publishedAt, category, ...(excerpt ? { excerpt } : {}) })
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

export async function buildNewsResponse(): Promise<MarsNewsResponse> {
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

  return {
    generatedAt: new Date().toISOString(),
    items: deduped.slice(0, MAX_ITEMS),
  }
}

