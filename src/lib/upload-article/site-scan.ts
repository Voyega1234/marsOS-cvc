// ─── Upload Article — สแกนเว็บปลายทางแบบละเอียดก่อน push ──────────────────────────
// 1) เว็บใช้ CMS / ธีม / page builder / ปลั๊กอินอะไร
// 2) ธีมหรือปลั๊กอินใส่ สารบัญ / FAQ / CTA ให้ทุกบทความเองหรือไม่ (push ไปจะซ้อนกัน)
// 3) หน้าตา FAQ card + ตาราง + สีตัวอักษรในบทความของเว็บ (ให้บทความใหม่หน้าตาเข้าธีมเดียวกัน)
// อ่านอย่างเดียว: GET หน้าเว็บสาธารณะ + WP REST สาธารณะ ผ่าน SSRF guard ของ competitor-gap
// บทความที่ Upload Article เคย push ไป (มี div.content-article) ถูกตัดออกจากการนับทุกจุด กันนับของตัวเอง

import { fetchHtml, fetchText } from '@/lib/competitor-gap/fetcher'
import { askJson } from '@/lib/competitor-gap/ai'
import type { ORUsage } from '@/lib/openrouter'
import { safeColor, sanitizeThemeDetail } from './theme-css'
import type {
  UploadComponentFinding,
  UploadComponentKey,
  UploadSiteScan,
  UploadTheme,
  UploadThemeDetail,
} from './types'

interface Detector {
  re: RegExp
  label: string
  /** ปลั๊กอินที่ตั้งค่าเริ่มต้นให้แทรกเองทุกโพสต์ */
  autoInsert?: boolean
  /** true = ใช้บอกหน้าตา FAQ ได้ (element จริง ไม่ใช่ schema/หัวข้อ) */
  element?: boolean
  /** false = ไม่นับในหน้าแรก (เช่น ปุ่มโทร/LINE ที่ header ทุกเว็บมี) */
  homeOk?: boolean
  /** สัญญาณอ่อน (schema/ข้อความหัวข้อ) — ไม่ใช้ตัดสินว่าธีมใส่ให้เอง */
  weak?: boolean
}

