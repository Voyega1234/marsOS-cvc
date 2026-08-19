'use client'

/**
 * SEO News & Update — กระดานข่าว SEO ประจำวันของทีม (เดิมคือ Morning Brief)
 *
 * - สรุปรายวันโดย AI (อ่านเนื้อข่าวจริง) อยู่บนสุด
 * - ข่าวจากสื่อ SEO น่าเชื่อถือ + แหล่งทางการของ Google (Search Central,
 *   Search Status — ที่ประกาศ ranking/spam updates) เป็น card อ่านง่าย
 * - โทนสีตาม CVC Brand CI (brand.blue / brand.navy / brand.mist)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Newspaper, RefreshCw, ExternalLink, Sparkles, Clock } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface NewsItem {
  title: string
  source: string
  url: string
  publishedAt: string
  category: string
  excerpt?: string
}

interface NewsData {
  generatedAt: string
  items: NewsItem[]
  error?: string
}

interface DigestPoint {
  summary: string
  sources: Array<{ title: string; url: string; source: string }>
}

interface NewsDigest {
  dateKey: string
  generatedAt: string
  intro: string
  sections: Array<{ title: string; points: DigestPoint[] }>
  error?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTh(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffHours = diffMs / 3_600_000
  if (diffHours < 1) return 'เมื่อสักครู่'
  if (diffHours < 24) return `${Math.floor(diffHours)} ชม.ที่แล้ว`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} วันที่แล้ว`
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** สีหมวดข่าว — โทนจาก brand + addon palette ของ CVC CI */
const CATEGORY_STYLE: Record<string, string> = {
  'Google Update': 'bg-brand-mist text-brand-blue border-brand-soft/50',
  'AI Search': 'bg-violet-50 text-violet-700 border-violet-200',
  'SEO News': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'เครื่องมือ SEO': 'bg-amber-50 text-amber-700 border-amber-200',
}
const categoryStyle = (c: string) => CATEGORY_STYLE[c] ?? 'bg-gray-50 text-gray-600 border-gray-200'

// ─── News card ──────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-4 hover:border-brand-soft hover:shadow-md hover:shadow-brand-mist transition-all">
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${categoryStyle(item.category)}`}>
          {item.category}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
          <Clock size={9} /> {formatRelativeTh(item.publishedAt)}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-brand-navy leading-5 line-clamp-2 group-hover:text-brand-blue transition-colors">
        {item.title}
      </h3>
      {item.excerpt && (
        <p className="mt-1.5 text-xs text-gray-500 leading-5 line-clamp-3">{item.excerpt}</p>
      )}
      <div className="mt-auto pt-3 flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-gray-400">{item.source}</span>
        <ExternalLink size={10} className="text-gray-300 group-hover:text-brand-blue transition-colors" />
      </div>
    </a>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function SeoNewsPage() {
  const [news, setNews] = useState<NewsData | null>(null)
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState<string | null>(null)
  const [digest, setDigest] = useState<NewsDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(true)
  const [digestError, setDigestError] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('ทั้งหมด')

  const fetchNews = useCallback(async (refresh?: boolean) => {
    setNewsLoading(true)
    setNewsError(null)
    try {
      const res = await fetch(`/api/mars/news${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (data.error) setNewsError(data.error)
      else setNews(data)
    } catch (e: unknown) {
      setNewsError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const fetchDigest = useCallback(async (refresh?: boolean) => {
    setDigestLoading(true)
    setDigestError(null)
    try {
      const res = await fetch(`/api/mars/news/digest${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (data.error) setDigestError(data.error)
      else setDigest(data)
    } catch (e: unknown) {
      setDigestError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setDigestLoading(false)
    }
  }, [])

  useEffect(() => { fetchNews() }, [fetchNews])
  useEffect(() => { fetchDigest() }, [fetchDigest])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of news?.items ?? []) set.add(it.category)
    return ['ทั้งหมด', ...Array.from(set)]
  }, [news])

  const visibleItems = useMemo(() => {
    const items = news?.items ?? []
    return category === 'ทั้งหมด' ? items : items.filter(i => i.category === category)
  }, [news, category])

  const today = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Newspaper size={15} className="text-brand-blue" />
            <span className="text-xs font-semibold text-brand-blue uppercase tracking-wide">SEO News &amp; Update</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{today}</h1>
          <p className="mt-1 text-sm text-gray-500">
            ข่าว SEO จากสื่อน่าเชื่อถือ + แหล่งทางการของ Google (Search Central · Search Status) · อัพเดตทุกวัน
          </p>
        </div>
        <button onClick={() => { fetchDigest(true); fetchNews(true) }}
          disabled={newsLoading || digestLoading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-brand-blue text-white hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0">
          <RefreshCw size={12} className={newsLoading || digestLoading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* ── สรุปวันนี้โดย AI ── */}
      <div className="rounded-2xl border border-brand-soft/40 bg-gradient-to-br from-brand-mist/80 to-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-brand-blue" />
          <h2 className="text-sm font-bold text-brand-navy">สรุปอัพเดตวันนี้</h2>
          {digest && (
            <span className="text-[10px] text-gray-400">สรุปเมื่อ {formatRelativeTh(digest.generatedAt)} · วันละครั้ง</span>
          )}
        </div>

        {digestLoading && !digest && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <RefreshCw size={14} className="animate-spin" /> กำลังอ่านข่าวและสรุปให้ทีม...
          </div>
        )}
        {digestError && !digestLoading && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            ⚠️ สรุปข่าวไม่สำเร็จ: {digestError}
          </div>
        )}
        {digest && (
          <div className="space-y-4">
            {digest.intro && <p className="text-sm text-gray-700 leading-6">{digest.intro}</p>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {digest.sections.map((sec, si) => (
                <div key={si} className="rounded-xl bg-white/70 border border-gray-100 p-4">
                  <h3 className="text-[13px] font-bold text-brand-navy mb-2">{sec.title}</h3>
                  <ul className="space-y-2.5">
                    {sec.points.map((pt, pi) => (
                      <li key={pi} className="text-[13px] text-gray-700 leading-6 pl-3 border-l-2 border-brand-soft/60">
                        {pt.summary}
                        {pt.sources.length > 0 && (
                          <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                            {pt.sources.map((src, li) => (
                              <a key={li} href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand-blue bg-brand-mist border border-brand-soft/40 rounded-full px-1.5 py-0.5 hover:bg-brand-soft/30 transition-colors">
                                {src.source} <ExternalLink size={8} />
                              </a>
                            ))}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── กระดานข่าว ── */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                category === c
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-brand-soft hover:text-brand-blue'
              }`}>
              {c}
            </button>
          ))}
          {news?.items && (
            <span className="ml-auto text-xs text-gray-400">{visibleItems.length} ข่าว</span>
          )}
        </div>

        {newsLoading && !news && (
          <div className="text-center py-14 text-sm text-gray-400">
            <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-gray-300" />
            กำลังโหลดข่าว...
          </div>
        )}
        {newsError && !newsLoading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-amber-700 mb-1">⚠️ โหลดข่าวไม่สำเร็จ</div>
            <div className="text-xs text-amber-600">{newsError}</div>
          </div>
        )}
        {news && !newsError && (
          visibleItems.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">ไม่พบข่าวในหมวดนี้</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleItems.map((item, i) => (
                <NewsCard key={`${item.url}-${i}`} item={item} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
