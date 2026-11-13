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
import { RefreshCw, ExternalLink, Sparkles, Newspaper } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface NewsItem {
  title: string
  source: string
  url: string
  publishedAt: string
  category: string
  excerpt?: string
  imageUrl?: string
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

/** ตัดหาง "via @บัญชี, @บัญชี" ที่บาง feed แปะท้ายหัวข้อ — เฉพาะตอนแสดงผล ข้อมูลข่าวไม่ถูกแก้ */
const displayTitle = (t: string) => t.replace(/\s+via\s+@[\w.]+(?:\s*,\s*@[\w.]+)*\s*$/i, '') || t

// ─── Image ──────────────────────────────────────────────────────────────────

/** รูปข่าว — โหลดไม่ได้/ไม่มีรูป = กล่องไล่สีตามหมวด */
function NewsImage({ item, className }: { item: NewsItem; className: string }) {
  const [failed, setFailed] = useState(false)
  if (item.imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${className} object-cover bg-brand-mist`} />
    )
  }
  const initial = item.source.trim().charAt(0).toUpperCase()
  return (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-brand-mist to-brand-gray border ${categoryStyle(item.category)}`}>
      {initial ? <span className="font-serif text-2xl font-bold opacity-70">{initial}</span> : <Newspaper size={20} className="opacity-60" />}
    </div>
  )
}

const LINK_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded-sm'

function Kicker({ category }: { category: string }) {
  return <span className="text-[10px] font-bold uppercase tracking-widest text-brand-blue">{category}</span>
}

function Byline({ item }: { item: NewsItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
      <span className="font-medium">{item.source}</span>
      <span aria-hidden>·</span>
      <span>{formatRelativeTh(item.publishedAt)}</span>
      <ExternalLink size={10} className="text-gray-300" aria-hidden />
    </div>
  )
}

// ─── Stories ────────────────────────────────────────────────────────────────

function LeadStory({ item }: { item: NewsItem }) {
  return (
    <article className="group rounded-3xl border border-white/80 bg-white/70 backdrop-blur p-4 sm:p-5 shadow-sm">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className={`block ${LINK_FOCUS}`}>
        <NewsImage item={item} className="w-full aspect-video rounded-2xl" />
        <div className="mt-4"><Kicker category={item.category} /></div>
        <h2 className="mt-1.5 font-serif text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight text-brand-navy group-hover:text-brand-blue transition-colors">
          {displayTitle(item.title)}
        </h2>
      </a>
      {item.excerpt && <p className="mt-3 text-sm sm:text-base text-gray-600 leading-6 sm:leading-7 line-clamp-4">{item.excerpt}</p>}
      <div className="mt-3"><Byline item={item} /></div>
    </article>
  )
}

function SecondaryStory({ item }: { item: NewsItem }) {
  return (
    <article className="group flex flex-col rounded-2xl border border-white/80 bg-white/70 backdrop-blur p-3 shadow-sm">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className={`block ${LINK_FOCUS}`}>
        <NewsImage item={item} className="w-full aspect-[3/2] rounded-xl" />
        <div className="mt-3"><Kicker category={item.category} /></div>
        <h3 className="mt-1 font-serif text-lg font-bold leading-snug text-brand-navy group-hover:text-brand-blue transition-colors line-clamp-3">
          {displayTitle(item.title)}
        </h3>
      </a>
      {item.excerpt && <p className="mt-1.5 text-xs text-gray-500 leading-5 line-clamp-2">{item.excerpt}</p>}
      <div className="mt-auto pt-2"><Byline item={item} /></div>
    </article>
  )
}

function BriefRow({ item }: { item: NewsItem }) {
  return (
    <article className="group py-3 border-b border-gray-200/60 last:border-b-0">
      <div className="flex gap-3">
        <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="shrink-0">
          <NewsImage item={item} className="w-24 h-[72px] rounded-xl" />
        </a>
        <div className="min-w-0">
          <Kicker category={item.category} />
          <h3 className="mt-0.5 font-serif text-sm sm:text-base font-bold leading-snug text-brand-navy group-hover:text-brand-blue transition-colors line-clamp-3">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={LINK_FOCUS}>{displayTitle(item.title)}</a>
          </h3>
          <div className="mt-1"><Byline item={item} /></div>
        </div>
      </div>
    </article>
  )
}

function StoriesSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-pulse" aria-hidden>
      <div className="lg:col-span-8 space-y-3 rounded-3xl border border-white/80 bg-white/70 p-5">
        <div className="w-full aspect-video rounded-2xl bg-brand-mist" />
        <div className="h-3 w-24 rounded bg-brand-mist" />
        <div className="h-8 w-5/6 rounded bg-brand-mist" />
        <div className="h-4 w-full rounded bg-brand-mist" />
        <div className="h-4 w-2/3 rounded bg-brand-mist" />
      </div>
      <div className="lg:col-span-4 space-y-3 rounded-3xl border border-white/80 bg-white/70 p-5">
        <div className="h-4 w-1/2 rounded bg-brand-mist" />
        <div className="h-3 w-full rounded bg-brand-mist" />
        <div className="h-3 w-5/6 rounded bg-brand-mist" />
        <div className="h-3 w-full rounded bg-brand-mist" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="lg:col-span-4 sm:col-span-1 space-y-2 rounded-2xl border border-white/80 bg-white/70 p-3">
          <div className="w-full aspect-[3/2] rounded-xl bg-brand-mist" />
          <div className="h-5 w-5/6 rounded bg-brand-mist" />
          <div className="h-3 w-full rounded bg-brand-mist" />
        </div>
      ))}
    </div>
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

  // lead = ข่าวแรกที่มีรูป (ไม่มีเลยใช้ข่าวแรก) · รอง 3 ชิ้น · ที่เหลือเป็น "ข่าวล่าสุด"
  const { lead, secondary, latest } = useMemo(() => {
    const leadItem = visibleItems.find(i => i.imageUrl) ?? visibleItems[0]
    const rest = visibleItems.filter(i => i !== leadItem)
    return { lead: leadItem, secondary: rest.slice(0, 3), latest: rest.slice(3) }
  }, [visibleItems])

  const today = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Masthead ── */}
      <header>
        <div className="border-t border-brand-navy/70 pt-[3px]">
          <div className="border-t border-brand-navy/70" />
        </div>
        <div className="py-4 sm:py-5 text-center">
          <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-brand-navy">
            SEO News &amp; Update
          </h1>
          <p className="mt-1.5 text-[11px] sm:text-xs text-gray-500">
            ข่าว SEO จากสื่อน่าเชื่อถือ + แหล่งทางการของ Google (Search Central · Search Status) · อัพเดตทุกวัน
          </p>
        </div>
        <div className="border-t border-brand-navy/70 pt-[3px]">
          <div className="border-t border-brand-navy/70" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2.5 text-xs text-gray-500">
          <span className="font-medium text-brand-navy">{today}</span>
          <span className="sm:text-center">
            ฉบับประจำวัน{news ? ` · อัปเดตล่าสุด ${formatRelativeTh(news.generatedAt)}` : ''}
          </span>
          <button onClick={() => { fetchDigest(true); fetchNews(true) }}
            disabled={newsLoading || digestLoading}
            className="flex items-center gap-1.5 self-start sm:self-auto px-4 py-2 rounded-full text-xs font-semibold bg-brand-blue text-white hover:bg-brand-deep disabled:opacity-50 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">
            <RefreshCw size={12} className={newsLoading || digestLoading ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
        </div>

        {/* ── Section bar ── */}
        <nav aria-label="หมวดข่าว" className="border-y border-gray-200/80 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              aria-current={category === c ? 'true' : undefined}
              className={`shrink-0 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
                category === c
                  ? 'text-brand-navy border-brand-navy'
                  : 'text-gray-500 border-transparent hover:text-brand-blue'
              }`}>
              {c}
            </button>
          ))}
          {news?.items && (
            <span className="ml-auto pl-3 shrink-0 text-xs text-gray-400">{visibleItems.length} ข่าว</span>
          )}
        </nav>
      </header>

      {/* ── Front page ── */}
      {newsLoading && !news && <StoriesSkeleton />}
      {newsError && !newsLoading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-amber-700 mb-1">⚠️ โหลดข่าวไม่สำเร็จ</div>
          <div className="text-xs text-amber-600">{newsError}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_auto_1fr] items-start gap-5">
        {/* Lead story */}
        {news && !newsError && (
          visibleItems.length === 0 ? (
            <div className="lg:col-span-8 text-center py-10 text-sm text-gray-400">ไม่พบข่าวในหมวดนี้</div>
          ) : lead && (
            <div className="order-1 lg:col-span-8"><LeadStory item={lead} /></div>
          )
        )}

        {/* ── สรุปวันนี้โดย AI (right rail) ── */}
        <aside className={`order-2 ${news && !newsError ? 'lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:row-span-3 lg:sticky lg:top-4' : 'lg:col-span-12'}`}>
          <div className={`glass-strong rounded-3xl p-5 ${news && !newsError ? 'lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto' : ''}`}>
            <div className="flex flex-wrap items-center gap-2 pb-2 mb-3 border-b border-brand-navy/30">
              <Sparkles size={14} className="text-brand-blue" />
              <h2 className="font-serif text-lg font-bold text-brand-navy">สรุปประจำวันโดย AI</h2>
              <span className="w-full text-[11px] font-bold uppercase tracking-widest text-gray-500">สรุปอัพเดตวันนี้</span>
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
                {digest.intro && <p className="font-serif text-base text-gray-700 leading-7">{digest.intro}</p>}
                <div className="space-y-4">
                  {digest.sections.map((sec, si) => (
                    <section key={si} className="border-t border-gray-200/80 pt-3">
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-brand-navy mb-2">{sec.title}</h3>
                      <ul className="space-y-2.5">
                        {sec.points.map((pt, pi) => (
                          <li key={pi} className="text-[13px] text-gray-700 leading-6 pl-3 border-l-2 border-brand-soft/60">
                            {pt.summary}
                            {pt.sources.length > 0 && (
                              <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                                {pt.sources.map((src, li) => (
                                  <a key={li} href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand-blue bg-brand-mist border border-brand-soft/40 rounded-full px-1.5 py-0.5 hover:bg-brand-soft/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
                                    {src.source} <ExternalLink size={8} />
                                  </a>
                                ))}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Secondary stories */}
        {news && !newsError && secondary.length > 0 && (
          <div className="order-3 lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {secondary.map((item, i) => (
              <SecondaryStory key={`${item.url}-${i}`} item={item} />
            ))}
          </div>
        )}

        {/* ── ข่าวล่าสุด (คอลัมน์ซ้าย ต่อจากข่าวรอง) ── */}
        {news && !newsError && latest.length > 0 && (
          <section className="order-4 lg:col-span-8">
            <div className="border-y border-brand-navy/40 py-1.5 mb-3">
              <h2 className="font-serif text-lg font-bold text-brand-navy">ข่าวล่าสุด</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {latest.map((item, i) => (
                <div key={`${item.url}-${i}`} className="border-gray-200/80 sm:[&:nth-child(odd)]:pr-4 sm:[&:nth-child(even)]:border-l sm:[&:nth-child(even)]:pl-4">
                  <BriefRow item={item} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
