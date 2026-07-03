/**
 * Mars SEO News Intelligence — Native Next.js generator
 * Replaces Python mars-seo-intelligence-free-trends/run_morning.py
 *
 * Sources:
 *   - Google News RSS per category keyword
 *   - Google Trends Daily RSS (TH) — replaces pytrends
 *
 * Output: ~/Desktop/Mars/mars-seo-intelligence-free-trends/data/reports/json/{date}/category_news_intelligence.json
 * (same path the existing /api/mars/news route reads from)
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as https from 'https'

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const MARS_DATA_ROOT = process.env.MARS_DATA_ROOT
  ?? path.join(os.tmpdir(), 'mars-seo-intelligence', 'data', 'reports', 'json')

const HIGH_RISK = new Set([
  'health', 'financial_services', 'fintech', 'travel_transportation', 'baby_kids_maternity'
])

const HOT_WORDS = [
  'viral', 'trending', 'กำลังฮิต', 'กระแส', 'ดัง', 'hot', 'breakout',
  'popular', 'ยอดนิยม', 'แชร์เยอะ', 'โด่งดัง',
]
const SEO_WORDS = [
  'search', 'keyword', 'ค้นหา', 'seo', 'google', 'rank', 'trend', 'volume',
]
const BRAND_VERBS = [
  'launches', 'announces', 'releases', 'unveils', 'introduces', 'updates',
  'ประกาศ', 'เปิดตัว', 'ออก', 'อัพเดต', 'วาง', 'จำหน่าย',
]
const KEEP_SIGNALS = [
  'recall', 'scandal', 'lawsuit', 'ban', 'regulation', 'safety', 'alert',
  'กฎหมาย', 'ถูกแบน', 'เรียกคืน', 'อันตราย', 'ฉาว',
]

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

interface Category {
  id: string
  emoji: string
  name_en: string
  name_th: string
  risk_level: 'normal' | 'medium' | 'high'
  news_keywords: string[]
  trend_keywords: string[]
  suitable_business_types: string[]
}

const CATEGORIES: Category[] = [
  {
    id: 'beauty_personal_care', emoji: '🌸',
    name_en: 'Beauty & Personal Care', name_th: 'ความงามและการดูแลส่วนบุคคล',
    risk_level: 'normal',
    news_keywords: ['skincare trend', 'sunscreen sensitive skin', 'skin barrier', 'anti aging skincare', 'acne skincare', 'ครีมกันแดดผิวแพ้ง่าย', 'สกินแคร์ผิวแพ้ง่าย'],
    trend_keywords: ['skincare trend', 'sunscreen sensitive skin', 'skin barrier', 'anti aging skincare'],
    suitable_business_types: ['beauty_ecommerce', 'skincare_brand', 'cosmetics_retail'],
  },
  {
    id: 'food_beverage', emoji: '🍽',
    name_en: 'Food & Beverage', name_th: 'อาหารและเครื่องดื่ม',
    risk_level: 'normal',
    news_keywords: ['functional drink', 'low sugar drink', 'protein drink', 'healthy food trend', 'plant based food', 'เครื่องดื่มสุขภาพ', 'โปรตีนพร้อมดื่ม'],
    trend_keywords: ['functional drink', 'low sugar drink', 'protein drink', 'healthy food trend'],
    suitable_business_types: ['fnb_brand', 'beverage_ecommerce', 'healthy_food_retail'],
  },
  {
    id: 'baby_kids_maternity', emoji: '🍼',
    name_en: 'Baby, Kids & Maternity', name_th: 'ผลิตภัณฑ์สำหรับเด็กและคุณแม่',
    risk_level: 'high',
    news_keywords: ['baby product safety', 'baby formula', 'maternity product', 'diaper rash', 'ของใช้เด็ก', 'คุณแม่ตั้งครรภ์'],
    trend_keywords: ['baby product safety', 'baby formula', 'maternity product', 'diaper rash'],
    suitable_business_types: ['baby_product_ecommerce', 'maternity_brand'],
  },
  {
    id: 'household_products', emoji: '🧼',
    name_en: 'Household Products', name_th: 'สินค้าในครัวเรือน',
    risk_level: 'normal',
    news_keywords: ['cleaning product', 'laundry detergent sensitive skin', 'home cleaning trend', 'air freshener', 'น้ำยาซักผ้า', 'น้ำยาทำความสะอาด'],
    trend_keywords: ['cleaning product', 'laundry detergent sensitive skin', 'home cleaning trend', 'air freshener'],
    suitable_business_types: ['household_goods_ecommerce', 'cleaning_brand'],
  },
  {
    id: 'consumer_electronics', emoji: '💻',
    name_en: 'Consumer Electronics', name_th: 'โทรศัพท์ คอมพิวเตอร์',
    risk_level: 'normal',
    news_keywords: ['AI phone', 'smartphone launch', 'laptop launch', 'gaming laptop', 'tablet', 'มือถือ AI', 'โน้ตบุ๊ก AI'],
    trend_keywords: ['AI phone', 'smartphone launch', 'laptop launch', 'gaming laptop'],
    suitable_business_types: ['consumer_electronics_retail', 'ecommerce_computer_parts'],
  },
  {
    id: 'games', emoji: '🎮',
    name_en: 'Games', name_th: 'เกมเล่นคนเดียวและเกมเล่นหลายคน',
    risk_level: 'normal',
    news_keywords: ['mobile game trend', 'multiplayer game', 'PC game release', 'console game', 'เกมมือถือ', 'เกมออนไลน์'],
    trend_keywords: ['mobile game trend', 'multiplayer game', 'PC game release', 'console game'],
    suitable_business_types: ['gaming_pc_retail', 'esports_content'],
  },
  {
    id: 'health', emoji: '🏥',
    name_en: 'Health', name_th: 'บริการดูแลสุขภาพ เครื่องมือทางการแพทย์',
    risk_level: 'high',
    news_keywords: ['healthcare trend', 'medical device', 'telemedicine', 'health screening', 'ตรวจสุขภาพ', 'เครื่องมือแพทย์'],
    trend_keywords: ['healthcare trend', 'medical device', 'telemedicine', 'health screening'],
    suitable_business_types: ['healthcare_provider', 'medical_device_retail', 'wellness_clinic'],
  },
  {
    id: 'home_improvement', emoji: '🏡',
    name_en: 'Home Improvement', name_th: 'เฟอร์นิเจอร์ เครื่องใช้ภายในบ้าน',
    risk_level: 'normal',
    news_keywords: ['furniture trend', 'home appliance', 'interior design small condo', 'construction material', 'เฟอร์นิเจอร์', 'แต่งคอนโด'],
    trend_keywords: ['furniture trend', 'home appliance', 'interior design small condo', 'construction material'],
    suitable_business_types: ['furniture_ecommerce', 'home_appliance_retail'],
  },
  {
    id: 'education', emoji: '🎓',
    name_en: 'Education', name_th: 'บริการด้านการศึกษาและการฝึกอบรม',
    risk_level: 'normal',
    news_keywords: ['online course', 'AI education', 'upskill reskill', 'language school', 'เรียนออนไลน์', 'คอร์ส AI'],
    trend_keywords: ['online course', 'AI education', 'upskill reskill', 'language school'],
    suitable_business_types: ['online_course_provider', 'education_consulting'],
  },
  {
    id: 'financial_services', emoji: '💰',
    name_en: 'Financial Services', name_th: 'ผลิตภัณฑ์และบริการทางการเงิน',
    risk_level: 'high',
    news_keywords: ['credit card', 'insurance', 'personal loan', 'investment', 'interest rate', 'บัตรเครดิต', 'ประกัน', 'สินเชื่อ'],
    trend_keywords: ['credit card', 'insurance', 'personal loan', 'investment'],
    suitable_business_types: ['bank_or_insurer', 'loan_broker', 'fintech_finance_content'],
  },
  {
    id: 'app_software_websites', emoji: '🧩',
    name_en: 'App, Software & Websites', name_th: 'บริการซอฟต์แวร์ แอปพลิเคชัน เว็บไซต์',
    risk_level: 'normal',
    news_keywords: ['SaaS trend', 'AI tools business', 'CRM software', 'website builder', 'mobile app', 'ซอฟต์แวร์ AI', 'แอปธุรกิจ'],
    trend_keywords: ['SaaS trend', 'AI tools business', 'CRM software', 'website builder'],
    suitable_business_types: ['saas_business', 'software_agency', 'web_development_agency'],
  },
  {
    id: 'pets', emoji: '🐶',
    name_en: 'Pets', name_th: 'อาหารสัตว์ ของเล่น อุปกรณ์ และบริการสัตวแพทย์',
    risk_level: 'medium' as 'medium',
    news_keywords: ['pet food', 'cat food urinary', 'dog food', 'veterinary', 'pet care', 'อาหารแมว', 'อาหารสุนัข'],
    trend_keywords: ['pet food', 'cat food urinary', 'dog food', 'veterinary'],
    suitable_business_types: ['pet_food_ecommerce', 'veterinary_clinic'],
  },
  {
    id: 'business_services', emoji: '🏢',
    name_en: 'Business Services', name_th: 'บริการแก่ธุรกิจอื่น',
    risk_level: 'medium' as 'medium',
    news_keywords: ['business consulting', 'legal service business', 'accounting service', 'real estate business', 'SME consulting', 'ที่ปรึกษาธุรกิจ', 'สำนักงานบัญชี'],
    trend_keywords: ['business consulting', 'legal service business', 'accounting service', 'real estate business'],
    suitable_business_types: ['business_consulting', 'accounting_firm', 'legal_service'],
  },
  {
    id: 'travel_transportation', emoji: '✈️',
    name_en: 'Travel & Transportation', name_th: 'บริษัททัวร์ ที่พัก และโรงแรม',
    risk_level: 'medium' as 'medium',
    news_keywords: ['travel trend', 'hotel booking', 'airline news', 'visa update', 'tour package', 'เที่ยวต่างประเทศ', 'ตั๋วเครื่องบิน'],
    trend_keywords: ['travel trend', 'hotel booking', 'airline news', 'visa update'],
    suitable_business_types: ['travel_agency', 'hotel_or_tour_operator'],
  },
  {
    id: 'vehicles', emoji: '🚗',
    name_en: 'Vehicles', name_th: 'การผลิต การขาย การขายต่อ การบำรุงรักษา',
    risk_level: 'medium' as 'medium',
    news_keywords: ['EV car', 'used car', 'car insurance', 'car maintenance', 'auto parts', 'รถ EV', 'รถมือสอง', 'ประกันรถยนต์'],
    trend_keywords: ['EV car', 'used car', 'car insurance', 'car maintenance'],
    suitable_business_types: ['car_dealer', 'auto_parts_retail', 'car_insurance'],
  },
  {
    id: 'fintech', emoji: '🏦',
    name_en: 'Fintech', name_th: 'บริการทางการเงินรูปแบบใหม่',
    risk_level: 'high',
    news_keywords: ['fintech', 'digital wallet', 'payment app', 'online loan', 'buy now pay later', 'วอลเล็ต', 'แอปการเงิน', 'สินเชื่อดิจิทัล'],
    trend_keywords: ['fintech', 'digital wallet', 'payment app', 'online loan'],
    suitable_business_types: ['digital_wallet_provider', 'fintech_lending'],
  },
]

const SEO_UPDATES_CATEGORY = {
  id: 'seo_updates', emoji: '🔍',
  name_en: 'SEO Updates', name_th: 'อัปเดต Google Search / SEO',
  news_keywords: ['Google core update', 'Google Search Central announcement', 'AI Overview SEO', 'Google spam policy update', 'core update', 'AI Overview', 'structured data', 'indexing', 'spam policy'],
  trend_keywords: ['core update', 'AI Overview', 'Google algorithm'],
}

// ─── RSS FETCHING ─────────────────────────────────────────────────────────────

interface NewsItem {
  title: string
  link: string
  pubDate: string
  source: string
  ageHours: number
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    }
    const req = https.request(options, (res) => {
      // Follow redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpsGet(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.end()
  })
}

function parseRssItems(xml: string, sourceLabel: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []

  for (const block of itemBlocks) {
    const getTag = (tag: string) => {
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i')
      const m = block.match(re)
      return m?.[1]?.trim() ?? ''
    }
    const title = getTag('title')
    const linkFallback = block.match(/<link>(.*?)<\/link>/i)?.[1]?.trim() ?? ''
    const link  = getTag('link') || linkFallback
    const pubDate = getTag('pubDate')

    if (!title) continue

    let ageHours = 48
    if (pubDate) {
      try {
        const pub = new Date(pubDate)
        ageHours = (Date.now() - pub.getTime()) / 3_600_000
      } catch { /* use default */ }
    }

    items.push({ title, link, pubDate, source: sourceLabel, ageHours })
  }
  return items
}