const DETECTORS: Record<UploadComponentKey, Detector[]> = {
  toc: [
    { re: /ez-toc-container|ez-toc-v2|class="[^"]*\bez-toc/i, label: 'Easy Table of Contents (ปลั๊กอิน)', autoInsert: true },
    { re: /class="[^"]*\blwptoc/i, label: 'LuckyWP Table of Contents (ปลั๊กอิน)', autoInsert: true },
    { re: /id="toc_container"/i, label: 'Table of Contents Plus (ปลั๊กอิน)', autoInsert: true },
    { re: /class="[^"]*\bftwp-/i, label: 'Fixed TOC (ปลั๊กอิน)', autoInsert: true },
    { re: /class="[^"]*\b(?:joli-toc|wpj-jtoc)/i, label: 'Joli Table of Contents (ปลั๊กอิน)', autoInsert: true },
    { re: /wp-block-rank-math-toc-block|class="[^"]*\brank-math-toc/i, label: 'Rank Math TOC block' },
    { re: /yoast-table-of-contents/i, label: 'Yoast TOC block' },
    { re: /elementor-widget-table-of-contents|class="[^"]*\belementor-toc/i, label: 'Elementor Table of Contents widget' },
    { re: /uagb-toc|wp-block-uagb-table-of-contents/i, label: 'Spectra TOC block' },
    { re: /kb-table-of-content/i, label: 'Kadence TOC block' },
    { re: /class="[^"]*(?<![\w-])(?:toc|table-of-contents)(?![\w-])[^"]*"/i, label: 'กล่องสารบัญของธีม' },
    { re: /<nav\b[^>]*aria-label="[^"]*สารบัญ/i, label: 'กล่องสารบัญ (nav)' },
  ],
  faq: [
    { re: /wp-block-rank-math-faq-block|class="[^"]*\brank-math-faq/i, label: 'Rank Math FAQ block', element: true },
    { re: /wp-block-yoast-faq-block|class="[^"]*\bschema-faq/i, label: 'Yoast FAQ block', element: true },
    { re: /class="[^"]*\b(?:elementor-accordion|elementor-toggle|e-n-accordion)/i, label: 'Elementor Accordion/Toggle', element: true },
    { re: /class="[^"]*\b(?:uagb-faq|wp-block-uagb-faq)/i, label: 'Spectra FAQ block', element: true },
    { re: /class="[^"]*\b(?:kt-accordion|kb-accordion|wp-block-kadence-accordion)/i, label: 'Kadence Accordion', element: true },
    { re: /class="[^"]*\b(?:stk-block-accordion|ugb-accordion)/i, label: 'Stackable Accordion', element: true },
    { re: /class="[^"]*\b(?:sp-easy-accordion|sp-ea-single)/i, label: 'Easy Accordion (ปลั๊กอิน)', element: true },
    { re: /class="[^"]*\bewd-ufaq/i, label: 'Ultimate FAQ (ปลั๊กอิน)', element: true },
    { re: /class="[^"]*\bhelpie-faq/i, label: 'Helpie FAQ (ปลั๊กอิน)', element: true },
    { re: /class="[^"]*\bwp-block-details\b/i, label: 'Gutenberg Details block', element: true },
    { re: /class="[^"]*(?<![\w-])faq(?![\w-])[^"]*"|class="[^"]*(?<![\w-])faq[-_][^"]*"/i, label: 'กล่อง FAQ ของธีม', element: true },
    { re: /"@type"\s*:\s*"FAQPage"/i, label: 'FAQ schema (FAQPage)', weak: true },
    { re: /คำถามที่พบบ่อย|Frequently Asked Questions/i, label: 'หัวข้อ "คำถามที่พบบ่อย"', weak: true },
  ],
  cta: [
    { re: /class="[^"]*(?<![\w-])cta(?![\w-])[^"]*"/i, label: 'กล่อง CTA (class="cta")' },
    { re: /class="[^"]*call-?to-?action/i, label: 'กล่อง call-to-action' },
    { re: /href="https?:\/\/(?:line\.me|lin\.ee)\//i, label: 'ปุ่ม LINE ในเนื้อบทความ', homeOk: false },
    { re: /href="tel:/i, label: 'ปุ่มโทรในเนื้อบทความ', homeOk: false },
  ],
}