async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`
  try {
    const xml = await httpsGet(url)
    return parseRssItems(xml, 'Google News')
  } catch {
    return []
  }
}

async function fetchTrendingKeywordsTH(): Promise<string[]> {
  try {
    const xml = await httpsGet('https://trends.google.com/trending/rss?geo=TH')
    const titleMatches: string[] = []
    const re = /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) titleMatches.push(m[1].trim().toLowerCase())
    return titleMatches.filter(t => t.length > 2 && !t.startsWith('google') && !t.startsWith('daily search'))
  } catch {
    return []
  }
}

// ─── SCORING ─────────────────────────────────────────────────────────────────

function scoreItem(item: NewsItem, trendingKeywords: string[]): number {
  let score = 40

  // Age bonus (max +25)
  if (item.ageHours <= 6)  score += 25
  else if (item.ageHours <= 24) score += 20
  else if (item.ageHours <= 72) score += 12
  else if (item.ageHours <= 168) score += 5

  // Hot words +12
  const titleLow = item.title.toLowerCase()
  if (HOT_WORDS.some(w => titleLow.includes(w))) score += 12

  // SEO words +8
  if (SEO_WORDS.some(w => titleLow.includes(w))) score += 8

  // Trend match +20
  const matched = trendingKeywords.some(kw => titleLow.includes(kw) || kw.includes(titleLow.slice(0, 10)))
  if (matched) score += 20

  return score
}

// ─── CLASSIFICATION ───────────────────────────────────────────────────────────

type Status = 'strong_opportunity' | 'refresh_opportunity' | 'watch' | 'human_review' | 'no_meaningful_update' | 'rejected'

function isBrandNews(title: string): boolean {
  const t = title.toLowerCase()
  const hasBrandVerb = BRAND_VERBS.some(v => t.includes(v))
  const hasKeepSignal = KEEP_SIGNALS.some(s => t.includes(s))
  return hasBrandVerb && !hasKeepSignal
}

function classify(item: NewsItem, score: number, isHighRisk: boolean): Status {
  if (isBrandNews(item.title)) return 'rejected'
  if (isHighRisk) return 'human_review'
  if (score >= 75) return 'strong_opportunity'
  if (score >= 55) return 'refresh_opportunity'
  if (score >= 38) return 'watch'
  return 'no_meaningful_update'
}

function priorityLabel(status: Status): string {
  switch (status) {
    case 'strong_opportunity':  return 'P1'
    case 'refresh_opportunity': return 'P2'
    case 'human_review':        return 'P3'
    case 'watch':               return 'P4'
    default:                    return 'P5'
  }
}

// ─── WHY IT MATTERS ──────────────────────────────────────────────────────────

function buildWhyItMatters(item: NewsItem, score: number, status: Status, trendSignal: string): string {
  const parts: string[] = []

  // Age context
  if (item.ageHours <= 6)        parts.push('ข่าวใหม่มาก — เพิ่งเกิดขึ้นภายใน 6 ชั่วโมง')
  else if (item.ageHours <= 24)  parts.push(`ข่าวสดใหม่ — เกิดขึ้นเมื่อ ${item.ageHours.toFixed(0)} ชั่วโมงที่ผ่านมา`)
  else if (item.ageHours <= 72)  parts.push(`ข่าวยังร้อน — เกิดขึ้นเมื่อ ${(item.ageHours / 24).toFixed(0)} วันที่ผ่านมา`)
  else                            parts.push(`ข่าวอายุ ${(item.ageHours / 24).toFixed(0)} วัน — ยังมีโอกาสทำ content ก่อนคนอื่น`)

  // Trend signal
  if (trendSignal) parts.push('กำลัง Trending ใน Google Thailand ตอนนี้')

  // Score explanation
  if (score >= 75)      parts.push('โอกาสสูงมาก — คะแนน SEO สูง ควรเขียนบทความใหม่ทันที')
  else if (score >= 55) parts.push('ควร Refresh บทความเดิมหรือเพิ่มเนื้อหาใหม่เพื่อรักษา ranking')
  else                  parts.push('เฝ้าดูกระแส — หากยอด trending เพิ่มขึ้นให้รีบทำ content')

  // Status context
  if (status === 'strong_opportunity') {
    parts.push('การเขียนบทความใหม่ตอนนี้จะช่วยให้ Google index ก่อนคู่แข่ง')
  } else if (status === 'refresh_opportunity') {
    parts.push('การอัปเดตบทความเดิมด้วยข้อมูลใหม่นี้จะช่วยรักษาและเพิ่ม ranking')
  } else if (status === 'human_review') {
    parts.push('เนื้อหาอาจมีความเสี่ยง — แนะนำให้ทีมตรวจสอบก่อนเผยแพร่')
  }

  return parts.join(' · ')
}

function buildSuggestedTitle(newsTitle: string, categoryTh: string, status: Status): string {
  const clean = newsTitle.replace(/\s*[-–|].*/g, '').trim()
  if (status === 'strong_opportunity') {
    return `${clean} — รีวิวและวิเคราะห์ครบ ${new Date().getFullYear()}`
  }
  if (status === 'refresh_opportunity') {
    return `อัปเดต: ${clean} — ข้อมูลล่าสุด`
  }
  return `${categoryTh}: ${clean}`
}

// ─── CONTENT ANGLES ───────────────────────────────────────────────────────────

function buildContentAngles(title: string, status: Status): string[] {
  if (status === 'strong_opportunity') {
    return [
      `รีวิว / เปรียบเทียบ: ${title}`,
      `คู่มือ How-to เกี่ยวกับ ${title}`,
      `ทำไม "${title}" ถึงกำลังมาแรง`,
    ]
  }
  if (status === 'refresh_opportunity') {
    return [`อัปเดตบทความเดิม: ${title}`, `เพิ่มข้อมูลใหม่ใน ${title}`]
  }
  return [`ติดตาม: ${title}`]
}

// ─── MAIN CATEGORY PROCESSOR ─────────────────────────────────────────────────

interface CategoryResult {
  category_id: string
  category_name: string
  category_name_th: string
  emoji: string
  status: Status
  priority: string
  news_title: string
  source: string
  reference_url: string
  published: string
  trend_signal: string
  why_it_matters: string
  suggested_title: string
  suggested_keyword: string
  content_angle: string[]
  suitable_sites: string[]
  recommended_usage: string
  score: number
  items_checked: number
}

async function processCategory(
  cat: typeof CATEGORIES[number],
  trendingKeywords: string[],
): Promise<CategoryResult | null> {

  // Collect news from top 3 keywords (avoid rate limit)
  const allItems: NewsItem[] = []
  const keywordsToQuery = cat.news_keywords.slice(0, 3)

  for (const kw of keywordsToQuery) {
    const items = await fetchGoogleNewsRss(kw)
    allItems.push(...items)
    // small delay between requests
    await new Promise(r => setTimeout(r, 300))
  }

  if (allItems.length === 0) return null

  // Deduplicate by title similarity
  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    const key = item.title.slice(0, 40).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Score + pick best
  const scored = unique.map(item => ({ item, score: scoreItem(item, trendingKeywords) }))
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) return null

  const isHighRisk = HIGH_RISK.has(cat.id)
  const status = classify(best.item, best.score, isHighRisk)

  if (status === 'no_meaningful_update' || status === 'rejected') return null

  const trendSignal = cat.trend_keywords.some(kw =>
    trendingKeywords.some(t => t.includes(kw.toLowerCase()) || kw.toLowerCase().includes(t))
  ) ? '🔥 Trending in TH' : ''

  return {
    category_id:      cat.id,
    category_name:    cat.name_en,
    category_name_th: cat.name_th,
    emoji:            cat.emoji,
    status,
    priority:         priorityLabel(status),
    news_title:       best.item.title,
    source:           best.item.source,
    reference_url:    best.item.link,
    published:        best.item.pubDate,
    trend_signal:     trendSignal,
    why_it_matters:   buildWhyItMatters(best.item, best.score, status, trendSignal),
    suggested_title:  buildSuggestedTitle(best.item.title, cat.name_th, status),
    suggested_keyword: cat.trend_keywords[0] ?? cat.name_en,
    content_angle:    buildContentAngles(best.item.title, status),
    suitable_sites:   cat.suitable_business_types,
    recommended_usage: status === 'strong_opportunity' ? 'New Article' : 'Content Update',
    score:            best.score,
    items_checked:    unique.length,
  }
}

async function processSeoUpdates(trendingKeywords: string[]): Promise<CategoryResult | null> {
  const allItems: NewsItem[] = []
  for (const kw of SEO_UPDATES_CATEGORY.news_keywords.slice(0, 3)) {
    const items = await fetchGoogleNewsRss(kw)
    allItems.push(...items)
    await new Promise(r => setTimeout(r, 300))
  }

  if (allItems.length === 0) return null

  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    const key = item.title.slice(0, 40).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const scored = unique.map(item => ({ item, score: scoreItem(item, trendingKeywords) }))
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) return null

  const status = classify(best.item, best.score, false)
  if (status === 'no_meaningful_update' || status === 'rejected') return null

  return {
    category_id:      'seo_updates',
    category_name:    SEO_UPDATES_CATEGORY.name_en,
    category_name_th: SEO_UPDATES_CATEGORY.name_th,
    emoji:            SEO_UPDATES_CATEGORY.emoji,
    status,
    priority:         priorityLabel(status),
    news_title:       best.item.title,
    source:           best.item.source,
    reference_url:    best.item.link,
    published:        best.item.pubDate,
    trend_signal:      '',
    why_it_matters:    buildWhyItMatters(best.item, best.score, status, ''),
    suggested_title:   buildSuggestedTitle(best.item.title, SEO_UPDATES_CATEGORY.name_th, status),
    suggested_keyword: SEO_UPDATES_CATEGORY.trend_keywords[0] ?? SEO_UPDATES_CATEGORY.name_en,
    content_angle:     buildContentAngles(best.item.title, status),
    suitable_sites:    [],
    recommended_usage: 'SEO Intelligence',
    score:            best.score,
    items_checked:    unique.length,
  }
}

// ─── API HANDLER ──────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  const startTime = Date.now()

  // 1. Fetch Google Trends daily TH (replaces pytrends)
  const trendingKeywords = await fetchTrendingKeywordsTH()

  // 2. Process all categories in parallel batches (avoid hammering Google)
  const results: CategoryResult[] = []
  const BATCH = 4

  for (let i = 0; i < CATEGORIES.length; i += BATCH) {
    const batch = CATEGORIES.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(cat => processCategory(cat, trendingKeywords)))
    results.push(...(batchResults.filter(Boolean) as CategoryResult[]))
    if (i + BATCH < CATEGORIES.length) await new Promise(r => setTimeout(r, 1000))
  }

  // 3. SEO updates
  const seoResult = await processSeoUpdates(trendingKeywords)

  // 4. Sort by priority
  const priorityOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3, P5: 4 }
  results.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9))

  // 5. Build output
  const today = new Date()
  const dateStr = today.toISOString().split('T')[0]
  const priorityCounts = {
    strong_opportunity:  results.filter(r => r.status === 'strong_opportunity').length,
    refresh_opportunity: results.filter(r => r.status === 'refresh_opportunity').length,
    watch:               results.filter(r => r.status === 'watch').length,
    human_review:        results.filter(r => r.status === 'human_review').length,
  }

  const emptyCats = CATEGORIES
    .filter(c => !results.find(r => r.category_id === c.id))
    .map(c => c.id)

  const output = {
    date:             dateStr,
    date_iso:         today.toISOString(),
    generated_by:     'mars-nextjs-native',
    sources_checked:  CATEGORIES.length + 1,
    trending_th:      trendingKeywords.slice(0, 20),
    categories:       results,
    seo_updates:      seoResult
      ? { items: [seoResult], has_meaningful: true }
      : { items: [], has_meaningful: false },
    priority_counts:  priorityCounts,
    empty_categories: emptyCats,
    all_empty:        results.length === 0,
    elapsed_ms:       Date.now() - startTime,
    html_report_path: null,
  }

  // 6. Save to disk (same path /api/mars/news reads from)
  try {
    const outDir = path.join(MARS_DATA_ROOT, dateStr)
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, 'category_news_intelligence.json')
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `บันทึกไฟล์ล้มเหลว: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    date: dateStr,
    categories_found: results.length,
    priority_counts: priorityCounts,
    trending_count: trendingKeywords.length,
    elapsed_ms: output.elapsed_ms,
  })
}