const BUILDERS: Array<{ re: RegExp; label: string }> = [
  { re: /elementor-(?:element|widget|section|page)|\/plugins\/elementor\//i, label: 'Elementor' },
  { re: /\bet_pb_|\/themes\/Divi\//i, label: 'Divi' },
  { re: /\bvc_row|\/plugins\/js_composer\//i, label: 'WPBakery' },
  { re: /\bfl-builder|\/plugins\/bb-plugin\//i, label: 'Beaver Builder' },
  { re: /\bct-section|\/plugins\/oxygen\//i, label: 'Oxygen' },
  { re: /\bbrxe-|\/themes\/bricks\//i, label: 'Bricks' },
  { re: /\bwp-block-/i, label: 'Gutenberg (Block editor)' },
]

const PLUGIN_NAMES: Record<string, string> = {
  'easy-table-of-contents': 'Easy Table of Contents',
  'luckywp-table-of-contents': 'LuckyWP Table of Contents',
  'table-of-contents-plus': 'Table of Contents Plus',
  'seo-by-rank-math': 'Rank Math SEO',
  'seo-by-rank-math-pro': 'Rank Math SEO PRO',
  'wordpress-seo': 'Yoast SEO',
  'wordpress-seo-premium': 'Yoast SEO Premium',
  elementor: 'Elementor',
  'elementor-pro': 'Elementor Pro',
  'ultimate-addons-for-gutenberg': 'Spectra',
  'kadence-blocks': 'Kadence Blocks',
  'stackable-ultimate-gutenberg-blocks': 'Stackable',
  'ultimate-faqs': 'Ultimate FAQ',
  'easy-accordion-free': 'Easy Accordion',
  'helpie-faq': 'Helpie FAQ',
  'contact-form-7': 'Contact Form 7',
  woocommerce: 'WooCommerce',
  js_composer: 'WPBakery',
  'all-in-one-seo-pack': 'All in One SEO',
  'wp-rocket': 'WP Rocket',
  litespeed: 'LiteSpeed Cache',
  'litespeed-cache': 'LiteSpeed Cache',
}

const TOC_PLUGIN_SLUGS = ['easy-table-of-contents', 'luckywp-table-of-contents', 'table-of-contents-plus', 'fixed-toc', 'joli-table-of-contents']

// ── helpers ─────────────────────────────────────────────────────────────────

function normalizeSite(raw: string): string {
  const s = raw.trim().replace(/\/(wp-admin|wp-login\.php)(\/.*)?$/, '').replace(/\/+$/, '')
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

/** ตัด element ที่เปิดที่ start ถึงแท็กปิดคู่กัน (นับซ้อน) — ไม่เจอคืน -1 */
function balancedEnd(html: string, start: number, tag: string): number {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi')
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else if (!m[0].endsWith('/>')) {
      depth++
    }
  }
  return -1
}

/** ตัดบทความที่ Upload Article/Clients เคย push ไป (div.content-article) ออกจากหน้า */
function stripOurArticles(html: string): string {
  let out = html
  for (let guard = 0; guard < 5; guard++) {
    const i = out.indexOf('<div class="content-article"')
    if (i === -1) break
    const e = balancedEnd(out, i, 'div')
    out = out.slice(0, i) + (e === -1 ? '' : out.slice(e))
  }
  return out
}

function stripChrome(html: string): string {
  return html
    .replace(/<script\b(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
}

/** ส่วนเนื้อบทความของหน้าโพสต์ (ใช้กับ CTA — ปุ่มโทร/LINE ใน header/footer ไม่นับ) */
function articleRegion(html: string): string {
  const i = html.search(/<article\b/i)
  if (i !== -1) {
    const e = balancedEnd(html, i, 'article')
    if (e !== -1) return html.slice(i, e)
  }
  return stripChrome(html)
}

function matchDetectors(doc: string, key: UploadComponentKey, opts: { home?: boolean } = {}): Detector[] {
  return DETECTORS[key].filter((d) => (opts.home && d.homeOk === false ? false : d.re.test(doc)))
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

function prettySlug(slug: string): string {
  return PLUGIN_NAMES[slug] || slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── platform ────────────────────────────────────────────────────────────────

function detectPlatform(pages: string[]): UploadSiteScan['platform'] {
  const all = pages.join('\n')
  const themes = uniq(Array.from(all.matchAll(/\/wp-content\/themes\/([a-z0-9_.-]+)\//gi), (m) => m[1].toLowerCase()))
  const plugins = uniq(Array.from(all.matchAll(/\/wp-content\/plugins\/([a-z0-9_.-]+)\//gi), (m) => m[1].toLowerCase()))
  const generator = Array.from(all.matchAll(/<meta[^>]+name="generator"[^>]+content="([^"]+)"/gi), (m) => m[1])
  let cms = 'ไม่ทราบ'
  if (/\/wp-content\/|\/wp-json\/|wp-includes/i.test(all)) cms = 'WordPress'
  else if (/cdn\.shopify\.com|Shopify\.theme/i.test(all)) cms = 'Shopify'
  else if (/static\.wixstatic\.com|wix-bolt/i.test(all)) cms = 'Wix'
  else if (/squarespace/i.test(all)) cms = 'Squarespace'
  const wpVer = generator.find((g) => /^WordPress/i.test(g))
  if (wpVer) cms = wpVer
  const child = themes.find((t) => /-child$|child-theme|-child-/.test(t)) || null
  const parent = themes.find((t) => t !== child) || null
  return {
    cms,
    theme: parent ? prettySlug(parent) : null,
    childTheme: child ? prettySlug(child) : null,
    builders: BUILDERS.filter((b) => b.re.test(all)).map((b) => b.label),
    plugins: plugins.slice(0, 40).map(prettySlug),
  }
}

// ── component findings ──────────────────────────────────────────────────────

interface PostSample {
  link: string
  /** เนื้อดิบจาก REST (content.rendered หลังผ่าน filter) — null ถ้า REST ปิด */
  content: string | null
  /** หน้าโพสต์ที่ render จริง — null ถ้าไม่ได้เปิด */
  page: string | null
}

function findComponent(key: UploadComponentKey, posts: PostSample[], home: string | null, pluginSlugs: string[]): UploadComponentFinding {
  const evidence: string[] = []
  const labels: string[] = []
  let postsWith = 0
  let templateOnly = false
  let knownAuto = false

  for (const p of posts) {
    const pageDoc = p.page ? (key === 'cta' ? articleRegion(p.page) : stripChrome(p.page)) : null
    const inContent = p.content ? matchDetectors(p.content, key) : []
    const inPage = pageDoc ? matchDetectors(pageDoc, key) : []
    const hits = p.content ? inContent : inPage
    if (hits.length) postsWith++
    for (const d of [...inContent, ...inPage]) {
      labels.push(d.label)
      if (d.autoInsert) knownAuto = true
    }
    // มีในหน้าจริง แต่เนื้อดิบไม่มี = ธีม/ปลั๊กอินเติมตอนแสดงผล
    if (p.content !== null && inPage.some((d) => !d.weak) && inContent.length === 0) {
      templateOnly = true
    }
  }
  const postsChecked = posts.filter((p) => p.content !== null || p.page !== null).length
  const homeHits = home ? matchDetectors(stripChrome(home), key, { home: true }) : []

  let where: UploadComponentFinding['where'] = null
  if (knownAuto || templateOnly) where = 'auto'
  // FAQ ในเนื้อหาเป็นของผู้เขียนใส่รายบทความเสมอ — ใช้เกณฑ์ "เกือบทุกบทความ" เฉพาะสารบัญ/CTA
  else if (key !== 'faq' && postsWith >= 2 && postsWith / Math.max(1, postsChecked) >= 0.6) where = 'auto'
  else if (postsWith > 0) where = 'some-posts'
  else if (homeHits.length) where = 'site'

  if (postsChecked) evidence.push(`พบใน ${postsWith}/${postsChecked} บทความที่สุ่มดู`)
  if (knownAuto) evidence.push('เป็นปลั๊กอินที่แทรกให้ทุกบทความเองโดยค่าเริ่มต้น')
  if (templateOnly) evidence.push('หน้าบทความจริงมี แต่เนื้อหาที่ผู้เขียนใส่ไม่มี — ธีม/ปลั๊กอินเติมให้ตอนแสดงผล')
  if (!postsWith && homeHits.length) evidence.push(`เจอในหน้าแรก: ${uniq(homeHits.map((d) => d.label)).join(', ')}`)
  if (key === 'toc') {
    const installed = pluginSlugs.filter((s) => TOC_PLUGIN_SLUGS.includes(s))
    if (installed.length) evidence.push(`เว็บโหลดไฟล์ของปลั๊กอินสารบัญ: ${installed.map(prettySlug).join(', ')}`)
  }

  const allLabels = uniq([...labels, ...homeHits.map((d) => d.label)])
  return {
    found: where !== null,
    where,
    source: allLabels[0] || '',
    postsWith,
    postsChecked,
    evidence: [...evidence, ...(allLabels.length > 1 ? [`สัญญาณที่เจอ: ${allLabels.join(', ')}`] : [])],
  }
}

// ── FAQ / content style (CSS) ───────────────────────────────────────────────

/** ตัวอย่าง HTML ของ FAQ element จริงบนเว็บ (≤6KB) */
function extractFaqSnippet(pages: string[]): { html: string; label: string } | null {
  for (const page of pages) {
    const doc = stripChrome(page)
    for (const d of DETECTORS.faq) {
      if (!d.element) continue
      const m = d.re.exec(doc)
      if (!m) continue
      const tagStart = doc.lastIndexOf('<', m.index)
      const tag = /^<([a-z0-9]+)/i.exec(doc.slice(tagStart))?.[1]?.toLowerCase()
      if (!tag || tagStart < 0) continue
      const end = balancedEnd(doc, tagStart, tag)
      const html = doc.slice(tagStart, end === -1 ? tagStart + 6000 : Math.min(end, tagStart + 6000))
      return { html: html.replace(/\s+/g, ' '), label: d.label }
    }
  }
  return null
}

const GENERIC_CLASS = /^(?:wp-block-.*|elementor-(?:element|widget-wrap|column|section|container)|e-con.*|has-.*|is-.*|alignwide|alignfull|clearfix|active|open|show|content-.*)$/i

function classTokens(html: string): string[] {
  const tokens = Array.from(html.matchAll(/class="([^"]+)"/gi)).flatMap((m) => m[1].split(/\s+/))
  return uniq(tokens.filter((t) => t && t.length <= 60 && /^[\w-]+$/.test(t) && !GENERIC_CLASS.test(t))).slice(0, 40)
}

async function collectCss(page: string, base: string): Promise<string> {
  const inline = Array.from(page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1])
  const hrefs = uniq(
    Array.from(page.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi), (m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1] || '')
      .filter(Boolean)
      .map((h) => {
        try {
          return new URL(h.replace(/&amp;/g, '&'), base).toString()
        } catch {
          return ''
        }
      })
      .filter((h) => /^https:\/\//i.test(h) && !/fonts\.googleapis|font-awesome|fontawesome|dashicons/i.test(h)),
  ).slice(0, 10)
  const files = await Promise.all(hrefs.map((h) => fetchText(h).then((t) => (t || '').slice(0, 600_000))))
  return [...inline, ...files].join('\n')
}

interface CssRule {
  selector: string
  body: string
}

function parseRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return Array.from(clean.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({ selector: m[1].trim(), body: m[2].trim() })).filter(
    (r) => r.selector && r.body && !r.selector.startsWith('@'),
  )
}

function resolveVars(body: string, vars: Map<string, string>): string {
  let out = body
  for (let i = 0; i < 3 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (all, name: string, fb?: string) => vars.get(name) ?? fb?.trim() ?? all)
  }
  return out
}

const CONTENT_SEL = /(?:entry-content|post-content|single-content|article-content|the-content|elementor-widget-theme-post-content|wp-block-post-content)[^,{]*\b(?:h2|h3|a|table|th|td|p|blockquote)\b|^(?:body|h2|h3|a|table|th|td)$/i

function relevantCss(rules: CssRule[], tokens: string[]): { faqCss: string; contentCss: string } {
  const vars = new Map<string, string>()
  for (const r of rules) {
    if (!/(?::root|^html|^body|\.editor-styles-wrapper)/i.test(r.selector)) continue
    for (const m of Array.from(r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g))) if (!vars.has(m[1])) vars.set(m[1], m[2].trim())
  }
  const tokenRe = tokens.length ? new RegExp(`\\.(?:${tokens.map((t) => t.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`) : null
  const faq: string[] = []
  const content: string[] = []
  let faqLen = 0
  let contentLen = 0
  for (const r of rules) {
    const body = resolveVars(r.body.replace(/(?:^|;)\s*--[\w-]+\s*:[^;]*/g, ''), vars).trim()
    if (!body) continue
    const line = `${r.selector.replace(/\s+/g, ' ')}{${body.replace(/\s+/g, ' ')}}`
    if (tokenRe && tokenRe.test(r.selector) && faqLen < 14_000) {
      faq.push(line)
      faqLen += line.length
    } else if (CONTENT_SEL.test(r.selector) && contentLen < 6_000) {
      content.push(line)
      contentLen += line.length
    }
  }
  return { faqCss: faq.join('\n'), contentCss: content.join('\n') }
}

interface AiStyle {
  colors?: Partial<Record<'theme' | 'text' | 'border' | 'accent' | 'background', string>>
  fonts?: { body?: string; heading?: string }
  faq?: Record<string, unknown>
  table?: Record<string, unknown>
  summary?: string
}

const FONT_RE = /^[\w\sÀ-ɏ฀-๿'",-]*$/

function safeFont(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s && s.length <= 200 && FONT_RE.test(s) ? s : undefined
}

function safeHex(v: unknown): string | undefined {
  const c = safeColor(v)
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined
}

const SYSTEM = `คุณคือนักวิเคราะห์ CSS ของเว็บ WordPress
หน้าที่: อ่าน HTML ตัวอย่างของกล่อง FAQ และกฎ CSS ที่เกี่ยวข้องของเว็บ แล้วสรุปหน้าตาจริงที่ผู้อ่านเห็นเป็น JSON
กติกา:
- ใช้เฉพาะค่าที่มีหลักฐานใน CSS/HTML ที่ให้มา ห้ามเดา ถ้าไม่มีหลักฐานให้ละ key นั้นไป
- สีเป็น hex เท่านั้น (#rrggbb) ถ้า CSS เป็น rgb() ให้แปลงเป็น hex
- ตัวเลขขนาด (radius/gap/borderWidth) เป็น number หน่วย px, padding เป็นสตริง CSS เช่น "16px 20px"
- ถ้าไม่มีกล่อง FAQ บนเว็บ ให้เสนอ faq ที่เข้ากับภาษาออกแบบของเนื้อหาบทความ (สี/ขอบ/มุมโค้งจาก CSS บทความ) และบอกใน summary ว่าเป็นค่าที่เสนอ
- summary เป็นภาษาไทย 2-4 ประโยค อธิบายว่าเว็บแสดง FAQ และบทความอย่างไร (เช่น กล่องมีขอบมุมโค้ง ไอคอนลูกศรขวา หัวข้อสีน้ำเงิน)
ตอบ JSON รูปแบบนี้เท่านั้น:
{"colors":{"theme":"สีหลัก/หัวข้อ","text":"สีตัวอักษรเนื้อหา","border":"สีเส้นขอบ","accent":"สีลิงก์","background":"พื้นหลังบทความ ถ้าเป็นสีขาวให้เว้นว่าง"},
"fonts":{"body":"font-family เนื้อหา","heading":"font-family หัวข้อ"},
"faq":{"layout":"card|divider|plain","itemBackground":"","itemBorderColor":"","itemBorderWidth":1,"itemRadius":8,"itemGap":12,"itemShadow":false,"questionBackground":"","questionColor":"","questionFontSize":"18px","questionWeight":600,"questionPadding":"16px 20px","openQuestionBackground":"","openQuestionColor":"","answerBackground":"","answerColor":"","answerPadding":"0 20px 16px","icon":"plus|chevron|caret|arrow|none","iconPosition":"left|right","iconColor":""},
"table":{"headerBackground":"","headerColor":"","borderColor":"","stripeBackground":""},
"summary":""}`

async function analyzeStyle(input: { faqSnippet: string; faqLabel: string; faqCss: string; contentCss: string }): Promise<{ data: AiStyle | null; usage: ORUsage | null; error: string | null }> {
  if (!input.faqCss && !input.contentCss && !input.faqSnippet) return { data: null, usage: null, error: 'ไม่พบ CSS ของเว็บให้วิเคราะห์' }
  const user = [
    input.faqSnippet ? `## กล่อง FAQ บนเว็บ (${input.faqLabel})\n${input.faqSnippet}` : '## เว็บนี้ไม่มีกล่อง FAQ ในบทความที่สุ่มดู',
    `## CSS ของกล่อง FAQ\n${input.faqCss || '(ไม่มี)'}`,
    `## CSS ของเนื้อหาบทความ\n${input.contentCss || '(ไม่มี)'}`,
  ].join('\n\n')
  const r = await askJson<AiStyle>({ trace: 'uploadSiteScanStyle', system: SYSTEM, user, maxTokens: 1500, temperature: 0.1, timeoutMs: 90_000 })
  return { data: r.data, usage: r.usage, error: r.error }
}

// ── main ────────────────────────────────────────────────────────────────────

export interface SiteScanResult {
  scan: UploadSiteScan
  /** สี/ฟอนต์ที่เสนอ (ผ่าน sanitize แล้ว) — ผู้ใช้กดรับเองในหน้า Generate */
  suggestedTheme: Partial<UploadTheme> | null
  detail: UploadThemeDetail | null
  usage: ORUsage | null
}

export async function scanUploadSite(siteUrl: string, sampleUrl?: string): Promise<SiteScanResult> {
  const target = normalizeSite(siteUrl)
  const checked: string[] = []
  const warnings: string[] = []

  const homeRes = await fetchHtml(target, { browserLike: true })
  const home = homeRes.ok ? stripOurArticles(homeRes.html) : null
  if (home) checked.push('หน้าแรก')
  else warnings.push(`เปิดหน้าแรกไม่ได้ (${homeRes.error || homeRes.status})`)

  // WP REST: เนื้อหาบทความ 8 โพสต์ล่าสุด — ข้ามโพสต์ที่เรา push ไปเอง
  const posts: PostSample[] = []
  let ownSkipped = 0
  const restRaw = await fetchText(`${target}/wp-json/wp/v2/posts?per_page=8&_fields=link,content.rendered`)
  if (restRaw) {
    try {
      const arr = JSON.parse(restRaw) as Array<{ link?: string; content?: { rendered?: string } }>
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const content = p.content?.rendered || ''
          if (!p.link || !/^https?:\/\//i.test(p.link)) continue
          if (content.includes('content-article')) {
            ownSkipped++
            continue
          }
          posts.push({ link: p.link, content, page: null })
        }
      }
    } catch {
      /* ไม่ใช่ JSON — REST ปิดหรือไม่ใช่ WordPress */
    }
  }
  if (posts.length) checked.push(`เนื้อหาบทความเดิม ${posts.length} โพสต์ (WP REST)`)
  if (ownSkipped) checked.push(`ข้ามบทความที่ส่งจากระบบเรา ${ownSkipped} โพสต์`)

  // ไม่มี REST — เดาลิงก์บทความจากหน้าแรก
  if (!posts.length && home) {
    const host = new URL(homeRes.finalUrl || target).host
    const links = uniq(Array.from(home.matchAll(/<a[^>]+href="(https?:\/\/[^"#?]+)"/gi), (m) => m[1].replace(/\/$/, '')))
      .filter((u) => {
        try {
          const url = new URL(u)
          return url.host === host && url.pathname.length > 12 && !/\/(category|tag|author|page|about|contact|privacy|terms|shop|cart|login|wp-)/i.test(url.pathname)
        } catch {
          return false
        }
      })
      .slice(0, 3)
    for (const link of links) posts.push({ link, content: null, page: null })
    if (!links.length) warnings.push('หาลิงก์บทความในหน้าแรกไม่เจอ — ใส่ลิงก์บทความตัวอย่างเพื่อสแกนละเอียดขึ้น')
  }

  // เปิดหน้าบทความจริง 3 หน้า (+ ลิงก์ตัวอย่างที่ผู้ใช้ใส่)
  const sample = sampleUrl?.trim() ? normalizeSite(sampleUrl) : ''
  const toRender = uniq([...(sample ? [sample] : []), ...posts.map((p) => p.link)]).slice(0, sample ? 4 : 3)
  const rendered = await Promise.all(toRender.map((u) => fetchHtml(u, { browserLike: true })))
  let renderedCount = 0
  rendered.forEach((r, i) => {
    if (!r.ok) return
    renderedCount++
    const link = toRender[i]
    const page = stripOurArticles(r.html)
    const existing = posts.find((p) => p.link.replace(/\/$/, '') === link.replace(/\/$/, ''))
    if (existing) existing.page = page
    else posts.push({ link, content: null, page })
  })
  if (renderedCount) checked.push(`หน้าบทความที่แสดงจริง ${renderedCount} หน้า`)

  const pages = [home, ...posts.map((p) => p.page)].filter((p): p is string => !!p)
  if (!pages.length && !posts.some((p) => p.content)) {
    throw new Error(`เข้าเว็บ ${target} ไม่ได้ — เช็ค URL หรือเว็บอาจบล็อกบอท`)
  }

  const allRaw = [homeRes.html, ...rendered.filter((r) => r.ok).map((r) => r.html)].join('\n')
  const platform = detectPlatform([allRaw])
  const pluginSlugs = uniq(Array.from(allRaw.matchAll(/\/wp-content\/plugins\/([a-z0-9_.-]+)\//gi), (m) => m[1].toLowerCase()))

  const components = {
    toc: findComponent('toc', posts, home, pluginSlugs),
    faq: findComponent('faq', posts, home, pluginSlugs),
    cta: findComponent('cta', posts, home, pluginSlugs),
  }

  // หน้าตา FAQ + บทความ — ใช้หน้าบทความจริง (ถ้าไม่มีใช้หน้าแรก)
  const postPages = posts.map((p) => p.page).filter((p): p is string => !!p)
  const snippet = extractFaqSnippet([...postPages, ...(home ? [home] : [])])
  const cssPage = postPages[0] || home
  let suggestedTheme: Partial<UploadTheme> | null = null
  let detail: UploadThemeDetail | null = null
  let usage: ORUsage | null = null
  let faqSummary = ''
  if (cssPage) {
    const css = await collectCss(cssPage, postPages.length ? toRender[0] : target)
    const { faqCss, contentCss } = relevantCss(parseRules(css), snippet ? classTokens(snippet.html) : [])
    const ai = await analyzeStyle({ faqSnippet: snippet?.html || '', faqLabel: snippet?.label || '', faqCss, contentCss })
    usage = ai.usage
    if (ai.data) {
      const c = ai.data.colors || {}
      const t: Partial<UploadTheme> = {}
      for (const k of ['theme', 'text', 'border', 'accent', 'background'] as const) {
        const v = safeHex(c[k])
        if (v) t[k] = v
      }
      const body = safeFont(ai.data.fonts?.body)
      const heading = safeFont(ai.data.fonts?.heading)
      if (body) t.fontFamily = body
      if (heading) t.headingFont = heading
      suggestedTheme = Object.keys(t).length ? t : null
      detail =
        sanitizeThemeDetail({
          source: snippet ? `${snippet.label} บน ${target}` : `ภาษาออกแบบบทความของ ${target} (เว็บไม่มีกล่อง FAQ)`,
          faq: ai.data.faq,
          table: ai.data.table,
        }) || null
      faqSummary = typeof ai.data.summary === 'string' ? ai.data.summary.replace(/[<>]/g, '').slice(0, 600) : ''
    } else if (ai.error) {
      warnings.push(`วิเคราะห์หน้าตา FAQ ไม่สำเร็จ: ${ai.error}`)
    }
  }

  return {
    scan: {
      target,
      scannedAt: new Date().toISOString(),
      checked,
      platform,
      components,
      faqSummary,
      warnings,
    },
    suggestedTheme,
    detail,
    usage,
  }
}
